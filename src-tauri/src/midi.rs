//! Разбор MIDI-файла в плоский список нот с абсолютным временем в микросекундах.
//!
//! Главная тонкость — карта темпа: `SetTempo` может встречаться в любом треке и в
//! любой момент, поэтому события всех треков сливаются в один поток по тикам, и
//! только потом тики переводятся во время.

use std::collections::HashMap;
use std::path::Path;

use midly::{MetaMessage, MidiMessage, Smf, Timing, TrackEventKind};
use serde::Serialize;

#[derive(Clone, Copy, Debug, Serialize)]
pub struct Note {
    pub start_us: u64,
    pub dur_us: u64,
    pub key: u8,
    pub vel: u8,
    pub track: u8,
    pub channel: u8,
}

#[derive(Clone, Debug, Serialize)]
pub struct TrackInfo {
    pub index: u8,
    pub name: String,
    pub note_count: u32,
    /// Есть ли в треке 10-й канал (индекс 9) — это барабаны.
    pub has_drums: bool,
}

#[derive(Clone, Debug, Serialize)]
pub struct Song {
    pub path: String,
    pub name: String,
    pub duration_us: u64,
    pub notes: Vec<Note>,
    pub tracks: Vec<TrackInfo>,
    pub tempo_bpm: f32,
    pub min_key: u8,
    pub max_key: u8,
}

/// Промежуточное представление: событие, привязанное к абсолютному тику.
struct Timed<'a> {
    tick: u64,
    track: usize,
    seq: usize,
    kind: TrackEventKind<'a>,
}

