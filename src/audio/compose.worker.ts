/**
 * Composition off the main thread. Arranging a song (harmony, voice leading, figuration, humanising:
 * ~1 000–1 300 note events) costs 5–40 ms of JS — enough to drop frames if it ran in the game loop at
 * the moment a song starts. The music director asks for the next piece ahead of time (during the
 * rest between songs / the crossfade) and this worker composes it; see src/audio/prefetch.ts.
 *
 * Then it renders the song's cached notes: every mallet / plucked pitch (both round-robin strikes)
 * the piece will ask for, in order of first use, is synthesised here and posted back as samples, so
 * the 5–40 ms a modal bell or Karplus-Strong string costs never lands on a frame either.
 */
import { Composer, type Piece, type ThemeDef } from './composer';
import { noteRecipes, renderRecipe, sfxPalette } from './instruments';

interface Req {
  key: string;
  theme: ThemeDef;
  seed: number;
  /** Sample rate to render notes at (0 = compose only). */
  sr?: number;
}

type Out = { key: string; piece?: Piece; error?: string } | { notes: { key: string; data: Float32Array; sr: number }[] };

/** The main thread's LRU dropped these notes: render them again when a song needs them. */
interface Evict {
  evict: string[];
  sr: number;
}

const scope = self as unknown as { onmessage: ((e: MessageEvent<Req | Evict>) => void) | null; postMessage(m: Out, transfer?: Transferable[]): void };

/** Seconds of the song whose notes are rendered before the piece is handed over. */
const HEAD_SECONDS = 3;

/** Keys already sent at a sample rate (the main thread keeps them in its LRU note cache). */
const sent = new Set<string>();

scope.onmessage = (e) => {
  if ('evict' in e.data) {
    for (const k of e.data.evict) sent.delete(`${k}@${e.data.sr}`);
    return;
  }
  const { key, theme, seed, sr } = e.data;
  let piece: Piece;
  try {
    piece = new Composer(theme, seed).compose();
  } catch (err) {
    scope.postMessage({ key, error: String(err) });
    return;
  }
  if (!sr) {
    scope.postMessage({ key, piece });
    return;
  }
  let batch: { key: string; data: Float32Array; sr: number }[] = [];
  let bytes = 0;
  const flush = (): void => {
    if (!batch.length) return;
    scope.postMessage({ notes: batch }, batch.map((n) => n.data.buffer as ArrayBuffer));
    batch = [];
    bytes = 0;
  };
  const render = (ev: Piece['events'][number]): void => {
    for (const r of noteRecipes(ev.inst, ev.midi)) {
      const k = `${r.key}@${sr}`;
      if (sent.has(k)) continue;
      sent.add(k);
      const data = renderRecipe(r, sr);
      batch.push({ key: r.key, data, sr });
      bytes += data.byteLength;
      if (bytes > 2_000_000 || batch.length >= 8) flush();
    }
  };
  // The opening bars' notes go out before the piece itself (typically 10–30 notes, ~50–150 ms), so
  // the song's first downbeat never waits on a synthesis on the frame; the rest stream in behind it,
  // in time order, far ahead of the scheduler (a note renders in ~5 ms, the song plays for minutes).
  const events = [...piece.events].sort((x, y) => x.t - y.t);
  let i = 0;
  for (; i < events.length && events[i]!.t < HEAD_SECONDS; i++) render(events[i]!);
  flush();
  scope.postMessage({ key, piece });
  for (; i < events.length; i++) render(events[i]!);
  // Then the chimes the SFX will strike in this song's key (reward / menu jingles follow the score's key).
  if (events.length) for (const p of sfxPalette(theme.key)) render({ ...events[0]!, inst: p.inst, midi: p.midi });
  flush();
};
