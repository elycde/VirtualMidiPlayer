# VirtualMidiPlayer

MIDI-автопроигрыватель для игровых пианино. Читает `.mid`-файлы и «играет» их,
эмулируя нажатия клавиш через `SendInput`. Цель — Roblox (Virtual Piano) и
пианино-аддоны Garry's Mod. Приоритет №1 — красивый интерфейс.

## Стек

- **Rust + Tauri v2** (WebView2). UI — обычные HTML/CSS/JS в `ui/`, **без npm/бандлера**.
- Собирается через `cargo` напрямую, без Tauri CLI.
- Один exe (~8 МБ), таргет NSIS.

## Команды

```bash
cd src-tauri && cargo run              # запуск в дебаге (окно с консолью)
cd src-tauri && cargo build --release  # релизный exe
cd src-tauri && cargo test             # 24 юнит-теста
cd src-tauri && cargo check --all-targets
```

Иконка: `python src-tauri/make_icon.py` → `src-tauri/icons/icon.ico` (без зависимостей).

## Структура

```
ui/                     фронтенд (frontendDist)
  index.html            вся разметка
  css/style.css         стили (дизайн — приоритет)
  js/app.js             логика, invoke, слушатели событий
  js/i18n.js            словарь RU/EN + переключатель
  js/pianoroll.js       canvas: падающие ноты + клавиатура
  js/editor.js          редактор раскладок
src-tauri/src/
  main.rs               точка входа, регистрация команд, setup
  commands.rs           19 команд Tauri + AppState + DTO
  player.rs             движок воспроизведения (отдельный поток)
  keyboard.rs           SendInput, US-таблица scancode/VK, tap_chord
  midi.rs               парсинг MIDI → Note[] с временем в мкс
  layout.rs             4 встроенные раскладки + транспонирование
  config.rs             Config, Paths (%APPDATA%\VirtualMidiPlayer)
  hotkeys.rs            глобальные горячие клавиши
  winutil.rs            таймер 1мс, sleep_until, фокус окна, раскладка ОС
```

## Ключевые инварианты (не сломать)

- **Тайминг якорный**: `anchor = now - position/speed`; каждое событие ждёт до
  `anchor + t/speed`, ошибка не накапливается. `sleep_until` спит чанками по 1мс,
  последние 1200мкс — спином, проверяя колбэк отмены. Требует `timeBeginPeriod(1)`
  (держится всё время жизни процесса в `main`) и time-critical приоритет потока.
- **US-таблица захардкожена** (не `VkKeyScanW`): русская системная раскладка иначе
  превратит `q` в «й». Опция `force_en_layout` дополнительно шлёт
  `WM_INPUTLANGCHANGEREQUEST`.
- **Аккорд нельзя зажать с Shift**: `1` и `!` физически несовместимы. `tap_chord`
  жмёт обычные клавиши, затем по группам модификаторов (mods↓ → keys↓ → mods↑).
- **note-off раньше note-on** при равном времени (иначе ретриггер ноты глотается).
- **Оконный страж** (`window_guard`): пока целевое окно не в фокусе — время песни
  заморожено (постоянный re-anchor), все клавиши отпущены.
- `Drop for KeySender` вызывает `release_all()` — клавиша не может залипнуть.
- Встроенные раскладки — **в коде** (`layout.rs`), не JSON. Пользовательские — JSON
  в `%APPDATA%\VirtualMidiPlayer\layouts\`.
- `total_us() = max(последнее событие, song.duration_us)` — в tap-режиме note-off
  не эмитятся, иначе теряется хвост последней ноты.

## Мост JS ↔ Rust

`withGlobalTauri: true` → доступен только **core** API на `window.__TAURI__`
(`core.invoke`, `event.listen`, `window.getCurrentWindow`, `webview.getCurrentWebview`).
Плагинных JS-API нет (нужен был бы npm). Поэтому файловый диалог — команда Rust
(`pick_midi_files`, блокирующая — команды Tauri не в главном потоке).

Команды (имена snake_case как в Rust): `bootstrap, save_config, list_layouts,
save_layout, delete_layout, set_layout, pick_midi_files, load_song,
set_muted_tracks, get_coverage, auto_fit, play, pause, toggle_play, stop, seek,
panic_release, open_data_folder, validate_token`.

События: `"player"` — `{kind:"tick",positionUs,playing,countdown,guardBlocked}` /
`{kind:"ended"}` / `{kind:"stopped"}`; `"hotkey"` — строка действия
(`togglePlay|stop|next|prev|panic`). Next/Prev обрабатывает UI (плейлист знает
только он), Stop/Panic/TogglePlay идут сразу в плеер из Rust.

DTO ноты компактно: `notes: [[startMs, durMs, key, vel, track], …]`.

## Дизайн

Следовать принципам Apple (skill apple-design): пружины (damping 1.0 / response
0.3–0.4 по умолчанию; bounce 0.8 только после инерции), анимации от текущего
значения и прерываемые, отклик на pointer-down, 1:1-трекинг перетаскивания
сиик-бара с проекцией инерции, полупрозрачные `backdrop-filter`-поверхности,
размер-специфичный трекинг, поддержка `prefers-reduced-motion/-transparency/contrast`.

## Честные оговорки (в README и в описаниях раскладок)

- Roblox-88: низ через Ctrl, верх через Alt — **соглашение**, зависит от игры,
  правится в редакторе.
- GMod: трекерная раскладка распространённых аддонов Source — аддоны различаются.

## Статус

Rust-бэкенд написан целиком, `cargo check` проходит (exit 0), 24 теста написаны.
Фронтенд в `ui/` — в работе (`index.html` готов, CSS/JS пишутся). Первый `cargo
run` ещё не делался. `README.md` не написан. Корневая папка `layouts/` не нужна
(раскладки в коде), `songs/` — папка-помойка для файлов пользователя.
