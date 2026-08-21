// Пианоролл: вертикальная клавиатура слева, ноты едут справа налево и «влетают»
// в клавишу ровно в момент нажатия (метафора Synthesia, повёрнутая на 90°).
//
// Позиция приходит тиками из Rust (десятки герц), а рисуем мы каждый кадр:
// между тиками положение экстраполируется по скорости и подтягивается
// фильтром низких частот — иначе дорожки дёргаются на каждом тике.

const BLACK = [1, 3, 6, 8, 10];
const isBlack = (k) => BLACK.includes(((k % 12) + 12) % 12);

const LOOKAHEAD_MS = 3400; // сколько будущего видно справа
const MINIMAP_H = 30; // полоса «вся песня» сверху
const MINIMAP_GAP = 8;

export class Pianoroll {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: true });
    this.dpr = 1;

    this.song = null;
    this.notes = [];
    this.starts = []; // отдельный массив начал — для бинарного поиска

    this.lo = 36;
    this.hi = 84;

    this.playable = null; // Set<u8> нот раскладки (уже без транспонирования)
    this.transpose = 0;
    this.muted = new Set();

    // Тайминг
    this.pos = 0; // отрисованная позиция, мс
    this.playing = false;
    this.blocked = false; // «страж окна» держит песню — визуал тоже стоит
    this.speed = 1;

    this.reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change', (e) => {
      this.reduced = e.matches;
    });

    this.theme = null;
    this.minimap = null; // офскрин с полной дорожкой
    this.onSeek = null; // колбэк клика по мини-карте: (ms) => {}

    this._mmScrub = null; // активный драг по мини-карте
    this._mmIgnore = null; // жест «клик по неактивному окну» — только фокус
    this._onPointerDown = (e) => {
      if (!this.song || !this.onSeek) return;
      if (!this.inMinimap(e)) return;
      // Перемотка по мини-карте разрешена только на паузе (во время игры —
      // см. seekTo в app.js). Драг работает как у полосы транспорта: 1:1.
      if (e.button !== 0) return;
      this._mmScrub = e.pointerId;
      try { this.canvas.setPointerCapture(e.pointerId); } catch {}
      this.seekByPointer(e, true);
    };
    this._onPointerMove = (e) => {
      if (this._mmIgnore === e.pointerId) return;
      if (this._mmScrub === e.pointerId) {
        this.seekByPointer(e);
        return;
      }
      this.canvas.style.cursor = this.inMinimap(e) && this.song ? 'pointer' : 'default';
    };
    this._onPointerUp = (e) => {
      if (this._mmIgnore === e.pointerId) {
        this._mmIgnore = null;
        return;
      }
      if (this._mmScrub === e.pointerId) {
        try { this.canvas.releasePointerCapture(e.pointerId); } catch {}
        this._mmScrub = null;
      }
    };
    this.canvas.addEventListener('pointerdown', this._onPointerDown);
    this.canvas.addEventListener('pointermove', this._onPointerMove);
    this.canvas.addEventListener('pointerup', this._onPointerUp);
    this.canvas.addEventListener('pointercancel', this._onPointerUp);
    // Фокус ушёл из окна — любой захват/ждущий жест мёртв, сбрасываем.
    this._onBlur = () => {
      if (this._mmScrub !== null) {
        try {
          this.canvas.releasePointerCapture(this._mmScrub);
        } catch {}
      }
      this._mmScrub = null;
      this._mmIgnore = null;
    };
    window.addEventListener('blur', this._onBlur);
    // Возраст фокуса: клик, который сам фокусит окно (курсор из игры залетел
    // на второй монитор), перемоткой не считается — окно должно быть в фокусе
    // ДО клика.
    this._focusedAt = document.hasFocus() ? performance.now() : -1e9;
    this._onFocus = () => (this._focusedAt = performance.now());
    window.addEventListener('focus', this._onFocus);

    this._raf = null;
    this._onResize = () => this.resize();
    window.addEventListener('resize', this._onResize);
    if (window.ResizeObserver) {
      this._ro = new ResizeObserver(this._onResize);
      this._ro.observe(canvas.parentElement);
    }

    this.resize();
    this.loop();

    // Подстраховка от фоновой «заморозки» WebView: если rAF душится, когда окно
    // без фокуса (ты в игре), таймер хотя бы раз в секунду перерисует кадр.
    this._bgTimer = setInterval(() => this.draw(), 1000);
  }

  // ── Геометрия ────────────────────────────────────────────────────────────────

  resize() {
    const parent = this.canvas.parentElement;
    const w = Math.max(1, parent.clientWidth);
    const h = Math.max(1, parent.clientHeight);
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.canvas.width = Math.round(w * this.dpr);
    this.canvas.height = Math.round(h * this.dpr);
    this.canvas.style.width = w + 'px';
    this.canvas.style.height = h + 'px';
    this.w = w;
    this.h = h;
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.layout();
    this.buildMinimap();
  }

  /** Пересчитывает полосы клавиш. Низкие ноты снизу, высокие сверху. */
  layout() {
    const kbW = Math.round(Math.min(120, Math.max(64, this.w * 0.11)));
    this.kbW = kbW;
    this.rollTop = MINIMAP_H + MINIMAP_GAP;
    this.rollH = Math.max(40, this.h - this.rollTop);

    let whites = 0;
    for (let k = this.lo; k <= this.hi; k++) if (!isBlack(k)) whites++;
    const whiteH = this.rollH / Math.max(1, whites);
    const blackH = Math.max(3, whiteH * 0.62);

    this.keys = new Map();
    let whiteIdx = 0;
    const bottom = this.h;
    for (let k = this.lo; k <= this.hi; k++) {
      if (isBlack(k)) {
        // Чёрная клавиша сидит на стыке белых — центр на границе.
        const edge = bottom - whiteIdx * whiteH;
        this.keys.set(k, { y: edge - blackH / 2, hh: blackH, black: true, cy: edge });
      } else {
        const y = bottom - (whiteIdx + 1) * whiteH;
        this.keys.set(k, { y, hh: whiteH, black: false, cy: y + whiteH / 2 });
        whiteIdx++;
      }
    }
    this.whiteH = whiteH;
    this.pxPerMs = (this.w - kbW) / LOOKAHEAD_MS;
  }

  /** Левая граница зоны нот (клавиатура справа). */
  get rollX() {
    return 0;
  }

  // ── Данные ───────────────────────────────────────────────────────────────────

  setSong(song) {
    this.song = song;
    this.notes = song ? song.notes : [];
    this.starts = this.notes.map((n) => n[0]);
    if (song && song.maxKey >= song.minKey) {
      let lo = Math.max(0, song.minKey - 2);
      let hi = Math.min(127, song.maxKey + 2);
      // До границ октав — клавиатура без обрубленных краёв.
      lo -= ((lo % 12) + 12) % 12;
      hi += 11 - (((hi % 12) + 12) % 12);
      while (hi - lo + 1 < 25) {
        if (lo >= 12) lo -= 12;
        else if (hi <= 115) hi += 12;
        else break;
      }
      this.lo = Math.max(0, lo);
      this.hi = Math.min(127, hi);
    }
    this.pos = 0;
    this.layout();
    this.buildMinimap();
  }

  /** Раскладка: множество исходных нот, которые реально нажимаются. */
  setLayout(playableSet, transpose) {
    this.playable = playableSet || null;
    this.transpose = transpose | 0;
    this.buildMinimap();
  }

  setMuted(set) {
    this.muted = set instanceof Set ? set : new Set(set || []);
    this.buildMinimap();
  }

  setTranspose(t) {
    this.transpose = t | 0;
    this.buildMinimap();
  }

  /** Позиция от плеера. Пока играем — позиция монотонно растёт: кадры едут
   *  вперёд сами, а тик только синхронизирует. Тик «назад» — это устаревшее
   *  событие, доставленное пачкой после заморозки неактивного окна (WebView2
   *  так делает при переключении на игру): его игнорируем, иначе дорожка
   *  визуально откатывается. На паузе позицию тоже защищаем от устаревших
   *  тиков, НО явный seek (флаг force) прокладывает дорогу всегда. */
  setPosition(ms, playing, speed, blocked, force) {
    if (typeof speed === 'number' && speed > 0) this.speed = speed;
    this.blocked = !!blocked;
    this.playing = !!playing && !this.blocked;
    if (!force) {
      if (this.playing && !this.blocked) {
        // Устаревший тик во время игры — пропускаем.
        if (ms < this.pos - 400) return;
        this.pos = Math.max(this.pos, ms);
      } else if (!this.playing) {
        // Устаревший тик на паузе: назад и вскоре после нашего seek — игнор.
        if (ms < this.pos - 400 && Date.now() - (this._lastSeekAt || 0) < 1000) return;
        this.pos = ms;
      }
      return;
    }
    this._lastSeekAt = Date.now();
    this.pos = ms;
  }

  /** Страховка от заморозки rAF в неактивном окне: тики из Rust будят
   *  обработчики событий, но не анимацию — делаем шаг и рисуем прямо из тика. */
  keepAlive() {
    const now = performance.now();
    if (now - (this._lastFrame || 0) > 400) {
      this.step(now);
      this.draw();
      this._lastFrame = now;
    }
  }

  reset() {
    this.pos = 0;
    this._prevT = null;
    this.playing = false;
  }

  refreshTheme() {
    this.theme = null;
    this.buildMinimap();
  }

  destroy() {
    cancelAnimationFrame(this._raf);
    clearInterval(this._bgTimer);
    window.removeEventListener('resize', this._onResize);
    window.removeEventListener('blur', this._onBlur);
    window.removeEventListener('focus', this._onFocus);
    if (this._ro) this._ro.disconnect();
    this.canvas.removeEventListener('pointerdown', this._onPointerDown);
    this.canvas.removeEventListener('pointermove', this._onPointerMove);
    this.canvas.removeEventListener('pointerup', this._onPointerUp);
    this.canvas.removeEventListener('pointercancel', this._onPointerUp);
  }

  // ── Цвета ────────────────────────────────────────────────────────────────────

  colors() {
    if (this.theme) return this.theme;
    const cs = getComputedStyle(document.body);
    const dark = document.body.getAttribute('data-theme') === 'dark';
    const accent = (cs.getPropertyValue('--sw') || '#7c5cff').trim();
    this.theme = {
      dark,
      accent,
      grid: dark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)',
      gridStrong: dark ? 'rgba(255,255,255,0.10)' : 'rgba(0,0,0,0.09)',
      lane: dark ? 'rgba(255,255,255,0.022)' : 'rgba(0,0,0,0.018)',
      kbWhite: dark ? '#e8e8ee' : '#ffffff',
      kbWhiteEdge: dark ? 'rgba(0,0,0,0.35)' : 'rgba(0,0,0,0.12)',
      kbBlack: dark ? '#15151b' : '#26262e',
      kbBase: dark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)',
      dead: dark ? 'rgba(255,255,255,0.10)' : 'rgba(0,0,0,0.10)',
      text: dark ? 'rgba(255,255,255,0.5)' : 'rgba(0,0,0,0.45)',
      sat: dark ? 78 : 70,
      light: dark ? 62 : 52,
    };
    return this.theme;
  }

  /** Цвет ноты — от акцента темы: лёгкий разброс светлоты, чтобы треки различались. */
  noteColor(track, active) {
    const c = this.colors();
    if (!c.hueCache) {
      c.hueCache = hexToHsl(c.accent);
    }
    const { h, s } = c.hueCache;
    const dl = (track % 3) * 5; // соседние треки чуть светлее/темнее друг друга
    const l = Math.max(18, Math.min(85, (active ? c.light + 14 : c.light) + dl));
    return `hsl(${h} ${Math.min(96, s + 8)}% ${l}%)`;
  }

  /** Играется ли нота вообще: не заглушена и попадает в раскладку. */
  isPlayable(key, track) {
    if (this.muted.has(track)) return false;
    if (!this.playable) return true;
    if (key === 255) return true;
    return this.playable.has(key + this.transpose);
  }

  // ── Мини-карта всей песни ────────────────────────────────────────────────────

  buildMinimap() {
    if (!this.song || !this.notes.length || !this.w) {
      this.minimap = null;
      return;
    }
    const total = Math.max(1, this.song.durationMs);
    const w = Math.max(1, Math.round((this.w - 32) * this.dpr));
    const h = Math.round(MINIMAP_H * this.dpr);
    if (!this._mm) this._mm = document.createElement('canvas');
    const cv = this._mm;
    cv.width = w;
    cv.height = h;
    const g = cv.getContext('2d');
    const span = Math.max(1, this.hi - this.lo);

    for (const n of this.notes) {
      const x = (n[0] / total) * w;
      const nw = Math.max(1, (n[1] / total) * w);
      const y = h - ((n[2] - this.lo) / span) * h;
      g.fillStyle = this.isPlayable(n[2], n[4])
        ? this.noteColor(n[4], false)
        : this.colors().dead;
      g.globalAlpha = 0.85;
      g.fillRect(x, Math.max(0, Math.min(h - 2, y - 1)), nw, 2);
    }
    this.minimap = cv;
  }

  // ── Кадр ─────────────────────────────────────────────────────────────────────

  loop() {
    this._raf = requestAnimationFrame(() => this.loop());
    this._lastFrame = performance.now();

    // Диагностика: сколько кадров реально рисуем в секунду.
    this.fps = (this.fps || 0) + 1;
    if (!this._fpsAt) this._fpsAt = performance.now();
    if (performance.now() - this._fpsAt >= 1000) {
      this._fpsShown = this.fps;
      this.fps = 0;
      this._fpsAt = performance.now();
    }

    this.step(performance.now());
    this.draw();
  }

  /** Один шаг визуальной позиции. Позиция приходит тиками из Rust (каждые
   *  ~40мс, в логе они идеально ровные), между тиками просто добавляем
   *  прошедшее время — без всяких снапов, фильтров и прыжков. */
  step(now) {
    const dt = Math.min(250, now - (this._prevT || now));
    this._prevT = now;
    if (this.playing && !this.blocked) this.pos += dt * this.speed;
  }

  draw() {
    const ctx = this.ctx;
    const { w, h, kbW, rollTop } = this;
    const c = this.colors();
    ctx.clearRect(0, 0, w, h);

    if (!this.song) {
      this.drawIdle();
      return;
    }

    const pos = this.pos;
    const ppm = this.pxPerMs;
    const viewEnd = pos + LOOKAHEAD_MS;

    // Полосы белых/чёрных дорожек — глазу проще держать строку.
    for (const [k, box] of this.keys) {
      if (!box.black) continue;
      ctx.fillStyle = c.lane;
      ctx.fillRect(kbW, box.y, w - kbW, box.hh);
    }

    // Диапазон раскладки: всё вне него — красить нечем.
    if (this.playable && this.playable.size) {
      let plo = 128;
      let phi = -1;
      for (const k of this.playable) {
        const src = k - this.transpose;
        if (src < plo) plo = src;
        if (src > phi) phi = src;
      }
      const top = this.keys.get(Math.min(this.hi, phi));
      const bot = this.keys.get(Math.max(this.lo, plo));
      if (top && bot && phi >= this.lo && plo <= this.hi) {
        ctx.fillStyle = c.dark ? 'rgba(255,255,255,0.018)' : 'rgba(0,0,0,0.012)';
        ctx.fillRect(kbW, top.y, w - kbW, bot.y + bot.hh - top.y);
      }
    }

    this.drawGrid(pos, viewEnd, ppm);

    // ── Ноты ──
    const active = new Map(); // key → цвет активной ноты
    ctx.save();
    ctx.beginPath();
    ctx.rect(kbW, rollTop, w - kbW, h - rollTop);
    ctx.clip();

    let i = this.lowerBound(pos - 200);
    // Длинные ноты могли начаться задолго до окна — отступаем назад.
    i = Math.max(0, i - 256);
    const radius = Math.max(1.5, Math.min(5, this.whiteH * 0.3));

    for (; i < this.notes.length; i++) {
      const n = this.notes[i];
      const start = n[0];
      if (start > viewEnd) break;
      const dur = n[1];
      const key = n[2];
      const track = n[4];
      if (start + dur < pos - 120) continue;

      const box = this.keys.get(key);
      if (!box) continue;

      const nw = Math.max(2, dur * ppm);
      const x = kbW + (start - pos) * ppm;
      if (x + nw < kbW) continue;

      const on = start <= pos && pos <= start + dur;
      const playable = this.isPlayable(key, track);
      const col = playable ? this.noteColor(track, on) : c.dead;

      if (on && playable) {
        active.set(key, this.noteColor(track, true));
        if (!this.reduced) {
          ctx.shadowColor = col;
          ctx.shadowBlur = 14;
        }
      }

      ctx.fillStyle = col;
      ctx.globalAlpha = playable ? (on ? 1 : 0.9) : 0.45;
      this.roundRect(x, box.y + 0.5, nw, Math.max(2, box.hh - 1.5), radius);
      ctx.fill();
      ctx.shadowBlur = 0;

      // Светлая кромка слева — «голова» ноты, читается направление движения.
      if (playable && nw > 6) {
        ctx.globalAlpha = on ? 0.55 : 0.3;
        ctx.fillStyle = '#fff';
        this.roundRect(x, box.y + 0.5, Math.min(3, nw), Math.max(2, box.hh - 1.5), radius);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }
    ctx.restore();

    this.drawKeyboard(active);
    this.drawPlayhead(active.size);
    this.drawMinimap(pos);
  }

  drawIdle() {
    const c = this.colors();
    const { w, h } = this;
    // Пустая клавиатура, чтобы сцена не выглядела сломанной без песни.
    this.drawKeyboard(new Map());
    ctx_text(this.ctx, c, w, h, this.kbW);
  }

  drawGrid(pos, viewEnd, ppm) {
    const ctx = this.ctx;
    const c = this.colors();
    const { w, kbW, rollTop, h } = this;

    // Октавные линии по горизонтали.
    ctx.lineWidth = 1;
    for (let k = this.lo; k <= this.hi; k++) {
      if (k % 12 !== 0) continue;
      const box = this.keys.get(k);
      if (!box) continue;
      const y = Math.round(box.y + box.hh) - 0.5;
      ctx.strokeStyle = c.grid;
      ctx.beginPath();
      ctx.moveTo(kbW, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }

    // Такты по темпу — вертикальные линии, едут вместе с нотами.
    const bpm = this.song.tempoBpm > 0 ? this.song.tempoBpm : 120;
    const beatMs = 60000 / bpm;
    const barMs = beatMs * 4;
    if (barMs * ppm > 6) {
      const first = Math.floor(pos / barMs) * barMs;
      for (let t = first; t <= viewEnd; t += barMs) {
        const x = Math.round(kbW + (t - pos) * ppm) - 0.5;
        if (x < kbW) continue;
        ctx.strokeStyle = c.gridStrong;
        ctx.beginPath();
        ctx.moveTo(x, rollTop);
        ctx.lineTo(x, h);
        ctx.stroke();
      }
    }
  }

  drawKeyboard(active) {
    const ctx = this.ctx;
    const c = this.colors();
    const { kbW, rollTop, h } = this;

    ctx.fillStyle = c.kbBase;
    ctx.fillRect(0, rollTop, kbW, h - rollTop);

    const blackW = kbW * 0.62;

    // Белые снизу вверх.
    for (const [k, box] of this.keys) {
      if (box.black) continue;
      const hit = active.get(k);
      ctx.fillStyle = hit || c.kbWhite;
      ctx.fillRect(0, box.y + 0.5, kbW - 1, Math.max(1, box.hh - 1));
      ctx.strokeStyle = c.kbWhiteEdge;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, Math.round(box.y) + 0.5);
      ctx.lineTo(kbW - 1, Math.round(box.y) + 0.5);
      ctx.stroke();

      // Подпись «до» — ориентир по октавам.
      if (k % 12 === 0 && box.hh > 11) {
        ctx.fillStyle = hit ? 'rgba(0,0,0,0.55)' : c.text;
        ctx.font = `600 ${Math.min(10, box.hh * 0.7)}px Inter, system-ui, sans-serif`;
        ctx.textAlign = 'right';
        ctx.textBaseline = 'middle';
        ctx.fillText(`C${Math.floor(k / 12) - 1}`, kbW - 5, box.cy);
      }
    }

    // Чёрные поверх.
    for (const [k, box] of this.keys) {
      if (!box.black) continue;
      const hit = active.get(k);
      ctx.fillStyle = hit || c.kbBlack;
      this.roundRect(0, box.y, blackW, Math.max(2, box.hh), 2);
      ctx.fill();
    }

    // Кромка клавиатуры — та самая линия, в которую «влетают» ноты.
    ctx.strokeStyle = c.dark ? 'rgba(255,255,255,0.14)' : 'rgba(0,0,0,0.14)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(kbW - 0.5, rollTop);
    ctx.lineTo(kbW - 0.5, h);
    ctx.stroke();
  }

  drawPlayhead(hits) {
    const ctx = this.ctx;
    const c = this.colors();
    const { kbW, rollTop, h } = this;
    const g = ctx.createLinearGradient(kbW, 0, kbW + 26, 0);
    const a = this.reduced ? 0.1 : Math.min(0.28, 0.08 + hits * 0.03);
    g.addColorStop(0, hexA(c.accent, a));
    g.addColorStop(1, hexA(c.accent, 0));
    ctx.fillStyle = g;
    ctx.fillRect(kbW, rollTop, 26, h - rollTop);
  }

  drawMinimap(pos) {
    const ctx = this.ctx;
    const c = this.colors();
    const x0 = 16;
    const w = this.w - 32;
    if (w <= 0) return;

    ctx.fillStyle = c.dark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.035)';
    this.roundRect(x0, 6, w, MINIMAP_H - 4, 6);
    ctx.fill();

    if (this.minimap) {
      ctx.save();
      this.roundRect(x0, 6, w, MINIMAP_H - 4, 6);
      ctx.clip();
      ctx.globalAlpha = 0.75;
      ctx.drawImage(this.minimap, x0, 6, w, MINIMAP_H - 4);
      ctx.globalAlpha = 1;
      ctx.restore();
    }

    const total = Math.max(1, this.song.durationMs);
    // Пройденное — заливкой, окно обзора — рамкой.
    const px = x0 + (Math.min(pos, total) / total) * w;
    ctx.fillStyle = hexA(c.accent, 0.14);
    this.roundRect(x0, 6, Math.max(0, px - x0), MINIMAP_H - 4, 6);
    ctx.fill();

    const vw = Math.max(2, (LOOKAHEAD_MS / total) * w);
    ctx.strokeStyle = hexA(c.accent, 0.55);
    ctx.lineWidth = 1;
    this.roundRect(px, 6.5, Math.min(vw, x0 + w - px), MINIMAP_H - 5, 4);
    ctx.stroke();

    ctx.fillStyle = c.accent;
    ctx.fillRect(px - 0.5, 4, 1.5, MINIMAP_H);
  }

  // ── Мелочи ───────────────────────────────────────────────────────────────────

  /** Попал ли курсор в полосу мини-карты (геометрия та же, что в drawMinimap). */
  inMinimap(e) {
    const r = this.canvas.getBoundingClientRect();
    const x = e.clientX - r.left;
    const y = e.clientY - r.top;
    const x0 = 16;
    return y >= 4 && y <= 4 + MINIMAP_H && x >= x0 && x <= x0 + (this.w - 32);
  }

  /** Клик/драг по мини-карте — перемотка песни. Не чаще раза в 60мс. */
  seekByPointer(e, force) {
    if (!this.song || !this.onSeek) return;
    const now = performance.now();
    if (!force && now - (this._mmLastSeek || 0) < 60) return;
    this._mmLastSeek = now;
    const r = this.canvas.getBoundingClientRect();
    const x0 = 16;
    const w = Math.max(1, this.w - 32);
    const pct = Math.max(0, Math.min(1, (e.clientX - r.left - x0) / w));
    this.onSeek(pct * this.song.durationMs);
  }

  roundRect(x, y, w, h, r) {
    const ctx = this.ctx;
    const rr = Math.max(0, Math.min(r, w / 2, h / 2));
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.lineTo(x + w - rr, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + rr);
    ctx.lineTo(x + w, y + h - rr);
    ctx.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
    ctx.lineTo(x + rr, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - rr);
    ctx.lineTo(x, y + rr);
    ctx.quadraticCurveTo(x, y, x + rr, y);
    ctx.closePath();
  }

  /** Первый индекс с началом >= ms. */
  lowerBound(ms) {
    const a = this.starts;
    let lo = 0;
    let hi = a.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (a[mid] < ms) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }
}

function ctx_text(ctx, c, w, h, kbW) {
  ctx.fillStyle = c.text;
  ctx.font = '500 13px Manrope, system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('—', kbW + (w - kbW) / 2, h / 2);
}

/** `#rrggbb` → `rgba()`. CSS-переменные акцента у нас всегда в hex. */
function hexA(hex, a) {
  const s = hex.replace('#', '').trim();
  if (s.length < 6) return `rgba(124,92,255,${a})`;
  const n = parseInt(s.slice(0, 6), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

/** `#rrggbb` → {h,s,l} (0–360, 0–100, 0–100) — чтобы красить ноты в тон акцента. */
function hexToHsl(hex) {
  const s = hex.replace('#', '').trim();
  if (s.length < 6) return { h: 252, s: 100, l: 60 };
  const n = parseInt(s.slice(0, 6), 16);
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0;
  let sd = 0;
  if (max !== min) {
    const d = max - min;
    sd = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) * 60;
    else if (max === g) h = ((b - r) / d + 2) * 60;
    else h = ((r - g) / d + 4) * 60;
  }
  return { h: Math.round(h), s: Math.round(sd * 100), l: Math.round(l * 100) };
}
