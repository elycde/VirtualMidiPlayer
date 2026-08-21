//! Раскладки: соответствие «MIDI-нота → клавиша» плюс подбор транспонирования.

use std::collections::{BTreeMap, HashMap};

use serde::{Deserialize, Serialize};

use crate::keyboard::{parse_token, KeyStroke};

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Layout {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub builtin: bool,
    /// Нота (21..108) → токен клавиши (`q`, `Q`, `!`, `ctrl+w`, `space`).
    pub mapping: BTreeMap<u8, String>,
}

/// Раскладка, разобранная в готовые нажатия — то, чем пользуется плеер.
pub struct ResolvedLayout {
    pub strokes: HashMap<u8, KeyStroke>,
    pub min_note: u8,
    pub max_note: u8,
}

impl ResolvedLayout {
    pub fn from_layout(layout: &Layout) -> Self {
        let mut strokes = HashMap::new();
        for (note, token) in &layout.mapping {
            if let Some(ks) = parse_token(token) {
                strokes.insert(*note, ks);
            }
        }
        let min_note = strokes.keys().copied().min().unwrap_or(60);
        let max_note = strokes.keys().copied().max().unwrap_or(60);
        Self { strokes, min_note, max_note }
    }

    pub fn is_empty(&self) -> bool {
        self.strokes.is_empty()
    }
}

/// Что делать с нотой, которой нет в раскладке.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum OutOfRange {
    /// Пропустить — честнее всего звучит, но теряются басы/верха.
    Skip,
    /// Сдвинуть на целые октавы внутрь диапазона — сохраняет мелодию.
    Fold,
    /// Прижать к ближайшей доступной ноте.
    Clamp,
}

impl OutOfRange {
    pub fn from_str(s: &str) -> Self {
        match s {
            "fold" => OutOfRange::Fold,
            "clamp" => OutOfRange::Clamp,
            _ => OutOfRange::Skip,
        }
    }
}

/// Приводит ноту к той, которую реально можно нажать. `None` — ноту играть нечем.
pub fn map_note(layout: &ResolvedLayout, note: i32, policy: OutOfRange) -> Option<u8> {
    if layout.is_empty() {
        return None;
    }
    if (0..=127).contains(&note) {
        let n = note as u8;
        if layout.strokes.contains_key(&n) {
            return Some(n);
        }
    }

    match policy {
        OutOfRange::Skip => None,
        OutOfRange::Fold => {
            // Ищем ближайшую октавную копию, которая есть в раскладке.
            for shift in 1..=10 {
                for dir in [-1i32, 1] {
                    let cand = note + dir * 12 * shift;
                    if (0..=127).contains(&cand) {
                        let c = cand as u8;
                        if layout.strokes.contains_key(&c) {
                            return Some(c);
                        }
                    }
                }
            }
            None
        }
        OutOfRange::Clamp => {
            let target = note.clamp(0, 127) as u8;
            layout
                .strokes
                .keys()
                .copied()
                .min_by_key(|k| (*k as i32 - target as i32).abs())
        }
    }
}

#[derive(Clone, Debug, Serialize)]
pub struct Coverage {
    pub total: u32,
    pub playable: u32,
    pub too_low: u32,
    pub too_high: u32,
    pub percent: f32,
}

pub fn coverage(notes: &[u8], layout: &ResolvedLayout, transpose: i32) -> Coverage {
    let mut playable = 0;
    let mut too_low = 0;
    let mut too_high = 0;
    for &n in notes {
        let t = n as i32 + transpose;
        if t < layout.min_note as i32 {
            too_low += 1;
        } else if t > layout.max_note as i32 {
            too_high += 1;
        } else if (0..=127).contains(&t) && layout.strokes.contains_key(&(t as u8)) {
            playable += 1;
        } else {
            // В диапазоне, но дырка в раскладке — считаем как «сверху», чтобы
            // не завышать процент.
            too_high += 1;
        }
    }
    let total = notes.len() as u32;
    Coverage {
        total,
        playable,
        too_low,
        too_high,
        percent: if total == 0 { 0.0 } else { playable as f32 * 100.0 / total as f32 },
    }
}

