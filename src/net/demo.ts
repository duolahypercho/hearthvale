/**
 * Co-op demo staging (`?demo=coop-farm`): three scripted farmhands on the host's farm, no server —
 * one hoeing a new bed, one watering the field, one chatting / emoting by the path; their cabins,
 * name tags, the roster plate and a few chat lines. Runs on real time (demos pause the sim).
 */
import type { Game } from '../core/game';
import type { Facing } from '../core/events';
import type { NetSystem } from './system';
import { actionFor } from './system';
import { IMPACT } from '../entities/farmer-actions';
import { PRESET_LOOKS } from '../entities/remote-look';
import type { RemotePlayer } from './players';
import type { EmoteId } from '../entities/remote-emotes';

interface Bot {
  p: RemotePlayer;
  t: number;
  step: number;
  script: (b: Bot, dt: number) => void;
  x: number;
  z: number;
  facing: Facing;
  acting: number;
}

const yawOf = (f: Facing): number => (f === 'down' ? 0 : f === 'up' ? Math.PI : f === 'left' ? -Math.PI / 2 : Math.PI / 2);

export class CoopDemo {
  active = false;
  private bots: Bot[] = [];

  constructor(
    private game: Game,
    private net: NetSystem,
  ) {}

  stage(name: string, showcase: string[]): void {
    if (!showcase.includes('coop')) {
      if (this.active) this.clear();
      return;
    }
    if (this.net.role() !== 'solo') return;
    this.clear();
    this.active = true;
    void name;
    const names = ['Juniper', 'Pip', 'Rowan'];
    const mk = (i: number, x: number, z: number, facing: Facing, script: Bot['script']): Bot => {
      const p = this.net.remotes.add(i + 2, names[i]!, PRESET_LOOKS[i]!);
      p.map = 'farm';
      p.cabin = i;
      p.ping = [34, 71, 118][i]!;
      const b: Bot = { p, t: 0, step: 0, script, x, z, facing, acting: 0 };
      this.place(b);
      p.farmer.yaw = yawOf(facing);
      return b;
    };
    const sync = this.net.sync;
    // Pre-till a strip so the hoer is visibly mid-job.
    const farming = sync.farming();
    if (farming) sync.remote({ quiet: true }, () => {
      for (let x = 20; x <= 22; x++) farming.till(x, 25, true);
    });
    this.bots = [
      // Juniper: hoeing a new bed south of the field, west → east.
      mk(0, 23.5, 26.35, 'up', (b, dt) => {
        if (b.acting > 0) return;
        b.t += dt;
        if (b.step % 2 === 0) {
          // walk one tile east
          const tx = 23.5 + Math.floor(b.step / 2);
          b.x = Math.min(tx, b.x + dt * 2.2);
          b.facing = 'right';
          b.p.farmer.speed = 2.2;
          if (b.x >= tx) {
            b.step++;
            b.t = 0;
          }
        } else if (b.t > 0.2) {
          b.facing = 'up';
          this.act(b, 'hoe', Math.floor(b.x), 25);
          b.step = (b.step + 1) % 8;
          if (b.step === 0) b.x = 23.5;
        }
      }),
      // Pip: watering the planted field from its south edge.
      mk(1, 25.5, 24.4, 'up', (b, dt) => {
        if (b.acting > 0) return;
        b.t += dt;
        if (b.t > 0.35) {
          b.t = 0;
          this.act(b, 'wateringCan', Math.floor(b.x), 23);
          b.x = b.x >= 28.5 ? 22.5 : b.x + 1;
        }
      }),
      // Rowan: by the path, chatting and emoting at the host.
      mk(2, 19.3, 23.4, 'right', (b, dt) => {
        b.t += dt;
        if (b.step === 0) {
          this.net.showChat(b.p.id, 'Morning, neighbour! Coffee is on at my cabin');
          b.step = 1;
        } else if (b.t > 7) {
          b.t = 0;
          b.step = 0;
        }
      }),
    ];
    this.net.refreshCabins(new Map([[0, PRESET_LOOKS[0]!.scarf], [1, PRESET_LOOKS[1]!.scarf], [2, PRESET_LOOKS[2]!.scarf]]));
    this.net.showChat(3, 'The parsnips are almost ready!');
    this.net.showChat(2, 'Race you to the bin after this row');
    // Held emotes so stills always catch them.
    this.emote(this.bots[1]!, 'music', true);
    this.emote(this.bots[2]!, 'heart', true);
    this.net.emitRoster();
  }

  private place(b: Bot): void {
    const map = this.game.world.current;
    b.p.farmer.position.set(b.x, map ? map.heightAt(b.x, b.z) : 0, b.z);
    b.p.farmer.targetYaw = yawOf(b.facing);
  }

  private act(b: Bot, itemId: string, x: number, z: number): void {
    const a = actionFor(itemId);
    b.p.farmer.speed = 0;
    b.p.farmer.targetYaw = yawOf(b.facing);
    b.p.farmer.act(a.kind, a.tool);
    b.acting = IMPACT[a.kind] + 0.55;
    this.net.later(IMPACT[a.kind] * 1000, () => {
      if (this.active) this.net.sync.applyUse(itemId, x, z, b.facing);
    });
  }

  private say(b: Bot, text: string, e?: EmoteId): void {
    this.net.showChat(b.p.id, text);
    if (e) this.emote(b, e);
  }

  private emote(b: Bot, e: EmoteId, hold = false): void {
    b.p.emote(e, hold ? 1e6 : undefined);
  }

  clear(): void {
    if (!this.active) return;
    this.active = false;
    for (const b of this.bots) this.net.remotes.remove(b.p.id);
    this.bots = [];
    this.net.refreshCabins();
  }

  update(dt: number, _time: number): void {
    if (!this.active) return;
    for (const b of this.bots) {
      if (b.acting > 0) b.acting -= dt;
      b.p.farmer.speed = 0;
      b.script(b, dt);
      this.place(b);
    }
  }
}
