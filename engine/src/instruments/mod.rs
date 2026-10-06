//! The synthesized instruments. Each track plays one instrument kind; percussive kinds
//! respond to hits with a velocity, melodic kinds to notes.

mod hat;
mod kick;
mod perc;
mod pluck;
mod reese;
mod snare;
mod sub;

pub use hat::Hat;
pub use kick::Kick;
pub use perc::Perc;
pub use pluck::Pluck;
pub use reese::Reese;
pub use snare::Snare;
pub use sub::Sub;

/// The most parameters any instrument takes.
pub const MAX_PARAMS: usize = 12;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum InstrumentKind {
    Kick,
    Snare,
    Hat,
    Perc,
    Sub,
    Reese,
    Pluck,
}

impl InstrumentKind {
    /// In the order of their indices in a compiled song (web/src/song/instruments.ts).
    pub const ALL: [InstrumentKind; 7] = [
        InstrumentKind::Kick,
        InstrumentKind::Snare,
        InstrumentKind::Hat,
        InstrumentKind::Perc,
        InstrumentKind::Sub,
        InstrumentKind::Reese,
        InstrumentKind::Pluck,
    ];

    pub fn from_index(index: usize) -> Option<Self> {
        Self::ALL.get(index).copied()
    }

    pub fn name(self) -> &'static str {
        match self {
            InstrumentKind::Kick => "kick",
            InstrumentKind::Snare => "snare",
            InstrumentKind::Hat => "hat",
            InstrumentKind::Perc => "perc",
            InstrumentKind::Sub => "sub",
            InstrumentKind::Reese => "reese",
            InstrumentKind::Pluck => "pluck",
        }
    }

    /// Parameter names in the order a compiled song lists their values.
    pub fn params(self) -> &'static [&'static str] {
        match self {
            InstrumentKind::Kick => &["tune", "sweep", "bend", "decay", "click"],
            InstrumentKind::Snare => &["tune", "tone", "decay", "snap"],
            InstrumentKind::Hat => &["tone", "decay", "metal"],
            InstrumentKind::Perc => &["tune", "decay", "bend", "noise"],
            InstrumentKind::Sub => &["glide", "attack", "release", "warmth"],
            InstrumentKind::Reese => &[
                "cutoff",
                "resonance",
                "detune",
                "sub",
                "env",
                "decay",
                "rate",
                "wobble",
                "glide",
                "release",
            ],
            InstrumentKind::Pluck => &["tone", "decay", "release"],
        }
    }

    /// Melodic kinds play notes; the rest play hits.
    pub fn is_melodic(self) -> bool {
        matches!(
            self,
            InstrumentKind::Sub | InstrumentKind::Reese | InstrumentKind::Pluck
        )
    }

    /// Legato kinds are monophonic: a note played while another is held glides to it
    /// without retriggering.
    pub fn is_legato(self) -> bool {
        matches!(self, InstrumentKind::Sub | InstrumentKind::Reese)
    }
}

/// What a voice needs to know about the song while it renders.
#[derive(Clone, Copy)]
pub struct Context {
    /// The length of one sixteenth note, for tempo-synced modulation.
    pub step_seconds: f32,
}

pub enum Voice {
    Kick(Kick),
    Snare(Snare),
    Hat(Hat),
    Perc(Perc),
    Sub(Sub),
    Reese(Reese),
    Pluck(Pluck),
}

impl Voice {
    pub fn new(kind: InstrumentKind, sample_rate: f32, seed: u32) -> Self {
        match kind {
            InstrumentKind::Kick => Voice::Kick(Kick::new(sample_rate, seed)),
            InstrumentKind::Snare => Voice::Snare(Snare::new(sample_rate, seed)),
            InstrumentKind::Hat => Voice::Hat(Hat::new(sample_rate, seed)),
            InstrumentKind::Perc => Voice::Perc(Perc::new(sample_rate, seed)),
            InstrumentKind::Sub => Voice::Sub(Sub::new(sample_rate)),
            InstrumentKind::Reese => Voice::Reese(Reese::new(sample_rate, seed)),
            InstrumentKind::Pluck => Voice::Pluck(Pluck::new(sample_rate, seed)),
        }
    }

    pub fn kind(&self) -> InstrumentKind {
        match self {
            Voice::Kick(_) => InstrumentKind::Kick,
            Voice::Snare(_) => InstrumentKind::Snare,
            Voice::Hat(_) => InstrumentKind::Hat,
            Voice::Perc(_) => InstrumentKind::Perc,
            Voice::Sub(_) => InstrumentKind::Sub,
            Voice::Reese(_) => InstrumentKind::Reese,
            Voice::Pluck(_) => InstrumentKind::Pluck,
        }
    }

    pub fn set_params(&mut self, params: &[f32; MAX_PARAMS]) {
        match self {
            Voice::Kick(v) => v.set_params(params),
            Voice::Snare(v) => v.set_params(params),
            Voice::Hat(v) => v.set_params(params),
            Voice::Perc(v) => v.set_params(params),
            Voice::Sub(v) => v.set_params(params),
            Voice::Reese(v) => v.set_params(params),
            Voice::Pluck(v) => v.set_params(params),
        }
    }

