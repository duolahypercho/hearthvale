/**
 * The rest of the farm's score: two more songs per season (a different meter, tempo and lead voice
 * from the season's first theme in themes.ts) and the seasonal lullabies. The season playlists in
 * select.ts rotate through them day by day. All original material, in the same tune notation as
 * themes.ts (`<degree>:<steps>`, `'`/`,` octaves, `b`/`#` accidentals, `r` rest; a bar is 8 steps in
 * 4/4, 6 in 3/4 and in 6/8).
 */
import type { ThemeDef } from './composer';

/** Songs in 6/8 and brisk 3/4 have short bars: their tune runs sixteen bars per A. */
const FORM: ThemeDef['form'] = ['intro', 'A', 'A', 'B', 'A', 'C', 'A', 'outro'];
const NIGHT_FORM: ThemeDef['form'] = ['intro', 'A', 'B', 'A', 'C', 'A', 'outro'];

export const SONGBOOK: Record<string, ThemeDef> = {
  // ───────────────────────────────────────────── spring

  /** Spring II — a skipping 6/8 kalimba tune over nylon-guitar arpeggios; the flute answers in B. */
  'spring-2': {
    id: 'spring-2',
    title: 'Clover Lane',
    blurb: 'Spring on the farm',
    bpm: 84,
    meter: '6/8',
    key: 67, // G
    mode: 'major',
    form: FORM,
    prog: {
      intro: ['I', 'IV'],
      A: ['I', 'I', 'IV', 'V', 'I', 'vi', 'ii', 'V', 'I', 'I', 'IV', 'iv', 'I', 'vi', 'ii V', 'I'],
      B: ['IV', 'V', 'iii', 'vi', 'IV', 'I', 'ii', 'V'],
      C: ['vi', 'iii', 'IV', 'I', 'vi', 'II', 'IV', 'V'],
      outro: ['IV', 'I'],
    },
    melody: {
      inst: 'kalimba', range: [62, 86], density: 0.8, ornament: 0.15, bInst: 'flute', cInst: 'ocarina',
      double: { inst: 'glock', interval: 12, on: 'late' },
      tune: {
        octave: 0,
        // "D G A B. A | G. D G.. | C B C E. D | D.. A.. |" — a skip up the tonic and a tumble home;
        // the second strain climbs to the high G and borrows the minor iv (Eb) on its way down.
        A: [
          '5,:1 1:1 2:1 3:2 2:1', '1:2 5,:1 1:3', '4:1 3:1 4:1 6:2 5:1', '5:3 2:3',
          '5,:1 1:1 2:1 3:2 5:1', '6:2 5:1 3:3', '4:1 3:1 2:1 6,:2 2:1', '7,:2 2:1 5,:3',
          '5,:1 1:1 2:1 3:2 2:1', "1:1 3:1 5:1 1':3", "1':1 7:1 6:1 1':2 6:1", 'b6:2 5:1 4:3',
          "3:2 5:1 1':2 7:1", "6:2 1':1 3:3", '4:2 3:1 2:2 7,:1', '1:3 r:3',
        ],
        B: ["1':3 6:2 5:1", "2':3 7:2 6:1", '7:3 5:2 3:1', '6:3 3:3', "4:2 6:1 1':3", "3':2 1':1 5:3", '6:2 4:1 2:3', '7,:3 2:3'],
        C: ['3:1 6,:1 1:1 3:3', '5:1 3:1 5:1 7:3', "1':2 6:1 4:3", '5:3 3:3', '3:1 6,:1 3:1 6:3', '#4:2 6:1 2:3', '4:3 6:3', '5:3 7,:3'],
      },
    },
    counter: { inst: 'cello', range: [48, 62], on: 'repeat', style: 'moving' },
    accomp: { inst: 'guitar', pattern: 'waltzArp', range: [50, 67], voices: 4, vel: 0.62 },
    accomp2: { inst: 'pizz', pattern: 'oompah', range: [55, 69], voices: 3, vel: 0.45, on: 'late' },
    bass: { inst: 'upright', pattern: 'jig', range: [36, 50], vel: 0.78 },
    perc: { pattern: 'light', on: 'repeat', vel: 0.55 },
    mix: {
      melody: { gain: 0.95, pan: 0.1, send: 0.3 },
      double: { gain: 0.16, pan: -0.25, send: 0.4 },
      counter: { gain: 0.42, pan: -0.32, send: 0.36 },
      accomp: { gain: 0.66, pan: -0.24, send: 0.26 },
      accomp2: { gain: 0.4, pan: 0.34, send: 0.22 },
      bass: { gain: 0.66, pan: 0, send: 0.05 },
      perc: { gain: 0.42, pan: 0.2, send: 0.15 },
    },
    rest: [25, 60],
    gain: 0.9,
    sheen: 3,
  },

  /** Spring III — an ocarina waltz over harp, a moving cello line, strings in the bridge. */
  'spring-3': {
    id: 'spring-3',
    title: 'Apple Blossom Waltz',
    blurb: 'Spring on the farm',
    bpm: 100,
    meter: '3/4',
    key: 62, // D
    mode: 'major',
    form: FORM,
    prog: {
      intro: ['I', 'IV'],
      A: ['I', 'V/3', 'vi', 'iii', 'IV', 'I/3', 'ii7', 'V'],
      Aend: ['V7', 'I'],
      B: ['IV', 'I/3', 'ii7', 'V', 'iii7', 'vi', 'ii7', 'V7'],
      C: ['vi', 'iii', 'IV', 'I', 'vi', 'iii', 'ii7', 'V', 'IV', 'I/3', 'ii7', 'vi', 'IV', 'iv6', 'ii7', 'V7'],
      outro: ['IV', 'I'],
    },
    melody: {
      inst: 'ocarina', range: [69, 88], density: 0.5, legato: true, ornament: 0.25, cInst: 'flute',
      tune: {
        octave: 1,
        // A falling-bass waltz (D – C#/A – B – F#m – G – D/F#): "F#. G F# E | E.. C# | D. E D C# | C#... |".
        A: ['3:3 4:1 3:1 2:1', '2:4 7,:2', '1:3 2:1 1:1 7,:1', '7,:4 r:2', '6:3 7:1 6:1 5:1', '5:2 3:2 1:2', "2:3 4:1 6:1 1':1", "7:4 r:2"],
        Aend: ['2:2 4:2 7,:2', '1:6'],
        B: ["1':3 7:1 6:2", '5:4 3:2', '6:3 5:1 4:2', '2:4 r:2', '7:3 6:1 5:2', "6:4 1':2", "2':3 1':1 6:2", '5:2 4:2 2:2'],
        C: [
          '6,:3 7,:1 1:2', '3:3 5:1 3:2', '4:4 6:2', '5:6', '6:3 5:1 3:2', '3:2 7,:2 5,:2', '2:3 1:1 6,:2', '7,:4 r:2',
          '4:3 5:1 6:2', "1':4 5:2", '6:3 4:1 2:2', '3:4 r:2', "6:3 1':1 6:2", 'b6:4 4:2', '2:3 4:1 6:2', '5:2 4:2 7,:2',
        ],
      },
    },
    counter: { inst: 'cello', range: [48, 62], on: 'repeat', style: 'moving' },
    accomp: { inst: 'harp', pattern: 'waltzArp', range: [55, 74], voices: 4, vel: 0.6 },
    accomp2: { inst: 'pizz', pattern: 'waltz', range: [57, 71], voices: 3, vel: 0.45, on: 'late' },
    bass: { inst: 'upright', pattern: 'waltz', range: [36, 50], vel: 0.76 },
    pad: { inst: 'pad', range: [55, 71], voices: 3, vel: 0.4, on: 'B' },
    perc: { pattern: 'light', on: 'late', vel: 0.45 },
    mix: {
      melody: { gain: 0.82, pan: 0.06, send: 0.34 },
      counter: { gain: 0.46, pan: -0.3, send: 0.38 },
      accomp: { gain: 0.66, pan: 0.28, send: 0.34 },
      accomp2: { gain: 0.36, pan: -0.34, send: 0.22 },
      bass: { gain: 0.64, pan: 0, send: 0.06 },
      pad: { gain: 0.3, pan: 0, send: 0.5 },
      perc: { gain: 0.36, pan: 0.2, send: 0.18 },
    },
    rest: [25, 60],
    gain: 0.92,
    sheen: 4.5,
  },

  // ───────────────────────────────────────────── summer

  /** Summer II — a lazy porch-swing waltz: fiddle over strummed guitar, marimba on the repeats. */
  'summer-2': {
    id: 'summer-2',
    title: 'Porch Swing',
    blurb: 'Summer on the farm',
    bpm: 88,
    meter: '3/4',
    key: 69, // A
    mode: 'major',
    form: FORM,
    prog: {
      intro: ['I', 'IV'],
      A: ['I', 'I7', 'IV', 'iv6', 'I', 'vi7', 'ii7', 'V7'],
      Aend: ['V7', 'I'],
      B: ['IV', 'I', 'V/3', 'vi', 'IV', 'I/3', 'ii7', 'V7'],
      C: ['vi', 'iii', 'IV', 'I', 'vi', 'II7', 'IV', 'V7sus4 V'],
      outro: ['IV', 'I'],
    },
    melody: {
      inst: 'fiddle', range: [62, 88], density: 0.5, legato: true, ornament: 0.3, cInst: 'guitar',
      tune: {
        octave: 0,
        // "E A C# | E G E | F#. E D | F.. D | C#. B A | F# A C# | B. D F# | E.. G# |" — the flat seventh
        // (G) and the borrowed minor iv (F) give it the front-porch sway.
        A: ['5,:2 1:2 3:2', '5:2 b7:2 5:2', '6:3 5:1 4:2', 'b6:4 4:2', '3:3 2:1 1:2', '6,:2 1:2 3:2', '2:3 4:1 6:2', '5:4 7,:2'],
        Aend: ['4:2 2:2 7,:2', '1:6'],
        B: ["1':4 6:2", '5:3 3:1 1:2', '7:4 5:2', '6:3 5:1 3:2', "4:2 6:2 1':2", "3':3 2':1 1':2", '6:3 4:1 2:2', '5:3 4:1 2:2'],
        C: ['3:2 6,:2 1:2', '5:4 3:2', "4:3 6:1 1':2", '5:6', '6:3 5:1 3:2', '#4:3 6:1 2:2', "1':2 6:2 4:2", '1:3 7,:3'],
      },
    },
    counter: { inst: 'cello', range: [45, 60], on: 'late', style: 'moving' },
    accomp: { inst: 'guitar', pattern: 'waltz', range: [52, 69], voices: 4, vel: 0.66 },
    accomp2: { inst: 'marimba', pattern: 'waltzArp', range: [64, 81], voices: 3, vel: 0.36, on: 'repeat' },
    bass: { inst: 'upright', pattern: 'waltz', range: [36, 50], vel: 0.8 },
    perc: { pattern: 'shaker', on: 'late', vel: 0.4 },
    mix: {
      melody: { gain: 0.8, pan: 0.08, send: 0.3 },
      counter: { gain: 0.44, pan: -0.3, send: 0.34 },
      accomp: { gain: 0.72, pan: -0.26, send: 0.22 },
      accomp2: { gain: 0.44, pan: 0.34, send: 0.26 },
      bass: { gain: 0.68, pan: 0, send: 0.05 },
      perc: { gain: 0.36, pan: 0.18, send: 0.12 },
    },
    rest: [25, 60],
    gain: 1.35,
    sheen: -2.5,
  },

  /** Summer III — a sunny bossa-swung tune for nylon guitar, marimba arpeggios, a borrowed-chord bridge. */
  'summer-3': {
    id: 'summer-3',
    title: 'Lemonade Afternoon',
    blurb: 'Summer on the farm',
    bpm: 84,
    meter: '4/4',
    key: 60, // C
    mode: 'major',
    swing: 0.55,
    form: FORM,
    prog: {
      intro: ['Imaj7', 'vi7'],
      A: ['Imaj7', 'vi7', 'ii7', 'V7', 'iii7', 'vi7', 'ii7', 'V7'],
      Aend: ['ii7 V7', 'Imaj7'],
      B: ['IVmaj7', 'iii7', 'vi7', 'Imaj7', 'IVmaj7', 'iii7', 'II7', 'V7sus4 V'],
      C: ['bVImaj7', 'bVII', 'Imaj7', 'vi7', 'bVImaj7', 'bVII', 'IV', 'V7sus4 V'],
      outro: ['IVmaj7', 'Imaj7'],
    },
    melody: {
      inst: 'guitar', range: [64, 88], density: 0.55, ornament: 0.1, cInst: 'marimba',
      double: { inst: 'glock', interval: 12, on: 'late' },
      tune: {
        octave: 1,
        // "E.. G.. B | A G E.. | F.. A.. C | B A G.. |" — up the seventh chords in 3+3+2, a lazy fall.
        A: ['3:3 5:3 7:2', '6:2 5:1 3:3 r:2', "4:3 6:3 1':2", '7:2 6:1 5:3 r:2', "5:3 7:3 2':2", "1':2 7:1 6:3 r:2", '4:2 3:1 2:3 6,:2', '7,:3 2:3 r:2'],
        Aend: ['4:2 6:1 2:3 5:2', '1:6 r:2'],
        B: ['6:4 3:2 1:2', '2:3 7,:3 5,:2', '3:3 1:3 6,:2', '7,:4 r:4', "4:2 6:2 1':2 3':2", "2':3 7:3 5:2", "#4:3 6:3 1':2", "1':4 7:2 r:2"],
        C: ['b6:3 5:3 b3:2', '4:3 2:3 b7,:2', '3:3 5:3 7:2', '6:4 r:4', "1':3 b6:3 b3:2", "2':3 b7:3 4:2", '6:3 4:3 1:2', '1:4 7,:2 r:2'],
      },
    },
    counter: { inst: 'flute', range: [67, 81], on: 'late' },
    accomp: { inst: 'marimba', pattern: 'arp8', range: [60, 77], voices: 4, vel: 0.44 },
    accomp2: { inst: 'ukulele', pattern: 'strum', range: [60, 72], voices: 4, vel: 0.4, on: 'repeat' },
    bass: { inst: 'upright', pattern: 'rootFifth', range: [36, 50], vel: 0.8 },
    perc: { pattern: 'shaker', on: 'always', vel: 0.5 },
    mix: {
      melody: { gain: 1.2, pan: 0.1, send: 0.3 },
      double: { gain: 0.15, pan: -0.25, send: 0.4 },
      counter: { gain: 0.42, pan: -0.34, send: 0.36 },
      accomp: { gain: 0.5, pan: -0.26, send: 0.26 },
      accomp2: { gain: 0.4, pan: 0.34, send: 0.2 },
      bass: { gain: 0.68, pan: 0, send: 0.05 },
      perc: { gain: 0.38, pan: 0.2, send: 0.12 },
    },
    rest: [25, 60],
    // The glock double and flute counter crowd 2–5 kHz: a gentle presence dip.
    eq: { cut: { f: 3600, db: -2.5, q: 0.8 } },
    gain: 1.7,
  },

  // ───────────────────────────────────────────── fall

  /** Fall II — a slow minor hymn: the cello sings the tune over harp, pizzicato and strings. */
  'fall-2': {
    id: 'fall-2',
    title: 'Cider & Candle',
    blurb: 'Autumn on the farm',
    bpm: 72,
    meter: '4/4',
    key: 57, // A
    mode: 'minor',
    form: FORM,
    prog: {
      intro: ['i', 'bVI'],
      A: ['i', 'bVI', 'bIII', 'bVII', 'iv', 'i', 'bVI', 'V'],
      Aend: ['iv V', 'i'],
      B: ['bIII', 'bVII', 'iv', 'i', 'bVI', 'bIII', 'iv', 'V7'],
      C: ['bIII', 'bVII', 'bVI', 'bIII', 'bVI', 'bVII', 'iv', 'V7sus4 V'],
      outro: ['iv', 'i'],
    },
    melody: {
      inst: 'cello', range: [57, 81], density: 0.4, legato: true, ornament: 0.15, cInst: 'flute',
      tune: {
        octave: 1,
        // "E.. C A... | F.. A C... | E.. G E C | D... B... |" — the tune walks down the minor triad and
        // climbs back through the relative major, a hymn you could hum by the fire.
        A: ['5:3 4:1 3:2 1:2', '6,:3 7,:1 1:2 3:2', '5:3 6:1 7:2 5:2', '4:3 3:1 2:4', '6:3 5:1 4:4', '3:3 2:1 1:4', '1:2 2:1 3:1 6:4', '5:2 4:1 3:1 #7,:4'],
        Aend: ['4:2 6:2 5:2 #7,:2', '1:8'],
        B: ['7:3 6:1 5:2 3:2', '2:3 3:1 4:2 7:2', "6:3 1':1 6:2 4:2", '5:6 r:2', "1':3 7:1 6:2 3:2", '5:3 4:1 3:4', "4:3 5:1 6:2 1':2", '#7:4 5:2 4:2'],
        C: ['3:3 4:1 5:2 7:2', "7:3 1':1 2':4", "3':3 2':1 1':2 6:2", '5:8', "6:3 7:1 1':2 3':2", "2':3 1':1 7:4", '6:3 5:1 4:4', '1:4 #7,:4'],
      },
    },
    accomp: { inst: 'harp', pattern: 'arp8', range: [48, 67], voices: 4, vel: 0.6 },
    accomp2: { inst: 'pizz', pattern: 'pizzOff', range: [55, 69], voices: 3, vel: 0.4, on: 'late' },
    bass: { inst: 'softBass', pattern: 'rootFifth', range: [33, 47], vel: 0.6 },
    pad: { inst: 'pad', range: [52, 67], voices: 3, vel: 0.36, on: 'B' },
    mix: {
      melody: { gain: 1.0, pan: 0.04, send: 0.36 },
      accomp: { gain: 0.66, pan: 0.26, send: 0.34 },
      accomp2: { gain: 0.34, pan: -0.32, send: 0.24 },
      bass: { gain: 0.5, pan: 0, send: 0.08 },
      pad: { gain: 0.3, pan: 0, send: 0.5 },
    },
    rest: [25, 60],
    gain: 1.2,
    sheen: -1,
  },

  /** Fall III — an oboe tune in a rocking 6/8, fingerpicked guitar, clarinet taking the bridge. */
  'fall-3': {
    id: 'fall-3',
    title: 'Woodsmoke',
    blurb: 'Autumn on the farm',
    bpm: 72,
    meter: '6/8',
    key: 67, // G
    mode: 'minor',
    form: FORM,
    prog: {
      intro: ['i', 'bVII'],
      A: ['i', 'bVII', 'bVI', 'V', 'i', 'bVII', 'bVI', 'V', 'i', 'iv', 'bVII', 'bIII', 'bVI', 'iv', 'V', 'i'],
      B: ['bIII', 'bVII', 'iv', 'i', 'bVI', 'bIII', 'iv', 'V'],
      C: ['bVI', 'bVII', 'bIII', 'i', 'iv', 'bVII', 'bIII', 'V'],
      outro: ['iv', 'i'],
    },
    melody: {
      inst: 'oboe', range: [62, 84], density: 0.6, legato: true, ornament: 0.25, cInst: 'clarinet',
      tune: {
        octave: 0,
        // "D. Bb G. Bb | A. C F.. | Eb. D Bb.. | A.. F#.. |" — a rocking lament that climbs to the high G.
        A: [
          '5:2 4:1 3:2 2:1', '2:2 3:1 4:3', '6:2 5:1 3:3', '2:2 1:1 #7,:3',
          '5:2 4:1 3:2 2:1', '4:2 3:1 2:2 3:1', "6:2 5:1 6:2 1':1", '5:3 r:3',
          '5:2 6:1 5:1 4:1 3:1', '4:2 5:1 6:3', '7:2 6:1 4:2 2:1', '3:2 4:1 5:3',
          '6:2 5:1 3:2 5:1', '4:2 3:1 1:3', '2:2 1:1 #7,:3', '1:3 r:3',
        ],
        B: ['7:2 6:1 5:3', '4:2 3:1 2:3', "1':2 7:1 6:3", '5:6', "6:2 7:1 1':3", '7:2 6:1 5:3', '6:2 5:1 4:3', '#7,:3 2:3'],
        C: ['3:2 2:1 1:3', '2:2 3:1 4:3', '5:2 6:1 7:3', '5:2 4:1 3:3', "4:2 5:1 6:2 1':1", '7:2 6:1 4:3', '3:2 4:1 5:3', '5:3 #7:3'],
      },
    },
    accomp: { inst: 'guitar', pattern: 'waltzArp', range: [50, 67], voices: 4, vel: 0.62 },
    bass: { inst: 'upright', pattern: 'jig', range: [36, 50], vel: 0.74 },
    pad: { inst: 'pad', range: [52, 67], voices: 3, vel: 0.36, on: 'B' },
    perc: { pattern: 'light', on: 'late', vel: 0.4 },
    mix: {
      melody: { gain: 0.82, pan: 0.06, send: 0.34 },
      accomp: { gain: 0.72, pan: -0.24, send: 0.28 },
      bass: { gain: 0.66, pan: 0, send: 0.05 },
      pad: { gain: 0.3, pan: 0, send: 0.5 },
      perc: { gain: 0.34, pan: 0.2, send: 0.16 },
    },
    rest: [25, 60],
    gain: 1.3,
  },

  // ───────────────────────────────────────────── winter

  /** Winter II — celesta over rolled harp chords, glockenspiel frost on the repeat, a hand-bell bridge. */
  'winter-2': {
    id: 'winter-2',
    title: 'Frostglass',
    blurb: 'Winter on the farm',
    bpm: 72,
    meter: '4/4',
    key: 58, // Bb
    mode: 'major',
    form: FORM,
    prog: {
      intro: ['Imaj7', 'IVmaj7'],
      A: ['Imaj7', 'IVmaj7', 'iii7', 'vi7', 'ii7', 'V7', 'Imaj7', 'V7sus4'],
      Aend: ['V7', 'I'],
      B: ['vi7', 'iii7', 'IVmaj7', 'Imaj7', 'ii7', 'iii7', 'IV', 'V7sus4 V'],
      C: ['bVImaj7', 'bVII', 'Imaj7', 'vi7', 'iv6', 'bVII', 'ii7', 'V7sus4 V'],
      outro: ['IVmaj7', 'Imaj7'],
    },
    melody: {
      inst: 'celesta', range: [70, 93], density: 0.45, ornament: 0.1, cInst: 'bell',
      double: { inst: 'glock', interval: 12, on: 'repeat' },
      tune: {
        octave: 1,
        // "D F Bb. A F | G.. F Eb... | D F A. C A | Bb... F G |" — a snowflake arpeggio that settles.
        A: ["3:1 5:1 1':2 7:2 5:2", '6:3 5:1 4:4', "3:1 5:1 7:2 2':2 7:2", "1':4 r:2 5:1 6:1", "4:2 6:2 1':3 7:1", "2':3 1':1 7:2 5:2", "3:2 5:2 7:2 3':2", "2':4 1':4"],
        Aend: ['2:2 4:2 5:2 7,:2', '1:8'],
        B: ['6:3 5:1 3:4', '5:3 3:1 7,:4', "4:2 6:2 1':2 3':2", '7:4 5:4', '6:3 4:1 2:4', '3:3 5:1 7:4', "1':3 6:1 4:4", '1:4 7,:4'],
        C: ['b6:4 5:4', 'b7:4 4:4', "3':4 7:4", '6:8', 'b6:4 4:4', "2':4 b7:4", "1':4 6:4", "1':4 7:4"],
      },
    },
    counter: { inst: 'flute', range: [65, 79], on: 'late' },
    accomp: { inst: 'harp', pattern: 'harpRoll', range: [53, 72], voices: 4, vel: 0.6 },
    bass: { inst: 'softBass', pattern: 'root', range: [34, 46], vel: 0.5 },
    perc: { pattern: 'sleigh', on: 'late', vel: 0.35 },
    mix: {
      melody: { gain: 0.9, pan: 0.08, send: 0.45 },
      double: { gain: 0.15, pan: -0.26, send: 0.55 },
      counter: { gain: 0.4, pan: -0.32, send: 0.5 },
      accomp: { gain: 0.66, pan: -0.2, send: 0.42 },
      bass: { gain: 0.4, pan: 0, send: 0.1 },
      perc: { gain: 0.36, pan: 0.3, send: 0.3 },
    },
    rest: [30, 70],
    gain: 0.92,
    sheen: 3.5,
  },

  /** Winter III — a hearthside 6/8: soft low flute over a music-box figure, cello, a clarinet bridge. */
  'winter-3': {
    id: 'winter-3',
    title: 'Hearthside',
    blurb: 'Winter on the farm',
    bpm: 60,
    meter: '6/8',
    key: 65, // F
    mode: 'major',
    form: FORM,
    prog: {
      intro: ['I', 'IV'],
      A: ['I', 'vi', 'IV', 'V', 'I', 'iii', 'IV', 'V', 'vi', 'iii', 'IV', 'I', 'IV', 'iv', 'V', 'I'],
      B: ['vi', 'iii', 'IV', 'I', 'ii', 'iii', 'IV', 'V'],
      C: ['iii', 'vi', 'ii', 'V', 'bVII', 'IV', 'ii', 'V'],
      outro: ['IV', 'I'],
    },
    melody: {
      inst: 'flute', range: [65, 90], density: 0.4, legato: true, ornament: 0.2, cInst: 'clarinet',
      tune: {
        octave: 1,
        // "F. A C.. | D. C A.. | Bb. A Bb D. | C.. G.. |" — a rocking cradle tune; the second half
        // reaches the high F and sighs over the minor iv (Db).
        A: [
          '1:2 2:1 3:3', '6:2 5:1 3:3', '4:2 3:1 4:1 6:2', '5:2 4:1 2:3',
          '1:2 2:1 3:3', '7:2 6:1 5:1 4:1 3:1', '6:2 5:1 4:3', '2:3 r:3',
          '3:2 4:1 6:3', '7:2 6:1 5:3', "6:2 1':1 6:1 5:1 4:1", '5:6',
          '4:2 5:1 6:3', 'b6:2 5:1 4:3', '5:2 3:1 2:3', '1:6',
        ],
        B: ['6,:2 7,:1 1:3', '3:2 2:1 7,:3', '4:2 3:1 1:3', '5,:6', '2:2 3:1 4:3', '5:2 4:1 3:3', '6:2 5:1 4:3', '2:3 7,:3'],
        C: ['3:2 4:1 5:3', '6:2 5:1 3:3', '4:2 3:1 2:3', '5,:3 7,:3', 'b7,:2 1:1 2:3', '4:2 5:1 6:3', '6:2 5:1 4:1 2:2', '7,:3 5,:3'],
      },
    },
    counter: { inst: 'cello', range: [45, 60], on: 'repeat', style: 'moving' },
    accomp: { inst: 'musicBox', pattern: 'musicBox', range: [69, 86], voices: 3, vel: 0.42 },
    bass: { inst: 'softBass', pattern: 'root', range: [36, 48], vel: 0.5 },
    mix: {
      melody: { gain: 0.8, pan: 0.06, send: 0.44 },
      counter: { gain: 0.44, pan: -0.3, send: 0.42 },
      accomp: { gain: 0.6, pan: 0.24, send: 0.45 },
      bass: { gain: 0.42, pan: 0, send: 0.1 },
    },
    rest: [30, 70],
    gain: 0.95,
    sheen: 1.5,
  },

  // ───────────────────────────────────────────── nights

  /** Spring (and summer) nights — a slow flute lullaby over rising harp, a celesta bridge. */
  'night-spring': {
    id: 'night-spring',
    title: 'Dew at Dusk',
    blurb: 'Night in the valley',
    bpm: 64,
    meter: '4/4',
    key: 68, // Ab
    mode: 'major',
    breaks: false,
    form: NIGHT_FORM,
    prog: {
      intro: ['Imaj7', 'IVmaj7'],
      A: ['Imaj7', 'IVmaj7', 'vi7', 'iii7', 'ii7', 'V7sus4', 'Imaj7', 'IVmaj7'],
      Aend: ['V7sus4 V7', 'Imaj7'],
      B: ['vi7', 'iii7', 'IVmaj7', 'Imaj7', 'ii7', 'bVIImaj7', 'IVmaj7', 'V7sus4'],
      C: ['IVmaj7', 'iv6', 'Imaj7', 'vi7', 'ii7', 'V/3', 'IVmaj7', 'V7sus4'],
      outro: ['IVmaj7', 'Imaj7'],
    },
    melody: {
      inst: 'flute', range: [65, 88], density: 0.3, legato: true, ornament: 0.15, cInst: 'celesta',
      tune: {
        octave: 0,
        A: ['5:3 3:1 1:4', "6:3 1':1 6:4", '5:3 3:1 1:2 6,:2', '7,:4 r:4', '2:3 4:1 6:4', "5:3 4:1 1':4", '7:4 5:4', '6:4 r:4'],
        Aend: ['4:2 2:2 5:2 7,:2', '1:8'],
        B: ["1':3 6:1 5:4", '7:3 5:1 3:4', "4:2 6:2 1':4", '7:6 r:2', '6:3 4:1 2:4', 'b7:4 6:4', '4:3 3:1 1:4', '2:4 1:4'],
        C: ["1':4 6:4", 'b6:4 4:4', '5:4 3:4', '6,:4 r:4', '2:3 4:1 6:4', '7:3 5:1 2:4', '3:4 1:4', '4:4 2:4'],
      },
    },
    accomp: { inst: 'harp', pattern: 'arpUp', range: [51, 70], voices: 4, vel: 0.5 },
    bass: { inst: 'softBass', pattern: 'root', range: [36, 48], vel: 0.45 },
    pad: { inst: 'pad', range: [56, 70], voices: 3, vel: 0.3, on: 'B' },
    mix: {
      melody: { gain: 0.74, pan: 0.1, send: 0.52 },
      accomp: { gain: 0.66, pan: -0.16, send: 0.44 },
      bass: { gain: 0.4, pan: 0, send: 0.1 },
      pad: { gain: 0.26, pan: 0, send: 0.55 },
    },
    rest: [20, 45],
    gain: 0.9,
  },

  /** Fall nights — a dorian clarinet waltz in its low register, harp, flute bridge. */
  'night-fall': {
    id: 'night-fall',
    title: 'Owl Hour',
    blurb: 'Night in the valley',
    bpm: 66,
    meter: '3/4',
    key: 62, // D
    mode: 'dorian',
    breaks: false,
    form: NIGHT_FORM,
    prog: {
      intro: ['i', 'IV'],
      A: ['i', 'IV', 'bIII', 'bVII', 'i', 'IV', 'bVII', 'i'],
      B: ['bIII', 'bVII', 'IV', 'i', 'bIII', 'bVII', 'IV', 'v'],
      C: ['bVI', 'bIII', 'bVII', 'i', 'bVI', 'bVII', 'IV', 'v'],
      outro: ['IV', 'i'],
    },
    melody: {
      inst: 'clarinet', range: [55, 79], density: 0.35, legato: true, ornament: 0.15, cInst: 'flute',
      tune: {
        octave: 0,
        // "A. F D | G. B D' | C. A F | E... | D'. C A | B. A G | G E C | D..." — the raised sixth (B) is the owl.
        A: ['5:3 3:1 1:2', "4:3 6:1 1':2", '7:3 5:1 3:2', '2:4 r:2', "1':3 7:1 5:2", '6:3 5:1 4:2', '4:2 2:2 7,:2', '1:6'],
        B: ['3:2 5:2 7:2', "7:2 2':2 4':2", "1':3 6:1 4:2", '5:6', '3:3 5:1 7:2', "2':3 1':1 7:2", "6:3 4:1 1':2", '5:4 r:2'],
        C: ["1':3 b6:1 3:2", "5:3 7:1 3':2", "2':3 1':1 7:2", "1':6", "3':3 1':1 b6:2", '7:3 5:1 2:2', "4:3 6:1 1':2", '5:3 7:3'],
      },
    },
    accomp: { inst: 'harp', pattern: 'waltzArp', range: [50, 69], voices: 4, vel: 0.5 },
    bass: { inst: 'softBass', pattern: 'root', range: [33, 45], vel: 0.48 },
    pad: { inst: 'pad', range: [50, 65], voices: 3, vel: 0.3, on: 'B' },
    mix: {
      melody: { gain: 0.8, pan: 0.08, send: 0.48 },
      accomp: { gain: 0.66, pan: -0.2, send: 0.42 },
      bass: { gain: 0.42, pan: 0, send: 0.1 },
      pad: { gain: 0.26, pan: 0, send: 0.55 },
    },
    rest: [20, 45],
    gain: 0.92,
  },

  /** Winter nights — a music-box lullaby over a slow harp waltz, a celesta bridge over the minor iv. */
  'night-winter': {
    id: 'night-winter',
    title: 'Snowlight Lullaby',
    blurb: 'Night in the valley',
    bpm: 60,
    meter: '3/4',
    key: 67, // G
    mode: 'major',
    breaks: false,
    form: NIGHT_FORM,
    prog: {
      intro: ['I', 'IV'],
      A: ['I', 'iii', 'IV', 'I', 'vi', 'ii7', 'IV', 'V7sus4 V'],
      Aend: ['V7', 'I'],
      B: ['vi', 'iii', 'IV', 'I', 'ii7', 'V', 'IV', 'V7'],
      C: ['IVmaj7', 'iv6', 'Imaj7', 'vi7', 'ii7', 'bVII', 'IV', 'V7sus4 V'],
      outro: ['IV', 'I'],
    },
    melody: {
      inst: 'musicBox', range: [72, 93], density: 0.3, ornament: 0.1, cInst: 'celesta',
      tune: {
        octave: 1,
        // "D. C B | B A B D | E. D C | B.. A | G A B E | E D C A | G. F# E | G. F# |" — it rocks down by step.
        A: ['5:3 4:1 3:2', '3:2 2:1 3:1 5:2', '6:3 5:1 4:2', '3:4 2:2', '1:2 2:1 3:1 6:2', '6:2 5:1 4:1 2:2', '1:3 7,:1 6,:2', '1:3 7,:3'],
        Aend: ['4:2 3:1 2:1 7,:2', '1:6'],
        B: ['3:3 2:1 1:1 7,:1', '7,:3 1:1 2:2', '1:2 2:1 3:1 4:2', '5:6', '6:3 5:1 4:2', '5:2 4:1 3:1 2:2', '1:3 2:1 3:2', '4:3 3:1 2:2'],
        C: ['6:3 5:1 3:2', 'b6:3 5:1 4:2', '7:3 6:1 5:2', '6:6', "1':2 7:1 6:1 5:2", 'b7:3 6:1 4:2', '1:2 2:1 3:1 6,:2', '4:3 2:3'],
      },
    },
    accomp: { inst: 'harp', pattern: 'waltzArp', range: [52, 71], voices: 4, vel: 0.46 },
    bass: { inst: 'softBass', pattern: 'root', range: [36, 48], vel: 0.45 },
    pad: { inst: 'pad', range: [55, 69], voices: 3, vel: 0.3, on: 'B' },
    mix: {
      melody: { gain: 0.88, pan: 0.1, send: 0.5 },
      accomp: { gain: 0.6, pan: -0.2, send: 0.44 },
      bass: { gain: 0.38, pan: 0, send: 0.1 },
      pad: { gain: 0.22, pan: 0, send: 0.55 },
    },
    rest: [20, 45],
    gain: 0.9,
    sheen: 1.5,
  },
};
