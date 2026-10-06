//! An eight-line feedback delay network: diffused input feeds delay lines whose outputs
//! mix back through a Householder matrix, losing energy through a damping filter and a
//! gain per line set from the decay time. Dark by default: the damping rolls off highs
//! on every pass, so the tail darkens as it fades.

use super::{OnePole, flush};

/// Line lengths in milliseconds, mutually prime-ish so their echoes never line up.
const LINE_MS: [f32; 8] = [29.7, 37.1, 41.1, 43.7, 53.3, 59.9, 67.7, 73.1];
/// Series allpass diffusers that smear the input before it reaches the lines.
const DIFFUSER_MS: [f32; 4] = [4.7, 3.6, 12.7, 9.3];
const DIFFUSER_GAIN: f32 = 0.6;
/// Kick and sub stay out of the reverb, so the low end stays tight.
const INPUT_HIGH_PASS_HZ: f32 = 220.0;
const OUTPUT_GAIN: f32 = 0.32;

struct DelayLine {
    buffer: Vec<f32>,
    position: usize,
}

impl DelayLine {
    fn new(milliseconds: f32, sample_rate: f32) -> Self {
        let length = ((milliseconds * 0.001 * sample_rate) as usize).max(1);
        DelayLine {
            buffer: vec![0.0; length],
            position: 0,
        }
    }

    fn seconds(&self, sample_rate: f32) -> f32 {
        self.buffer.len() as f32 / sample_rate
    }

    /// The sample written one line length ago.
    #[inline]
    fn read(&self) -> f32 {
        self.buffer[self.position]
    }

    #[inline]
    fn write(&mut self, x: f32) {
        self.buffer[self.position] = x;
        self.position += 1;
        if self.position == self.buffer.len() {
            self.position = 0;
        }
    }
}

struct Allpass {
    line: DelayLine,
}

impl Allpass {
    #[inline]
    fn process(&mut self, x: f32) -> f32 {
        let delayed = self.line.read();
        let v = flush(x + DIFFUSER_GAIN * delayed);
        self.line.write(v);
        delayed - DIFFUSER_GAIN * v
    }
}

pub struct Reverb {
    sample_rate: f32,
    lines: Vec<DelayLine>,
    damping: Vec<OnePole>,
    gains: [f32; 8],
    diffusers: Vec<Allpass>,
    input_filter: OnePole,
}

impl Reverb {
    pub fn new(sample_rate: f32) -> Self {
        let mut input_filter = OnePole::default();
        input_filter.set(INPUT_HIGH_PASS_HZ, sample_rate);
        let mut reverb = Reverb {
            sample_rate,
            lines: LINE_MS
                .iter()
                .map(|&ms| DelayLine::new(ms, sample_rate))
                .collect(),
            damping: vec![OnePole::default(); 8],
            gains: [0.0; 8],
            diffusers: DIFFUSER_MS
                .iter()
                .map(|&ms| Allpass {
                    line: DelayLine::new(ms, sample_rate),
                })
                .collect(),
            input_filter,
        };
        reverb.set(0.5, 0.5);
        reverb
    }

    /// `size` (0 to 1) sets the decay from 0.4 to 8 seconds; `damp` (0 to 1) how fast
    /// the highs fade within it.
    pub fn set(&mut self, size: f32, damp: f32) {
        let decay_seconds = 0.4 + size.clamp(0.0, 1.0).powi(2) * 7.6;
        let damp = damp.clamp(0.0, 1.0);
        let cutoff = 1_200.0 + (1.0 - damp).powi(2) * 12_000.0;
        for (index, line) in self.lines.iter().enumerate() {
            let seconds = line.seconds(self.sample_rate);
            self.gains[index] = 10f32.powf(-3.0 * seconds / decay_seconds);
            self.damping[index].set(cutoff, self.sample_rate);
        }
    }

    /// Adds the reverb of a mono send to a stereo bus.
    pub fn process(&mut self, input: &[f32], left: &mut [f32], right: &mut [f32]) {
        for ((x, l), r) in input.iter().zip(left.iter_mut()).zip(right.iter_mut()) {
            let mut diffused = self.input_filter.high(*x);
            for diffuser in &mut self.diffusers {
                diffused = diffuser.process(diffused);
            }

            let mut outputs = [0.0f32; 8];
            let mut damped = [0.0f32; 8];
            let mut sum = 0.0;
            for index in 0..8 {
                outputs[index] = self.lines[index].read();
                damped[index] = self.damping[index].low(outputs[index]) * self.gains[index];
                sum += damped[index];
            }
            // Householder feedback: lossless mixing, so the line gains alone set the decay.
            let reflection = sum * 0.25;
            for (index, line) in self.lines.iter_mut().enumerate() {
                line.write(flush(diffused * 0.5 + damped[index] - reflection));
            }

            *l += (outputs[0] - outputs[2] + outputs[4] - outputs[6]) * OUTPUT_GAIN;
            *r += (outputs[1] - outputs[3] + outputs[5] - outputs[7]) * OUTPUT_GAIN;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tail_energy(size: f32, seconds: f32) -> f32 {
        let sample_rate = 48_000.0;
        let mut reverb = Reverb::new(sample_rate);
        reverb.set(size, 0.5);
        let frames = (seconds * sample_rate) as usize;
        let mut input = vec![0.0; frames];
        input[0] = 1.0;
        let mut left = vec![0.0; frames];
        let mut right = vec![0.0; frames];
        reverb.process(&input, &mut left, &mut right);
        let last_tenth = frames - frames / 10;
        left[last_tenth..]
            .iter()
            .chain(&right[last_tenth..])
            .map(|x| x * x)
            .sum()
    }

    #[test]
    fn decays_and_stays_finite() {
        let energy = tail_energy(0.5, 6.0);
        assert!(energy.is_finite());
        assert!(energy < 1e-6, "tail energy {energy}");
    }

    #[test]
    fn larger_rooms_ring_longer() {
        assert!(tail_energy(0.9, 1.0) > tail_energy(0.1, 1.0));
    }
}
