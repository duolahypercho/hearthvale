/**
 * Piece prefetch: composes upcoming songs in a Web Worker (src/audio/compose.worker.ts) so starting a
 * song never stalls the frame. The audio system requests the first song as soon as the save loads
 * (before the AudioContext even exists) and the director requests (theme, seed) as soon as it can
 * predict it — while the old song fades or the score rests — and takes the finished piece at start
 * time. In real time the director waits for the worker rather than composing on the frame; only
 * without a Worker (offline renders, tests) or with a crashed one is a song composed synchronously.
 * The worker then renders the piece's cached mallet / string notes and they land in the graph's note
 * cache (`attach`), so a new pitch never costs the frame a 5–40 ms synthesis either.
 */
import { Composer, type Piece, type ThemeDef } from './composer';
import type { AudioGraph } from './graph';
import { noteKeys, sfxPalette } from './instruments';
import { chordPcs, parseChord } from './theory';
import type { WorkerNote } from './compose.worker';
import { offFrame } from './cost';

export class PiecePrefetch {
  private worker: Worker | null = null;
  private ready = new Map<string, Piece>();
  /** Theme of each requested piece (its key bridge's notes are pinned with its opening). */
  private themeOf = new Map<string, ThemeDef>();
  private pending = new Set<string>();
  /**
   * Pieces kept ready whatever else is composed (round 12: the scene cues and the title — a heart
   * event's cue composed on the frame cost a 30-70 ms hitch while its camera moved).
   */
  private pinned = new Set<string>();
  /** Diagnostics: pieces served from the worker vs composed on the main thread. */
  hits = 0;
  misses = 0;
  /** Main-thread milliseconds spent composing (fallbacks only). */
  syncMs = 0;
  private graph: AudioGraph | null = null;
  /** Notes rendered before the AudioContext existed (the opening song is requested at save load). */
  private early: WorkerNote[] = [];
  /** Note render rate: the context's once attached; before that a guess (a mismatch only resamples). */
  private sr = 48000;

  constructor(useWorker: boolean) {
    if (!useWorker || typeof Worker === 'undefined') return;
    try {
      this.worker = new Worker(new URL('./compose.worker.ts', import.meta.url), { type: 'module' });
      // (Charged to the audio stack's off-frame account: `info().perf.frame.audioMsPerSec`.)
      this.worker.onmessage = (e: MessageEvent<{ key: string; piece?: Piece } | { notes: WorkerNote[] }>) => offFrame(() => {
        if ('notes' in e.data) {
          for (const n of e.data.notes) {
            if (this.graph) this.graph.provide(n.key, n.data, n.sr, n.scale);
            else if (this.early.length < 1500) this.early.push(n);
            // Kept no room for it: the worker must send it again once the song asks (never the frame).
            else this.worker?.postMessage({ evict: [n.key], sr: this.sr });
          }
          return;
        }
        this.pending.delete(e.data.key);
        if (e.data.piece) {
          this.ready.set(e.data.key, e.data.piece);
          // Its opening bars are pinned in the note cache until it plays (a song predicted a whole
          // song ahead must not find its downbeat evicted by the time it starts).
          // (Pinned scene pieces don't take the next song's place in the note cache's pin.)
          if (!this.pinned.has(e.data.key)) this.graph?.pinNext(PiecePrefetch.openingKeys(e.data.piece, this.themeOf.get(e.data.key)));
        }
        // Keep the cache small: only the next few songs (and forced demo / cutscene themes) matter.
        while (this.ready.size > 6 + this.pinned.size) {
          const drop = [...this.ready.keys()].find((k) => !this.pinned.has(k));
          if (!drop) break;
          this.ready.delete(drop);
        }
      });
      this.worker.onerror = () => {
        this.worker?.terminate();
        this.worker = null;
        this.pending.clear();
      };
    } catch {
      this.worker = null;
    }
  }

  /** Real-time graph: worker-rendered notes go straight into its cache from now on. */
  attach(g: AudioGraph): void {
    this.graph = g;
    this.sr = g.ctx.sampleRate;
    // A note the LRU drops must come from the worker again next time a song needs it (not the frame).
    let evicted: string[] = [];
    g.onEvict = (key) => {
      if (!this.worker) return;
      if (!evicted.length) {
        queueMicrotask(() => {
          this.worker?.postMessage({ evict: evicted, sr: this.sr });
          evicted = [];
        });
      }
      evicted.push(key);
    };
    for (const n of this.early) g.provide(n.key, n.data, n.sr, n.scale);
    this.early = [];
  }

