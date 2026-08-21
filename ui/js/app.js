const { invoke } = window.__TAURI__.core;
const { listen } = window.__TAURI__.event;
const { getCurrentWindow } = window.__TAURI__.window;

import { initI18n, t } from './i18n.js';
import { Pianoroll } from './pianoroll.js';
import { Editor } from './editor.js';

const $ = (id) => document.getElementById(id);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

const state = {
  config: null,
  layouts: [],
  playlist: [],
  index: -1,
  song: null,
  playing: false,
  muted: new Set(),
  scrubbing: false,
};

let pianoroll = null;
let editor = null;

// ── Тосты ──────────────────────────────────────────────────────────────────────

function toast(msg, kind = 'ok') {
  const box = $('toasts');
  const el = document.createElement('div');
  el.className = `toast toast--${kind}`;
  el.textContent = msg;
  box.appendChild(el);
  requestAnimationFrame(() => el.classList.add('is-in'));
  setTimeout(() => {
    el.classList.remove('is-in');
    setTimeout(() => el.remove(), 260);
  }, 3200);
}

// ── Запуск ─────────────────────────────────────────────────────────────────────

async function bootstrap() {
  const data = await invoke('bootstrap');
  state.config = data.config;
  state.layouts = data.layouts;
  state.playlist = (data.config.playlist || []).slice();

  $('data-dir').textContent = data.dataDir;
  $('version').textContent = `v${data.version}`;

  applyTheme(localStorage.getItem('theme') === 'dark');
  document.body.setAttribute('data-accent', state.config.accent);

  pianoroll = new Pianoroll($('roll'));
  pianoroll.onSeek = (ms) => seekTo(ms, 'minimap');
  window.pianoroll = pianoroll;
  editor = new Editor(invoke, onLayoutsChanged, toast);

  initI18n(state.config.lang, (lang) => {
    state.config.lang = lang;
    saveConfig();
    renderPlaylist();
    if (state.song) renderChips();
  });

  fillLayouts();
  updateSettingsUI();
  bindUI();
  bindPlayerEvents();
  await bindDragDrop();
  renderPlaylist();
  refreshLayoutView();
  updateStats();

  // Молча подтягиваем новое из папки songs/ — например, скопированное вручную.
  try {
    addPaths((await invoke('rescan_songs')) || []);
  } catch (_) {}
}

// ── Настройки → UI ─────────────────────────────────────────────────────────────

function updateSettingsUI() {
  const c = state.config;
  setRange('transpose', c.transpose, 'out-transpose');
  setRange('countdown-s', c.countdown_s, 'out-countdown');
  setRange('speed', c.speed, 'out-speed', (v) => Number(v).toFixed(2) + '×');
  setRange('tap-ms', c.tap_ms, 'out-tap');
  setRange('chord-gap', c.chord_gap_ms, 'out-gap');
  setRange('humanize', c.humanize_ms, 'out-humanize');
  setRange('max-chord', c.max_chord, 'out-maxchord', (v) => (Number(v) === 0 ? '∞' : v));
  setRange('min-velocity', c.min_velocity, 'out-minvel');

  $('auto-fit').checked = c.auto_fit;
  $('window-guard').checked = c.window_guard;
  $('window-title').value = c.window_title;
  $('force-en').checked = c.force_en_layout;
  $('ignore-drums').checked = c.ignore_drums;
  $('autoplay-next').checked = c.autoplay_next;
  $('hotkeys-enabled').checked = c.hotkeys.enabled;

  $('layout-select').value = c.layout_id;
  updateSegment('oor', c.out_of_range);
  updateSegment('send-mode', c.send_mode);
  updateSegment('hold-mode', c.hold_mode ? 'hold' : 'tap');
  $('tap-field').hidden = c.hold_mode;

  $('btn-loop').classList.toggle('is-active', c.loop_song);
  $$('#accents button').forEach((b) => b.classList.toggle('is-active', b.dataset.val === c.accent));
  $$('.hkbtn').forEach((b) => (b.textContent = c.hotkeys[b.dataset.hk] || '—'));
  $$('#hklist').forEach((el) => el.classList.toggle('is-off', !c.hotkeys.enabled));

  updateLayoutDesc();
}

function setRange(id, val, outId, fmt) {
  const el = $(id);
  if (el) el.value = val;
  if (outId) setOut(outId, fmt ? fmt(val) : val);
}

