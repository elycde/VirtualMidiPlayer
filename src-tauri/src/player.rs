//! Движок воспроизведения: отдельный поток, который в нужные моменты давит клавиши.
//!
//! Тайминг устроен так: при старте запоминается «якорь» — момент реального
//! времени, соответствующий нулю песни. Дальше каждое событие ждёт до
//! `anchor + t/speed`. Ошибки не накапливаются, потому что позиция всегда
//! считается от якоря, а не суммой пауз.

use std::collections::HashSet;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::mpsc::{channel, Receiver, Sender, TryRecvError};
use std::sync::Arc;
use std::time::{Duration, Instant};

use serde::Serialize;

use crate::keyboard::{KeySender, KeyStroke, SendMode};
use crate::layout::{map_note, OutOfRange, ResolvedLayout};
use crate::midi::Song;
use crate::winutil;

#[derive(Clone, Debug)]
pub struct PlaySettings {
    pub speed: f32,
    pub transpose: i32,
    pub out_of_range: OutOfRange,
    pub hold_mode: bool,
    pub tap_us: u64,
    pub chord_gap_us: u64,
    pub humanize_us: u64,
    pub max_chord: usize,
    pub ignore_drums: bool,
    pub min_velocity: u8,
    pub loop_song: bool,
    pub countdown_s: u32,
    pub window_guard: bool,
    pub window_title: String,
    pub force_en_layout: bool,
    pub send_mode: SendMode,
}

impl Default for PlaySettings {
    fn default() -> Self {
        Self {
            speed: 1.0,
            transpose: 0,
            out_of_range: OutOfRange::Fold,
            hold_mode: false,
            tap_us: 12_000,
            chord_gap_us: 0,
            humanize_us: 0,
            max_chord: 0,
            ignore_drums: true,
            min_velocity: 1,
            loop_song: false,
            countdown_s: 3,
            window_guard: false,
            window_title: String::new(),
            force_en_layout: false,
            send_mode: SendMode::Scancode,
        }
    }
}

pub enum Cmd {
    Load(Arc<Song>),
    SetLayout(Arc<ResolvedLayout>),
    SetSettings(PlaySettings),
    SetMuted(HashSet<u8>),
    Play,
    Pause,
    TogglePlay,
    Stop,
    Seek(u64),
    Panic,
    Shutdown,
}

#[derive(Clone, Debug, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum PlayerEvent {
    Tick {
        position_us: u64,
        playing: bool,
        countdown: u32,
        guard_blocked: bool,
    },
    Ended,
    Stopped,
}

/// Одно запланированное действие над клавиатурой.
#[derive(Clone, Copy, Debug)]
struct Ev {
    t_us: u64,
    /// Нота уже после транспонирования и приведения в диапазон.
    key: u8,
    on: bool,
}

pub struct PlayerHandle {
    tx: Sender<Cmd>,
    pub position_us: Arc<AtomicU64>,
    pub playing: Arc<AtomicBool>,
}

impl PlayerHandle {
    pub fn send(&self, cmd: Cmd) {
        let _ = self.tx.send(cmd);
    }
}

/// Крошечный xorshift — нужен только для «человеческого» разброса тайминга,
/// тянуть для этого крейт rand незачем.
struct Rng(u64);

impl Rng {
    fn new() -> Self {
        let seed = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos() as u64)
            .unwrap_or(0x2545F4914F6CDD1D)
            | 1;
        Rng(seed)
    }

    fn next(&mut self) -> u64 {
        let mut x = self.0;
        x ^= x << 13;
        x ^= x >> 7;
        x ^= x << 17;
        self.0 = x;
        x
    }

    fn jitter(&mut self, span_us: u64) -> i64 {
        if span_us == 0 {
            return 0;
        }
        (self.next() % (span_us * 2 + 1)) as i64 - span_us as i64
    }
}

