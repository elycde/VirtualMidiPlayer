export const dict = {
  ru: {
    "playlist.title": "Плейлист",
    "playlist.add": "Добавить MIDI",
    "playlist.empty": "Перетащи .mid файлы сюда\nили нажми «Добавить»",
    "stage.now": "Сейчас играет",
    "stage.nothing": "Ничего не выбрано",
    "guard.waiting": "Ждём окно игры…",
    "countdown.hint": "Переключайся в игру",
    "stat.layout": "Раскладка",
    "stat.coverage": "Покрытие",
    "stat.transpose": "Транспонирование",
    "stat.speed": "Темп",
    "tab.game": "Игра",
    "tab.sound": "Звучание",
    "tab.keys": "Клавиши",
    "tab.tracks": "Треки",
    "f.layout": "Раскладка клавиш",
    "f.transpose": "Транспонирование",
    "f.autoFit": "Подбирать автоматически",
    "f.oor": "Ноты вне диапазона",
    "f.oor.fold": "Сдвинуть",
    "f.oor.clamp": "Прижать",
    "f.oor.skip": "Пропустить",
    "f.countdown": "Отсчёт перед старта, с",
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
    "f.accent": "Акцент интерфейса",
    "f.dataDir": "Папка настроек и раскладок",
    "ed.title": "Редактор раскладки",
    "ed.clear": "Очистить",
    "ed.fillVp": "Заполнить как Virtual Piano",
    "ed.delete": "Удалить",
    "ed.save": "Сохранить",
    "ed.octave": "окт.",
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
    "ed.hint": "Нажми на клавишу пианино, затем на своей клавиатуре — назначение запишется. Двойной клик по клавише очищает её."
  },
  en: {
    "playlist.title": "Playlist",
    "playlist.add": "Add MIDI",
    "playlist.empty": "Drag .mid files here\nor click «Add»",
    "stage.now": "Now playing",
    "stage.nothing": "Nothing selected",
    "guard.waiting": "Waiting for game window…",
    "countdown.hint": "Switch to game",
    "stat.layout": "Layout",
    "stat.coverage": "Coverage",
    "stat.transpose": "Transpose",
    "stat.speed": "Speed",
    "tab.game": "Game",
    "tab.sound": "Sound",
    "tab.keys": "Keys",
    "tab.tracks": "Tracks",
    "f.layout": "Key layout",
    "f.transpose": "Transpose",
    "f.autoFit": "Auto fit",
    "f.oor": "Out of range notes",
    "f.oor.fold": "Fold",
    "f.oor.clamp": "Clamp",
    "f.oor.skip": "Skip",
    "f.countdown": "Countdown before start, s",
    "f.guard": "Play only when game is in focus",
    "f.forceEn": "Switch to EN layout",
    "f.sendMode": "Send mode",
    "f.sendMode.both": "Both",
    "f.speed": "Speed",
    "f.mode": "Hold mode",
    "f.mode.tap": "Tap",
    "f.mode.hold": "Hold",
    "f.tap": "Tap duration, ms",
    "f.chordGap": "Chord gap, ms",
    "f.humanize": "Humanize, ms",
    "f.maxChord": "Max chord notes",
    "f.minVel": "Min velocity",
    "f.drums": "Ignore drums (ch 10)",
    "f.autonext": "Autoplay next track",
    "f.hkOn": "Global hotkeys",
    "hk.playPause": "Play / Pause",
    "hk.stop": "Stop",
    "hk.prev": "Previous track",
    "hk.next": "Next track",
    "hk.panic": "Panic release all",
    "f.accent": "UI Accent",
    "f.dataDir": "Data directory",
    "ed.title": "Layout Editor",
    "ed.clear": "Clear",
    "ed.fillVp": "Fill like VP",
    "ed.delete": "Delete",
    "ed.save": "Save",
    "ed.octave": "oct.",
    "f.oor.hint": "«Fold» moves the note to a valid octave — the melody is preserved.",
    "f.guard.hint": "Partial window titles separated by «;». Time stops while the game is not focused.",
    "f.forceEn.hint": "If you have a RU layout, the game might receive «й» instead of «q».",
    "f.sendMode.hint": "Scancode works almost always. If the game doesn't react, try «Both».",
    "f.mode.hint": "Tap is enough for most games. Hold is needed when the sound plays as long as the key is pressed.",
    "f.chordGap.hint": "Helps if the game swallows simultaneous keystrokes.",
    "f.maxChord.hint": "0 — unlimited. If limited, edge voices are kept (melody and bass).",
    "f.minVel.hint": "Cuts off barely audible overtones.",
    "f.hk.hint": "Works even when the window is minimized. Click the field to set.",
    "f.tracks.hint": "Disable tracks you don't need — e.g. second voice or accompaniment.",
    "ed.hint": "Click a piano key, then press a key on your keyboard. Double click to clear."
  }
};

let currentLang = 'ru';

export function setLang(lang) {
  currentLang = lang;
  document.documentElement.lang = lang;
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.getAttribute('data-i18n');
    if (dict[lang][key]) {
      if (el.tagName === 'INPUT' && el.type === 'button') {
          el.value = dict[lang][key];
      } else {
          el.innerHTML = dict[lang][key].replace(/\n/g, '<br/>');
      }
    }
  });
}

export function toggleLang() {
  setLang(currentLang === 'ru' ? 'en' : 'ru');
}

export function initI18n() {
  document.getElementById('lang-toggle').addEventListener('click', toggleLang);
  setLang('ru');
}
