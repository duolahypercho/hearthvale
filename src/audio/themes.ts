/**
 * Hearthvale's score: one ThemeDef per musical situation. All original material. Every song has a
 * hand-written tune (scale degrees + rhythm, see `Tune` in composer.ts) that is restated literally
 * whenever its A section comes round; the composer arranges it (harmony, figuration, fills, form).
 *
 * Tune notation per bar: `<degree>:<eighths>` (6/8: triplet eighths), `'`/`,` = octave up/down,
 * `b`/`#` accidentals, `r` = rest. Degree 1 = key + 12 × octave.
 */
import type { ThemeDef } from './composer';
import { SONGBOOK } from './songbook';

/** Song form: the tune twice, its answer, the tune, a bridge (C) in a new harmonic area, the tune home. */
const FORM_SONG: ThemeDef['form'] = ['intro', 'A', 'A', 'B', 'A', 'C', 'A', 'outro'];

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
      // Bridge: the relative minor, a borrowed bVII (Eb) glow, a suspended half-cadence home.
      C: ['vi', 'iii7', 'IVmaj7', 'I', 'ii7', 'iii7', 'bVII', 'V7sus4 V'],
      outro: ['IVmaj7', 'Iadd9'],
    },
    melody: {
      inst: 'flute', range: [67, 89], density: 0.55, legato: true, ornament: 0.3, cInst: 'clarinet',
      tune: {
        octave: 1,
        // "F.. G A C | D.. C Bb A | A C D.. C | Bb A G.. (C D) | ..." — a dotted walk up and a sigh down.
        A: ['1:3 2:1 3:2 5:2', '6:3 5:1 4:2 3:2', '3:2 5:2 6:3 5:1', "4:1 3:1 2:4 5,:1 6,:1", '1:3 2:1 3:2 5:2', "1':3 7:1 6:2 5:2", '6:2 4:2 2:2 7,:2', '1:6 r:2'],
        B: ['6:4 5:2 4:2', '5:4 4:2 3:2', '3:4 5:2 3:2', '2:2 3:2 6,:4', "4:2 6:2 1':3 7:1", "1':2 7:2 5:4", '6:3 5:1 4:2 3:2', '2:6 r:2'],
        // The clarinet takes the tune down into its warm register: "D. E F A | C.. A G | Bb. A Bb D | C... |".
        C: ['6,:3 7,:1 1:2 3:2', '5:4 3:2 2:2', '4:3 3:1 4:2 6:2', '5:6 r:2', '6:3 5:1 4:2 2:2', '3:3 2:1 3:2 5:2', 'b7:4 4:2 2:2', '1:4 7,:4'],
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
    rest: [6, 14],
    gain: 0.84,
    sheen: 2.5,
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
      C: ['vi7', 'iii7', 'IVmaj7', 'Imaj7', 'ii7', 'II7', 'IV', 'V7sus4 V'],
      outro: ['IV', 'Imaj7'],
      Aend: ['ii7 V7', 'I'],
    },
    melody: {
      inst: 'marimba', range: [62, 86], density: 0.8, ornament: 0.12, cInst: 'guitar', double: { inst: 'glock', interval: 12, on: 'repeat' },
      tune: {
        octave: 0,
        // "B D . D E D B | C E . E G E D | ..." — the hiccup rest is the hook.
        A: ['3:1 5:1 r:1 5:1 6:1 5:1 3:2', "4:1 6:1 r:1 6:1 1':1 6:1 5:2", '3:1 5:1 r:1 5:1 6:1 5:1 3:1 2:1', '1:1 2:1 3:2 6,:1 1:1 r:2', '5:1 6:1 5:1 3:1 2:1 3:1 5:2', "6:3 1':1 6:2 5:2", "4:1 3:1 4:1 6:1 1':2 6:1 5:1", '2:3 7,:1 5,:2 r:2'],
        Aend: ['4:1 3:1 4:1 6:1 5:2 4:1 2:1', '1:3 5,:1 1:2 r:2'],
        B: ["1':4 6:2 5:2", "2':4 7:2 6:2", "3':4 2':2 1':2", "6:2 7:2 1':4", "1':3 7:1 6:2 1':2", '7:4 r:2 5:1 6:1', 'b7:3 6:1 4:2 2:2', '5:6 r:2'],
        // The nylon guitar's turn: long, high, a secondary dominant (A7) lifting into the last A.
        C: ["3':3 2':1 1':2 6:2", "5:4 7:2 2':2", "1':3 7:1 6:2 4:2", '3:6 r:2', "6:2 1':2 2':3 1':1", '6:3 #4:1 2:4', "1:2 4:2 6:2 1':2", "1':4 7:2 r:2"],
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
      double: { gain: 0.2, pan: -0.2, send: 0.35 },
      counter: { gain: 0.46, pan: -0.35, send: 0.35 },
      accomp: { gain: 0.7, pan: -0.25, send: 0.22 },
      accomp2: { gain: 0.42, pan: 0.35, send: 0.25 },
      bass: { gain: 0.7, pan: 0, send: 0.05 },
      perc: { gain: 0.4, pan: -0.15, send: 0.12 },
    },
    rest: [6, 14],
    gain: 1.0,
    sheen: 2.5,
  },

  /** Fall — a clarinet waltz of falling thirds over harp, cello counter-line, minor with a warm major V. */
  fall: {
    id: 'fall',
    title: 'Amber Waltz',
    blurb: 'Autumn on the farm',
    bpm: 116,
    meter: '3/4',
    key: 62, // D
    mode: 'minor',
    form: FORM_SONG,
    prog: {
      intro: ['i', 'bVI'],
      A: ['i', 'bVI', 'bIII', 'bVII', 'iv', 'i', 'iv V', 'i'],
      B: ['bIII', 'bVII', 'iv', 'i', 'bVImaj7', 'bIII', 'iim7b5', 'V'],
      // Sixteen-bar bridge in the relative major (F), the cello singing the tune low.
      C: ['bIII', 'bVII', 'bVI', 'bIII', 'iv', 'bVII', 'bIII', 'V', 'bVI', 'bIII', 'iv', 'i', 'bVI', 'iv', 'iim7b5', 'V'],
      outro: ['iv', 'i'],
    },
    melody: {
      inst: 'clarinet', range: [62, 84], density: 0.45, legato: true, ornament: 0.25, cInst: 'cello',
      tune: {
        octave: 1,
        // "A.. Bb A | Bb.. A G | F.. E D | C.. D E | G.. A Bb | A. G F. | G Bb A C# | D" — a descending sequence that climbs home.
        A: ['5:4 6:1 5:1', '6:4 5:1 4:1', '3:4 2:1 1:1', '7,:4 1:1 2:1', '4:4 5:1 6:1', '5:3 4:1 3:2', '4:2 6:1 5:1 #7,:2', '1:6'],
        B: ["7:3 1':1 7:1 5:1", '4:3 5:1 4:1 2:1', "6:3 1':1 6:1 4:1", '5:4 r:2', "1':3 7:1 6:1 5:1", '7:3 6:1 5:1 3:1', '4:2 6:2 2:2', '2:4 #7,:2'],
        C: ['3,:4 5,:1 7,:1', '2:3 1:1 7,:2', '1:4 6,:2', '5,:6', '4,:3 6,:1 1:2', '2:4 7,:2', '3:2 5:2 3:2', '#7,:4 r:2', '6,:3 1:1 3:2', '5:4 3:2', '4:4 6,:2', '1:6', '6,:2 1:2 3:2', '4:3 3:1 1:2', '2:3 4:1 6,:2', '5,:2 #7,:2 2:2'],
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
    rest: [6, 14],
    gain: 0.92,
    // Clarinet in its clarion register + harp: take a little edge off (2–5 kHz sat at ~26 %).
    sheen: -2.5,
    // …and a broad 3.4 kHz dip (the mix still read 25 % presence with the ambience on top).
    eq: { cut: { f: 3400, db: -2, q: 0.7 } },
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
      C: ['IVmaj7', 'iii7', 'vi7', 'Imaj7', 'IV', 'iv6', 'ii7', 'V7sus4'],
      outro: ['iv6', 'Imaj7'],
    },
    melody: {
      inst: 'musicBox', range: [76, 93], density: 0.35, ornament: 0.15, bInst: 'celesta', cInst: 'flute', double: { inst: 'glock', interval: 12, on: 'repeat' },
      tune: {
        octave: 1,
        // "B. C# B G# | D#. E D# B | E. F# E C# | C# B G# | ... | C. B A G | G# F# E" — rising thirds, then the minor iv.
        A: ['5:3 6:1 5:1 3:1', "7:3 1':1 7:1 5:1", "1':3 2':1 1':1 6:1", '6:2 5:2 3:2', '5:3 6:1 5:1 3:1', "6:3 1':1 6:1 4:1", 'b6:3 5:1 4:1 b3:1', '3:1 2:1 1:4'],
        B: ["1':4 7:1 6:1", '7:4 6:1 5:1', '6:4 5:1 4:1', "3:2 5:2 1':2", "2':4 1':1 6:1", "7:3 1':1 2':2", "1':3 6:1 4:2", '5:4 r:2'],
        // A flute bridge over the minor-iv colour: "C#. A | B. G# B | E. C# | B | A. C# E | C. E | F#. E C# | B. A |".
        C: ['6:4 4:2', '5:3 3:1 5:2', "1':4 6:2", '5:6', "4:3 6:1 1':2", "b6:4 1':2", "2':3 1':1 6:2", '5:4 4:2'],
      },
    },
    counter: { inst: 'bell', range: [64, 76], on: 'late' },
    accomp: { inst: 'celesta', pattern: 'musicBox', range: [64, 81], voices: 3, vel: 0.42 },
    perc: { pattern: 'sleigh', on: 'always', vel: 0.4 },
    bass: { inst: 'softBass', pattern: 'root', range: [40, 52], vel: 0.55 },
    // Strings only in the contrast sections, and ~4 dB lower: the music box has to sparkle, not sit in a wall.
    pad: { inst: 'pad', range: [57, 71], voices: 3, vel: 0.45, on: 'B' },
    mix: {
      melody: { gain: 0.85, pan: 0.1, send: 0.45 },
      double: { gain: 0.17, pan: -0.25, send: 0.55 },
      counter: { gain: 0.42, pan: -0.35, send: 0.55 },
      accomp: { gain: 0.52, pan: -0.22, send: 0.45 },
      bass: { gain: 0.36, pan: 0, send: 0.1 },
      pad: { gain: 0.19, pan: 0, send: 0.55 },
      perc: { gain: 0.4, pan: 0.3, send: 0.35 },
    },
    rest: [8, 15],
    gain: 0.93,
    sheen: 4.5,
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
      // Bridge: round the circle of fifths on secondary dominants (E7 → A7 → D7).
      C: ['vi', 'II7', 'ii7', 'V7', 'iii7', 'VI7', 'ii7', 'V7'],
      outro: ['ii7 V7', 'I6'],
    },
    melody: {
      inst: 'ocarina', range: [67, 86], density: 0.75, ornament: 0.2, bInst: 'clarinet', cInst: 'flute', double: { inst: 'glock', interval: 12, on: 'late' },
      tune: {
        octave: 0,
        // "B D G D B'. A G | E D B D E. D B | C E G E A. G E | F# G A G F#. |" — up the arpeggio and back.
        A: ["3:1 5:1 1':1 5:1 3':2 2':1 1':1", '6:1 5:1 3:1 5:1 6:2 5:1 3:1', "4:1 6:1 1':1 6:1 2':2 1':1 6:1", "7:1 1':1 2':1 1':1 7:2 r:2", "3:1 5:1 1':1 5:1 3':2 2':1 1':1", "1':1 2':1 3':1 2':1 1':2 6:2", '6:1 5:1 4:1 6:1 5:1 4:1 2:2', '1:2 r:1 5,:1 1:2 r:2'],
        B: ["6:2 4:1 6:1 1':2 6:2", "5:2 3:1 5:1 1':2 5:2", "4:1 6:1 1':1 2':1 1':2 6:2", '7:3 6:1 5:4', "6:2 4:1 6:1 1':2 6:2", "2':2 7:2 1':2 6:2", "4:2 6:2 1':2 6:1 4:1", "2':3 1':1 7:2 5:2"],
        C: ["6:2 1':2 3':3 2':1", "1':2 6:2 #4:2 2:2", "4:3 6:1 1':2 6:2", "5:2 7:2 2':4", "2':3 1':1 7:2 5:2", "6:2 #1':2 3':3 2':1", "1':3 6:1 4:2 2:2", '7,:2 2:2 4:2 5:2'],
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
      double: { gain: 0.17, pan: -0.18, send: 0.35 },
      counter: { gain: 0.46, pan: 0.35, send: 0.3 },
      accomp: { gain: 0.65, pan: -0.3, send: 0.25 },
      accomp2: { gain: 0.42, pan: 0.25, send: 0.35 },
      bass: { gain: 0.7, pan: 0, send: 0.06 },
      perc: { gain: 0.4, pan: 0.25, send: 0.15 },
    },
    rest: [5, 10],
    gain: 0.95,
    sheen: 4.5,
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
      // Bridge: a borrowed bVII (G major) sunset before the tune comes home.
      C: ['IVmaj7', 'iii7', 'vi7', 'Imaj7', 'bVII', 'IV', 'ii7', 'V7sus4 V'],
      outro: ['IVmaj7', 'Imaj7'],
      Aend: ['ii7 V7', 'I6'],
    },
    melody: {
      inst: 'steelPan', range: [66, 88], density: 0.55, ornament: 0.1, cInst: 'marimba', double: { inst: 'glock', interval: 12, on: 'repeat' },
      tune: {
        octave: 0,
        // "E.. F#.. E | D.. C#.. A | C#.. E.. G# A | A G# F#.. E |" — 3+3+2, a neighbour-note hook that
        // climbs the arpeggio and sighs back down by step; B is a falling sequence (A G# F# / G# F# E / ...).
        A: ['5:3 6:3 5:2', '4:3 3:3 1:2', "3:3 5:3 7:1 1':1", "1':2 7:1 6:3 5:2", '2:1 3:1 4:1 6:1 4:2 2:2', '5:3 4:2 3:1 2:2', '3:2 5:2 6:2 5:1 3:1', '4:2 2:2 2:1 1:1 7,:2'],
        B: ["1':4 7:2 6:2", '7:4 6:2 5:2', '6:4 5:2 4:2', '3:3 2:1 3:2 5:2', "6:1 1':1 2':1 1':1 6:2 4:2", "7:1 2':1 3':1 2':1 7:2 5:2", "1':3 7:1 6:2 5:2", '2:4 r:4'],
        C: ['6:3 4:3 3:2', '5:3 3:3 2:2', "1':3 6:3 5:2", '3:6 r:2', "b7:3 2':3 4':2", "1':3 6:3 4:2", '2:3 4:3 6:2', '5:4 7,:2 r:2'],
        Aend: ['4:2 2:2 5:2 4:1 2:1', '1:3 3:3 1:2'],
        pickup: '3:1 4:1',
      },
    },
    counter: { inst: 'marimba', range: [60, 74], on: 'late' },
    accomp: { inst: 'ukulele', pattern: 'strum', range: [60, 72], voices: 4, vel: 0.5 },
    bass: { inst: 'upright', pattern: 'tresillo', range: [36, 50], vel: 0.82 },
    perc: { pattern: 'island', on: 'always', vel: 0.55 },
    mix: {
      melody: { gain: 0.82, pan: 0.1, send: 0.32 },
      double: { gain: 0.16, pan: -0.25, send: 0.4 },
      counter: { gain: 0.42, pan: 0.35, send: 0.3 },
      accomp: { gain: 0.7, pan: -0.28, send: 0.22 },
      bass: { gain: 0.7, pan: 0, send: 0.05 },
      perc: { gain: 0.6, pan: -0.12, send: 0.15 },
    },
    rest: [5, 12],
    gain: 1.3,
    sheen: 4.5,
  },

  /** The mine (earth floors) — a drone with glass bells that keep returning to one small figure, over
   * a tuned-drip kalimba ostinato (the mine's hook, in the 400–1000 Hz range small speakers carry). */
  mine: {
    // Cave reverb already spreads the mine tunes (L/R correlation ~0.4): no extra side lift.
    width: 0,
    id: 'mine',
    title: 'Under Stone',
    blurb: 'The mines',
    bpm: 52,
    meter: '4/4',
    key: 57, // A
    mode: 'phrygian',
    form: ['A'],
    // A: the phrygian half-step sigh (A Bb C … E) over i–bII; B opens into F major (bVI) and climbs.
    prog: { A: ['i', 'i', 'bII', 'i', 'iv', 'iv', 'bII', 'v'], B: ['bVI', 'bVI', 'iv', 'i', 'bVI', 'bII', 'iv', 'v'], Aend: ['bII', 'i'] },
    ambient: {
      inst: 'glass', range: [69, 88], noteChance: 0.45, bars: 16, motif: [0, 1, -1, -3],
      ostinato: { inst: 'kalimba', range: [67, 84], pattern: [[0, 1], [4, 0.5], [2, 0.5], [3, 1], [1, 1]], vel: 0.5 },
      tune: {
        octave: 1,
        // "r A C D | E… | D C Bb. | A… | r D E F | A' G F | E. D Bb. | G E |"
        A: ['r:2 1:2 3:2 4:2', '5:6 r:2', '4:2 3:2 2:4', '1:6 r:2', 'r:2 4:2 5:2 6:2', "1':4 7:2 6:2", '5:3 4:1 2:4', '7:4 5:4'],
        // "C' A… | F E F | A… | E C | C' Bb A | D' C' Bb | A F D | E… |"
        B: ["r:2 3':2 1':4", '6:4 5:2 6:2', "1':6 r:2", '5:4 3:4', "3':3 2':1 1':4", "4':3 3':1 2':4", "1':2 6:2 4:4", '5:6 r:2'],
        Aend: ['4:2 3:2 2:4', '1:8'],
      },
    },
    counter: { inst: 'cello', range: [45, 60], on: 'always' },
    bass: { inst: 'drone', pattern: 'pedal', range: [33, 45], vel: 0.6 },
    pad: { inst: 'pad', range: [52, 67], voices: 3, vel: 0.35, on: 'always' },
    mix: {
      double: { gain: 0.5, pan: 0, send: 0.85 },
      accomp: { gain: 0.5, pan: 0.4, send: 0.6 },
      melody: { gain: 0.62, pan: 0.2, send: 0.7 },
      counter: { gain: 0.38, pan: -0.3, send: 0.6 },
      bass: { gain: 0.55, pan: 0, send: 0.2 },
      pad: { gain: 0.42, pan: 0, send: 0.6 },
    },
    // Tone: no sub rumble under the drone, 150–250 Hz mud cut (laptop speakers heard only boom).
    eq: { hp: 60, cut: { f: 200, db: -3, q: 0.8 } },
    rest: [4, 12],
    gain: 1.1,
  },

  /** Deeper: the frozen floors — celesta and bell figures over a thin, high string haze. */
  'mine-ice': {
    width: 0,
    id: 'mine-ice',
    title: 'Glass Caverns',
    blurb: 'The frozen floors',
    bpm: 58,
    meter: '4/4',
    key: 64, // E
    mode: 'lydian',
    form: ['A'],
    // A: the lydian I–II shimmer with the raised 4th (A#) sung out; B turns to the relative minor and
    // hands the tune to the bells.
    prog: { A: ['I', 'II', 'Imaj7', 'II', 'vi', 'II', 'IVmaj7', 'II'], B: ['vi', 'iii', 'II', 'Imaj7', 'vi', 'iii', 'IVmaj7', 'II'], Aend: ['II', 'Iadd9'] },
    ambient: {
      inst: 'celesta', range: [76, 93], noteChance: 0.5, bars: 16, motif: [0, 2, 1, -2],
      ostinato: { inst: 'musicBox', range: [74, 91], pattern: [[0, 0.5], [2, 0.5], [4, 1], [3, 0.5], [1, 0.5], [2, 1]], vel: 0.5 },
      tune: {
        octave: 1,
        // "G# A# B… | C#. B A#… | B C# D#… | E F#… | G#'. F#' E' D# | C#… | E' D# C# B | C# A# |"
        A: ['3:2 4:2 5:4', '6:3 5:1 4:4', '5:2 6:2 7:4', "1':2 2':4 r:2", "3':3 2':1 1':2 7:2", '6:6 r:2', "1':2 7:2 6:2 5:2", '6:4 4:4'],
        // bells: "C#… B C# | B… C# | C#. B A#… | G#… | G# A# B C# | D#… C# | C# D# E' | F#'… |"
        B: ['6:4 5:2 6:2', '5:6 6:2', '6:3 5:1 4:4', '3:6 r:2', '3:2 4:2 5:2 6:2', '7:6 6:2', "6:4 7:2 1':2", "2':8"],
        Aend: ['6:2 4:2 2:4', '1:6 r:2'],
        bInst: 'bell', bRange: [64, 81],
      },
    },
    counter: { inst: 'bell', range: [64, 79], on: 'always' },
    bass: { inst: 'drone', pattern: 'pedal', range: [40, 52], vel: 0.45 },
    pad: { inst: 'pad', range: [60, 76], voices: 3, vel: 0.32, on: 'always' },
    mix: {
      double: { gain: 0.5, pan: 0, send: 0.85 },
      accomp: { gain: 0.5, pan: 0.4, send: 0.6 },
      melody: { gain: 0.6, pan: 0.25, send: 0.75 },
      counter: { gain: 0.34, pan: -0.3, send: 0.7 },
      bass: { gain: 0.48, pan: 0, send: 0.2 },
      pad: { gain: 0.42, pan: 0, send: 0.65 },
    },
    // Tone: no sub rumble under the drone, 150–250 Hz mud cut (laptop speakers heard only boom).
    eq: { hp: 60, cut: { f: 200, db: -3, q: 0.8 } },
    rest: [4, 12],
    gain: 1.1,
  },

  /** Deepest: the ember floors — low cello groans, tritone bells and a heavier drone. */
  'mine-lava': {
    width: 0,
    id: 'mine-lava',
    title: 'Ember Deep',
    blurb: 'The ember floors',
    bpm: 48,
    meter: '4/4',
    key: 52, // E
    mode: 'phrygian',
    form: ['A'],
    // A: a slow lament on the half step (E F … F), a tritone (A–D#) hanging over the diminished
    // turnaround; B is the cello's: iv–bVI–bII, then a real dominant (V) to fall home on.
    prog: { A: ['i', 'bII', 'i', 'bII', 'iv', 'bII', 'i', 'viidim'], B: ['iv', 'iv', 'bVI', 'bII', 'iv', 'bVI', 'bII', 'V'], Aend: ['bII', 'i'] },
    ambient: {
      inst: 'bell', range: [64, 81], noteChance: 0.45, bars: 16, motif: [0, -1, 1, -2],
      ostinato: { inst: 'marimba', range: [66, 83], pattern: [[0, 1.5], [1, 0.5], [0, 1], [-2, 1]], vel: 0.55 },
      tune: {
        octave: 1,
        // "B. A G E | F… | B A G… | F A C | B C E' | D C A | A G E | A D# |"
        A: ['5:3 4:1 3:2 1:2', '2:6 r:2', '5:3 4:1 3:4', '2:2 4:2 6:4', "5:2 6:2 1':4", '7:3 6:1 4:4', '4:2 3:2 1:4', '4:4 #7:4'],
        // cello: "E D C | B… | C G E | A F | E D C | D E C | C A | D# B |"
        B: ["1':4 7:2 6:2", '5:6 r:2', '6:3 3:1 1:4', '4:4 2:4', "1':2 7:2 6:4", "7:2 1':2 6:4", '6:4 4:4', '#7:4 5:4'],
        Aend: ['2:2 4:2 3:4', '1:8'],
        bInst: 'cello', bRange: [52, 70],
      },
    },
    // Cello groans a fifth higher than round 1 (40–55 put its fundamental in the 80–190 Hz mud).
    counter: { inst: 'cello', range: [45, 60], on: 'always' },
    bass: { inst: 'drone', pattern: 'pedal', range: [35, 47], vel: 0.45 },
    pad: { inst: 'pad', range: [52, 67], voices: 3, vel: 0.34, on: 'always' },
    mix: {
      double: { gain: 0.5, pan: 0, send: 0.85 },
      accomp: { gain: 0.6, pan: 0.45, send: 0.6 },
      melody: { gain: 0.62, pan: 0.2, send: 0.7 },
      counter: { gain: 0.4, pan: -0.35, send: 0.6 },
      bass: { gain: 0.48, pan: 0, send: 0.2 },
      pad: { gain: 0.4, pan: 0, send: 0.6 },
    },
    // Tone: no sub rumble under the drone, a deeper 150–250 Hz mud cut than the other floors
    // (the lava floor still measured 41 % bass with the ice / earth fixes).
    eq: { hp: 70, cut: { f: 190, db: -4.5, q: 0.7 } },
    rest: [4, 12],
    gain: 1.12,
  },

  /** Night — a felt-piano lullaby (rolling broken chords) with a celesta tune under the crickets. */
  night: {
    id: 'night',
    title: 'Lamplight',
    blurb: 'Night in the valley',
    bpm: 66,
    meter: '4/4',
    key: 61, // Db
    mode: 'major',
    breaks: false,
    form: ['intro', 'A', 'B', 'A', 'C', 'A', 'outro'],
    prog: {
      intro: ['Imaj7', 'IVmaj7'],
      A: ['Imaj7', 'iii7', 'IVmaj7', 'iv6', 'Imaj7', 'vi7', 'ii7', 'V7sus4'],
      B: ['vi7', 'iii7', 'IVmaj7', 'Imaj7', 'ii7', 'iii7', 'IVmaj7', 'V7sus4'],
      C: ['IVmaj7', 'iii7', 'vi7', 'Imaj7', 'ii7', 'bVIImaj7', 'IVmaj7', 'V7sus4'],
      outro: ['IVmaj7', 'Imaj7'],
      Aend: ['ii7 V7', 'Imaj7'],
    },
    melody: {
      inst: 'celesta', range: [68, 90], density: 0.3, ornament: 0,
      tune: {
        octave: 1,
        // "F. Eb Db Ab | C Eb F.. | Bb. Ab Gb F | A(bb).. Ab Gb |" — a lullaby that dips and climbs back,
        // borrows the minor iv, then rises to the high Db and falls home by step.
        A: ['3:3 2:1 1:2 5,:2', '7,:2 2:2 3:4', '6:3 5:1 4:2 3:2', 'b6:4 5:2 4:2', '3:3 2:1 1:2 3:1 5:1', "1':3 7:1 6:2 5:2", '4:3 3:1 2:4', '2:2 1:2 2:2 4:2'],
        B: ["5:4 6:2 1':2", "7:4 1':2 2':2", "3':4 2':2 1':2", '7:4 5:4', '6:3 5:1 4:4', '5:3 3:1 5:4', "6:2 1':2 3':4", "2':4 1':2 6:1 5:1"],
        C: ["6:4 1':2 3':2", "2':4 7:2 5:2", '6:3 5:1 3:4', '5:6 r:2', "4:3 6:1 1':4", 'b7:4 6:2 4:2', '3:4 1:2 6,:2', '2:4 1:4'],
        Aend: ['4:3 3:1 2:2 7,:2', '1:8'],
      },
    },
    accomp: { inst: 'piano', pattern: 'arpUp', range: [49, 70], voices: 4, vel: 0.5 },
    bass: { inst: 'softBass', pattern: 'root', range: [37, 49], vel: 0.5 },
    pad: { inst: 'pad', range: [56, 72], voices: 3, vel: 0.32, on: 'always' },
    mix: {
      melody: { gain: 0.62, pan: 0.18, send: 0.55 },
      accomp: { gain: 0.72, pan: -0.1, send: 0.4 },
      bass: { gain: 0.4, pan: 0, send: 0.1 },
      pad: { gain: 0.38, pan: 0, send: 0.6 },
    },
    rest: [6, 14],
    gain: 0.9,
  },

  /** Rainy day — a felt-piano tune sighing over lo-fi electric-piano comping, clarinet counter-line, brushed soft kit. */
  rain: {
    id: 'rain',
    title: 'Window Weather',
    blurb: 'A rainy day',
    bpm: 76,
    meter: '4/4',
    key: 63, // Eb
    mode: 'major',
    swing: 0.6,
    form: ['intro', 'A', 'B', 'A', 'C', 'A', 'outro'],
    prog: {
      intro: ['vi7', 'IVmaj7'],
      A: ['vi7', 'IVmaj7', 'Imaj7', 'V7sus4', 'vi7', 'ii7', 'IVmaj7', 'V7sus4 V'],
      B: ['IVmaj7', 'V', 'iii7', 'vi7', 'ii7', 'V', 'IVmaj7', 'iv6'],
      C: ['IVmaj7', 'iii7', 'vi7', 'Imaj7', 'ii7', 'IVmaj7', 'iv6', 'V7sus4 V'],
      outro: ['IVmaj7', 'vi7'],
      Aend: ['ii7 V7', 'Imaj7'],
    },
    melody: {
      inst: 'piano', range: [68, 88], density: 0.35, ornament: 0, cInst: 'vibes',
      tune: {
        octave: 1,
        // ". G Bb. G F Eb | . Eb G. F Eb C | . Eb G. Bb D C | Bb Ab F... |" — every phrase starts on the
        // "and", sighs down by step, and the third bar climbs the Ebmaj7 before settling on the sus.
        A: ['r:1 3:1 5:2 3:1 2:1 1:2', 'r:1 1:1 3:2 2:1 1:1 6,:2', 'r:1 1:1 3:2 5:1 7:1 6:2', '5:2 4:2 2:4', 'r:1 3:1 5:2 3:1 2:1 1:2', 'r:1 2:1 4:2 6:1 5:1 4:2', '3:3 2:1 1:2 6,:2', '2:4 7,:2 r:2'],
        Aend: ['6:2 4:2 5:2 2:2', '1:6 r:2'],
        B: ["1':4 7:2 6:2", '7:4 6:2 5:2', '5:4 3:2 2:2', '3:3 5:1 6:4', "6:2 1':2 2':2 1':2", '7:4 5:4', "1':3 6:1 3:4", 'b6:4 5:2 4:2'],
        C: ['r:1 6,:1 1:2 3:2 1:2', 'r:1 5,:1 7,:2 2:2 3:2', 'r:1 1:1 3:2 5:3 3:1', '3:2 2:2 1:4', "r:1 4:1 6:2 1':3 6:1", '6:2 3:2 1:2 6,:2', 'b6:3 4:1 2:4', '1:4 7,:2 r:2'],
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
    rest: [6, 14],
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
      C: ['iii7', 'VI7', 'ii7', 'V7', 'IVmaj7', 'iv6', 'Imaj7', 'V7sus4 V7'],
      outro: ['ii7 V7', 'Imaj7'],
    },
    melody: {
      inst: 'vibes', range: [62, 86], density: 0.6, ornament: 0.15, bInst: 'clarinet', cInst: 'flute',
      tune: {
        octave: 1,
        // "D F A. G F D. | F D B D G. F. | Eb G Bb. A G Eb. | C. Eb D C. |" — a lazy swing tune with a blue Db.
        A: ['3:1 5:1 7:2 6:1 5:1 3:2', '5:1 3:1 #1:1 3:1 6:2 5:2', "4:1 6:1 1':2 7:1 6:1 4:2", '2:2 4:1 3:1 2:2 r:2', '3:1 5:1 7:2 6:1 5:1 3:2', "1':1 6:1 4:1 6:1 b3:2 1:2", '3:2 5:2 3:1 #1:1 6,:2', '2:2 4:2 5:2 7,:2'],
        B: ["1':4 6:2 4:2", 'b6:4 5:2 4:2', '5:3 3:1 7:2 5:2', "#1':2 6:2 3:2 5:2", "4:3 6:1 1':2 6:2", '5:3 7,:1 2:2 4:2', '3:3 2:1 1:4', '5:4 r:4'],
        C: ["3:2 5:2 7:3 2':1", "3':2 #1':2 6:2 5:2", "4:3 6:1 1':2 6:2", '5:3 7,:1 2:2 4:2', "3':4 1':2 6:2", "b6:4 4:2 2':2", '7:3 5:1 3:4', '1:4 7,:2 r:2'],
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
      accomp: { gain: 0.47, pan: -0.15, send: 0.3 },
      bass: { gain: 0.62, pan: 0, send: 0.06 },
      // The brushed ride is the trio's shimmer — it sat ~25 dB under the band; bring it to the front row.
      perc: { gain: 0.95, pan: 0.15, send: 0.14 },
    },
    rest: [5, 10],
    gain: 0.84,
    sheen: 3,
  },

  /** Cindergrove — a dorian whistle tune in a lilting 6/8 over harp. */
  forest: {
    id: 'forest',
    title: 'Mossway',
    blurb: 'Cindergrove',
    bpm: 76,
    meter: '6/8',
    key: 64, // E
    mode: 'dorian',
    form: FORM_SONG,
    prog: {
      intro: ['i', 'bVII'],
      A: ['i', 'bVII', 'i', 'IV', 'i', 'bVII', 'IV bVII', 'i'],
      B: ['bIII', 'bVII', 'IV', 'i', 'bIII', 'bVII', 'IV', 'bVII'],
      C: ['v', 'i', 'bVII', 'IV', 'v', 'bIII', 'IV', 'bVII'],
      outro: ['IV', 'i'],
    },
    melody: {
      inst: 'whistle', range: [69, 93], density: 0.6, ornament: 0.3, cInst: 'flute',
      tune: {
        octave: 1,
        // "E. G B. G | A. F# D. F# | E F# G B. C# | C#.. B. A |" — the raised sixth (C#) is the forest's colour.
        A: ['1:2 3:1 5:2 3:1', '4:2 2:1 7,:2 2:1', '1:1 2:1 3:1 5:2 6:1', '6:3 5:2 4:1', '1:2 3:1 5:2 3:1', "7:2 1':1 7:2 5:1", '6:1 5:1 4:1 2:1 4:1 3:1', '1:3 r:3'],
        B: ["5:2 7:1 1':2 7:1", '7:2 4:1 2:2 4:1', "6:2 1':1 2':2 1':1", '5:3 3:3', "3:1 5:1 7:1 1':2 7:1", "2':2 1':1 7:2 4:1", "6:2 4:1 6:2 1':1", "2':2 1':1 7:3"],
        C: ["5:2 7:1 2':3", "1':2 7:1 5:3", '4:2 2:1 7,:3', '1:3 6,:3', '2:2 5,:1 7,:3', '3:2 5:1 7:3', "6:2 1':1 6:1 4:2", '7:3 4:3'],
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
    rest: [5, 12],
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
    // A full set, ~90 s before it loops: the jig twice, its B strain twice, a lyrical C strain in
    // longer notes (IV–V–iii–vi, a new harmonic area), the jig home lifted a whole step, a last B.
    form: ['intro', 'A', 'A', 'B', 'B', 'C', 'C', 'A', 'A', 'B', 'A', 'outro'],
    lift: 2,
    prog: {
      intro: ['I', 'V'],
      A: ['I', 'I', 'IV', 'V', 'I', 'I', 'IV V', 'I'],
      B: ['vi', 'IV', 'I', 'V', 'vi', 'IV', 'ii V', 'I'],
      C: ['IV', 'V', 'iii', 'vi', 'ii', 'V', 'I', 'V'],
      outro: ['IV', 'I'],
    },
    melody: {
      inst: 'fiddle', range: [66, 91], density: 0.95, ornament: 0.35, double: { inst: 'whistle', interval: 12, on: 'repeat' },
      tune: {
        octave: 1,
        // "F# E D A D F# | A2 F# B A F# | G B d B2 G | A B A C# E A |" — running jig quavers.
        A: ['3:1 2:1 1:1 5,:1 1:1 3:1', '5:2 3:1 6:1 5:1 3:1', "4:1 6:1 1':1 6:2 4:1", '5:1 6:1 5:1 7,:1 2:1 5,:1', '3:1 2:1 1:1 5,:1 1:1 3:1', "5:1 6:1 7:1 1':2 5:1", '6:1 5:1 4:1 3:1 2:1 7,:1', '1:3 r:3'],
        B: ["6:2 3:1 6:1 1':1 6:1", "4:2 6:1 1':1 6:1 4:1", "3:1 5:1 1':1 5:1 3:1 1:1", '2:1 7,:1 5,:1 2:2 3:1', "6:1 1':1 3':1 1':2 6:1", "6:1 1':1 6:1 4:2 6:1", '2:1 4:1 6:1 5:1 3:1 2:1', '1:3 r:3'],
        // C: the singing strain — crotchet-quaver lilt instead of running quavers, climbing through
        // the new chords and settling on the dominant before the jig comes home.
        C: ["4:2 6:1 1':2 6:1", "5:2 7:1 2':2 7:1", '3:2 5:1 7:2 5:1', "6:3 1':2 7:1", "2':2 1':1 6:2 4:1", "5:1 6:1 7:1 2':2 7:1", "1':2 7:1 6:1 5:1 3:1", '5:4 r:2'],
        pickup: '1:1 2:1',
      },
    },
    accomp: { inst: 'accordion', pattern: 'oompah', range: [57, 71], voices: 3, vel: 0.6 },
    accomp2: { inst: 'guitar', pattern: 'oompah', range: [50, 64], voices: 4, vel: 0.5, on: 'repeat' },
    bass: { inst: 'upright', pattern: 'jig', range: [38, 52], vel: 0.85 },
    perc: { pattern: 'jig', on: 'always', vel: 0.6 },
    mix: {
      // A wider stage than a pub session in mono (correlation read 0.82): the whistle stands off
      // left of the fiddle, the guitar well right of the accordion, a touch more room on the tune.
      melody: { gain: 0.72, pan: 0.12, send: 0.26 },
      double: { gain: 0.3, pan: -0.42, send: 0.28 },
      accomp: { gain: 0.5, pan: -0.3, send: 0.2 },
      accomp2: { gain: 0.42, pan: 0.52, send: 0.2 },
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

// The season's other songs and the seasonal lullabies (rotated by the playlists in select.ts).
Object.assign(THEMES, SONGBOOK);

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
        prog: { intro: ['I', 'II'], A: ['I', 'I', 'II', 'V', 'I', 'I', 'II V', 'I'], B: ['vi', 'II', 'I', 'V', 'vi', 'II', 'II V', 'I'], C: ['II7', 'V', 'iii', 'vi', 'II', 'V', 'I', 'V'], outro: ['II', 'I'] },
        melody: { ...base.melody!, inst: 'harp', range: [67, 91], density: 0.85, ornament: 0.2, double: { inst: 'whistle', interval: 12, on: 'repeat' } },
        accomp: { inst: 'kalimba', pattern: 'oompah', range: [60, 76], voices: 3, vel: 0.55 },
        accomp2: { inst: 'guitar', pattern: 'oompah', range: [50, 64], voices: 4, vel: 0.45, on: 'repeat' },
        // The whistle an octave over the harp put 29 % of the energy in 2–5 kHz (HARSH): it sits back
        // in a little more room, and one wide dip at 3.3 kHz takes the edge off the pair.
        mix: { ...base.mix, melody: { gain: 0.9, pan: 0.1, send: 0.3 }, double: { gain: 0.2, pan: -0.3, send: 0.4 } },
        eq: { ...base.eq, cut: { f: 3300, db: -3.5, q: 0.8 } },
        gain: 0.9,
      };
    case 'bell':
      if (h.mode === 'mixolydian') {
        return {
          ...base, id, title: 'Lanterns on the Tide', blurb: 'Tide Lantern Night', bpm: Math.min(bpm, 84), key: 64, mode: 'mixolydian',
          form: ['intro', 'A', 'A', 'B', 'A', 'C', 'B', 'A', 'outro'],
          lift: 0,
          prog: { intro: ['I', 'bVII'], A: ['I', 'bVII', 'IV', 'I', 'vi', 'bVII', 'IV V', 'I'], B: ['IV', 'I', 'bVII', 'IV', 'ii', 'bVII', 'IV', 'V'], C: ['vi', 'IV', 'bVII', 'I', 'vi', 'ii', 'IV', 'V'], outro: ['bVII', 'I'] },
          melody: {
            inst: 'celesta', range: [72, 91], density: 0.45, ornament: 0.1, double: { inst: 'glock', interval: 12, on: 'repeat' },
            tune: {
              octave: 1,
              // A slow barcarolle in 6/8, rising and falling like swell: "E.. G#. B | A.. G#. F# | E.. G#. C# |
              // B.. G#.. |" — mixolydian D natural over the bVII; B is a falling sequence of three-note waves.
              A: ['1:3 3:2 5:1', '4:3 3:2 2:1', '1:3 3:2 6:1', '5:3 3:3', '3:3 5:2 6:1', '7:3 6:2 4:1', '6:2 4:1 2:2 #7,:1', '1:6'],
              B: ['6:3 5:2 4:1', '5:3 4:2 3:1', '4:3 3:2 2:1', '1:3 3:2 4:1', '6:3 4:2 2:1', '2:3 4:2 7:1', '6:2 4:1 1:3', '5,:3 2:3'],
              // C: out on the relative minor, the lanterns drifting further — wider waves, a long D natural.
              C: ["6:3 1':2 6:1", "4:3 6:2 1':1", "7:3 2':2 7:1", "1':3 5:3", '3:3 6:2 5:1', '4:3 2:2 6:1', "4:2 6:1 1':2 6:1", '5:3 2:3'],
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
          sheen: 4.5,
        };
      }
      return {
        ...base, id, title: 'Starfall Carol', blurb: 'The Starfall Vigil', bpm: Math.min(bpm, 96), key: 65, mode: 'major', meter: '4/4',
        form: ['intro', 'A', 'B', 'A', 'C', 'A', 'outro'],
        lift: 0,
        prog: { intro: ['I', 'IV'], A: ['I', 'vi', 'IV', 'V', 'I', 'vi', 'ii V', 'I'], B: ['IV', 'I', 'ii', 'V', 'IV', 'iii vi', 'ii', 'V'], C: ['vi', 'iii', 'IV', 'I', 'ii', 'V', 'iii vi', 'ii V'], outro: ['IV', 'I'] },
        melody: {
          inst: 'musicBox', range: [72, 93], density: 0.55, ornament: 0.15, double: { inst: 'bell', interval: -12, on: 'repeat' },
          tune: {
            octave: 1,
            // A carol: "C. D C A. F | D. E F. A | Bb. A G. F | E.. G.. |"
            A: ['5:3 6:1 5:2 3:2', '6:3 7:1 1\':2 3:2', '4:3 3:1 2:2 1:2', '7,:4 2:4', '5:3 6:1 5:2 3:2', '6:3 7:1 1\':2 6:2', '4:2 6:2 5:2 2:2', '1:8'],
            B: ['6:4 1\':2 6:2', '5:4 3:2 1:2', '2:3 3:1 4:2 6:2', '5:6 r:2', '4:3 5:1 6:2 1\':2', '7:2 5:2 1\':2 6:2', '6:3 5:1 4:2 2:2', '5:6 r:2'],
            // C: the vigil's quiet middle — the carol turns to the relative minor and climbs back.
            C: ['3:3 4:1 6:4', '5:3 3:1 7,:4', "4:2 6:2 1':4", '5:2 6:1 5:1 3:4', '2:3 4:1 6:4', "5:3 7:1 2':4", "7:2 5:2 6:2 1':2", '4:2 2:2 5:4'],
          },
        },
        accomp: { inst: 'celesta', pattern: 'arp8', range: [62, 79], voices: 3, vel: 0.42 },
        accomp2: undefined,
        bass: { inst: 'softBass', pattern: 'rootFifth', range: [38, 50], vel: 0.55 },
        pad: { inst: 'pad', range: [52, 69], voices: 4, vel: 0.32, on: 'always' },
        perc: { pattern: 'sleigh', on: 'always', vel: 0.5 },
        mix: { melody: { gain: 0.85, pan: 0.1, send: 0.45 }, double: { gain: 0.25, pan: -0.3, send: 0.5 }, accomp: { gain: 0.52, pan: -0.22, send: 0.45 }, bass: { gain: 0.48, pan: 0, send: 0.1 }, pad: { gain: 0.42, pan: 0, send: 0.55 }, perc: { gain: 0.5, pan: 0.2, send: 0.2 } },
        rest: [0, 0],
        gain: 0.72,
        sheen: 4,
      };
    case 'fiddle':
      return {
        ...base, id, title: 'Harvest Reel', blurb: 'The Harvest Fair', bpm: Math.max(bpm, 118), key: 62, mode: 'dorian',
        // Faster than the jig, so one more B strain keeps the set past 90 s.
        form: ['intro', 'A', 'A', 'B', 'B', 'C', 'C', 'A', 'A', 'B', 'B', 'A', 'outro'],
        prog: { intro: ['i', 'bVII'], A: ['i', 'i', 'IV', 'v', 'i', 'i', 'IV v', 'i'], B: ['bVII', 'bVII', 'i', 'i', 'bVII', 'bVII', 'IV v', 'i'], C: ['IV', 'v', 'bIII', 'IV', 'ii', 'v', 'i', 'v'], outro: ['bVII', 'i'] },
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
