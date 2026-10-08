/**
 * The event score: music written for scenes rather than places. A heart event or a story scene no
 * longer plays under whatever the square happened to be playing — it gets a cue that fits it, the way
 * a hand-scored OST has its own pieces for the tender, funny, sad and strange moments:
 *
 *   event-tender    'Kindling'          felt piano over a rolled harp, the cello answering on the repeat
 *   event-playful   'Tiptoe'            staccato clarinet sneaking round the chord, pizzicato off-beats,
 *                                       a glockenspiel winking an octave up, a stop-time bar before B
 *   event-wistful   'The Empty Chair'   a slow fiddle air in D minor (graces, slides) over harp and strings
 *   event-mystery   'Lantern Dark'      celesta in D lydian (the raised 4th), harp arpeggios, a cello
 *                                       pedal; the bridge slips to a borrowed bVI
 *   event-sly       'Glimmer & Co.'     a habanera for the company man: clarinet with chromatic sidesteps,
 *                                       pizzicato, tresillo bass, the accordion turning on the charm in B
 *   event-dawn      'Lanterns Relit'    a 3/4 hymn for the Hall restorations: fiddle over harp and strings,
 *                                       lifted a whole step into the last A with hand bells on the tune
 *
 * `eventCue()` maps heart events and story scenes to a cue (an explicit table, then a vote over the
 * script's dialogue moods for anything new), so the story and town pods get scored scenes for free.
 * All original material in the tune notation of themes.ts (`<degree>:<eighths>`, `'`/`,` octaves,
 * `b`/`#` accidentals, `r` rest; 8 eighths a bar in 4/4).
 */
import type { ThemeDef } from './composer';

const EVENT_FORM: ThemeDef['form'] = ['intro', 'A', 'B', 'A', 'outro'];
const EVENT_FORM_LONG: ThemeDef['form'] = ['intro', 'A', 'A', 'B', 'A', 'outro'];

