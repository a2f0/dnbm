//! A hi-hat or ride: six detuned square oscillators at the TR-808's metallic ratios,
//! blended with noise and filtered high. Short decays make closed hats; long ones open
//! hats and rides.

use crate::dsp::{BUTTERWORTH_Q, Fade, Rng, Square, Svf, decay_multiplier, velocity_gain};

const FREQUENCIES: [f32; 6] = [205.3, 304.4, 369.6, 522.7, 540.0, 800.0];

pub struct Hat {
    sample_rate: f32,
    tone: f32,
    decay: f32,
    metal: f32,
    oscillators: [Square; 6],
    amp: f32,
    amp_multiplier: f32,
    gain: f32,
    noise: Rng,
    band_pass: Svf,
    high_pass: Svf,
    fade: Fade,
    active: bool,
}

impl Hat {
    pub fn new(sample_rate: f32, seed: u32) -> Self {
        Hat {
            sample_rate,
            tone: 1.0,
            decay: 0.06,
            metal: 0.6,
            oscillators: Default::default(),
            amp: 0.0,
            amp_multiplier: 0.0,
            gain: 0.0,
            noise: Rng::new(seed),
            band_pass: Svf::default(),
            high_pass: Svf::default(),
            fade: Fade::new(),
            active: false,
        }
    }

    /// tone (pitch and brightness, 0.5 to 2), decay (s), metal (squares against noise).
    pub fn set_params(&mut self, params: &[f32]) {
        self.tone = params[0];
        self.decay = params[1];
        self.metal = params[2];
        let brightness = self.tone.sqrt();
        let rate = self.sample_rate;
        self.band_pass.set(9_000.0 * brightness, 1.2, rate);
        self.high_pass
            .set(6_500.0 * brightness, BUTTERWORTH_Q, rate);
    }

    pub fn trigger(&mut self, velocity: f32) {
        self.amp = 1.0;
        self.amp_multiplier = decay_multiplier(self.decay, self.sample_rate);
        self.gain = velocity_gain(velocity);
        self.fade.start();
        self.active = true;
    }

    pub fn choke(&mut self) {
        self.fade.choke(self.sample_rate);
    }

    pub fn is_active(&self) -> bool {
        self.active
    }

    pub fn render(&mut self, out: &mut [f32]) {
        if !self.active {
            return;
        }
        let inverse_rate = 1.0 / self.sample_rate;
        let mut increments = [0.0; 6];
        for (increment, frequency) in increments.iter_mut().zip(FREQUENCIES) {
            *increment = (frequency * self.tone * inverse_rate).min(0.45);
        }
        for o in out.iter_mut() {
            let mut squares = 0.0;
            for (oscillator, increment) in self.oscillators.iter_mut().zip(increments) {
                squares += oscillator.next(increment);
            }
            let source = squares * (self.metal / 3.0) + self.noise.bipolar() * (1.0 - self.metal);
            let band = self.band_pass.process(source).band;
            let high = self.high_pass.process(band).high;
            *o += high * 1.6 * self.amp * self.gain * self.fade.tick();
            self.amp *= self.amp_multiplier;
            // Stop on the sample the sound is spent, so the state its next trigger starts
            // from never depends on where a block boundary fell.
            if self.amp < 1e-4 || self.fade.is_silent() {
                self.active = false;
                break;
            }
        }
    }
}
