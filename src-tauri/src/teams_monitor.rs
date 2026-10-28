//! Local Teams detection: unread toast notifications + active call via Core Audio sessions.
//! Nothing leaves the machine; only counts and flags are exposed.

use std::collections::HashSet;
use std::sync::Mutex;
use std::thread;
use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, Emitter};
use windows::core::{Interface, BOOL, PWSTR};
use windows::Win32::Foundation::{CloseHandle, HWND, LPARAM, MAX_PATH};
use windows::Win32::Media::Audio::{
    eCapture, eCommunications, eRender, AudioSessionStateActive, IAudioSessionControl2,
    IAudioSessionManager2, IMMDeviceEnumerator, MMDeviceEnumerator,
};
use windows::Win32::System::Com::{CoCreateInstance, CLSCTX_ALL};
use windows::Win32::System::Threading::{
    OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_WIN32, PROCESS_QUERY_LIMITED_INFORMATION,
};
use windows::Win32::System::WinRT::{RoInitialize, RO_INIT_MULTITHREADED};
use windows::Win32::UI::WindowsAndMessaging::{
    EnumWindows, GetForegroundWindow, GetWindow, GetWindowTextLengthW, GetWindowThreadProcessId,
    IsIconic, IsWindowVisible, SetForegroundWindow, ShowWindow, GW_OWNER, SW_RESTORE,
};
use windows::UI::Notifications::Management::{UserNotificationListener, UserNotificationListenerAccessStatus};
use windows::UI::Notifications::NotificationKinds;

const POLL: Duration = Duration::from_secs(2);
const TEAMS_PROCS: [&str; 2] = ["ms-teams.exe", "teams.exe"];
const CALL_PROCS: [&str; 5] = ["ms-teams.exe", "teams.exe", "zoom.exe", "discord.exe", "webex.exe"];

#[derive(Serialize, Clone, Copy, Default, PartialEq, Eq, Debug)]
#[serde(rename_all = "camelCase")]
pub struct TeamsStatus {
    pub unread_count: u32,
    pub is_in_call: bool,
    pub is_mic_active: bool,
}

#[derive(Default)]
struct Shared {
    status: TeamsStatus,
    /// Toast ids already seen while Teams was in the foreground (or after a click).
    seen: HashSet<u32>,
    current: HashSet<u32>,
}

static SHARED: Mutex<Option<Shared>> = Mutex::new(None);

fn with_shared<R>(f: impl FnOnce(&mut Shared) -> R) -> R {
    let mut guard = SHARED.lock().unwrap_or_else(|e| e.into_inner());
    f(guard.get_or_insert_with(Shared::default))
}

fn process_name(pid: u32) -> Option<String> {
    unsafe {
        let h = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid).ok()?;
        let mut buf = [0u16; MAX_PATH as usize];
        let mut len = buf.len() as u32;
        let ok = QueryFullProcessImageNameW(h, PROCESS_NAME_WIN32, PWSTR(buf.as_mut_ptr()), &mut len);
        let _ = CloseHandle(h);
        ok.ok()?;
        let path = String::from_utf16_lossy(&buf[..len as usize]);
        path.rsplit('\\').next().map(|s| s.to_lowercase())
    }
}

fn window_process(hwnd: HWND) -> Option<String> {
    let mut pid = 0u32;
    unsafe { GetWindowThreadProcessId(hwnd, Some(&mut pid)) };
    if pid == 0 {
        return None;
    }
    process_name(pid)
}

fn teams_in_foreground() -> bool {
    let hwnd = unsafe { GetForegroundWindow() };
    if hwnd.0.is_null() {
        return false;
    }
    window_process(hwnd).is_some_and(|n| TEAMS_PROCS.contains(&n.as_str()))
}

/// Returns (call-app has an active render session, call-app has an active capture session).
fn audio_activity() -> (bool, bool) {
    let check = |flow| -> windows::core::Result<bool> {
        unsafe {
            let enumerator: IMMDeviceEnumerator = CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL)?;
            let device = enumerator.GetDefaultAudioEndpoint(flow, eCommunications)?;
            let mgr: IAudioSessionManager2 = device.Activate(CLSCTX_ALL, None)?;
            let sessions = mgr.GetSessionEnumerator()?;
            for i in 0..sessions.GetCount()? {
                let Ok(ctl) = sessions.GetSession(i)?.cast::<IAudioSessionControl2>() else { continue };
                if ctl.GetState()? != AudioSessionStateActive {
                    continue;
                }
                let pid = ctl.GetProcessId().unwrap_or(0);
                if pid != 0 && process_name(pid).is_some_and(|n| CALL_PROCS.contains(&n.as_str())) {
                    return Ok(true);
                }
            }
            Ok(false)
        }
    };
    (check(eRender).unwrap_or(false), check(eCapture).unwrap_or(false))
}

