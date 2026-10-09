/**
 * Round 8: a second piece for every band of the mines. Each band had one drifting ambient piece
 * (Under Stone, Glass Caverns, Ember Deep) looping for as long as a player digs — the place a player
 * spends the most real time had the least music. The 'mine:earth' / 'mine:ice' / 'mine:lava'
 * playlists (select.ts) now rotate the ambient piece with a written song of a different character:
 *
 *   earth  Lamplit Seam   a miner's tune: low clarinet over walking upright and pizzicato, a woodblock
 *                         pick ticking far off — curious, plucky, D dorian (the raised 6th is the lamp)
 *   ice    Hoarfrost      a slow 6/8 flute air in C# minor over rolled harp, a cello under the
 *                         repeat, celesta frost late — cold breath, not glitter
 *   lava   Cinder Hymn    an oboe lament in E harmonic minor (the C–D# augmented second) over a low
 *                         3+3+2 marimba pulse, a drone and a slow heartbeat on the bodhrán
 *
 * Original material, in the tune notation of themes.ts (`<degree>:<steps>`, `'`/`,` octaves,
 * `b`/`#` accidentals, `r` rest; 8 steps a bar in 4/4, 6 in 6/8).
 */
import type { ThemeDef } from './composer';

export const SONGBOOK_MINE: Record<string, ThemeDef> = {
  /** Earth floors II — "Lamplit Seam": D dorian, clarinet in its warm chalumeau over a walking bass. */
  'mine-2': {
    width: 0,
    id: 'mine-2',
    title: 'Lamplit Seam',
    blurb: 'The mines',
    bpm: 80,
    meter: '4/4',
    key: 62, // D
    mode: 'dorian',
    swing: 0.54,
    // A four-bar vamp of bass and pizzicato alone (the lamp being lit), then the tune.
    form: ['intro', 'A', 'B', 'A', 'B', 'A', 'outro'],
    prog: {
      intro: ['i', 'IV', 'i', 'IV'],
      A: ['i', 'IV', 'i', 'bVII', 'bIII', 'IV', 'v', 'i'],
      Aend: ['bVII IV', 'i'],
      B: ['bIII', 'bVII', 'IV', 'i', 'bIII', 'bVII', 'ii7', 'v7'],
      outro: ['IV', 'i'],
    },
    melody: {
      inst: 'clarinet', range: [55, 79], density: 0.5, legato: true, ornament: 0.2, bInst: 'clarinet',
      tune: {
        octave: 0,
        // "D E F A. | B A G B… | A F G F D | E… (C D) | F. G A D' | C' B A B G | A. F E C | D… |"
        A: ['1:1 2:1 3:2 5:3 r:1', '6:2 5:1 4:1 6:4', '5:2 3:2 4:1 3:1 1:2', '2:4 r:2 7,:1 1:1', "3:3 4:1 5:2 1':2", '7:2 6:2 5:1 6:1 4:2', '5:3 3:1 2:2 7,:2', '1:6 r:2'],
        Aend: ['2:2 3:2 4:2 6:2', '1:6 r:2'],
        // "A. B C' D' | E'… D' C' | B. A G B | A… | F A D'. C' | E' D' C' A | B G E. G | A… |"
        B: ["5:3 6:1 7:2 1':2", "2':4 1':2 7:2", '6:3 5:1 4:2 6:2', '5:6 r:2', "3:2 5:2 1':3 7:1", "2':2 1':2 7:2 5:2", '6:2 4:2 2:3 4:1', '5:6 r:2'],
        pickup: '5,:1 7,:1',
      },
    },
    counter: { inst: 'marimba', range: [60, 72], on: 'late' },
    accomp: { inst: 'pizz', pattern: 'pizzOff', range: [55, 69], voices: 3, vel: 0.5 },
    bass: { inst: 'upright', pattern: 'walk', range: [38, 50], vel: 0.74 },
    pad: { inst: 'pad', range: [52, 64], voices: 3, vel: 0.3, on: 'B' },
    perc: { pattern: 'cave', on: 'repeat', vel: 0.5 },
    mix: {
      melody: { gain: 0.8, pan: 0.08, send: 0.5 },
      counter: { gain: 0.36, pan: 0.34, send: 0.55 },
      accomp: { gain: 0.56, pan: -0.28, send: 0.42 },
      bass: { gain: 0.64, pan: 0, send: 0.12 },
      pad: { gain: 0.3, pan: 0, send: 0.6 },
      perc: { gain: 0.42, pan: -0.12, send: 0.5 },
    },
    eq: { hp: 60 },
    rest: [4, 12],
    gain: 1,
  },

  /** Frozen floors II — "Hoarfrost": a slow 6/8 flute air in C# minor, harp rolls, cello under the repeat. */
  'mine-ice-2': {
    width: 0,
    id: 'mine-ice-2',
    title: 'Hoarfrost',
    blurb: 'The frozen floors',
    bpm: 50,
    meter: '6/8',
    key: 61, // C#
    mode: 'minor',
    form: ['intro', 'A', 'B', 'A', 'C', 'A', 'outro'],
    prog: {
      intro: ['i', 'bVI'],
      A: ['i', 'bVI', 'iv', 'i', 'bVI', 'bIII', 'iv', 'V'],
      Aend: ['iv V', 'i'],
      B: ['bIII', 'bVII', 'bVI', 'bIII', 'iv', 'i', 'bVI', 'V'],
      // The bridge in the relative major (E): the cello takes the air down an octave.
      C: ['bIII', 'bVII', 'bIII', 'bVI', 'iv', 'bVII', 'bIII', 'V'],
      outro: ['bVI', 'i'],
    },
    melody: {
      inst: 'flute', range: [68, 90], density: 0.4, legato: true, ornament: 0.2, cInst: 'cello',
      tune: {
        octave: 1,
        // "G#. F# E | E D# C#… | F#. E F# | G#… | A. G# E | B. G# E | F# A C#' | D#' C#' B# |"
        A: ['5:3 4:1 3:2', '3:2 2:1 1:3', '4:3 3:2 4:1', '5:4 r:2', '6:3 5:1 3:2', '7:3 5:2 3:1', "4:2 6:1 1':3", "2':2 1':1 #7:3"],
        Aend: ['4:2 3:1 2:3', '1:4 r:2'],
        // "B. A G# | F#. D# C# | E. C# A | G#… | A. G# F# | E G# C#' | D#' C#' A | B#… |"
        B: ['7:3 6:1 5:2', '4:3 2:1 1:2', '3:3 1:1 6:2', '5:4 r:2', '6:3 5:1 4:2', "3:2 5:1 1':3", "2':2 1':1 6:3", '#7:4 r:2'],
        // cello: "E F# G# | F# D# B | E G# B | A… | A F# C# | D# F# B | B G# E | D# B#… |"
        C: ['3:2 4:1 5:3', '4:2 2:1 7,:3', '3:2 5:1 7:3', '6:4 r:2', '6:2 4:1 1:3', '2:2 4:1 7:3', '7:2 5:1 3:3', '2:3 #7,:3'],
      },
    },
    counter: { inst: 'cello', range: [48, 62], on: 'repeat', style: 'moving' },
    accomp: { inst: 'harp', pattern: 'harpRoll', range: [52, 71], voices: 4, vel: 0.52 },
    accomp2: { inst: 'celesta', pattern: 'musicBox', range: [73, 88], voices: 3, vel: 0.28, on: 'late' },
    bass: { inst: 'softBass', pattern: 'root', range: [37, 49], vel: 0.48 },
    pad: { inst: 'pad', range: [54, 69], voices: 3, vel: 0.3, on: 'B' },
    mix: {
      melody: { gain: 0.78, pan: 0.1, send: 0.62 },
      counter: { gain: 0.42, pan: -0.3, send: 0.55 },
      accomp: { gain: 0.6, pan: -0.24, send: 0.55 },
      accomp2: { gain: 0.24, pan: 0.36, send: 0.7 },
      bass: { gain: 0.42, pan: 0, send: 0.15 },
      pad: { gain: 0.3, pan: 0, send: 0.65 },
    },
    eq: { hp: 60 },
    rest: [4, 12],
    gain: 1,
  },

  /** Ember floors II — "Cinder Hymn": an oboe lament in E harmonic minor over a low 3+3+2 marimba pulse. */
  'mine-lava-2': {
    width: 0,
    id: 'mine-lava-2',
    title: 'Cinder Hymn',
    blurb: 'The ember floors',
    bpm: 63,
    meter: '4/4',
    key: 52, // E
    mode: 'harmonicMinor',
    form: ['intro', 'A', 'A', 'B', 'A', 'outro'],
    prog: {
      intro: ['iv', 'V'],
      A: ['i', 'i', 'iv', 'V', 'bVI', 'iv', 'bII', 'V'],
      Aend: ['bII V', 'i'],
      B: ['bVI', 'bIII', 'iv', 'i', 'bVI', 'bII', 'iv', 'V'],
      outro: ['iv', 'i'],
    },
    melody: {
      inst: 'oboe', range: [60, 82], density: 0.45, legato: true, ornament: 0.25, bInst: 'oboe',
      tune: {
        octave: 1,
        // "B. C B G | A G F# G B | C. D# C B | D#… B | E'. D# C B | A C E'… | C. B A F | D#… |"
        // (Round 18: the first half stops short on the D# — C. D# C B, the augmented second leaning on
        // the leading tone — so the E' is first heard in bar 5, the lament breaking through.)
        A: ['5:3 6:1 5:2 3:2', '4:2 3:2 2:1 3:1 5:2', '6:3 7:1 6:2 5:2', '7:4 5:2 r:2', "1':3 7:1 6:2 5:2", "4:2 6:2 1':4", '6:3 5:1 4:2 b2:2', '7,:4 r:4'],
        Aend: ['6:2 4:1 b2:1 7,:4', '1:6 r:2'],
        // "G'. F#' E'… | B. A G B | C B A G | G… | E'. F#' G' E' | F'… C B | A C B A | D#… |"
        B: ["3':3 2':1 1':4", '5:3 4:1 3:2 5:2', '6:3 5:1 4:2 3:2', '3:6 r:2', "1':3 2':1 3':2 1':2", "b2':4 6:2 5:2", '4:2 6:2 5:2 4:2', '7:4 r:4'],
      },
    },
    counter: { inst: 'cello', range: [43, 57], on: 'repeat', style: 'moving' },
    accomp: { inst: 'marimba', pattern: 'ostinato332', range: [45, 59], voices: 3, vel: 0.46 },
    bass: { inst: 'drone', pattern: 'pedal', range: [36, 48], vel: 0.45 },
    pad: { inst: 'pad', range: [52, 67], voices: 3, vel: 0.3, on: 'B' },
    perc: { pattern: 'cave', on: 'always', vel: 0.6 },
    mix: {
      melody: { gain: 0.8, pan: 0.1, send: 0.55 },
      counter: { gain: 0.4, pan: -0.32, send: 0.5 },
      accomp: { gain: 0.5, pan: -0.2, send: 0.45 },
      bass: { gain: 0.4, pan: 0, send: 0.2 },
      pad: { gain: 0.32, pan: 0, send: 0.6 },
      perc: { gain: 0.5, pan: 0.15, send: 0.45 },
    },
    // Tone: no sub rumble under the drone, the lava floor's 190 Hz mud cut.
    eq: { hp: 70, cut: { f: 190, db: -3, q: 0.7 } },
    rest: [4, 12],
    gain: 1,
  },
};
