use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::mpsc::{channel, RecvTimeoutError};
use std::sync::Mutex;
use std::thread;
use std::time::Duration;

use notify::{Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};

const IGNORED_SEGMENTS: [&str; 3] = ["node_modules", ".git", ".vite"];

#[derive(Default)]
pub struct PluginWatcherState {
    watcher: Mutex<Option<RecommendedWatcher>>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ExternalPlugin {
    pub root: String,
    pub folder: String,
    pub manifest: Option<serde_json::Value>,
    pub error: Option<String>,
    pub has_entry: bool,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct FileChanged {
    root: String,
    folder: String,
    path: String,
    kind: &'static str,
}

fn user_plugins_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .data_dir()
        .map_err(|e| e.to_string())?
        .join("WinNook")
        .join("plugins");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

fn root_dir(app: &AppHandle, root: &str, dev_dir: &Option<String>) -> Result<PathBuf, String> {
    match root {
        "user" => user_plugins_dir(app),
        "dev" => dev_dir
            .as_ref()
            .filter(|d| !d.trim().is_empty())
            .map(PathBuf::from)
            .ok_or_else(|| "no dev plugin directory configured".to_string()),
        other => Err(format!("unknown plugin root: {other}")),
    }
}

fn is_safe_folder_name(name: &str) -> bool {
    !name.is_empty()
        && name != "."
        && name != ".."
        && !name.contains(['/', '\\', ':'])
}

fn scan_root(root_name: &str, dir: &Path) -> Vec<ExternalPlugin> {
    let Ok(entries) = fs::read_dir(dir) else {
        return vec![];
    };
    let mut plugins: Vec<ExternalPlugin> = entries
        .flatten()
        .filter(|e| e.path().is_dir())
        .filter_map(|e| {
            let folder = e.file_name().to_string_lossy().to_string();
            if IGNORED_SEGMENTS.contains(&folder.as_str()) || folder.starts_with('.') {
                return None;
            }
            let manifest_path = e.path().join("manifest.json");
            let (manifest, error) = match fs::read_to_string(&manifest_path) {
                Ok(text) => match serde_json::from_str::<serde_json::Value>(&text) {
                    Ok(v) => (Some(v), None),
                    Err(err) => (None, Some(format!("invalid manifest.json: {err}"))),
                },
                Err(err) => (None, Some(format!("cannot read manifest.json: {err}"))),
            };
            Some(ExternalPlugin {
                root: root_name.to_string(),
                folder,
                manifest,
                error,
                has_entry: e.path().join("index.js").is_file(),
            })
        })
        .collect();
    plugins.sort_by(|a, b| a.folder.cmp(&b.folder));
    plugins
}

#[tauri::command]
pub fn list_external_plugins(
    app: AppHandle,
    dev_dir: Option<String>,
) -> Result<Vec<ExternalPlugin>, String> {
    let mut all = scan_root("user", &user_plugins_dir(&app)?);
    if let Ok(dev) = root_dir(&app, "dev", &dev_dir) {
        all.extend(scan_root("dev", &dev));
    }
    Ok(all)
}

/// Returns the bundled ES module source so the frontend can import it via a Blob URL.
#[tauri::command]
pub fn read_plugin_entry(
    app: AppHandle,
    root: String,
    folder: String,
    dev_dir: Option<String>,
) -> Result<String, String> {
    if !is_safe_folder_name(&folder) {
        return Err("invalid plugin folder".into());
    }
    let path = root_dir(&app, &root, &dev_dir)?.join(folder).join("index.js");
    fs::read_to_string(&path).map_err(|e| format!("{}: {e}", path.display()))
}

#[tauri::command]
pub fn get_plugins_dir(app: AppHandle) -> Result<String, String> {
    Ok(user_plugins_dir(&app)?.to_string_lossy().to_string())
}

fn classify(root_name: &str, root: &Path, path: &Path, kind: EventKind) -> Option<FileChanged> {
    let kind = match kind {
        EventKind::Create(_) => "create",
        EventKind::Modify(_) => "modify",
        EventKind::Remove(_) => "remove",
        _ => return None,
    };
    let rel = path.strip_prefix(root).ok()?;
    let mut components = rel.components();
    let folder = components.next()?.as_os_str().to_string_lossy().to_string();
    let ignored = rel.components().any(|c| {
        IGNORED_SEGMENTS.contains(&c.as_os_str().to_string_lossy().as_ref())
    });
    if ignored || folder.starts_with('.') {
        return None;
    }
    Some(FileChanged {
        root: root_name.to_string(),
        folder,
        path: path.to_string_lossy().to_string(),
        kind,
    })
}

/// Watches the user plugin folder (and an optional dev folder) and emits
/// `plugin://file-changed`, debounced per plugin folder.
#[tauri::command]
pub fn start_plugin_watcher(
    app: AppHandle,
    state: tauri::State<'_, PluginWatcherState>,
    dev_dir: Option<String>,
) -> Result<(), String> {
    let mut roots: Vec<(String, PathBuf)> = vec![("user".into(), user_plugins_dir(&app)?)];
    if let Ok(dev) = root_dir(&app, "dev", &dev_dir) {
        if dev.is_dir() {
            roots.push(("dev".into(), dev));
        }
    }

    let (tx, rx) = channel::<FileChanged>();
    let handler_roots = roots.clone();
    let mut watcher = notify::recommended_watcher(move |res: notify::Result<Event>| {
        let Ok(event) = res else { return };
        for path in &event.paths {
            for (name, root) in &handler_roots {
                if let Some(change) = classify(name, root, path, event.kind) {
                    let _ = tx.send(change);
                }
            }
        }
    })
    .map_err(|e| e.to_string())?;

    for (_, root) in &roots {
        watcher
            .watch(root, RecursiveMode::Recursive)
            .map_err(|e| e.to_string())?;
    }

    let emit_app = app.clone();
    thread::Builder::new()
        .name("winnook-plugin-debounce".into())
        .spawn(move || {
            // Ends when the watcher (and with it the sender) is dropped.
            while let Ok(first) = rx.recv() {
                let mut pending = vec![first];
                loop {
                    match rx.recv_timeout(Duration::from_millis(150)) {
                        Ok(next) => pending.push(next),
                        Err(RecvTimeoutError::Timeout) => break,
                        Err(RecvTimeoutError::Disconnected) => break,
                    }
                }
                let mut seen = HashSet::new();
                for change in pending.into_iter().rev() {
                    if seen.insert((change.root.clone(), change.folder.clone())) {
                        let _ = emit_app.emit("plugin://file-changed", change);
                    }
                }
            }
        })
        .map_err(|e| e.to_string())?;

    *state.watcher.lock().map_err(|e| e.to_string())? = Some(watcher);
    Ok(())
}

#[tauri::command]
pub fn stop_plugin_watcher(state: tauri::State<'_, PluginWatcherState>) -> Result<(), String> {
    *state.watcher.lock().map_err(|e| e.to_string())? = None;
    Ok(())
}
