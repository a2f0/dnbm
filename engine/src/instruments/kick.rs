//! A kick drum: a sine whose pitch drops fast from a high start, with a noise click.

use crate::dsp::{Fade, OnePole, Rng, TAU, decay_multiplier, velocity_gain};

const CLICK_SECONDS: f32 = 0.006;
const CLICK_HIGH_PASS_HZ: f32 = 1_500.0;

pub struct Kick {
    sample_rate: f32,
    tune: f32,
    sweep: f32,
    bend: f32,
    decay: f32,
    click: f32,
    phase: f32,
    amp: f32,
    amp_multiplier: f32,
    pitch: f32,
    pitch_multiplier: f32,
    click_env: f32,
    click_multiplier: f32,
    gain: f32,
    noise: Rng,
    click_filter: OnePole,
    fade: Fade,
    active: bool,
}

impl Kick {
    pub fn new(sample_rate: f32, seed: u32) -> Self {
        let mut click_filter = OnePole::default();
        click_filter.set(CLICK_HIGH_PASS_HZ, sample_rate);
        Kick {
            sample_rate,
            tune: 48.0,
            sweep: 5.0,
            bend: 0.035,
            decay: 0.45,
            click: 0.35,
            phase: 0.0,
            amp: 0.0,
            amp_multiplier: 0.0,
            pitch: 0.0,
            pitch_multiplier: 0.0,
            click_env: 0.0,
            click_multiplier: 0.0,
            gain: 0.0,
            noise: Rng::new(seed),
            click_filter,
            fade: Fade::new(),
            active: false,
        }
    }

    /// tune (Hz), sweep (start pitch as a multiple above tune), bend (pitch drop time,
    /// s), decay (s), click (0 to 1).
    pub fn set_params(&mut self, params: &[f32]) {
        self.tune = params[0];
        self.sweep = params[1];
        self.bend = params[2].max(0.001);
        self.decay = params[3];
        self.click = params[4];
    }

    pub fn trigger(&mut self, velocity: f32) {
        self.phase = 0.0;
        self.amp = 1.0;
        self.pitch = 1.0;
        self.click_env = 1.0;
        self.amp_multiplier = decay_multiplier(self.decay, self.sample_rate);
        self.pitch_multiplier = (-1.0 / (self.bend * self.sample_rate)).exp();
        self.click_multiplier = decay_multiplier(CLICK_SECONDS, self.sample_rate);
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
            let frequency = self.tune * (1.0 + self.sweep * self.pitch);
            self.phase += frequency * inverse_rate;
            if self.phase >= 1.0 {
                self.phase -= 1.0;
            }
            // A little saturation squares the body off, for weight under a dense mix.
            let body = ((self.phase * TAU).sin() * 1.4).tanh() * self.amp;
            let click = self.click_filter.high(self.noise.bipolar()) * self.click_env * self.click;
            *o += (body * 0.9 + click * 0.5) * self.gain * self.fade.tick();
            self.amp *= self.amp_multiplier;
            self.pitch *= self.pitch_multiplier;
            self.click_env *= self.click_multiplier;
            // Stop on the sample the sound is spent, so the state its next trigger starts
            // from never depends on where a block boundary fell.
            if self.amp < 1e-4 || self.fade.is_silent() {
                self.active = false;
                break;
            }
        }
    }
}