/** Значение счётчика: текст + микро-пружинка при изменении. */
function setOut(outId, text) {
  const out = $(outId);
  if (!out) return;
  if (out.textContent !== String(text)) {
    out.textContent = text;
    out.classList.remove('is-bump');
    void out.offsetWidth; // перезапуск анимации
    out.classList.add('is-bump');
  }
}

function updateSegment(id, val) {
  const seg = $(id);
  const btns = Array.from(seg.querySelectorAll('button'));
  const prev = btns.find((b) => b.classList.contains('is-active'));
  const next = btns.find((b) => b.dataset.val === String(val));
  if (!next || next === prev) {
    btns.forEach((b) => b.classList.toggle('is-active', b.dataset.val === String(val)));
    return;
  }
  // Активность переезжает сразу (фон подсвечивается мгновенно, с мягким
  // segIn-появлением из CSS) — без «прыгающих» обёрток.
  btns.forEach((b) => b.classList.toggle('is-active', b === next));
}

function fillLayouts() {
  const sel = $('layout-select');
  sel.innerHTML = state.layouts
    .map((l) => `<option value="${l.id}">${esc(l.name)}</option>`)
    .join('');
  sel.value = state.config.layout_id;
}

function currentLayout() {
  return state.layouts.find((l) => l.id === state.config.layout_id) || state.layouts[0];
}

function updateLayoutDesc() {
  const l = currentLayout();
  $('layout-desc').textContent = l ? l.description || '' : '';
  $('stat-layout').textContent = l ? l.name : '—';
}

/** Множество нот, которые раскладка реально умеет нажимать. */
function playableSet() {
  const l = currentLayout();
  if (!l) return null;
  const set = new Set();
  for (const k of Object.keys(l.mapping)) {
    const n = Number(k);
    if (n >= 0 && n < 128) set.add(n);
  }
  return set;
}

function refreshLayoutView() {
  if (pianoroll) pianoroll.setLayout(playableSet(), state.config.transpose);
  updateLayoutDesc();
}

function onLayoutsChanged(layouts, selectId) {
  state.layouts = layouts;
  if (selectId) state.config.layout_id = selectId;
  fillLayouts();
  applyLayout(state.config.layout_id);
}

async function applyLayout(id) {
  state.config.layout_id = id;
  $('layout-select').value = id;
  try {
    const cov = await invoke('set_layout', { id });
    updateCoverage(cov);
  } catch (e) {
    toast(String(e), 'err');
  }
  // set_layout мог перепривязать транспонирование (авто-подбор).
  await pullTranspose();
  refreshLayoutView();
}

async function pullTranspose() {
  if (!state.config.auto_fit) return;
  const cov = await invoke('get_coverage');
  updateCoverage(cov);
}

const saveConfig = debounce(async () => {
  try {
    state.config.playlist = state.playlist;
    const c = await invoke('save_config', { config: state.config });
    state.config = c;
    updateStats();
  } catch (e) {
    toast(String(e), 'err');
  }
}, 250);

// ── Привязка контролов ─────────────────────────────────────────────────────────