/// Раскладывает песню в список нажатий с учётом всех настроек.
///
/// Вынесено из `Engine`, чтобы проверять логику тестами — без живого потока и
/// без реальной отправки нажатий в систему.
fn build_events(
    song: &Song,
    layout: &ResolvedLayout,
    settings: &PlaySettings,
    muted: &HashSet<u8>,
    rng: &mut Rng,
) -> Vec<Ev> {
    // 1. Отбираем ноты, которые вообще должны звучать.
    let mut picked: Vec<(u64, u64, u8, u8)> = Vec::new(); // (start, dur, key, vel)
    for n in &song.notes {
        if muted.contains(&n.track) {
            continue;
        }
        if settings.ignore_drums && n.channel == 9 {
            continue;
        }
        if n.vel < settings.min_velocity {
            continue;
        }
        let Some(key) = map_note(layout, n.key as i32 + settings.transpose, settings.out_of_range)
        else {
            continue;
        };
        picked.push((n.start_us, n.dur_us, key, n.vel));
    }

    picked.sort_by(|a, b| a.0.cmp(&b.0).then(b.3.cmp(&a.3)));

    // 2. Режем аккорды до max_chord и убираем дубли одной и той же клавиши.
    //    Ноты, начавшиеся в пределах 12 мс, считаем одним аккордом.
    const CHORD_WINDOW_US: u64 = 12_000;
    let mut events: Vec<Ev> = Vec::with_capacity(picked.len() * 2);
    let mut i = 0;

    while i < picked.len() {
        let group_start = picked[i].0;
        let mut j = i;
        while j < picked.len() && picked[j].0.saturating_sub(group_start) <= CHORD_WINDOW_US {
            j += 1;
        }
        let mut group: Vec<(u64, u64, u8, u8)> = picked[i..j].to_vec();

        // Одна клавиша дважды в аккорде — смысла нет.
        group.sort_by_key(|g| g.2);
        group.dedup_by_key(|g| g.2);

        if settings.max_chord > 0 && group.len() > settings.max_chord {
            // Оставляем крайние голоса: верх — мелодия, низ — бас.
            group.sort_by_key(|g| g.2);
            let mut keep: Vec<(u64, u64, u8, u8)> = Vec::with_capacity(settings.max_chord);
            let (mut lo, mut hi) = (0usize, group.len() - 1);
            let mut take_high = true;
            while keep.len() < settings.max_chord && lo <= hi {
                if take_high {
                    keep.push(group[hi]);
                    if hi == 0 {
                        break;
                    }
                    hi -= 1;
                } else {
                    keep.push(group[lo]);
                    lo += 1;
                }
                take_high = !take_high;
            }
            group = keep;
        }

        // Порядок внутри аккорда — снизу вверх, так «разъезд» звучит естественнее.
        group.sort_by_key(|g| g.2);

        for (slot, (start, dur, key, _vel)) in group.iter().enumerate() {
            let gap = settings.chord_gap_us * slot as u64;
            let jitter = rng.jitter(settings.humanize_us);
            let t = (*start as i64 + gap as i64 + jitter).max(0) as u64;
            events.push(Ev { t_us: t, key: *key, on: true });
            if settings.hold_mode {
                events.push(Ev { t_us: t + (*dur).max(1), key: *key, on: false });
            }
        }

        i = j;
    }

    // 3. При одинаковом времени отпускание идёт раньше нажатия, иначе
    //    повторная нота съест сама себя.
    events.sort_by(|a, b| a.t_us.cmp(&b.t_us).then(a.on.cmp(&b.on)));
    events
}

struct Engine {
    rx: Receiver<Cmd>,
    sink: Box<dyn Fn(PlayerEvent) + Send>,
    keys: KeySender,
    rng: Rng,

    song: Option<Arc<Song>>,
    layout: Arc<ResolvedLayout>,
    settings: PlaySettings,
    muted: HashSet<u8>,

    events: Vec<Ev>,
    /// Разобранные нажатия под каждую ноту — чтобы не парсить токен в горячем цикле.
    strokes: Vec<Option<KeyStroke>>,

    idx: usize,
    playing: bool,
    /// Позиция в песне, мкс.
    position_us: u64,
    anchor: Option<Instant>,
    guard_blocked: bool,

    shared_pos: Arc<AtomicU64>,
    shared_playing: Arc<AtomicBool>,

    last_tick: Instant,
    last_guard_check: Instant,
}

impl Engine {
    /// Длина песни для перемотки. Берём максимум из последнего события и длины
    /// самого файла — в режиме тапов события заканчиваются раньше, потому что
    /// отпусканий в списке нет.
    fn total_us(&self) -> u64 {
        let by_events = self.events.last().map(|e| e.t_us).unwrap_or(0);
        let by_song = self.song.as_ref().map(|s| s.duration_us).unwrap_or(0);
        by_events.max(by_song)
    }

