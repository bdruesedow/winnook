use std::sync::Mutex;
use std::thread;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::{
    AppHandle, Emitter, Manager, Monitor, PhysicalPosition, PhysicalSize, WebviewWindow,
};
use windows::Win32::Foundation::POINT;
use windows::Win32::UI::WindowsAndMessaging::{
    GetCursorPos, SetWindowDisplayAffinity, WDA_EXCLUDEFROMCAPTURE,
};

pub const NOTCH_LABEL: &str = "main-notch";
pub const OVERLAY_LABEL: &str = "screen-overlay";

pub const NOTCH_WIDTH: f64 = 720.0;
pub const NOTCH_HEIGHT: f64 = 380.0;
const SIDE_MARGIN: f64 = 24.0;
const POLL_INTERVAL: Duration = Duration::from_millis(25);
const FOLLOW_CHECK_EVERY: u32 = 4;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum NotchPosition {
    Left,
    Center,
    Right,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum MonitorMode {
    Primary,
    Follow,
}

/// Visible area of the notch in logical px, relative to the window's top-left corner.
#[derive(Clone, Copy, Debug, Default, Serialize, Deserialize)]
pub struct HitRect {
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
}

#[derive(Clone, Copy, Default)]
struct Placement {
    origin_x: i32,
    origin_y: i32,
    scale: f64,
    monitor_x: i32,
    monitor_y: i32,
}

struct Inner {
    position: NotchPosition,
    monitor_mode: MonitorMode,
    hit_rect: HitRect,
    click_through: bool,
    placement: Placement,
    overlay: Placement,
    overlay_open: bool,
}

pub struct WindowState {
    inner: Mutex<Inner>,
}

impl Default for WindowState {
    fn default() -> Self {
        Self {
            inner: Mutex::new(Inner {
                position: NotchPosition::Center,
                monitor_mode: MonitorMode::Primary,
                hit_rect: HitRect {
                    x: (NOTCH_WIDTH - 140.0) / 2.0,
                    y: 0.0,
                    w: 140.0,
                    h: 34.0,
                },
                click_through: true,
                placement: Placement {
                    scale: 1.0,
                    ..Placement::default()
                },
                overlay: Placement {
                    scale: 1.0,
                    ..Placement::default()
                },
                overlay_open: false,
            }),
        }
    }
}

fn cursor_pos() -> Option<(i32, i32)> {
    let mut p = POINT::default();
    unsafe { GetCursorPos(&mut p).ok()? };
    Some((p.x, p.y))
}

fn monitor_contains(m: &Monitor, x: i32, y: i32) -> bool {
    let pos = m.position();
    let size = m.size();
    x >= pos.x && x < pos.x + size.width as i32 && y >= pos.y && y < pos.y + size.height as i32
}

fn monitor_at(app: &AppHandle, x: i32, y: i32) -> Option<Monitor> {
    app.available_monitors()
        .ok()?
        .into_iter()
        .find(|m| monitor_contains(m, x, y))
}

fn target_monitor(app: &AppHandle, mode: MonitorMode) -> Option<Monitor> {
    let primary = || {
        app.primary_monitor()
            .ok()
            .flatten()
            .or_else(|| app.available_monitors().ok()?.into_iter().next())
    };
    match mode {
        MonitorMode::Primary => primary(),
        MonitorMode::Follow => cursor_pos()
            .and_then(|(x, y)| monitor_at(app, x, y))
            .or_else(primary),
    }
}

fn notch_window(app: &AppHandle) -> Option<WebviewWindow> {
    app.get_webview_window(NOTCH_LABEL)
}

fn lock<'a>(state: &'a WindowState) -> std::sync::MutexGuard<'a, Inner> {
    state.inner.lock().unwrap_or_else(|e| e.into_inner())
}

/// Moves the notch window to the top edge of the target monitor.
pub fn apply_position(app: &AppHandle) -> Result<(), String> {
    let state = app.state::<WindowState>();
    let (position, mode) = {
        let inner = lock(&state);
        (inner.position, inner.monitor_mode)
    };
    let window = notch_window(app).ok_or("notch window missing")?;
    let monitor = target_monitor(app, mode).ok_or("no monitor found")?;

    let scale = monitor.scale_factor();
    let width = (NOTCH_WIDTH * scale).round() as i32;
    let height = (NOTCH_HEIGHT * scale).round() as i32;
    let mon_pos = monitor.position();
    let mon_w = monitor.size().width as i32;
    let margin = (SIDE_MARGIN * scale).round() as i32;

    let x = match position {
        NotchPosition::Left => mon_pos.x + margin,
        NotchPosition::Center => mon_pos.x + (mon_w - width) / 2,
        NotchPosition::Right => mon_pos.x + mon_w - width - margin,
    };
    let y = mon_pos.y;

    window
        .set_size(PhysicalSize::new(width as u32, height as u32))
        .map_err(|e| e.to_string())?;
    window
        .set_position(PhysicalPosition::new(x, y))
        .map_err(|e| e.to_string())?;

    lock(&state).placement = Placement {
        origin_x: x,
        origin_y: y,
        scale,
        monitor_x: mon_pos.x,
        monitor_y: mon_pos.y,
    };
    Ok(())
}

