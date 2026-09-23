/**
 * Composition off the main thread. Arranging a song (harmony, voice leading, figuration, humanising:
 * ~1 000–1 300 note events) costs 5–40 ms of JS — enough to drop frames if it ran in the game loop at
 * the moment a song starts. The music director asks for the next piece ahead of time (during the
 * rest between songs / the crossfade) and this worker composes it; see src/audio/prefetch.ts.
 */
import { Composer, type Piece, type ThemeDef } from './composer';

interface Req {
  key: string;
  theme: ThemeDef;
  seed: number;
}

const scope = self as unknown as { onmessage: ((e: MessageEvent<Req>) => void) | null; postMessage(m: { key: string; piece?: Piece; error?: string }): void };

scope.onmessage = (e) => {
  const { key, theme, seed } = e.data;
  try {
    scope.postMessage({ key, piece: new Composer(theme, seed).compose() });
  } catch (err) {
    scope.postMessage({ key, error: String(err) });
  }
};
