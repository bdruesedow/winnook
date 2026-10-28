use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{channel, Sender};
use std::sync::Mutex;
use std::thread;

use windows::Win32::System::Power::{
    SetThreadExecutionState, ES_CONTINUOUS, ES_DISPLAY_REQUIRED, ES_SYSTEM_REQUIRED,
};

/// SetThreadExecutionState is per-thread, so a dedicated thread owns the state.
pub struct PowerState {
    tx: Mutex<Sender<bool>>,
    active: AtomicBool,
}

impl PowerState {
    pub fn new() -> Self {
        let (tx, rx) = channel::<bool>();
        thread::Builder::new()
            .name("winnook-power".into())
            .spawn(move || {
                for enabled in rx {
                    unsafe {
                        if enabled {
                            SetThreadExecutionState(
                                ES_CONTINUOUS | ES_SYSTEM_REQUIRED | ES_DISPLAY_REQUIRED,
                            );
                        } else {
                            SetThreadExecutionState(ES_CONTINUOUS);
                        }
                    }
                }
                unsafe {
                    SetThreadExecutionState(ES_CONTINUOUS);
                }
            })
            .expect("failed to spawn power thread");
        Self {
            tx: Mutex::new(tx),
            active: AtomicBool::new(false),
        }
    }

    pub fn set_keep_awake(&self, enabled: bool) -> Result<(), String> {
        self.tx
            .lock()
            .map_err(|e| e.to_string())?
            .send(enabled)
            .map_err(|e| e.to_string())?;
        self.active.store(enabled, Ordering::SeqCst);
        Ok(())
    }

    pub fn is_keep_awake(&self) -> bool {
        self.active.load(Ordering::SeqCst)
    }
}

#[tauri::command]
pub fn set_keep_awake(state: tauri::State<'_, PowerState>, enabled: bool) -> Result<(), String> {
    state.set_keep_awake(enabled)
}

/// Presses F15 (no visible effect) so apps that watch user idle time, like Teams, stay "Available".
#[tauri::command]
pub fn simulate_activity() -> Result<(), String> {
    use windows::Win32::UI::Input::KeyboardAndMouse::{
        SendInput, INPUT, INPUT_0, INPUT_KEYBOARD, KEYBDINPUT, KEYEVENTF_KEYUP, VIRTUAL_KEY,
        VK_F15,
    };
    let key = |flags| INPUT {
        r#type: INPUT_KEYBOARD,
        Anonymous: INPUT_0 {
            ki: KEYBDINPUT {
                wVk: VIRTUAL_KEY(VK_F15.0),
                wScan: 0,
                dwFlags: flags,
                time: 0,
                dwExtraInfo: 0,
            },
        },
    };
    let inputs = [key(Default::default()), key(KEYEVENTF_KEYUP)];
    let sent = unsafe { SendInput(&inputs, std::mem::size_of::<INPUT>() as i32) };
    if sent == 2 {
        Ok(())
    } else {
        Err("SendInput failed".into())
    }
}

#[tauri::command]
pub fn is_keep_awake(state: tauri::State<'_, PowerState>) -> bool {
    state.is_keep_awake()
}
