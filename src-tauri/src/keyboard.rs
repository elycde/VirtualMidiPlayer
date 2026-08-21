//! Низкоуровневая эмуляция нажатий клавиш через SendInput.
//!
//! Игры (Roblox, Source-движок) читают ввод по-разному: одни слушают скан-коды
//! (физическое положение клавиши), другие — виртуальные коды. Поэтому таблица
//! ниже жёстко задаёт US-раскладку: и скан-код, и VK. Это принципиально —
//! `VkKeyScanW` зависит от активной раскладки системы, и при включённой русской
//! он вернул бы мусор.

use std::collections::HashMap;

use windows::Win32::UI::Input::KeyboardAndMouse::{
    SendInput, INPUT, INPUT_0, INPUT_KEYBOARD, KEYBDINPUT, KEYBD_EVENT_FLAGS, KEYEVENTF_EXTENDEDKEY,
    KEYEVENTF_KEYUP, KEYEVENTF_SCANCODE, VIRTUAL_KEY,
};

/// Как отправлять нажатие в игру.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum SendMode {
    /// Только скан-код. Работает с Roblox и большинством игр. По умолчанию.
    Scancode,
    /// Только виртуальный код. Нужен некоторым Lua/GUI-плагинам.
    Virtual,
    /// Оба поля разом — самый «жирный» вариант, ловит почти всё.
    Both,
}

impl SendMode {
    pub fn from_str(s: &str) -> Self {
        match s {
            "virtual" => SendMode::Virtual,
            "both" => SendMode::Both,
            _ => SendMode::Scancode,
        }
    }
}

/// Одна физическая клавиша US-раскладки.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct PhysKey {
    pub vk: u16,
    pub scan: u16,
    pub extended: bool,
}

/// Разобранный токен раскладки: клавиша + требуемые модификаторы.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct KeyStroke {
    pub key: PhysKey,
    pub shift: bool,
    pub ctrl: bool,
    pub alt: bool,
}

pub const MOD_SHIFT: PhysKey = PhysKey { vk: 0xA0, scan: 0x2A, extended: false }; // VK_LSHIFT
pub const MOD_CTRL: PhysKey = PhysKey { vk: 0xA2, scan: 0x1D, extended: false }; // VK_LCONTROL
pub const MOD_ALT: PhysKey = PhysKey { vk: 0xA4, scan: 0x38, extended: false }; // VK_LMENU

fn base_table() -> HashMap<char, PhysKey> {
    // (символ, vk, скан-код) для US QWERTY.
    const ROWS: &[(char, u16, u16)] = &[
        ('1', 0x31, 0x02),
        ('2', 0x32, 0x03),
        ('3', 0x33, 0x04),
        ('4', 0x34, 0x05),
        ('5', 0x35, 0x06),
        ('6', 0x36, 0x07),
        ('7', 0x37, 0x08),
        ('8', 0x38, 0x09),
        ('9', 0x39, 0x0A),
        ('0', 0x30, 0x0B),
        ('-', 0xBD, 0x0C),
        ('=', 0xBB, 0x0D),
        ('q', 0x51, 0x10),
        ('w', 0x57, 0x11),
        ('e', 0x45, 0x12),
        ('r', 0x52, 0x13),
        ('t', 0x54, 0x14),
        ('y', 0x59, 0x15),
        ('u', 0x55, 0x16),
        ('i', 0x49, 0x17),
        ('o', 0x4F, 0x18),
        ('p', 0x50, 0x19),
        ('[', 0xDB, 0x1A),
        (']', 0xDD, 0x1B),
        ('a', 0x41, 0x1E),
        ('s', 0x53, 0x1F),
        ('d', 0x44, 0x20),
        ('f', 0x46, 0x21),
        ('g', 0x47, 0x22),
        ('h', 0x48, 0x23),
        ('j', 0x4A, 0x24),
        ('k', 0x4B, 0x25),
        ('l', 0x4C, 0x26),
        (';', 0xBA, 0x27),
        ('\'', 0xDE, 0x28),
        ('`', 0xC0, 0x29),
        ('\\', 0xDC, 0x2B),
        ('z', 0x5A, 0x2C),
        ('x', 0x58, 0x2D),
        ('c', 0x43, 0x2E),
        ('v', 0x56, 0x2F),
        ('b', 0x42, 0x30),
        ('n', 0x4E, 0x31),
        ('m', 0x4D, 0x32),
        (',', 0xBC, 0x33),
        ('.', 0xBE, 0x34),
        ('/', 0xBF, 0x35),
    ];

    ROWS.iter()
        .map(|&(ch, vk, scan)| (ch, PhysKey { vk, scan, extended: false }))
        .collect()
}