    /// Starts a hit or note. `legato` asks a legato voice to glide from the note it holds.
    pub fn trigger(&mut self, velocity: f32, note: f32, legato: bool) {
        match self {
            Voice::Kick(v) => v.trigger(velocity),
            Voice::Snare(v) => v.trigger(velocity),
            Voice::Hat(v) => v.trigger(velocity),
            Voice::Perc(v) => v.trigger(velocity),
            Voice::Sub(v) => v.trigger(velocity, note, legato),
            Voice::Reese(v) => v.trigger(velocity, note, legato),
            Voice::Pluck(v) => v.trigger(velocity, note),
        }
    }

    /// Lets a held note go. Percussive voices ignore it and ring out.
    pub fn release(&mut self) {
        match self {
            Voice::Sub(v) => v.release(),
            Voice::Reese(v) => v.release(),
            Voice::Pluck(v) => v.release(),
            Voice::Kick(_) | Voice::Snare(_) | Voice::Hat(_) | Voice::Perc(_) => {}
        }
    }

    /// Silences the voice within a few milliseconds.
    pub fn choke(&mut self) {
        match self {
            Voice::Kick(v) => v.choke(),
            Voice::Snare(v) => v.choke(),
            Voice::Hat(v) => v.choke(),
            Voice::Perc(v) => v.choke(),
            Voice::Sub(v) => v.choke(),
            Voice::Reese(v) => v.choke(),
            Voice::Pluck(v) => v.choke(),
        }
    }

    pub fn is_active(&self) -> bool {
        match self {
            Voice::Kick(v) => v.is_active(),
            Voice::Snare(v) => v.is_active(),
            Voice::Hat(v) => v.is_active(),
            Voice::Perc(v) => v.is_active(),
            Voice::Sub(v) => v.is_active(),
            Voice::Reese(v) => v.is_active(),
            Voice::Pluck(v) => v.is_active(),
        }
    }

    /// Adds the voice's output to `out`.
    pub fn render(&mut self, out: &mut [f32], context: Context) {
        match self {
            Voice::Kick(v) => v.render(out),
            Voice::Snare(v) => v.render(out),
            Voice::Hat(v) => v.render(out),
            Voice::Perc(v) => v.render(out),
            Voice::Sub(v) => v.render(out),
            Voice::Reese(v) => v.render(out, context),
            Voice::Pluck(v) => v.render(out),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Renders one hit (or a held note) at full velocity and returns its peak.
    fn peak(kind: InstrumentKind, params: &[f32]) -> f32 {
        let sample_rate = 48_000.0;
        let mut voice = Voice::new(kind, sample_rate, 1);
        let mut values = [0.0; MAX_PARAMS];
        values[..params.len()].copy_from_slice(params);
        voice.set_params(&values);
        voice.trigger(1.0, 41.0, false);
        let context = Context {
            step_seconds: 0.086,
        };
        let mut out = vec![0.0; 24_000];
        for chunk in out.chunks_mut(128) {
            voice.render(chunk, context);
        }
        assert!(out.iter().all(|x| x.is_finite()), "{kind:?} rendered NaN");
        out.iter().fold(0.0f32, |peak, x| peak.max(x.abs()))
    }

    #[test]
    fn every_instrument_sounds_at_a_sane_level() {
        let cases: [(InstrumentKind, &[f32]); 7] = [
            (InstrumentKind::Kick, &[48.0, 5.0, 0.035, 0.45, 0.35]),
            (InstrumentKind::Snare, &[185.0, 0.35, 0.22, 0.65]),
            (InstrumentKind::Hat, &[1.0, 0.06, 0.6]),
            (InstrumentKind::Perc, &[420.0, 0.12, 0.3, 0.2]),
            (InstrumentKind::Sub, &[0.03, 0.005, 0.12, 0.15]),
            (
                InstrumentKind::Reese,
                &[700.0, 0.3, 18.0, 0.4, 0.35, 0.3, 8.0, 0.2, 0.06, 0.15],
            ),
            (InstrumentKind::Pluck, &[0.45, 0.6, 0.08]),
        ];
        for (kind, params) in cases {
            assert_eq!(params.len(), kind.params().len(), "{kind:?}");
            let peak = peak(kind, params);
            assert!((0.15..=1.2).contains(&peak), "{kind:?} peaks at {peak}");
        }
    }

    #[test]
    fn percussive_voices_fall_silent() {
        let sample_rate = 48_000.0;
        let mut voice = Voice::new(InstrumentKind::Kick, sample_rate, 1);
        voice.set_params(&[48.0, 5.0, 0.035, 0.3, 0.35, 0., 0., 0., 0., 0., 0., 0.]);
        voice.trigger(1.0, 0.0, false);
        let context = Context { step_seconds: 0.1 };
        let mut out = vec![0.0; 128];
        for _ in 0..1_000 {
            voice.render(&mut out, context);
        }
        assert!(!voice.is_active());
    }
}
