//! A reese bass, the growl under dark drum and bass: three detuned saws beating against
//! each other, driven into a resonant 24 dB low-pass, with a filter envelope, a
//! tempo-synced wobble, and a clean sine sub an octave down.

use crate::dsp::{
    Envelope, Fade, Saw, Svf, TAU, decay_multiplier, midi_to_hz, smoothing_coefficient,
    velocity_gain,
};

const ATTACK_SECONDS: f32 = 0.003;

pub struct Reese {
    sample_rate: f32,
    cutoff: f32,
    resonance: f32,
    detune: f32,
    sub: f32,
    env_amount: f32,
    decay: f32,
    rate: f32,
    wobble: f32,
    glide: f32,
    release: f32,
    saws: [Saw; 3],
    sub_phase: f32,
    frequency: f32,
    target: f32,
    glide_coefficient: f32,
    amp: Envelope,
    filter_env: f32,
    filter_multiplier: f32,
    lfo_phase: f32,
    filters: [Svf; 2],
    gain: f32,
    fade: Fade,
}

impl Reese {
    pub fn new(sample_rate: f32, seed: u32) -> Self {
        // Fixed, spread starting phases: the beating starts the same in every render.
        let offset = (seed % 7) as f32 / 7.0;
        Reese {
            sample_rate,
            cutoff: 700.0,
            resonance: 0.3,
            detune: 18.0,
            sub: 0.4,
            env_amount: 0.35,
            decay: 0.3,
            rate: 8.0,
            wobble: 0.0,
            glide: 0.06,
            release: 0.15,
            saws: [
                Saw { phase: offset },
                Saw {
                    phase: (offset + 0.37).fract(),
                },
                Saw {
                    phase: (offset + 0.71).fract(),
                },
            ],
            sub_phase: 0.0,
            frequency: 43.65,
            target: 43.65,
            glide_coefficient: 1.0,
            amp: Envelope::new(),
            filter_env: 0.0,
            filter_multiplier: 0.0,
            lfo_phase: 0.0,
            filters: [Svf::default(), Svf::default()],
            gain: 0.0,
            fade: Fade::new(),
        }
    }

    /// cutoff (Hz), resonance (0 to 1), detune (cents), sub (0 to 1), env (filter
    /// envelope depth, 0 to 1), decay (filter envelope, s), rate (wobble cycle, in
    /// sixteenths), wobble (depth, 0 to 1), glide (s), release (s).
    pub fn set_params(&mut self, params: &[f32]) {
        self.cutoff = params[0];
        self.resonance = params[1];
        self.detune = params[2];
        self.sub = params[3];
        self.env_amount = params[4];
        self.decay = params[5];
        self.rate = params[6].max(0.25);
        self.wobble = params[7];
        self.glide = params[8];
        self.release = params[9];
        self.glide_coefficient = smoothing_coefficient(self.glide, self.sample_rate);
        self.filter_multiplier = decay_multiplier(self.decay, self.sample_rate);
        self.amp.set(ATTACK_SECONDS, self.release, self.sample_rate);
    }

    pub fn trigger(&mut self, velocity: f32, note: f32, legato: bool) {
        if self.fade.is_silent() {
            self.amp.level = 0.0;
        }
        self.target = midi_to_hz(note);
        if !legato {
            self.frequency = self.target;
            self.filter_env = 1.0;
            self.lfo_phase = 0.0;
        } else if self.glide <= 0.0 {
            self.frequency = self.target;
        }
        self.amp.gate_on();
        self.gain = velocity_gain(velocity);
        self.fade.start();
    }

    pub fn release(&mut self) {
        self.amp.gate_off();
    }

    pub fn choke(&mut self) {
        self.amp.gate_off();
        self.fade.choke(self.sample_rate);
    }

    pub fn is_active(&self) -> bool {
        !self.amp.is_silent() && !self.fade.is_silent()
    }

    pub fn render(&mut self, out: &mut [f32], context: super::Context) {
        if !self.is_active() {
            return;
        }
        let rate = self.sample_rate;
        let inverse_rate = 1.0 / rate;
        let spread = 2f32.powf(self.detune / 1200.0);
        let lfo_increment = 1.0 / (self.rate * context.step_seconds * rate).max(1.0);
        let max_cutoff = rate * 0.45;
        for o in out.iter_mut() {
            self.frequency += (self.target - self.frequency) * self.glide_coefficient;
            let dt = self.frequency * inverse_rate;
            let saws = (self.saws[0].next(dt / spread)
                + self.saws[1].next(dt)
                + self.saws[2].next(dt * spread))
                / 3.0;
            self.sub_phase = (self.sub_phase + dt * 0.5).fract();
            let sub = (self.sub_phase * TAU).sin();

            // The wobble opens the filter from its cutoff and back once per cycle.
            let wobble = 0.5 - 0.5 * (self.lfo_phase * TAU).cos();
            self.lfo_phase = (self.lfo_phase + lfo_increment).fract();
            let octaves = self.env_amount * 5.0 * self.filter_env + self.wobble * 3.5 * wobble;
            let cutoff = (self.cutoff * 2f32.powf(octaves)).min(max_cutoff);
            self.filters[0].set_resonant(cutoff, self.resonance * 0.5, rate);
            self.filters[1].set_resonant(cutoff, self.resonance, rate);

            let driven = (saws * 1.8).tanh();
            let first = self.filters[0].process(driven).low;
            let filtered = self.filters[1].process(first).low;
            let voice = filtered * 0.8 + sub * self.sub * 0.55;
            *o += voice * self.amp.tick() * self.gain * self.fade.tick();
            self.filter_env *= self.filter_multiplier;
        }
    }
}
