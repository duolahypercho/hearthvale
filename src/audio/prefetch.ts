/**
 * Piece prefetch: composes upcoming songs in a Web Worker (src/audio/compose.worker.ts) so starting a
 * song never stalls the frame. The director requests (theme, seed) as soon as it can predict it —
 * while the old song fades or the score rests — and takes the finished piece at start time. Anything
 * not ready yet (or no Worker: offline renders, tests) falls back to composing synchronously, so
 * the music is identical either way (same Composer, same seed).
 */
import { Composer, type Piece, type ThemeDef } from './composer';

export class PiecePrefetch {
  private worker: Worker | null = null;
  private ready = new Map<string, Piece>();
  private pending = new Set<string>();
  /** Diagnostics: pieces served from the worker vs composed on the main thread. */
  hits = 0;
  misses = 0;
  /** Main-thread milliseconds spent composing (fallbacks only). */
  syncMs = 0;

  constructor(useWorker: boolean) {
    if (!useWorker || typeof Worker === 'undefined') return;
    try {
      this.worker = new Worker(new URL('./compose.worker.ts', import.meta.url), { type: 'module' });
      this.worker.onmessage = (e: MessageEvent<{ key: string; piece?: Piece }>) => {
        this.pending.delete(e.data.key);
        if (e.data.piece) this.ready.set(e.data.key, e.data.piece);
        // Keep the cache tiny: only the next song or two are ever useful.
        while (this.ready.size > 4) this.ready.delete(this.ready.keys().next().value!);
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

  private static key(theme: ThemeDef, seed: number): string {
    return `${theme.id}#${seed}`;
  }

  /** Ask for a piece ahead of time (no-op without a worker or when already requested). */
  request(theme: ThemeDef, seed: number): void {
    const k = PiecePrefetch.key(theme, seed);
    if (!this.worker || this.ready.has(k) || this.pending.has(k)) return;
    this.pending.add(k);
    this.worker.postMessage({ key: k, theme, seed });
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
