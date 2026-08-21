//! Мелкие обёртки над WinAPI: точный сон, разрешение таймера, окно в фокусе.

use std::time::{Duration, Instant};

use windows::core::PCWSTR;
use windows::Win32::Foundation::HWND;
use windows::Win32::UI::Input::KeyboardAndMouse::{ActivateKeyboardLayout, LoadKeyboardLayoutW, KLF_SETFORPROCESS};
use windows::Win32::Media::{timeBeginPeriod, timeEndPeriod};
use windows::Win32::System::Threading::{
    GetCurrentThread, SetThreadPriority, THREAD_PRIORITY_TIME_CRITICAL,
};
use windows::Win32::UI::WindowsAndMessaging::{
    GetForegroundWindow, GetWindowTextLengthW, GetWindowTextW, PostMessageW,
    WM_INPUTLANGCHANGEREQUEST,
};

/// Поднимает разрешение системного таймера до 1 мс на всё время жизни.
/// Без этого `thread::sleep` округляется до ~15.6 мс и весь тайминг рассыпается.
pub struct TimerResolution;

impl TimerResolution {
    pub fn acquire() -> Self {
        unsafe {
            timeBeginPeriod(1);
        }
        TimerResolution
    }
}

impl Drop for TimerResolution {
    fn drop(&mut self) {
        unsafe {
            timeEndPeriod(1);
        }
    }
}

/// Ждёт до момента `target`: грубым сном до последней миллисекунды, потом спином.
/// `cancel` вызывается примерно каждую миллисекунду — если вернёт true, ждать
/// перестаём (так плеер остаётся отзывчивым на паузу во время длинных пауз).
pub fn sleep_until<F: FnMut() -> bool>(target: Instant, mut cancel: F) -> bool {
    const SPIN_WINDOW: Duration = Duration::from_micros(1200);
    loop {
        let now = Instant::now();
        if now >= target {
            return false;
        }
        let left = target - now;
        if left > SPIN_WINDOW {
            let chunk = left - SPIN_WINDOW;
            std::thread::sleep(chunk.min(Duration::from_millis(1)));
            if cancel() {
                return true;
            }
        } else {
            std::hint::spin_loop();
        }
    }
}

/// Короткая пауза с микросекундной точностью (используется для длительности тапа).
pub fn precise_sleep_us(us: u64) {
    let target = Instant::now() + Duration::from_micros(us);
    if us > 2000 {
        std::thread::sleep(Duration::from_micros(us - 1200));
    }
    while Instant::now() < target {
        std::hint::spin_loop();
    }
}

pub fn boost_thread_priority() {
    unsafe {
        let _ = SetThreadPriority(GetCurrentThread(), THREAD_PRIORITY_TIME_CRITICAL);
    }
}

/// Заголовок окна, которое сейчас в фокусе. Пустая строка, если его нет.
pub fn foreground_window_title() -> String {
    unsafe {
        let hwnd = GetForegroundWindow();
        if hwnd.is_invalid() {
            return String::new();
        }
        let len = GetWindowTextLengthW(hwnd);
        if len <= 0 {
            return String::new();
        }
        let mut buf = vec![0u16; len as usize + 1];
        let written = GetWindowTextW(hwnd, &mut buf);
        if written <= 0 {
            return String::new();
        }
        String::from_utf16_lossy(&buf[..written as usize])
    }
}

/// Просит окно в фокусе переключиться на английскую раскладку.
///
/// Нужно, потому что при активной русской раскладке игра получит «й» вместо «q».
/// Скан-коды это чаще всего обходят, но некоторые игры читают символ.
pub fn request_english_layout() {
    unsafe {
        let name: Vec<u16> = "00000409\0".encode_utf16().collect();
        let hkl = LoadKeyboardLayoutW(PCWSTR(name.as_ptr()), KLF_SETFORPROCESS);
        let Ok(hkl) = hkl else { return };

        let _ = ActivateKeyboardLayout(hkl, KLF_SETFORPROCESS);

        let hwnd = GetForegroundWindow();
        if !hwnd.is_invalid() {
            let _ = PostMessageW(
                Some(hwnd),
                WM_INPUTLANGCHANGEREQUEST,
                windows::Win32::Foundation::WPARAM(0),
                windows::Win32::Foundation::LPARAM(hkl.0 as isize),
            );
        }
    }
}

/// Проверка «мы вообще в нужном окне?» — подстрока, регистр не важен.
pub fn window_matches(needle: &str) -> bool {
    if needle.trim().is_empty() {
        return true;
    }
    let title = foreground_window_title().to_lowercase();
    needle
        .split(';')
        .map(|s| s.trim().to_lowercase())
        .filter(|s| !s.is_empty())
        .any(|s| title.contains(&s))
}

#[allow(dead_code)]
fn _unused_hwnd(_h: HWND) {}