/// Символы, которые набираются с Shift, и их базовая клавиша.
fn shifted_char(ch: char) -> Option<char> {
    let base = match ch {
        '!' => '1',
        '@' => '2',
        '#' => '3',
        '$' => '4',
        '%' => '5',
        '^' => '6',
        '&' => '7',
        '*' => '8',
        '(' => '9',
        ')' => '0',
        '_' => '-',
        '+' => '=',
        '{' => '[',
        '}' => ']',
        ':' => ';',
        '"' => '\'',
        '~' => '`',
        '|' => '\\',
        '<' => ',',
        '>' => '.',
        '?' => '/',
        c if c.is_ascii_uppercase() => c.to_ascii_lowercase(),
        _ => return None,
    };
    Some(base)
}

/// Клавиши, у которых нет печатного символа — задаются по имени.
fn named_key(name: &str) -> Option<PhysKey> {
    let k = match name {
        "space" => PhysKey { vk: 0x20, scan: 0x39, extended: false },
        "enter" => PhysKey { vk: 0x0D, scan: 0x1C, extended: false },
        "tab" => PhysKey { vk: 0x09, scan: 0x0F, extended: false },
        "backspace" => PhysKey { vk: 0x08, scan: 0x0E, extended: false },
        "up" => PhysKey { vk: 0x26, scan: 0x48, extended: true },
        "down" => PhysKey { vk: 0x28, scan: 0x50, extended: true },
        "left" => PhysKey { vk: 0x25, scan: 0x4B, extended: true },
        "right" => PhysKey { vk: 0x27, scan: 0x4D, extended: true },
        "insert" => PhysKey { vk: 0x2D, scan: 0x52, extended: true },
        "delete" => PhysKey { vk: 0x2E, scan: 0x53, extended: true },
        "home" => PhysKey { vk: 0x24, scan: 0x47, extended: true },
        "end" => PhysKey { vk: 0x23, scan: 0x4F, extended: true },
        "pageup" => PhysKey { vk: 0x21, scan: 0x49, extended: true },
        "pagedown" => PhysKey { vk: 0x22, scan: 0x51, extended: true },
        _ => {
            // f1..f12
            let n: u8 = name.strip_prefix('f')?.parse().ok()?;
            if !(1..=12).contains(&n) {
                return None;
            }
            const F_SCAN: [u16; 12] =
                [0x3B, 0x3C, 0x3D, 0x3E, 0x3F, 0x40, 0x41, 0x42, 0x43, 0x44, 0x57, 0x58];
            PhysKey {
                vk: 0x70 + n as u16 - 1,
                scan: F_SCAN[n as usize - 1],
                extended: false,
            }
        }
    };
    Some(k)
}

/// Разбирает токен раскладки в нажатие.
///
/// Формы: `q`, `Q`, `!`, `ctrl+q`, `alt+shift+5`, `space`, `f7`.
/// Регистр модификаторов игнорируется; регистр самого символа значим
/// (`Q` == `shift+q`).
pub fn parse_token(token: &str) -> Option<KeyStroke> {
    let token = token.trim();
    if token.is_empty() {
        return None;
    }

    let mut shift = false;
    let mut ctrl = false;
    let mut alt = false;
    let mut rest = token;

    // Отрезаем модификаторы слева. `+` в конце — это сам символ плюса,
    // поэтому делим только если после `+` что-то есть.
    loop {
        let Some(pos) = rest.find('+') else { break };
        if pos == 0 || pos + 1 >= rest.len() {
            break;
        }
        let (head, tail) = rest.split_at(pos);
        let head_lc = head.to_ascii_lowercase();
        match head_lc.as_str() {
            "shift" => shift = true,
            "ctrl" | "control" => ctrl = true,
            "alt" => alt = true,
            _ => break,
        }
        rest = &tail[1..];
    }

    let table = base_table();
    let key = if rest.chars().count() == 1 {
        let ch = rest.chars().next().unwrap();
        if let Some(k) = table.get(&ch.to_ascii_lowercase()).copied() {
            if ch.is_ascii_uppercase() {
                shift = true;
            }
            k
        } else if let Some(base) = shifted_char(ch) {
            shift = true;
            table.get(&base).copied()?
        } else {
            return None;
        }
    } else {
        named_key(&rest.to_ascii_lowercase())?
    };

    Some(KeyStroke { key, shift, ctrl, alt })
}

/// Приводит токен к каноничному виду для отображения в UI.
pub fn pretty_token(token: &str) -> String {
    match parse_token(token) {
        Some(_) => token.trim().to_string(),
        None => String::new(),
    }
}

