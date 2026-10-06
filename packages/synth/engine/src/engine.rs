//! The engine: a sample-accurate sequencer that plays a song's patterns through the
//! instruments and mixes them. Steps fire on the exact sample they fall on, whatever
//! the block size, so timing is identical live and offline.

use crate::dsp::{delay::Delay, reverb::Reverb};
use crate::instruments::{Context, InstrumentKind, Voice};
use crate::mixer::{Buses, Channel, Master};
use crate::song::{Cell, CellKind, MAX_TRACKS, SongData, SongError};

/// The most frames one `render` call produces.
pub const MAX_FRAMES: usize = 4096;
/// A peak meter per track, then the master's left and right.
pub const METER_COUNT: usize = MAX_TRACKS + 2;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PlayMode {
    /// Plays the arrangement from a slot, looping at its end.
    Song,
    /// Loops one pattern.
    Pattern,
    /// Plays the arrangement from a slot once, stopping when its last step ends.
    SongOnce,
}

/// A distinct, fixed noise seed per voice, so renders repeat exactly.
fn seed(track: usize, voice: usize) -> u32 {
    ((track * 2 + voice) as u32 + 1).wrapping_mul(0x9E37_79B9)
}

struct Track {
    /// Two voices, so a retriggered hit fades the last one out instead of cutting it.
    voices: [Voice; 2],
    current: usize,
    /// Whether a melodic note is held, so the next note glides and a rest releases it.
    held: bool,
    choke: u8,
    used: bool,
    channel: Channel,
}

impl Track {
    fn new(kind: InstrumentKind, sample_rate: f32, index: usize) -> Self {
        Track {
            voices: [
                Voice::new(kind, sample_rate, seed(index, 0)),
                Voice::new(kind, sample_rate, seed(index, 1)),
            ],
            current: 0,
            held: false,
            choke: 0,
            used: false,
            channel: Channel::new(sample_rate),
        }
    }

    fn kind(&self) -> InstrumentKind {
        self.voices[0].kind()
    }

    fn is_sounding(&self) -> bool {
        self.voices.iter().any(Voice::is_active)
    }

    fn choke_all(&mut self) {
        for voice in &mut self.voices {
            voice.choke();
        }
        self.held = false;
    }

    fn release(&mut self) {
        if self.held {
            self.voices[self.current].release();
            self.held = false;
        }
    }

    /// Fades the sounding voice and starts the other.
    fn retrigger(&mut self, velocity: f32, note: f32) {
        self.voices[self.current].choke();
        self.current ^= 1;
        self.voices[self.current].trigger(velocity, note, false);
    }

    /// Plays one cell. Returns true when it started a sound that should choke the rest
    /// of the track's choke group.
    fn play(&mut self, cell: Cell) -> bool {
        let kind = self.kind();
        match cell.kind {
            CellKind::Hit if !kind.is_melodic() => {
                self.retrigger(cell.velocity, 0.0);
                true
            }
            CellKind::Note if kind.is_legato() => {
                let legato = self.held;
                self.current = 0;
                self.voices[0].trigger(cell.velocity, cell.note, legato);
                self.held = true;
                !legato
            }
            CellKind::Note if kind.is_melodic() => {
                self.retrigger(cell.velocity, cell.note);
                self.held = true;
                true
            }
            CellKind::Rest if kind.is_melodic() => {
                self.release();
                false
            }
            _ => false,
        }
    }
}

pub struct Engine {
    sample_rate: f32,
    song: SongData,
    tracks: Vec<Track>,
    reverb: Reverb,
    delay: Delay,
    master: Master,
    track_buffers: Vec<f32>,
    left: Vec<f32>,
    right: Vec<f32>,
    reverb_bus: Vec<f32>,
    delay_bus: Vec<f32>,
    /// Where the host writes a compiled song before `load_song`.
    pub song_buffer: Vec<f32>,
    playing: bool,
    mode: PlayMode,
    pattern: usize,
    slot: usize,
    step: usize,
    /// Samples until the next step fires; fractional, so tempo never drifts.
    until_step: f64,
    /// Set when `SongOnce` has fired the arrangement's last step: playing stops when
    /// the next step would fire.
    at_end: bool,
    position: Position,
    meters: [f32; METER_COUNT],
}

/// The step that fired last, and a serial that counts every step fired.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Position {
    pub serial: u32,
    pub slot: usize,
    pub pattern: usize,
    pub step: usize,
}

