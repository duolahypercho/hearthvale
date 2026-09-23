/**
 * Hearthvale's score: one ThemeDef per musical situation. All original material. Every song has a
 * hand-written tune (scale degrees + rhythm, see `Tune` in composer.ts) that is restated literally
 * whenever its A section comes round; the composer arranges it (harmony, figuration, fills, form).
 *
 * Tune notation per bar: `<degree>:<eighths>` (6/8: triplet eighths), `'`/`,` = octave up/down,
 * `b`/`#` accidentals, `r` = rest. Degree 1 = key + 12 × octave.
 */
import type { ThemeDef } from './composer';

const FORM_SONG: ThemeDef['form'] = ['intro', 'A', 'A', 'B', 'A', 'outro'];

export const THEMES: Record<string, ThemeDef> = {
  /** Spring on the farm — flute tune over kalimba arpeggios and an upright; strings swell in B. */
  spring: {
    id: 'spring',
    title: 'First Furrow',
    blurb: 'Spring on the farm',
    bpm: 98,
    meter: '4/4',
    key: 65, // F
    mode: 'major',
    swing: 0.53,
    form: FORM_SONG,
    prog: {
      intro: ['Imaj7', 'IVmaj7'],
      A: ['I', 'IVmaj7', 'vi7', 'V', 'I', 'IVmaj7', 'ii7 V', 'I'],
      B: ['IV', 'V', 'iii7', 'vi', 'ii7', 'V', 'IVmaj7', 'Vsus4 V'],
      outro: ['IVmaj7', 'Iadd9'],
    },
    melody: {
      inst: 'flute', range: [67, 89], density: 0.55, legato: true, ornament: 0.3,
      tune: {
        octave: 1,
        // "F.. G A C | D.. C Bb A | A C D.. C | Bb A G.. (C D) | ..." — a dotted walk up and a sigh down.
        A: ['1:3 2:1 3:2 5:2', '6:3 5:1 4:2 3:2', '3:2 5:2 6:3 5:1', "4:1 3:1 2:4 5,:1 6,:1", '1:3 2:1 3:2 5:2', "1':3 7:1 6:2 5:2", '6:2 4:2 2:2 7,:2', '1:6 r:2'],
        B: ['6:4 5:2 4:2', '5:4 4:2 3:2', '3:4 2:2 1:2', '2:2 3:2 6,:4', "4:2 6:2 1':3 7:1", "1':2 7:2 5:4", '6:3 5:1 4:2 3:2', '2:6 r:2'],
        Aend: ['6:2 4:1 3:1 2:2 7,:2', '1:8'],
        pickup: '5,:1 6,:1',
      },
    },
    counter: { inst: 'clarinet', range: [55, 67], on: 'repeat' },
    accomp: { inst: 'kalimba', pattern: 'arp8', range: [60, 77], voices: 4, vel: 0.62 },
    bass: { inst: 'upright', pattern: 'rootFifth', range: [36, 50], vel: 0.8 },
    pad: { inst: 'pad', range: [53, 69], voices: 4, vel: 0.45, on: 'B' },
    perc: { pattern: 'light', on: 'always', vel: 0.6 },
    mix: {
      melody: { gain: 0.8, pan: 0.08, send: 0.32 },
      counter: { gain: 0.5, pan: 0.32, send: 0.35 },
      accomp: { gain: 0.6, pan: -0.28, send: 0.3 },
      bass: { gain: 0.7, pan: 0, send: 0.05 },
      pad: { gain: 0.42, pan: 0, send: 0.5 },
      perc: { gain: 0.4, pan: 0.22, send: 0.15 },
    },
    rest: [25, 60],
    gain: 0.84,
  },

  /** Summer — a syncopated marimba tune, nylon guitar picking, 3+3+2 ostinato, shaker. */
  summer: {
    id: 'summer',
    title: 'Long Light',
    blurb: 'Summer on the farm',
    bpm: 104,
    meter: '4/4',
    key: 67, // G
    mode: 'major',
    swing: 0.56,
    form: FORM_SONG,
    prog: {
      intro: ['Imaj7', 'IV'],
      A: ['Imaj7', 'IV', 'Imaj7', 'IV', 'vi7', 'ii7', 'IV', 'V'],
      B: ['IV', 'V', 'iii7', 'vi7', 'ii7', 'V', 'bVII', 'V7sus4 V'],
      outro: ['IV', 'Imaj7'],
    },
    melody: {
      inst: 'marimba', range: [62, 86], density: 0.8, ornament: 0.12,
      tune: {
        octave: 0,
        // "B D . D E D B | C E . E G E D | ..." — the hiccup rest is the hook.
        A: ['3:1 5:1 r:1 5:1 6:1 5:1 3:2', "4:1 6:1 r:1 6:1 1':1 6:1 5:2", '3:1 5:1 r:1 5:1 6:1 5:1 3:1 2:1', '1:1 2:1 3:2 6,:1 1:1 r:2', '5:1 6:1 5:1 3:1 2:1 3:1 5:2', "6:3 1':1 6:2 5:2", "4:1 3:1 4:1 6:1 1':2 6:1 5:1", '2:3 7,:1 5,:2 r:2'],
        B: ["1':4 6:2 5:2", "2':4 7:2 6:2", "3':4 2':2 1':2", "6:2 7:2 1':4", "1':3 7:1 6:2 1':2", '7:4 r:2 5:1 6:1', 'b7:3 6:1 4:2 2:2', '5:6 r:2'],
        pickup: '1:1 2:1',
      },
    },
    counter: { inst: 'ocarina', range: [62, 74], on: 'late' },
    accomp: { inst: 'guitar', pattern: 'fingerpick', range: [50, 67], voices: 4, vel: 0.7 },
    accomp2: { inst: 'marimba', pattern: 'ostinato332', range: [62, 79], voices: 3, vel: 0.36, on: 'repeat' },
    bass: { inst: 'upright', pattern: 'tresillo', range: [36, 50], vel: 0.82 },
    perc: { pattern: 'shaker', on: 'always', vel: 0.6 },
    mix: {
      melody: { gain: 0.9, pan: 0.12, send: 0.28 },
      counter: { gain: 0.46, pan: -0.35, send: 0.35 },
      accomp: { gain: 0.7, pan: -0.25, send: 0.22 },
      accomp2: { gain: 0.42, pan: 0.35, send: 0.25 },
      bass: { gain: 0.7, pan: 0, send: 0.05 },
      perc: { gain: 0.4, pan: -0.15, send: 0.12 },
    },
    rest: [25, 60],
    gain: 1.0,
  },

  /** Fall — a clarinet waltz of falling thirds over harp, cello counter-line, minor with a warm major V. */
  fall: {
    id: 'fall',
    title: 'Amber Waltz',
    blurb: 'Autumn on the farm',
    bpm: 132,
    meter: '3/4',
    key: 62, // D
    mode: 'minor',
    form: FORM_SONG,
    prog: {
      intro: ['i', 'bVI'],
      A: ['i', 'bVI', 'bIII', 'bVII', 'iv', 'i', 'iv V', 'i'],
      B: ['bIII', 'bVII', 'iv', 'i', 'bVImaj7', 'bIII', 'iim7b5', 'V'],
      outro: ['iv', 'i'],
    },
    melody: {
      inst: 'clarinet', range: [62, 84], density: 0.45, legato: true, ornament: 0.25,
      tune: {
        octave: 1,
        // "A.. Bb A | Bb.. A G | F.. E D | C.. D E | G.. A Bb | A. G F. | G Bb A C# | D" — a descending sequence that climbs home.
        A: ['5:4 6:1 5:1', '6:4 5:1 4:1', '3:4 2:1 1:1', '7,:4 1:1 2:1', '4:4 5:1 6:1', '5:3 4:1 3:2', '4:2 6:1 5:1 #7,:2', '1:6'],
        B: ["7:3 1':1 7:1 5:1", '4:3 5:1 4:1 2:1', "6:3 1':1 6:1 4:1", '5:4 r:2', "1':3 7:1 6:1 5:1", '7:3 6:1 5:1 3:1', '4:2 6:2 2:2', '2:4 #7,:2'],
      },
    },
    counter: { inst: 'cello', range: [48, 62], on: 'repeat', style: 'moving' },
    accomp: { inst: 'harp', pattern: 'waltzArp', range: [55, 74], voices: 4, vel: 0.55 },
    bass: { inst: 'upright', pattern: 'waltz', range: [36, 50], vel: 0.78 },
    pad: { inst: 'pad', range: [50, 67], voices: 3, vel: 0.4, on: 'B' },
    mix: {
      melody: { gain: 0.85, pan: 0.06, send: 0.34 },
      counter: { gain: 0.5, pan: -0.3, send: 0.38 },
      accomp: { gain: 0.62, pan: 0.28, send: 0.34 },
      bass: { gain: 0.7, pan: 0, send: 0.06 },
      pad: { gain: 0.4, pan: 0, send: 0.5 },
    },
    rest: [25, 60],
    gain: 0.92,
  },

  /** Winter — a music-box tune in a slow 3/4 with a minor-iv sigh, celesta, bells on the repeat, soft strings. */
  winter: {
    id: 'winter',
    title: 'Hush of Snow',
    blurb: 'Winter on the farm',
    bpm: 84,
    meter: '3/4',
    key: 64, // E
    mode: 'major',
    form: FORM_SONG,
    prog: {
      intro: ['Imaj7', 'vi7'],
      A: ['I', 'iii', 'vi7', 'IVmaj7', 'I', 'IV', 'iv', 'I'],
      B: ['vi', 'iii', 'IV', 'I', 'ii7', 'V', 'IV', 'V7sus4'],
      outro: ['iv6', 'Imaj7'],
    },
    melody: {
      inst: 'musicBox', range: [76, 93], density: 0.35, ornament: 0.15, bInst: 'celesta',
      tune: {
        octave: 1,
        // "B. C# B G# | D#. E D# B | E. F# E C# | C# B G# | ... | C. B A G | G# F# E" — rising thirds, then the minor iv.
        A: ['5:3 6:1 5:1 3:1', "7:3 1':1 7:1 5:1", "1':3 2':1 1':1 6:1", '6:2 5:2 3:2', '5:3 6:1 5:1 3:1', "6:3 1':1 6:1 4:1", 'b6:3 5:1 4:1 b3:1', '3:1 2:1 1:4'],
        B: ["1':4 7:1 6:1", '7:4 6:1 5:1', '6:4 5:1 4:1', "3:2 5:2 1':2", "2':4 1':1 6:1", "7:3 1':1 2':2", "1':3 6:1 4:2", '5:4 r:2'],
      },
    },
    counter: { inst: 'bell', range: [64, 76], on: 'late' },
    accomp: { inst: 'celesta', pattern: 'musicBox', range: [64, 81], voices: 3, vel: 0.42 },
    perc: { pattern: 'sleigh', on: 'always', vel: 0.4 },
    bass: { inst: 'softBass', pattern: 'root', range: [40, 52], vel: 0.55 },
    pad: { inst: 'pad', range: [55, 71], voices: 4, vel: 0.45, on: 'always' },
    mix: {
      melody: { gain: 0.85, pan: 0.1, send: 0.45 },
      counter: { gain: 0.42, pan: -0.35, send: 0.55 },
      accomp: { gain: 0.52, pan: -0.22, send: 0.45 },
      bass: { gain: 0.42, pan: 0, send: 0.1 },
      pad: { gain: 0.36, pan: 0, send: 0.55 },
      perc: { gain: 0.4, pan: 0.3, send: 0.35 },
    },
    rest: [30, 70],
    gain: 0.93,
  },

  /** Hearthvale Square by day — a skipping ocarina tune, off-beat pizzicato, walking bass, woodblocks. */
  town: {
    id: 'town',
    title: 'Market Morning',
    blurb: 'Hearthvale Square',
    bpm: 112,
    meter: '4/4',
    key: 67, // G
    mode: 'major',
    swing: 0.58,
    form: FORM_SONG,
    prog: {
      intro: ['I', 'V7'],
      A: ['I', 'vi', 'ii7', 'V7', 'I', 'IV', 'ii7 V7', 'I'],
      B: ['IV', 'I', 'ii7', 'V', 'IV', 'iii7 vi7', 'ii7', 'V7'],
      outro: ['ii7 V7', 'I6'],
    },
    melody: {
      inst: 'ocarina', range: [67, 86], density: 0.75, ornament: 0.2, bInst: 'clarinet',
      tune: {
        octave: 0,
        // "B D G D B'. A G | E D B D E. D B | C E G E A. G E | F# G A G F#. |" — up the arpeggio and back.
        A: ["3:1 5:1 1':1 5:1 3':2 2':1 1':1", '6:1 5:1 3:1 5:1 6:2 5:1 3:1', "4:1 6:1 1':1 6:1 2':2 1':1 6:1", "7:1 1':1 2':1 1':1 7:2 r:2", "3:1 5:1 1':1 5:1 3':2 2':1 1':1", "1':1 2':1 3':1 2':1 1':2 6:2", '6:1 5:1 4:1 6:1 5:1 4:1 2:2', '1:2 r:1 5,:1 1:2 r:2'],
        B: ["6:2 4:1 6:1 1':2 6:2", "5:2 3:1 5:1 1':2 5:2", "4:1 6:1 1':1 2':1 1':2 6:2", '7:3 6:1 5:4', "6:2 4:1 6:1 1':2 6:2", "2':2 7:2 1':2 6:2", "4:2 6:2 1':2 6:1 4:1", "2':3 1':1 7:2 5:2"],
        Aend: ['6:1 5:1 4:1 6:1 5:1 4:1 2:1 7,:1', '1:2 5,:1 7,:1 1:4'],
        pickup: '1:1 2:1',
      },
    },
    counter: { inst: 'clarinet', range: [57, 69], on: 'late' },
    accomp: { inst: 'pizz', pattern: 'pizzOff', range: [55, 71], voices: 3, vel: 0.62 },
    accomp2: { inst: 'epiano', pattern: 'block', range: [55, 72], voices: 4, vel: 0.35, on: 'B' },
    bass: { inst: 'upright', pattern: 'walk', range: [36, 50], vel: 0.82 },
    perc: { pattern: 'town', on: 'always', vel: 0.55 },
    mix: {
      melody: { gain: 0.82, pan: 0.05, send: 0.28 },
      counter: { gain: 0.46, pan: 0.35, send: 0.3 },
      accomp: { gain: 0.65, pan: -0.3, send: 0.25 },
      accomp2: { gain: 0.42, pan: 0.25, send: 0.35 },
      bass: { gain: 0.7, pan: 0, send: 0.06 },
      perc: { gain: 0.4, pan: 0.25, send: 0.15 },
    },
    rest: [15, 40],
    gain: 0.86,
  },

  /** Beach — a tresillo steel-pan tune, ukulele island strum, congas. */
  beach: {
    id: 'beach',
    title: 'Salt & Sun',
    blurb: 'Driftsand Beach',
    bpm: 96,
    meter: '4/4',
    key: 69, // A
    mode: 'major',
    swing: 0.54,
    form: FORM_SONG,
    prog: {
      intro: ['Imaj7', 'IVmaj7'],
      A: ['Imaj7', 'IVmaj7', 'Imaj7', 'IVmaj7', 'ii7', 'V', 'iii7 vi7', 'ii7 V'],
      B: ['IV', 'iii7', 'ii7', 'Imaj7', 'IV', 'V', 'vi7', 'Vsus4 V'],
      outro: ['IVmaj7', 'Imaj7'],
    },
    melody: {
      inst: 'steelPan', range: [66, 88], density: 0.55, ornament: 0.1,
      tune: {
        octave: 0,
        // "E.. C#.. E | F#.. D.. F# | A.. G#.. E C# | ..." — 3+3+2 all the way.
        A: ['5:3 3:3 5:2', '6:3 4:3 6:2', "1':3 7:3 5:1 3:1", '6:3 4:1 3:2 1:2', "4:1 6:1 1':1 6:1 4:2 2:2", "5:3 7:3 2':2", '7:2 5:2 6:2 3:2', '4:2 2:2 7,:2 5,:2'],
        B: ["1':4 6:2 4:2", '7:4 5:2 3:2', '6:4 4:2 2:2', '5:3 3:1 5:2 7:2', "6:1 1':1 2':1 1':1 6:2 4:2", "7:1 2':1 3':1 2':1 7:2 5:2", "1':3 6:3 3:2", '2:4 r:4'],
        pickup: '3:1 4:1',
      },
    },
    counter: { inst: 'marimba', range: [60, 74], on: 'late' },
    accomp: { inst: 'ukulele', pattern: 'strum', range: [60, 72], voices: 4, vel: 0.5 },
    bass: { inst: 'upright', pattern: 'tresillo', range: [36, 50], vel: 0.82 },
    perc: { pattern: 'island', on: 'always', vel: 0.55 },
    mix: {
      melody: { gain: 0.82, pan: 0.1, send: 0.32 },
      counter: { gain: 0.42, pan: 0.35, send: 0.3 },
      accomp: { gain: 0.6, pan: -0.28, send: 0.22 },
      bass: { gain: 0.7, pan: 0, send: 0.05 },
      perc: { gain: 0.5, pan: -0.12, send: 0.15 },
    },
    rest: [20, 50],
    gain: 1.3,
  },

  /** The mine (earth floors) — a drone with glass bells that keep returning to one small figure. */
  mine: {
    id: 'mine',
    title: 'Under Stone',
    blurb: 'The mines',
    bpm: 52,
    meter: '4/4',
    key: 57, // A
    mode: 'phrygian',
    form: ['A'],
    prog: { A: ['i', 'i', 'bII', 'i', 'iv', 'iv', 'bII', 'v'], B: ['i'] },
    ambient: { inst: 'glass', range: [69, 88], noteChance: 0.5, bars: 16, motif: [0, 1, -1, -3] },
    counter: { inst: 'cello', range: [45, 60], on: 'always' },
    bass: { inst: 'drone', pattern: 'pedal', range: [33, 45], vel: 0.6 },
    pad: { inst: 'pad', range: [52, 67], voices: 3, vel: 0.35, on: 'always' },
    mix: {
      melody: { gain: 0.62, pan: 0.2, send: 0.7 },
      counter: { gain: 0.38, pan: -0.3, send: 0.6 },
      bass: { gain: 0.55, pan: 0, send: 0.2 },
      pad: { gain: 0.42, pan: 0, send: 0.6 },
    },
    rest: [4, 12],
    gain: 1.1,
  },

  /** Deeper: the frozen floors — celesta and bell figures over a thin, high string haze. */
  'mine-ice': {
    id: 'mine-ice',
    title: 'Glass Caverns',
    blurb: 'The frozen floors',
    bpm: 58,
    meter: '4/4',
    key: 64, // E
    mode: 'lydian',
    form: ['A'],
    prog: { A: ['I', 'II', 'Imaj7', 'II', 'vi', 'II', 'IVmaj7', 'II'], B: ['I'] },
    ambient: { inst: 'celesta', range: [76, 93], noteChance: 0.6, bars: 16, motif: [0, 2, 1, -2] },
    counter: { inst: 'bell', range: [64, 79], on: 'always' },
    bass: { inst: 'drone', pattern: 'pedal', range: [40, 52], vel: 0.45 },
    pad: { inst: 'pad', range: [60, 76], voices: 3, vel: 0.32, on: 'always' },
    mix: {
      melody: { gain: 0.6, pan: 0.25, send: 0.75 },
      counter: { gain: 0.34, pan: -0.3, send: 0.7 },
      bass: { gain: 0.48, pan: 0, send: 0.2 },
      pad: { gain: 0.42, pan: 0, send: 0.65 },
    },
    rest: [4, 12],
    gain: 1.1,
  },

  /** Deepest: the ember floors — low cello groans, tritone bells and a heavier drone. */
  'mine-lava': {
    id: 'mine-lava',
    title: 'Ember Deep',
    blurb: 'The ember floors',
    bpm: 48,
    meter: '4/4',
    key: 52, // E
    mode: 'phrygian',
    form: ['A'],
    prog: { A: ['i', 'bII', 'i', 'bII', 'iv', 'bII', 'i', 'viidim'], B: ['i'] },
    ambient: { inst: 'bell', range: [62, 79], noteChance: 0.45, bars: 16, motif: [0, -1, 1, -2] },
    counter: { inst: 'cello', range: [40, 55], on: 'always' },
    bass: { inst: 'drone', pattern: 'pedal', range: [35, 47], vel: 0.55 },
    pad: { inst: 'pad', range: [48, 62], voices: 3, vel: 0.34, on: 'always' },
    mix: {
      melody: { gain: 0.5, pan: 0.2, send: 0.7 },
      counter: { gain: 0.44, pan: -0.3, send: 0.6 },
      bass: { gain: 0.62, pan: 0, send: 0.2 },
      pad: { gain: 0.4, pan: 0, send: 0.6 },
    },
    rest: [4, 12],
    gain: 1.12,
  },

  /** Night — an electric-piano lullaby with a celesta tune under the crickets. */
  night: {
    id: 'night',
    title: 'Lamplight',
    blurb: 'Night in the valley',
    bpm: 66,
    meter: '4/4',
    key: 61, // Db
    mode: 'major',
    breaks: false,
    form: ['intro', 'A', 'B', 'A', 'outro'],
    prog: {
      intro: ['Imaj7', 'IVmaj7'],
      A: ['Imaj7', 'iii7', 'IVmaj7', 'iv6', 'Imaj7', 'vi7', 'ii7', 'V7sus4'],
      B: ['vi7', 'iii7', 'IVmaj7', 'Imaj7', 'ii7', 'iii7', 'IVmaj7', 'V7sus4'],
      outro: ['IVmaj7', 'Imaj7'],
    },
    melody: {
      inst: 'celesta', range: [68, 90], density: 0.3, ornament: 0,
      tune: {
        octave: 1,
        // "F. Eb Db Ab | F.. Ab C | Bb. Ab Gb F | A(bb).. Ab Gb |" — a lullaby that dips into the minor iv.
        A: ['3:3 2:1 1:2 5,:2', '3:4 5:2 7:2', '6:3 5:1 4:2 3:2', 'b6:4 5:2 4:2', '3:3 2:1 1:2 5,:2', "1':3 7:1 6:2 5:2", '4:3 3:1 2:4', '2:2 1:2 5,:4'],
        B: ["5:4 6:2 1':2", "7:4 1':2 2':2", "3':4 2':2 1':2", '7:4 5:4', '6:3 5:1 4:4', '5:3 3:1 5:4', "6:2 1':2 3':4", "2':4 1':4"],
      },
    },
    accomp: { inst: 'epiano', pattern: 'epComp', range: [53, 70], voices: 4, vel: 0.5 },
    bass: { inst: 'softBass', pattern: 'root', range: [37, 49], vel: 0.5 },
    pad: { inst: 'pad', range: [56, 72], voices: 3, vel: 0.32, on: 'always' },
    mix: {
      melody: { gain: 0.62, pan: 0.18, send: 0.55 },
      accomp: { gain: 0.72, pan: -0.1, send: 0.4 },
      bass: { gain: 0.4, pan: 0, send: 0.1 },
      pad: { gain: 0.38, pan: 0, send: 0.6 },
    },
    rest: [20, 45],
    gain: 0.9,
  },

  /** Rainy day — lo-fi electric piano sighs, clarinet counter-line, brushed soft kit. */
  rain: {
    id: 'rain',
    title: 'Window Weather',
    blurb: 'A rainy day',
    bpm: 76,
    meter: '4/4',
    key: 63, // Eb
    mode: 'major',
    swing: 0.6,
    form: ['intro', 'A', 'B', 'A', 'outro'],
    prog: {
      intro: ['vi7', 'IVmaj7'],
      A: ['vi7', 'IVmaj7', 'Imaj7', 'V7sus4', 'vi7', 'ii7', 'IVmaj7', 'V7sus4 V'],
      B: ['IVmaj7', 'V', 'iii7', 'vi7', 'ii7', 'V', 'IVmaj7', 'iv6'],
      outro: ['IVmaj7', 'vi7'],
    },
    melody: {
      inst: 'epiano', range: [68, 88], density: 0.35, ornament: 0,
      tune: {
        octave: 1,
        // ". G Bb. G Eb C | . Eb G. Eb C Ab | . Bb D. Bb G F | F Eb.." — every phrase starts on the "and".
        A: ['r:1 3:1 5:2 3:1 1:1 6,:2', 'r:1 1:1 3:2 1:1 6,:1 4,:2', 'r:1 5:1 7:2 5:1 3:1 2:2', '2:2 1:4 r:2', 'r:1 3:1 5:2 3:1 1:1 6,:2', 'r:1 4:1 6:2 4:1 2:1 1:2', '3:3 2:1 1:2 6,:2', '2:4 7,:2 r:2'],
        B: ["1':4 7:2 6:2", '7:4 6:2 5:2', '5:4 3:2 2:2', '3:3 5:1 6:4', "6:2 1':2 2':2 1':2", '7:4 5:4', "1':3 6:1 3:4", 'b6:4 5:2 4:2'],
      },
    },
    counter: { inst: 'clarinet', range: [58, 70], on: 'repeat' },
    accomp: { inst: 'epiano', pattern: 'epComp', range: [53, 69], voices: 4, vel: 0.45 },
    bass: { inst: 'softBass', pattern: 'rootFifth', range: [39, 51], vel: 0.55 },
    perc: { pattern: 'lofi', on: 'always', vel: 0.5 },
    mix: {
      melody: { gain: 0.66, pan: 0.15, send: 0.45 },
      counter: { gain: 0.42, pan: -0.3, send: 0.45 },
      accomp: { gain: 0.6, pan: -0.12, send: 0.35 },
      bass: { gain: 0.44, pan: 0, send: 0.08 },
      perc: { gain: 0.5, pan: 0.1, send: 0.12 },
    },
    rest: [20, 45],
    gain: 0.85,
  },

  /** The Tipsy Kettle inn — a swung epiano tune with secondary dominants, walking upright, brushes. */
  inn: {
    id: 'inn',
    title: 'The Warm Kettle',
    blurb: 'At the inn',
    bpm: 88,
    meter: '4/4',
    key: 58, // Bb
    mode: 'major',
    swing: 0.62,
    form: FORM_SONG,
    prog: {
      intro: ['Imaj7', 'V7'],
      A: ['Imaj7', 'VI7', 'ii7', 'V7', 'Imaj7', 'IV7', 'iii7 VI7', 'ii7 V7'],
      B: ['IVmaj7', 'iv6', 'iii7', 'VI7', 'ii7', 'V7', 'Imaj7', 'V7sus4 V7'],
      outro: ['ii7 V7', 'Imaj7'],
    },
    melody: {
      inst: 'epiano', range: [62, 86], density: 0.6, ornament: 0.15, bInst: 'clarinet',
      tune: {
        octave: 1,
        // "D F A. G F D. | F D B D G. F. | Eb G Bb. A G Eb. | C. Eb D C. |" — a lazy swing tune with a blue Db.
        A: ['3:1 5:1 7:2 6:1 5:1 3:2', '5:1 3:1 #1:1 3:1 6:2 5:2', "4:1 6:1 1':2 7:1 6:1 4:2", '2:2 4:1 3:1 2:2 r:2', '3:1 5:1 7:2 6:1 5:1 3:2', "1':1 6:1 4:1 6:1 b3:2 1:2", '3:2 5:2 3:1 #1:1 6,:2', '2:2 4:2 5:2 7,:2'],
        B: ["1':4 6:2 4:2", 'b6:4 5:2 4:2', '5:3 3:1 7:2 5:2', "#1':2 6:2 3:2 5:2", "4:3 6:1 1':2 6:2", '5:3 7,:1 2:2 4:2', '3:3 2:1 1:4', '5:4 r:4'],
        Aend: ['3:2 5:2 3:1 #1:1 6,:2', '2:2 7,:2 1:4'],
        pickup: '1:1 2:1',
      },
    },
    counter: { inst: 'clarinet', range: [55, 67], on: 'late' },
    accomp: { inst: 'epiano', pattern: 'epComp', range: [52, 67], voices: 4, vel: 0.46 },
    bass: { inst: 'upright', pattern: 'walk', range: [34, 48], vel: 0.8 },
    perc: { pattern: 'jazz', on: 'always', vel: 0.5 },
    mix: {
      melody: { gain: 0.72, pan: 0.1, send: 0.35 },
      counter: { gain: 0.42, pan: -0.32, send: 0.35 },
      accomp: { gain: 0.55, pan: -0.15, send: 0.3 },
      bass: { gain: 0.7, pan: 0, send: 0.06 },
      perc: { gain: 0.5, pan: 0.15, send: 0.12 },
    },
    rest: [12, 30],
    gain: 0.9,
  },

  /** Deepwood Forest — a dorian whistle tune in a lilting 6/8 over harp. */
  forest: {
    id: 'forest',
    title: 'Mossway',
    blurb: 'Deepwood Forest',
    bpm: 76,
    meter: '6/8',
    key: 64, // E
    mode: 'dorian',
    form: FORM_SONG,
    prog: {
      intro: ['i', 'bVII'],
      A: ['i', 'bVII', 'i', 'IV', 'i', 'bVII', 'IV bVII', 'i'],
      B: ['bIII', 'bVII', 'IV', 'i', 'bIII', 'bVII', 'IV', 'bVII'],
      outro: ['IV', 'i'],
    },
    melody: {
      inst: 'whistle', range: [69, 93], density: 0.6, ornament: 0.3,
      tune: {
        octave: 1,
        // "E. G B. G | A. F# D. F# | E F# G B. C# | C#.. B. A |" — the raised sixth (C#) is the forest's colour.
        A: ['1:2 3:1 5:2 3:1', '4:2 2:1 7,:2 2:1', '1:1 2:1 3:1 5:2 6:1', '6:3 5:2 4:1', '1:2 3:1 5:2 3:1', "7:2 1':1 7:2 5:1", '6:1 5:1 4:1 2:1 4:1 3:1', '1:3 r:3'],
        B: ["5:2 7:1 1':2 7:1", '7:2 4:1 2:2 4:1', "6:2 1':1 2':2 1':1", '5:3 3:3', "3:1 5:1 7:1 1':2 7:1", "2':2 1':1 7:2 4:1", "6:2 4:1 6:2 1':1", "2':2 1':1 7:3"],
        pickup: '5,:1 7,:1',
      },
    },
    counter: { inst: 'cello', range: [45, 60], on: 'repeat', style: 'moving' },
    accomp: { inst: 'harp', pattern: 'waltzArp', range: [52, 72], voices: 4, vel: 0.55 },
    bass: { inst: 'upright', pattern: 'jig', range: [36, 50], vel: 0.7 },
    pad: { inst: 'pad', range: [52, 67], voices: 3, vel: 0.35, on: 'B' },
    perc: { pattern: 'light', on: 'late', vel: 0.45 },
    mix: {
      melody: { gain: 0.66, pan: 0.1, send: 0.4 },
      counter: { gain: 0.46, pan: -0.3, send: 0.4 },
      accomp: { gain: 0.62, pan: -0.2, send: 0.35 },
      bass: { gain: 0.6, pan: 0, send: 0.08 },
      pad: { gain: 0.38, pan: 0, send: 0.55 },
      perc: { gain: 0.5, pan: 0.2, send: 0.2 },
    },
    rest: [20, 50],
    gain: 0.92,
  },

  /** Festival jig — running fiddle quavers with whistle doubling, accordion oom-pah, bodhrán and tambourine. */
  festival: {
    id: 'festival',
    title: 'Lantern Jig',
    blurb: 'Festival day',
    bpm: 112,
    meter: '6/8',
    key: 62, // D
    mode: 'major',
    form: ['intro', 'A', 'A', 'B', 'B', 'A'],
    prog: {
      intro: ['I', 'V'],
      A: ['I', 'I', 'IV', 'V', 'I', 'I', 'IV V', 'I'],
      B: ['vi', 'IV', 'I', 'V', 'vi', 'IV', 'ii V', 'I'],
    },
    melody: {
      inst: 'fiddle', range: [66, 91], density: 0.95, ornament: 0.35, double: { inst: 'whistle', interval: 12, on: 'repeat' },
      tune: {
        octave: 1,
        // "F# E D A D F# | A2 F# B A F# | G B d B2 G | A B A C# E A |" — running jig quavers.
        A: ['3:1 2:1 1:1 5,:1 1:1 3:1', '5:2 3:1 6:1 5:1 3:1', "4:1 6:1 1':1 6:2 4:1", '5:1 6:1 5:1 7,:1 2:1 5,:1', '3:1 2:1 1:1 5,:1 1:1 3:1', "5:1 6:1 7:1 1':2 5:1", '6:1 5:1 4:1 3:1 2:1 7,:1', '1:3 r:3'],
        B: ["6:2 3:1 6:1 1':1 6:1", "4:2 6:1 1':1 6:1 4:1", "3:1 5:1 1':1 5:1 3:1 1:1", '2:1 7,:1 5,:1 2:2 3:1', "6:1 1':1 3':1 1':2 6:1", "6:1 1':1 6:1 4:2 6:1", '2:1 4:1 6:1 5:1 3:1 2:1', '1:3 r:3'],
        pickup: '1:1 2:1',
      },
    },
    accomp: { inst: 'accordion', pattern: 'oompah', range: [57, 71], voices: 3, vel: 0.6 },
    accomp2: { inst: 'guitar', pattern: 'oompah', range: [50, 64], voices: 4, vel: 0.5, on: 'repeat' },
    bass: { inst: 'upright', pattern: 'jig', range: [38, 52], vel: 0.85 },
    perc: { pattern: 'jig', on: 'always', vel: 0.6 },
    mix: {
      melody: { gain: 0.72, pan: 0.1, send: 0.22 },
      double: { gain: 0.3, pan: -0.25, send: 0.25 },
      accomp: { gain: 0.5, pan: -0.3, send: 0.2 },
      accomp2: { gain: 0.42, pan: 0.35, send: 0.18 },
      bass: { gain: 0.7, pan: 0, send: 0.05 },
      perc: { gain: 0.5, pan: 0.05, send: 0.12 },
    },
    rest: [0, 0],
    gain: 1.4,
  },

  /** Title — the valley's main theme: an octave leap that falls home, harp rolls, a moving cello line, a key lift. */
  title: {
    id: 'title',
    title: 'Hearthvale',
    blurb: 'Main theme',
    bpm: 80,
    meter: '4/4',
    key: 62, // D
    mode: 'major',
    lift: 2,
    breaks: 'breath',
    form: ['intro', 'A', 'A', 'B', 'A', 'outro'],
    prog: {
      intro: ['Imaj7', 'IVmaj7'],
      A: ['Imaj7', 'iii7', 'vi7', 'IVmaj7', 'ii7', 'V', 'IVmaj7', 'I'],
      B: ['IV', 'V', 'iii7', 'vi', 'IVmaj7', 'iii7', 'ii7', 'V7sus4 V'],
      outro: ['IVmaj7', 'Iadd9'],
    },
    melody: {
      inst: 'flute', range: [67, 91], density: 0.6, legato: true, ornament: 0.3,
      double: { inst: 'celesta', interval: 12, on: 'late' },
      tune: {
        octave: 1,
        // "A D | D'... C# B | A... F# E | F# D'... C# B | B.. A G... | G E'... D C# | C#.. B A... |" —
        // an octave leap and a slow fall home, twice, then the climb to E.
        A: ["5,:1 1:1 1':4 7:1 6:1", '5:4 3:2 2:2', "3:2 1':4 7:1 6:1", '6:3 5:1 4:4', "4:2 2':4 1':1 7:1", '7:3 6:1 5:4', '4:2 6:2 5:2 3:2', '2:2 1:6'],
        B: ["1':3 7:1 6:2 4:2", "2':3 1':1 7:2 5:2", '7:3 6:1 5:2 3:2', '2:2 3:2 6:4', "1':3 7:1 6:2 5:2", '5:3 6:1 7:4', "6:2 1':2 2':4", '5:8'],
        Aend: ['4:2 6:2 5:2 2:2', '1:8'],
      },
    },
    counter: { inst: 'cello', range: [48, 64], on: 'always', style: 'moving' },
    accomp: { inst: 'harp', pattern: 'harpRoll', range: [55, 74], voices: 4, vel: 0.7 },
    bass: { inst: 'softBass', pattern: 'root', range: [38, 50], vel: 0.7 },
    pad: { inst: 'pad', range: [54, 71], voices: 4, vel: 0.45, on: 'B' },
    mix: {
      melody: { gain: 0.84, pan: 0.05, send: 0.4 },
      double: { gain: 0.22, pan: 0.3, send: 0.5 },
      counter: { gain: 0.52, pan: -0.32, send: 0.4 },
      accomp: { gain: 0.74, pan: 0.3, send: 0.38 },
      bass: { gain: 0.6, pan: 0, send: 0.08 },
      pad: { gain: 0.36, pan: 0, send: 0.55 },
    },
    rest: [0, 0],
    gain: 0.82,
  },
};

