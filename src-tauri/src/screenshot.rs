use std::path::PathBuf;
use std::sync::Mutex;

use base64::{engine::general_purpose::STANDARD, Engine as _};
use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder};

pub const EDITOR_LABEL: &str = "screenshot-editor";

/// The latest capture, handed to the editor window when it asks for it.
#[derive(Default)]
pub struct EditorState {
    image: Mutex<Option<String>>,
}

#[tauri::command]
pub async fn open_screenshot_editor(
    app: AppHandle,
    state: tauri::State<'_, EditorState>,
    image_base64: String,
) -> Result<(), String> {
    *state.image.lock().map_err(|e| e.to_string())? = Some(image_base64.clone());

    if let Some(window) = app.get_webview_window(EDITOR_LABEL) {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
        return app
            .emit_to(EDITOR_LABEL, "editor://new-image", image_base64)
            .map_err(|e| e.to_string());
    }

    WebviewWindowBuilder::new(&app, EDITOR_LABEL, WebviewUrl::App("index.html".into()))
        .title("WinNook Screenshot")
        .inner_size(1100.0, 720.0)
        .min_inner_size(640.0, 420.0)
        .center()
        .build()
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn get_editor_image(state: tauri::State<'_, EditorState>) -> Option<String> {
    state.image.lock().ok()?.clone()
}

/// Saves a PNG to Pictures\Screenshots and returns the file path.
#[tauri::command]
pub fn save_screenshot(image_base64: String) -> Result<String, String> {
    let bytes = STANDARD.decode(image_base64).map_err(|e| e.to_string())?;
    let profile = std::env::var("USERPROFILE").map_err(|e| e.to_string())?;
    let dir = PathBuf::from(profile).join("Pictures").join("Screenshots");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;

    let stamp = {
        use std::time::{SystemTime, UNIX_EPOCH};
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_millis())
            .unwrap_or(0)
    };
    let path = dir.join(format!("WinNook_{stamp}.png"));
    std::fs::write(&path, bytes).map_err(|e| e.to_string())?;
    Ok(path.to_string_lossy().into_owned())
}

/// Opens Explorer with the file selected.
#[tauri::command]
pub fn reveal_in_explorer(path: String) -> Result<(), String> {
    std::process::Command::new("explorer")
        .arg(format!("/select,{path}"))
        .spawn()
        .map_err(|e| e.to_string())?;
    Ok(())
}
