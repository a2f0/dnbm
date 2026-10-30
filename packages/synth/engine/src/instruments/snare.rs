//! A snare drum: a two-tone body and velocity-shaped wire noise, with a transient snap.

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
    strike_filter: Svf,
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
            strike_filter: Svf::default(),
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
        // A light stroke excites less high-frequency wire energy, not simply a
        // quieter copy of the accent. Keep the body outside this filter and the
        // noise seeded; see docs/music-fidelity.md for evidence and audition limits.
        let impact = velocity.clamp(0.0, 1.0);
        self.strike_filter
            .set(2_500.0 + 15_500.0 * impact * impact, BUTTERWORTH_Q, rate);
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
            let wires = self
                .strike_filter
                .process(noise * noise_level + transient * 0.6)
                .low;
            let mix = body * body_level + wires;
            *o += mix * 0.7 * self.gain * self.fade.tick();
            self.body *= self.body_multiplier;
            self.pitch *= self.pitch_multiplier;
            self.noise_env *= self.noise_multiplier;
            self.transient *= self.transient_multiplier;
            // Stop on the sample the sound is spent, so the state its next trigger starts
            // from never depends on where a block boundary fell.
            if (self.body < 1e-4 && self.noise_env < 1e-4) || self.fade.is_silent() {
                self.active = false;
                break;
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn hit(velocity: f32, rate: f32) -> Vec<f32> {
        let mut voice = Snare::new(rate, 17);
        voice.set_params(&[190.0, 0.42, 0.15, 0.46]);
        voice.trigger(velocity);
        let mut out = vec![0.0; (rate * 0.3) as usize];
        voice.render(&mut out);
        out
    }

    // Normalize away velocity gain: this tests articulation, not "louder is better".
    fn attack_brightness(samples: &[f32], rate: f32) -> f32 {
        let mut high = Svf::default();
        high.set(4_000.0, BUTTERWORTH_Q, rate);
        let mut total = 0.0;
        let mut treble = 0.0;
        for &x in samples.iter().take((rate * 0.02) as usize) {
            total += x * x;
            treble += high.process(x).high.powi(2);
        }
        treble / total
    }

    // Follow the engine's alternating-voice/choke lifecycle, including reuse of
    // a strike filter whose previous hit had a different velocity.
    fn retriggered(rate: f32, block: usize, params: &[f32]) -> Vec<f32> {
        let mut voices = [Snare::new(rate, 17), Snare::new(rate, 71)];
        for voice in &mut voices {
            voice.set_params(params);
        }
        let mut current = 0;
        let mut out = vec![0.0; (rate * 0.25) as usize];
        let events = [
            (0, Some(1.0)),
            (997, Some(0.4)),
            (1531, Some(0.75)),
            (2549, Some(1.0)),
            (3001, Some(0.4)),
            (6001, None),
        ];
        for (index, &(start, velocity)) in events.iter().enumerate() {
            if let Some(velocity) = velocity {
                voices[current].choke();
                current ^= 1;
                voices[current].trigger(velocity);
            } else {
                for voice in &mut voices {
                    voice.choke();
                }
            }
            let end = events.get(index + 1).map_or(out.len(), |event| event.0);
            for chunk in out[start..end].chunks_mut(block) {
                for voice in &mut voices {
                    voice.render(chunk);
                }
            }
        }
        assert!(voices.iter().all(|voice| !voice.is_active()));
        out
    }

    #[test]
    fn alternating_velocities_and_chokes_are_block_independent() {
        for rate in [44_100.0, 48_000.0, 96_000.0] {
            for params in [[190.0, 0.42, 0.15, 0.46], [400.0, 0.0, 1.5, 1.0]] {
                let reference = retriggered(rate, 1, &params);
                assert!(reference.iter().all(|sample| sample.is_finite()));
                assert!(reference.iter().any(|sample| sample.abs() > 0.01));
                assert!(
                    reference[reference.len() - 512..]
                        .iter()
                        .all(|&sample| sample == 0.0)
                );
                for block in [128, 441, 4096] {
                    assert_eq!(
                        reference,
                        retriggered(rate, block, &params),
                        "{rate}, {block}"
                    );
                }
            }
        }
    }

    #[test]
    fn ghost_hits_have_a_softer_spectrum_not_just_less_gain() {
        for rate in [44_100.0, 48_000.0, 96_000.0] {
            let ghost = hit(0.4, rate);
            let accent = hit(1.0, rate);
            let soft = attack_brightness(&ghost, rate);
            let hard = attack_brightness(&accent, rate);
            assert!(ghost.iter().any(|x| x.abs() > 0.001));
            assert!(hard > soft * 1.2, "{rate}: ghost {soft}, accent {hard}");
        }
    }
}
