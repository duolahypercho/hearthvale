/**
 * More songs for the places a player hears most often, so a 28-day season never grates: two more
 * rainy-day songs (the 'rain:<season>' playlists rotate them with 'Window Weather'), two more town
 * songs and a winter arrangement of 'Market Morning' (the 'town:<season>' playlists), and the square's
 * evening rotates the inn's tune with a musette waltz. All original material, in the tune notation of
 * themes.ts (`<degree>:<eighths>`, `'`/`,` octaves, `b`/`#` accidentals, `r` rest; a bar is 8 eighths
 * in 4/4 and 6 in 3/4).
 */
import type { ThemeDef } from './composer';

const FORM: ThemeDef['form'] = ['intro', 'A', 'A', 'B', 'A', 'C', 'A', 'outro'];
const SHORT_FORM: ThemeDef['form'] = ['intro', 'A', 'B', 'A', 'C', 'A', 'outro'];

export const SONGBOOK_TOWN: Record<string, ThemeDef> = {
  /**
   * Rain II (spring / summer showers) — vibraphone over fingerpicked nylon guitar, the tune falling
   * like drops off the eaves: every phrase starts after a breath and lands on a 7th. The flute takes
   * B, the cello sings the bridge down in its warm register.
   */
  'rain-2': {
    id: 'rain-2',
    title: 'Gutter Song',
    blurb: 'A rainy day',
    bpm: 74,
    meter: '4/4',
    key: 62, // D
    mode: 'major',
    swing: 0.58,
    form: SHORT_FORM,
    prog: {
      intro: ['Imaj7', 'IVmaj7'],
      A: ['Imaj7', 'vi7', 'ii7', 'V7', 'Imaj7', 'vi7', 'IVmaj7', 'V7sus4 V'],
      B: ['IVmaj7', 'iii7', 'ii7', 'Imaj7', 'IVmaj7', 'iii7 vi7', 'ii7', 'V7sus4 V'],
      C: ['vi7', 'IVmaj7', 'Imaj7', 'V', 'vi7', 'IVmaj7', 'iv6', 'V7sus4 V'],
      outro: ['IVmaj7', 'Imaj7'],
      Aend: ['IVmaj7 V7', 'Imaj7'],
    },
    melody: {
      inst: 'vibes', range: [64, 90], density: 0.4, ornament: 0.1, bInst: 'flute', cInst: 'cello',
      tune: {
        octave: 1,
        // ". . A F# A. C#. | B.. A F#... | . . G E G. B. | A.. G E. C#. |" — drops off the eaves.
        A: ['r:2 5:1 3:1 5:2 7:2', '6:3 5:1 3:4', 'r:2 4:1 2:1 4:2 6:2', '5:3 4:1 2:2 7,:2', "r:2 5:1 3:1 5:2 1':2", "3':3 2':1 1':2 6:2", '6:2 4:2 3:2 6,:2', '5,:4 7,:2 r:2'],
        Aend: ['6:2 4:2 5:2 7,:2', '1:6 r:2'],
        B: ["1':4 6:2 4:2", '7:4 6:2 5:2', '6:3 5:1 4:2 2:2', '3:6 r:2', "4:2 6:2 1':3 2':1", "3':4 1':2 6:2", "2':3 1':1 6:2 4:2", '5:4 r:4'],
        C: ['3:3 2:1 3:2 6:2', '4:4 3:2 2:2', "3:3 5:1 1':4", '7:6 r:2', "6:3 5:1 6:2 1':2", "1':3 7:1 6:2 4:2", 'b6:4 4:2 2:2', '5:4 7,:4'],
      },
    },
    counter: { inst: 'clarinet', range: [57, 69], on: 'repeat' },
    accomp: { inst: 'guitar', pattern: 'fingerpick', range: [50, 67], voices: 4, vel: 0.58 },
    bass: { inst: 'upright', pattern: 'rootFifth', range: [38, 50], vel: 0.72 },
    perc: { pattern: 'lofi', on: 'repeat', vel: 0.45 },
    mix: {
      melody: { gain: 0.7, pan: 0.12, send: 0.42 },
      counter: { gain: 0.4, pan: -0.32, send: 0.42 },
      accomp: { gain: 0.66, pan: -0.2, send: 0.3 },
      bass: { gain: 0.62, pan: 0, send: 0.06 },
      perc: { gain: 0.45, pan: 0.12, send: 0.12 },
    },
    rest: [6, 14],
    gain: 0.86,
    sheen: 2,
  },

  /**
   * Rain III (fall / winter rain) — a felt-piano waltz in E minor over a harp, a cello answering
   * underneath; the bridge hands the tune to the cello on its own.
   */
  'rain-3': {
    id: 'rain-3',
    title: 'Grey Lantern',
    blurb: 'A rainy day',
    bpm: 84,
    meter: '3/4',
    key: 64, // E
    mode: 'minor',
    form: SHORT_FORM,
    breaks: 'breath',
    prog: {
      intro: ['i', 'bVI'],
      A: ['i', 'iv', 'bVII', 'bIII', 'bVI', 'iv', 'V', 'i'],
      B: ['bIII', 'bVII', 'iv', 'i', 'bVI', 'bIII', 'iv', 'V'],
      C: ['bVI', 'bVII', 'bIII', 'bVI', 'iv', 'i', 'iim7b5', 'V'],
      outro: ['iv', 'i'],
      Aend: ['iv V', 'i'],
    },
    melody: {
      inst: 'piano', range: [64, 88], density: 0.4, ornament: 0.15, cInst: 'cello',
      tune: {
        octave: 1,
        // "B.. G F# | C'.. B A | A F# D | G... | G C' E' | E'. D' C' | B. A D# | E" — a sigh down,
        // a lift a fourth up, the leading tone (D#) pulling home.
        A: ['5:4 3:1 2:1', '6:4 5:1 4:1', '4:2 2:2 7,:2', '3:4 r:2', "3:2 6:2 1':2", "1':3 7:1 6:2", '5:3 4:1 #7,:2', '1:6'],
        Aend: ['6:3 #7,:3', '1:6'],
        B: ['5:3 6:1 7:2', '7:4 6:1 4:1', '6:3 5:1 4:2', '5:6', "3:2 5:2 1':2", '7:2 5:2 3:2', "4:3 6:1 1':2", '5:4 r:2'],
        C: ['6,:3 1:1 3:2', '4:3 2:1 7,:2', '5:4 3:2', '3:3 1:1 6,:2', '1:2 6,:2 4,:2', '5,:4 3,:2', '4,:2 6,:2 1:2', '#7,:4 2:2'],
      },
    },
    counter: { inst: 'cello', range: [45, 60], on: 'repeat', style: 'moving' },
    accomp: { inst: 'harp', pattern: 'waltzArp', range: [52, 72], voices: 4, vel: 0.5 },
    bass: { inst: 'softBass', pattern: 'waltz', range: [38, 50], vel: 0.6 },
    pad: { inst: 'pad', range: [52, 67], voices: 3, vel: 0.3, on: 'B' },
    mix: {
      melody: { gain: 0.7, pan: 0.1, send: 0.45 },
      counter: { gain: 0.46, pan: -0.3, send: 0.4 },
      accomp: { gain: 0.6, pan: -0.22, send: 0.38 },
      bass: { gain: 0.55, pan: 0, send: 0.08 },
      pad: { gain: 0.36, pan: 0, send: 0.55 },
    },
    rest: [6, 14],
    gain: 0.85,
    sheen: 2,
  },

  /**
   * Town II (fall / winter, and the square's evenings) — a musette waltz: accordion tune over a
   * guitar's oom-pah-pah and a waltzing upright, glockenspiel doubling the last A.
   */
  'town-2': {
    id: 'town-2',
    title: "Lamplighter's Waltz",
    blurb: 'Hearthvale Square',
    bpm: 120,
    meter: '3/4',
    key: 60, // C
    mode: 'major',
    form: FORM,
    breaks: 'breath',
    prog: {
      intro: ['I', 'V7'],
      A: ['I', 'I', 'IV', 'I', 'ii', 'V7', 'V7', 'I'],
      B: ['vi', 'vi', 'ii', 'V7', 'IV', 'I', 'ii V7', 'I'],
      C: ['vi', 'iii', 'IV', 'I', 'ii', 'V', 'iii vi', 'ii V7'],
      outro: ['V7', 'I'],
      Aend: ['V7', 'I'],
    },
    melody: {
      inst: 'accordion', range: [64, 88], density: 0.6, ornament: 0.2, cInst: 'clarinet', double: { inst: 'glock', interval: 12, on: 'late' },
      tune: {
        octave: 1,
        // "E G C' | E'.. D' C' | A.. C' | G.. | F A D' | D'. C' B | F G B | C" — up the triad, a turn
        // round the top, the lamps lit one by one.
        A: ["3:2 5:2 1':2", "3':4 2':1 1':1", "6:4 1':2", '5:4 r:2', "4:2 6:2 2':2", "2':3 1':1 7:2", '4:2 5:2 7,:2', '1:4 r:2'],
        Aend: ["2':2 7:2 5:2", "1':6"],
        B: ["6:3 7:1 1':2", "3':4 1':2", "2':3 1':1 6:2", '7:4 5:2', "4:3 6:1 1':2", "3':3 2':1 1':2", '6:3 7:3', "1':6"],
        C: ["1':2 7:2 6:2", '7:4 5:2', '6:2 5:2 4:2', '3:4 5:2', "4:2 6:2 1':2", "2':4 7:2", "7:3 1':3", '6:3 5:3'],
      },
    },
    counter: { inst: 'clarinet', range: [55, 67], on: 'late' },
    accomp: { inst: 'guitar', pattern: 'waltz', range: [52, 67], voices: 3, vel: 0.55 },
    bass: { inst: 'upright', pattern: 'waltz', range: [36, 50], vel: 0.8 },
    perc: { pattern: 'light', on: 'repeat', vel: 0.5 },
    mix: {
      melody: { gain: 0.72, pan: 0.08, send: 0.3 },
      double: { gain: 0.11, pan: -0.3, send: 0.4 },
      counter: { gain: 0.42, pan: 0.34, send: 0.32 },
      accomp: { gain: 0.62, pan: -0.3, send: 0.24 },
      bass: { gain: 0.68, pan: 0, send: 0.05 },
      perc: { gain: 0.42, pan: 0.2, send: 0.15 },
    },
    rest: [5, 10],
    gain: 0.9,
    // The musette's reed chamber and the glock put 26 % in 2–5 kHz: a wide dip at 3 kHz, no sheen.
    eq: { cut: { f: 3000, db: -4, q: 0.8 } },
  },

  /**
   * Town III (spring / summer) — bunting over the square: a tin-whistle tune over ukulele strums and
   * a 3+3+2 marimba ostinato, woodblocks ticking like a baker's scale.
   */
  'town-3': {
    id: 'town-3',
    title: 'Bunting & Bread',
    blurb: 'Hearthvale Square',
    bpm: 108,
    meter: '4/4',
    key: 65, // F
    mode: 'major',
    swing: 0.56,
    form: FORM,
    prog: {
      intro: ['I', 'V'],
      A: ['I', 'IV', 'I', 'V', 'I', 'IV', 'ii V', 'I'],
      B: ['IV', 'V', 'iii', 'vi', 'ii', 'V', 'IV', 'V'],
      C: ['vi', 'V', 'IV', 'I', 'ii', 'iii', 'IV', 'V7sus4 V'],
      outro: ['IV', 'I'],
      Aend: ['ii V', 'I'],
    },
    melody: {
      inst: 'whistle', range: [67, 91], density: 0.75, ornament: 0.25, bInst: 'marimba', cInst: 'flute', double: { inst: 'glock', interval: 12, on: 'late' },
      tune: {
        octave: 1,
        // "F G A C D. C. | Bb C D C Bb.. A | A G F G A. C. | Bb A G... - |" — a skipping walk up the
        // scale and back, the baker's whistle on a bright morning.
        A: ['1:1 2:1 3:1 5:1 6:2 5:2', '4:1 5:1 6:1 5:1 4:3 3:1', '3:1 2:1 1:1 2:1 3:2 5:2', '4:1 3:1 2:4 r:2', "1:1 2:1 3:1 5:1 6:2 1':2", "1':1 7:1 6:1 5:1 4:2 6:2", '6:1 4:1 2:1 4:1 5:1 3:1 2:2', '1:6 r:2'],
        Aend: ['6:1 4:1 2:1 4:1 5:2 7,:2', '1:6 r:2'],
        B: ['6:3 5:1 4:2 6:2', '7:3 6:1 5:2 7:2', "7:3 1':1 7:2 5:2", '6:6 r:2', "2':3 1':1 6:2 4:2", "5:1 6:1 7:1 1':1 2':2 7:2", "1':3 7:1 6:2 4:2", '5:4 r:2 5,:1 7,:1'],
        C: ["6:3 5:1 6:2 1':2", '7:3 6:1 5:4', "4:3 5:1 6:2 1':2", "1':4 5:2 3:2", "4:3 5:1 6:2 2':2", '7:3 6:1 5:2 3:2', "4:2 6:2 1':4", "2':4 7:4"],
        pickup: '5,:1 7,:1',
      },
    },
    counter: { inst: 'ocarina', range: [60, 72], on: 'late' },
    accomp: { inst: 'ukulele', pattern: 'strum', range: [60, 72], voices: 4, vel: 0.48 },
    accomp2: { inst: 'marimba', pattern: 'ostinato332', range: [60, 77], voices: 3, vel: 0.32, on: 'repeat' },
    bass: { inst: 'upright', pattern: 'rootFifth', range: [36, 50], vel: 0.8 },
    perc: { pattern: 'town', on: 'always', vel: 0.55 },
    mix: {
      melody: { gain: 0.66, pan: 0.06, send: 0.28 },
      double: { gain: 0.14, pan: -0.22, send: 0.38 },
      counter: { gain: 0.42, pan: 0.34, send: 0.3 },
      accomp: { gain: 0.66, pan: -0.28, send: 0.22 },
      accomp2: { gain: 0.38, pan: 0.36, send: 0.24 },
      bass: { gain: 0.7, pan: 0, send: 0.05 },
      perc: { gain: 0.4, pan: 0.22, send: 0.15 },
    },
    rest: [5, 10],
    gain: 0.92,
    sheen: 3,
  },
};

