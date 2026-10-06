//! The compiled song: a flat array of numbers that src/song/compile.ts writes from a
//! song file and the engine reads here. Every count is checked and every value clamped,
//! so no input can make the engine misbehave.
//!
//! Layout (all f32):
//!
//! ```text
//! header   MAGIC VERSION bpm swing master_level master_glue master_drive
//!          reverb_size reverb_damp delay_time delay_feedback delay_tone
//!          track_count pattern_count arrangement_length
//! track    instrument choke level pan lowcut highcut drive reverb delay mute solo
//!          param_count params...                                  (track_count times)
//! pattern  steps, then per track per step: cell_kind velocity note (pattern_count times)
//! slots    pattern index                                    (arrangement_length times)
//! ```

use crate::instruments::{InstrumentKind, MAX_PARAMS};

pub const MAGIC: f32 = 25_710.0;
pub const VERSION: f32 = 1.0;
pub const MAX_TRACKS: usize = 16;
pub const MAX_STEPS: usize = 64;
pub const MAX_PATTERNS: usize = 64;
pub const MAX_ARRANGEMENT: usize = 1024;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum CellKind {
    Rest,
    Hit,
    Note,
    Tie,
}

#[derive(Clone, Copy, Debug)]
pub struct Cell {
    pub kind: CellKind,
    pub velocity: f32,
    pub note: f32,
}

impl Cell {
    pub const REST: Cell = Cell {
        kind: CellKind::Rest,
        velocity: 0.0,
        note: 0.0,
    };
}

pub struct TrackData {
    pub kind: InstrumentKind,
    pub choke: u8,
    pub level_db: f32,
    pub pan: f32,
    pub lowcut: f32,
    pub highcut: f32,
    pub drive: f32,
    pub reverb: f32,
    pub delay: f32,
    pub mute: bool,
    pub solo: bool,
    pub params: [f32; MAX_PARAMS],
}

pub struct PatternData {
    pub steps: usize,
    cells: Vec<Cell>,
}

impl PatternData {
    pub fn cell(&self, track: usize, step: usize) -> Cell {
        self.cells
            .get(track * self.steps + step)
            .copied()
            .unwrap_or(Cell::REST)
    }
}

pub struct SongData {
    pub bpm: f32,
    pub swing: f32,
    pub master_level_db: f32,
    pub master_glue: f32,
    pub master_drive: f32,
    pub reverb_size: f32,
    pub reverb_damp: f32,
    pub delay_time: f32,
    pub delay_feedback: f32,
    pub delay_tone: f32,
    pub tracks: Vec<TrackData>,
    pub patterns: Vec<PatternData>,
    pub arrangement: Vec<usize>,
}

/// Why a compiled song was refused, as the negative code `engine_load_song` returns.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SongError {
    Truncated = -1,
    BadHeader = -2,
    BadInstrument = -3,
    BadCount = -4,
    BadPattern = -5,
    BadArrangement = -6,
    TrailingData = -7,
}

struct Reader<'a> {
    data: &'a [f32],
    position: usize,
}

impl Reader<'_> {
    fn next(&mut self) -> Result<f32, SongError> {
        let value = *self.data.get(self.position).ok_or(SongError::Truncated)?;
        self.position += 1;
        Ok(value)
    }

    /// A number clamped into range; anything not finite becomes `fallback`.
    fn number(&mut self, min: f32, max: f32, fallback: f32) -> Result<f32, SongError> {
        let value = self.next()?;
        Ok(if value.is_finite() {
            value.clamp(min, max)
        } else {
            fallback
        })
    }

    /// A whole number from 0 to `max`.
    fn count(&mut self, max: usize, error: SongError) -> Result<usize, SongError> {
        let value = self.next()?;
        if value.is_finite() && value >= 0.0 && value <= max as f32 && value.fract() == 0.0 {
            Ok(value as usize)
        } else {
            Err(error)
        }
    }

    fn flag(&mut self) -> Result<bool, SongError> {
        Ok(self.next()? >= 0.5)
    }
}

