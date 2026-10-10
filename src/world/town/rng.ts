/**
 * Town RNG (r15, determinism): every ambient choice the town makes at run time — villager blink /
 * look-around phases, wander targets, chat emotes, bark cooldowns, gift-burst sparkles, forge sparks —
 * draws from a named stream forked off one town seed instead of Math.random(), so a demo staged with
 * the same seed (`?townseed=N`, default 1) plays the same barks, idles and staging frame for frame.
 *
 * Streams are created lazily per label (`npcs.wander`, `villager.<id>`, `fx.burst` …) and every one is
 * reset when the seed changes (`setTownSeed`, called by demo staging). `townRngState()` is surfaced in
 * `__game.info().town.rng` for critics and tests.
 */
import { Rng, hashString } from '../../core/rng';

let seed = 1;
const streams = new Map<string, { rng: Rng; n: number }>();

function initialSeed(): number {
  try {
    const q = new URLSearchParams(globalThis.location?.search ?? '').get('townseed');
    if (q !== null && q !== '') return /^\d+$/.test(q) ? Number(q) >>> 0 : hashString(q);
  } catch {
    /* no location (tests) */
  }
  return 1;
}
seed = initialSeed();

/** The active town seed. */
export function townSeed(): number {
  return seed;
}

/** Reseed every town stream (demo staging calls this so a capture replays identically). */
export function setTownSeed(s: number | string = seed): void {
  seed = typeof s === 'string' ? hashString(s) : s >>> 0;
  streams.clear();
}

/** A named stream: stable for (seed, label), reset on reseed. */
export function townRng(label: string): Rng {
  let s = streams.get(label);
  if (!s) {
    s = { rng: new Rng((seed ^ hashString(label)) >>> 0 || 1), n: 0 };
    streams.set(label, s);
  }
  return s.rng;
}

/** Next float in [0,1) from the named stream (drop-in for Math.random()). */
export function townRand(label: string): number {
  townRng(label);
  const s = streams.get(label)!;
  s.n++;
  return s.rng.next();
}

/** Debug: the seed and how many draws each stream has taken. */
export function townRngState(): { seed: number; streams: Record<string, number> } {
  const out: Record<string, number> = {};
  for (const [k, v] of streams) out[k] = v.n;
  return { seed, streams: out };
}
