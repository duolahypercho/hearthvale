/**
 * Co-op demo staging (`?demo=coop-farm`): three scripted farmhands on the host's farm, no server —
 * one hoeing a new bed (facing the camera), one carrying the harvest down the path, one chatting /
 * emoting by their cabin; cabins, name tags, emote bubbles, the roster plate and a short chat log
 * (earlier lines — never a copy of the bubbles). Runs on real time (demos pause the sim).
 */
import type { Game } from '../core/game';
import type { Facing } from '../core/events';
import type { NetSystem } from './system';
import { actionFor } from './system';
import { IMPACT } from '../entities/farmer-actions';
import { PRESET_LOOKS, hex } from '../entities/remote-look';
import { DEBRIS } from './farmsync';
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

/** Row of the new bed Juniper is hoeing (just south of the planted field). */
const BED_Z = 26;

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
    const farming = sync.farming();
    const grid = sync.grid();
    if (farming && grid) {
      sync.remote({ quiet: true }, () => {
        // A tidy host farm: no sticks / stones / weeds between the camera and the farmers.
        for (let z = 24; z <= 31; z++)
          for (let x = 19; x <= 34; x++) {
            const o = grid.getObject(x, z);
            if (o && DEBRIS.has(o.kind)) grid.removeObject(x, z);
          }
        // Pre-till the start of the new bed so the hoer is visibly mid-job.
        for (let x = 20; x <= 22; x++) farming.till(x, BED_Z, true);
      });
    }
    this.bots = [
      // Juniper: hoeing a new bed just south of the field, working west → east, facing the camera.
      mk(0, 23.5, BED_Z - 0.62, 'down', (b, dt) => {
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
          b.facing = 'down';
          this.act(b, 'hoe', Math.floor(b.x), BED_Z);
          b.step = (b.step + 1) % 8;
          if (b.step === 0) b.x = 23.5;
        }
      }),
      // Pip: an armful of parsnips, strolling down the path toward the shipping bin (and back).
      mk(1, 31.2, 20.6, 'down', (b, dt) => {
        b.t += dt;
        const down = b.step === 0;
        b.facing = down ? 'down' : 'up';
        b.z += (down ? 1 : -1) * dt * 1.7;
        b.p.farmer.speed = 1.7;
        if (down && b.z >= 26.2) b.step = 1;
        else if (!down && b.z <= 20.6) b.step = 0;
      }),
      // Rowan: by their cabin, chatting and emoting at the others.
      mk(2, 20.3, 24.1, 'down', (b) => {
        if (b.step === 0) {
          this.net.showChat(b.p.id, 'Morning, neighbours! Coffee is on at my cabin', false);
          b.step = 1;
        }
      }),
    ];
    this.net.refreshCabins(new Map([[0, PRESET_LOOKS[0]!.scarf], [1, PRESET_LOOKS[1]!.scarf], [2, PRESET_LOOKS[2]!.scarf]]));
    // Earlier in the morning (chat log only — the bubbles above heads are what's being said now).
    const line = (id: number, text: string): void => {
      const p = this.net.remotes.get(id);
      if (p) this.game.events.emit('net:chat', { id, name: p.name, text, color: hex(p.look.scarf) });
    };
    line(3, 'Cauliflowers are watered!');
    line(2, 'Nice. I\'ll start the new bed');
    this.net.showChat(2, 'Race you to the bin after this row', false);
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
