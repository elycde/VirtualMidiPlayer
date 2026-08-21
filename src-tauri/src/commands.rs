//! Мост между фронтендом и движком: команды Tauri.

use std::collections::HashSet;
use std::sync::{Arc, Mutex};

use serde::Serialize;
use tauri::{AppHandle, State};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_opener::OpenerExt;

use crate::config::{Config, Paths};
use crate::keyboard::{parse_token, SendMode};
use crate::layout::{
    best_transpose, builtin_layouts, coverage, Coverage, Layout, OutOfRange, ResolvedLayout,
};
use crate::midi::{self, Song, TrackInfo};
use crate::player::{Cmd, PlaySettings, PlayerHandle};

pub struct AppState {
    pub paths: Paths,
    pub config: Mutex<Config>,
    pub player: PlayerHandle,
    pub song: Mutex<Option<Arc<Song>>>,
    pub muted: Mutex<HashSet<u8>>,
}

impl AppState {
    /// Все раскладки: встроенные плюс пользовательские из папки данных.
    pub fn all_layouts(&self) -> Vec<Layout> {
        let mut out = builtin_layouts();
        out.extend(self.paths.load_user_layouts());
        out
    }

    pub fn find_layout(&self, id: &str) -> Option<Layout> {
        self.all_layouts().into_iter().find(|l| l.id == id)
    }

    pub fn resolved_layout(&self) -> Arc<ResolvedLayout> {
        let id = self.config.lock().unwrap().layout_id.clone();
        let layout = self
            .find_layout(&id)
            .unwrap_or_else(|| builtin_layouts().remove(0));
        Arc::new(ResolvedLayout::from_layout(&layout))
    }

    pub fn play_settings(&self) -> PlaySettings {
        let c = self.config.lock().unwrap();
        PlaySettings {
            speed: c.speed,
            transpose: c.transpose,
            out_of_range: OutOfRange::from_str(&c.out_of_range),
            hold_mode: c.hold_mode,
            tap_us: c.tap_ms * 1000,
            chord_gap_us: c.chord_gap_ms * 1000,
            humanize_us: c.humanize_ms * 1000,
            max_chord: c.max_chord,
            ignore_drums: c.ignore_drums,
            min_velocity: c.min_velocity,
            loop_song: c.loop_song,
            countdown_s: c.countdown_s,
            window_guard: c.window_guard,
            window_title: c.window_title.clone(),
            force_en_layout: c.force_en_layout,
            send_mode: SendMode::from_str(&c.send_mode),
        }
    }

    /// Проталкивает актуальные настройки и раскладку в поток плеера.
    pub fn push_to_player(&self) {
        self.player.send(Cmd::SetLayout(self.resolved_layout()));
        self.player.send(Cmd::SetSettings(self.play_settings()));
    }
}

// ── DTO для фронтенда ──────────────────────────────────────────────────────────

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SongDto {
    pub path: String,
    pub name: String,
    pub duration_ms: f64,
    pub tempo_bpm: f32,
    pub min_key: u8,
    pub max_key: u8,
    pub tracks: Vec<TrackInfo>,
    /// `[начало_мс, длительность_мс, нота, громкость, трек]` — компактнее объектов.
    pub notes: Vec<[f64; 5]>,
}

