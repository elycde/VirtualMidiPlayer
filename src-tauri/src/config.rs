//! Настройки: загрузка/сохранение JSON в %APPDATA%\VirtualMidiPlayer.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::layout::Layout;

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(default)]
pub struct Hotkeys {
    pub play_pause: String,
    pub stop: String,
    pub next: String,
    pub prev: String,
    pub panic: String,
    pub enabled: bool,
}

impl Default for Hotkeys {
    fn default() -> Self {
        Self {
            play_pause: "F5".into(),
            stop: "F6".into(),
            prev: "F7".into(),
            next: "F8".into(),
            panic: "F9".into(),
            enabled: true,
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(default)]
pub struct Config {
    /// "ru" | "en"
    pub lang: String,
    pub accent: String,

    pub layout_id: String,

    // Воспроизведение
    pub speed: f32,
    pub transpose: i32,
    pub auto_fit: bool,
    /// "skip" | "fold" | "clamp"
    pub out_of_range: String,
    /// true — держать клавишу всю длительность ноты; false — короткий тап.
    pub hold_mode: bool,
    pub tap_ms: u64,
    /// Пауза между клавишами внутри одного аккорда, мс.
    pub chord_gap_ms: u64,
    /// Случайный разброс тайминга, мс (0 — выключено).
    pub humanize_ms: u64,
    /// Максимум одновременных нот (0 — без ограничения).
    pub max_chord: usize,
    pub ignore_drums: bool,
    pub min_velocity: u8,
    pub loop_song: bool,
    pub autoplay_next: bool,

    // Безопасность / совместимость
    pub countdown_s: u32,
    pub window_guard: bool,
    /// Подстроки заголовков окон через `;`.
    pub window_title: String,
    pub force_en_layout: bool,
    /// "scancode" | "virtual" | "both"
    pub send_mode: String,

    pub hotkeys: Hotkeys,
    pub playlist: Vec<String>,
}

impl Default for Config {
    fn default() -> Self {
        Self {
            lang: "ru".into(),
            accent: "violet".into(),
            layout_id: "roblox_61".into(),
            speed: 1.0,
            transpose: 0,
            auto_fit: true,
            out_of_range: "fold".into(),
            hold_mode: false,
            tap_ms: 12,
            chord_gap_ms: 0,
            humanize_ms: 0,
            max_chord: 0,
            ignore_drums: true,
            min_velocity: 1,
            loop_song: false,
            autoplay_next: true,
            countdown_s: 3,
            window_guard: false,
            window_title: "Roblox; Garry's Mod".into(),
            force_en_layout: false,
            send_mode: "scancode".into(),
            hotkeys: Hotkeys::default(),
            playlist: Vec::new(),
        }
    }
}

impl Config {
    /// Чинит значения, которые UI или правка файла вручную могли увести в абсурд.
    pub fn sanitize(&mut self) {
        if self.lang != "en" {
            self.lang = "ru".into();
        }
        self.speed = self.speed.clamp(0.1, 4.0);
        self.transpose = self.transpose.clamp(-48, 48);
        self.tap_ms = self.tap_ms.clamp(1, 500);
        self.chord_gap_ms = self.chord_gap_ms.min(100);
        self.humanize_ms = self.humanize_ms.min(200);
        self.max_chord = self.max_chord.min(24);
        self.countdown_s = self.countdown_s.min(15);
        self.min_velocity = self.min_velocity.min(127);
        if !matches!(self.out_of_range.as_str(), "skip" | "fold" | "clamp") {
            self.out_of_range = "fold".into();
        }
        if !matches!(self.send_mode.as_str(), "scancode" | "virtual" | "both") {
            self.send_mode = "scancode".into();
        }
    }
}

/// Где живут настройки и пользовательские раскладки.
#[derive(Clone, Debug)]
pub struct Paths {
    pub root: PathBuf,
}

impl Paths {
    pub fn resolve() -> Self {
        let root = std::env::var_os("APPDATA")
            .map(PathBuf::from)
            .unwrap_or_else(std::env::temp_dir)
            .join("VirtualMidiPlayer");
        Self { root }
    }

    pub fn config_file(&self) -> PathBuf {
        self.root.join("config.json")
    }

    pub fn layouts_dir(&self) -> PathBuf {
        self.root.join("layouts")
    }

    fn ensure(&self) {
        let _ = std::fs::create_dir_all(self.layouts_dir());
    }

    pub fn load_config(&self) -> Config {
        let mut cfg = std::fs::read_to_string(self.config_file())
            .ok()
            .and_then(|s| serde_json::from_str::<Config>(&s).ok())
            .unwrap_or_default();
        cfg.sanitize();
        cfg
    }

    pub fn save_config(&self, cfg: &Config) -> Result<(), String> {
        self.ensure();
        let json = serde_json::to_string_pretty(cfg).map_err(|e| e.to_string())?;
        std::fs::write(self.config_file(), json).map_err(|e| e.to_string())
    }

    /// Пользовательские раскладки — по одному JSON на раскладку.
    pub fn load_user_layouts(&self) -> Vec<Layout> {
        let mut out = Vec::new();
        let Ok(entries) = std::fs::read_dir(self.layouts_dir()) else {
            return out;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().and_then(|e| e.to_str()) != Some("json") {
                continue;
            }
            if let Ok(text) = std::fs::read_to_string(&path) {
                if let Ok(mut l) = serde_json::from_str::<Layout>(&text) {
                    l.builtin = false;
                    out.push(l);
                }
            }
        }
        out.sort_by(|a, b| a.name.cmp(&b.name));
        out
    }

    pub fn save_user_layout(&self, layout: &Layout) -> Result<(), String> {
        self.ensure();
        let json = serde_json::to_string_pretty(layout).map_err(|e| e.to_string())?;
        std::fs::write(self.layout_file(&layout.id), json).map_err(|e| e.to_string())
    }

    pub fn delete_user_layout(&self, id: &str) -> Result<(), String> {
        let path = self.layout_file(id);
        if path.exists() {
            std::fs::remove_file(path).map_err(|e| e.to_string())?;
        }
        Ok(())
    }

    fn layout_file(&self, id: &str) -> PathBuf {
        self.layouts_dir().join(format!("{}.json", sanitize_id(id)))
    }
}

/// id уходит в имя файла, поэтому оставляем только безопасные символы.
pub fn sanitize_id(id: &str) -> String {
    let cleaned: String = id
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '-' || c == '_' {
                c
            } else {
                '_'
            }
        })
        .collect();
    let trimmed = cleaned.trim_matches('_');
    if trimmed.is_empty() {
        "layout".to_string()
    } else {
        trimmed.chars().take(64).collect()
    }
}