impl Engine {
    pub fn new(sample_rate: f32) -> Self {
        let sample_rate = if sample_rate.is_finite() {
            sample_rate.clamp(8_000.0, 192_000.0)
        } else {
            48_000.0
        };
        Engine {
            sample_rate,
            song: SongData::empty(),
            tracks: (0..MAX_TRACKS)
                .map(|index| Track::new(InstrumentKind::Kick, sample_rate, index))
                .collect(),
            reverb: Reverb::new(sample_rate),
            delay: Delay::new(sample_rate),
            master: Master::new(sample_rate),
            track_buffers: vec![0.0; MAX_TRACKS * MAX_FRAMES],
            left: vec![0.0; MAX_FRAMES],
            right: vec![0.0; MAX_FRAMES],
            reverb_bus: vec![0.0; MAX_FRAMES],
            delay_bus: vec![0.0; MAX_FRAMES],
            song_buffer: Vec::new(),
            playing: false,
            mode: PlayMode::Song,
            pattern: 0,
            slot: 0,
            step: 0,
            until_step: 0.0,
            at_end: false,
            position: Position::default(),
            meters: [0.0; METER_COUNT],
        }
    }

    /// Replaces the song with the one in `song_buffer`. Playback continues from the same
    /// place, and voices keep sounding, so editing while playing is seamless.
    pub fn load_song(&mut self) -> Result<(), SongError> {
        let song = SongData::decode(&self.song_buffer)?;
        self.apply(song);
        Ok(())
    }

    fn apply(&mut self, song: SongData) {
        for (index, track) in self.tracks.iter_mut().enumerate() {
            match song.tracks.get(index) {
                Some(data) => {
                    if track.kind() != data.kind {
                        *track = Track::new(data.kind, self.sample_rate, index);
                    }
                    for voice in &mut track.voices {
                        voice.set_params(&data.params);
                    }
                    track.channel.set(data);
                    track.choke = data.choke;
                    track.used = true;
                }
                None if track.used => {
                    track.choke_all();
                    track.used = false;
                }
                None => {}
            }
        }
        self.reverb.set(song.reverb_size, song.reverb_damp);
        self.delay.set(
            song.delay_time,
            song.delay_feedback,
            song.delay_tone,
            60.0 / song.bpm / 4.0,
        );
        self.master
            .set(song.master_level_db, song.master_glue, song.master_drive);
        self.song = song;
        if self.slot >= self.song.arrangement.len() {
            self.slot = 0;
        }
        if self.pattern >= self.song.patterns.len() {
            self.pattern = 0;
        }
        if self.step >= self.song.patterns[self.current_pattern()].steps {
            self.step = 0;
        }
    }

    fn current_pattern(&self) -> usize {
        match self.mode {
            PlayMode::Song | PlayMode::SongOnce => self.song.arrangement[self.slot],
            PlayMode::Pattern => self.pattern,
        }
    }

    fn point_at(&mut self, mode: PlayMode, index: usize) {
        self.mode = mode;
        self.at_end = false;
        match mode {
            PlayMode::Song | PlayMode::SongOnce => {
                self.slot = index.min(self.song.arrangement.len() - 1)
            }
            PlayMode::Pattern => self.pattern = index.min(self.song.patterns.len() - 1),
        }
    }

    /// Starts playing from the first step of an arrangement slot or a pattern.
    pub fn play(&mut self, mode: PlayMode, index: usize) {
        for track in &mut self.tracks {
            track.release();
        }
        self.point_at(mode, index);
        self.step = 0;
        self.until_step = 0.0;
        self.playing = true;
    }

    /// Switches what plays without restarting: the next step comes from the new
    /// slot or pattern, at the same step.
    pub fn cue(&mut self, mode: PlayMode, index: usize) {
        self.point_at(mode, index);
        if self.step >= self.song.patterns[self.current_pattern()].steps {
            self.step = 0;
        }
    }

    /// Stops the sequencer; held notes release and hits ring out.
    pub fn stop(&mut self) {
        self.playing = false;
        for track in &mut self.tracks {
            track.release();
        }
    }

    pub fn is_playing(&self) -> bool {
        self.playing
    }

    pub fn position(&self) -> Position {
        self.position
    }

    /// Plays a hit or note on a track now, to audition it.
    pub fn trigger(&mut self, track: usize, velocity: f32, note: f32) {
        if track >= self.song.tracks.len() {
            return;
        }
        let kind = if self.tracks[track].kind().is_melodic() {
            CellKind::Note
        } else {
            CellKind::Hit
        };
        let cell = Cell {
            kind,
            velocity: velocity.clamp(0.0, 1.0),
            note: note.clamp(0.0, 127.0),
        };
        if self.tracks[track].play(cell) {
            self.choke_group(track);
        }
    }

    /// Releases an auditioned note.
    pub fn release(&mut self, track: usize) {
        if let Some(track) = self.tracks.get_mut(track) {
            track.release();
        }
    }

    fn choke_group(&mut self, source: usize) {
        let group = self.tracks[source].choke;
        if group == 0 {
            return;
        }
        for (index, track) in self.tracks.iter_mut().enumerate() {
            if index != source && track.used && track.choke == group {
                track.choke_all();
            }
        }
    }

