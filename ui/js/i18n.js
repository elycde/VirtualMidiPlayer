// Словарь RU/EN. `data-i18n` — текст, `data-i18n-ph` — placeholder,
// `data-tip` — подсказка (title).

export const dict = {
  ru: {
    "playlist.title": "Плейлист",
    "playlist.add": "Добавить",
    "playlist.empty": "Перетащи .mid прямо в окно,\nвыбери в проводнике или найди в BitMidi",
    "playlist.addTip": "Выбрать .mid в проводнике",
    "playlist.rescanTip": "Обновить — показать новое из папки songs",
    "toast.rescanEmpty": "Новых файлов в songs/ нет",
    "catalog.tip": "Каталог BitMidi — поиск и загрузка",
    "drop.hint": "Отпусти — добавим в плейлист",
    "stage.now": "Сейчас играет",
    "stage.nothing": "Ничего не выбрано",
    "guard.waiting": "Ждём окно игры…",
    "countdown.hint": "Переключайся в игру",
    "stat.layout": "Раскладка",
    "stat.coverage": "Покрытие",
    "stat.transpose": "Транспонирование",
    "stat.speed": "Темп",
    "chip.notes": "нот",
    "chip.tracks": "дор.",
    "tracks.none": "Загрузи трек — здесь появятся его партии.",
    "tab.game": "Игра",
    "tab.sound": "Звучание",
    "tab.keys": "Клавиши",
    "tab.tracks": "Треки",
    "f.layout": "Раскладка клавиш",
    "f.editLayout": "Редактор раскладки",
    "f.transpose": "Транспонирование",
    "f.autoFit": "Подбирать автоматически под раскладку",
    "f.oor": "Ноты вне диапазона",
    "f.oor.fold": "Сдвинуть",
    "f.oor.clamp": "Прижать",
    "f.oor.skip": "Пропустить",
    "f.countdown": "Отсчёт перед стартом, с",
    "f.guard": "Играть только когда игра в фокусе",
    "f.forceEn": "Переключать на английскую раскладку",
    "f.sendMode": "Способ отправки нажатий",
    "f.sendMode.both": "Оба",
    "f.speed": "Темп",
    "f.mode": "Как держать клавиши",
    "f.mode.tap": "Короткий тап",
    "f.mode.hold": "Держать ноту",
    "f.tap": "Длительность тапа, мс",
    "f.chordGap": "Разъезд аккорда, мс",
    "f.humanize": "Живой разброс, мс",
    "f.maxChord": "Максимум нот в аккорде",
    "f.minVel": "Порог громкости",
    "f.drums": "Игнорировать барабаны (10-й канал)",
    "f.autonext": "Автоматически включать следующий трек",
    "f.hkOn": "Глобальные горячие клавиши",
    "hk.playPause": "Играть / пауза",
    "hk.stop": "Стоп",
    "hk.prev": "Предыдущий трек",
    "hk.next": "Следующий трек",
    "hk.panic": "Отпустить все клавиши",
    "hk.press": "жми…",
    "f.accent": "Акцент интерфейса",
    "f.dataDir": "Папка настроек и раскладок",
    "loop.tip": "Повторять трек",
    "panic.tip": "Отпустить все клавиши",
    "theme.tip": "Светлая / тёмная тема",
    "lang.tip": "Язык / Language",
    "ed.title": "Редактор раскладки",
    "ed.clear": "Очистить",
    "ed.fillVp": "Как Virtual Piano",
    "ed.delete": "Удалить",
    "ed.save": "Сохранить",
    "ed.octave": "окт.",
    "ed.name.ph": "Название раскладки",
    "cat.title": "Каталог BitMidi",
    "cat.hint": "Поиск и загрузка MIDI прямо из базы BitMidi. Файлы падают в папку songs.",
    "cat.ph": "Например: Mario, Zelda, Rush E…",
    "cat.search": "Найти",
    "cat.loading": "Ищем…",
    "cat.empty": "Ничего не нашлось.",
    "cat.error": "Не получилось связаться с BitMidi.",
    "cat.get": "Скачать",
    "toast.added": "Добавлено: {n}",
    "toast.dupes": "Эти файлы уже в плейлисте",
    "toast.nomidi": "MIDI-файлов не нашлось",
    "toast.panic": "Все клавиши отпущены",
    "f.oor.hint": "«Сдвинуть» переносит ноту на целые октавы внутрь диапазона — мелодия сохраняется.",
    "f.guard.hint": "Части заголовков окон через «;». Пока нужное окно не в фокусе — время стоит, клавиши не жмутся.",
    "f.forceEn.hint": "При русской раскладке игра может получить «й» вместо «q».",
    "f.sendMode.hint": "Scancode подходит почти всегда. Если игра не реагирует — попробуй «Оба».",
    "f.mode.hint": "Большинству игр хватает тапа. «Держать» нужно там, где звук тянется, пока клавиша зажата.",
    "f.chordGap.hint": "Помогает, если игра глотает одновременные нажатия.",
    "f.maxChord.hint": "0 — без ограничения. При лимите остаются крайние голоса: мелодия и бас.",
    "f.minVel.hint": "Отсекает еле слышные призвуки аранжировки.",
    "f.hk.hint": "Работают, даже когда окно свёрнуто и ты в игре. Нажми на поле и задай клавишу.",
    "f.tracks.hint": "Отключи партии, которые не нужны — например, второй голос или аккомпанемент. Покрытие и авто-подбор пересчитаются.",
    "ed.hint": "Нажми клавишу пианино, затем клавишу на своей клавиатуре — назначение запишется и перейдёт к следующей ноте. Двойной клик очищает."
  },
  en: {
    "playlist.title": "Playlist",
    "playlist.add": "Add",
    "playlist.empty": "Drop .mid right into the window,\npick them in Explorer or find them on BitMidi",
    "playlist.addTip": "Pick .mid files in Explorer",
    "playlist.rescanTip": "Refresh — pick up new files from the songs folder",
    "toast.rescanEmpty": "No new files in songs/",
    "catalog.tip": "BitMidi catalog — search and download",
    "drop.hint": "Release to add to the playlist",
    "stage.now": "Now playing",
    "stage.nothing": "Nothing selected",
    "guard.waiting": "Waiting for game window…",
    "countdown.hint": "Switch to the game",
    "stat.layout": "Layout",
    "stat.coverage": "Coverage",
    "stat.transpose": "Transpose",
    "stat.speed": "Speed",
    "chip.notes": "notes",
    "chip.tracks": "tracks",
    "tracks.none": "Load a track — its parts will show up here.",
    "tab.game": "Game",
    "tab.sound": "Sound",
    "tab.keys": "Keys",
    "tab.tracks": "Tracks",
    "f.layout": "Key layout",
    "f.editLayout": "Layout editor",
    "f.transpose": "Transpose",
    "f.autoFit": "Fit the layout automatically",
    "f.oor": "Out of range notes",
    "f.oor.fold": "Fold",
    "f.oor.clamp": "Clamp",
    "f.oor.skip": "Skip",
    "f.countdown": "Countdown before start, s",
    "f.guard": "Play only when the game is focused",
    "f.forceEn": "Switch to the EN layout",
    "f.sendMode": "Send mode",
    "f.sendMode.both": "Both",
    "f.speed": "Speed",
    "f.mode": "Key hold mode",
    "f.mode.tap": "Short tap",
    "f.mode.hold": "Hold note",
    "f.tap": "Tap duration, ms",
    "f.chordGap": "Chord gap, ms",
    "f.humanize": "Humanize, ms",
    "f.maxChord": "Max notes per chord",
    "f.minVel": "Velocity threshold",
    "f.drums": "Ignore drums (channel 10)",
    "f.autonext": "Autoplay the next track",
    "f.hkOn": "Global hotkeys",
    "hk.playPause": "Play / pause",
    "hk.stop": "Stop",
    "hk.prev": "Previous track",
    "hk.next": "Next track",
    "hk.panic": "Release all keys",
    "hk.press": "press…",
    "f.accent": "UI accent",
    "f.dataDir": "Settings and layouts folder",
    "loop.tip": "Loop the track",
    "panic.tip": "Release all keys",
    "theme.tip": "Light / dark theme",
    "lang.tip": "Язык / Language",
    "ed.title": "Layout editor",
    "ed.clear": "Clear",
    "ed.fillVp": "Like Virtual Piano",
    "ed.delete": "Delete",
    "ed.save": "Save",
    "ed.octave": "oct.",
    "ed.name.ph": "Layout name",
    "cat.title": "BitMidi catalog",
    "cat.hint": "Search and download MIDI straight from BitMidi. Files land in the songs folder.",
    "cat.ph": "E.g. Mario, Zelda, Rush E…",
    "cat.search": "Search",
    "cat.loading": "Searching…",
    "cat.empty": "Nothing found.",
    "cat.error": "Could not reach BitMidi.",
    "cat.get": "Download",
    "toast.added": "Added: {n}",
    "toast.dupes": "Those files are already in the playlist",
    "toast.nomidi": "No MIDI files found",
    "toast.panic": "All keys released",
    "f.oor.hint": "«Fold» moves the note whole octaves into range — the melody survives.",
    "f.guard.hint": "Partial window titles separated by «;». While the window is not focused, time stops and no keys are pressed.",
    "f.forceEn.hint": "With a RU layout the game may receive «й» instead of «q».",
    "f.sendMode.hint": "Scancode works almost always. If the game ignores it — try «Both».",
    "f.mode.hint": "Tap is enough for most games. Hold is for pianos that sustain while the key is down.",
    "f.chordGap.hint": "Helps when the game swallows simultaneous keystrokes.",
    "f.maxChord.hint": "0 — unlimited. With a limit the outer voices stay: melody and bass.",
    "f.minVel.hint": "Cuts barely audible arrangement noise.",
    "f.hk.hint": "They work even when the window is minimized and you are in the game. Click a field and press a key.",
    "f.tracks.hint": "Mute the parts you don't need — a second voice or accompaniment. Coverage and auto-fit are recalculated.",
    "ed.hint": "Click a piano key, then a key on your keyboard — the binding is recorded and moves to the next note. Double click clears it."
  }
};

