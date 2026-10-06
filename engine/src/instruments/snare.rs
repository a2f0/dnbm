//! A snare drum: a two-tone pitched body under high-passed noise, with a transient snap.

use crate::dsp::{BUTTERWORTH_Q, Fade, Rng, Svf, TAU, decay_multiplier, velocity_gain};

const PITCH_DROP_SECONDS: f32 = 0.012;
const TRANSIENT_SECONDS: f32 = 0.004;
/// The second body partial, above the first by an inharmonic ratio.
const OVERTONE: f32 = 1.62;

pub struct Snare {
    sample_rate: f32,
    tune: f32,
    tone: f32,
    decay: f32,
    snap: f32,
    phases: [f32; 2],
    body: f32,
    body_multiplier: f32,
    pitch: f32,
    pitch_multiplier: f32,
    noise_env: f32,
    noise_multiplier: f32,
    transient: f32,
    transient_multiplier: f32,
    gain: f32,
    noise: Rng,
    high_pass: Svf,
    band_pass: Svf,
    fade: Fade,
    active: bool,
}

impl Snare {
    pub fn new(sample_rate: f32, seed: u32) -> Self {
        Snare {
            sample_rate,
            tune: 185.0,
            tone: 0.35,
            decay: 0.22,
            snap: 0.65,
            phases: [0.0; 2],
            body: 0.0,
            body_multiplier: 0.0,
            pitch: 0.0,
            pitch_multiplier: 0.0,
            noise_env: 0.0,
            noise_multiplier: 0.0,
            transient: 0.0,
            transient_multiplier: 0.0,
            gain: 0.0,
            noise: Rng::new(seed),
            high_pass: Svf::default(),
            band_pass: Svf::default(),
            fade: Fade::new(),
            active: false,
        }
    }

    /// tune (Hz), tone (body against noise, 0 to 1), decay (noise, s), snap (0 to 1).
    pub fn set_params(&mut self, params: &[f32]) {
        self.tune = params[0];
        self.tone = params[1];
        self.decay = params[2];
        self.snap = params[3];
        let rate = self.sample_rate;
        self.high_pass
            .set(900.0 + self.snap * 3_500.0, BUTTERWORTH_Q, rate);
        self.band_pass.set(3_200.0 + self.snap * 2_500.0, 0.9, rate);
    }

    pub fn trigger(&mut self, velocity: f32) {
        let rate = self.sample_rate;
        self.phases = [0.0; 2];
        self.body = 1.0;
        self.pitch = 1.0;
        self.noise_env = 1.0;
        self.transient = 1.0;
        self.body_multiplier = decay_multiplier(0.06 + self.tone * 0.12, rate);
        self.pitch_multiplier = (-1.0 / (PITCH_DROP_SECONDS * rate)).exp();
        self.noise_multiplier = decay_multiplier(self.decay, rate);
        self.transient_multiplier = decay_multiplier(TRANSIENT_SECONDS, rate);
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
        let body_level = 0.3 + self.tone * 0.9;
        let noise_level = 1.1 - self.tone * 0.6;
        for o in out.iter_mut() {
            let frequency = self.tune * (1.0 + 0.5 * self.pitch);
            self.phases[0] = (self.phases[0] + frequency * inverse_rate).fract();
            self.phases[1] = (self.phases[1] + frequency * OVERTONE * inverse_rate).fract();
            let body = ((self.phases[0] * TAU).sin() * 0.65 + (self.phases[1] * TAU).sin() * 0.35)
                * self.body;
            let white = self.noise.bipolar();
            let noise = (self.high_pass.process(white).high * 0.8
                + self.band_pass.process(white).band * 0.6)
                * self.noise_env;
            let transient = white * self.transient * self.snap;
            let mix = body * body_level + noise * noise_level + transient * 0.6;
            *o += mix * 0.7 * self.gain * self.fade.tick();
            self.body *= self.body_multiplier;
            self.pitch *= self.pitch_multiplier;
            self.noise_env *= self.noise_multiplier;
            self.transient *= self.transient_multiplier;
        }
        if (self.body < 1e-4 && self.noise_env < 1e-4) || self.fade.is_silent() {
            self.active = false;
        }
    }
}
