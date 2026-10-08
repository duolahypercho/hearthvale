/**
 * Round 12: a second song for the beach and the forest (they had one each, 132 s and 84 s on a loop).
 * The 'beach:day' / 'forest:day' playlists (select.ts) rotate them day by day. Original material in
 * the tune notation of themes.ts (`<degree>:<steps>`, `'`/`,` octaves, `b`/`#` accidentals, `r` rest;
 * 8 steps a bar in 4/4, 6 in 3/4).
 */
import type { ThemeDef } from './composer';

export const SONGBOOK_PLACES: Record<string, ThemeDef> = {
  /**
   * Beach II — "Low Tide": a lazy bossa in F. It opens off the tonic (the A strain starts on ii7 and
   * leans through a VI7 secondary dominant), vibraphone over fingerpicked nylon guitar and a soft
   * shaker; the bridge borrows the minor iv7 (the light going amber over the water).
   */
  'beach-2': {
    id: 'beach-2',
    title: 'Low Tide',
    blurb: 'Driftsand Beach',
    bpm: 84,
    meter: '4/4',
    key: 65, // F
    mode: 'major',
    swing: 0.52,
    form: ['intro', 'A', 'A', 'B', 'A', 'outro'],
    prog: {
      intro: ['Imaj7', 'VI7'],
      A: ['ii7', 'V7', 'Imaj7', 'VI7', 'ii7', 'V7', 'Imaj7', 'V7sus4'],
      Aend: ['ii7 V7', 'I6'],
      B: ['IVmaj7', 'iv7', 'iii7', 'VI7', 'ii7', 'V7', 'Imaj7', 'V7sus4 V7'],
      outro: ['IVmaj7', 'Imaj7'],
    },
    melody: {
      inst: 'vibes', range: [70, 93], density: 0.5, ornament: 0.1, bInst: 'flute',
      tune: {
        octave: 1,
        // Round 7: "(.) Bb D F'.. D. | E. D C Bb | A.. (breath) | (.) D F# A.. C. | Bb. G Bb D | C. D E F | G'. F E D | D C (breath) |" — the same syncopated fall from the top of the chord, answered by a rise sung by step; the top G on bar 7.
        A: ["r:1 4:1 6:1 1':3 6:2", '7:3 6:1 5:2 4:2', '3:6 r:2', 'r:1 6,:1 #1:1 3:3 5:2', '4:3 2:1 4:2 6:2', "5:3 6:1 7:2 1':2", "2':3 1':1 7:2 6:2", '6:2 5:2 r:4'],
        Aend: ['4:2 3:2 2:2 7,:2', '1:8'],
        B: ["6:3 3:1 6:2 1':2", 'b6:3 5:1 4:2 b3:2', '3:3 2:1 3:4', 'r:2 3:1 #4:1 6:4', '6:3 4:1 2:4', '3:2 4:2 5:2 7:2', "1':3 7:1 6:4", '4:3 3:1 2:4'],
      },
    },
    counter: { inst: 'flute', range: [62, 76], on: 'late', style: 'guide' },
    accomp: { inst: 'guitar', pattern: 'fingerpick', range: [50, 67], voices: 4, vel: 0.58 },
    accomp2: { inst: 'epiano', pattern: 'epComp', range: [55, 72], voices: 4, vel: 0.32, on: 'B' },
    bass: { inst: 'upright', pattern: 'rootFifth', range: [36, 50], vel: 0.76 },
    perc: { pattern: 'shaker', on: 'always', vel: 0.45 },
    mix: {
      melody: { gain: 0.8, pan: 0.08, send: 0.34 },
      counter: { gain: 0.36, pan: 0.32, send: 0.4 },
      accomp: { gain: 0.66, pan: -0.26, send: 0.26 },
      accomp2: { gain: 0.34, pan: 0.3, send: 0.32 },
      bass: { gain: 0.66, pan: 0, send: 0.05 },
      perc: { gain: 0.34, pan: 0.2, send: 0.15 },
    },
    rest: [8, 15],
    gain: 0.95,
    sheen: 3,
    air: 0.18,
  },

  /**
   * Forest II — "Fern Hollow": a pastoral oboe waltz in B minor over a rolled harp, the aeolian
   * i – bVII – bVI – bVII walk with a harmonic-minor V (A#) at each phrase end; the flute takes the
   * second strain up through bIII. It opens away from home, on iv – V.
   */
  'forest-2': {
    id: 'forest-2',
    title: 'Fern Hollow',
    blurb: 'Whisperwood',
    bpm: 78,
    meter: '3/4',
    key: 59, // B
    mode: 'minor',
    form: ['intro', 'A', 'B', 'A', 'B', 'A', 'outro'],
    prog: {
      intro: ['iv', 'V'],
      A: ['i', 'bVII', 'bVI', 'bVII', 'i', 'iv', 'bVI', 'V'],
      Aend: ['iv V', 'i'],
      B: ['bVI', 'bIII', 'bVII', 'i', 'bVI', 'bIII', 'iv', 'V'],
      outro: ['iv', 'i'],
    },
    melody: {
      inst: 'oboe', range: [66, 88], density: 0.45, legato: true, ornament: 0.25, bInst: 'flute',
      tune: {
        octave: 1,
        // "F# B C# D. C# | C#.. B A | G B D | C#... | D E F#. D | G.. F# E | D. B. G | A#. C#. F#. |"
        A: ['5,:1 1:1 2:1 3:2 2:1', '2:3 1:1 7,:2', '6,:2 1:2 3:2', '2:4 r:2', '3:1 4:1 5:2 3:2', '6:3 5:1 4:2', '3:2 1:2 6,:2', '#7,:2 2:2 5,:2'],
        Aend: ['4:3 #7,:3', '1:6'],
        B: ["1':3 7:1 6:2", '5:4 3:2', '4:3 2:1 7,:2', '1:6', "3:2 6:2 1':2", '7:3 5:1 3:2', "4:2 6:2 1':2", '#7:4 r:2'],
      },
    },
    counter: { inst: 'cello', range: [47, 62], on: 'repeat', style: 'moving' },
    accomp: { inst: 'harp', pattern: 'waltzArp', range: [52, 71], voices: 4, vel: 0.56 },
    bass: { inst: 'upright', pattern: 'waltz', range: [35, 49], vel: 0.7 },
    pad: { inst: 'pad', range: [54, 69], voices: 3, vel: 0.34, on: 'B' },
    mix: {
      melody: { gain: 0.78, pan: 0.06, send: 0.4 },
      counter: { gain: 0.44, pan: -0.3, send: 0.4 },
      accomp: { gain: 0.64, pan: 0.28, send: 0.36 },
      bass: { gain: 0.6, pan: 0, send: 0.06 },
      pad: { gain: 0.28, pan: 0, send: 0.55 },
    },
    rest: [8, 15],
    gain: 0.92,
    sheen: 3,
  },
};