fn read_teams_toasts(listener: &UserNotificationListener) -> Option<HashSet<u32>> {
    let list = listener.GetNotificationsAsync(NotificationKinds::Toast).ok()?.get().ok()?;
    let mut ids = HashSet::new();
    for n in list {
        let Ok(info) = n.AppInfo() else { continue };
        let aumid = info.AppUserModelId().map(|s| s.to_string()).unwrap_or_default();
        let name = info
            .DisplayInfo()
            .and_then(|d| d.DisplayName())
            .map(|s| s.to_string())
            .unwrap_or_default();
        let hay = format!("{name} {aumid}").to_lowercase();
        if hay.contains("teams") {
            ids.insert(n.Id().unwrap_or(0));
        }
    }
    Some(ids)
}

fn publish(app: &AppHandle, last: &mut Option<TeamsStatus>) {
    let now = with_shared(|s| s.status);
    if *last != Some(now) {
        *last = Some(now);
        let _ = app.emit("system://teams-status", now);
    }
}

pub fn start(app: AppHandle) {
    thread::Builder::new()
        .name("winnook-teams".into())
        .spawn(move || {
            unsafe {
                let _ = RoInitialize(RO_INIT_MULTITHREADED);
            }
            let listener = UserNotificationListener::Current().ok();
            let allowed = listener
                .as_ref()
                .and_then(|l| l.RequestAccessAsync().ok())
                .and_then(|op| op.get().ok())
                .is_some_and(|s| s == UserNotificationListenerAccessStatus::Allowed);
            let mut last: Option<TeamsStatus> = None;
            let mut call_streak = 0u8;
            let mut first_read = true;

            loop {
                if allowed {
                    if let Some(ids) = listener.as_ref().and_then(read_teams_toasts) {
                        let foreground = teams_in_foreground();
                        with_shared(|s| {
                            s.current = ids;
                            // Toasts already in the Action Center at startup are old news.
                            if foreground || first_read {
                                s.seen = s.current.clone();
                            }
                            s.seen.retain(|id| s.current.contains(id));
                            s.status.unread_count = s.current.difference(&s.seen).count() as u32;
                        });
                        first_read = false;
                    }
                }

                let (render, capture) = audio_activity();
                // Require two consecutive hits so short notification sounds don't count as a call.
                call_streak = if render || capture { call_streak.saturating_add(1).min(2) } else { 0 };
                with_shared(|s| {
                    s.status.is_in_call = call_streak >= 2 || capture;
                    s.status.is_mic_active = capture;
                });

                publish(&app, &mut last);
                thread::sleep(POLL);
            }
        })
        .expect("failed to spawn teams monitor");
}

#[tauri::command]
pub fn get_teams_status() -> TeamsStatus {
    with_shared(|s| s.status)
}

#[tauri::command]
pub fn clear_teams_unread(app: AppHandle) {
    with_shared(|s| {
        s.seen = s.current.clone();
        s.status.unread_count = 0;
    });
    let _ = app.emit("system://teams-status", with_shared(|s| s.status));
}

unsafe extern "system" fn find_teams(hwnd: HWND, lparam: LPARAM) -> BOOL {
    let out = &mut *(lparam.0 as *mut Option<HWND>);
    if IsWindowVisible(hwnd).as_bool()
        && GetWindowTextLengthW(hwnd) > 0
        && GetWindow(hwnd, GW_OWNER).map(|w| w.0.is_null()).unwrap_or(true)
        && window_process(hwnd).is_some_and(|n| TEAMS_PROCS.contains(&n.as_str()))
    {
        *out = Some(hwnd);
        return BOOL(0);
    }
    BOOL(1)
}

#[tauri::command]
pub fn focus_teams_window(app: AppHandle) -> Result<(), String> {
    let mut found: Option<HWND> = None;
    unsafe {
        let _ = EnumWindows(Some(find_teams), LPARAM(&mut found as *mut _ as isize));
    }
    let hwnd = found.ok_or("Teams window not found")?;
    unsafe {
        if IsIconic(hwnd).as_bool() {
            let _ = ShowWindow(hwnd, SW_RESTORE);
        }
        let _ = SetForegroundWindow(hwnd);
    }
    clear_teams_unread(app);
    Ok(())
}