/** Mood hints the festival system broadcasts (`festival:music`). */
export interface FestivalHint {
  id: string;
  tempo: number;
  mode: string;
  timbre: string;
}

/**
 * Each festival gets its own arrangement of the Lantern Jig family, built from the festival's mood
 * hint: the Blossom Parade is a bright lydian harp-and-whistle jig on the same tune, Tide Lantern
 * Night a slow mixolydian barcarolle for bells and harp, the Harvest Fair a driving dorian fiddle
 * reel and Starfall a music-box carol with sleigh-bell tambourine. Unknown hints fall back to the jig.
 */
export function festivalTheme(h: FestivalHint): ThemeDef {
  const base = THEMES.festival!;
  const id = `festival-${h.id}`;
  const bpm = Math.max(60, Math.min(140, h.tempo || base.bpm));
  switch (h.timbre) {
    case 'pluck':
      return {
        ...base, id, title: 'Ribbon Parade', blurb: 'The Blossom Parade', bpm, key: 67, mode: 'lydian',
        prog: { intro: ['I', 'II'], A: ['I', 'I', 'II', 'V', 'I', 'I', 'II V', 'I'], B: ['vi', 'II', 'I', 'V', 'vi', 'II', 'II V', 'I'] },
        melody: { ...base.melody!, inst: 'harp', range: [67, 91], density: 0.85, ornament: 0.2, double: { inst: 'whistle', interval: 12, on: 'repeat' } },
        accomp: { inst: 'kalimba', pattern: 'oompah', range: [60, 76], voices: 3, vel: 0.55 },
        accomp2: { inst: 'guitar', pattern: 'oompah', range: [50, 64], voices: 4, vel: 0.45, on: 'repeat' },
        mix: { ...base.mix, melody: { gain: 0.9, pan: 0.1, send: 0.3 }, double: { gain: 0.26, pan: -0.25, send: 0.3 } },
        gain: 0.9,
      };
    case 'bell':
      if (h.mode === 'mixolydian') {
        return {
          ...base, id, title: 'Lanterns on the Tide', blurb: 'Tide Lantern Night', bpm: Math.min(bpm, 84), key: 64, mode: 'mixolydian',
          form: ['intro', 'A', 'B', 'A', 'outro'],
          prog: { intro: ['I', 'bVII'], A: ['I', 'bVII', 'IV', 'I', 'vi', 'bVII', 'IV V', 'I'], B: ['IV', 'I', 'bVII', 'IV', 'ii', 'bVII', 'IV', 'V'], outro: ['bVII', 'I'] },
          melody: {
            inst: 'celesta', range: [72, 91], density: 0.45, ornament: 0.1, double: { inst: 'bell', interval: 0, on: 'repeat' },
            tune: {
              octave: 1,
              // A slow barcarolle in 6/8: "E.. G#. B | D.. C#. B | ..." — mixolydian D natural over the bVII.
              A: ['1:3 3:2 5:1', '7,:3 2:2 4:1', '6:3 4:2 1:1', '3:3 2:3', '6:3 5:2 3:1', '7:3 6:2 4:1', '6:1 4:1 1:1 5,:1 #7,:1 2:1', '1:6'],
              B: ['6:3 1\':2 6:1', '5:3 3:2 1:1', '4:3 2:2 7,:1', '1:3 4:3', '6:3 4:2 2:1', '2:3 4:2 7:1', '6:2 4:1 1:3', '5,:3 2:3'],
            },
          },
          accomp: { inst: 'harp', pattern: 'waltzArp', range: [55, 72], voices: 4, vel: 0.5 },
          accomp2: undefined,
          bass: { inst: 'softBass', pattern: 'jig', range: [38, 50], vel: 0.55 },
          pad: { inst: 'pad', range: [52, 69], voices: 3, vel: 0.36, on: 'always' },
          perc: { pattern: 'light', on: 'repeat', vel: 0.45 },
          mix: { melody: { gain: 0.82, pan: 0.1, send: 0.5 }, double: { gain: 0.22, pan: -0.3, send: 0.6 }, accomp: { gain: 0.6, pan: -0.25, send: 0.4 }, bass: { gain: 0.48, pan: 0, send: 0.1 }, pad: { gain: 0.42, pan: 0, send: 0.55 }, perc: { gain: 0.5, pan: 0.2, send: 0.2 } },
          rest: [0, 0],
          gain: 0.85,
        };
      }
      return {
        ...base, id, title: 'Starfall Carol', blurb: 'The Starfall Vigil', bpm: Math.min(bpm, 96), key: 65, mode: 'major', meter: '4/4',
        form: ['intro', 'A', 'B', 'A', 'outro'],
        prog: { intro: ['I', 'IV'], A: ['I', 'vi', 'IV', 'V', 'I', 'vi', 'ii V', 'I'], B: ['IV', 'I', 'ii', 'V', 'IV', 'iii vi', 'ii', 'V'], outro: ['IV', 'I'] },
        melody: {
          inst: 'musicBox', range: [72, 93], density: 0.55, ornament: 0.15, double: { inst: 'bell', interval: -12, on: 'repeat' },
          tune: {
            octave: 1,
            // A carol: "C. D C A. F | D. E F. A | Bb. A G. F | E.. G.. |"
            A: ['5:3 6:1 5:2 3:2', '6:3 7:1 1\':2 3:2', '4:3 3:1 2:2 1:2', '7,:4 2:4', '5:3 6:1 5:2 3:2', '6:3 7:1 1\':2 6:2', '4:2 6:2 5:2 2:2', '1:8'],
            B: ['6:4 1\':2 6:2', '5:4 3:2 1:2', '2:3 3:1 4:2 6:2', '5:6 r:2', '4:3 5:1 6:2 1\':2', '7:2 5:2 1\':2 6:2', '6:3 5:1 4:2 2:2', '5:6 r:2'],
          },
        },
        accomp: { inst: 'celesta', pattern: 'arp8', range: [62, 79], voices: 3, vel: 0.42 },
        accomp2: undefined,
        bass: { inst: 'softBass', pattern: 'rootFifth', range: [38, 50], vel: 0.55 },
        pad: { inst: 'pad', range: [52, 69], voices: 4, vel: 0.4, on: 'always' },
        perc: { pattern: 'sleigh', on: 'always', vel: 0.5 },
        mix: { melody: { gain: 0.85, pan: 0.1, send: 0.45 }, double: { gain: 0.25, pan: -0.3, send: 0.5 }, accomp: { gain: 0.52, pan: -0.22, send: 0.45 }, bass: { gain: 0.48, pan: 0, send: 0.1 }, pad: { gain: 0.42, pan: 0, send: 0.55 }, perc: { gain: 0.5, pan: 0.2, send: 0.2 } },
        rest: [0, 0],
        gain: 0.7,
      };
    case 'fiddle':
      return {
        ...base, id, title: 'Harvest Reel', blurb: 'The Harvest Fair', bpm: Math.max(bpm, 118), key: 62, mode: 'dorian',
        prog: { intro: ['i', 'bVII'], A: ['i', 'i', 'IV', 'v', 'i', 'i', 'IV v', 'i'], B: ['bVII', 'bVII', 'i', 'i', 'bVII', 'bVII', 'IV v', 'i'] },
        melody: {
          ...base.melody!,
          tune: {
            ...base.melody!.tune!,
            B: ['4:1 7,:1 2:1 4:2 2:1', "7:1 1':1 7:1 4:2 2:1", '5:1 3:1 1:1 5,:2 1:1', "3:1 5:1 1':1 5:1 3:1 2:1", '4:1 7,:1 2:1 4:2 2:1', "7:1 1':1 7:1 4:2 2:1", '4:1 6:1 4:1 5:1 7,:1 2:1', '1:3 r:3'],
          },
        },
      };
    default:
      return { ...base, id, bpm };
  }
}

/**
 * The four festival arrangements are registered up front (hints mirror src/data/festivals.ts), so
 * `?demo=audio&theme=festival-harvest`, cutscene cues and offline renders can reach them before the
 * festival system has broadcast its hint; the live hint re-registers the same id when it arrives.
 */
export const FESTIVAL_HINTS: FestivalHint[] = [
  { id: 'blossom', tempo: 112, mode: 'lydian', timbre: 'pluck' },
  { id: 'tide', tempo: 76, mode: 'mixolydian', timbre: 'bell' },
  { id: 'harvest', tempo: 124, mode: 'dorian', timbre: 'fiddle' },
  { id: 'starfall', tempo: 92, mode: 'major', timbre: 'bell' },
];
for (const h of FESTIVAL_HINTS) {
  const def = festivalTheme(h);
  THEMES[def.id] = def;
}