    fn rebuild(&mut self) {
        let Some(song) = self.song.clone() else {
            self.events.clear();
            return;
        };
        self.events = build_events(
            &song,
            &self.layout,
            &self.settings,
            &self.muted,
            &mut self.rng,
        );

        // Кэш нажатий по номеру ноты.
        self.strokes = vec![None; 128];
        for (note, ks) in &self.layout.strokes {
            self.strokes[*note as usize] = Some(*ks);
        }

        self.keys.set_mode(self.settings.send_mode);
        self.reindex();
    }

    /// Ставит `idx` на первое событие после текущей позиции.
    fn reindex(&mut self) {
        self.idx = self
            .events
            .partition_point(|e| e.t_us < self.position_us);
    }

    fn reanchor(&mut self) {
        let scaled = (self.position_us as f64 / self.settings.speed.max(0.01) as f64) as u64;
        self.anchor = Some(Instant::now() - Duration::from_micros(scaled));
    }

    fn wall_time_for(&self, t_us: u64) -> Instant {
        let anchor = self.anchor.unwrap_or_else(Instant::now);
        anchor + Duration::from_micros((t_us as f64 / self.settings.speed.max(0.01) as f64) as u64)
    }

    fn emit_tick(&mut self) {
        self.shared_pos.store(self.position_us, Ordering::Relaxed);
        self.shared_playing.store(self.playing, Ordering::Relaxed);
        (self.sink)(PlayerEvent::Tick {
            position_us: self.position_us,
            playing: self.playing,
            countdown: 0,
            guard_blocked: self.guard_blocked,
        });
        self.last_tick = Instant::now();
    }

    fn all_off(&mut self) {
        self.keys.release_all();
    }

    fn start(&mut self) {
        if self.events.is_empty() {
            return;
        }
        if self.position_us >= self.total_us() {
            self.position_us = 0;
            self.reindex();
        }

        if self.settings.force_en_layout {
            winutil::request_english_layout();
        }

        if self.settings.countdown_s > 0 && !self.countdown() {
            return;
        }

        self.playing = true;
        self.guard_blocked = false;
        self.reanchor();
        self.emit_tick();
    }

    /// Обратный отсчёт перед стартом — время переключиться в игру.
    /// Возвращает `false`, если старт отменили (Stop / Panic).
    ///
    /// Команды, пришедшие во время отсчёта, не выбрасываются: они копятся и
    /// применяются здесь же, иначе изменение настроек в этот момент терялось бы.
    fn countdown(&mut self) -> bool {
        for left in (1..=self.settings.countdown_s).rev() {
            (self.sink)(PlayerEvent::Tick {
                position_us: self.position_us,
                playing: false,
                countdown: left,
                guard_blocked: false,
            });

            let until = Instant::now() + Duration::from_secs(1);
            let mut queued: Vec<Cmd> = Vec::new();
            {
                let rx = &self.rx;
                let q = &mut queued;
                winutil::sleep_until(until, || match rx.try_recv() {
                    Ok(cmd) => {
                        let halt = matches!(cmd, Cmd::Stop | Cmd::Panic | Cmd::Shutdown);
                        q.push(cmd);
                        halt
                    }
                    Err(_) => false,
                });
            }

            let mut halt = false;
            for cmd in queued {
                match cmd {
                    // Повторный Play во время отсчёта — уже отсчитываем, игнор.
                    Cmd::Play | Cmd::TogglePlay => {}
                    Cmd::Stop | Cmd::Panic | Cmd::Shutdown => halt = true,
                    other => {
                        self.handle(other);
                    }
                }
            }
            if halt {
                self.stop();
                return false;
            }
        }
        true
    }

    fn pause(&mut self) {
        if !self.playing {
            return;
        }
        self.playing = false;
        self.all_off();
        self.emit_tick();
    }

    fn stop(&mut self) {
        self.playing = false;
        self.position_us = 0;
        self.idx = 0;
        self.guard_blocked = false;
        self.all_off();
        self.emit_tick();
        (self.sink)(PlayerEvent::Stopped);
    }

    fn seek(&mut self, us: u64) {
        self.position_us = us.min(self.total_us());
        self.all_off();
        self.reindex();
        if self.playing {
            self.reanchor();
        }
        self.emit_tick();
    }