let currentLang = 'ru';
let onChange = null;

export function t(key, fallback) {
  const table = dict[currentLang] || dict.ru;
  return table[key] !== undefined ? table[key] : fallback !== undefined ? fallback : key;
}

export function getLang() {
  return currentLang;
}

export function setLang(lang) {
  currentLang = dict[lang] ? lang : 'ru';
  document.documentElement.lang = currentLang;
  apply();
  if (onChange) onChange(currentLang);
}

export function apply(root = document) {
  root.querySelectorAll('[data-i18n]').forEach((el) => {
    const key = el.getAttribute('data-i18n');
    if (!key) return;
    const val = dict[currentLang][key];
    if (val === undefined) return;
    el.innerHTML = escapeHtml(val).replace(/\n/g, '<br/>');
  });
  root.querySelectorAll('[data-i18n-ph]').forEach((el) => {
    const val = dict[currentLang][el.getAttribute('data-i18n-ph')];
    if (val !== undefined) el.placeholder = val;
  });
  root.querySelectorAll('[data-tip]').forEach((el) => {
    const val = dict[currentLang][el.getAttribute('data-tip')];
    if (val !== undefined) el.title = val;
  });
}

export function toggleLang() {
  setLang(currentLang === 'ru' ? 'en' : 'ru');
}

export function initI18n(lang, cb) {
  onChange = null; // при первом применении колбэк не дёргаем
  setLang(lang || 'ru');
  onChange = cb || null;
  const btn = document.getElementById('lang-toggle');
  if (btn) btn.addEventListener('click', toggleLang);
  window.__i18n = t;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
}
