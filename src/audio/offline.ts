/**
 * Offline renders for critics and regression checks (driven by scripts/audio-render.mjs in
 * headless Chromium): every theme, ambience preset and SFX rendered through the real mixer graph
 * (limiter included) with an OfflineAudioContext. Results come back as base64 Float32 stereo.
 */
import { AudioGraph } from './graph';
import { scheduleTheme } from './music';
import { Ambience, type EnvState } from './ambience';
import { Sfx, SFX_NAMES, VOICES } from './sfx';
import { THEMES, THEME_IDS } from './themes';
import { Composer } from './composer';

export interface Rendered {
  name: string;
  sampleRate: number;
  /** base64 of interleaved Float32 stereo. */
  data: string;
  frames: number;
  markers?: { name: string; t: number }[];
  notes?: number;
}

function encode(buf: AudioBuffer): string {
  const L = buf.getChannelData(0);
  const R = buf.numberOfChannels > 1 ? buf.getChannelData(1) : L;
  const inter = new Float32Array(L.length * 2);
  for (let i = 0; i < L.length; i++) {
    inter[i * 2] = L[i]!;
    inter[i * 2 + 1] = R[i]!;
  }
  const bytes = new Uint8Array(inter.buffer);
  let s = '';
  const CH = 0x8000;
  for (let i = 0; i < bytes.length; i += CH) s += String.fromCharCode(...bytes.subarray(i, i + CH));
  return btoa(s);
}

const ENV = (o: Partial<EnvState>): EnvState => ({ map: 'farm', hour: 9, season: 'spring', weather: 'sun', night: 0, fountain: 0, water: 0, indoor: false, key: 60, ...o });

export const AMBIENCE_PRESETS: Record<string, EnvState> = {
  'farm-spring-morning': ENV({ hour: 7.5 }),
  'farm-summer-noon': ENV({ hour: 13, season: 'summer' }),
  'farm-fall-wind': ENV({ hour: 15, season: 'fall', weather: 'wind' }),
  'farm-winter-snow': ENV({ hour: 11, season: 'winter', weather: 'snow' }),
  'farm-summer-night': ENV({ hour: 22.5, season: 'summer', night: 1, water: 0.4 }),
  'farm-rain': ENV({ hour: 14, weather: 'rain' }),
  'farm-storm': ENV({ hour: 16, weather: 'storm' }),
  'town-day': ENV({ map: 'town', hour: 11, fountain: 0.8 }),
  beach: ENV({ map: 'beach', hour: 16, season: 'summer', water: 1 }),
  mine: ENV({ map: 'mine', hour: 12 }),
};

/** Which ambience goes under each theme in the "mix" renders. */
const MIX_ENV: Record<string, EnvState> = {
  spring: AMBIENCE_PRESETS['farm-spring-morning']!,
  summer: AMBIENCE_PRESETS['farm-summer-noon']!,
  fall: ENV({ hour: 15, season: 'fall' }),
  winter: AMBIENCE_PRESETS['farm-winter-snow']!,
  town: AMBIENCE_PRESETS['town-day']!,
  beach: AMBIENCE_PRESETS.beach!,
  mine: AMBIENCE_PRESETS.mine!,
  night: AMBIENCE_PRESETS['farm-summer-night']!,
  rain: AMBIENCE_PRESETS['farm-rain']!,
  festival: ENV({ map: 'town', hour: 20, season: 'summer', night: 0.8, fountain: 0.5 }),
  title: ENV({ hour: 18.7 }),
};

async function render(seconds: number, sr: number, build: (g: AudioGraph) => void): Promise<AudioBuffer> {
  const ctx = new OfflineAudioContext(2, Math.ceil(sr * seconds), sr);
  const g = new AudioGraph(ctx, 1234);
  build(g);
  return ctx.startRendering();
}

function tickAmbience(g: AudioGraph, env: EnvState, seconds: number): void {
  const amb = new Ambience(g, 7);
  for (let t = 0; t < seconds; t += 0.05) amb.tick(t, env, 0.12);
}

