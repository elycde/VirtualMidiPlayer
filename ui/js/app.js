const { invoke } = window.__TAURI__.core;
const { listen } = window.__TAURI__.event;
const { getCurrentWindow } = window.__TAURI__.window;

import { initI18n } from './i18n.js';
import { Pianoroll } from './pianoroll.js';
import { Editor } from './editor.js';

let appState = {
    config: {},
    layouts: [],
    playlist: [],
    currentIndex: -1,
    song: null,
    isPlaying: false
};

const pianoroll = new Pianoroll(document.getElementById('roll'));
const editor = new Editor();

async function bootstrap() {
    const data = await invoke('bootstrap');
    appState.config = data.config;
    appState.layouts = data.layouts;
    document.getElementById('data-dir').innerText = data.data_dir;
    document.getElementById('version').innerText = `v${data.version}`;
    
    updateSettingsUI();
    setupEventListeners();
    setupTauriEvents();
}

function updateSettingsUI() {
    const c = appState.config;
    document.getElementById('transpose').value = c.transpose;
    document.getElementById('out-transpose').innerText = c.transpose;
    document.getElementById('auto-fit').checked = c.auto_fit;
    document.getElementById('countdown-s').value = c.countdown_s;
    document.getElementById('out-countdown').innerText = c.countdown_s;
    document.getElementById('window-guard').checked = c.window_guard;
    document.getElementById('window-title').value = c.window_title;
    document.getElementById('force-en').checked = c.force_en_layout;
    document.getElementById('speed').value = c.speed;
    document.getElementById('out-speed').innerText = c.speed.toFixed(2) + 'Г—';
    document.getElementById('tap-ms').value = c.tap_ms;
    document.getElementById('out-tap').innerText = c.tap_ms;
    document.getElementById('chord-gap').value = c.chord_gap_ms;
    document.getElementById('out-gap').innerText = c.chord_gap_ms;
    document.getElementById('humanize').value = c.humanize_ms;
    document.getElementById('out-humanize').innerText = c.humanize_ms;
    document.getElementById('max-chord').value = c.max_chord;
    document.getElementById('out-maxchord').innerText = c.max_chord || 'в€ћ';
    document.getElementById('min-velocity').value = c.min_velocity;
    document.getElementById('out-minvel').innerText = c.min_velocity;
    document.getElementById('ignore-drums').checked = c.ignore_drums;
    document.getElementById('hotkeys-enabled').checked = c.hotkeys.enabled;
    
    // Selects / Segments
    const layoutSelect = document.getElementById('layout-select');
    layoutSelect.innerHTML = appState.layouts.map(l => `<option value="${l.id}">${l.name}</option>`).join('');
    layoutSelect.value = c.layout_id;

    updateSegment('oor', c.out_of_range);
    updateSegment('send-mode', c.send_mode);
    updateSegment('hold-mode', c.hold_mode);

    document.body.setAttribute('data-accent', c.accent);
}

function updateSegment(id, val) {
    document.querySelectorAll(`#${id} button`).forEach(b => {
        b.classList.toggle('is-active', b.dataset.val === val);
    });
}

