mod appearance;
mod clipboard_watcher;
mod font_match;
mod media;
mod plugin_watcher;
mod power;
mod screen_capture;
mod secure;
mod screenshot;
mod teams_monitor;
mod window_manager;

use tauri_plugin_autostart::MacosLauncher;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_autostart::init(MacosLauncher::LaunchAgent, None))
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .manage(window_manager::WindowState::default())
        .manage(power::PowerState::new())
        .manage(screenshot::EditorState::default())
        .manage(plugin_watcher::PluginWatcherState::default())
        .setup(|app| {
            let handle = app.handle().clone();
            window_manager::init_windows(&handle)?;
            window_manager::start_cursor_poller(handle.clone());
            teams_monitor::start(handle.clone());
            clipboard_watcher::start(handle);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            secure::dpapi_protect,
            secure::dpapi_unprotect,
            teams_monitor::get_teams_status,
            teams_monitor::clear_teams_unread,
            teams_monitor::focus_teams_window,
            window_manager::set_notch_position,
            window_manager::set_monitor_mode,
            window_manager::set_hit_rect,
            window_manager::set_always_on_top,
            window_manager::open_overlay,
            window_manager::close_overlay,
            power::set_keep_awake,
            power::is_keep_awake,
            power::simulate_activity,
            media::media_get_session,
            media::media_control,
            screen_capture::capture_region,
            screen_capture::capture_fullscreen,
            screenshot::open_screenshot_editor,
            screenshot::get_editor_image,
            screenshot::save_screenshot,
            screenshot::reveal_in_explorer,
            screen_capture::detect_font,
            plugin_watcher::list_external_plugins,
            plugin_watcher::read_plugin_entry,
            plugin_watcher::get_plugins_dir,
            plugin_watcher::start_plugin_watcher,
            plugin_watcher::stop_plugin_watcher,
            appearance::get_windows_accent,
            appearance::is_system_dark,
            appearance::get_wallpaper_color,
        ])
        .run(tauri::generate_context!())
        .expect("error while running WinNook");
}
