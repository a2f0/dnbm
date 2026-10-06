//! Small signal-processing building blocks shared by the instruments and the mixer.

pub mod compressor;
pub mod delay;
pub mod reverb;

pub use core::f32::consts::{PI, TAU};

/// The quality factor of a Butterworth (maximally flat) filter.
pub const BUTTERWORTH_Q: f32 = core::f32::consts::FRAC_1_SQRT_2;

/// ln(1000): an exponential decay falls by 60 dB after `ln(1000)` time constants.
const LN_1000: f32 = 3.0 * core::f32::consts::LN_10;

/// Decibels to linear gain, with -60 dB and below as silence.
#[inline]
pub fn db_to_gain(db: f32) -> f32 {
    if db <= -60.0 {
        0.0
    } else {
        10f32.powf(db / 20.0)
    }
}

/// Flushes values far below hearing to zero, so decaying feedback never lingers in
/// subnormal floats, which are slow on some CPUs.
#[inline]
pub fn flush(x: f32) -> f32 {
    if x.abs() < 1e-15 { 0.0 } else { x }
}

/// The frequency of a MIDI note, with A4 (69) at 440 Hz.
#[inline]
pub fn midi_to_hz(note: f32) -> f32 {
    440.0 * 2f32.powf((note - 69.0) / 12.0)
}

/// The per-sample multiplier of an exponential decay that falls 60 dB in `seconds`.
#[inline]
pub fn decay_multiplier(seconds: f32, sample_rate: f32) -> f32 {
    (-LN_1000 / (seconds.max(1e-4) * sample_rate)).exp()
}

/// The coefficient of a one-pole smoother that covers 95% of a step in `seconds`.
#[inline]
pub fn smoothing_coefficient(seconds: f32, sample_rate: f32) -> f32 {
    if seconds <= 0.0 {
        1.0
    } else {
        1.0 - (-3.0 / (seconds * sample_rate)).exp()
    }
}

/// Velocity (0 to 1) to amplitude: a ghost note (0.4) is about -12 dB.
#[inline]
pub fn velocity_gain(velocity: f32) -> f32 {
    let v = velocity.clamp(0.0, 1.0);
    v * v.sqrt()
}

/// A soft clipper that leaves quiet signals alone and never exceeds 1.
#[inline]
pub fn saturate(x: f32) -> f32 {
    x.tanh()
}

/// xorshift32: fast, seedable noise, so every render of a song is identical.
#[derive(Clone)]
pub struct Rng(u32);

impl Rng {
    pub fn new(seed: u32) -> Self {
        Rng(seed.max(1))
    }

    #[inline]
    pub fn next_u32(&mut self) -> u32 {
        let mut x = self.0;
        x ^= x << 13;
        x ^= x >> 17;
        x ^= x << 5;
        self.0 = x;
        x
    }

    /// Uniform noise in [-1, 1).
    #[inline]
    pub fn bipolar(&mut self) -> f32 {
        (self.next_u32() >> 8) as f32 * (2.0 / 16_777_216.0) - 1.0
    }
}

/// The polynomial band-limited step correction for an oscillator discontinuity, which
/// keeps saw and square waves from aliasing. `t` is the phase in [0, 1), `dt` the
/// phase increment per sample.
#[inline]
pub fn poly_blep(t: f32, dt: f32) -> f32 {
    if t < dt {
        let t = t / dt;
        t + t - t * t - 1.0
    } else if t > 1.0 - dt {
        let t = (t - 1.0) / dt;
        t * t + t + t + 1.0
    } else {
        0.0
    }
}

/// A band-limited sawtooth.
#[derive(Clone, Default)]
pub struct Saw {
    pub phase: f32,
}

impl Saw {
    #[inline]
    pub fn next(&mut self, dt: f32) -> f32 {
        let value = 2.0 * self.phase - 1.0 - poly_blep(self.phase, dt);
        self.phase += dt;
        if self.phase >= 1.0 {
            self.phase -= 1.0;
        }
        value
    }
}

/// A band-limited square.
#[derive(Clone, Default)]
pub struct Square {
    pub phase: f32,
}

