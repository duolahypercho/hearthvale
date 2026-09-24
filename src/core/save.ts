/**
 * Save/Load skeleton. Anything that wants persistence registers a Saveable under a unique key.
 * Saves go to localStorage `hearthvale.save.<slot>` as versioned JSON.
 *
 *   game.saves.register('farming', { save: () => this.state, load: (d) => (this.state = d as FarmState) });
 */
import type { EventBus } from './events';

export interface Saveable {
  save(): unknown;
  load(data: unknown): void;
}

export interface SaveFile {
  version: number;
  savedAt: string;
  data: Record<string, unknown>;
}

export const SAVE_VERSION = 1;
const PREFIX = 'hearthvale.save.';

export class SaveManager {
  private entries = new Map<string, Saveable>();
  /**
   * Optional veto consulted by save(): return a boolean to short-circuit the write with that result
   * (co-op farmhands must never write the host's farm into their own slots), null to save normally.
   */
  guard: ((slot: string) => boolean | null) | null = null;

  constructor(private events: EventBus) {}

  register(key: string, s: Saveable): void {
    if (this.entries.has(key)) console.warn(`[save] key "${key}" registered twice; overriding`);
    this.entries.set(key, s);
  }

  snapshot(): SaveFile {
    const data: Record<string, unknown> = {};
    for (const [k, s] of this.entries) {
      try {
        data[k] = s.save();
      } catch (err) {
        console.error(`[save] "${k}" failed to save`, err);
      }
    }
    return { version: SAVE_VERSION, savedAt: new Date().toISOString(), data };
  }

  restore(file: SaveFile): void {
    for (const [k, s] of this.entries) {
      if (k in file.data) {
        try {
          s.load(file.data[k]);
        } catch (err) {
          console.error(`[save] "${k}" failed to load`, err);
        }
      }
    }
  }

  save(slot = 'auto'): boolean {
    const veto = this.guard?.(slot);
    if (veto !== null && veto !== undefined) return veto;
    this.events.emit('save:before', { slot });
    try {
      localStorage.setItem(PREFIX + slot, JSON.stringify(this.snapshot()));
    } catch (err) {
      console.error('[save] write failed', err);
      return false;
    }
    this.events.emit('save:after', { slot });
    return true;
  }

  load(slot = 'auto'): boolean {
    let raw: string | null = null;
    try {
      raw = localStorage.getItem(PREFIX + slot);
    } catch {
      return false;
    }
    if (!raw) return false;
    try {
      const file = JSON.parse(raw) as SaveFile;
      if (file.version !== SAVE_VERSION) console.warn(`[save] version ${file.version} != ${SAVE_VERSION}`);
      this.restore(file);
      this.events.emit('load:after', { slot });
      return true;
    } catch (err) {
      console.error('[save] corrupt save', err);
      return false;
    }
  }

  slots(): { slot: string; savedAt: string }[] {
    const out: { slot: string; savedAt: string }[] = [];
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (!k || !k.startsWith(PREFIX)) continue;
        try {
          const f = JSON.parse(localStorage.getItem(k) ?? '{}') as Partial<SaveFile>;
          out.push({ slot: k.slice(PREFIX.length), savedAt: f.savedAt ?? '' });
        } catch {
          /* skip */
        }
      }
    } catch {
      /* storage blocked */
    }
    return out;
  }

  delete(slot: string): void {
    try {
      localStorage.removeItem(PREFIX + slot);
    } catch {
      /* ignore */
    }
  }
}