fn make_input(key: PhysKey, up: bool, mode: SendMode) -> INPUT {
    let mut flags = KEYBD_EVENT_FLAGS(0);
    if mode != SendMode::Virtual {
        flags |= KEYEVENTF_SCANCODE;
    }
    if up {
        flags |= KEYEVENTF_KEYUP;
    }
    if key.extended {
        flags |= KEYEVENTF_EXTENDEDKEY;
    }

    let vk = match mode {
        SendMode::Scancode => 0,
        SendMode::Virtual | SendMode::Both => key.vk,
    };

    INPUT {
        r#type: INPUT_KEYBOARD,
        Anonymous: INPUT_0 {
            ki: KEYBDINPUT {
                wVk: VIRTUAL_KEY(vk),
                wScan: key.scan,
                dwFlags: flags,
                time: 0,
                dwExtraInfo: 0,
            },
        },
    }
}

fn send(inputs: &[INPUT]) {
    if inputs.is_empty() {
        return;
    }
    unsafe {
        SendInput(inputs, std::mem::size_of::<INPUT>() as i32);
    }
}

/// Отправляет нажатия в систему и следит за тем, что зажато.
///
/// Модификаторы считаются по ссылкам: если два аккорда подряд требуют Shift,
/// он не отпускается между ними. `release_all` — аварийный сброс, чтобы клавиша
/// не осталась зажатой после остановки.
pub struct KeySender {
    mode: SendMode,
    /// scan -> сколько нот сейчас держат эту клавишу
    held: HashMap<u16, u32>,
    shift_refs: u32,
    ctrl_refs: u32,
    alt_refs: u32,
}

impl KeySender {
    pub fn new(mode: SendMode) -> Self {
        Self {
            mode,
            held: HashMap::new(),
            shift_refs: 0,
            ctrl_refs: 0,
            alt_refs: 0,
        }
    }

    pub fn set_mode(&mut self, mode: SendMode) {
        self.mode = mode;
    }

    fn push_mods(&mut self, ks: &KeyStroke, buf: &mut Vec<INPUT>) {
        if ks.shift {
            if self.shift_refs == 0 {
                buf.push(make_input(MOD_SHIFT, false, self.mode));
            }
            self.shift_refs += 1;
        }
        if ks.ctrl {
            if self.ctrl_refs == 0 {
                buf.push(make_input(MOD_CTRL, false, self.mode));
            }
            self.ctrl_refs += 1;
        }
        if ks.alt {
            if self.alt_refs == 0 {
                buf.push(make_input(MOD_ALT, false, self.mode));
            }
            self.alt_refs += 1;
        }
    }

    fn pop_mods(&mut self, ks: &KeyStroke, buf: &mut Vec<INPUT>) {
        if ks.shift {
            self.shift_refs = self.shift_refs.saturating_sub(1);
            if self.shift_refs == 0 {
                buf.push(make_input(MOD_SHIFT, true, self.mode));
            }
        }
        if ks.ctrl {
            self.ctrl_refs = self.ctrl_refs.saturating_sub(1);
            if self.ctrl_refs == 0 {
                buf.push(make_input(MOD_CTRL, true, self.mode));
            }
        }
        if ks.alt {
            self.alt_refs = self.alt_refs.saturating_sub(1);
            if self.alt_refs == 0 {
                buf.push(make_input(MOD_ALT, true, self.mode));
            }
        }
    }