fn set_click_through(app: &AppHandle, enabled: bool) {
    if let Some(window) = notch_window(app) {
        let _ = window.set_ignore_cursor_events(enabled);
    }
}

fn cursor_inside(inner: &Inner, cx: i32, cy: i32) -> bool {
    let p = inner.placement;
    let r = inner.hit_rect;
    let left = p.origin_x as f64 + r.x * p.scale;
    let top = p.origin_y as f64 + r.y * p.scale;
    let right = left + r.w * p.scale;
    let bottom = top + r.h * p.scale;
    let (cx, cy) = (cx as f64, cy as f64);
    r.w > 0.0 && r.h > 0.0 && cx >= left && cx < right && cy >= top && cy < bottom
}

/// Background poller: toggles click-through based on the cursor position and
/// moves the notch between monitors in `Follow` mode.
pub fn start_cursor_poller(app: AppHandle) {
    thread::Builder::new()
        .name("winnook-cursor".into())
        .spawn(move || {
            let mut tick: u32 = 0;
            let mut last_pos: Option<(i32, i32)> = None;
            let mut last_emit = std::time::Instant::now();
            let mut last_move = std::time::Instant::now();
            loop {
                thread::sleep(POLL_INTERVAL);
                tick = tick.wrapping_add(1);
                let Some((cx, cy)) = cursor_pos() else { continue };
                let state = app.state::<WindowState>();

                // Lightweight cursor stream (~30 FPS, only while moving), relative to the notch window.
                if last_pos != Some((cx, cy)) {
                    let now = std::time::Instant::now();
                    let dt = now.duration_since(last_emit);
                    if dt >= Duration::from_millis(33) {
                        let (ox, oy, scale) = {
                            let inner = lock(&state);
                            (
                                inner.placement.origin_x,
                                inner.placement.origin_y,
                                inner.placement.scale.max(0.1),
                            )
                        };
                        let velocity = match last_pos {
                            Some((px, py)) => {
                                let d = (((cx - px).pow(2) + (cy - py).pow(2)) as f64).sqrt() / scale;
                                d / dt.as_secs_f64().max(0.001)
                            }
                            None => 0.0,
                        };
                        let _ = app.emit_to(
                            NOTCH_LABEL,
                            "notch://cursor-move",
                            serde_json::json!({
                                "x": (cx - ox) as f64 / scale,
                                "y": (cy - oy) as f64 / scale,
                                "velocity": velocity,
                                "idleSeconds": 0.0,
                            }),
                        );
                        last_pos = Some((cx, cy));
                        last_emit = now;
                    }
                    last_move = now;
                }
                let _ = last_move;

                let (inside, was_click_through, follow, overlay_open, monitor_origin) = {
                    let inner = lock(&state);
                    (
                        cursor_inside(&inner, cx, cy),
                        inner.click_through,
                        inner.monitor_mode == MonitorMode::Follow,
                        inner.overlay_open,
                        (inner.placement.monitor_x, inner.placement.monitor_y),
                    )
                };
                if overlay_open {
                    continue;
                }

                // Only relocate while the notch is idle, never under the cursor.
                if follow && was_click_through && !inside && tick % FOLLOW_CHECK_EVERY == 0 {
                    if let Some(m) = monitor_at(&app, cx, cy) {
                        let pos = m.position();
                        if (pos.x, pos.y) != monitor_origin {
                            let _ = apply_position(&app);
                            continue;
                        }
                    }
                }

                if inside && was_click_through {
                    lock(&state).click_through = false;
                    set_click_through(&app, false);
                    let _ = app.emit_to(NOTCH_LABEL, "notch://cursor-enter", ());
                } else if !inside && !was_click_through {
                    lock(&state).click_through = true;
                    set_click_through(&app, true);
                    let _ = app.emit_to(NOTCH_LABEL, "notch://cursor-leave", ());
                }
            }
        })
        .expect("failed to spawn cursor poller");
}

/// Excludes the overlay from screen capture so region grabs never contain the overlay itself.
pub fn init_windows(app: &AppHandle) -> Result<(), String> {
    if let Some(overlay) = app.get_webview_window(OVERLAY_LABEL) {
        if let Ok(hwnd) = overlay.hwnd() {
            // Tauri may link a different `windows` version, so rebuild the handle from its raw pointer.
            let hwnd = windows::Win32::Foundation::HWND(hwnd.0 as *mut _);
            unsafe {
                let _ = SetWindowDisplayAffinity(hwnd, WDA_EXCLUDEFROMCAPTURE);
            }
        }
    }
    set_click_through(app, true);
    apply_position(app)
}

