// Редактор раскладок: клавиша пианино → токен клавиатуры.
//
// Токен собираем из `event.code`, а не из `event.key`: раскладка ОС может быть
// русской, и `key` даст «й» вместо «q» — ровно та же причина, по которой в Rust
// захардкожена US-таблица.

const CODE_CHAR = {
  Backquote: '`', Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']',
  Backslash: '\\', Semicolon: ';', Quote: "'", Comma: ',', Period: '.', Slash: '/',
};
for (let i = 0; i < 26; i++) CODE_CHAR['Key' + String.fromCharCode(65 + i)] = String.fromCharCode(97 + i);
for (let i = 0; i < 10; i++) CODE_CHAR['Digit' + i] = String(i);

const SHIFTED = {
  '1': '!', '2': '@', '3': '#', '4': '$', '5': '%', '6': '^', '7': '&', '8': '*',
  '9': '(', '0': ')', '-': '_', '=': '+', '[': '{', ']': '}', '\\': '|',
  ';': ':', "'": '"', ',': '<', '.': '>', '/': '?', '`': '~',
};

const NAMED = {
  Space: 'space', Enter: 'enter', Tab: 'tab', Backspace: 'backspace',
  ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
  Insert: 'insert', Delete: 'delete', Home: 'home', End: 'end',
  PageUp: 'pageup', PageDown: 'pagedown',
};

/** Virtual Piano 61: от C2 (36) вверх, ровно как в layout.rs. */
const VP61 = '1!2@34$5%6^78*9(0qQwWeErtTyYuiIoOpPasSdDfgGhHjJklLzZxcCvVbBnm';

const NOTE_NAMES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
const noteName = (k) => NOTE_NAMES[k % 12] + (Math.floor(k / 12) - 1);
const isBlack = (k) => [1, 3, 6, 8, 10].includes(k % 12);

export function tokenFromEvent(e) {
  if (NAMED[e.code]) return withMods(e, NAMED[e.code]);
  if (/^F([1-9]|1[0-2])$/.test(e.code)) return withMods(e, e.code.toLowerCase());
  const ch = CODE_CHAR[e.code];
  if (!ch) return null;
  let base = ch;
  if (e.shiftKey) base = /[a-z]/.test(ch) ? ch.toUpperCase() : SHIFTED[ch] || ch;
  return withMods(e, base);
}

function withMods(e, base) {
  let t = base;
  if (e.altKey) t = 'alt+' + t;
  if (e.ctrlKey) t = 'ctrl+' + t;
  return t;
}

export class Editor {
  /**
   * @param {(layouts:Array)=>void} onSaved вызывается после сохранения/удаления
   * @param {(msg:string,kind?:string)=>void} toast
   */
  constructor(invoke, onSaved, toast) {
    this.invoke = invoke;
    this.onSaved = onSaved || (() => {});
    this.toast = toast || (() => {});

    this.modal = document.getElementById('editor');
    this.el = {
      scrim: document.getElementById('editor-scrim'),
      close: document.getElementById('editor-close'),
      name: document.getElementById('ed-name'),
      range: document.getElementById('ed-range'),
      down: document.getElementById('ed-octave-down'),
      up: document.getElementById('ed-octave-up'),
      clear: document.getElementById('ed-clear'),
      vp: document.getElementById('ed-vp'),
      keys: document.getElementById('ed-keys'),
      status: document.getElementById('ed-status'),
      del: document.getElementById('ed-delete'),
      save: document.getElementById('ed-save'),
    };

    this.base = 36; // нижняя нота окна
    this.span = 37; // 3 октавы + до
    this.mapping = {};
    this.layout = null;
    this.armed = null;

    this.el.close.onclick = () => this.hide();
    this.el.scrim.onclick = () => this.hide();
    this.el.down.onclick = () => this.shift(-12);
    this.el.up.onclick = () => this.shift(12);
    this.el.clear.onclick = () => {
      this.mapping = {};
      this.render();
      this.status('ed.cleared');
    };
    this.el.vp.onclick = () => this.fillVp();
    this.el.save.onclick = () => this.save();
    this.el.del.onclick = () => this.remove();

    this.onKey = (e) => this.handleKey(e);
  }

  get isOpen() {
    return !this.modal.hidden;
  }

  show(layout) {
    this.layout = layout;
    this.mapping = Object.assign({}, layout.mapping || {});
    this.el.name.value = layout.builtin ? `${layout.name} (копия)` : layout.name;
    this.el.del.disabled = !!layout.builtin;
    this.el.del.hidden = !!layout.builtin;

    // Открываемся на том месте, где у раскладки есть клавиши.
    const notes = Object.keys(this.mapping).map(Number).filter((k) => k < 128);
    if (notes.length) {
      const lo = Math.min(...notes);
      this.base = Math.max(0, lo - (lo % 12));
    }

    this.modal.hidden = false;
    this.armed = null;
    this.render();
    window.addEventListener('keydown', this.onKey, true);
    requestAnimationFrame(() => this.el.name.focus());
  }

  hide() {
    this.modal.hidden = true;
    this.armed = null;
    window.removeEventListener('keydown', this.onKey, true);
  }