impl Square {
    #[inline]
    pub fn next(&mut self, dt: f32) -> f32 {
        let half = if self.phase < 0.5 { 1.0 } else { -1.0 };
        let shifted = if self.phase < 0.5 {
            self.phase + 0.5
        } else {
            self.phase - 0.5
        };
        let value = half + poly_blep(self.phase, dt) - poly_blep(shifted, dt);
        self.phase += dt;
        if self.phase >= 1.0 {
            self.phase -= 1.0;
        }
        value
    }
}

/// A one-pole filter with low-pass and high-pass outputs.
#[derive(Clone, Default)]
pub struct OnePole {
    state: f32,
    coefficient: f32,
}

impl OnePole {
    pub fn set(&mut self, cutoff: f32, sample_rate: f32) {
        let cutoff = cutoff.clamp(1.0, sample_rate * 0.49);
        self.coefficient = 1.0 - (-TAU * cutoff / sample_rate).exp();
    }

    #[inline]
    pub fn low(&mut self, x: f32) -> f32 {
        self.state = flush(self.state + (x - self.state) * self.coefficient);
        self.state
    }

    #[inline]
    pub fn high(&mut self, x: f32) -> f32 {
        x - self.low(x)
    }
}

/// The outputs of one state-variable filter step.
pub struct SvfOut {
    pub low: f32,
    pub band: f32,
    pub high: f32,
}

/// Andrew Simper's trapezoidal (zero-delay feedback) state-variable filter: stable and
/// accurate up to Nyquist, and smooth when its cutoff moves every sample.
#[derive(Clone)]
pub struct Svf {
    ic1: f32,
    ic2: f32,
    k: f32,
    a1: f32,
    a2: f32,
    a3: f32,
}

impl Default for Svf {
    fn default() -> Self {
        let mut svf = Svf {
            ic1: 0.0,
            ic2: 0.0,
            k: 1.0,
            a1: 0.0,
            a2: 0.0,
            a3: 0.0,
        };
        svf.set(1000.0, BUTTERWORTH_Q, 48_000.0);
        svf
    }
}

impl Svf {
    /// Sets the cutoff in Hz and the quality factor (BUTTERWORTH_Q is Butterworth).
    pub fn set(&mut self, cutoff: f32, q: f32, sample_rate: f32) {
        let cutoff = cutoff.clamp(10.0, sample_rate * 0.49);
        let g = (PI * cutoff / sample_rate).tan();
        self.k = 1.0 / q.max(0.05);
        self.a1 = 1.0 / (1.0 + g * (g + self.k));
        self.a2 = g * self.a1;
        self.a3 = g * self.a2;
    }

    /// Sets the cutoff with resonance from 0 (Butterworth) to 1 (close to ringing).
    pub fn set_resonant(&mut self, cutoff: f32, resonance: f32, sample_rate: f32) {
        let q = BUTTERWORTH_Q + resonance.clamp(0.0, 1.0).powi(2) * 11.0;
        self.set(cutoff, q, sample_rate);
    }

    #[inline]
    pub fn process(&mut self, x: f32) -> SvfOut {
        let v3 = x - self.ic2;
        let v1 = self.a1 * self.ic1 + self.a2 * v3;
        let v2 = self.ic2 + self.a2 * self.ic1 + self.a3 * v3;
        self.ic1 = flush(2.0 * v1 - self.ic1);
        self.ic2 = flush(2.0 * v2 - self.ic2);
        SvfOut {
            low: v2,
            band: v1,
            high: x - self.k * v1 - v2,
        }
    }
}

/// An attack-release envelope: rises toward 1 while the gate is held, and decays toward
/// silence after it is released. A retrigger starts from the current level, so a new
/// note never clicks.
#[derive(Clone)]
pub struct Envelope {
    pub level: f32,
    gate: bool,
    attack: f32,
    release: f32,
}

impl Default for Envelope {
    fn default() -> Self {
        Self::new()
    }
}

impl Envelope {
    pub fn new() -> Self {
        Envelope {
            level: 0.0,
            gate: false,
            attack: 1.0,
            release: 0.001,
        }
    }

    pub fn set(&mut self, attack_seconds: f32, release_seconds: f32, sample_rate: f32) {
        self.attack = smoothing_coefficient(attack_seconds, sample_rate);
        self.release = 1.0 - decay_multiplier(release_seconds, sample_rate);
    }

