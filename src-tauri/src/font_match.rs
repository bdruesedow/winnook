//! Heuristic font matching: renders the OCR'd text in every installed font via GDI and
//! compares the resulting ink shape with the captured pixels.

use std::collections::HashSet;
use std::mem::size_of;

use serde::Serialize;
use windows::core::PCWSTR;
use windows::Win32::Foundation::{LPARAM, SIZE};
use windows::Win32::Graphics::Gdi::{
    CreateCompatibleDC, CreateDIBSection, CreateFontW, DeleteDC, DeleteObject,
    EnumFontFamiliesExW, GdiFlush, GetTextExtentPoint32W, SelectObject, SetBkMode, SetTextColor,
    TextOutW, BITMAPINFO, BITMAPINFOHEADER, BI_RGB, CLIP_DEFAULT_PRECIS, DEFAULT_CHARSET,
    DEFAULT_PITCH, DIB_RGB_COLORS, FF_DONTCARE, FONT_CHARSET, HDC, HGDIOBJ, LOGFONTW,
    OUT_TT_PRECIS, TEXTMETRICW, TRANSPARENT, ANTIALIASED_QUALITY,
};

const GRID_W: usize = 96;
const GRID_H: usize = 24;
const RENDER_PX: i32 = 48;
const SYMBOL_CHARSET: u8 = 2;
const TRUETYPE_FONTTYPE: u32 = 4;
const MAX_TEXT_CHARS: usize = 48;

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct FontMatch {
    pub name: String,
    pub family: String,
    pub bold: bool,
    /// 0..=100
    pub score: u32,
}

struct Features {
    grid: Vec<f32>,
    aspect: f32,
}

fn otsu_threshold(gray: &[u8]) -> u8 {
    let mut hist = [0f64; 256];
    for &g in gray {
        hist[g as usize] += 1.0;
    }
    let total = gray.len() as f64;
    let sum_all: f64 = hist.iter().enumerate().map(|(i, c)| i as f64 * c).sum();
    let (mut sum_b, mut w_b, mut best, mut threshold) = (0.0, 0.0, 0.0, 128u8);
    for (t, &count) in hist.iter().enumerate() {
        w_b += count;
        if w_b == 0.0 {
            continue;
        }
        let w_f = total - w_b;
        if w_f == 0.0 {
            break;
        }
        sum_b += t as f64 * count;
        let (m_b, m_f) = (sum_b / w_b, (sum_all - sum_b) / w_f);
        let between = w_b * w_f * (m_b - m_f) * (m_b - m_f);
        if between > best {
            best = between;
            threshold = t as u8;
        }
    }
    threshold
}

/// Binary ink map (1.0 = text) from BGRA pixels; the minority colour is treated as ink.
fn ink_from_bgra(bgra: &[u8]) -> Vec<f32> {
    let gray: Vec<u8> = bgra
        .chunks_exact(4)
        .map(|p| (0.114 * p[0] as f32 + 0.587 * p[1] as f32 + 0.299 * p[2] as f32) as u8)
        .collect();
    let threshold = otsu_threshold(&gray);
    let dark = gray.iter().filter(|&&g| g <= threshold).count();
    let dark_is_ink = dark * 2 <= gray.len();
    gray.iter()
        .map(|&g| {
            let is_dark = g <= threshold;
            if is_dark == dark_is_ink {
                1.0
            } else {
                0.0
            }
        })
        .collect()
}

fn resize_area(src: &[f32], sw: usize, sh: usize, tw: usize, th: usize) -> Vec<f32> {
    let mut out = vec![0f32; tw * th];
    for ty in 0..th {
        let y0 = ty * sh / th;
        let y1 = ((ty + 1) * sh / th).max(y0 + 1).min(sh);
        for tx in 0..tw {
            let x0 = tx * sw / tw;
            let x1 = ((tx + 1) * sw / tw).max(x0 + 1).min(sw);
            let mut sum = 0.0;
            for y in y0..y1 {
                for x in x0..x1 {
                    sum += src[y * sw + x];
                }
            }
            out[ty * tw + tx] = sum / ((y1 - y0) * (x1 - x0)) as f32;
        }
    }
    out
}

fn box_blur(src: &[f32], w: usize, h: usize) -> Vec<f32> {
    let mut out = vec![0f32; w * h];
    for y in 0..h {
        for x in 0..w {
            let mut sum = 0.0;
            let mut n = 0.0;
            for dy in -1i32..=1 {
                for dx in -1i32..=1 {
                    let (nx, ny) = (x as i32 + dx, y as i32 + dy);
                    if nx >= 0 && ny >= 0 && (nx as usize) < w && (ny as usize) < h {
                        sum += src[ny as usize * w + nx as usize];
                        n += 1.0;
                    }
                }
            }
            out[y * w + x] = sum / n;
        }
    }
    out
}