    /// Обрабатывает команду. `false` — пора выходить из потока.
    fn handle(&mut self, cmd: Cmd) -> bool {
        match cmd {
            Cmd::Load(song) => {
                self.all_off();
                self.playing = false;
                self.position_us = 0;
                self.song = Some(song);
                self.rebuild();
                self.emit_tick();
            }
            Cmd::SetLayout(layout) => {
                let was_playing = self.playing;
                if was_playing {
                    self.all_off();
                }
                self.layout = layout;
                self.rebuild();
                if was_playing {
                    self.reanchor();
                }
            }
            Cmd::SetSettings(s) => {
                let speed_changed = (s.speed - self.settings.speed).abs() > f32::EPSILON;
                let needs_rebuild = s.transpose != self.settings.transpose
                    || s.out_of_range != self.settings.out_of_range
                    || s.hold_mode != self.settings.hold_mode
                    || s.chord_gap_us != self.settings.chord_gap_us
                    || s.humanize_us != self.settings.humanize_us
                    || s.max_chord != self.settings.max_chord
                    || s.ignore_drums != self.settings.ignore_drums
                    || s.min_velocity != self.settings.min_velocity;
                self.settings = s;
                self.keys.set_mode(self.settings.send_mode);
                if needs_rebuild {
                    if self.playing {
                        self.all_off();
                    }
                    self.rebuild();
                }
                if speed_changed || needs_rebuild {
                    if self.playing {
                        self.reanchor();
                    }
                }
            }
            Cmd::SetMuted(m) => {
                self.muted = m;
                if self.playing {
                    self.all_off();
                }
                self.rebuild();
                if self.playing {
                    self.reanchor();
                }
            }
            Cmd::Play => self.start(),
            Cmd::Pause => self.pause(),
            Cmd::TogglePlay => {
                if self.playing {
                    self.pause();
                } else {
                    self.start();
                }
            }
            Cmd::Stop => self.stop(),
            Cmd::Seek(us) => self.seek(us),
            Cmd::Panic => {
                self.all_off();
                self.stop();
            }
            Cmd::Shutdown => {
                self.all_off();
                return false;
            }
        }
        true
    }

    fn drain_commands(&mut self) -> bool {
        loop {
            match self.rx.try_recv() {
                Ok(cmd) => {
                    if !self.handle(cmd) {
                        return false;
                    }
                }
                Err(TryRecvError::Empty) => return true,
                Err(TryRecvError::Disconnected) => return false,
            }
        }
    }

    /// Если включён «страж окна» и нужное окно не в фокусе — время песни стоит.
    fn check_guard(&mut self) {
        if !self.settings.window_guard {
            if self.guard_blocked {
                self.guard_blocked = false;
                self.reanchor();
                self.emit_tick();
            }
            return;
        }
        if self.last_guard_check.elapsed() < Duration::from_millis(150) {
            return;
        }
        self.last_guard_check = Instant::now();

        let in_target_window = winutil::window_matches(&self.settings.window_title);
        let should_block = !in_target_window;
        if should_block != self.guard_blocked {
            self.guard_blocked = should_block;
            if should_block {
                self.all_off();
            } else {
                self.reanchor();
            }
            self.emit_tick();
        }
    }

    fn run(&mut self) {
        winutil::boost_thread_priority();

        loop {
            if !self.drain_commands() {
                break;
            }

            if !self.playing {
                // Простой: ждём команду, но всё равно тикаем для UI.
                match self.rx.recv_timeout(Duration::from_millis(120)) {
                    Ok(cmd) => {
                        if !self.handle(cmd) {
                            break;
                        }
                    }
                    Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {}
                    Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => break,
                }
                continue;
            }

            self.check_guard();
            if self.guard_blocked {
                // Держим позицию на месте: якорь всё время подтягивается.
                self.reanchor();
                std::thread::sleep(Duration::from_millis(30));
                continue;
            }

            if self.idx >= self.events.len() {
                self.finish();
                continue;
            }

            let target = self.wall_time_for(self.events[self.idx].t_us);
            let cancelled = {
                let rx = &self.rx;
                let mut pending: Option<Cmd> = None;
                let hit = winutil::sleep_until(target, || match rx.try_recv() {
                    Ok(cmd) => {
                        pending = Some(cmd);
                        true
                    }
                    Err(_) => false,
                });
                if let Some(cmd) = pending {
                    if !self.handle(cmd) {
                        break;
                    }
                }
                hit
            };
            if cancelled {
                continue;
            }

            self.fire_due();

            if self.last_tick.elapsed() >= Duration::from_millis(40) {
                self.sync_position();
                self.emit_tick();
            }
        }

        self.all_off();
    }

