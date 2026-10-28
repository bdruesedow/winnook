use std::path::PathBuf;

use winreg::enums::HKEY_CURRENT_USER;
use winreg::RegKey;

const DEFAULT_ACCENT: &str = "#7C3AED";

fn hkcu() -> RegKey {
    RegKey::predef(HKEY_CURRENT_USER)
}

/// Windows accent color as `#RRGGBB`.
#[tauri::command]
pub fn get_windows_accent() -> String {
    hkcu()
        .open_subkey("Software\\Microsoft\\Windows\\DWM")
        .and_then(|k| k.get_value::<u32, _>("AccentColor"))
        .map(|abgr| {
            let r = abgr & 0xFF;
            let g = (abgr >> 8) & 0xFF;
            let b = (abgr >> 16) & 0xFF;
            format!("#{:02X}{:02X}{:02X}", r, g, b)
        })
        .unwrap_or_else(|_| DEFAULT_ACCENT.to_string())
}

/// True when Windows apps use the dark theme.
#[tauri::command]
pub fn is_system_dark() -> bool {
    hkcu()
        .open_subkey("Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize")
        .and_then(|k| k.get_value::<u32, _>("AppsUseLightTheme"))
        .map(|v| v == 0)
        .unwrap_or(true)
}

fn wallpaper_path() -> Option<PathBuf> {
    let configured: String = hkcu()
        .open_subkey("Control Panel\\Desktop")
        .ok()?
        .get_value("WallPaper")
        .ok()?;
    if !configured.is_empty() && PathBuf::from(&configured).exists() {
        return Some(PathBuf::from(configured));
    }
    let transcoded = PathBuf::from(std::env::var("APPDATA").ok()?)
        .join("Microsoft\\Windows\\Themes\\TranscodedWallpaper");
    transcoded.exists().then_some(transcoded)
}

/// Dominant (most saturated, frequent) wallpaper color as `#RRGGBB`.
#[tauri::command]
pub fn get_wallpaper_color() -> String {
    dominant_color().unwrap_or_else(|| DEFAULT_ACCENT.to_string())
}

fn dominant_color() -> Option<String> {
    let path = wallpaper_path()?;
    let img = image::ImageReader::open(path)
        .ok()?
        .with_guessed_format()
        .ok()?
        .decode()
        .ok()?;
    let small = img.thumbnail(64, 64).to_rgb8();

    // 4-bit-per-channel histogram weighted by saturation, so grey backgrounds don't win.
    let mut buckets = std::collections::HashMap::<(u8, u8, u8), (f64, [f64; 3])>::new();
    for p in small.pixels() {
        let [r, g, b] = p.0;
        let max = r.max(g).max(b) as f64;
        let min = r.min(g).min(b) as f64;
        let sat = if max == 0.0 { 0.0 } else { (max - min) / max };
        let weight = 0.1 + sat;
        let key = (r >> 4, g >> 4, b >> 4);
        let entry = buckets.entry(key).or_insert((0.0, [0.0; 3]));
        entry.0 += weight;
        entry.1[0] += r as f64 * weight;
        entry.1[1] += g as f64 * weight;
        entry.1[2] += b as f64 * weight;
    }
    let (_, (weight, sums)) = buckets
        .into_iter()
        .max_by(|a, b| a.1 .0.partial_cmp(&b.1 .0).unwrap_or(std::cmp::Ordering::Equal))?;
    Some(format!(
        "#{:02X}{:02X}{:02X}",
        (sums[0] / weight) as u8,
        (sums[1] / weight) as u8,
        (sums[2] / weight) as u8
    ))
}