export async function renderTheme(id: string, seconds = 30, sr = 44100, seed = 1, withAmbience = false): Promise<Rendered> {
  let notes = 0;
  const buf = await render(seconds, sr, (g) => {
    scheduleTheme(g, id, seconds, seed);
    notes = new Composer(THEMES[id]!, seed).compose().events.filter((e) => e.t < seconds).length;
    if (withAmbience) tickAmbience(g, { ...MIX_ENV[id]!, key: THEMES[id]!.key }, seconds);
  });
  return { name: withAmbience ? `mix-${id}` : `theme-${id}`, sampleRate: sr, data: encode(buf), frames: buf.length, notes };
}

export async function renderAmbience(preset: string, seconds = 30, sr = 44100): Promise<Rendered> {
  const env = AMBIENCE_PRESETS[preset];
  if (!env) throw new Error(`unknown ambience preset ${preset}`);
  const buf = await render(seconds, sr, (g) => tickAmbience(g, env, seconds));
  return { name: `amb-${preset}`, sampleRate: sr, data: encode(buf), frames: buf.length };
}

/** Every SFX in sequence (1.6 s apart; long stingers get more room) + a line of dialogue per voice. */
export async function renderSfxReel(sr = 44100): Promise<Rendered> {
  const markers: { name: string; t: number }[] = [];
  let t = 0.3;
  const long: Record<string, number> = { treefall: 3.2, hall: 5, lantern: 3.5, catch: 2.4, 'catch:perfect': 2.6, water: 2, cast: 2.2, sleep: 2.4, thunder: 3 };
  for (const n of SFX_NAMES) {
    if (n === 'reel' || n === 'blip') continue;
    markers.push({ name: n, t });
    t += long[n] ?? 1.3;
  }
  for (const v of Object.keys(VOICES)) {
    markers.push({ name: `voice:${v}`, t });
    t += 2.2;
  }
  markers.push({ name: 'reel', t });
  t += 2;
  const seconds = t + 1;
  const buf = await render(seconds, sr, (g) => {
    const sfx = new Sfx(g, 5);
    sfx.key = 62;
    for (const m of markers) {
      if (m.name.startsWith('voice:')) {
        const voice = VOICES[m.name.slice(6)]!;
        const line = 'Well hello there, neighbour! Lovely morning?';
        let k = 0;
        for (let i = 0; i < line.length; i += 2) {
          const ch = line[i]!;
          if (ch !== ' ') sfx.blip(voice, ch, { at: m.t + k * 0.045 / voice.rate });
          k++;
        }
      } else if (m.name === 'reel') {
        for (let tt = 0; tt < 1.5; tt += 0.06) sfx.play('reel', { at: m.t + tt, gain: 0.8 });
      } else sfx.play(m.name, { at: m.t });
    }
  });
  return { name: 'sfx-reel', sampleRate: sr, data: encode(buf), frames: buf.length, markers };
}

export function listThemes(): string[] {
  return THEME_IDS;
}
export function listAmbience(): string[] {
  return Object.keys(AMBIENCE_PRESETS);
}

/** Symbolic dump of a composed piece (for reading the composition without listening). */
export function describePiece(id: string, seed = 1): { theme: string; bars: number; duration: number; melody: string[] } {
  const th = THEMES[id]!;
  const p = new Composer(th, seed).compose();
  const names = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
  const mel = p.events.filter((e) => e.track === 'melody').slice(0, 48).map((e) => `${names[e.midi % 12]}${Math.floor(e.midi / 12) - 1}@${e.t.toFixed(2)}`);
  return { theme: id, bars: p.bars, duration: p.duration, melody: mel };
}

/** Composed events + bar grid for piano-roll plots. */
export function pieceData(id: string, seed = 1, seconds = 30): { events: { t: number; track: string; midi: number; dur: number; vel: number }[]; bars: { t: number; chords: string; section: string }[] } {
  const p = new Composer(THEMES[id]!, seed).compose();
  return {
    events: p.events.filter((e) => e.t < seconds).map((e) => ({ t: e.t, track: e.track, midi: e.midi, dur: e.dur, vel: e.vel })),
    bars: (p.barInfo ?? []).filter((b) => b.t < seconds),
  };
}
