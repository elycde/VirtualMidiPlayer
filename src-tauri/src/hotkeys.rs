//! Глобальные горячие клавиши: работают, даже когда окно свёрнуто и ты в игре.

use std::str::FromStr;
use std::sync::Mutex;

use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};

use crate::commands::AppState;
use crate::config::Config;
use crate::player::Cmd;

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Action {
    TogglePlay,
    Stop,
    Next,
    Prev,
    Panic,
}

impl Action {
    fn as_str(self) -> &'static str {
        match self {
            Action::TogglePlay => "togglePlay",
            Action::Stop => "stop",
            Action::Next => "next",
            Action::Prev => "prev",
            Action::Panic => "panic",
        }
    }
}

/// Что на что назначено сейчас. Нужен, чтобы обработчик понимал, какая клавиша
/// прилетела — плагин отдаёт только сам `Shortcut`.
#[derive(Default)]
pub struct Registry(pub Mutex<Vec<(Shortcut, Action)>>);

/// Перерегистрирует все хоткеи по конфигу. Занятые системой просто пропускаются.
pub fn apply(app: &AppHandle, cfg: &Config) {
    let gs = app.global_shortcut();
    let _ = gs.unregister_all();

    let registry = app.state::<Registry>();
    let mut list = registry.0.lock().unwrap();
    list.clear();

    if !cfg.hotkeys.enabled {
        return;
    }

    let wanted = [
        (cfg.hotkeys.play_pause.as_str(), Action::TogglePlay),
        (cfg.hotkeys.stop.as_str(), Action::Stop),
        (cfg.hotkeys.prev.as_str(), Action::Prev),
        (cfg.hotkeys.next.as_str(), Action::Next),
        (cfg.hotkeys.panic.as_str(), Action::Panic),
    ];

    for (spec, action) in wanted {
        let spec = spec.trim();
        if spec.is_empty() {
            continue;
        }
        let Ok(shortcut) = Shortcut::from_str(spec) else {
            continue;
        };
        if list.iter().any(|(s, _)| *s == shortcut) {
            continue; // одну клавишу дважды не вешаем
        }
        if gs.register(shortcut).is_ok() {
            list.push((shortcut, action));
        }
    }
}

pub fn handler(app: &AppHandle, shortcut: &Shortcut, event: tauri_plugin_global_shortcut::ShortcutEvent) {
    if event.state() != ShortcutState::Pressed {
        return;
    }

    let Some(registry) = app.try_state::<Registry>() else {
        return;
    };
    let action = registry
        .0
        .lock()
        .unwrap()
        .iter()
        .find(|(s, _)| s == shortcut)
        .map(|(_, a)| *a);
    let Some(action) = action else { return };

    // Останов и аварийный сброс делаем сразу в Rust — на них нельзя ждать,
    // пока фронтенд обработает событие и вызовет команду.
    if let Some(state) = app.try_state::<AppState>() {
        match action {
            Action::TogglePlay => state.player.send(Cmd::TogglePlay),
            Action::Stop => state.player.send(Cmd::Stop),
            Action::Panic => state.player.send(Cmd::Panic),
            // Переключение трека знает только плейлист в UI.
            Action::Next | Action::Prev => {}
        }
    }

    let _ = app.emit("hotkey", action.as_str());
}
