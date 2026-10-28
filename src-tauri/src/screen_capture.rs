use std::mem::size_of;

use base64::{engine::general_purpose::STANDARD, Engine as _};
use image::{codecs::png::PngEncoder, ExtendedColorType, ImageEncoder};
use serde::{Deserialize, Serialize};
use tauri::AppHandle;
use windows::Globalization::Language;
use windows::Graphics::Imaging::{BitmapPixelFormat, SoftwareBitmap};
use windows::Media::Ocr::OcrEngine;
use windows::Storage::Streams::DataWriter;
use windows::Win32::Graphics::Gdi::{
    BitBlt, CreateCompatibleBitmap, CreateCompatibleDC, DeleteDC, DeleteObject, GetDC, GetDIBits,
    ReleaseDC, SelectObject, BITMAPINFO, BITMAPINFOHEADER, BI_RGB, CAPTUREBLT, DIB_RGB_COLORS,
    HGDIOBJ, SRCCOPY,
};

use crate::font_match::{self, FontMatch};
use crate::media::init_winrt;
use crate::window_manager::{cursor_monitor_bounds, overlay_origin, with_notch_hidden};

const MIN_OCR_SIDE: u32 = 48;

/// Region in logical px, relative to the overlay window.
#[derive(Deserialize, Clone, Copy)]
pub struct Region {
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
}

