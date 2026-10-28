use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use base64::{engine::general_purpose::STANDARD, Engine as _};
use serde::Serialize;
use windows::Media::Control::{
    GlobalSystemMediaTransportControlsSession, GlobalSystemMediaTransportControlsSessionManager,
    GlobalSystemMediaTransportControlsSessionPlaybackStatus as PlaybackStatus,
};
use windows::Storage::Streams::DataReader;
use windows::Win32::System::WinRT::{RoInitialize, RO_INIT_MULTITHREADED};

const MAX_ART_BYTES: u32 = 8 * 1024 * 1024;
// 100ns ticks between 1601-01-01 (WinRT DateTime) and 1970-01-01.
const WINRT_UNIX_EPOCH_TICKS: i64 = 116_444_736_000_000_000;

#[derive(Serialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct MediaInfo {
    pub title: String,
    pub artist: String,
    pub album_art_base64: Option<String>,
    pub album_art_mime: Option<String>,
    /// Seconds, already extrapolated to "now" while playing.
    pub position: f64,
    pub duration: f64,
    pub is_playing: bool,
    pub source_app: String,
}

struct ArtCache {
    key: String,
    art: (String, String),
}

static ART_CACHE: Mutex<Option<ArtCache>> = Mutex::new(None);

pub fn init_winrt() {
    // Fails with RPC_E_CHANGED_MODE if the thread is already initialised; that's fine.
    unsafe {
        let _ = RoInitialize(RO_INIT_MULTITHREADED);
    }
}

fn current_session() -> Result<Option<GlobalSystemMediaTransportControlsSession>, String> {
    let manager = GlobalSystemMediaTransportControlsSessionManager::RequestAsync()
        .and_then(|op| op.get())
        .map_err(|e| e.to_string())?;
    Ok(manager.GetCurrentSession().ok())
}

fn read_art(session_props: &windows::Media::Control::GlobalSystemMediaTransportControlsSessionMediaProperties) -> Option<(String, String)> {
    let reference = session_props.Thumbnail().ok()?;
    let stream = reference.OpenReadAsync().ok()?.get().ok()?;
    let size = stream.Size().ok()? as u32;
    if size == 0 || size > MAX_ART_BYTES {
        return None;
    }
    let reader = DataReader::CreateDataReader(&stream).ok()?;
    reader.LoadAsync(size).ok()?.get().ok()?;
    let mut bytes = vec![0u8; size as usize];
    reader.ReadBytes(&mut bytes).ok()?;
    let mime = stream
        .ContentType()
        .map(|s| s.to_string())
        .unwrap_or_else(|_| "image/jpeg".into());
    Some((STANDARD.encode(bytes), mime))
}

fn fetch_info(session: &GlobalSystemMediaTransportControlsSession) -> Result<MediaInfo, String> {
    let props = session
        .TryGetMediaPropertiesAsync()
        .and_then(|op| op.get())
        .map_err(|e| e.to_string())?;
    let title = props.Title().map(|s| s.to_string()).unwrap_or_default();
    let artist = props.Artist().map(|s| s.to_string()).unwrap_or_default();
    let source_app = session
        .SourceAppUserModelId()
        .map(|s| s.to_string())
        .unwrap_or_default();

    let is_playing = session
        .GetPlaybackInfo()
        .and_then(|i| i.PlaybackStatus())
        .map(|s| s == PlaybackStatus::Playing)
        .unwrap_or(false);

    let (mut position, mut duration) = (0.0, 0.0);
    if let Ok(tl) = session.GetTimelineProperties() {
        let ticks = |d: windows::Foundation::TimeSpan| d.Duration as f64 / 10_000_000.0;
        let start = tl.StartTime().map(ticks).unwrap_or(0.0);
        let end = tl.EndTime().map(ticks).unwrap_or(0.0);
        duration = (end - start).max(0.0);
        position = (tl.Position().map(ticks).unwrap_or(0.0) - start).max(0.0);
        if is_playing {
            if let Ok(updated) = tl.LastUpdatedTime() {
                let now_ticks = SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .map(|d| (d.as_nanos() / 100) as i64)
                    .unwrap_or(0)
                    + WINRT_UNIX_EPOCH_TICKS;
                let elapsed = (now_ticks - updated.UniversalTime) as f64 / 10_000_000.0;
                if (0.0..3600.0).contains(&elapsed) {
                    position += elapsed;
                }
            }
        }
        if duration > 0.0 {
            position = position.min(duration);
        }
    }

    let key = format!("{source_app}|{title}|{artist}");
    let cached = ART_CACHE
        .lock()
        .ok()
        .and_then(|c| c.as_ref().filter(|a| a.key == key).map(|a| a.art.clone()));
    let art = cached.or_else(|| {
        let art = read_art(&props)?;
        if let Ok(mut cache) = ART_CACHE.lock() {
            *cache = Some(ArtCache {
                key: key.clone(),
                art: art.clone(),
            });
        }
        Some(art)
    });

    Ok(MediaInfo {
        title,
        artist,
        album_art_base64: art.as_ref().map(|a| a.0.clone()),
        album_art_mime: art.map(|a| a.1),
        position,
        duration,
        is_playing,
        source_app,
    })
}

/// Current media session, or `None` when nothing is registered with Windows.
#[tauri::command]
pub async fn media_get_session() -> Result<Option<MediaInfo>, String> {
    tauri::async_runtime::spawn_blocking(|| {
        init_winrt();
        match current_session()? {
            Some(session) => fetch_info(&session).map(Some),
            None => Ok(None),
        }
    })
    .await
    .map_err(|e| e.to_string())?
}

/// `action`: `playpause` | `next` | `prev`.
#[tauri::command]
pub async fn media_control(action: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        init_winrt();
        let Some(session) = current_session()? else {
            return Ok(());
        };
        let result = match action.as_str() {
            "playpause" => session.TryTogglePlayPauseAsync().and_then(|op| op.get()),
            "next" => session.TrySkipNextAsync().and_then(|op| op.get()),
            "prev" => session.TrySkipPreviousAsync().and_then(|op| op.get()),
            other => return Err(format!("unknown media action: {other}")),
        };
        result.map(|_| ()).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}