function bindUI() {
  // Окно
  $('win-min').onclick = () => getCurrentWindow().minimize();
  $('win-max').onclick = async () => {
    const win = getCurrentWindow();
    (await win.isMaximized()) ? win.unmaximize() : win.maximize();
  };
  $('win-close').onclick = () => getCurrentWindow().close();

  // Тема
  $('theme-toggle').onclick = () => {
    const dark = document.body.getAttribute('data-theme') !== 'dark';
    localStorage.setItem('theme', dark ? 'dark' : 'light');
    applyTheme(dark);
  };

  // Вкладки
  $$('.tab').forEach((tab) => {
    tab.onclick = () => {
      $$('.tab').forEach((x) => x.classList.remove('is-active'));
      $$('.tabpane').forEach((p) => p.classList.remove('is-active'));
      tab.classList.add('is-active');
      document.querySelector(`.tabpane[data-pane="${tab.dataset.tab}"]`).classList.add('is-active');
    };
  });

  // Источники файлов
  $('add-files').onclick = pickFiles;
  $('btn-catalog').onclick = openCatalog;
  $('btn-rescan').onclick = rescanSongs;

  // Ползунки
  bindRange('transpose', 'transpose', 'out-transpose', null, () => {
    refreshLayoutView();
    refreshCoverage();
  });
  bindRange('countdown-s', 'countdown_s', 'out-countdown');
  bindRange('speed', 'speed', 'out-speed', (v) => Number(v).toFixed(2) + '×', updateStats);
  bindRange('tap-ms', 'tap_ms', 'out-tap');
  bindRange('chord-gap', 'chord_gap_ms', 'out-gap');
  bindRange('humanize', 'humanize_ms', 'out-humanize');
  bindRange('max-chord', 'max_chord', 'out-maxchord', (v) => (Number(v) === 0 ? '∞' : v));
  bindRange('min-velocity', 'min_velocity', 'out-minvel', null, refreshCoverage);

  bindCheck('auto-fit', 'auto_fit', async () => {
    if (state.config.auto_fit && state.song) {
      const cov = await invoke('auto_fit');
      updateCoverage(cov);
      refreshLayoutView();
    }
  });
  bindCheck('window-guard', 'window_guard');
  bindCheck('force-en', 'force_en_layout');
  bindCheck('ignore-drums', 'ignore_drums', refreshCoverage);
  bindCheck('autoplay-next', 'autoplay_next');
  bindCheck('hotkeys-enabled', 'hotkeys.enabled', () => {
    $$('#hklist').forEach((el) => el.classList.toggle('is-off', !state.config.hotkeys.enabled));
  });

  $$('#speed-presets button').forEach((b) => {
    b.onclick = () => {
      state.config.speed = parseFloat(b.dataset.val);
      setRange('speed', state.config.speed, 'out-speed', (v) => Number(v).toFixed(2) + '×');
      updateStats();
      saveConfig();
    };
  });

  $('window-title').oninput = (e) => {
    state.config.window_title = e.target.value;
    saveConfig();
  };

  bindSeg('oor', 'out_of_range', refreshCoverage);
  bindSeg('send-mode', 'send_mode');
  $$('#hold-mode button').forEach((b) => {
    b.onclick = () => {
      state.config.hold_mode = b.dataset.val === 'hold';
      updateSegment('hold-mode', b.dataset.val);
      $('tap-field').hidden = state.config.hold_mode;
      saveConfig();
    };
  });

  $$('#accents button').forEach((b) => {
    b.onclick = () => {
      state.config.accent = b.dataset.val;
      document.body.setAttribute('data-accent', b.dataset.val);
      $$('#accents button').forEach((x) => x.classList.toggle('is-active', x === b));
      if (pianoroll) pianoroll.refreshTheme();
      saveConfig();
    };
  });

  $('layout-select').onchange = (e) => applyLayout(e.target.value);
  $('edit-layout').onclick = () => editor.show(currentLayout());
  $('open-data').onclick = () => invoke('open_data_folder');

  // Транспорт
  $('btn-play').onclick = () => invoke('toggle_play');
  $('btn-stop').onclick = () => invoke('stop');
  $('btn-panic').onclick = () => {
    invoke('panic_release');
    toast(t('toast.panic'));
  };
  $('btn-prev').onclick = playPrev;
  $('btn-next').onclick = playNext;
  $('btn-loop').onclick = () => {
    state.config.loop_song = !state.config.loop_song;
    $('btn-loop').classList.toggle('is-active', state.config.loop_song);
    saveConfig();
  };

  bindSeek();
  bindHotkeyCapture();
  bindShortcuts();
}

function bindRange(id, prop, outId, fmt, after) {
  const el = $(id);
  el.oninput = () => {
    const v = parseFloat(el.value);
    setProp(prop, v);
    if (outId) setOut(outId, fmt ? fmt(v) : v);
    saveConfig();
    if (after) after();
  };
}

function bindCheck(id, prop, after) {
  const el = $(id);
  el.onchange = () => {
    setProp(prop, el.checked);
    saveConfig();
    if (after) after();
  };
}

function bindSeg(id, prop, after) {
  $$(`#${id} button`).forEach((b) => {
    b.onclick = () => {
      setProp(prop, b.dataset.val);
      updateSegment(id, b.dataset.val);
      saveConfig();
      if (after) after();
    };
  });
}

function setProp(path, val) {
  const parts = path.split('.');
  let o = state.config;
  while (parts.length > 1) o = o[parts.shift()];
  o[parts[0]] = val;
}

// ── Сиик: 1:1 за пальцем, отклик на pointer-down ───────────────────────────────