/// Подбирает сдвиг в полутонах, при котором играется больше всего нот.
///
/// При равном счёте предпочитаем кратные 12 (тональность не меняется), затем —
/// меньший по модулю сдвиг.
pub fn best_transpose(notes: &[u8], layout: &ResolvedLayout) -> i32 {
    if layout.is_empty() || notes.is_empty() {
        return 0;
    }
    let mut best = (0i32, -1i32);
    for offset in -36..=36 {
        let cov = coverage(notes, layout, offset);
        let score = cov.playable as i32;
        let (best_off, best_score) = best;
        let better = match score.cmp(&best_score) {
            std::cmp::Ordering::Greater => true,
            std::cmp::Ordering::Equal => {
                let a_octave = offset % 12 == 0;
                let b_octave = best_off % 12 == 0;
                match (a_octave, b_octave) {
                    (true, false) => true,
                    (false, true) => false,
                    _ => offset.abs() < best_off.abs(),
                }
            }
            std::cmp::Ordering::Less => false,
        };
        if better {
            best = (offset, score);
        }
    }
    best.0
}

// ── Встроенные раскладки ───────────────────────────────────────────────────────

/// Канонический Virtual Piano: 61 клавиша, от C2 (нота 36) до C7 (нота 96).
/// Диезы — это Shift от белой клавиши слева.
const VP61: &str = "1!2@34$5%6^78*9(0qQwWeErtTyYuiIoOpPasSdDfgGhHjJklLzZxcCvVbBnm";
const VP61_BASE: u8 = 36;

fn vp61_mapping() -> BTreeMap<u8, String> {
    VP61
        .chars()
        .enumerate()
        .map(|(i, ch)| (VP61_BASE + i as u8, ch.to_string()))
        .collect()
}

fn roblox_61() -> Layout {
    Layout {
        id: "roblox_61".into(),
        name: "Roblox — Virtual Piano (61)".into(),
        description: "Классическая раскладка virtualpiano.net. Подходит для Roblox Piano, \
                      Got Talent и большинства онлайн-пианино. Диапазон C2–C7."
            .into(),
        builtin: true,
        mapping: vp61_mapping(),
    }
}

fn roblox_88() -> Layout {
    let mut mapping = vp61_mapping();

    // Нижние 15 нот (21..35) и верхние 12 (97..108) в 88-клавишных пианино
    // обычно вешают на модификатор. Единого стандарта нет — конкретная игра
    // может ждать другое, поэтому раскладка открыта для правки в редакторе.
    for note in 21u8..VP61_BASE {
        if let Some(tok) = mapping.get(&(note + 12)).cloned() {
            mapping.insert(note, format!("ctrl+{tok}"));
        }
    }
    for note in 97u8..=108 {
        if let Some(tok) = mapping.get(&(note - 12)).cloned() {
            mapping.insert(note, format!("alt+{tok}"));
        }
    }

    Layout {
        id: "roblox_88".into(),
        name: "Roblox — 88 клавиш (Ctrl/Alt)".into(),
        description: "Virtual Piano плюс крайние октавы: низ через Ctrl, верх через Alt. \
                      Конкретная игра может использовать другие модификаторы — проверь и \
                      поправь в редакторе."
            .into(),
        builtin: true,
        mapping,
    }
}

