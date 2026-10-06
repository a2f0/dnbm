//! A sub bass: a sine with optional warmth (a second harmonic and gentle saturation) so
//! it still reads on small speakers.

use crate::dsp::{Envelope, Fade, TAU, midi_to_hz, smoothing_coefficient, velocity_gain};

pub struct Sub {
    sample_rate: f32,
    glide: f32,
    attack: f32,
    release: f32,
    warmth: f32,
    phase: f32,
    frequency: f32,
    target: f32,
    glide_coefficient: f32,
    envelope: Envelope,
    gain: f32,
    fade: Fade,
}

impl Sub {
    pub fn new(sample_rate: f32) -> Self {
        Sub {
            sample_rate,
            glide: 0.03,
            attack: 0.005,
            release: 0.12,
            warmth: 0.15,
            phase: 0.0,
            frequency: 43.65,
            target: 43.65,
            glide_coefficient: 1.0,
            envelope: Envelope::new(),
            gain: 0.0,
            fade: Fade::new(),
        }
    }

    /// glide (s), attack (s), release (s), warmth (0 to 1).
    pub fn set_params(&mut self, params: &[f32]) {
        self.glide = params[0];
        self.attack = params[1];
        self.release = params[2];
        self.warmth = params[3];
        self.glide_coefficient = smoothing_coefficient(self.glide, self.sample_rate);
        self.envelope
            .set(self.attack, self.release, self.sample_rate);
    }

    pub fn trigger(&mut self, velocity: f32, note: f32, legato: bool) {
        if self.fade.is_silent() {
            self.envelope.level = 0.0;
        }
        self.target = midi_to_hz(note);
        if !legato || self.glide <= 0.0 {
            self.frequency = self.target;
        }
        self.envelope.gate_on();
        self.gain = velocity_gain(velocity);
        self.fade.start();
    }

    pub fn release(&mut self) {
        self.envelope.gate_off();
    }

    pub fn choke(&mut self) {
        self.envelope.gate_off();
        self.fade.choke(self.sample_rate);
    }

    pub fn is_active(&self) -> bool {
        !self.envelope.is_silent() && !self.fade.is_silent()
    }

    pub fn render(&mut self, out: &mut [f32]) {
        if !self.is_active() {
            return;
        }
        let inverse_rate = 1.0 / self.sample_rate;
        let drive = 1.0 + self.warmth * 2.5;
        let normalize = 1.0 / drive.tanh();
        for o in out.iter_mut() {
            self.frequency += (self.target - self.frequency) * self.glide_coefficient;
            self.phase = (self.phase + self.frequency * inverse_rate).fract();
            let fundamental = (self.phase * TAU).sin();
            let second = (self.phase * 2.0 * TAU).sin();
            let shaped = ((fundamental + self.warmth * 0.3 * second) * drive).tanh() * normalize;
            *o += shaped * 0.85 * self.envelope.tick() * self.gain * self.fade.tick();
            // Stop on the sample the sound is spent, so the state its next trigger starts
            // from never depends on where a block boundary fell.
            if !self.is_active() {
                break;
            }
        }
    }
}