impl SongData {
    /// A silent song: no tracks, one empty bar.
    pub fn empty() -> Self {
        SongData {
            bpm: 174.0,
            swing: 0.0,
            master_level_db: 0.0,
            master_glue: 0.0,
            master_drive: 0.0,
            reverb_size: 0.5,
            reverb_damp: 0.5,
            delay_time: 3.0,
            delay_feedback: 0.35,
            delay_tone: 0.5,
            tracks: Vec::new(),
            patterns: vec![PatternData {
                steps: 16,
                cells: Vec::new(),
            }],
            arrangement: vec![0],
        }
    }

    pub fn decode(data: &[f32]) -> Result<Self, SongError> {
        let mut reader = Reader { data, position: 0 };
        if reader.next()? != MAGIC || reader.next()? != VERSION {
            return Err(SongError::BadHeader);
        }
        let bpm = reader.number(40.0, 300.0, 174.0)?;
        let swing = reader.number(0.0, 1.0, 0.0)?;
        let master_level_db = reader.number(-60.0, 12.0, 0.0)?;
        let master_glue = reader.number(0.0, 1.0, 0.0)?;
        let master_drive = reader.number(0.0, 1.0, 0.0)?;
        let reverb_size = reader.number(0.0, 1.0, 0.5)?;
        let reverb_damp = reader.number(0.0, 1.0, 0.5)?;
        let delay_time = reader.number(1.0, 8.0, 3.0)?;
        let delay_feedback = reader.number(0.0, 0.9, 0.35)?;
        let delay_tone = reader.number(0.0, 1.0, 0.5)?;
        let track_count = reader.count(MAX_TRACKS, SongError::BadCount)?;
        let pattern_count = reader.count(MAX_PATTERNS, SongError::BadCount)?;
        let arrangement_length = reader.count(MAX_ARRANGEMENT, SongError::BadCount)?;
        if pattern_count == 0 || arrangement_length == 0 {
            return Err(SongError::BadCount);
        }

        let mut tracks = Vec::with_capacity(track_count);
        for _ in 0..track_count {
            tracks.push(Self::decode_track(&mut reader)?);
        }

        let mut patterns = Vec::with_capacity(pattern_count);
        for _ in 0..pattern_count {
            let steps = reader.count(MAX_STEPS, SongError::BadPattern)?;
            if steps == 0 {
                return Err(SongError::BadPattern);
            }
            let mut cells = Vec::with_capacity(track_count * steps);
            for _ in 0..track_count * steps {
                let kind = match reader.count(3, SongError::BadPattern)? {
                    0 => CellKind::Rest,
                    1 => CellKind::Hit,
                    2 => CellKind::Note,
                    _ => CellKind::Tie,
                };
                let velocity = reader.number(0.0, 1.0, 0.0)?;
                let note = reader.number(0.0, 127.0, 60.0)?;
                cells.push(Cell {
                    kind,
                    velocity,
                    note,
                });
            }
            patterns.push(PatternData { steps, cells });
        }

        let mut arrangement = Vec::with_capacity(arrangement_length);
        for _ in 0..arrangement_length {
            arrangement.push(reader.count(pattern_count - 1, SongError::BadArrangement)?);
        }
        if reader.position != data.len() {
            return Err(SongError::TrailingData);
        }

        Ok(SongData {
            bpm,
            swing,
            master_level_db,
            master_glue,
            master_drive,
            reverb_size,
            reverb_damp,
            delay_time,
            delay_feedback,
            delay_tone,
            tracks,
            patterns,
            arrangement,
        })
    }