/** Общая перемотка: и полоса транспорта, и мини-карта в пианоролле. */
function seekTo(ms, src) {
  if (!state.song) return;
  // Во время воспроизведения перемотка наглухо закрыта: в этот момент ты в
  // игре, и любое событие мыши по окну (курсор залетел на второй монитор)
  // случайно. Перемотка — только на паузе.
  if (state.playing) {
    flog(`seek BLOCKED while playing src=${src || '?'} ms=${Math.round(ms)}`);
    return;
  }
  flog(`seekTo src=${src || '?'} ms=${Math.round(ms)}`);
  ms = Math.max(0, Math.min(state.song.durationMs, ms));
  invoke('seek', { ms });
  // force: наша собственная перемотка — приоритетнее любого тика. Без него
  // следующий устаревший тик (позиция ещё старая в Rust) откатил бы визуал.
  if (pianoroll) pianoroll.setPosition(ms, state.playing, state.config.speed, false, true);
  state.lastSeekAt = Date.now();
  const pct = state.song.durationMs ? (ms / state.song.durationMs) * 100 : 0;
  $('seek-fill').style.width = `${pct}%`;
  $('seek-knob').style.left = `${pct}%`;
  $('time-now').textContent = fmtTime(ms / 1000);
}

function bindSeek() {
  const track = $('seek');
  let id = null;

  const pctAt = (clientX) => {
    const r = track.getBoundingClientRect();
    return Math.max(0, Math.min(1, (clientX - r.left) / r.width));
  };

  track.addEventListener('pointerdown', (e) => {
    if (!state.song) return;
    // Перемотка разрешена только на паузе (во время игры — см. seekTo).
    // Фокус-гарды тут не нужны: пока пауза, случайный клик из игры не страшен,
    // а вот обычный драг они ломали.
    if (e.button !== 0) return;
    id = e.pointerId;
    track.setPointerCapture(id);
    track.classList.add('is-scrubbing');
    state.scrubbing = true;
    state.scrubAt = Date.now();
    // Отклик мгновенный: перематываем сразу, а не на отпускании.
    seekTo(pctAt(e.clientX) * state.song.durationMs, 'transport');
  });

  track.addEventListener('pointermove', (e) => {
    if (id === null || !state.song) return;
    state.scrubAt = Date.now();
    seekTo(pctAt(e.clientX) * state.song.durationMs, 'transport');
  });

  const end = () => {
    if (id === null) return;
    try {
      track.releasePointerCapture(id);
    } catch {}
    id = null;
    state.scrubbing = false;
    track.classList.remove('is-scrubbing');
  };
  track.addEventListener('pointerup', end);
  track.addEventListener('pointercancel', end);
  // Фокус ушёл из окна посреди перетаскивания — pointerup не придёт,
  // иначе scrubbing залипает и полоса навсегда перестаёт обновляться.
  window.addEventListener('blur', end);

  track.addEventListener('keydown', (e) => {
    if (!state.song || state.playing) return;
    const step = e.shiftKey ? 10000 : 2000;
    if (e.code === 'ArrowRight' || e.code === 'ArrowLeft') {
      e.preventDefault();
      const cur = pianoroll ? pianoroll.pos : 0;
      const ms = Math.max(0, Math.min(state.song.durationMs, cur + (e.code === 'ArrowRight' ? step : -step)));
      invoke('seek', { ms });
    }
  });
}

function bindShortcuts() {
  window.addEventListener('keydown', (e) => {
    const tag = e.target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    if (editor && editor.isOpen) return;
    if (!$('catalog-modal').hidden) return;

    flog(`keydown code=${e.code} shift=${e.shiftKey} playing=${state.playing} focus=${document.hasFocus()}`);
    // Во время игры песня сама жмёт клавиши (если фокус случайно на окне
    // приложения) — раскладки содержат пробел, Shift+цифры и стрелки.
    // Управляющие клавиши в этот момент молчат, иначе песня «водит» плеер.
    if (e.code === 'Space') {
      e.preventDefault();
      if (!state.playing) invoke('toggle_play');
    } else if (e.code === 'Escape') {
      e.preventDefault();
      invoke('stop');
    } else if (e.shiftKey && e.code === 'ArrowRight') {
      if (state.playing) return;
      e.preventDefault();
      playNext();
    } else if (e.shiftKey && e.code === 'ArrowLeft') {
      if (state.playing) return;
      e.preventDefault();
      playPrev();
    }
  });
}