  /**
   * A song starts: any of its notes the graph's cache no longer holds (the LRU dropped them while
   * other songs played) are asked of the worker again, in order of first use — so a song coming
   * back later in the session never renders its notes on the frame.
   */
  ensure(piece: Piece, g: AudioGraph, key: number): void {
    if (!this.worker || g !== this.graph) return;
    const want: [Piece['events'][number]['inst'], number][] = [];
    const seen = new Set<string>();
    const events = [...piece.events].sort((x, y) => x.t - y.t);
    for (const ev of events) {
      const id = `${ev.inst}:${ev.midi}`;
      if (seen.has(id)) continue;
      seen.add(id);
      const keys = noteKeys(ev.inst, ev.midi);
      if (keys.length && keys.some((k) => !g.hasBuffer(k))) want.push([ev.inst, ev.midi]);
    }
    // ...and the chimes the SFX strike in the song's key.
    for (const p of sfxPalette(key)) {
      const keys = noteKeys(p.inst, p.midi);
      if (keys.some((k) => !g.hasBuffer(k))) want.push([p.inst, p.midi]);
    }
    if (want.length) this.worker.postMessage({ ensure: want, sr: this.sr });
  }

  private urgentAt = new Map<string, number>();
  /**
   * The scheduler is holding a note back because its buffer hasn't landed: ask the worker for it
   * ahead of everything else (at most every 1.5 s per pitch), so the frame's last-moment fallback
   * render never has to run.
   */
  urgent(inst: Piece['events'][number]['inst'], midi: number): void {
    if (!this.worker) return;
    const id = `${inst}:${midi}`;
    const now = performance.now();
    if (now - (this.urgentAt.get(id) ?? -1e9) < 1500) return;
    if (this.urgentAt.size > 400) this.urgentAt.clear();
    this.urgentAt.set(id, now);
    this.worker.postMessage({ ensure: [[inst, midi]], sr: this.sr });
  }

  /** Note keys of a piece's opening: the intro and its first four bars of tune (≥ 12 s). */
  static openingKeys(piece: Piece, theme?: ThemeDef): Set<string> {
    const bars = piece.barInfo ?? [];
    let firstA = bars.findIndex((b) => b.section === 'A');
    if (firstA < 0) firstA = 0;
    const until = Math.max(12, bars[firstA + 4]?.t ?? piece.duration);
    const keys = new Set<string>();
    const seen = new Set<string>();
    for (const ev of piece.events) {
      if (ev.t > until) continue;
      const id = `${ev.inst}${ev.midi}`;
      if (seen.has(id)) continue;
      seen.add(id);
      for (const k of noteKeys(ev.inst, ev.midi)) keys.add(k);
    }
    // The key bridge (music.ts buildBridge) rolls the tonic triad on the accompaniment instrument
    // over 67–84 before the first bar: those notes play the instant the song starts.
    if (theme) {
      const roll = theme.accomp?.inst ?? 'harp';
      const pcs = chordPcs(parseChord(theme.mode === 'major' || theme.mode === 'lydian' || theme.mode === 'mixolydian' ? 'I' : 'i'), theme.key % 12);
      for (let m = 67; m <= 84; m++) if (pcs.includes(m % 12)) for (const k of noteKeys(roll, m)) keys.add(k);
    }
    return keys;
  }

  /** True while a worker is available (real time); without one songs are composed directly. */
  get hasWorker(): boolean {
    return this.worker !== null;
  }

  private static key(theme: ThemeDef, seed: number): string {
    return `${theme.id}#${seed}`;
  }

  /** Ask for a piece ahead of time (no-op without a worker or when already requested). */
  request(theme: ThemeDef, seed: number): void {
    const k = PiecePrefetch.key(theme, seed);
    if (!this.worker || this.ready.has(k) || this.pending.has(k)) return;
    this.pending.add(k);
    this.themeOf.set(k, theme);
    if (this.themeOf.size > 12) this.themeOf.delete(this.themeOf.keys().next().value!);
    this.worker.postMessage({ key: k, theme, seed, sr: this.sr });
  }

  /** Keep (theme, seed) composed and ready until it is taken (scene cues, the title). */
  pin(theme: ThemeDef, seed: number): void {
    const k = PiecePrefetch.key(theme, seed);
    if (!this.worker || this.pinned.has(k)) return;
    // Old pins of the same theme (an earlier day's seed) give their place up.
    for (const p of this.pinned) {
      if (p.startsWith(`${theme.id}#`)) {
        this.pinned.delete(p);
        this.ready.delete(p);
      }
    }
    this.pinned.add(k);
    this.request(theme, seed);
  }

  /** True when the piece for (theme, seed) is either ready or not coming (so waiting is pointless). */
  settled(theme: ThemeDef, seed: number): boolean {
    return !this.pending.has(PiecePrefetch.key(theme, seed));
  }

  /** The piece for (theme, seed): prefetched if ready, else composed right now. */
  take(theme: ThemeDef, seed: number): Piece {
    const k = PiecePrefetch.key(theme, seed);
    const p = this.ready.get(k);
    if (p) {
      this.ready.delete(k);
      this.pinned.delete(k);
      this.hits++;
      return p;
    }
    this.misses++;
    const t0 = performance.now();
    const piece = new Composer(theme, seed).compose();
    this.syncMs += performance.now() - t0;
    return piece;
  }
}