fn features(ink: &[f32], w: usize, h: usize) -> Option<Features> {
    let (mut min_x, mut min_y, mut max_x, mut max_y) = (w, h, 0usize, 0usize);
    for y in 0..h {
        for x in 0..w {
            if ink[y * w + x] > 0.35 {
                min_x = min_x.min(x);
                max_x = max_x.max(x);
                min_y = min_y.min(y);
                max_y = max_y.max(y);
            }
        }
    }
    if min_x > max_x || min_y > max_y {
        return None;
    }
    let (bw, bh) = (max_x - min_x + 1, max_y - min_y + 1);
    if bw < 4 || bh < 4 {
        return None;
    }
    let mut cropped = Vec::with_capacity(bw * bh);
    for y in min_y..=max_y {
        cropped.extend_from_slice(&ink[y * w + min_x..y * w + max_x + 1]);
    }
    let grid = box_blur(&resize_area(&cropped, bw, bh, GRID_W, GRID_H), GRID_W, GRID_H);
    Some(Features {
        grid,
        aspect: bw as f32 / bh as f32,
    })
}

fn similarity(a: &Features, b: &Features) -> f32 {
    let (mut dot, mut na, mut nb) = (0f32, 0f32, 0f32);
    for (x, y) in a.grid.iter().zip(&b.grid) {
        dot += x * y;
        na += x * x;
        nb += y * y;
    }
    if na == 0.0 || nb == 0.0 {
        return 0.0;
    }
    let shape = dot / (na.sqrt() * nb.sqrt());
    let aspect = a.aspect.min(b.aspect) / a.aspect.max(b.aspect);
    0.7 * shape + 0.3 * aspect
}

fn wide(s: &str) -> Vec<u16> {
    s.encode_utf16().chain(std::iter::once(0)).collect()
}

unsafe extern "system" fn enum_proc(
    lf: *const LOGFONTW,
    _tm: *const TEXTMETRICW,
    font_type: u32,
    lparam: LPARAM,
) -> i32 {
    let list = &mut *(lparam.0 as *mut Vec<String>);
    let lf = &*lf;
    if lf.lfCharSet.0 == SYMBOL_CHARSET || font_type & TRUETYPE_FONTTYPE == 0 {
        return 1;
    }
    let len = lf.lfFaceName.iter().position(|&c| c == 0).unwrap_or(32);
    let name = String::from_utf16_lossy(&lf.lfFaceName[..len]);
    if !name.is_empty() && !name.starts_with('@') {
        list.push(name);
    }
    1
}

fn installed_families(hdc: HDC) -> Vec<String> {
    let mut list: Vec<String> = Vec::new();
    let mut lf = LOGFONTW::default();
    lf.lfCharSet = DEFAULT_CHARSET;
    unsafe {
        EnumFontFamiliesExW(
            hdc,
            &lf,
            Some(enum_proc),
            LPARAM(&mut list as *mut Vec<String> as isize),
            0,
        );
    }
    let mut seen = HashSet::new();
    list.retain(|n| seen.insert(n.clone()));
    list.sort();
    list
}

