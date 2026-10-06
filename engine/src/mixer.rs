//! The mixer: a channel strip per track feeding a stereo bus and two mono sends, and
//! the master section that glues and limits the sum.

use crate::dsp::{BUTTERWORTH_Q, PI, Ramp, Svf, compressor::Compressor, db_to_gain, saturate};
use crate::song::TrackData;

/// How long gain, pan and filter changes take to settle.
const SMOOTHING_SECONDS: f32 = 0.01;

/// Per-block one-pole smoothing toward a target.
fn approach(current: f32, target: f32, frames: usize, sample_rate: f32) -> f32 {
    let coefficient = 1.0 - (-(frames as f32) / (SMOOTHING_SECONDS * sample_rate)).exp();
    current + (target - current) * coefficient
}

/// The buses a channel mixes into.
pub struct Buses<'a> {
    pub left: &'a mut [f32],
    pub right: &'a mut [f32],
    pub reverb: &'a mut [f32],
    pub delay: &'a mut [f32],
}

pub struct Channel {
    sample_rate: f32,
    level: f32,
    pan: f32,
    lowcut: f32,
    highcut: f32,
    drive: f32,
    reverb: f32,
    delay: f32,
    pub mute: bool,
    pub solo: bool,
    gains: [f32; 4],
    cutoffs: [f32; 2],
    high_pass: Svf,
    low_pass: Svf,
    started: bool,
    pub peak: f32,
}

impl Channel {
    pub fn new(sample_rate: f32) -> Self {
        Channel {
            sample_rate,
            level: 1.0,
            pan: 0.0,
            lowcut: 20.0,
            highcut: 20_000.0,
            drive: 0.0,
            reverb: 0.0,
            delay: 0.0,
            mute: false,
            solo: false,
            gains: [0.0; 4],
            cutoffs: [20.0, 20_000.0],
            high_pass: Svf::default(),
            low_pass: Svf::default(),
            started: false,
            peak: 0.0,
        }
    }

    pub fn set(&mut self, track: &TrackData) {
        self.level = db_to_gain(track.level_db);
        self.pan = track.pan;
        self.lowcut = track.lowcut;
        self.highcut = track.highcut;
        self.drive = track.drive;
        self.reverb = track.reverb;
        self.delay = track.delay;
        self.mute = track.mute;
        self.solo = track.solo;
    }

    /// Filters, drives and pans `input` into the buses. `audible` is false while the
    /// channel is muted, or another is soloed.
    pub fn process(&mut self, input: &[f32], buses: &mut Buses, audible: bool) {
        let frames = input.len();
        let rate = self.sample_rate;
        let level = if audible { self.level } else { 0.0 };
        // Constant power, with unity gain on each side at the centre.
        let angle = (self.pan + 1.0) * PI / 4.0;
        let targets = [
            level * angle.cos() * core::f32::consts::SQRT_2,
            level * angle.sin() * core::f32::consts::SQRT_2,
            level * self.reverb,
            level * self.delay,
        ];
        if !self.started {
            self.gains = targets;
            self.cutoffs = [self.lowcut, self.highcut];
            self.started = true;
        }
        let next: [f32; 4] =
            core::array::from_fn(|index| approach(self.gains[index], targets[index], frames, rate));
        let mut ramps: [Ramp; 4] =
            core::array::from_fn(|index| Ramp::new(self.gains[index], next[index], frames));
        self.gains = next;
        self.cutoffs[0] = approach(self.cutoffs[0], self.lowcut, frames, rate);
        self.cutoffs[1] = approach(self.cutoffs[1], self.highcut, frames, rate);
        self.high_pass.set(self.cutoffs[0], BUTTERWORTH_Q, rate);
        self.low_pass.set(self.cutoffs[1], BUTTERWORTH_Q, rate);

        let drive = self.drive;
        let push = 1.0 + drive * 8.0;
        let makeup = 1.0 / (1.0 + drive);
        let mut peak = self.peak;
        for (index, x) in input.iter().enumerate() {
            let mut y = self.high_pass.process(*x).high;
            y = self.low_pass.process(y).low;
            if drive > 0.001 {
                y = (y * push).tanh() * makeup;
            }
            let left = y * ramps[0].tick();
            let right = y * ramps[1].tick();
            buses.left[index] += left;
            buses.right[index] += right;
            buses.reverb[index] += y * ramps[2].tick();
            buses.delay[index] += y * ramps[3].tick();
            peak = peak.max(left.abs()).max(right.abs());
        }
        self.peak = peak;
    }
}

pub struct Master {
    sample_rate: f32,
    level: f32,
    glue: f32,
    drive: f32,
    gain: f32,
    compressor: Compressor,
    pub peaks: [f32; 2],
}

impl Master {
    pub fn new(sample_rate: f32) -> Self {
        Master {
            sample_rate,
            level: 1.0,
            glue: 0.0,
            drive: 0.0,
            gain: 1.0,
            compressor: Compressor::new(sample_rate),
            peaks: [0.0; 2],
        }
    }

    pub fn set(&mut self, level_db: f32, glue: f32, drive: f32) {
        self.level = db_to_gain(level_db);
        self.glue = glue;
        self.drive = drive;
    }

    /// Glues, levels and soft-clips the bus in place; the output never exceeds 1.
    pub fn process(&mut self, left: &mut [f32], right: &mut [f32]) {
        self.compressor.process(left, right, self.glue);
        let frames = left.len();
        let next = approach(self.gain, self.level, frames, self.sample_rate);
        let mut ramp = Ramp::new(self.gain, next, frames);
        self.gain = next;
        let push = 1.0 + self.drive * 3.0;
        for (l, r) in left.iter_mut().zip(right.iter_mut()) {
            let gain = ramp.tick() * push;
            *l = saturate(*l * gain);
            *r = saturate(*r * gain);
            self.peaks[0] = self.peaks[0].max(l.abs());
            self.peaks[1] = self.peaks[1].max(r.abs());
        }
    }
}
