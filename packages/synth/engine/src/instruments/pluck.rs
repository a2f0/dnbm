//! A plucked string (Karplus-Strong): a burst of filtered noise circulating in a delay
//! line one period long, losing its highs on every pass.

use crate::dsp::{Fade, OnePole, Rng, flush, midi_to_hz, velocity_gain};

/// The lowest note the delay line can hold.
const LOWEST_HZ: f32 = 20.0;

pub struct Pluck {
    sample_rate: f32,
    tone: f32,
    decay: f32,
    release_seconds: f32,
    buffer: Vec<f32>,
    position: usize,
    delay: f32,
    previous: f32,
    loop_gain: f32,
    release_gain: f32,
    released: bool,
    gain: f32,
    noise: Rng,
    fade: Fade,
    active: bool,
    quiet: usize,
}

impl Pluck {
    pub fn new(sample_rate: f32, seed: u32) -> Self {
        let length = (sample_rate / LOWEST_HZ) as usize + 4;
        Pluck {
            sample_rate,
            tone: 0.45,
            decay: 0.6,
            release_seconds: 0.08,
            buffer: vec![0.0; length],
            position: 0,
            delay: 100.0,
            previous: 0.0,
            loop_gain: 0.0,
            release_gain: 0.0,
            released: false,
            gain: 0.0,
            noise: Rng::new(seed),
            fade: Fade::new(),
            active: false,
            quiet: 0,
        }
    }

    /// tone (0 to 1, dark to bright), decay (0 to 1, how long it rings), release (how
    /// fast a rest damps it, s).
    pub fn set_params(&mut self, params: &[f32]) {
        self.tone = params[0];
        self.decay = params[1];
        self.release_seconds = params[2].max(0.005);
    }

    /// The per-pass gain that makes the string fall 60 dB in `seconds`.
    fn loop_gain_for(&self, seconds: f32) -> f32 {
        10f32.powf(-3.0 * (self.delay / self.sample_rate) / seconds)
    }

    pub fn trigger(&mut self, velocity: f32, note: f32) {
        let rate = self.sample_rate;
        let frequency = midi_to_hz(note).clamp(LOWEST_HZ * 1.5, rate / 4.0);
        // The averaging filter in the loop adds half a sample of delay.
        self.delay = (rate / frequency - 0.5).clamp(2.0, (self.buffer.len() - 2) as f32);

        let mut excitation = OnePole::default();
        excitation.set(300.0 + self.tone * self.tone * 9_000.0, rate);
        let mut peak = 0.0f32;
        for sample in self.buffer.iter_mut() {
            *sample = excitation.low(self.noise.bipolar());
            peak = peak.max(sample.abs());
        }
        let scale = if peak > 0.0 { 0.8 / peak } else { 0.0 };
        for sample in self.buffer.iter_mut() {
            *sample *= scale;
        }

        let ring_seconds = 0.15 * 50f32.powf(self.decay);
        self.loop_gain = self.loop_gain_for(ring_seconds);
        self.release_gain = self.loop_gain_for(self.release_seconds);
        self.released = false;
        self.previous = 0.0;
        self.gain = velocity_gain(velocity);
        self.quiet = 0;
        self.fade.start();
        self.active = true;
    }

    pub fn release(&mut self) {
        self.released = true;
    }

    pub fn choke(&mut self) {
        self.fade.choke(self.sample_rate);
    }

    pub fn is_active(&self) -> bool {
        self.active
    }

    #[inline]
    fn read(&self) -> f32 {
        let length = self.buffer.len() as f32;
        let mut read = self.position as f32 - self.delay;
        if read < 0.0 {
            read += length;
        }
        let mut index = read as usize;
        let mut fraction = read - index as f32;
        // Rounding can land a read a hair below zero exactly on the length.
        if index >= self.buffer.len() {
            index = 0;
            fraction = 0.0;
        }
        let next = (index + 1) % self.buffer.len();
        self.buffer[index] + (self.buffer[next] - self.buffer[index]) * fraction
    }

    pub fn render(&mut self, out: &mut [f32]) {
        if !self.active {
            return;
        }
        let brightness = self.tone * 0.5;
        let gain = if self.released {
            self.release_gain
        } else {
            self.loop_gain
        };
        for o in out.iter_mut() {
            let y = self.read();
            let averaged = 0.5 * (y + self.previous);
            self.previous = y;
            let filtered = averaged + (y - averaged) * brightness;
            self.buffer[self.position] = flush(filtered * gain);
            self.position += 1;
            if self.position == self.buffer.len() {
                self.position = 0;
            }
            *o += y * 0.9 * self.gain * self.fade.tick();
            if y.abs() < 1e-5 {
                self.quiet += 1;
            } else {
                self.quiet = 0;
            }
            // Stop on the sample the sound is spent, so the state its next trigger starts
            // from never depends on where a block boundary fell.
            if self.quiet > self.buffer.len() || self.fade.is_silent() {
                self.active = false;
                break;
            }
        }
    }
}