    fn step_samples(&self, even: bool) -> f64 {
        let base = f64::from(self.sample_rate) * 60.0 / f64::from(self.song.bpm) / 4.0;
        // Full swing delays every second sixteenth to a triplet: 2:1.
        let swing = f64::from(self.song.swing) / 3.0;
        if even {
            base * (1.0 + swing)
        } else {
            base * (1.0 - swing)
        }
    }

    /// Plays the current step on every track, advances, and returns how many samples
    /// the step lasts.
    fn fire_step(&mut self) -> f64 {
        let pattern = self.current_pattern();
        let steps = self.song.patterns[pattern].steps;
        if self.step >= steps {
            self.step = 0;
        }
        for track in 0..self.song.tracks.len() {
            let cell = self.song.patterns[pattern].cell(track, self.step);
            if self.tracks[track].play(cell) {
                self.choke_group(track);
            }
        }
        self.position = Position {
            serial: self.position.serial.wrapping_add(1),
            slot: self.slot,
            pattern,
            step: self.step,
        };
        let duration = self.step_samples(self.step.is_multiple_of(2));
        self.step += 1;
        if self.step >= steps {
            self.step = 0;
            let slots = self.song.arrangement.len();
            match self.mode {
                PlayMode::Song => self.slot = (self.slot + 1) % slots,
                PlayMode::SongOnce if self.slot + 1 < slots => self.slot += 1,
                PlayMode::SongOnce => self.at_end = true,
                PlayMode::Pattern => {}
            }
        }
        duration
    }

    /// Renders up to `MAX_FRAMES` frames into the output buffers and returns how many.
    pub fn render(&mut self, frames: usize) -> usize {
        let frames = frames.min(MAX_FRAMES);
        for buffer in [
            &mut self.left,
            &mut self.right,
            &mut self.reverb_bus,
            &mut self.delay_bus,
        ] {
            buffer[..frames].fill(0.0);
        }
        for track in 0..MAX_TRACKS {
            let start = track * MAX_FRAMES;
            self.track_buffers[start..start + frames].fill(0.0);
        }

        let mut offset = 0;
        while offset < frames {
            if self.playing && self.until_step <= 0.0 {
                if self.at_end {
                    self.stop();
                } else {
                    self.until_step += self.fire_step();
                }
            }
            let mut length = frames - offset;
            if self.playing {
                length = length.min((self.until_step.ceil() as usize).max(1));
            }
            self.render_voices(offset, length);
            if self.playing {
                self.until_step -= length as f64;
            }
            offset += length;
        }

        self.mix(frames);
        frames
    }

    fn render_voices(&mut self, offset: usize, length: usize) {
        let context = Context {
            step_seconds: 60.0 / self.song.bpm / 4.0,
        };
        for (index, track) in self.tracks.iter_mut().enumerate() {
            if !track.is_sounding() {
                continue;
            }
            let start = index * MAX_FRAMES + offset;
            let buffer = &mut self.track_buffers[start..start + length];
            for voice in &mut track.voices {
                voice.render(buffer, context);
            }
        }
    }

    fn mix(&mut self, frames: usize) {
        let any_solo = self
            .tracks
            .iter()
            .any(|track| track.used && track.channel.solo);
        let mut buses = Buses {
            left: &mut self.left[..frames],
            right: &mut self.right[..frames],
            reverb: &mut self.reverb_bus[..frames],
            delay: &mut self.delay_bus[..frames],
        };
        for (index, track) in self.tracks.iter_mut().enumerate() {
            if !track.used && !track.is_sounding() {
                continue;
            }
            let audible = track.used && !track.channel.mute && (!any_solo || track.channel.solo);
            let start = index * MAX_FRAMES;
            track.channel.process(
                &self.track_buffers[start..start + frames],
                &mut buses,
                audible,
            );
            self.meters[index] = self.meters[index].max(track.channel.peak);
            track.channel.peak = 0.0;
        }
        self.reverb.process(buses.reverb, buses.left, buses.right);
        self.delay.process(buses.delay, buses.left, buses.right);
        self.master.process(buses.left, buses.right);
        self.meters[MAX_TRACKS] = self.meters[MAX_TRACKS].max(self.master.peaks[0]);
        self.meters[MAX_TRACKS + 1] = self.meters[MAX_TRACKS + 1].max(self.master.peaks[1]);
        self.master.peaks = [0.0; 2];
    }

    pub fn output(&self, channel: usize) -> &[f32] {
        if channel == 0 {
            &self.left
        } else {
            &self.right
        }
    }

    pub fn meters(&self) -> &[f32; METER_COUNT] {
        &self.meters
    }