/// Renders `text` in the given font and returns the ink map plus its dimensions.
unsafe fn render_ink(hdc: HDC, family: &str, bold: bool, text: &[u16]) -> Option<(Vec<f32>, usize, usize)> {
    let face = wide(family);
    let font = CreateFontW(
        -RENDER_PX,
        0,
        0,
        0,
        if bold { 700 } else { 400 },
        0,
        0,
        0,
        FONT_CHARSET(DEFAULT_CHARSET.0),
        OUT_TT_PRECIS,
        CLIP_DEFAULT_PRECIS,
        ANTIALIASED_QUALITY,
        (DEFAULT_PITCH.0 | FF_DONTCARE.0) as u32,
        PCWSTR(face.as_ptr()),
    );
    if font.is_invalid() {
        return None;
    }
    let old_font = SelectObject(hdc, HGDIOBJ(font.0));

    let mut size = SIZE::default();
    let measured = GetTextExtentPoint32W(hdc, text, &mut size).as_bool();
    let (pad, w, h) = (8i32, size.cx + 16, size.cy + 16);
    let result = if measured && w > 16 && h > 16 && w < 8192 {
        let bmi = BITMAPINFO {
            bmiHeader: BITMAPINFOHEADER {
                biSize: size_of::<BITMAPINFOHEADER>() as u32,
                biWidth: w,
                biHeight: -h,
                biPlanes: 1,
                biBitCount: 32,
                biCompression: BI_RGB.0,
                ..Default::default()
            },
            ..Default::default()
        };
        let mut bits: *mut std::ffi::c_void = std::ptr::null_mut();
        match CreateDIBSection(Some(hdc), &bmi, DIB_RGB_COLORS, &mut bits, None, 0) {
            Ok(bitmap) if !bits.is_null() => {
                let old_bitmap = SelectObject(hdc, HGDIOBJ(bitmap.0));
                let pixels = std::slice::from_raw_parts_mut(bits as *mut u8, (w * h * 4) as usize);
                pixels.fill(0xFF);
                SetBkMode(hdc, TRANSPARENT);
                SetTextColor(hdc, windows::Win32::Foundation::COLORREF(0));
                let _ = TextOutW(hdc, pad, pad, text);
                let _ = GdiFlush();
                let ink: Vec<f32> = pixels
                    .chunks_exact(4)
                    .map(|p| 1.0 - p[0] as f32 / 255.0)
                    .collect();
                SelectObject(hdc, old_bitmap);
                let _ = DeleteObject(HGDIOBJ(bitmap.0));
                Some((ink, w as usize, h as usize))
            }
            _ => None,
        }
    } else {
        None
    };

    SelectObject(hdc, old_font);
    let _ = DeleteObject(HGDIOBJ(font.0));
    result
}

pub fn rank_fonts(
    bgra: &[u8],
    w: usize,
    h: usize,
    text: &str,
    top: usize,
) -> Result<Vec<FontMatch>, String> {
    let captured_ink = ink_from_bgra(bgra);
    let target = features(&captured_ink, w, h).ok_or("no text pixels found in selection")?;

    let text: String = text
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .chars()
        .take(MAX_TEXT_CHARS)
        .collect();
    if text.is_empty() {
        return Err("no text recognized".into());
    }
    let text_w: Vec<u16> = text.encode_utf16().collect();

    let mut matches = Vec::new();
    unsafe {
        let hdc = CreateCompatibleDC(None);
        if hdc.is_invalid() {
            return Err("cannot create GDI device context".into());
        }
        for family in installed_families(hdc) {
            for bold in [false, true] {
                let Some((ink, iw, ih)) = render_ink(hdc, &family, bold, &text_w) else {
                    continue;
                };
                let Some(candidate) = features(&ink, iw, ih) else {
                    continue;
                };
                let score = similarity(&target, &candidate).clamp(0.0, 1.0);
                matches.push((family.clone(), bold, score));
            }
        }
        let _ = DeleteDC(hdc);
    }

    matches.sort_by(|a, b| b.2.partial_cmp(&a.2).unwrap_or(std::cmp::Ordering::Equal));

    // Regular and bold of the same family look alike; keep only the better one per family.
    let mut seen = HashSet::new();
    Ok(matches
        .into_iter()
        .filter(|(family, _, _)| seen.insert(family.clone()))
        .take(top)
        .map(|(family, bold, score)| FontMatch {
            name: if bold && !family.to_lowercase().contains("bold") {
                format!("{family} Bold")
            } else {
                family.clone()
            },
            family,
            bold,
            score: (score.powi(3) * 100.0).round() as u32,
        })
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn finds_rendered_font_among_top_matches() {
        let text: Vec<u16> = "Hamburgefonstiv Quick".encode_utf16().collect();
        for (family, bold) in [("Georgia", true), ("Arial", false), ("Consolas", false)] {
            let (ink, w, h) = unsafe {
                let hdc = CreateCompatibleDC(None);
                let r = render_ink(hdc, family, bold, &text).expect("render");
                let _ = DeleteDC(hdc);
                r
            };
            let bgra: Vec<u8> = ink
                .iter()
                .flat_map(|i| {
                    let v = (255.0 * (1.0 - i)) as u8;
                    [v, v, v, 255]
                })
                .collect();
            let ranked = rank_fonts(&bgra, w, h, "Hamburgefonstiv Quick", 5).unwrap();
            println!("{family}: {:?}", ranked.iter().map(|m| (&m.name, m.score)).collect::<Vec<_>>());
            assert!(ranked.iter().any(|m| m.family == family), "{family} not in top 5");
        }
    }
}