    fn sync_position(&mut self) {
        if let Some(anchor) = self.anchor {
            let elapsed = anchor.elapsed().as_micros() as f64;
            self.position_us = (elapsed * self.settings.speed.max(0.01) as f64) as u64;
        }
    }

    /// Отправляет все события, чьё время уже наступило.
    fn fire_due(&mut self) {
        // Всё, что попадает в одно и то же время — один аккорд.
        let now_t = self.events[self.idx].t_us;

        let mut offs: Vec<KeyStroke> = Vec::new();
        let mut ons: Vec<KeyStroke> = Vec::new();

        while self.idx < self.events.len() && self.events[self.idx].t_us == now_t {
            let ev = self.events[self.idx];
            if let Some(ks) = self.strokes.get(ev.key as usize).copied().flatten() {
                if ev.on {
                    ons.push(ks);
                } else {
                    offs.push(ks);
                }
            }
            self.idx += 1;
        }

        for ks in &offs {
            self.keys.release(ks);
        }

        if !ons.is_empty() {
            if self.settings.hold_mode {
                for ks in &ons {
                    self.keys.press(ks);
                }
            } else {
                self.keys.tap_chord(&ons, self.settings.tap_us);
            }
        }

        self.position_us = now_t;
    }

    fn finish(&mut self) {
        self.all_off();
        if self.settings.loop_song {
            self.position_us = 0;
            self.idx = 0;
            self.reanchor();
            self.emit_tick();
            return;
        }
        self.playing = false;
        self.position_us = self.total_us();
        self.emit_tick();
        (self.sink)(PlayerEvent::Ended);
    }
}

