#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;
mod config;
mod hotkeys;
mod keyboard;
mod layout;
mod midi;
mod player;
mod winutil;

use std::collections::HashSet;
use std::sync::Mutex;

use tauri::{Emitter, Manager};

fn main() {
    // Держим разрешение таймера 1 мс всё время работы приложения — иначе
    // thread::sleep округляется до ~15 мс и тайминг нот рассыпается.
    let _timer = winutil::TimerResolution::acquire();

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(hotkeys::handler)
                .build(),
        )
        .manage(hotkeys::Registry::default())
        .setup(|app| {
            let paths = config::Paths::resolve();
            let cfg = paths.load_config();

            let emitter = app.handle().clone();
            let player = player::spawn(move |ev| {
                let _ = emitter.emit("player", ev);
            });

            let state = commands::AppState {
                paths,
                config: Mutex::new(cfg.clone()),
                player,
                song: Mutex::new(None),
                muted: Mutex::new(HashSet::new()),
            };
            state.push_to_player();
            app.manage(state);

            hotkeys::apply(app.handle(), &cfg);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::bootstrap,
            commands::save_config,
            commands::list_layouts,
            commands::save_layout,
            commands::delete_layout,
            commands::set_layout,
            commands::pick_midi_files,
            commands::load_song,
            commands::set_muted_tracks,
            commands::get_coverage,
            commands::auto_fit,
            commands::play,
            commands::pause,
            commands::toggle_play,
            commands::stop,
            commands::seek,
            commands::panic_release,
            commands::open_data_folder,
            commands::validate_token, commands::fetch_catalog, commands::download_midi_curl, commands::save_downloaded_midi,
        ])
        .run(tauri::generate_context!())
        .expect("не удалось запустить приложение");
}
