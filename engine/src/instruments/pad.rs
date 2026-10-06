//! A dark pad: two detuned pairs of saws an interval apart, through a resonant 24 dB
//! low-pass with a filter envelope and a slow, tempo-synced sweep. Held, it drones;
//! gated short with a fast attack, it stabs.

use crate::dsp::{
    Envelope, Fade, Saw, Svf, TAU, decay_multiplier, midi_to_hz, smoothing_coefficient,
    velocity_gain,
};

/// How fast a legato note change settles, so a chord change never clicks.
const PITCH_SMOOTHING_SECONDS: f32 = 0.01;
/// The fastest an oscillator may run, as a fraction of the sample rate.
const MAX_INCREMENT: f32 = 0.45;

pub struct Pad {
    sample_rate: f32,
    cutoff: f32,
    resonance: f32,
    interval: f32,
    detune: f32,
    attack: f32,
    env_amount: f32,
    decay: f32,
    rate: f32,
    sweep: f32,
    release: f32,
    saws: [Saw; 4],
    frequency: f32,
    target: f32,
    pitch_coefficient: f32,
    amp: Envelope,
    filter_env: f32,
    filter_multiplier: f32,
    lfo_phase: f32,
    filters: [Svf; 2],
    gain: f32,
    fade: Fade,
}

impl Pad {
    pub fn new(sample_rate: f32, seed: u32) -> Self {
        // Fixed, spread starting phases: the beating starts the same in every render.
        let offset = (seed % 5) as f32 / 5.0;
        Pad {
            sample_rate,
            cutoff: 400.0,
            resonance: 0.25,
            interval: 7.0,
            detune: 12.0,
            attack: 0.4,
            env_amount: 0.2,
            decay: 0.8,
            rate: 32.0,
            sweep: 0.2,
            release: 0.6,
            saws: [
                Saw { phase: offset },
                Saw {
                    phase: (offset + 0.29).fract(),
                },
                Saw {
                    phase: (offset + 0.53).fract(),
                },
                Saw {
                    phase: (offset + 0.81).fract(),
                },
            ],
            frequency: 87.31,
            target: 87.31,
            pitch_coefficient: smoothing_coefficient(PITCH_SMOOTHING_SECONDS, sample_rate),
            amp: Envelope::new(),
            filter_env: 0.0,
            filter_multiplier: 0.0,
            lfo_phase: 0.0,
            filters: [Svf::default(), Svf::default()],
            gain: 0.0,
            fade: Fade::new(),
        }
    }

    /// cutoff (Hz), resonance (0 to 1), interval (the upper pair's distance in
    /// semitones, 0 to 12), detune (cents), attack (s), env (filter envelope depth, 0
    /// to 1), decay (filter envelope, s), rate (sweep cycle, in sixteenths), sweep
    /// (depth, 0 to 1), release (s).
    pub fn set_params(&mut self, params: &[f32]) {
        self.cutoff = params[0];
        self.resonance = params[1];
        self.interval = params[2];
        self.detune = params[3];
        self.attack = params[4];
        self.env_amount = params[5];
        self.decay = params[6];
        self.rate = params[7].max(0.25);
        self.sweep = params[8];
        self.release = params[9];
        self.filter_multiplier = decay_multiplier(self.decay, self.sample_rate);
        self.amp.set(self.attack, self.release, self.sample_rate);
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
        let interval = 2f32.powf(self.interval / 12.0);
        let lfo_increment = 1.0 / (self.rate * context.step_seconds * rate).max(1.0);
        let max_cutoff = rate * 0.45;
        for o in out.iter_mut() {
            self.frequency += (self.target - self.frequency) * self.pitch_coefficient;
            let lower = (self.frequency * inverse_rate).min(MAX_INCREMENT);
            let upper = (lower * interval).min(MAX_INCREMENT);
            let saws = (self.saws[0].next(lower / spread)
                + self.saws[1].next(lower * spread)
                + self.saws[2].next(upper / spread)
                + self.saws[3].next(upper * spread))
                * 0.25;

            // The sweep opens the filter from its cutoff and back once per cycle.
            let lfo = 0.5 - 0.5 * (self.lfo_phase * TAU).cos();
            self.lfo_phase = (self.lfo_phase + lfo_increment).fract();
            let octaves = self.env_amount * 4.0 * self.filter_env + self.sweep * 3.0 * lfo;
            let cutoff = (self.cutoff * 2f32.powf(octaves)).min(max_cutoff);
            self.filters[0].set_resonant(cutoff, self.resonance * 0.5, rate);
            self.filters[1].set_resonant(cutoff, self.resonance, rate);

            let first = self.filters[0].process(saws).low;
            let filtered = self.filters[1].process(first).low;
            *o += filtered * 0.7 * self.amp.tick() * self.gain * self.fade.tick();
            self.filter_env *= self.filter_multiplier;
        }
    }
}