/**
 * 'Market Morning' in winter clothes: the celesta takes the tune with bells an octave down on the
 * repeats, sleigh bells instead of the woodblocks, strings in the contrast sections.
 */
export function winterTown(town: ThemeDef): ThemeDef {
  return {
    ...town,
    id: 'town-winter',
    title: 'Market Morning (Frost)',
    blurb: 'Hearthvale Square in winter',
    bpm: Math.round(town.bpm * 0.92),
    swing: 0.55,
    melody: { ...town.melody!, inst: 'celesta', bInst: 'clarinet', cInst: 'flute', double: { inst: 'bell', interval: -12, on: 'repeat' } },
    accomp: { ...town.accomp!, inst: 'harp', pattern: 'harpRoll', vel: 0.55 },
    accomp2: undefined,
    pad: { inst: 'pad', range: [53, 69], voices: 3, vel: 0.36, on: 'B' },
    perc: { pattern: 'sleigh', on: 'always', vel: 0.5 },
    mix: {
      ...town.mix,
      melody: { gain: 0.78, pan: 0.06, send: 0.38 },
      double: { gain: 0.2, pan: -0.25, send: 0.45 },
      accomp: { gain: 0.6, pan: -0.28, send: 0.32 },
      pad: { gain: 0.36, pan: 0, send: 0.55 },
      perc: { gain: 0.45, pan: 0.2, send: 0.18 },
    },
    gain: 0.86,
  };
}
