//! A tempo-synced stereo ping-pong delay: the send enters the left line, each echo
//! crosses to the other side, and a band-pass in the loop darkens every repeat.

use super::{OnePole, flush};

/// The longest delay the buffers hold, in seconds: 8 sixteenths at 60 BPM is 2 s.
const MAX_SECONDS: f32 = 2.5;
const LOOP_HIGH_PASS_HZ: f32 = 180.0;
/// How quickly the delay time follows a tempo change, as a per-sample coefficient.
const TIME_SMOOTHING: f32 = 0.0005;

pub struct Delay {
    sample_rate: f32,
    left: Vec<f32>,
    right: Vec<f32>,
    position: usize,
    time: f32,
    target: f32,
    feedback: f32,
    tone_left: OnePole,
    tone_right: OnePole,
    low_cut_left: OnePole,
    low_cut_right: OnePole,
}

impl Delay {
    pub fn new(sample_rate: f32) -> Self {
        let length = (MAX_SECONDS * sample_rate) as usize + 2;
        let mut delay = Delay {
            sample_rate,
            left: vec![0.0; length],
            right: vec![0.0; length],
            position: 0,
            time: 0.0,
            target: 0.0,
            feedback: 0.0,
            tone_left: OnePole::default(),
            tone_right: OnePole::default(),
            low_cut_left: OnePole::default(),
            low_cut_right: OnePole::default(),
        };
        delay.low_cut_left.set(LOOP_HIGH_PASS_HZ, sample_rate);
        delay.low_cut_right.set(LOOP_HIGH_PASS_HZ, sample_rate);
        delay.set(3.0, 0.35, 0.5, 0.086);
        delay.time = delay.target;
        delay
    }

    /// `steps` sixteenths at `step_seconds` each; `feedback` up to 0.9; `tone` (0 to 1)
    /// from dark to bright repeats.
    pub fn set(&mut self, steps: f32, feedback: f32, tone: f32, step_seconds: f32) {
        let max = (self.left.len() - 2) as f32;
        self.target = (steps * step_seconds * self.sample_rate).clamp(1.0, max);
        self.feedback = feedback.clamp(0.0, 0.9);
        let cutoff = 600.0 + tone.clamp(0.0, 1.0).powi(2) * 11_000.0;
        self.tone_left.set(cutoff, self.sample_rate);
        self.tone_right.set(cutoff, self.sample_rate);
    }

    #[inline]
    fn read(buffer: &[f32], position: usize, delay: f32) -> f32 {
        let length = buffer.len() as f32;
        let mut read = position as f32 - delay;
        if read < 0.0 {
            read += length;
        }
        let mut index = read as usize;
        let mut fraction = read - index as f32;
        // Rounding can land a read a hair below zero exactly on the length.
        if index >= buffer.len() {
            index = 0;
            fraction = 0.0;
        }
        let next = if index + 1 == buffer.len() {
            0
        } else {
            index + 1
        };
        buffer[index] + (buffer[next] - buffer[index]) * fraction
    }

    /// Adds the echoes of a mono send to a stereo bus.
    pub fn process(&mut self, input: &[f32], left: &mut [f32], right: &mut [f32]) {
        for ((x, l), r) in input.iter().zip(left.iter_mut()).zip(right.iter_mut()) {
            self.time += (self.target - self.time) * TIME_SMOOTHING;
            let echo_left = Self::read(&self.left, self.position, self.time);
            let echo_right = Self::read(&self.right, self.position, self.time);
            let back_left = self
                .tone_right
                .low(self.low_cut_right.high(echo_right) * self.feedback);
            let back_right = self
                .tone_left
                .low(self.low_cut_left.high(echo_left) * self.feedback);
            self.left[self.position] = flush(x + back_left);
            self.right[self.position] = flush(back_right);
            self.position += 1;
            if self.position == self.left.len() {
                self.position = 0;
            }
            *l += echo_left;
            *r += echo_right;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn first_echo_arrives_on_time_on_the_left() {
        let sample_rate = 48_000.0;
        let mut delay = Delay::new(sample_rate);
        delay.set(3.0, 0.0, 1.0, 0.1);
        delay.time = delay.target;
        let frames = 20_000;
        let mut input = vec![0.0; frames];
        input[0] = 1.0;
        let mut left = vec![0.0; frames];
        let mut right = vec![0.0; frames];
        delay.process(&input, &mut left, &mut right);
        let peak = left
            .iter()
            .enumerate()
            .max_by(|a, b| a.1.abs().total_cmp(&b.1.abs()))
            .map(|(index, _)| index);
        assert_eq!(peak, Some(14_400));
        assert!(right.iter().all(|x| x.abs() < 1e-6));
    }
}