  shift(by) {
    this.base = Math.max(0, Math.min(127 - this.span, this.base + by));
    this.render();
  }

  status(key, raw) {
    this.el.status.textContent = raw || '';
    this.el.status.dataset.i18n = raw ? '' : key || '';
    if (!raw && key && window.__i18n) this.el.status.textContent = window.__i18n(key);
  }

  render() {
    const hi = Math.min(127, this.base + this.span - 1);
    this.el.range.textContent = `${noteName(this.base)} – ${noteName(hi)}`;

    const rows = [];
    for (let k = this.base; k <= hi; k++) {
      const tok = this.mapping[k] || '';
      const cls = [
        'edkey',
        isBlack(k) ? 'edkey--black' : 'edkey--white',
        tok ? 'is-set' : '',
        this.armed === k ? 'is-armed' : '',
      ].join(' ');
      rows.push(
        `<button class="${cls}" data-note="${k}">` +
          `<span class="edkey__note">${noteName(k)}</span>` +
          `<span class="edkey__tok">${tok ? escapeHtml(tok) : '·'}</span>` +
          `</button>`
      );
    }
    // «space» вне диапазона нот — служебная клавиша (нота 255) для пауз.
    const sp = this.mapping[255] || '';
    rows.push(
      `<button class="edkey edkey--util ${sp ? 'is-set' : ''} ${this.armed === 255 ? 'is-armed' : ''}" data-note="255">` +
        `<span class="edkey__note">rest</span><span class="edkey__tok">${sp ? escapeHtml(sp) : '·'}</span></button>`
    );
    this.el.keys.innerHTML = rows.join('');

    this.el.keys.querySelectorAll('.edkey').forEach((b) => {
      const note = Number(b.dataset.note);
      b.onclick = () => {
        this.armed = this.armed === note ? null : note;
        this.render();
        this.status(null, this.armed === null ? '' : `${noteName(note)} → нажми клавишу`);
      };
      b.ondblclick = () => {
        delete this.mapping[note];
        this.armed = null;
        this.render();
      };
    });

    const count = Object.keys(this.mapping).length;
    this.el.save.textContent = `Сохранить (${count})`;
  }

  async handleKey(e) {
    if (e.target === this.el.name) return;
    if (e.code === 'Escape') {
      e.preventDefault();
      if (this.armed !== null) {
        this.armed = null;
        this.render();
      } else {
        this.hide();
      }
      return;
    }
    if (this.armed === null) return;
    if (['ShiftLeft', 'ShiftRight', 'ControlLeft', 'ControlRight', 'AltLeft', 'AltRight'].includes(e.code)) return;

    e.preventDefault();
    e.stopPropagation();
    const token = tokenFromEvent(e);
    if (!token) {
      this.status(null, 'эту клавишу отправить нельзя');
      return;
    }
    const ok = await this.invoke('validate_token', { token });
    if (!ok) {
      this.status(null, `«${token}» — нераспознанный токен`);
      return;
    }
    // Один токен на одну ноту: снимаем его с прежнего владельца.
    for (const [n, t] of Object.entries(this.mapping)) {
      if (t === token && Number(n) !== this.armed) delete this.mapping[n];
    }
    this.mapping[this.armed] = token;

    // Идём вверх по нотам — назначать подряд удобнее всего.
    const next = this.armed === 255 ? null : this.armed + 1;
    this.armed = next !== null && next <= this.base + this.span - 1 ? next : null;
    this.render();
    this.status(null, this.armed === null ? '' : `${noteName(this.armed)} → нажми клавишу`);
  }

  fillVp() {
    const m = {};
    for (let i = 0; i < VP61.length; i++) m[36 + i] = VP61[i];
    if (this.mapping[255]) m[255] = this.mapping[255];
    this.mapping = m;
    this.base = 36;
    this.render();
    this.status(null, 'заполнено как Virtual Piano (C2–C7)');
  }

  async save() {
    const name = this.el.name.value.trim();
    if (!name) {
      this.status(null, 'нужно название');
      this.el.name.focus();
      return;
    }
    if (!Object.keys(this.mapping).length) {
      this.status(null, 'раскладка пустая');
      return;
    }
    const id = this.layout.builtin ? `${this.layout.id}_custom` : this.layout.id || slug(name);
    const layout = {
      id: slug(id),
      name,
      description: this.layout.description || '',
      builtin: false,
      mapping: this.mapping,
    };
    try {
      const layouts = await this.invoke('save_layout', { layout });
      this.onSaved(layouts, layout.id);
      this.hide();
      this.toast(`Раскладка «${name}» сохранена`);
    } catch (err) {
      this.status(null, String(err));
    }
  }

  async remove() {
    if (!this.layout || this.layout.builtin) return;
    try {
      const layouts = await this.invoke('delete_layout', { id: this.layout.id });
      this.onSaved(layouts, null);
      this.hide();
      this.toast(`Раскладка «${this.layout.name}» удалена`);
    } catch (err) {
      this.status(null, String(err));
    }
  }
}

function slug(s) {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 40) || 'layout'
  );
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