    pub fn gate_on(&mut self) {
        self.gate = true;
    }

    pub fn gate_off(&mut self) {
        self.gate = false;
    }

    pub fn is_gated(&self) -> bool {
        self.gate
    }

    pub fn is_silent(&self) -> bool {
        !self.gate && self.level < 1e-5
    }

    #[inline]
    pub fn tick(&mut self) -> f32 {
        if self.gate {
            self.level += (1.0 - self.level) * self.attack;
        } else {
            self.level = flush(self.level - self.level * self.release);
        }
        self.level
    }
}

/// A fast fade that silences a voice without a click when it is choked: retriggered,
/// or cut by another voice in its choke group.
#[derive(Clone)]
pub struct Fade {
    gain: f32,
    step: f32,
    fading: bool,
}

/// How long a choked voice takes to fade out.
const CHOKE_SECONDS: f32 = 0.005;

impl Default for Fade {
    fn default() -> Self {
        Self::new()
    }
}

impl Fade {
    pub fn new() -> Self {
        Fade {
            gain: 1.0,
            step: 0.0,
            fading: false,
        }
    }

    pub fn start(&mut self) {
        self.gain = 1.0;
        self.fading = false;
    }

    pub fn choke(&mut self, sample_rate: f32) {
        self.fading = true;
        self.step = 1.0 / (CHOKE_SECONDS * sample_rate);
    }

    pub fn is_silent(&self) -> bool {
        self.fading && self.gain <= 0.0
    }

    #[inline]
    pub fn tick(&mut self) -> f32 {
        if self.fading {
            self.gain = (self.gain - self.step).max(0.0);
        }
        self.gain
    }
}

/// Moves linearly from one value to another across a block, so gains and sends change
/// without zipper noise.
pub struct Ramp {
    value: f32,
    step: f32,
}

impl Ramp {
    pub fn new(from: f32, to: f32, frames: usize) -> Self {
        Ramp {
            value: from,
            step: if frames == 0 {
                0.0
            } else {
                (to - from) / frames as f32
            },
        }
    }

    #[inline]
    pub fn tick(&mut self) -> f32 {
        self.value += self.step;
        self.value
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decibels() {
        assert_eq!(db_to_gain(-60.0), 0.0);
        assert!((db_to_gain(0.0) - 1.0).abs() < 1e-6);
        assert!((db_to_gain(-6.0) - 0.501).abs() < 1e-3);
    }

    #[test]
    fn midi_notes() {
        assert!((midi_to_hz(69.0) - 440.0).abs() < 1e-3);
        assert!((midi_to_hz(29.0) - 43.654).abs() < 1e-2);
    }

    #[test]
    fn decay_reaches_minus_sixty_db() {
        let sample_rate = 48_000.0;
        let multiplier = decay_multiplier(0.5, sample_rate);
        let level = multiplier.powi(24_000);
        assert!((level - 0.001).abs() < 1e-4);
    }

    #[test]
    fn noise_is_bipolar_and_deterministic() {
        let mut a = Rng::new(7);
        let mut b = Rng::new(7);
        for _ in 0..10_000 {
            let x = a.bipolar();
            assert!((-1.0..1.0).contains(&x));
            assert_eq!(x, b.bipolar());
        }
    }

    #[test]
    fn low_pass_passes_dc_and_high_pass_removes_it() {
        let mut low = Svf::default();
        let mut high = Svf::default();
        low.set(1000.0, BUTTERWORTH_Q, 48_000.0);
        high.set(1000.0, BUTTERWORTH_Q, 48_000.0);
        let (mut l, mut h) = (0.0, 0.0);
        for _ in 0..48_000 {
            l = low.process(1.0).low;
            h = high.process(1.0).high;
        }
        assert!((l - 1.0).abs() < 1e-3);
        assert!(h.abs() < 1e-3);
    }

    #[test]
    fn envelope_rises_and_falls() {
        let mut envelope = Envelope::new();
        envelope.set(0.01, 0.1, 48_000.0);
        envelope.gate_on();
        for _ in 0..4_800 {
            envelope.tick();
        }
        assert!(envelope.level > 0.99);
        envelope.gate_off();
        for _ in 0..9_600 {
            envelope.tick();
        }
        assert!(envelope.is_silent());
    }
}
