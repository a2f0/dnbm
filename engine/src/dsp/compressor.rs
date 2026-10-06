//! A stereo-linked bus compressor with a soft knee: "glue" for the master bus.

use super::{db_to_gain, smoothing_coefficient};

const KNEE_DB: f32 = 6.0;
const ATTACK_SECONDS: f32 = 0.01;
const RELEASE_SECONDS: f32 = 0.15;

pub struct Compressor {
    reduction_db: f32,
    attack: f32,
    release: f32,
}

impl Compressor {
    pub fn new(sample_rate: f32) -> Self {
        Compressor {
            reduction_db: 0.0,
            attack: smoothing_coefficient(ATTACK_SECONDS, sample_rate),
            release: smoothing_coefficient(RELEASE_SECONDS, sample_rate),
        }
    }

    /// The gain change in dB for a level, given threshold and ratio.
    fn gain_computer(level_db: f32, threshold_db: f32, ratio: f32) -> f32 {
        let over = level_db - threshold_db;
        let slope = 1.0 / ratio - 1.0;
        if 2.0 * over < -KNEE_DB {
            0.0
        } else if 2.0 * over.abs() <= KNEE_DB {
            slope * (over + KNEE_DB / 2.0).powi(2) / (2.0 * KNEE_DB)
        } else {
            slope * over
        }
    }

    /// Compresses in place. `amount` (0 to 1) lowers the threshold and raises the ratio
    /// together, with makeup gain to keep the loudness roughly level.
    pub fn process(&mut self, left: &mut [f32], right: &mut [f32], amount: f32) {
        if amount < 0.001 && self.reduction_db > -0.001 {
            return;
        }
        let threshold_db = -4.0 - amount * 20.0;
        let ratio = 1.5 + amount * 4.5;
        let makeup_db = -threshold_db * (1.0 - 1.0 / ratio) * 0.4 * amount.min(1.0);
        for (l, r) in left.iter_mut().zip(right.iter_mut()) {
            let target = if amount < 0.001 {
                0.0
            } else {
                let peak = l.abs().max(r.abs());
                let level_db = 20.0 * (peak + 1e-9).log10();
                Self::gain_computer(level_db, threshold_db, ratio)
            };
            let coefficient = if target < self.reduction_db {
                self.attack
            } else {
                self.release
            };
            self.reduction_db += (target - self.reduction_db) * coefficient;
            let gain = db_to_gain(self.reduction_db + makeup_db);
            *l *= gain;
            *r *= gain;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn leaves_quiet_signals_alone_and_reduces_loud_ones() {
        assert_eq!(Compressor::gain_computer(-40.0, -10.0, 4.0), 0.0);
        let reduction = Compressor::gain_computer(0.0, -10.0, 4.0);
        assert!((reduction + 7.5).abs() < 1e-4);
    }

    #[test]
    fn disabling_glue_releases_gain_reduction_even_on_a_loud_bus() {
        let mut compressor = Compressor::new(48_000.0);
        let mut left = vec![0.9; 48_000];
        let mut right = left.clone();
        compressor.process(&mut left, &mut right, 0.8);
        assert!(compressor.reduction_db < -3.0);

        // Turning glue off releases smoothly, then reaches unity on a sustained signal.
        left = vec![0.9; 96_000];
        right = left.clone();
        compressor.process(&mut left, &mut right, 0.0);
        assert!(left[0] < 0.8);
        assert!((left[left.len() - 1] - 0.9).abs() < 1e-4);
        assert_eq!(left, right);
    }
}
