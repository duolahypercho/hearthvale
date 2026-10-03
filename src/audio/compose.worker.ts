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
import { noteRecipes, recipeRate, renderRecipe, sfxPalette } from './instruments';
import { chordPcs, parseChord } from './theory';

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

/** A song is starting whose notes (some of them evicted since) the main thread is missing: render them now, in order of use. */
interface Ensure {
  ensure: [Piece['events'][number]['inst'], number][];
  sr: number;
}

const scope = self as unknown as { onmessage: ((e: MessageEvent<Req | Evict | Ensure>) => void) | null; postMessage(m: Out, transfer?: Transferable[]): void };

/** Seconds of the song whose notes are rendered before the piece is handed over. */
const HEAD_SECONDS = 3;

/** Keys already sent at a sample rate (the main thread keeps them in its LRU note cache). */
const sent = new Set<string>();

/** A song whose remaining notes are still to be rendered (newest first). */
interface Tail {
  sr: number;
  todo: { inst: Piece['events'][number]['inst']; midi: number }[];
}
const tails: Tail[] = [];
let pumping = false;

let batch: { key: string; data: Float32Array; sr: number }[] = [];
let bytes = 0;
function flush(): void {
  if (!batch.length) return;
  scope.postMessage({ notes: batch }, batch.map((n) => n.data.buffer as ArrayBuffer));
  batch = [];
  bytes = 0;
}
function render(inst: Piece['events'][number]['inst'], midi: number, sr: number): void {
  for (const r of noteRecipes(inst, midi)) {
    const k = `${r.key}@${sr}`;
    if (sent.has(k)) continue;
    sent.add(k);
    const data = renderRecipe(r, sr);
    batch.push({ key: r.key, data, sr: recipeRate(r, sr) });
    bytes += data.byteLength;
    if (bytes > 2_000_000 || batch.length >= 8) flush();
  }
}

/**
 * Render the queued song tails ~25 ms at a time, the newest song first, yielding between slices so a
 * new song request (a change of place) is composed and its head rendered at once instead of waiting
 * behind the whole of the previous song's notes. Only the two newest songs are kept in the queue.
 */
function pump(): void {
  const t0 = performance.now();
  while (tails.length && performance.now() - t0 < 25) {
    const job = tails[0]!;
    const n = job.todo.shift();
    if (!n) {
      tails.shift();
      continue;
    }
    render(n.inst, n.midi, job.sr);
  }
  flush();
  if (tails.length) setTimeout(pump, 0);
  else pumping = false;
}

scope.onmessage = (e) => {
  if ('evict' in e.data) {
    for (const k of e.data.evict) sent.delete(`${k}@${e.data.sr}`);
    return;
  }
  if ('ensure' in e.data) {
    const { ensure, sr: rate } = e.data;
    // The main thread knows these are missing: whatever we think we sent, send them again.
    for (const [inst, midi] of ensure) for (const r of noteRecipes(inst, midi)) sent.delete(`${r.key}@${rate}`);
    // The first few (due in the song's opening second) at once, the rest ahead of every other job.
    const head = ensure.slice(0, 12);
    for (const [inst, midi] of head) render(inst, midi, rate);
    flush();
    tails.unshift({ sr: rate, todo: ensure.slice(12).map(([inst, midi]) => ({ inst, midi })) });
    while (tails.length > 3) tails.pop();
    if (!pumping) {
      pumping = true;
      setTimeout(pump, 0);
    }
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
  // The opening bars' notes go out before the piece itself (typically 10–30 notes, ~50–150 ms), so
  // the song's first downbeat never waits on a synthesis on the frame; the rest stream in behind it,
  // in time order, far ahead of the scheduler (a note renders in ~5 ms, the song plays for minutes).
  const events = [...piece.events].sort((x, y) => x.t - y.t);
  // The key bridge (music.ts buildBridge) rolls the new tonic on the song's accompaniment
  // instrument (or the harp) an octave over 55–72 before the first bar: render those first.
  const roll = theme.accomp?.inst ?? 'harp';
  const tonic = parseChord(theme.mode === 'major' || theme.mode === 'lydian' || theme.mode === 'mixolydian' ? 'I' : 'i');
  const pcs = chordPcs(tonic, theme.key % 12);
  if (events.length) for (let m = 67; m <= 84; m++) if (pcs.includes(m % 12)) render(roll, m, sr);
  let i = 0;
  for (; i < events.length && events[i]!.t < HEAD_SECONDS; i++) render(events[i]!.inst, events[i]!.midi, sr);
  flush();
  scope.postMessage({ key, piece });
  // The rest of the song, then the chimes the SFX will strike in its key (reward / menu jingles follow
  // the score's key), queued ahead of any older song's leftovers.
  const todo = events.slice(i).map((ev) => ({ inst: ev.inst, midi: ev.midi }));
  if (events.length) for (const p of sfxPalette(theme.key)) todo.push({ inst: p.inst, midi: p.midi });
  tails.unshift({ sr, todo });
  // An older song's unrendered notes are forgotten (the main thread's LRU would drop them anyway);
  // if it plays again it is requested again.
  while (tails.length > 2) {
    const old = tails.pop()!;
    void old;
  }
  if (!pumping) {
    pumping = true;
    setTimeout(pump, 0);
  }
};