function setupEventListeners() {
    // Window controls
    document.getElementById('win-min').onclick = () => getCurrentWindow().minimize();
    document.getElementById('win-max').onclick = async () => {
        const win = getCurrentWindow();
        await win.isMaximized() ? win.unmaximize() : win.maximize();
    };
    document.getElementById('win-close').onclick = () => getCurrentWindow().close();

    // Tabs
    document.querySelectorAll('.tab').forEach(tab => {
        tab.onclick = () => {
            document.querySelectorAll('.tab').forEach(t => t.classList.remove('is-active'));
            document.querySelectorAll('.tabpane').forEach(p => p.classList.remove('is-active'));
            tab.classList.add('is-active');
            document.querySelector(`.tabpane[data-pane="${tab.dataset.tab}"]`).classList.add('is-active');
        };
    });

    // Playlist
    document.getElementById('add-files').onclick = async () => {
        const files = await invoke('pick_midi_files');
        if (files && files.length > 0) {
            files.forEach(f => {
                if (!appState.playlist.includes(f)) {
                    appState.playlist.push(f);
                }
            });
            renderPlaylist();
        }
    };

    // Settings changes
    const configSaveDelay = debounce(() => invoke('save_config', { config: appState.config }), 300);
    const bindRange = (id, prop, outId, format = v => v) => {
        const el = document.getElementById(id);
        el.oninput = () => {
            appState.config[prop] = parseFloat(el.value);
            if (outId) document.getElementById(outId).innerText = format(el.value);
            configSaveDelay();
        };
    };
    const bindCheck = (id, prop) => {
        const el = document.getElementById(id);
        el.onchange = () => {
            appState.config[prop] = el.checked;
            configSaveDelay();
        };
    };

    bindRange('transpose', 'transpose', 'out-transpose');
    bindRange('countdown-s', 'countdown_s', 'out-countdown');
    bindRange('speed', 'speed', 'out-speed', v => parseFloat(v).toFixed(2) + 'Г—');
    bindRange('tap-ms', 'tap_ms', 'out-tap');
    bindRange('chord-gap', 'chord_gap_ms', 'out-gap');
    bindRange('humanize', 'humanize_ms', 'out-humanize');
    bindRange('max-chord', 'max_chord', 'out-maxchord', v => v === '0' ? 'в€ћ' : v);
    bindRange('min-velocity', 'min_velocity', 'out-minvel');
    
    bindCheck('auto-fit', 'auto_fit');
    bindCheck('window-guard', 'window_guard');
    bindCheck('force-en', 'force_en_layout');
    bindCheck('ignore-drums', 'ignore_drums');
    
    document.querySelectorAll('#speed-presets button').forEach(b => {
        b.onclick = () => {
            appState.config.speed = parseFloat(b.dataset.val);
            document.getElementById('speed').value = appState.config.speed;
            document.getElementById('out-speed').innerText = appState.config.speed.toFixed(2) + 'Г—';
            configSaveDelay();
        };
    });
    
    document.getElementById('window-title').onchange = (e) => {
        appState.config.window_title = e.target.value;
        configSaveDelay();
    };

    const bindSeg = (id, prop) => {
        document.querySelectorAll(`#${id} button`).forEach(b => {
            b.onclick = () => {
                appState.config[prop] = b.dataset.val;
                updateSegment(id, b.dataset.val);
                configSaveDelay();
            };
        });
    };
    bindSeg('oor', 'out_of_range');
    bindSeg('send-mode', 'send_mode');
    bindSeg('hold-mode', 'hold_mode');

    document.querySelectorAll('#accents button').forEach(b => {
        b.classList.toggle('is-active', b.dataset.val === appState.config.accent);
        b.onclick = () => {
            appState.config.accent = b.dataset.val;
            document.body.setAttribute('data-accent', b.dataset.val);
            document.querySelectorAll('#accents button').forEach(btn => btn.classList.remove('is-active'));
            b.classList.add('is-active');
            configSaveDelay();
        };
    });

    document.getElementById('layout-select').onchange = async (e) => {
        const id = e.target.value;
        const res = await invoke('set_layout', { id });
        updateCoverageUI(res);
        appState.config.layout_id = id;
    };
    
    document.getElementById('open-data').onclick = () => invoke('open_data_folder');

    // Transport
    document.getElementById('btn-play').onclick = () => invoke('toggle_play');
    document.getElementById('btn-stop').onclick = () => invoke('stop');
    document.getElementById('btn-panic').onclick = () => invoke('panic_release');
    document.getElementById('btn-prev').onclick = playPrev;
    document.getElementById('btn-next').onclick = playNext;

    document.getElementById('seek').onclick = (e) => {
        if (!appState.song) return;
        const rect = e.target.getBoundingClientRect();
        const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
        invoke('seek', { ms: pct * appState.song.duration_ms });
    };
}

