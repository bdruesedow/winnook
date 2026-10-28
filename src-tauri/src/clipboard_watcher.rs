use std::thread;
use std::time::Duration;

use tauri::{AppHandle, Emitter};
use tauri_plugin_clipboard_manager::ClipboardExt;
use windows::Win32::System::DataExchange::GetClipboardSequenceNumber;

/// Polls the clipboard sequence number and emits `clipboard://changed` with the new text.
pub fn start(app: AppHandle) {
    thread::Builder::new()
        .name("winnook-clipboard".into())
        .spawn(move || {
            let mut last_seq = unsafe { GetClipboardSequenceNumber() };
            let mut retries = 0;
            loop {
                thread::sleep(Duration::from_millis(300));
                let seq = unsafe { GetClipboardSequenceNumber() };
                if seq == last_seq {
                    continue;
                }
                match app.clipboard().read_text() {
                    Ok(text) => {
                        last_seq = seq;
                        retries = 0;
                        if !text.is_empty() {
                            let _ = app.emit("clipboard://changed", text);
                        }
                    }
                    Err(_) => {
                        // Clipboard may be locked by another process, or hold non-text data.
                        retries += 1;
                        if retries >= 5 {
                            last_seq = seq;
                            retries = 0;
                        }
                    }
                }
            }
        })
        .expect("failed to spawn clipboard watcher");
}
