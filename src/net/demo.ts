/**
 * Co-op demo staging (`?demo=coop-farm`): three scripted farmhands on the host's farm, no server —
 * everyone around one ripe strawberry bed (one picking the back row facing the camera, the host at
 * the east end of that row, one calling the others over for coffee), one trotting the harvest down the path; cabins, name tags, emote bubbles, the roster plate and a short chat log
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

/** The ripe strawberry bed everyone is working (just south of the planted field, tiles inclusive). */
const BED = { x0: 22, z0: 25, x1: 27, z1: 26 };

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
          for (let x = 17; x <= 34; x++) {
            const o = grid.getObject(x, z);
            if (o && DEBRIS.has(o.kind)) grid.removeObject(x, z);
          }
        // The shared job: a ripe strawberry bed right in front of the field — red fruit to pick.
        this.game.services.farming?.plantBlock('strawberry', BED.x0, BED.z0, BED.x1 - BED.x0 + 1, BED.z1 - BED.z0 + 1, true);
      });
    }
    this.bots = [
      // Juniper: behind the bed, picking her way along the back row, facing the camera (the host
      // works the east end of the same row).
      mk(0, BED.x0 + 0.5, BED.z0 - 0.62, 'down', (b, dt) => {
        if (b.acting > 0) return;
        b.t += dt;
        const col = BED.x0 + (b.step >> 1);
        if (b.step % 2 === 0) {
          // a quick sidestep to the next plant
          const tx = col + 0.5;
          b.x = Math.min(tx, b.x + dt * 2.6);
          b.facing = 'right';
          b.p.farmer.speed = 2.6;
          if (b.x >= tx) {
            b.step++;
            b.t = 0;
          }
        } else {
          b.facing = 'down';
          if (b.t > 1.1) {
            this.pick(b, col, BED.z0);
            b.step = (b.step + 1) % 6;
            if (b.step === 0) b.x = BED.x0 + 0.5;
          }
        }
      }),
      // Pip: an armful of parsnips, strolling down the path toward the shipping bin (and back).
      mk(1, 31.2, 20.6, 'down', (b, dt) => {
        b.t += dt;
        if (b.step === 0) {
          // down the path toward the camera…
          b.facing = 'down';
          b.z += dt * 1.7;
          b.p.farmer.speed = 1.7;
          if (b.z >= 26.2) {
            b.step = 1;
            b.t = 0;
          }
        } else if (b.step === 1) {
          // …a breather at the bottom…
          b.facing = 'down';
          if (b.t > 4) b.step = 2;
        } else {
          // …and a quick trot back up.
          b.facing = 'up';
          b.z -= dt * 4;
          b.p.farmer.speed = 4;
          if (b.z <= 20.6) b.step = 0;
        }
      }),
      // Rowan: at the bed's west end, facing everyone, calling them over for coffee.
      mk(2, BED.x0 - 0.85, BED.z0 + 0.7, 'down', (b) => {
        if (b.step === 0) {
          b.p.chat('Morning, neighbours! Coffee is on at my cabin', 1e6);
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
    line(2, 'Strawberries are ripe! Grab a basket');
    this.bots[0]!.p.chat('Race you to the bin after this row', 1e6);
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

  /** Pick one ripe plant by hand; it fruits again a few seconds later so the bed stays red. */
  private pick(b: Bot, x: number, z: number): void {
    const a = actionFor('@act');
    b.p.farmer.speed = 0;
    b.p.farmer.targetYaw = yawOf(b.facing);
    b.p.farmer.act(a.kind, a.tool);
    b.acting = IMPACT[a.kind] + 0.7;
    this.net.later(IMPACT[a.kind] * 1000, () => {
      if (this.active) this.net.sync.applyHarvest(x, z);
    });
    this.net.later(3600, () => {
      const f = this.game.services.farming;
      if (this.active && f && !f.cropAt(x, z)?.ripe) this.net.sync.remote({ quiet: true }, () => f.plantBlock('strawberry', x, z, 1, 1, true));
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