    pub fn reset_meters(&mut self) {
        self.meters = [0.0; METER_COUNT];
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::song::tests::four_on_the_floor;

    fn engine_with(song: &[f32]) -> Engine {
        let mut engine = Engine::new(48_000.0);
        engine.song_buffer = song.to_vec();
        engine.load_song().unwrap();
        engine
    }

    /// The sample indices where the output first rises after silence.
    fn onsets(engine: &mut Engine, frames: usize, block: usize) -> Vec<usize> {
        let mut onsets = Vec::new();
        let mut quiet = true;
        let mut rendered = 0;
        while rendered < frames {
            let length = engine.render(block.min(frames - rendered));
            for (index, x) in engine.output(0)[..length].iter().enumerate() {
                if quiet && x.abs() > 1e-3 {
                    onsets.push(rendered + index);
                    quiet = false;
                } else if !quiet && x.abs() < 1e-6 {
                    quiet = true;
                }
            }
            rendered += length;
        }
        onsets
    }

    #[test]
    fn silent_until_played() {
        let mut engine = engine_with(&four_on_the_floor());
        engine.render(1024);
        assert!(engine.output(0)[..1024].iter().all(|x| *x == 0.0));
    }

    #[test]
    fn steps_fire_on_the_same_sample_whatever_the_block_size() {
        let mut steps = Vec::new();
        for block in [128, 441, 4096] {
            let mut engine = engine_with(&four_on_the_floor());
            engine.play(PlayMode::Pattern, 0);
            let mut serials = Vec::new();
            let mut rendered = 0;
            let mut last = 0;
            while rendered < 48_000 {
                engine.render(block.min(48_000 - rendered));
                rendered += block.min(48_000 - rendered);
                if engine.position().serial != last {
                    last = engine.position().serial;
                    serials.push(last);
                }
            }
            steps.push(engine.position().serial);
            let mut engine = engine_with(&four_on_the_floor());
            engine.play(PlayMode::Pattern, 0);
            let found = onsets(&mut engine, 48_000, block);
            assert_eq!(found.first(), Some(&0), "block {block}");
        }
        // 174 BPM sixteenths last 4137.93 samples at 48 kHz: 12 steps fire in a second.
        assert!(steps.iter().all(|serial| *serial == 12), "{steps:?}");
    }

    #[test]
    fn swing_moves_the_odd_sixteenths() {
        let mut engine = engine_with(&four_on_the_floor());
        let straight = engine.step_samples(true);
        engine.song.swing = 1.0;
        let long = engine.step_samples(true);
        let short = engine.step_samples(false);
        assert!((long + short - 2.0 * straight).abs() < 1e-6);
        assert!((long / short - 2.0).abs() < 1e-6);
    }

    #[test]
    fn output_is_finite_and_never_clips() {
        let mut engine = engine_with(&four_on_the_floor());
        engine.play(PlayMode::Song, 0);
        for _ in 0..200 {
            engine.render(256);
            for channel in 0..2 {
                assert!(
                    engine.output(channel)[..256]
                        .iter()
                        .all(|x| x.is_finite() && x.abs() <= 1.0)
                );
            }
        }
        assert!(engine.meters()[0] > 0.1);
        assert!(engine.meters()[MAX_TRACKS] > 0.1);
    }

    #[test]
    fn stopping_lets_the_tail_ring_then_falls_silent() {
        let mut engine = engine_with(&four_on_the_floor());
        engine.play(PlayMode::Song, 0);
        engine.render(2048);
        engine.stop();
        for _ in 0..200 {
            engine.render(1024);
        }
        assert!(engine.output(0)[..1024].iter().all(|x| x.abs() < 1e-4));
    }

    #[test]
    fn playing_once_stops_where_the_next_step_would_fire() {
        // One 16-step bar at 174 BPM without swing.
        let song: f64 = 16.0 * 48_000.0 * 60.0 / 174.0 / 4.0;
        for block in [128, 441, 4096] {
            let mut engine = engine_with(&four_on_the_floor());
            engine.play(PlayMode::SongOnce, 0);
            let mut rendered = 0;
            let mut render_to = |engine: &mut Engine, end: usize| {
                while rendered < end {
                    rendered += engine.render(block.min(end - rendered));
                }
            };
            render_to(&mut engine, song.floor() as usize);
            assert!(engine.is_playing(), "block {block}");
            render_to(&mut engine, song.ceil() as usize + 1);
            assert!(!engine.is_playing(), "block {block}");
            assert_eq!(engine.position().serial, 16, "block {block}");
            assert_eq!(engine.position().step, 15, "block {block}");
        }
    }

    #[test]
    fn reloading_keeps_the_position() {
        let mut engine = engine_with(&four_on_the_floor());
        engine.play(PlayMode::Song, 0);
        engine.render(4096 * 3);
        let before = engine.position();
        engine.song_buffer = four_on_the_floor();
        engine.load_song().unwrap();
        assert_eq!(engine.position(), before);
        assert!(engine.is_playing());
    }
}