/// Physical bounds (x, y, w, h) of the monitor under the cursor.
pub fn cursor_monitor_bounds(app: &AppHandle) -> Option<(i32, i32, u32, u32)> {
    let monitor = cursor_pos()
        .and_then(|(x, y)| monitor_at(app, x, y))
        .or_else(|| app.primary_monitor().ok().flatten())?;
    let (p, s) = (monitor.position(), monitor.size());
    Some((p.x, p.y, s.width, s.height))
}

/// Runs `f` with the notch window excluded from screen capture, so it never shows up in screenshots.
pub fn with_notch_hidden<T>(app: &AppHandle, f: impl FnOnce() -> T) -> T {
    use windows::Win32::UI::WindowsAndMessaging::WDA_NONE;
    let hwnd = notch_window(app)
        .and_then(|w| w.hwnd().ok())
        .map(|h| windows::Win32::Foundation::HWND(h.0 as *mut _));
    if let Some(hwnd) = hwnd {
        unsafe {
            let _ = SetWindowDisplayAffinity(hwnd, WDA_EXCLUDEFROMCAPTURE);
        }
        thread::sleep(Duration::from_millis(80));
    }
    let out = f();
    if let Some(hwnd) = hwnd {
        unsafe {
            let _ = SetWindowDisplayAffinity(hwnd, WDA_NONE);
        }
    }
    out
}

pub fn overlay_origin(app: &AppHandle) -> (i32, i32, f64) {
    let state = app.state::<WindowState>();
    let inner = lock(&state);
    (
        inner.overlay.origin_x,
        inner.overlay.origin_y,
        inner.overlay.scale,
    )
}

#[derive(Deserialize)]
pub struct OverlayRequest {
    pub mode: String,
    pub prompt: Option<String>,
}

#[derive(Serialize, Clone)]
struct OverlayActivate {
    mode: String,
    prompt: Option<String>,
}

#[tauri::command]
pub fn set_notch_position(app: AppHandle, position: NotchPosition) -> Result<(), String> {
    lock(&app.state::<WindowState>()).position = position;
    apply_position(&app)
}

#[tauri::command]
pub fn set_monitor_mode(app: AppHandle, mode: MonitorMode) -> Result<(), String> {
    lock(&app.state::<WindowState>()).monitor_mode = mode;
    apply_position(&app)
}

#[tauri::command]
pub fn set_hit_rect(app: AppHandle, rect: HitRect) {
    lock(&app.state::<WindowState>()).hit_rect = rect;
}

#[tauri::command]
pub fn set_always_on_top(app: AppHandle, enabled: bool) -> Result<(), String> {
    let window = notch_window(&app).ok_or("notch window missing")?;
    window.set_always_on_top(enabled).map_err(|e| e.to_string())
}

/// Covers the monitor under the cursor with the transparent overlay window.
#[tauri::command]
pub fn open_overlay(app: AppHandle, request: OverlayRequest) -> Result<(), String> {
    let overlay = app
        .get_webview_window(OVERLAY_LABEL)
        .ok_or("overlay window missing")?;
    let monitor = cursor_pos()
        .and_then(|(x, y)| monitor_at(&app, x, y))
        .or_else(|| app.primary_monitor().ok().flatten())
        .ok_or("no monitor found")?;

    let pos = *monitor.position();
    let size = *monitor.size();
    overlay.set_position(pos).map_err(|e| e.to_string())?;
    overlay.set_size(size).map_err(|e| e.to_string())?;
    overlay
        .set_ignore_cursor_events(false)
        .map_err(|e| e.to_string())?;
    overlay.set_always_on_top(true).map_err(|e| e.to_string())?;

    {
        let state = app.state::<WindowState>();
        let mut inner = lock(&state);
        inner.overlay = Placement {
            origin_x: pos.x,
            origin_y: pos.y,
            scale: monitor.scale_factor(),
            monitor_x: pos.x,
            monitor_y: pos.y,
        };
        inner.overlay_open = true;
    }

    overlay.show().map_err(|e| e.to_string())?;
    let _ = overlay.set_focus();
    app.emit_to(
        OVERLAY_LABEL,
        "overlay://activate",
        OverlayActivate {
            mode: request.mode.clone(),
            prompt: request.prompt.clone(),
        },
    )
    .map_err(|e| e.to_string())?;
    let _ = app.emit_to(
        NOTCH_LABEL,
        "overlay://opened",
        OverlayActivate {
            mode: request.mode,
            prompt: request.prompt,
        },
    );
    Ok(())
}

#[tauri::command]
pub fn close_overlay(app: AppHandle) -> Result<(), String> {
    if let Some(overlay) = app.get_webview_window(OVERLAY_LABEL) {
        overlay.hide().map_err(|e| e.to_string())?;
    }
    lock(&app.state::<WindowState>()).overlay_open = false;
    let _ = app.emit("overlay://closed", ());
    Ok(())
}