    fn decode_track(reader: &mut Reader) -> Result<TrackData, SongError> {
        let kind = InstrumentKind::from_index(reader.count(16, SongError::BadInstrument)?)
            .ok_or(SongError::BadInstrument)?;
        let choke = reader.count(8, SongError::BadCount)? as u8;
        let level_db = reader.number(-60.0, 12.0, 0.0)?;
        let pan = reader.number(-1.0, 1.0, 0.0)?;
        let lowcut = reader.number(10.0, 20_000.0, 20.0)?;
        let highcut = reader.number(100.0, 22_000.0, 20_000.0)?;
        let drive = reader.number(0.0, 1.0, 0.0)?;
        let reverb = reader.number(0.0, 1.0, 0.0)?;
        let delay = reader.number(0.0, 1.0, 0.0)?;
        let mute = reader.flag()?;
        let solo = reader.flag()?;
        let param_count = reader.count(MAX_PARAMS, SongError::BadCount)?;
        if param_count != kind.params().len() {
            return Err(SongError::BadCount);
        }
        let mut params = [0.0; MAX_PARAMS];
        for param in params.iter_mut().take(param_count) {
            *param = reader.number(-100_000.0, 100_000.0, 0.0)?;
        }
        Ok(TrackData {
            kind,
            choke,
            level_db,
            pan,
            lowcut,
            highcut,
            drive,
            reverb,
            delay,
            mute,
            solo,
            params,
        })
    }
}

#[cfg(test)]
pub mod tests {
    use super::*;

    /// A compiled one-track song: a kick on every beat of one bar.
    pub fn four_on_the_floor() -> Vec<f32> {
        let mut data = vec![
            MAGIC, VERSION, 174.0, 0.0, 0.0, 0.0, 0.0, 0.5, 0.5, 3.0, 0.35, 0.5, 1.0, 1.0, 1.0,
        ];
        data.extend([
            0.0, 0.0, 0.0, 0.0, 20.0, 20_000.0, 0.0, 0.0, 0.0, 0.0, 0.0, 5.0,
        ]);
        data.extend([48.0, 5.0, 0.035, 0.3, 0.3]);
        data.push(16.0);
        for step in 0..16 {
            if step % 4 == 0 {
                data.extend([1.0, 1.0, 0.0]);
            } else {
                data.extend([0.0, 0.0, 0.0]);
            }
        }
        data.push(0.0);
        data
    }

    #[test]
    fn decodes_a_song() {
        let song = SongData::decode(&four_on_the_floor()).unwrap();
        assert_eq!(song.tracks.len(), 1);
        assert_eq!(song.tracks[0].kind, InstrumentKind::Kick);
        assert_eq!(song.patterns[0].steps, 16);
        assert_eq!(song.patterns[0].cell(0, 4).kind, CellKind::Hit);
        assert_eq!(song.patterns[0].cell(0, 5).kind, CellKind::Rest);
        assert_eq!(song.arrangement, vec![0]);
    }

    #[test]
    fn refuses_malformed_songs() {
        let good = four_on_the_floor();
        assert_eq!(
            SongData::decode(&good[..good.len() - 1]).err(),
            Some(SongError::Truncated)
        );
        let mut extra = good.clone();
        extra.push(0.0);
        assert_eq!(
            SongData::decode(&extra).err(),
            Some(SongError::TrailingData)
        );
        let mut magic = good.clone();
        magic[0] = 1.0;
        assert_eq!(SongData::decode(&magic).err(), Some(SongError::BadHeader));
        let mut slot = good.clone();
        *slot.last_mut().unwrap() = 3.0;
        assert_eq!(
            SongData::decode(&slot).err(),
            Some(SongError::BadArrangement)
        );
        let mut instrument = good;
        instrument[15] = 9.0;
        assert_eq!(
            SongData::decode(&instrument).err(),
            Some(SongError::BadInstrument)
        );
    }

    #[test]
    fn clamps_values_and_replaces_nan() {
        let mut data = four_on_the_floor();
        data[2] = 10_000.0;
        data[3] = f32::NAN;
        let song = SongData::decode(&data).unwrap();
        assert_eq!(song.bpm, 300.0);
        assert_eq!(song.swing, 0.0);
    }
}