#[allow(dead_code)]
fn _unused(_p: &Path) {}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sanitize_clamps_nonsense() {
        let mut c = Config {
            speed: 99.0,
            transpose: -900,
            tap_ms: 0,
            out_of_range: "wat".into(),
            send_mode: "telepathy".into(),
            lang: "de".into(),
            ..Default::default()
        };
        c.sanitize();
        assert_eq!(c.speed, 4.0);
        assert_eq!(c.transpose, -48);
        assert_eq!(c.tap_ms, 1);
        assert_eq!(c.out_of_range, "fold");
        assert_eq!(c.send_mode, "scancode");
        assert_eq!(c.lang, "ru");
    }

    #[test]
    fn ids_cannot_escape_the_layouts_dir() {
        assert_eq!(sanitize_id("../../evil"), "evil");
        assert_eq!(sanitize_id("my layout!"), "my_layout");
        assert_eq!(sanitize_id(""), "layout");
        assert_eq!(sanitize_id("ok_id-2"), "ok_id-2");
    }

    #[test]
    fn config_roundtrips_and_tolerates_missing_fields() {
        let parsed: Config = serde_json::from_str(r#"{"speed": 1.5}"#).unwrap();
        assert_eq!(parsed.speed, 1.5);
        assert_eq!(parsed.layout_id, "roblox_61"); // из Default
    }
}
