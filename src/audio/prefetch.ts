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

export class PiecePrefetch {
  private worker: Worker | null = null;
  private ready = new Map<string, Piece>();
  private pending = new Set<string>();
  /** Diagnostics: pieces served from the worker vs composed on the main thread. */
  hits = 0;
  misses = 0;
  /** Main-thread milliseconds spent composing (fallbacks only). */
  syncMs = 0;
  private graph: AudioGraph | null = null;
  /** Notes rendered before the AudioContext existed (the opening song is requested at save load). */
  private early: { key: string; data: Float32Array; sr: number }[] = [];
  /** Note render rate: the context's once attached; before that a guess (a mismatch only resamples). */
  private sr = 48000;

  constructor(useWorker: boolean) {
    if (!useWorker || typeof Worker === 'undefined') return;
    try {
      this.worker = new Worker(new URL('./compose.worker.ts', import.meta.url), { type: 'module' });
      this.worker.onmessage = (e: MessageEvent<{ key: string; piece?: Piece } | { notes: { key: string; data: Float32Array; sr: number }[] }>) => {
        if ('notes' in e.data) {
          for (const n of e.data.notes) {
            if (this.graph) this.graph.provide(n.key, n.data, n.sr);
            else if (this.early.length < 400) this.early.push(n);
          }
          return;
        }
        this.pending.delete(e.data.key);
        if (e.data.piece) this.ready.set(e.data.key, e.data.piece);
        // Keep the cache small: only the next few songs (and forced demo / cutscene themes) matter.
        while (this.ready.size > 6) this.ready.delete(this.ready.keys().next().value!);
      };
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
    for (const n of this.early) g.provide(n.key, n.data, n.sr);
    this.early = [];
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
    this.worker.postMessage({ key: k, theme, seed, sr: this.sr });
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