function bindHotkeyCapture() {
  $$('.hkbtn').forEach((btn) => {
    btn.onclick = () => {
      if (btn.classList.contains('is-capturing')) return;
      btn.classList.add('is-capturing');
      const prev = btn.textContent;
      btn.textContent = t('hk.press');

      const done = (val) => {
        window.removeEventListener('keydown', onKey, true);
        btn.classList.remove('is-capturing');
        btn.textContent = val || prev;
      };
      const onKey = (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (e.code === 'Escape') return done(null);
        if (['ShiftLeft', 'ShiftRight', 'ControlLeft', 'ControlRight', 'AltLeft', 'AltRight'].includes(e.code)) return;
        const acc = accelFromEvent(e);
        if (!acc) return;
        state.config.hotkeys[btn.dataset.hk] = acc;
        saveConfig();
        done(acc);
      };
      window.addEventListener('keydown', onKey, true);
    };
  });
}

/** Строка для global-shortcut: `F5`, `CmdOrCtrl+Shift+P`. */
function accelFromEvent(e) {
  let key = null;
  if (/^F([1-9]|1[0-2])$/.test(e.code)) key = e.code;
  else if (/^Key[A-Z]$/.test(e.code)) key = e.code.slice(3);
  else if (/^Digit[0-9]$/.test(e.code)) key = e.code.slice(5);
  else if (e.code === 'Space') key = 'Space';
  else if (e.code === 'Insert') key = 'Insert';
  else if (e.code === 'Home') key = 'Home';
  else if (e.code === 'End') key = 'End';
  else if (e.code === 'PageUp') key = 'PageUp';
  else if (e.code === 'PageDown') key = 'PageDown';
  if (!key) return null;
  const mods = [];
  if (e.ctrlKey) mods.push('Ctrl');
  if (e.altKey) mods.push('Alt');
  if (e.shiftKey) mods.push('Shift');
  return mods.concat(key).join('+');
}

// ── Тема ───────────────────────────────────────────────────────────────────────

function applyTheme(dark) {
  if (dark) document.body.setAttribute('data-theme', 'dark');
  else document.body.removeAttribute('data-theme');
  $('theme-toggle').classList.toggle('is-dark', dark);
  if (pianoroll) pianoroll.refreshTheme();
}

// ── Плейлист ───────────────────────────────────────────────────────────────────

function addPaths(paths) {
  let added = 0;
  for (const p of paths) {
    if (!state.playlist.includes(p)) {
      state.playlist.push(p);
      added++;
    }
  }
  if (added) {
    renderPlaylist();
    saveConfig();
  }
  return added;
}

async function pickFiles() {
  const btn = $('add-files');
  btn.disabled = true;
  try {
    const files = await invoke('pick_midi_files');
    const n = addPaths(files || []);
    if (n) toast(t('toast.added').replace('{n}', n));
    else if (files && files.length) toast(t('toast.dupes'));
  } catch (e) {
    toast(String(e), 'err');
  } finally {
    btn.disabled = false;
  }
}

// Перезагрузка папки songs/: подтягивает файлы, скачанные после запуска.
async function rescanSongs() {
  const btn = $('btn-rescan');
  btn.disabled = true;
  btn.classList.add('is-spinning');
  try {
    const files = (await invoke('rescan_songs')) || [];
    const n = addPaths(files);
    if (n) toast(t('toast.added').replace('{n}', n));
    else toast(t('toast.rescanEmpty'));
  } catch (e) {
    toast(String(e), 'err');
  } finally {
    btn.disabled = false;
    btn.classList.remove('is-spinning');
  }
}

async function bindDragDrop() {
  const ns = window.__TAURI__.webview;
  const target = ns && ns.getCurrentWebview ? ns.getCurrentWebview() : getCurrentWindow();
  if (!target || !target.onDragDropEvent) return;
  const drop = $('drop-hint');
  try {
    await target.onDragDropEvent(async (e) => {
      const p = e.payload;
      if (p.type === 'over' || p.type === 'enter') {
        document.body.classList.add('is-dragging');
        if (drop) drop.hidden = false;
      } else if (p.type === 'leave') {
        document.body.classList.remove('is-dragging');
        if (drop) drop.hidden = true;
      } else if (p.type === 'drop') {
        document.body.classList.remove('is-dragging');
        if (drop) drop.hidden = true;
        const paths = await invoke('expand_midi_paths', { paths: p.paths || [] });
        if (!paths.length) return toast(t('toast.nomidi'), 'err');
        const n = addPaths(paths);
        toast(n ? t('toast.added').replace('{n}', n) : t('toast.dupes'));
        if (n && state.index < 0) playIndex(state.playlist.length - n);
      }
    });
  } catch (e) {
    console.warn('drag-drop недоступен', e);
  }
}