export const SONGBOOK_EVENTS: Record<string, ThemeDef> = {
  /**
   * Tender — a felt-piano song in F: up the triad to the octave and a slow sigh home; the B strain
   * climbs through the relative minor to a B-flat high point over IVmaj7, then a suspended dominant
   * holds its breath before the tune comes back. The cello takes a moving line on the return.
   */
  'event-tender': {
    id: 'event-tender',
    title: 'Kindling',
    blurb: 'A heart event',
    bpm: 66,
    meter: '4/4',
    key: 65, // F
    mode: 'major',
    form: EVENT_FORM,
    breaks: 'breath',
    prog: {
      intro: ['IVmaj7', 'I'],
      A: ['I', 'V', 'vi7', 'iii7', 'IVmaj7', 'I', 'ii7', 'V7sus4 V'],
      Aend: ['ii7 V7', 'I'],
      B: ['vi', 'iii', 'IV', 'I', 'ii7', 'vi7', 'IVmaj7', 'V7sus4 V'],
      outro: ['IVmaj7', 'Iadd9'],
    },
    melody: {
      inst: 'piano', range: [62, 86], density: 0.4, ornament: 0.15,
      double: { inst: 'celesta', interval: 12, on: 'late' },
      tune: {
        octave: 0,
        // "A C F... | E.. D C... | D.. C D F | E... C A | B♭ D F.. D | C.. A F... | G B♭ D.. C | C..." —
        A: ["3:2 5:2 1':4", '7:3 6:1 5:4', "6:3 5:1 6:2 1':2", '7:4 5:2 3:2', "4:2 6:2 1':3 6:1", '5:3 3:1 1:4', '2:2 4:2 6:3 5:1', '5:6 r:2'],
        Aend: ['4:2 2:2 7,:2 2:2', '1:8'],
        B: ["6:3 7:1 1':2 3':2", "3':3 2':1 7:4", "1':3 7:1 6:2 4:2", '5:6 r:2', "4:3 5:1 6:2 1':2", "3':3 2':1 1':4", "6:3 1':1 4':2 3':2", "2':4 7:2 5:2"],
      },
    },
    counter: { inst: 'cello', range: [48, 60], on: 'repeat', style: 'moving' },
    accomp: { inst: 'harp', pattern: 'harpRoll', range: [50, 61], voices: 4, vel: 0.55 },
    bass: { inst: 'softBass', pattern: 'root', range: [36, 48], vel: 0.5 },
    pad: { inst: 'pad', range: [50, 62], voices: 3, vel: 0.34, on: 'B' },
    mix: {
      melody: { gain: 0.86, pan: 0.04, send: 0.42 },
      double: { gain: 0.16, pan: 0.28, send: 0.55 },
      counter: { gain: 0.44, pan: -0.3, send: 0.4 },
      accomp: { gain: 0.6, pan: 0.24, send: 0.4 },
      bass: { gain: 0.36, pan: 0, send: 0.08 },
      pad: { gain: 0.3, pan: 0, send: 0.55 },
    },
    rest: [2, 4],
    gain: 0.9,
    sheen: 2.5,
  },

  /**
   * Playful — tiptoeing staccato clarinet in F, every phrase a little sneak up the triad with a
   * chromatic lean (G♯ into A); B runs off to D minor on secondary dominants (A7, G7) like a chase,
   * and the last A ends on a comic "button" (tonic — low C — tonic).
   */
  'event-playful': {
    id: 'event-playful',
    title: 'Tiptoe',
    blurb: 'A heart event',
    bpm: 132,
    meter: '4/4',
    key: 65, // F
    mode: 'major',
    swing: 0.56,
    form: EVENT_FORM_LONG,
    breaks: 'stop',
    prog: {
      intro: ['I', 'V7'],
      A: ['I', 'I', 'IV', 'I', 'ii7', 'V7', 'I', 'V7'],
      Aend: ['V7', 'I'],
      B: ['vi', 'III7', 'vi', 'II7', 'IV', 'I', 'ii7', 'V7'],
      outro: ['V7', 'I'],
    },
    melody: {
      inst: 'clarinet', range: [58, 84], density: 0.7, staccato: true, ornament: 0.1, bInst: 'clarinet',
      double: { inst: 'glock', interval: 12, on: 'late' },
      tune: {
        octave: 0,
        // "F . A . C . A G♯ | A . F . C(low) . . | B♭ . D . F' E D | C A . F . . . |" — tiptoes.
        A: ['1:1 r:1 3:1 r:1 5:1 r:1 3:1 #2:1', '3:1 r:1 1:1 r:1 6,:1 r:1 3:1 #2:1', "4:1 r:1 6:1 r:1 1':2 7:1 6:1", '5:2 3:1 r:1 1:2 r:2', '2:1 r:1 3:1 r:1 4:1 r:1 5:1 r:1', '5:1 4:1 3:1 2:1 7,:2 5,:2', "1:1 r:1 3:1 5:1 1':2 r:2", '7:1 r:1 5:1 r:1 4:1 3:1 2:1 7,:1'],
        Aend: ['2:1 r:1 4:1 r:1 7,:1 2:1 5,:1 7,:1', '1:2 r:1 5,:1 1:2 r:2'],
        B: ['6:2 7:1 6:1 5:2 3:2', '#5:2 6:1 7:1 #5:2 r:2', "6:1 7:1 1':1 2':1 3':2 1':2", "2':2 7:1 6:1 #4:2 r:2", "4:1 r:1 5:1 6:1 1':2 6:2", '5:1 r:1 4:1 3:1 2:2 3:2', '2:1 3:1 4:1 5:1 6:2 4:2', '5:2 r:2 7,:1 r:1 5,:1 r:1'],
      },
    },
    accomp: { inst: 'pizz', pattern: 'pizzOff', range: [45, 57], voices: 3, vel: 0.6 },
    bass: { inst: 'upright', pattern: 'rootFifth', range: [33, 45], vel: 0.78 },
    perc: { pattern: 'light', on: 'always', vel: 0.42 },
    mix: {
      melody: { gain: 0.9, pan: 0.04, send: 0.26 },
      double: { gain: 0.14, pan: 0.3, send: 0.36 },
      accomp: { gain: 0.66, pan: -0.28, send: 0.24 },
      bass: { gain: 0.66, pan: 0, send: 0.06 },
      perc: { gain: 0.34, pan: 0.24, send: 0.16 },
    },
    rest: [2, 4],
    gain: 0.92,
    sheen: 3,
  },

  /**
   * Wistful — a slow fiddle air in D minor: a falling triad, a climb through the relative major, the
   * leading tone (C♯) leaning on the dominant; B reaches up to a high A over the relative major and
   * comes down by step. Harp and strings below; the cello joins on the return.
   */
  'event-wistful': {
    id: 'event-wistful',
    title: 'The Empty Chair',
    blurb: 'A heart event',
    bpm: 60,
    meter: '4/4',
    key: 62, // D
    mode: 'minor',
    form: EVENT_FORM,
    breaks: 'breath',
    prog: {
      intro: ['i', 'bVI'],
      A: ['i', 'bVII', 'bVI', 'V', 'i', 'iv', 'bVI V', 'i'],
      Aend: ['iv V', 'i'],
      B: ['bIII', 'bVII', 'iv', 'i', 'bVI', 'bIII', 'iv', 'V'],
      outro: ['iv', 'i'],
    },
    melody: {
      inst: 'fiddle', range: [58, 86], density: 0.4, legato: true, ornament: 0.3, bInst: 'fiddle',
      tune: {
        octave: 0,
        // "A.. G F D | C.. D E... | F G A B♭... | A... C♯ A | D'.. B♭ A F | G.. A B♭ G | F D E C♯ | D..." —
        A: ['5:3 4:1 3:2 1:2', '7,:3 1:1 2:4', '3:2 4:1 5:1 6:4', '5:4 #7:2 5:2', "1':3 6:1 5:2 3:2", '4:3 5:1 6:2 4:2', '3:2 1:2 2:2 #7,:2', '1:6 r:2'],
        Aend: ['6:2 4:2 2:2 #7,:2', '1:8'],
        B: ['3:2 5:2 7:3 6:1', "7:3 1':1 2':2 7:2", "1':3 7:1 6:2 4:2", '5:6 r:2', "6:3 7:1 1':2 3':2", "5':4 3':2 1':1 7:1", '6:3 5:1 4:2 2:2', "5:2 #7:2 2':4"],
      },
    },
    counter: { inst: 'cello', range: [43, 55], on: 'repeat', style: 'moving' },
    accomp: { inst: 'harp', pattern: 'harpRoll', range: [50, 64], voices: 3, vel: 0.52 }, // (round 8: 45-57 sat on the cello: 200-500 Hz 3 dB over the mid)
    bass: { inst: 'softBass', pattern: 'root', range: [33, 45], vel: 0.46 },
    pad: { inst: 'pad', range: [55, 64], voices: 3, vel: 0.32, on: 'B' },
    mix: {
      melody: { gain: 0.9, pan: 0.04, send: 0.44 },
      counter: { gain: 0.42, pan: -0.32, send: 0.4 },
      accomp: { gain: 0.58, pan: 0.26, send: 0.4 },
      bass: { gain: 0.42, pan: 0, send: 0.08 },
      pad: { gain: 0.28, pan: 0, send: 0.6 },
    },
    rest: [2, 4],
    gain: 0.9,
    sheen: 2,
  },

  /**
   * Mystery — celesta in D lydian: the I ↔ II sway (the raised 4th, G♯) that sounds like a question;
   * B turns to the minor chords and slips onto a borrowed B♭maj7 before the dominant brings the
   * question back. Harp arpeggios, a cello guide line, a tonic pedal in the bass.
   */
  'event-mystery': {
    id: 'event-mystery',
    title: 'Lantern Dark',
    blurb: 'Something stirs',
    bpm: 72,
    meter: '4/4',
    key: 62, // D
    mode: 'lydian',
    form: EVENT_FORM,
    breaks: 'breath',
    prog: {
      intro: ['Imaj7', 'II'],
      A: ['Imaj7', 'II', 'Imaj7', 'II', 'vi', 'II', 'V', 'I'],
      Aend: ['II V', 'I'],
      B: ['vi', 'iii', 'II', 'vi', 'bVImaj7', 'II', 'iii7', 'V'],
      outro: ['II', 'Imaj7'],
    },
    melody: {
      inst: 'celesta', range: [72, 96], density: 0.45, ornament: 0.1, bInst: 'flute',
      double: { inst: 'glass', interval: -12, on: 'late' },
      tune: {
        octave: 1,
        // "D F♯ A.. C♯ | B.. G♯ E... | F♯ A C♯.. B | B... . G♯ B | D'.. B F♯ D | E.. G♯ B E' | C♯ A E A | D..." —
        A: ['1:2 2:1 3:1 5:3 4:1', '4:3 3:1 2:4', '3:2 4:1 5:1 7:3 6:1', '6:3 5:1 4:2 2:2', "1':3 7:1 6:2 3:2", '2:3 3:1 4:2 6:2', '7:3 6:1 5:2 2:2', '1:6 r:2'],
        Aend: ['4:3 3:1 2:2 7,:2', '1:8'],
        B: ["6:3 7:1 1':2 2':2", "3':2 2':1 1':1 7:4", '6:3 5:1 4:2 2:2', '3:6 r:2', "b6:3 5:1 b6:2 1':2", "4':3 3':1 2':4", '7:3 6:1 5:2 3:2', "5:2 6:1 7:1 2':4"],
      },
    },
    // Round 7 (critic r6: "hollower than the other intimate cues", 180–700 Hz at -29.7 dB): the body
    // is voiced in, not EQ'd in — the cello guide sings from the first A in its tenor (C3–C4), a low
    // string pad holds the chord tones under the harp all the way (D3–E4), and the harp's rolls
    // start a third lower.
    counter: { inst: 'cello', range: [48, 60], on: 'always', style: 'guide' },
    accomp: { inst: 'harp', pattern: 'arpUp', range: [50, 67], voices: 4, vel: 0.48 },
    bass: { inst: 'softBass', pattern: 'pedal', range: [33, 45], vel: 0.42 },
    pad: { inst: 'pad', range: [50, 64], voices: 3, vel: 0.3, on: 'always' },
    mix: {
      melody: { gain: 0.92, pan: 0.06, send: 0.5 },
      double: { gain: 0.14, pan: -0.3, send: 0.6 },
      counter: { gain: 0.48, pan: -0.3, send: 0.4 },
      accomp: { gain: 0.56, pan: 0.28, send: 0.45 },
      bass: { gain: 0.34, pan: 0, send: 0.1 },
      pad: { gain: 0.36, pan: 0.05, send: 0.55 },
    },
    rest: [2, 4],
    gain: 0.9,
    sheen: 2.5,
  },

  /**
   * Sly — a habanera in A (harmonic) minor for the Glimmer & Co. scenes: the clarinet slides round
   * its notes (D♯ under E, the augmented second F → G♯), pizzicato on the off-beats over a tresillo
   * bass; B switches on the charm in C major with the accordion, and the last A tips its hat
   * (A — E — A, staccato).
   */
  'event-sly': {
    id: 'event-sly',
    title: 'Glimmer & Co.',
    blurb: 'A visitor from the city',
    bpm: 100,
    meter: '4/4',
    key: 57, // A
    mode: 'harmonicMinor',
    form: EVENT_FORM_LONG,
    breaks: 'stop',
    prog: {
      intro: ['i', 'V7'],
      A: ['i', 'i', 'iv', 'V7', 'iv', 'i', 'iim7b5 V7', 'i'],
      Aend: ['iim7b5 V7', 'i'],
      B: ['bIII', 'bVII', 'bIII', 'V7', 'bVI', 'bIII', 'iv', 'V7'],
      outro: ['V7', 'i'],
    },
    melody: {
      inst: 'clarinet', range: [62, 86], density: 0.6, ornament: 0.15, bInst: 'accordion',
      tune: {
        octave: 1,
        // "E.. D♯ E C | A . C E A' . . | F.. E F D | G♯.. F E . | D F A.. G♯ | A' E C A | B D G♯ B | A..." —
        A: ['5:3 #4:1 5:2 3:2', '1:2 7,:1 1:1 3:2 2:1 1:1', '6:3 5:1 6:2 4:2', '7:3 6:1 5:2 r:2', "4:2 5:1 6:1 1':3 7:1", "1':2 7:1 6:1 5:2 3:2", '2:1 3:1 4:2 7,:1 1:1 2:2', '1:4 r:2 6:1 #4:1'],
        Aend: ['6:1 5:1 4:1 2:1 7,:2 5,:2', '1:2 r:2 5,:1 r:1 1:1 r:1'],
        B: ['5:3 4:1 3:2 5:2', '4:3 3:1 2:2 b7,:2', '5:3 6:1 5:2 3:2', "7:3 1':1 2':2 7:2", "1':3 2':1 3':2 1':2", 'b7:3 6:1 5:2 3:2', '4:3 5:1 6:2 4:2', "5:2 7:2 2':2 7:2"],
      },
    },
    accomp: { inst: 'pizz', pattern: 'pizzOff', range: [48, 61], voices: 3, vel: 0.58 },
    accomp2: { inst: 'accordion', pattern: 'block', range: [48, 61], voices: 3, vel: 0.3, on: 'B' },
    bass: { inst: 'upright', pattern: 'tresillo', range: [33, 45], vel: 0.8 },
    perc: { pattern: 'light', on: 'always', vel: 0.36 },
    mix: {
      melody: { gain: 0.88, pan: 0.05, send: 0.28 },
      accomp: { gain: 0.62, pan: -0.28, send: 0.24 },
      accomp2: { gain: 0.34, pan: 0.3, send: 0.3 },
      bass: { gain: 0.68, pan: 0, send: 0.06 },
      perc: { gain: 0.3, pan: 0.22, send: 0.16 },
    },
    rest: [2, 4],
    gain: 0.9,
    sheen: 2.5,
  },

  /**
   * Dawn — a hymn in 3/4 for the Lantern Hall restorations (and the town telling Glimmer no): a
   * fiddle tune that climbs from the third to the octave, a B strain rising to its high A over the
   * dominant, and a lift of a whole step into the last A where the hand bells double the tune.
   */
  'event-dawn': {
    id: 'event-dawn',
    title: 'Lanterns Relit',
    blurb: 'The Hall wakes',
    bpm: 76,
    meter: '3/4',
    key: 62, // D
    mode: 'major',
    lift: 2,
    form: EVENT_FORM_LONG,
    breaks: 'breath',
    prog: {
      intro: ['IV', 'I'],
      A: ['I', 'IV', 'I', 'V', 'vi', 'IV', 'V7', 'I'],
      Aend: ['V7', 'I'],
      B: ['IV', 'V', 'iii', 'vi', 'ii', 'V', 'IV', 'V7'],
      outro: ['IV', 'I'],
    },
    melody: {
      inst: 'fiddle', range: [62, 86], density: 0.45, legato: true, ornament: 0.2,
      double: { inst: 'bell', interval: 12, on: 'late' },
      tune: {
        octave: 0,
        // "F♯... A | B... D' | D'.. C♯ B | A..... | F♯'.. E' D' | B.. D' G' | E'.. D' C♯ | D'....." —
        A: ['3:4 5:2', "6:4 1':2", "1':3 7:1 6:2", '5:6', "3':3 2':1 1':2", "6:3 1':1 4':2", "2':3 1':1 7:2", "1':6"],
        Aend: ["5:2 7:2 2':2", "1':6"],
        B: ["4':3 3':1 2':2", "2':3 1':1 7:2", '7:3 6:1 5:2', '6:4 r:2', "2':3 3':1 4':2", "5':4 2':2", "4':2 3':2 2':2", '7:2 5:2 4:2'],
      },
    },
    counter: { inst: 'cello', range: [45, 59], on: 'repeat', style: 'moving' },
    accomp: { inst: 'harp', pattern: 'waltzArp', range: [50, 63], voices: 4, vel: 0.5 },
    bass: { inst: 'softBass', pattern: 'waltz', range: [38, 50], vel: 0.5 },
    pad: { inst: 'pad', range: [52, 63], voices: 3, vel: 0.3, on: 'always' },
    mix: {
      melody: { gain: 0.92, pan: 0.04, send: 0.45 },
      double: { gain: 0.16, pan: 0.3, send: 0.6 },
      counter: { gain: 0.44, pan: -0.3, send: 0.42 },
      accomp: { gain: 0.56, pan: 0.24, send: 0.4 },
      bass: { gain: 0.38, pan: 0, send: 0.08 },
      pad: { gain: 0.3, pan: 0, send: 0.6 },
    },
    rest: [2, 4],
    gain: 0.9,
    sheen: 2.5,
  },
};