pub fn spawn<F>(sink: F) -> PlayerHandle
where
    F: Fn(PlayerEvent) + Send + 'static,
{
    let (tx, rx) = channel::<Cmd>();
    let position_us = Arc::new(AtomicU64::new(0));
    let playing = Arc::new(AtomicBool::new(false));

    let shared_pos = position_us.clone();
    let shared_playing = playing.clone();

    std::thread::Builder::new()
        .name("vmp-player".into())
        .spawn(move || {
            let settings = PlaySettings::default();
            let mut engine = Engine {
                rx,
                sink: Box::new(sink),
                keys: KeySender::new(settings.send_mode),
                rng: Rng::new(),
                song: None,
                layout: Arc::new(ResolvedLayout {
                    strokes: Default::default(),
                    min_note: 60,
                    max_note: 60,
                }),
                settings,
                muted: HashSet::new(),
                events: Vec::new(),
                strokes: vec![None; 128],
                idx: 0,
                playing: false,
                position_us: 0,
                anchor: None,
                guard_blocked: false,
                shared_pos,
                shared_playing,
                last_tick: Instant::now(),
                last_guard_check: Instant::now(),
            };
            engine.run();
        })
        .expect("не удалось запустить поток плеера");

    PlayerHandle { tx, position_us, playing }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::layout::builtin_layouts;
    use crate::midi::Note;

    fn song_with(notes: Vec<Note>) -> Song {
        let duration_us = notes.iter().map(|n| n.start_us + n.dur_us).max().unwrap_or(0);
        let min_key = notes.iter().map(|n| n.key).min().unwrap_or(60);
        let max_key = notes.iter().map(|n| n.key).max().unwrap_or(60);
        Song {
            path: "test".into(),
            name: "test".into(),
            duration_us,
            notes,
            tracks: vec![],
            tempo_bpm: 120.0,
            min_key,
            max_key,
        }
    }

    fn note(start_us: u64, key: u8, track: u8, channel: u8) -> Note {
        Note { start_us, dur_us: 100_000, key, vel: 100, track, channel }
    }

    fn vp61() -> ResolvedLayout {
        ResolvedLayout::from_layout(&builtin_layouts()[0])
    }

    #[test]
    fn tap_mode_emits_only_note_ons() {
        let song = song_with(vec![note(0, 60, 0, 0), note(500_000, 62, 0, 0)]);
        let s = PlaySettings { hold_mode: false, ..Default::default() };
        let evs = build_events(&song, &vp61(), &s, &HashSet::new(), &mut Rng(1));
        assert_eq!(evs.len(), 2);
        assert!(evs.iter().all(|e| e.on));
    }

    #[test]
    fn hold_mode_pairs_on_with_off() {
        let song = song_with(vec![note(0, 60, 0, 0)]);
        let s = PlaySettings { hold_mode: true, ..Default::default() };
        let evs = build_events(&song, &vp61(), &s, &HashSet::new(), &mut Rng(1));
        assert_eq!(evs.len(), 2);
        assert!(evs[0].on && !evs[1].on);
        assert_eq!(evs[1].t_us, 100_000);
    }

    #[test]
    fn muted_tracks_and_drums_are_dropped() {
        let song = song_with(vec![
            note(0, 60, 0, 0),  // играем
            note(0, 62, 1, 0),  // трек заглушён
            note(0, 64, 0, 9),  // барабаны
        ]);
        let s = PlaySettings { ignore_drums: true, ..Default::default() };
        let mut muted = HashSet::new();
        muted.insert(1u8);
        let evs = build_events(&song, &vp61(), &s, &muted, &mut Rng(1));
        assert_eq!(evs.len(), 1);
        assert_eq!(evs[0].key, 60);
    }

    #[test]
    fn max_chord_keeps_outer_voices() {
        // Аккорд из пяти нот, лимит 2 — должны остаться самая низкая и самая высокая.
        let song = song_with(vec![
            note(0, 60, 0, 0),
            note(0, 62, 0, 0),
            note(0, 64, 0, 0),
            note(0, 65, 0, 0),
            note(0, 67, 0, 0),
        ]);
        let s = PlaySettings { max_chord: 2, ..Default::default() };
        let evs = build_events(&song, &vp61(), &s, &HashSet::new(), &mut Rng(1));
        let keys: Vec<u8> = evs.iter().map(|e| e.key).collect();
        assert_eq!(keys, vec![60, 67]);
    }

    #[test]
    fn chord_gap_spreads_simultaneous_notes() {
        let song = song_with(vec![note(0, 60, 0, 0), note(0, 64, 0, 0)]);
        let s = PlaySettings { chord_gap_us: 5_000, ..Default::default() };
        let evs = build_events(&song, &vp61(), &s, &HashSet::new(), &mut Rng(1));
        assert_eq!(evs[0].t_us, 0);
        assert_eq!(evs[1].t_us, 5_000);
    }

    #[test]
    fn duplicate_keys_in_one_chord_collapse() {
        // Две разные ноты, которые после Fold садятся на одну клавишу.
        let song = song_with(vec![note(0, 36, 0, 0), note(0, 24, 0, 0)]);
        let s = PlaySettings { out_of_range: OutOfRange::Fold, ..Default::default() };
        let evs = build_events(&song, &vp61(), &s, &HashSet::new(), &mut Rng(1));
        assert_eq!(evs.len(), 1, "одна клавиша не должна дублироваться в аккорде");
    }

    #[test]
    fn events_are_sorted_and_offs_precede_ons() {
        // Нота 60 длится ровно до начала следующей ноты 60 — off обязан идти первым.
        let song = song_with(vec![
            Note { start_us: 0, dur_us: 100_000, key: 60, vel: 100, track: 0, channel: 0 },
            Note { start_us: 100_000, dur_us: 100_000, key: 60, vel: 100, track: 0, channel: 0 },
        ]);
        let s = PlaySettings { hold_mode: true, ..Default::default() };
        let evs = build_events(&song, &vp61(), &s, &HashSet::new(), &mut Rng(1));
        let at_100k: Vec<bool> = evs.iter().filter(|e| e.t_us == 100_000).map(|e| e.on).collect();
        assert_eq!(at_100k, vec![false, true]);
        assert!(evs.windows(2).all(|w| w[0].t_us <= w[1].t_us));
    }

    #[test]
    fn min_velocity_filters_quiet_notes() {
        let mut quiet = note(0, 60, 0, 0);
        quiet.vel = 5;
        let song = song_with(vec![quiet, note(0, 64, 0, 0)]);
        let s = PlaySettings { min_velocity: 20, ..Default::default() };
        let evs = build_events(&song, &vp61(), &s, &HashSet::new(), &mut Rng(1));
        assert_eq!(evs.len(), 1);
        assert_eq!(evs[0].key, 64);
    }
}