function renderPlaylist() {
  const list = $('playlist');
  list.innerHTML = state.playlist
    .map((p, i) => {
      const name = p.split(/[\\/]/).pop().replace(/\.(mid|midi|rmi)$/i, '');
      return `<li class="playlist__item ${i === state.index ? 'is-active' : ''}" data-idx="${i}" title="${esc(p)}">
        <span class="playlist__bars" aria-hidden="true"><i></i><i></i><i></i></span>
        <span class="playlist__name">${esc(name)}</span>
        <button class="winbtn btn-remove" aria-label="×"><svg viewBox="0 0 12 12"><path d="M3 3l6 6M9 3l-6 6"/></svg></button>
      </li>`;
    })
    .join('');

  $('playlist-count').textContent = state.playlist.length;
  $('playlist-empty').hidden = state.playlist.length > 0;

  list.querySelectorAll('.playlist__item').forEach((li) => {
    const idx = Number(li.dataset.idx);
    li.onclick = (e) => {
      if (!e.target.closest('.btn-remove')) playIndex(idx);
    };
    li.querySelector('.btn-remove').onclick = (e) => {
      e.stopPropagation();
      state.playlist.splice(idx, 1);
      if (state.index === idx) {
        state.index = -1;
        invoke('stop');
        clearSong();
      } else if (state.index > idx) state.index--;
      renderPlaylist();
      saveConfig();
    };
  });
}

function clearSong() {
  state.song = null;
  dbg.lastMs = 0;
  $('song-title').textContent = t('stage.nothing');
  $('song-chips').innerHTML = '';
  $('time-total').textContent = '0:00';
  $('time-now').textContent = '0:00';
  $('seek-fill').style.width = '0%';
  $('seek-knob').style.left = '0%';
  $('tracklist').innerHTML = '';
  if (pianoroll) {
    pianoroll.setSong(null);
    pianoroll.reset();
  }
}

async function playIndex(idx) {
  if (idx < 0 || idx >= state.playlist.length) return;
  state.index = idx;
  renderPlaylist();
  const path = state.playlist[idx];
  try {
    const res = await invoke('load_song', { path });
    state.song = res.song;
    state.muted = new Set();

    $('song-title').textContent = res.song.name;
    $('time-total').textContent = fmtTime(res.song.durationMs / 1000);
    renderChips();
    renderTracks();

    state.config.transpose = res.transpose;
    setRange('transpose', res.transpose, 'out-transpose');
    updateCoverage(res.coverage);

    pianoroll.setSong(res.song);
    pianoroll.setMuted(state.muted);
    refreshLayoutView();
    invoke('play');
  } catch (e) {
    toast(`${path.split(/[\\/]/).pop()}: ${e}`, 'err');
    state.index = -1;
    renderPlaylist();
  }
}

function playNext() {
  flog('playNext');
  if (state.playlist.length) playIndex((state.index + 1) % state.playlist.length);
}
function playPrev() {
  flog('playPrev');
  if (state.playlist.length) playIndex((state.index - 1 + state.playlist.length) % state.playlist.length);
}

function renderChips() {
  const s = state.song;
  if (!s) return;
  const chips = [
    fmtTime(s.durationMs / 1000),
    `${Math.round(s.tempoBpm)} BPM`,
    `${s.notes.length} ${t('chip.notes')}`,
    `${s.tracks.length} ${t('chip.tracks')}`,
  ];
  $('song-chips').innerHTML = chips.map((c) => `<span class="chip">${esc(c)}</span>`).join('');
}

function renderTracks() {
  const s = state.song;
  const box = $('tracklist');
  if (!s || !s.tracks.length) {
    box.innerHTML = `<p class="hint">${t('tracks.none')}</p>`;
    return;
  }
  box.innerHTML = s.tracks
    .map(
      (tr) => `<label class="trackrow">
        <input type="checkbox" data-track="${tr.index}" ${state.muted.has(tr.index) ? '' : 'checked'} />
        <span class="trackrow__name">${esc(tr.name || `Track ${tr.index + 1}`)}</span>
        <span class="trackrow__meta">${tr.hasDrums ? '🥁 ' : ''}${tr.noteCount}</span>
      </label>`
    )
    .join('');

  box.querySelectorAll('input[type=checkbox]').forEach((cb) => {
    cb.onchange = async () => {
      const idx = Number(cb.dataset.track);
      if (cb.checked) state.muted.delete(idx);
      else state.muted.add(idx);
      const cov = await invoke('set_muted_tracks', { tracks: Array.from(state.muted) });
      updateCoverage(cov);
      pianoroll.setMuted(state.muted);
    };
  });
}