fn gmod_piano() -> Layout {
    let mut mapping: BTreeMap<u8, String> = BTreeMap::new();

    // Нижний ряд (как в трекерах / FL Studio): z s x d c v g b h n j m
    const LOWER: &str = "zsxdcvgbhnjm";
    for (i, ch) in LOWER.chars().enumerate() {
        mapping.insert(48 + i as u8, ch.to_string());
    }
    // Верхний ряд на октаву выше: q 2 w 3 e r 5 t 6 y 7 u, затем i 9 o 0 p
    const UPPER: &[&str] = &[
        "q", "2", "w", "3", "e", "r", "5", "t", "6", "y", "7", "u", "i", "9", "o", "0", "p",
    ];
    for (i, tok) in UPPER.iter().enumerate() {
        mapping.insert(60 + i as u8, (*tok).to_string());
    }

    Layout {
        id: "gmod_piano".into(),
        name: "Garry's Mod — фортепиано (2 октавы)".into(),
        description: "Трекерная раскладка (нижний ряд + ряд цифр октавой выше), которую \
                      используют распространённые пианино-аддоны Source. Диапазон C3–E5. \
                      Аддоны различаются — если ноты не совпали, поправь в редакторе."
            .into(),
        builtin: true,
        mapping,
    }
}

fn blank() -> Layout {
    Layout {
        id: "custom_blank".into(),
        name: "Пустой шаблон".into(),
        description: "Ничего не назначено. Открой редактор, нажимай клавиши на своей \
                      клавиатуре и раскидай их по нотам под любую игру."
            .into(),
        builtin: true,
        mapping: BTreeMap::new(),
    }
}

pub fn builtin_layouts() -> Vec<Layout> {
    vec![roblox_61(), roblox_88(), gmod_piano(), blank()]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn vp61_covers_61_notes_from_c2() {
        let l = roblox_61();
        assert_eq!(l.mapping.len(), 61);
        assert_eq!(l.mapping.get(&36).unwrap(), "1");
        assert_eq!(l.mapping.get(&37).unwrap(), "!"); // C#2 = Shift+1
        assert_eq!(l.mapping.get(&60).unwrap(), "t"); // C4 (middle C)
        assert_eq!(l.mapping.get(&96).unwrap(), "m"); // C7
        let r = ResolvedLayout::from_layout(&l);
        assert_eq!(r.strokes.len(), 61);
        assert_eq!((r.min_note, r.max_note), (36, 96));
    }

    #[test]
    fn every_builtin_token_parses() {
        for l in builtin_layouts() {
            for (note, tok) in &l.mapping {
                assert!(
                    parse_token(tok).is_some(),
                    "раскладка {} нота {note}: токен {tok:?} не разобрался",
                    l.id
                );
            }
        }
    }

    #[test]
    fn fold_pulls_notes_into_range() {
        let r = ResolvedLayout::from_layout(&roblox_61());
        // Нота 24 (C1) ниже диапазона — Fold должен поднять её на C2.
        assert_eq!(map_note(&r, 24, OutOfRange::Fold), Some(36));
        assert_eq!(map_note(&r, 24, OutOfRange::Skip), None);
        assert_eq!(map_note(&r, 24, OutOfRange::Clamp), Some(36));
        assert_eq!(map_note(&r, 60, OutOfRange::Skip), Some(60));
    }

    #[test]
    fn best_transpose_lifts_a_low_song() {
        let r = ResolvedLayout::from_layout(&roblox_61());
        // Песня на две октавы ниже диапазона.
        let notes: Vec<u8> = vec![12, 14, 16, 17, 19];
        let t = best_transpose(&notes, &r);
        let cov = coverage(&notes, &r, t);
        assert_eq!(cov.playable, 5, "подобранный сдвиг {t} не покрыл всё");
        assert_eq!(t % 12, 0, "должен предпочесть октавный сдвиг, получил {t}");
    }

    #[test]
    fn coverage_counts_edges() {
        let r = ResolvedLayout::from_layout(&roblox_61());
        let notes = vec![20u8, 36, 96, 100];
        let cov = coverage(&notes, &r, 0);
        assert_eq!(cov.total, 4);
        assert_eq!(cov.playable, 2);
        assert_eq!(cov.too_low, 1);
        assert_eq!(cov.too_high, 1);
    }
}