    /// Нажать аккорд целиком и отпустить одним окном.
    ///
    /// Физически нельзя удержать «1» и «!» одновременно — это одна клавиша с
    /// Shift и без. Поэтому сначала уходят вниз все клавиши без модификаторов,
    /// затем по группам модификаторов: Shift вниз → клавиши вниз → Shift вверх.
    /// Уже нажатые клавиши это не искажает — их keydown игра получила раньше.
    pub fn tap_chord(&mut self, strokes: &[KeyStroke], hold_us: u64) {
        if strokes.is_empty() {
            return;
        }

        let mut plain: Vec<PhysKey> = Vec::new();
        let mut modded: Vec<((bool, bool, bool), Vec<PhysKey>)> = Vec::new();

        for ks in strokes {
            let combo = (ks.shift, ks.ctrl, ks.alt);
            if combo == (false, false, false) {
                if !plain.contains(&ks.key) {
                    plain.push(ks.key);
                }
            } else if let Some(entry) = modded.iter_mut().find(|(c, _)| *c == combo) {
                if !entry.1.contains(&ks.key) {
                    entry.1.push(ks.key);
                }
            } else {
                modded.push((combo, vec![ks.key]));
            }
        }

        let mut all_down: Vec<PhysKey> = Vec::new();

        if !plain.is_empty() {
            let batch: Vec<INPUT> = plain
                .iter()
                .map(|k| make_input(*k, false, self.mode))
                .collect();
            send(&batch);
            all_down.extend(plain.iter().copied());
        }

        for ((shift, ctrl, alt), keys) in &modded {
            let mut buf: Vec<INPUT> = Vec::with_capacity(keys.len() + 6);
            if *shift {
                buf.push(make_input(MOD_SHIFT, false, self.mode));
            }
            if *ctrl {
                buf.push(make_input(MOD_CTRL, false, self.mode));
            }
            if *alt {
                buf.push(make_input(MOD_ALT, false, self.mode));
            }
            for k in keys {
                buf.push(make_input(*k, false, self.mode));
            }
            if *alt {
                buf.push(make_input(MOD_ALT, true, self.mode));
            }
            if *ctrl {
                buf.push(make_input(MOD_CTRL, true, self.mode));
            }
            if *shift {
                buf.push(make_input(MOD_SHIFT, true, self.mode));
            }
            send(&buf);
            all_down.extend(keys.iter().copied());
        }

        if hold_us > 0 {
            crate::winutil::precise_sleep_us(hold_us);
        }

        let ups: Vec<INPUT> = all_down
            .iter()
            .rev()
            .map(|k| make_input(*k, true, self.mode))
            .collect();
        send(&ups);
    }

    /// Зажать клавишу до `release`. Модификаторы отпускаются сразу же —
    /// удерживать Shift всё время нельзя, иначе он исказит соседние ноты.
    pub fn press(&mut self, ks: &KeyStroke) {
        let count = self.held.entry(ks.key.scan).or_insert(0);
        let first = *count == 0;
        *count += 1;

        let mut buf = Vec::with_capacity(6);
        self.push_mods(ks, &mut buf);
        if first {
            buf.push(make_input(ks.key, false, self.mode));
        }
        self.pop_mods(ks, &mut buf);
        send(&buf);
    }

    pub fn release(&mut self, ks: &KeyStroke) {
        let Some(count) = self.held.get_mut(&ks.key.scan) else {
            return;
        };
        *count = count.saturating_sub(1);
        if *count == 0 {
            self.held.remove(&ks.key.scan);
            send(&[make_input(ks.key, true, self.mode)]);
        }
    }

    /// Отпускает всё, что могло остаться зажатым.
    pub fn release_all(&mut self) {
        let mut buf: Vec<INPUT> = Vec::new();
        let scans: Vec<u16> = self.held.keys().copied().collect();
        for scan in scans {
            buf.push(make_input(
                PhysKey { vk: 0, scan, extended: false },
                true,
                SendMode::Scancode,
            ));
        }
        self.held.clear();

        if self.shift_refs > 0 {
            buf.push(make_input(MOD_SHIFT, true, self.mode));
        }
        if self.ctrl_refs > 0 {
            buf.push(make_input(MOD_CTRL, true, self.mode));
        }
        if self.alt_refs > 0 {
            buf.push(make_input(MOD_ALT, true, self.mode));
        }
        self.shift_refs = 0;
        self.ctrl_refs = 0;
        self.alt_refs = 0;

        send(&buf);
    }
}

impl Drop for KeySender {
    fn drop(&mut self) {
        self.release_all();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_plain_and_shifted() {
        let q = parse_token("q").unwrap();
        assert_eq!(q.key.scan, 0x10);
        assert!(!q.shift);

        let big_q = parse_token("Q").unwrap();
        assert_eq!(big_q.key.scan, 0x10);
        assert!(big_q.shift);

        // '!' — это Shift+1, та же физическая клавиша, что и '1'.
        let bang = parse_token("!").unwrap();
        assert_eq!(bang.key.scan, 0x02);
        assert!(bang.shift);
    }

    #[test]
    fn parses_modifiers_and_named() {
        let c = parse_token("ctrl+1").unwrap();
        assert!(c.ctrl && !c.shift);
        assert_eq!(c.key.scan, 0x02);

        let combo = parse_token("alt+shift+w").unwrap();
        assert!(combo.alt && combo.shift);

        assert_eq!(parse_token("space").unwrap().key.scan, 0x39);
        assert_eq!(parse_token("f7").unwrap().key.scan, 0x41);
        assert!(parse_token("").is_none());
        assert!(parse_token("nosuchkey").is_none());
    }

    #[test]
    fn plus_sign_is_a_key_not_a_separator() {
        let plus = parse_token("+").unwrap();
        assert_eq!(plus.key.scan, 0x0D); // '=' с шифтом
        assert!(plus.shift);
    }
}