function setupTauriEvents() {
    listen('player', (e) => {
        const payload = e.payload;
        if (payload.kind === 'tick') {
            updateTickUI(payload);
        } else if (payload.kind === 'ended') {
            if (document.getElementById('autoplay-next').checked) {
                playNext();
            } else {
                appState.isPlaying = false;
                updateTransportUI();
            }
        } else if (payload.kind === 'stopped') {
            appState.isPlaying = false;
            updateTransportUI();
            updateTickUI({ positionUs: 0 });
        }
    });

    listen('hotkey', (e) => {
        const action = e.payload;
        if (action === 'togglePlay') invoke('toggle_play');
        if (action === 'stop') invoke('stop');
        if (action === 'panic') invoke('panic_release');
        if (action === 'prev') playPrev();
        if (action === 'next') playNext();
    });
}

function debounce(fn, ms) {
    let t;
    return (...args) => {
        clearTimeout(t);
        t = setTimeout(() => fn(...args), ms);
    };
}

function renderPlaylist() {
    const list = document.getElementById('playlist');
    list.innerHTML = appState.playlist.map((p, i) => {
        const name = p.split(/[\\/]/).pop();
        const active = i === appState.currentIndex ? 'is-active' : '';
        return `<li class="playlist__item ${active}" data-idx="${i}">
            <div class="playlist__name">${name}</div>
            <button class="winbtn btn-remove">вњ•</button>
        </li>`;
    }).join('');
    
    document.getElementById('playlist-count').innerText = appState.playlist.length;
    document.getElementById('playlist-empty').hidden = appState.playlist.length > 0;

    list.querySelectorAll('.playlist__item').forEach(li => {
        li.onclick = (e) => {
            if (!e.target.closest('.btn-remove')) {
                playIndex(parseInt(li.dataset.idx));
            }
        };
        li.querySelector('.btn-remove').onclick = (e) => {
            e.stopPropagation();
            const idx = parseInt(li.dataset.idx);
            appState.playlist.splice(idx, 1);
            if (appState.currentIndex === idx) {
                appState.currentIndex = -1;
                invoke('stop');
            } else if (appState.currentIndex > idx) {
                appState.currentIndex--;
            }
            renderPlaylist();
        };
    });
}

async function playIndex(idx) {
    if (idx < 0 || idx >= appState.playlist.length) return;
    appState.currentIndex = idx;
    renderPlaylist();
    const path = appState.playlist[idx];
    const res = await invoke('load_song', { path });
    appState.song = res.song;
    document.getElementById('song-title').innerText = res.song.name;
    document.getElementById('time-total').innerText = formatTime(res.song.duration_ms / 1000);
    updateCoverageUI(res.coverage);
    document.getElementById('transpose').value = res.transpose;
    document.getElementById('out-transpose').innerText = res.transpose;
    appState.config.transpose = res.transpose;
    
    pianoroll.setSong(res.song);
    invoke('play');
}

function playNext() {
    if (appState.playlist.length > 0) {
        playIndex((appState.currentIndex + 1) % appState.playlist.length);
    }
}
function playPrev() {
    if (appState.playlist.length > 0) {
        playIndex((appState.currentIndex - 1 + appState.playlist.length) % appState.playlist.length);
    }
}

function formatTime(s) {
    const mins = Math.floor(s / 60);
    const secs = Math.floor(s % 60).toString().padStart(2, '0');
    return `${mins}:${secs}`;
}

function updateTickUI(payload) {
    if (payload.positionUs !== undefined) {
        const ms = payload.positionUs / 1000;
        document.getElementById('time-now').innerText = formatTime(ms / 1000);
        if (appState.song) {
            const pct = (ms / appState.song.duration_ms) * 100;
            document.getElementById('seek-fill').style.width = `${pct}%`;
            document.getElementById('seek-knob').style.left = `${pct}%`;
            pianoroll.updatePosition(ms);
        }
    }
    
    appState.isPlaying = payload.playing || false;
    updateTransportUI();

    const guardEl = document.getElementById('guard-toast');
    if (guardEl) guardEl.hidden = !payload.guardBlocked;
    
    const countEl = document.getElementById('countdown');
    if (countEl) {
        if (payload.countdown > 0) {
            countEl.hidden = false;
            document.getElementById('countdown-num').innerText = Math.ceil(payload.countdown);
        } else {
            countEl.hidden = true;
        }
    }
}