pub fn parse_file(path: &str) -> Result<Song, String> {
    let bytes = std::fs::read(path).map_err(|e| format!("не удалось прочитать файл: {e}"))?;
    let smf = Smf::parse(&bytes).map_err(|e| format!("это не похоже на MIDI-файл: {e}"))?;

    let name = Path::new(path)
        .file_stem()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| "unknown".to_string());

    // 1. Сливаем все треки в один поток, считая абсолютные тики.
    let mut merged: Vec<Timed> = Vec::new();
    let mut track_names: Vec<String> = Vec::new();

    for (ti, track) in smf.tracks.iter().enumerate() {
        let mut tick: u64 = 0;
        let mut tname = String::new();
        for (si, ev) in track.iter().enumerate() {
            tick += ev.delta.as_int() as u64;
            if let TrackEventKind::Meta(MetaMessage::TrackName(raw)) = ev.kind {
                if tname.is_empty() {
                    tname = String::from_utf8_lossy(raw).trim().to_string();
                }
            }
            merged.push(Timed { tick, track: ti, seq: si, kind: ev.kind });
        }
        track_names.push(if tname.is_empty() {
            format!("Track {}", ti + 1)
        } else {
            tname
        });
    }

    merged.sort_by(|a, b| {
        a.tick
            .cmp(&b.tick)
            .then(a.track.cmp(&b.track))
            .then(a.seq.cmp(&b.seq))
    });

    // 2. Переводим тики в микросекунды, учитывая смену темпа на ходу.
    let (mut us_per_tick, fixed_rate) = match smf.header.timing {
        Timing::Metrical(tpb) => {
            let tpb = tpb.as_int().max(1) as f64;
            (500_000.0 / tpb, false) // 120 BPM по умолчанию
        }
        Timing::Timecode(fps, subframe) => {
            let ticks_per_second = fps.as_f32() as f64 * subframe.max(1) as f64;
            (1_000_000.0 / ticks_per_second, true)
        }
    };
    let ticks_per_beat = match smf.header.timing {
        Timing::Metrical(tpb) => tpb.as_int().max(1) as f64,
        Timing::Timecode(..) => 1.0,
    };

    let mut first_tempo_bpm = 120.0f32;
    let mut saw_tempo = false;

    let mut cur_tick: u64 = 0;
    let mut cur_us: f64 = 0.0;

    // key = (channel, note) -> стек начатых нот
    let mut open: HashMap<(u8, u8), Vec<(u64, u8, u8)>> = HashMap::new();
    let mut notes: Vec<Note> = Vec::new();
    let mut track_counts = vec![0u32; smf.tracks.len().max(1)];
    let mut track_drums = vec![false; smf.tracks.len().max(1)];

    for ev in &merged {
        // Догоняем время до тика события.
        if ev.tick > cur_tick {
            cur_us += (ev.tick - cur_tick) as f64 * us_per_tick;
            cur_tick = ev.tick;
        }
        let now_us = cur_us as u64;

        match ev.kind {
            TrackEventKind::Meta(MetaMessage::Tempo(us_per_beat)) if !fixed_rate => {
                let upb = us_per_beat.as_int() as f64;
                us_per_tick = upb / ticks_per_beat;
                if !saw_tempo {
                    first_tempo_bpm = (60_000_000.0 / upb) as f32;
                    saw_tempo = true;
                }
            }
            TrackEventKind::Midi { channel, message } => {
                let ch = channel.as_int();
                if ch == 9 {
                    track_drums[ev.track] = true;
                }
                match message {
                    MidiMessage::NoteOn { key, vel } if vel.as_int() > 0 => {
                        open.entry((ch, key.as_int()))
                            .or_default()
                            .push((now_us, vel.as_int(), ev.track as u8));
                    }
                    MidiMessage::NoteOn { key, .. } | MidiMessage::NoteOff { key, .. } => {
                        // NoteOn с velocity 0 — это тоже NoteOff.
                        if let Some(stack) = open.get_mut(&(ch, key.as_int())) {
                            if let Some((start, vel, track)) = stack.pop() {
                                notes.push(Note {
                                    start_us: start,
                                    dur_us: now_us.saturating_sub(start).max(1),
                                    key: key.as_int(),
                                    vel,
                                    track,
                                    channel: ch,
                                });
                                track_counts[track as usize] += 1;
                            }
                        }
                    }
                    _ => {}
                }
            }
            _ => {}
        }
    }

    let end_us = cur_us as u64;

    // Ноты без NoteOff закрываем концом файла.
    for ((ch, key), stack) in open {
        for (start, vel, track) in stack {
            notes.push(Note {
                start_us: start,
                dur_us: end_us.saturating_sub(start).max(1),
                key,
                vel,
                track,
                channel: ch,
            });
            track_counts[track as usize] += 1;
        }
    }

    if notes.is_empty() {
        return Err("в файле нет ни одной ноты".to_string());
    }

    notes.sort_by(|a, b| a.start_us.cmp(&b.start_us).then(a.key.cmp(&b.key)));

    let duration_us = notes
        .iter()
        .map(|n| n.start_us + n.dur_us)
        .max()
        .unwrap_or(end_us)
        .max(end_us);

    let min_key = notes.iter().map(|n| n.key).min().unwrap_or(60);
    let max_key = notes.iter().map(|n| n.key).max().unwrap_or(60);

    let tracks = track_names
        .iter()
        .enumerate()
        .map(|(i, n)| TrackInfo {
            index: i as u8,
            name: n.clone(),
            note_count: track_counts.get(i).copied().unwrap_or(0),
            has_drums: track_drums.get(i).copied().unwrap_or(false),
        })
        .filter(|t| t.note_count > 0)
        .collect();

    Ok(Song {
        path: path.to_string(),
        name,
        duration_us,
        notes,
        tracks,
        tempo_bpm: first_tempo_bpm,
        min_key,
        max_key,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use midly::{Format, Header, MetaMessage, Track, TrackEvent};

    /// Собирает минимальный MIDI в памяти: одна нота на 1 бит при 120 BPM.
    fn synth_midi() -> Vec<u8> {
        let mut track = Track::new();
        track.push(TrackEvent {
            delta: 0.into(),
            kind: TrackEventKind::Meta(MetaMessage::Tempo(500_000.into())),
        });
        track.push(TrackEvent {
            delta: 0.into(),
            kind: TrackEventKind::Midi {
                channel: 0.into(),
                message: MidiMessage::NoteOn { key: 60.into(), vel: 100.into() },
            },
        });
        track.push(TrackEvent {
            delta: 480.into(),
            kind: TrackEventKind::Midi {
                channel: 0.into(),
                message: MidiMessage::NoteOff { key: 60.into(), vel: 0.into() },
            },
        });
        track.push(TrackEvent {
            delta: 0.into(),
            kind: TrackEventKind::Meta(MetaMessage::EndOfTrack),
        });

        let smf = Smf {
            header: Header::new(Format::SingleTrack, Timing::Metrical(480.into())),
            tracks: vec![track],
        };
        let mut out = Vec::new();
        smf.write(&mut out).unwrap();
        out
    }

    #[test]
    fn parses_note_timing() {
        let bytes = synth_midi();
        let dir = std::env::temp_dir().join("vmp_test_parse.mid");
        std::fs::write(&dir, &bytes).unwrap();

        let song = parse_file(dir.to_str().unwrap()).unwrap();
        assert_eq!(song.notes.len(), 1);
        let n = song.notes[0];
        assert_eq!(n.key, 60);
        assert_eq!(n.start_us, 0);
        // 480 тиков при 480 ppq и 500000 мкс/бит = ровно 0.5 c
        assert!((n.dur_us as i64 - 500_000).abs() < 1000, "dur = {}", n.dur_us);
        assert_eq!(song.min_key, 60);

        std::fs::remove_file(dir).ok();
    }
}