#[derive(Serialize, Clone, Copy)]
pub struct Bounds {
    pub x: i32,
    pub y: i32,
    pub w: u32,
    pub h: u32,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CaptureResult {
    pub image_base64: String,
    pub bounds: Bounds,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FontDetection {
    pub image_base64: String,
    pub bounds: Bounds,
    pub text: String,
    pub matches: Vec<FontMatch>,
}

struct Raw {
    width: u32,
    height: u32,
    bgra: Vec<u8>,
}

fn to_physical(app: &AppHandle, region: Region) -> Result<Bounds, String> {
    let (ox, oy, scale) = overlay_origin(app);
    let w = (region.w * scale).round() as i64;
    let h = (region.h * scale).round() as i64;
    if w < 2 || h < 2 {
        return Err("selection too small".into());
    }
    Ok(Bounds {
        x: ox + (region.x * scale).round() as i32,
        y: oy + (region.y * scale).round() as i32,
        w: w as u32,
        h: h as u32,
    })
}

pub(crate) fn capture_screen(b: Bounds) -> Result<Raw, String> {
    unsafe {
        let screen = GetDC(None);
        if screen.is_invalid() {
            return Err("GetDC failed".into());
        }
        let mem = CreateCompatibleDC(Some(screen));
        let bitmap = CreateCompatibleBitmap(screen, b.w as i32, b.h as i32);
        let old = SelectObject(mem, HGDIOBJ(bitmap.0));

        let copied = BitBlt(
            mem,
            0,
            0,
            b.w as i32,
            b.h as i32,
            Some(screen),
            b.x,
            b.y,
            SRCCOPY | CAPTUREBLT,
        );

        let mut bgra = vec![0u8; (b.w * b.h * 4) as usize];
        let mut bmi = BITMAPINFO {
            bmiHeader: BITMAPINFOHEADER {
                biSize: size_of::<BITMAPINFOHEADER>() as u32,
                biWidth: b.w as i32,
                biHeight: -(b.h as i32),
                biPlanes: 1,
                biBitCount: 32,
                biCompression: BI_RGB.0,
                ..Default::default()
            },
            ..Default::default()
        };
        let lines = GetDIBits(
            mem,
            bitmap,
            0,
            b.h,
            Some(bgra.as_mut_ptr() as *mut _),
            &mut bmi,
            DIB_RGB_COLORS,
        );

        SelectObject(mem, old);
        let _ = DeleteObject(HGDIOBJ(bitmap.0));
        let _ = DeleteDC(mem);
        ReleaseDC(None, screen);

        copied.map_err(|e| e.to_string())?;
        if lines == 0 {
            return Err("GetDIBits failed".into());
        }
        // GDI leaves alpha undefined.
        bgra.chunks_exact_mut(4).for_each(|p| p[3] = 255);
        Ok(Raw {
            width: b.w,
            height: b.h,
            bgra,
        })
    }
}

pub(crate) fn encode_png(raw: &Raw) -> Result<String, String> {
    let mut rgba = raw.bgra.clone();
    rgba.chunks_exact_mut(4).for_each(|p| p.swap(0, 2));
    let mut out = Vec::new();
    PngEncoder::new(&mut out)
        .write_image(&rgba, raw.width, raw.height, ExtendedColorType::Rgba8)
        .map_err(|e| e.to_string())?;
    Ok(STANDARD.encode(out))
}

fn scale_nearest(raw: &Raw, factor: u32, invert: bool) -> Raw {
    let (w, h) = (raw.width * factor, raw.height * factor);
    let mut bgra = Vec::with_capacity((w * h * 4) as usize);
    for y in 0..h {
        for x in 0..w {
            let i = (((y / factor) * raw.width + x / factor) * 4) as usize;
            let p = &raw.bgra[i..i + 4];
            if invert {
                bgra.extend_from_slice(&[255 - p[0], 255 - p[1], 255 - p[2], 255]);
            } else {
                bgra.extend_from_slice(p);
            }
        }
    }
    Raw {
        width: w,
        height: h,
        bgra,
    }
}

fn recognize(raw: &Raw) -> Result<String, String> {
    let e = |err: windows::core::Error| err.to_string();
    let writer = DataWriter::new().map_err(e)?;
    writer.WriteBytes(&raw.bgra).map_err(e)?;
    let buffer = writer.DetachBuffer().map_err(e)?;
    let bitmap = SoftwareBitmap::CreateCopyFromBuffer(
        &buffer,
        BitmapPixelFormat::Bgra8,
        raw.width as i32,
        raw.height as i32,
    )
    .map_err(e)?;
    let engine = OcrEngine::TryCreateFromUserProfileLanguages()
        .or_else(|_| {
            Language::CreateLanguage(&windows::core::HSTRING::from("en-US"))
                .and_then(|lang| OcrEngine::TryCreateFromLanguage(&lang))
        })
        .map_err(|_| "no Windows OCR language pack installed".to_string())?;
    let result = engine
        .RecognizeAsync(&bitmap)
        .and_then(|op| op.get())
        .map_err(e)?;
    Ok(result.Text().map_err(e)?.to_string().trim().to_string())
}

/// OCR with upscaling for small selections; retries with inverted colours for light-on-dark text.
fn ocr_text(raw: &Raw) -> Result<String, String> {
    let max_side = OcrEngine::MaxImageDimension().unwrap_or(10000);
    let min_side = raw.width.min(raw.height).max(1);
    let factor = MIN_OCR_SIDE.div_ceil(min_side).clamp(1, 4);
    let factor = if raw.width.max(raw.height) * factor > max_side {
        1
    } else {
        factor
    };
    let prepared = scale_nearest(raw, factor, false);
    let text = recognize(&prepared)?;
    if !text.is_empty() {
        return Ok(text);
    }
    recognize(&scale_nearest(raw, factor, true))
}

#[tauri::command]
pub async fn capture_region(app: AppHandle, region: Region) -> Result<CaptureResult, String> {
    let bounds = to_physical(&app, region)?;
    tauri::async_runtime::spawn_blocking(move || {
        let raw = with_notch_hidden(&app, || capture_screen(bounds))?;
        Ok(CaptureResult {
            image_base64: encode_png(&raw)?,
            bounds,
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Captures the whole monitor under the cursor.
#[tauri::command]
pub async fn capture_fullscreen(app: AppHandle) -> Result<CaptureResult, String> {
    let (x, y, w, h) = cursor_monitor_bounds(&app).ok_or("no monitor found")?;
    let bounds = Bounds { x, y, w, h };
    tauri::async_runtime::spawn_blocking(move || {
        let raw = with_notch_hidden(&app, || capture_screen(bounds))?;
        Ok(CaptureResult {
            image_base64: encode_png(&raw)?,
            bounds,
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Captures the region, runs Windows OCR and ranks installed fonts by visual similarity.
#[tauri::command]
pub async fn detect_font(app: AppHandle, region: Region) -> Result<FontDetection, String> {
    let bounds = to_physical(&app, region)?;
    tauri::async_runtime::spawn_blocking(move || {
        init_winrt();
        let raw = capture_screen(bounds)?;
        let image_base64 = encode_png(&raw)?;
        let text = ocr_text(&raw)?;
        if text.is_empty() {
            return Err("No text recognized. Try selecting a larger or clearer line.".to_string());
        }
        let matches = font_match::rank_fonts(
            &raw.bgra,
            raw.width as usize,
            raw.height as usize,
            &text,
            5,
        )?;
        Ok(FontDetection {
            image_base64,
            bounds,
            text,
            matches,
        })
    })
    .await
    .map_err(|e| e.to_string())?
}