function updateTransportUI() {
    const btn = document.getElementById('btn-play');
    btn.classList.toggle('is-playing', appState.isPlaying);
}

function updateCoverageUI(cov) {
    document.getElementById('stat-coverage').innerText = `${cov.total > 0 ? Math.round(cov.covered / cov.total * 100) : 0}%`;
}

initI18n();
bootstrap();

// Add global keydown bindings
window.addEventListener('keydown', (e) => {
    // Ignore input fields and layout editor modal
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    if (document.getElementById('ed-modal') && !document.getElementById('ed-modal').hidden) return;

    if (e.code === 'Space') {
        e.preventDefault();
        invoke('toggle_play');
    }
    if (e.code === 'Escape') {
        e.preventDefault();
        invoke('stop');
    }
});

// Setup theme toggle
const themeBtn = document.getElementById('theme-toggle');
if (themeBtn) {
    let isDark = localStorage.getItem('theme') === 'dark';
    const applyTheme = (dark) => {
        if (dark) {
            document.body.setAttribute('data-theme', 'dark');
        } else {
            document.body.removeAttribute('data-theme');
        }
        if (window.pianoroll) {
            window.pianoroll.draw(); // Redraw with new colors
        }
    };
    applyTheme(isDark);
    themeBtn.addEventListener('click', () => {
        isDark = !isDark;
        localStorage.setItem('theme', isDark ? 'dark' : 'light');
        applyTheme(isDark);
    });
}

// Catalog Logic
const btnCatalog = document.getElementById('btn-catalog');
const catModal = document.getElementById('catalog-modal');
const catClose = document.getElementById('catalog-close');
const catScrim = document.getElementById('catalog-scrim');
const catSearchBtn = document.getElementById('catalog-btn-search');
const catSearchInput = document.getElementById('catalog-search');
const catResults = document.getElementById('catalog-results');

if (btnCatalog) {
    const closeCat = () => { catModal.hidden = true; };
    btnCatalog.onclick = () => {
        catModal.hidden = false;
        if (catResults.innerHTML.trim() === '') doSearch('');
    };
    catClose.onclick = closeCat;
    catScrim.onclick = closeCat;
    
    const doSearch = async (query) => {
        catResults.innerHTML = '<p class="hint">Загрузка...</p>';
        try {
            const raw = await invoke('fetch_catalog', { query });
            const json = JSON.parse(raw);
            const tracks = json.result.results;
            if (!tracks || tracks.length === 0) {
                catResults.innerHTML = '<p class="hint">Ничего не найдено.</p>';
                return;
            }
            
            catResults.innerHTML = tracks.map(t => ` 
                <div class="tracklist__row" style="margin-bottom: 8px;">
                    <div class="tracklist__name" style="flex:1;"></div>
                    <button class="btn btn-dl" data-url="" data-name="">Загрузить</button>
                </div>
            `).join('');
            
            catResults.querySelectorAll('.btn-dl').forEach(btn => {
                btn.onclick = async () => {
                    const oldHtml = btn.innerHTML;
                    btn.innerHTML = '...';
                    btn.disabled = true;
                    try {
                        const dlPath = await invoke('download_midi_curl', { 
                            url: btn.dataset.url, 
                            name: btn.dataset.name 
                        });
                        appState.playlist.push(dlPath);
                        renderPlaylist();
                        btn.innerHTML = '?';
                    } catch (e) {
                        console.error(e);
                        btn.innerHTML = 'Ошибка';
                    }
                };
            });
            
        } catch (e) {
            catResults.innerHTML = '<p class="hint" style="color:#f44336">Ошибка загрузки каталога</p>';
        }
    };
    
    catSearchBtn.onclick = () => doSearch(catSearchInput.value);
    catSearchInput.onkeydown = (e) => { if (e.key === 'Enter') doSearch(catSearchInput.value); };
}
