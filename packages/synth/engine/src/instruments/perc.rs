//! A tuned percussion voice for rims, toms and blips: a sine with a pitch drop and a
//! band of noise around it.

use crate::dsp::{Fade, Rng, Svf, TAU, decay_multiplier, velocity_gain};

const PITCH_DROP_SECONDS: f32 = 0.02;

pub struct Perc {
    sample_rate: f32,
    tune: f32,
    decay: f32,
    bend: f32,
    noise_amount: f32,
    phase: f32,
    amp: f32,
    amp_multiplier: f32,
    noise_env: f32,
    noise_multiplier: f32,
    pitch: f32,
    pitch_multiplier: f32,
    gain: f32,
    noise: Rng,
    band_pass: Svf,
    fade: Fade,
    active: bool,
}

impl Perc {
    pub fn new(sample_rate: f32, seed: u32) -> Self {
        Perc {
            sample_rate,
            tune: 420.0,
            decay: 0.12,
            bend: 0.3,
            noise_amount: 0.2,
            phase: 0.0,
            amp: 0.0,
            amp_multiplier: 0.0,
            noise_env: 0.0,
            noise_multiplier: 0.0,
            pitch: 0.0,
            pitch_multiplier: 0.0,
            gain: 0.0,
            noise: Rng::new(seed),
            band_pass: Svf::default(),
            fade: Fade::new(),
            active: false,
        }
    }

    /// tune (Hz), decay (s), bend (pitch drop depth, 0 to 1), noise (0 to 1).
    pub fn set_params(&mut self, params: &[f32]) {
        self.tune = params[0];
        self.decay = params[1];
        self.bend = params[2];
        self.noise_amount = params[3];
        self.band_pass.set(self.tune * 3.0, 2.0, self.sample_rate);
    }

    pub fn trigger(&mut self, velocity: f32) {
        let rate = self.sample_rate;
        self.phase = 0.0;
        self.amp = 1.0;
        self.noise_env = 1.0;
        self.pitch = 1.0;
        self.amp_multiplier = decay_multiplier(self.decay, rate);
        self.noise_multiplier = decay_multiplier(self.decay * 0.4, rate);
        self.pitch_multiplier = (-1.0 / (PITCH_DROP_SECONDS * rate)).exp();
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
        for o in out.iter_mut() {
            let frequency = self.tune * (1.0 + self.bend * 3.0 * self.pitch);
            self.phase = (self.phase + frequency * inverse_rate).fract();
            let tone = (self.phase * TAU).sin() * self.amp;
            let noise = self.band_pass.process(self.noise.bipolar()).band
                * self.noise_env
                * self.noise_amount;
            *o += (tone * 0.8 + noise * 1.5) * self.gain * self.fade.tick();
            self.amp *= self.amp_multiplier;
            self.noise_env *= self.noise_multiplier;
            self.pitch *= self.pitch_multiplier;
            // Stop on the sample the sound is spent, so the state its next trigger starts
            // from never depends on where a block boundary fell.
            if self.amp < 1e-4 || self.fade.is_silent() {
                self.active = false;
                break;
            }
        }
    }
}