// ── События плеера ─────────────────────────────────────────────────────────────

function bindPlayerEvents() {
  listen('player', (e) => {
    const p = e.payload;
    if (p.kind === 'tick') onTick(p);
    else if (p.kind === 'ended') {
      dbgFlash('⟲ Ended (конец песни)');
      state.playing = false;
      updateTransport();
      if (state.config.autoplay_next && state.playlist.length > 1) playNext();
    } else if (p.kind === 'stopped') {
      flog('event stopped');
      dbgFlash('⟲ Stopped (сброс в 0)');
      state.playing = false;
      updateTransport();
      onTick({ positionUs: 0, playing: false });
    }
  });

  listen('hotkey', (e) => {
    flog(`hotkey ${e.payload}`);
    if (e.payload === 'next') playNext();
    else if (e.payload === 'prev') playPrev();
  });
}

// ── Временная диагностика «дорожка прыгает в начало» ──────────────────────────
const dbg = { lastMs: 0, events: 0, lastFlash: '' };
function dbgFlash(text) {
  dbg.lastFlash = text;
  const el = $('dbg-stat');
  if (!el) return;
  el.style.color = '#fb7185';
  el.textContent = text;
  setTimeout(() => (el.style.color = ''), 2500);
}
function initDebugChip() {
  const bar = document.querySelector('.statusbar');
  if (!bar || $('dbg-stat')) return;
  const stat = document.createElement('div');
  stat.className = 'stat';
  stat.id = 'dbg-stat';
  stat.style.fontVariantNumeric = 'tabular-nums';
  stat.innerHTML = `<span class="stat__k">dbg</span> <span class="stat__v">—</span>`;
  bar.appendChild(stat);
  setInterval(() => {
    const el = $('dbg-stat');
    if (!el) return;
    if (Date.now() - (dbg.lastEvAt || 0) > 3000) {
      el.querySelector('.stat__v').textContent = 'НЕТ СОБЫТИЙ';
      el.style.color = '#fbbf24';
    } else {
      el.style.color = '';
      el.querySelector('.stat__v').textContent =
        `${Math.round(dbg.lastMs)}мс ev:${dbg.events} fps:${pianoroll ? pianoroll._fpsShown ?? pianoroll.fps ?? 0 : '?'} clk:${pianoroll ? pianoroll.clockGlitches || 0 : '?'}`;
    }
    dbg.events = 0;
  }, 1000);
}

function onTick(p) {
  state.playing = !!p.playing;
  updateTransport();

  // Залипший драг (pointerup потерялся при потере фокуса) — снимаем сам.
  if (state.scrubbing && Date.now() - (state.scrubAt || 0) > 1500) {
    state.scrubbing = false;
    $('seek').classList.remove('is-scrubbing');
  }

  const ms = (p.positionUs || 0) / 1000;
  dbg.events++;
  dbg.lastEvAt = Date.now();
  if (ms < dbg.lastMs - 1500 && !p.countdown) {
    dbgFlash(`⟲ СБРОС ${Math.round(dbg.lastMs)}→${Math.round(ms)}мс`);
  }
  dbg.lastMs = ms;
  if (!state.scrubbing) {
    $('time-now').textContent = fmtTime(ms / 1000);
    if (state.song && state.song.durationMs > 0) {
      const pct = Math.max(0, Math.min(100, (ms / state.song.durationMs) * 100));
      $('seek-fill').style.width = `${pct}%`;
      $('seek-knob').style.left = `${pct}%`;
    }
    if (pianoroll) {
      pianoroll.setPosition(ms, p.playing, state.config.speed, p.guardBlocked);
      pianoroll.keepAlive();
    }
  }

  $('guard-toast').hidden = !p.guardBlocked;
  const cd = $('countdown');
  if (p.countdown > 0) {
    cd.hidden = false;
    $('countdown-num').textContent = Math.ceil(p.countdown);
  } else cd.hidden = true;
}

function updateTransport() {
  $('btn-play').classList.toggle('is-playing', state.playing);
  document.body.classList.toggle('is-playing', state.playing);
}

// ── Статусбар / покрытие ───────────────────────────────────────────────────────