export type EventCue = 'event-tender' | 'event-playful' | 'event-wistful' | 'event-mystery' | 'event-sly' | 'event-dawn';

/** Heart events (src/data/npcs.ts ids) and story scenes (src/data/story-scenes.ts) → their cue. */
const CUES: Record<string, EventCue> = {
  'marigold-2': 'event-mystery', // The Missing Accountant
  'marigold-4': 'event-wistful', // Rosalind's Ledger
  'bram-2': 'event-playful', // The Burnt Batch
  'bram-4': 'event-tender', // A Song for the Dark Hall
  'wren-2': 'event-tender', // Painting the Bridge
  'wren-4': 'event-wistful', // The Grey Lantern
  'odessa-2': 'event-playful', // Sparks
  'odessa-4': 'event-mystery', // The Lantern Cage
  'linus-2': 'event-tender', // House Call
  'linus-4': 'event-wistful', // The Letter in the Drawer
  'june-2': 'event-wistful', // The Empty Chair
  'june-4': 'event-tender', // A Candle in the Window
  'tobias-2': 'event-mystery', // The Lamplighter's Match
  'tobias-4': 'event-wistful', // Rosalind's Bench
  'kit-2': 'event-playful', // The Great Frog Expedition
  'kit-4': 'event-mystery', // The Secret Map
  'rowan-2': 'event-playful', // Measure Twice
  'rowan-4': 'event-wistful', // The Letter from the City
  'hazel-2': 'event-playful', // The Stubborn Rose
  'hazel-4': 'event-tender', // The Seed Tin
  // Story scenes.
  'hall-first': 'event-mystery',
  'glimmer-survey': 'event-sly',
  'glimmer-marigold': 'event-sly',
  'glimmer-offer': 'event-sly',
  'glimmer-time': 'event-sly',
  'glimmer-concede': 'event-sly',
  'glimmer-return': 'event-sly',
  'glimmer-accept': 'event-wistful',
  'glimmer-refuse': 'event-dawn',
};

