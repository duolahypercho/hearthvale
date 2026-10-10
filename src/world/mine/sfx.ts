/**
 * Mine / combat sound cues. No audio of its own: every cue is voiced by the game's one audio graph
 * (src/audio/sfx.ts designs, through the master limiter, the sidechain ducker, the cave reverb, the
 * voice budget and the volume / mute settings) via the audio hub, placed at the world position it
 * happens at — so a co-op partner's sword fight down the tunnel pans and fades with distance.
 *
 * The local farmer's own sword swing is voiced by `tool:swing` (systems/audio.ts), so `whoosh` is
 * only called for remote partners' arcs. Simultaneous monster hits from one swing collapse into one
 * voice per kind (+1.5 dB per extra target) in systems/audio.ts.
 */
import type { MonsterKind } from './biomes';
import { audioHub } from '../../audio/hub';

type At = { x: number; z: number } | null | undefined;

const play = (name: string, at?: At, opts?: { gain?: number; level?: number }): void => {
  audioHub.play?.(name, at ?? null, opts);
};

export const mineSfx = {
  /** Pickaxe on stone (every strike; ore veins ring). */
  pick(ore: boolean, at?: At): void {
    play('mine:pick', at, { level: ore ? 1 : 0 });
  },
  /** The rock splits (bigger boulders rumble longer). */
  crumble(big: boolean, at?: At): void {
    play('mine:break', at, { level: big ? 1 : 0 });
  },
  gem(at?: At): void {
    play('gem', at);
  },
  /** A partner's sword arc (the local swing is voiced by tool:swing). */
  whoosh(at?: At): void {
    play('sword', at, { gain: 0.9 });
  },
  /** A sword / pick blow landing on a monster: one voice per kind (slime squelch, crab shell clank, bat screech, wisp zap, imp ember). */
  hit(kind: MonsterKind | string, crit: boolean, killed: boolean, at?: At): void {
    play(`hit:${kind}`, at, { level: (crit ? 1 : 0) + (killed ? 2 : 0) });
  },
  /** Legacy name (a generic flesh hit): voiced as a slime-ish hit. */
  hitFlesh(crit: boolean, at?: At): void {
    play('hit:flesh', at, { level: crit ? 1 : 0 });
  },
  /** A projectile parried off the blade. */
  hitShell(at?: At): void {
    play('parry', at);
  },
  /** A monster's death pop (skipped when its kill blow already voiced the death). */
  pop(at?: At): void {
    play('monster:pop', at);
  },
  /** Loot vacuumed up. */
  blip(): void {
    play('pickup', null, { gain: 0.8 });
  },
  /** The ladder down is uncovered. */
  reveal(at?: At): void {
    play('mine:reveal', at);
  },
  /** Lava singes the farmer. */
  sizzle(at?: At): void {
    play('sizzle', at);
  },
  /** An imp lobs a fireball. */
  fireball(at?: At): void {
    play('fireball', at);
  },
  chest(at?: At): void {
    play('chest', at);
  },
  hurt(): void {
    play('hurt');
  },
  passOut(): void {
    play('passout');
  },
  ladder(): void {
    play('ladder');
  },
  lift(): void {
    play('lift');
  },
  // (Kept for callers that voiced kinds separately; the kind now lives in hit().)
  squish(at?: At): void {
    play('hit:slime', at);
  },
  screech(at?: At): void {
    play('hit:bat', at);
  },
  zap(at?: At): void {
    play('hit:wisp', at);
  },
  hop(): void {
    /* slime hops are carried by the mine ambience */
  },
};