function updateCoverage(cov) {
  if (!cov) return;
  const el = $('stat-coverage');
  const pct = Math.round(cov.percent);
  el.textContent = `${pct}%`;
  el.classList.toggle('is-warn', pct < 85 && cov.total > 0);
  el.title = `${cov.playable} / ${cov.total} · ниже ${cov.tooLow} · выше ${cov.tooHigh}`;
  updateStats();
}

function updateStats() {
  const c = state.config;
  $('stat-transpose').textContent = (c.transpose > 0 ? '+' : '') + c.transpose;
  $('stat-speed').textContent = Number(c.speed).toFixed(2) + '×';
  updateLayoutDesc();
}

const refreshCoverage = debounce(async () => {
  if (!state.song) return;
  try {
    updateCoverage(await invoke('get_coverage'));
  } catch {}
}, 200);

// ── Каталог BitMidi ────────────────────────────────────────────────────────────

function openCatalog() {
  const modal = $('catalog-modal');
  modal.hidden = false;
  $('catalog-search').focus();
  if (!$('catalog-results').dataset.loaded) searchCatalog('');
}

function bindCatalog() {
  const modal = $('catalog-modal');
  const close = () => (modal.hidden = true);
  $('catalog-close').onclick = close;
  $('catalog-scrim').onclick = close;
  $('catalog-btn-search').onclick = () => searchCatalog($('catalog-search').value.trim());
  $('catalog-search').onkeydown = (e) => {
    if (e.key === 'Enter') searchCatalog($('catalog-search').value.trim());
    if (e.key === 'Escape') close();
  };
}

async function searchCatalog(query) {
  const box = $('catalog-results');
  box.dataset.loaded = '1';
  box.innerHTML = `<p class="hint">${t('cat.loading')}</p>`;
  let tracks = [];
  try {
    const raw = await invoke('fetch_catalog', { query });
    const json = JSON.parse(raw);
    tracks = (json && json.result && json.result.results) || [];
  } catch (e) {
    box.innerHTML = `<p class="hint hint--err">${t('cat.error')}</p>`;
    return;
  }
  if (!tracks.length) {
    box.innerHTML = `<p class="hint">${t('cat.empty')}</p>`;
    return;
  }

  box.innerHTML = tracks
    .map((tr, i) => {
      const name = (tr.name || '').replace(/\.mid$/i, '') || `track ${i + 1}`;
      const plays = tr.plays ? `${tr.plays}` : '';
      return `<div class="catrow">
        <div class="catrow__body">
          <div class="catrow__name">${esc(name)}</div>
          ${plays ? `<div class="catrow__meta">${esc(plays)} ▶</div>` : ''}
        </div>
        <button class="btn btn-dl" data-i="${i}">${t('cat.get')}</button>
      </div>`;
    })
    .join('');

  box.querySelectorAll('.btn-dl').forEach((btn) => {
    btn.onclick = async () => {
      const tr = tracks[Number(btn.dataset.i)];
      const url = tr.downloadUrl || tr.url;
      if (!url) return toast(t('cat.error'), 'err');
      const label = btn.textContent;
      btn.disabled = true;
      btn.textContent = '…';
      try {
        const path = await invoke('download_midi_curl', {
          url,
          name: (tr.name || 'midi').replace(/\.mid$/i, ''),
        });
        addPaths([path]);
        btn.textContent = '✓';
        btn.classList.add('is-done');
      } catch (e) {
        btn.disabled = false;
        btn.textContent = label;
        toast(String(e), 'err');
      }
    };
  });
}

// ── Утилиты ────────────────────────────────────────────────────────────────────

function fmtTime(s) {
  if (!isFinite(s) || s < 0) s = 0;
  const m = Math.floor(s / 60);
  return `${m}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function debounce(fn, ms) {
  let h;
  return (...a) => {
    clearTimeout(h);
    h = setTimeout(() => fn(...a), ms);
  };
}

bindCatalog();
bootstrap().catch((e) => {
  console.error(e);
  document.body.insertAdjacentHTML(
    'afterbegin',
    `<pre style="position:fixed;inset:auto 16px 16px 16px;z-index:999;background:#b00;color:#fff;padding:12px;border-radius:8px;white-space:pre-wrap">${String(e)}</pre>`
  );
});

// Диагностика: пишем события фронта в vmp_debug.log.
const flog = (msg) => { try { invoke('dbg_front', { msg }); } catch (_) {} };
