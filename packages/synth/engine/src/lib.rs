//! dnbm's audio engine: a drum and bass sequencer, synthesizer and mixer, compiled to a
//! WebAssembly module with no imports. The browser runs it in an AudioWorklet, and
//! scripts/render.ts runs the same module offline, so a song renders identically in
//! both.
//!
//! The interface is a C ABI of numbers and pointers into linear memory, so the module
//! needs no generated glue; src/audio/wasmEngine.ts is the other side.

pub mod dsp;
pub mod engine;
pub mod instruments;
pub mod mixer;
pub mod song;

use std::sync::OnceLock;

use engine::{Engine, MAX_FRAMES, METER_COUNT, PlayMode};
use instruments::InstrumentKind;

fn mode(value: u32) -> PlayMode {
    if value == 1 {
        PlayMode::Pattern
    } else {
        PlayMode::Song
    }
}

/// # Safety
///
/// `engine` must come from `engine_new` and not have been freed.
unsafe fn engine<'a>(engine: *mut Engine) -> &'a mut Engine {
    unsafe { &mut *engine }
}

/// Creates an engine running at `sample_rate`.
#[unsafe(no_mangle)]
pub extern "C" fn engine_new(sample_rate: f32) -> *mut Engine {
    Box::into_raw(Box::new(Engine::new(sample_rate)))
}

/// # Safety
///
/// `engine` must come from `engine_new` and not have been freed.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn engine_free(engine: *mut Engine) {
    if !engine.is_null() {
        drop(unsafe { Box::from_raw(engine) });
    }
}

/// Sizes the song buffer to `length` floats and returns where to write them; then call
/// `engine_load_song`. The pointer is only valid until the next call that allocates.
///
/// # Safety
///
/// `engine` must come from `engine_new` and not have been freed.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn engine_song_buffer(engine: *mut Engine, length: u32) -> *mut f32 {
    let engine = unsafe { self::engine(engine) };
    engine.song_buffer.clear();
    engine.song_buffer.resize(length as usize, 0.0);
    engine.song_buffer.as_mut_ptr()
}

/// Loads the song in the song buffer. Returns 0, or a negative `SongError` code.
///
/// # Safety
///
/// `engine` must come from `engine_new` and not have been freed.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn engine_load_song(engine: *mut Engine) -> i32 {
    match unsafe { self::engine(engine) }.load_song() {
        Ok(()) => 0,
        Err(error) => error as i32,
    }
}

/// Plays from an arrangement slot (`mode` 0) or loops a pattern (`mode` 1).
///
/// # Safety
///
/// `engine` must come from `engine_new` and not have been freed.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn engine_play(engine: *mut Engine, mode: u32, index: u32) {
    unsafe { self::engine(engine) }.play(self::mode(mode), index as usize);
}

/// Switches to a slot or pattern without restarting.
///
/// # Safety
///
/// `engine` must come from `engine_new` and not have been freed.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn engine_cue(engine: *mut Engine, mode: u32, index: u32) {
    unsafe { self::engine(engine) }.cue(self::mode(mode), index as usize);
}

/// # Safety
///
/// `engine` must come from `engine_new` and not have been freed.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn engine_stop(engine: *mut Engine) {
    unsafe { self::engine(engine) }.stop();
}

/// Auditions a hit or note on a track.
///
/// # Safety
///
/// `engine` must come from `engine_new` and not have been freed.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn engine_trigger(engine: *mut Engine, track: u32, velocity: f32, note: f32) {
    unsafe { self::engine(engine) }.trigger(track as usize, velocity, note);
}

/// Releases an auditioned note.
///
/// # Safety
///
/// `engine` must come from `engine_new` and not have been freed.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn engine_release(engine: *mut Engine, track: u32) {
    unsafe { self::engine(engine) }.release(track as usize);
}

/// Renders up to `engine_max_frames` frames; read them from `engine_output`.
///
/// # Safety
///
/// `engine` must come from `engine_new` and not have been freed.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn engine_render(engine: *mut Engine, frames: u32) -> u32 {
    unsafe { self::engine(engine) }.render(frames as usize) as u32
}

/// The rendered left (0) or right (1) channel.
///
/// # Safety
///
/// `engine` must come from `engine_new` and not have been freed.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn engine_output(engine: *mut Engine, channel: u32) -> *const f32 {
    unsafe { self::engine(engine) }
        .output(channel as usize)
        .as_ptr()
}

/// # Safety
///
/// `engine` must come from `engine_new` and not have been freed.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn engine_playing(engine: *mut Engine) -> u32 {
    u32::from(unsafe { self::engine(engine) }.is_playing())
}

/// Counts every step fired; when it changes, read the slot, pattern and step.
///
/// # Safety
///
/// `engine` must come from `engine_new` and not have been freed.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn engine_position_serial(engine: *mut Engine) -> u32 {
    unsafe { self::engine(engine) }.position().serial
}

/// # Safety
///
/// `engine` must come from `engine_new` and not have been freed.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn engine_position_slot(engine: *mut Engine) -> u32 {
    unsafe { self::engine(engine) }.position().slot as u32
}

/// # Safety
///
/// `engine` must come from `engine_new` and not have been freed.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn engine_position_pattern(engine: *mut Engine) -> u32 {
    unsafe { self::engine(engine) }.position().pattern as u32
}

/// # Safety
///
/// `engine` must come from `engine_new` and not have been freed.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn engine_position_step(engine: *mut Engine) -> u32 {
    unsafe { self::engine(engine) }.position().step as u32
}

/// Peak levels since the last reset: one per track slot, then the master's left and
/// right (`engine_meter_count` in all).
///
/// # Safety
///
/// `engine` must come from `engine_new` and not have been freed.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn engine_meters(engine: *mut Engine) -> *const f32 {
    unsafe { self::engine(engine) }.meters().as_ptr()
}

/// # Safety
///
/// `engine` must come from `engine_new` and not have been freed.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn engine_reset_meters(engine: *mut Engine) {
    unsafe { self::engine(engine) }.reset_meters();
}

#[unsafe(no_mangle)]
pub extern "C" fn engine_meter_count() -> u32 {
    METER_COUNT as u32
}

#[unsafe(no_mangle)]
pub extern "C" fn engine_max_frames() -> u32 {
    MAX_FRAMES as u32
}

/// The compiled-song version and each instrument's parameters, in order, as
/// `version=1;kick=tune,sweep,...;...`. The web side checks its tables against it.
pub fn description() -> &'static str {
    static DESCRIPTION: OnceLock<String> = OnceLock::new();
    DESCRIPTION.get_or_init(|| {
        let mut text = format!("version={}", song::VERSION);
        for kind in InstrumentKind::ALL {
            text.push(';');
            text.push_str(kind.name());
            text.push('=');
            text.push_str(&kind.params().join(","));
        }
        text
    })
}

/// A pointer to `description()`'s UTF-8 bytes.
#[unsafe(no_mangle)]
pub extern "C" fn engine_describe() -> *const u8 {
    description().as_ptr()
}

#[unsafe(no_mangle)]
pub extern "C" fn engine_describe_length() -> u32 {
    description().len() as u32
}
