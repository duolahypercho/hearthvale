/**
 * Hearthvale's score: one ThemeDef per musical situation. All original material — the composer
 * writes a new tune from each theme's harmony, form and orchestration every time it plays
 * (seeded, so a given day always hears the same "song").
 */
import type { ThemeDef } from './composer';

const FORM_SONG: ThemeDef['form'] = ['intro', 'A', 'A', 'B', 'A', 'outro'];

export const THEMES: Record<string, ThemeDef> = {
  /** Spring on the farm — kalimba arpeggios, flute tune, pizz-ish upright, light shaker. */
  spring: {
    id: 'spring',
    title: 'First Furrow',
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
    melody: { inst: 'flute', range: [67, 86], density: 0.55, legato: true, ornament: 0.25 },
    counter: { inst: 'clarinet', range: [55, 67], on: 'repeat' },
    accomp: { inst: 'kalimba', pattern: 'arp8', range: [57, 74], voices: 4, vel: 0.62 },
    bass: { inst: 'upright', pattern: 'rootFifth', range: [36, 50], vel: 0.8 },
    pad: { inst: 'pad', range: [53, 69], voices: 4, vel: 0.5, on: 'B' },
    perc: { pattern: 'light', on: 'repeat', vel: 0.55 },
    mix: {
      melody: { gain: 0.8, pan: 0.08, send: 0.32 },
      counter: { gain: 0.55, pan: 0.32, send: 0.35 },
      accomp: { gain: 0.62, pan: -0.28, send: 0.3 },
      bass: { gain: 0.74, pan: 0, send: 0.05 },
      pad: { gain: 0.5, pan: 0, send: 0.5 },
      perc: { gain: 0.35, pan: 0.22, send: 0.15 },
    },
    rest: [25, 60],
    gain: 0.84,
  },

  /** Summer — warm nylon guitar picking, marimba melody with rolls, 3+3+2 ostinato, shaker. */
  summer: {
    id: 'summer',
    title: 'Long Light',
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
    melody: { inst: 'marimba', range: [67, 86], density: 0.8, ornament: 0.1 },
    counter: { inst: 'ocarina', range: [62, 74], on: 'late' },
    accomp: { inst: 'guitar', pattern: 'fingerpick', range: [50, 67], voices: 4, vel: 0.7 },
    accomp2: { inst: 'marimba', pattern: 'ostinato332', range: [60, 76], voices: 3, vel: 0.38, on: 'repeat' },
    bass: { inst: 'upright', pattern: 'tresillo', range: [36, 50], vel: 0.82 },
    perc: { pattern: 'shaker', on: 'repeat', vel: 0.55 },
    mix: {
      melody: { gain: 0.85, pan: 0.12, send: 0.28 },
      counter: { gain: 0.5, pan: -0.35, send: 0.35 },
      accomp: { gain: 0.72, pan: -0.25, send: 0.22 },
      accomp2: { gain: 0.45, pan: 0.35, send: 0.25 },
      bass: { gain: 0.74, pan: 0, send: 0.05 },
      perc: { gain: 0.35, pan: -0.15, send: 0.12 },
    },
    rest: [25, 60],
    gain: 1.0,
  },

  /** Fall — a clarinet waltz over harp, cello counter-line, minor with a warm major V. */
  fall: {
    id: 'fall',
    title: 'Amber Waltz',
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
    melody: { inst: 'clarinet', range: [62, 81], density: 0.45, legato: true, ornament: 0.2 },
    counter: { inst: 'cello', range: [48, 62], on: 'repeat' },
    accomp: { inst: 'harp', pattern: 'waltzArp', range: [55, 72], voices: 4, vel: 0.55 },
    bass: { inst: 'upright', pattern: 'waltz', range: [36, 50], vel: 0.78 },
    pad: { inst: 'pad', range: [50, 67], voices: 3, vel: 0.42, on: 'B' },
    mix: {
      melody: { gain: 0.85, pan: 0.06, send: 0.34 },
      counter: { gain: 0.5, pan: -0.3, send: 0.38 },
      accomp: { gain: 0.6, pan: 0.28, send: 0.34 },
      bass: { gain: 0.74, pan: 0, send: 0.06 },
      pad: { gain: 0.45, pan: 0, send: 0.5 },
    },
    rest: [25, 60],
    gain: 0.92,
  },

  /** Winter — music box and celesta in a slow 3/4, bells on the repeat, soft strings. */
  winter: {
    id: 'winter',
    title: 'Hush of Snow',
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
    melody: { inst: 'musicBox', range: [76, 93], density: 0.35, ornament: 0.15, bInst: 'celesta' },
    counter: { inst: 'bell', range: [64, 76], on: 'late' },
    accomp: { inst: 'celesta', pattern: 'musicBox', range: [64, 81], voices: 3, vel: 0.42 },
    bass: { inst: 'softBass', pattern: 'root', range: [40, 52], vel: 0.55 },
    pad: { inst: 'pad', range: [52, 69], voices: 4, vel: 0.5, on: 'always' },
    mix: {
      melody: { gain: 0.8, pan: 0.1, send: 0.45 },
      counter: { gain: 0.42, pan: -0.35, send: 0.55 },
      accomp: { gain: 0.5, pan: -0.22, send: 0.45 },
      bass: { gain: 0.45, pan: 0, send: 0.1 },
      pad: { gain: 0.55, pan: 0, send: 0.55 },
    },
    rest: [30, 70],
    gain: 0.93,
  },

  /** Hearthvale Square by day — bouncy pizzicato oom-pah, walking bass, ocarina tune, woodblocks. */
  town: {
    id: 'town',
    title: 'Market Morning',
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
    melody: { inst: 'ocarina', range: [67, 86], density: 0.75, legato: false, ornament: 0.2, bInst: 'clarinet' },
    counter: { inst: 'clarinet', range: [57, 69], on: 'late' },
    accomp: { inst: 'pizz', pattern: 'pizzOff', range: [55, 71], voices: 3, vel: 0.62 },
    accomp2: { inst: 'epiano', pattern: 'block', range: [55, 72], voices: 4, vel: 0.35, on: 'B' },
    bass: { inst: 'upright', pattern: 'walk', range: [36, 50], vel: 0.82 },
    perc: { pattern: 'town', on: 'repeat', vel: 0.5 },
    mix: {
      melody: { gain: 0.8, pan: 0.05, send: 0.28 },
      counter: { gain: 0.5, pan: 0.35, send: 0.3 },
      accomp: { gain: 0.65, pan: -0.3, send: 0.25 },
      accomp2: { gain: 0.45, pan: 0.25, send: 0.35 },
      bass: { gain: 0.74, pan: 0, send: 0.06 },
      perc: { gain: 0.35, pan: 0.25, send: 0.15 },
    },
    rest: [15, 40],
    gain: 0.86,
  },

  /** Beach — ukulele island strum, steel pan melody, tresillo bass, congas. */
  beach: {
    id: 'beach',
    title: 'Salt & Sun',
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
    melody: { inst: 'steelPan', range: [69, 88], density: 0.55, ornament: 0.1 },
    counter: { inst: 'marimba', range: [60, 74], on: 'late' },
    accomp: { inst: 'ukulele', pattern: 'strum', range: [60, 72], voices: 4, vel: 0.5 },
    bass: { inst: 'upright', pattern: 'tresillo', range: [36, 50], vel: 0.82 },
    perc: { pattern: 'island', on: 'repeat', vel: 0.55 },
    mix: {
      melody: { gain: 0.8, pan: 0.1, send: 0.32 },
      counter: { gain: 0.45, pan: 0.35, send: 0.3 },
      accomp: { gain: 0.6, pan: -0.28, send: 0.22 },
      bass: { gain: 0.74, pan: 0, send: 0.05 },
      perc: { gain: 0.38, pan: -0.12, send: 0.15 },
    },
    rest: [20, 50],
    gain: 1.35,
  },

  /** The mine — a dark drone with glass bells and distant cello, phrygian colour. */
  mine: {
    id: 'mine',
    title: 'Under Stone',
    bpm: 52,
    meter: '4/4',
    key: 57, // A
    mode: 'phrygian',
    form: ['A'],
    prog: { A: ['i', 'i', 'bII', 'i', 'iv', 'iv', 'bII', 'v'], B: ['i'] },
    ambient: { inst: 'glass', range: [69, 88], noteChance: 0.55, bars: 16 },
    counter: { inst: 'cello', range: [45, 60], on: 'always' },
    bass: { inst: 'drone', pattern: 'pedal', range: [33, 45], vel: 0.7 },
    pad: { inst: 'pad', range: [48, 62], voices: 3, vel: 0.35, on: 'always' },
    mix: {
      melody: { gain: 0.55, pan: 0.2, send: 0.7 },
      counter: { gain: 0.35, pan: -0.3, send: 0.6 },
      bass: { gain: 0.65, pan: 0, send: 0.2 },
      pad: { gain: 0.45, pan: 0, send: 0.6 },
    },
    rest: [4, 12],
    gain: 1.08,
  },

  /** Night — slow electric piano and celesta, a lullaby under the crickets. */
  night: {
    id: 'night',
    title: 'Lamplight',
    bpm: 66,
    meter: '4/4',
    key: 61, // Db
    mode: 'major',
    form: ['intro', 'A', 'B', 'A', 'outro'],
    prog: {
      intro: ['Imaj7', 'IVmaj7'],
      A: ['Imaj7', 'iii7', 'IVmaj7', 'iv6', 'Imaj7', 'vi7', 'ii7', 'V7sus4'],
      B: ['vi7', 'iii7', 'IVmaj7', 'Imaj7', 'ii7', 'iii7', 'IVmaj7', 'V7sus4'],
      outro: ['IVmaj7', 'Imaj7'],
    },
    melody: { inst: 'celesta', range: [73, 89], density: 0.2, ornament: 0 },
    accomp: { inst: 'epiano', pattern: 'epComp', range: [53, 70], voices: 4, vel: 0.5 },
    bass: { inst: 'softBass', pattern: 'root', range: [37, 49], vel: 0.5 },
    pad: { inst: 'pad', range: [56, 72], voices: 3, vel: 0.35, on: 'always' },
    mix: {
      melody: { gain: 0.55, pan: 0.18, send: 0.55 },
      accomp: { gain: 0.72, pan: -0.1, send: 0.4 },
      bass: { gain: 0.43, pan: 0, send: 0.1 },
      pad: { gain: 0.42, pan: 0, send: 0.6 },
    },
    rest: [20, 45],
    gain: 0.9,
  },

  /** Rainy day — lo-fi electric piano, clarinet sighs, brushed soft kit. */
  rain: {
    id: 'rain',
    title: 'Window Weather',
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
    melody: { inst: 'epiano', range: [70, 86], density: 0.35, ornament: 0 },
    counter: { inst: 'clarinet', range: [58, 70], on: 'repeat' },
    accomp: { inst: 'epiano', pattern: 'epComp', range: [53, 69], voices: 4, vel: 0.45 },
    bass: { inst: 'softBass', pattern: 'rootFifth', range: [39, 51], vel: 0.55 },
    perc: { pattern: 'lofi', on: 'always', vel: 0.45 },
    mix: {
      melody: { gain: 0.62, pan: 0.15, send: 0.45 },
      counter: { gain: 0.42, pan: -0.3, send: 0.45 },
      accomp: { gain: 0.62, pan: -0.12, send: 0.35 },
      bass: { gain: 0.45, pan: 0, send: 0.08 },
      perc: { gain: 0.32, pan: 0.1, send: 0.12 },
    },
    rest: [20, 45],
    gain: 0.85,
  },

  /** Festival jig — fiddle with whistle doubling, accordion oom-pah, bodhrán and tambourine. */
  festival: {
    id: 'festival',
    title: 'Lantern Jig',
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
    melody: { inst: 'fiddle', range: [60, 79], density: 0.95, ornament: 0.35, double: { inst: 'whistle', interval: 12, on: 'repeat' } },
    accomp: { inst: 'accordion', pattern: 'oompah', range: [57, 71], voices: 3, vel: 0.6 },
    accomp2: { inst: 'guitar', pattern: 'oompah', range: [50, 64], voices: 4, vel: 0.5, on: 'repeat' },
    bass: { inst: 'upright', pattern: 'jig', range: [38, 52], vel: 0.85 },
    perc: { pattern: 'jig', on: 'always', vel: 0.6 },
    mix: {
      melody: { gain: 0.78, pan: 0.1, send: 0.22 },
      double: { gain: 0.32, pan: -0.25, send: 0.25 },
      accomp: { gain: 0.5, pan: -0.3, send: 0.2 },
      accomp2: { gain: 0.45, pan: 0.35, send: 0.18 },
      bass: { gain: 0.74, pan: 0, send: 0.05 },
      perc: { gain: 0.5, pan: 0.05, send: 0.12 },
    },
    rest: [0, 0],
    gain: 1.45,
  },

  /** Title — harp, flute and strings: the valley's main theme. */
  title: {
    id: 'title',
    title: 'Hearthvale',
    bpm: 80,
    meter: '4/4',
    key: 62, // D
    mode: 'major',
    form: ['intro', 'A', 'B', 'A'],
    prog: {
      intro: ['Imaj7', 'IVmaj7'],
      A: ['Imaj7', 'iii7', 'vi7', 'IVmaj7', 'ii7', 'V', 'IVmaj7', 'I'],
      B: ['IV', 'V', 'iii7', 'vi', 'IVmaj7', 'iii7', 'ii7', 'V7sus4 V'],
    },
    melody: { inst: 'flute', range: [69, 88], density: 0.4, legato: true, ornament: 0.3 },
    counter: { inst: 'cello', range: [50, 64], on: 'always' },
    accomp: { inst: 'harp', pattern: 'arpUp', range: [55, 72], voices: 4, vel: 0.55 },
    bass: { inst: 'softBass', pattern: 'root', range: [38, 50], vel: 0.6 },
    pad: { inst: 'pad', range: [54, 71], voices: 4, vel: 0.5, on: 'always' },
    mix: {
      melody: { gain: 0.82, pan: 0.05, send: 0.4 },
      counter: { gain: 0.5, pan: -0.32, send: 0.4 },
      accomp: { gain: 0.6, pan: 0.3, send: 0.38 },
      bass: { gain: 0.45, pan: 0, send: 0.08 },
      pad: { gain: 0.5, pan: 0, send: 0.55 },
    },
    rest: [0, 0],
    gain: 0.8,
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
 * hint: the Blossom Parade is a bright lydian harp-and-whistle jig, Tide Lantern Night a slow
 * mixolydian barcarolle for bells and harp, the Harvest Fair a driving dorian fiddle reel and
 * Starfall a music-box carol with sleigh-bell tambourine. Unknown hints fall back to the jig.
 */
export function festivalTheme(h: FestivalHint): ThemeDef {
  const base = THEMES.festival!;
  const id = `festival-${h.id}`;
  const bpm = Math.max(60, Math.min(140, h.tempo || base.bpm));
  switch (h.timbre) {
    case 'pluck':
      return {
        ...base, id, title: 'Ribbon Parade', bpm, key: 67, mode: 'lydian',
        prog: { intro: ['I', 'II'], A: ['I', 'II', 'I', 'V', 'I', 'II', 'IV V', 'I'], B: ['vi', 'II', 'IV', 'I', 'vi', 'II', 'ii V', 'I'] },
        melody: { inst: 'harp', range: [67, 86], density: 0.85, ornament: 0.2, double: { inst: 'whistle', interval: 12, on: 'repeat' } },
        accomp: { inst: 'kalimba', pattern: 'oompah', range: [60, 74], voices: 3, vel: 0.55 },
        accomp2: { inst: 'guitar', pattern: 'oompah', range: [50, 64], voices: 4, vel: 0.45, on: 'repeat' },
        mix: { ...base.mix, melody: { gain: 0.9, pan: 0.1, send: 0.3 }, double: { gain: 0.28, pan: -0.25, send: 0.3 } },
        // Loudness-matched to the other themes (~-15.5 LUFS, scripts/audio-render.mjs).
        gain: 0.9,
      };
    case 'bell':
      if (h.mode === 'mixolydian') {
        return {
          ...base, id, title: 'Lanterns on the Tide', bpm: Math.min(bpm, 84), key: 64, mode: 'mixolydian',
          form: ['intro', 'A', 'B', 'A', 'outro'],
          prog: { intro: ['I', 'bVII'], A: ['I', 'bVII', 'IV', 'I', 'vi', 'bVII', 'IV V', 'I'], B: ['IV', 'I', 'bVII', 'IV', 'ii', 'bVII', 'IV', 'V'], outro: ['bVII', 'I'] },
          melody: { inst: 'celesta', range: [72, 90], density: 0.45, ornament: 0.1, double: { inst: 'bell', interval: 0, on: 'repeat' } },
          accomp: { inst: 'harp', pattern: 'waltzArp', range: [55, 72], voices: 4, vel: 0.5 },
          accomp2: undefined,
          bass: { inst: 'softBass', pattern: 'jig', range: [38, 50], vel: 0.55 },
          pad: { inst: 'pad', range: [52, 69], voices: 3, vel: 0.42, on: 'always' },
          perc: { pattern: 'light', on: 'repeat', vel: 0.4 },
          mix: { melody: { gain: 0.8, pan: 0.1, send: 0.5 }, double: { gain: 0.22, pan: -0.3, send: 0.6 }, accomp: { gain: 0.6, pan: -0.25, send: 0.4 }, bass: { gain: 0.5, pan: 0, send: 0.1 }, pad: { gain: 0.5, pan: 0, send: 0.55 }, perc: { gain: 0.3, pan: 0.2, send: 0.2 } },
          rest: [0, 0],
          gain: 0.85,
        };
      }
      return {
        ...base, id, title: 'Starfall Carol', bpm: Math.min(bpm, 96), key: 65, mode: 'major',
        form: ['intro', 'A', 'B', 'A', 'outro'],
        prog: { intro: ['I', 'IV'], A: ['I', 'vi', 'IV', 'V', 'I', 'vi', 'ii V', 'I'], B: ['IV', 'I', 'ii', 'V', 'IV', 'iii vi', 'ii', 'V'], outro: ['IV', 'I'] },
        melody: { inst: 'musicBox', range: [74, 91], density: 0.55, ornament: 0.15, double: { inst: 'bell', interval: -12, on: 'repeat' } },
        accomp: { inst: 'celesta', pattern: 'musicBox', range: [62, 79], voices: 3, vel: 0.45 },
        accomp2: undefined,
        bass: { inst: 'softBass', pattern: 'jig', range: [38, 50], vel: 0.55 },
        pad: { inst: 'pad', range: [52, 69], voices: 4, vel: 0.45, on: 'always' },
        perc: { pattern: 'light', on: 'always', vel: 0.45 },
        mix: { melody: { gain: 0.85, pan: 0.1, send: 0.45 }, double: { gain: 0.25, pan: -0.3, send: 0.5 }, accomp: { gain: 0.55, pan: -0.22, send: 0.45 }, bass: { gain: 0.5, pan: 0, send: 0.1 }, pad: { gain: 0.5, pan: 0, send: 0.55 }, perc: { gain: 0.3, pan: 0.2, send: 0.2 } },
        rest: [0, 0],
        gain: 0.62,
      };
    case 'fiddle':
      return {
        ...base, id, title: 'Harvest Reel', bpm: Math.max(bpm, 118), key: 62, mode: 'dorian',
        prog: { intro: ['i', 'bVII'], A: ['i', 'i', 'bVII', 'bVII', 'i', 'i', 'IV bVII', 'i'], B: ['bIII', 'bVII', 'IV', 'i', 'bIII', 'bVII', 'iv V', 'i'] },
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