/** Dialogue moods (DialogueMood in the town pod's data) → the cue they vote for. */
const MOOD_VOTE: Record<string, EventCue> = {
  laugh: 'event-playful',
  happy: 'event-playful',
  surprised: 'event-playful',
  blush: 'event-tender',
  sad: 'event-wistful',
  wistful: 'event-wistful',
  worried: 'event-mystery',
  thinking: 'event-mystery',
  angry: 'event-sly',
};

/**
 * The cue for a heart event / story scene: the table first, else a vote over its lines' moods
 * (ties → tender), else null (scene keeps the place's music). Story scenes with no entry return null.
 */
export function eventCue(id: string, moods?: readonly (string | undefined)[]): EventCue | null {
  const hit = CUES[id];
  if (hit) return hit;
  // Lantern Hall room restorations (story-scenes.ts ROOM_SCENES 'room-<id>'): the hymn.
  if (id.startsWith('room-')) return 'event-dawn';
  if (!moods || !moods.length) return null;
  const votes = new Map<EventCue, number>();
  for (const m of moods) {
    const c = m ? MOOD_VOTE[m] : undefined;
    if (c) votes.set(c, (votes.get(c) ?? 0) + 1);
  }
  let best: EventCue | null = null;
  let n = 0;
  for (const [c, v] of votes) if (v > n || (v === n && c === 'event-tender')) [best, n] = [c, v];
  return best ?? 'event-tender';
}

export const EVENT_CUES = Object.keys(SONGBOOK_EVENTS) as EventCue[];