impl SongDto {
    fn from_song(song: &Song) -> Self {
        Self {
            path: song.path.clone(),
            name: song.name.clone(),
            duration_ms: song.duration_us as f64 / 1000.0,
            tempo_bpm: song.tempo_bpm,
            min_key: song.min_key,
            max_key: song.max_key,
            tracks: song.tracks.clone(),
            notes: song
                .notes
                .iter()
                .map(|n| {
                    [
                        n.start_us as f64 / 1000.0,
                        n.dur_us as f64 / 1000.0,
                        n.key as f64,
                        n.vel as f64,
                        n.track as f64,
                    ]
                })
                .collect(),
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LoadResult {
    pub song: SongDto,
    pub transpose: i32,
    pub coverage: Coverage,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Bootstrap {
    pub config: Config,
    pub layouts: Vec<Layout>,
    pub data_dir: String,
    pub version: String,
}

// ── Команды ────────────────────────────────────────────────────────────────────

#[tauri::command]
pub fn bootstrap(state: State<AppState>) -> Bootstrap {
    Bootstrap {
        config: state.config.lock().unwrap().clone(),
        layouts: state.all_layouts(),
        data_dir: state.paths.root.to_string_lossy().to_string(),
        version: env!("CARGO_PKG_VERSION").to_string(),
    }
}

#[tauri::command]
pub fn save_config(
    app: AppHandle,
    state: State<AppState>,
    mut config: Config,
) -> Result<Config, String> {
    config.sanitize();
    let hotkeys_changed = {
        let old = state.config.lock().unwrap();
        old.hotkeys.play_pause != config.hotkeys.play_pause
            || old.hotkeys.stop != config.hotkeys.stop
            || old.hotkeys.next != config.hotkeys.next
            || old.hotkeys.prev != config.hotkeys.prev
            || old.hotkeys.panic != config.hotkeys.panic
            || old.hotkeys.enabled != config.hotkeys.enabled
    };

    *state.config.lock().unwrap() = config.clone();
    state.paths.save_config(&config)?;
    state.push_to_player();

    if hotkeys_changed {
        crate::hotkeys::apply(&app, &config);
    }
    Ok(config)
}

#[tauri::command]
pub fn list_layouts(state: State<AppState>) -> Vec<Layout> {
    state.all_layouts()
}

#[tauri::command]
pub fn save_layout(state: State<AppState>, mut layout: Layout) -> Result<Vec<Layout>, String> {
    if layout.name.trim().is_empty() {
        return Err("у раскладки должно быть название".into());
    }
    layout.builtin = false;
    layout.id = crate::config::sanitize_id(&layout.id);

    // Встроенные раскладки не перезаписываем — сохраняем как копию.
    if builtin_layouts().iter().any(|b| b.id == layout.id) {
        layout.id = format!("{}_custom", layout.id);
    }

    // Мусорные токены выбрасываем сразу, чтобы плеер не спотыкался на них.
    layout.mapping.retain(|_, tok| parse_token(tok).is_some());

    state.paths.save_user_layout(&layout)?;
    Ok(state.all_layouts())
}

#[tauri::command]
pub fn delete_layout(state: State<AppState>, id: String) -> Result<Vec<Layout>, String> {
    if builtin_layouts().iter().any(|b| b.id == id) {
        return Err("встроенную раскладку удалить нельзя".into());
    }
    state.paths.delete_user_layout(&id)?;

    let mut cfg = state.config.lock().unwrap();
    if cfg.layout_id == id {
        cfg.layout_id = "roblox_61".into();
        let _ = state.paths.save_config(&cfg);
    }
    drop(cfg);
    state.push_to_player();
    Ok(state.all_layouts())
}

#[tauri::command]
pub fn set_layout(state: State<AppState>, id: String) -> Result<Coverage, String> {
    if state.find_layout(&id).is_none() {
        return Err("раскладка не найдена".into());
    }
    {
        let mut cfg = state.config.lock().unwrap();
        cfg.layout_id = id;
        let _ = state.paths.save_config(&cfg);
    }
    refit(&state);
    state.push_to_player();
    Ok(current_coverage(&state))
}

/// Выбор MIDI-файлов через системный диалог.
///
/// Диалог блокирующий — команды Tauri выполняются не в главном потоке, поэтому
/// это безопасно, а фронтенду не нужен npm-пакет плагина.
#[tauri::command]
pub fn pick_midi_files(app: AppHandle) -> Vec<String> {
    let mut result = Vec::new();
    
    // Default to user's audio directory if dialog is cancelled, or just open dialog
    let picked = app
        .dialog()
        .file()
        .set_title("Выбери папку с MIDI")
        .blocking_pick_folder();

    let folder_path = match picked {
        Some(path) => path.into_path().ok(),
        None => dirs::audio_dir(), // Fallback to user's music folder
    };

    if let Some(path) = folder_path {
        if let Ok(entries) = std::fs::read_dir(path) {
            for entry in entries.flatten() {
                let path = entry.path();
                if path.is_file() {
                    if let Some(ext) = path.extension().and_then(|s| s.to_str()) {
                        let ext_lower = ext.to_lowercase();
                        if ext_lower == "mid" || ext_lower == "midi" || ext_lower == "rmi" {
                            result.push(path.to_string_lossy().to_string());
                        }
                    }
                }
            }
        }
    }
    
    // Sort alphabetically
    result.sort();
    result
}

#[tauri::command]
pub fn load_song(state: State<AppState>, path: String) -> Result<LoadResult, String> {
    let song = Arc::new(midi::parse_file(&path)?);

    *state.song.lock().unwrap() = Some(song.clone());
    state.muted.lock().unwrap().clear();

    state.player.send(Cmd::SetMuted(HashSet::new()));
    state.player.send(Cmd::Load(song.clone()));

    refit(&state);
    state.push_to_player();

    let transpose = state.config.lock().unwrap().transpose;
    Ok(LoadResult {
        song: SongDto::from_song(&song),
        transpose,
        coverage: current_coverage(&state),
    })
}

#[tauri::command]
pub fn set_muted_tracks(state: State<AppState>, tracks: Vec<u8>) -> Coverage {
    let set: HashSet<u8> = tracks.into_iter().collect();
    *state.muted.lock().unwrap() = set.clone();
    state.player.send(Cmd::SetMuted(set));
    current_coverage(&state)
}

#[tauri::command]
pub fn get_coverage(state: State<AppState>) -> Coverage {
    current_coverage(&state)
}

#[tauri::command]
pub fn auto_fit(state: State<AppState>) -> Coverage {
    let layout = state.resolved_layout();
    let keys = playable_keys(&state);
    let t = best_transpose(&keys, &layout);
    {
        let mut cfg = state.config.lock().unwrap();
        cfg.transpose = t;
        let _ = state.paths.save_config(&cfg);
    }
    state.push_to_player();
    current_coverage(&state)
}

#[tauri::command]
pub fn play(state: State<AppState>) {
    state.player.send(Cmd::Play);
}

#[tauri::command]
pub fn pause(state: State<AppState>) {
    state.player.send(Cmd::Pause);
}

#[tauri::command]
pub fn toggle_play(state: State<AppState>) {
    state.player.send(Cmd::TogglePlay);
}

#[tauri::command]
pub fn stop(state: State<AppState>) {
    state.player.send(Cmd::Stop);
}

#[tauri::command]
pub fn seek(state: State<AppState>, ms: f64) {
    state.player.send(Cmd::Seek((ms.max(0.0) * 1000.0) as u64));
}

#[tauri::command]
pub fn panic_release(state: State<AppState>) {
    state.player.send(Cmd::Panic);
}

#[tauri::command]
pub fn open_data_folder(app: AppHandle, state: State<AppState>) -> Result<(), String> {
    let _ = std::fs::create_dir_all(&state.paths.root);
    app.opener()
        .open_path(state.paths.root.to_string_lossy().to_string(), None::<&str>)
        .map_err(|e| e.to_string())
}

/// Проверка одного токена из редактора раскладок.
#[tauri::command]
pub fn validate_token(token: String) -> bool {
    parse_token(&token).is_some()
}

// ── Вспомогательное ────────────────────────────────────────────────────────────

/// Ноты песни с учётом заглушённых треков и барабанов — то, что реально пойдёт
/// в игру. Именно на этом наборе считаются покрытие и авто-подбор.
fn playable_keys(state: &State<AppState>) -> Vec<u8> {
    let song = state.song.lock().unwrap();
    let Some(song) = song.as_ref() else {
        return Vec::new();
    };
    let muted = state.muted.lock().unwrap();
    let cfg = state.config.lock().unwrap();
    song.notes
        .iter()
        .filter(|n| !muted.contains(&n.track))
        .filter(|n| !(cfg.ignore_drums && n.channel == 9))
        .filter(|n| n.vel >= cfg.min_velocity)
        .map(|n| n.key)
        .collect()
}

fn current_coverage(state: &State<AppState>) -> Coverage {
    let layout = state.resolved_layout();
    let transpose = state.config.lock().unwrap().transpose;
    coverage(&playable_keys(state), &layout, transpose)
}

/// Если включён авто-подбор — пересчитывает транспонирование под текущую раскладку.
fn refit(state: &State<AppState>) {
    let auto = state.config.lock().unwrap().auto_fit;
    if !auto {
        return;
    }
    let layout = state.resolved_layout();
    let keys = playable_keys(state);
    if keys.is_empty() {
        return;
    }
    let t = best_transpose(&keys, &layout);
    let mut cfg = state.config.lock().unwrap();
    cfg.transpose = t;
    let _ = state.paths.save_config(&cfg);
}
