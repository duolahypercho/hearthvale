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
import type { DayTally } from './system';
import type { EmoteId } from '../entities/remote-emotes';
import { FarmChoreo, BED, HOST_SPOT } from './demo-farm';

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
  /** coop-bedtime: the farmhands are in their cabins (no scripts run). */
  private asleep = false;
  private bots: Bot[] = [];
  /** coop-farm (+ coop-emote / coop-chat): the looping work choreography. */
  private choreo: FarmChoreo | null = null;

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
    this.asleep = false;
    // The staged host is Marigold (as in the coop-lobby demo), unless you've named your farmer.
    this.net.demoName('Marigold');
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
    if (name === 'animals-coop') {
      this.stageAnimals(mk);
      return;
    }
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
    const idle: Bot['script'] = () => {};
    this.bots = [mk(0, BED.x0 + 0.5, BED.z0 - 0.62, 'down', idle), mk(1, BED.x1 + 0.5, BED.z0 - 0.62, 'down', idle), mk(2, 21.23, 27.2, 'right', idle)];
    this.net.refreshCabins(new Map([[0, PRESET_LOOKS[0]!.scarf], [1, PRESET_LOOKS[1]!.scarf], [2, PRESET_LOOKS[2]!.scarf]]));
    // Earlier in the morning (chat log only — the bubbles above heads are what's being said now).
    const line = (id: number, text: string): void => {
      const p = this.net.remotes.get(id);
      if (p) this.game.events.emit('net:chat', { id, name: p.name, text, color: hex(p.look.scarf) });
    };
    if (name === 'coop-bedtime') {
      line(2, 'Night, all! Bin run at six?');
      line(3, 'Left you a coffee on the porch');
      line(4, 'zzz');
      this.emote(this.bots[1]!, 'music', true);
      this.emote(this.bots[2]!, 'heart', true);
    } else {
      line(3, 'Cauliflowers are watered!');
      line(2, 'Strawberries are ripe! Grab a basket');
      // The 26 s work loop; &t=<sec> seeks it (stills mid-action). Starts a beat in by default so a
      // still taken right after load catches the haul, the picking and the watering at once.
      this.choreo = new FarmChoreo(this.game, this.net, this.bots.map((b) => b.p));
      // The host steps to the bed's front-east corner (turned to it) so the lane behind the bed is
      // free for the pickers, who face the camera; the camera is re-aimed at the same spot. Deferred:
      // the demo sets facing + camera right after this event.
      queueMicrotask(() => {
        if (!this.active) return;
        const pl = this.game.player;
        const rig = this.game.rc.rig;
        rig.lookOffset.x -= HOST_SPOT.x - pl.position.x;
        rig.lookOffset.z -= HOST_SPOT.z - pl.position.z;
        pl.teleport(HOST_SPOT.x, HOST_SPOT.z);
        pl.setFacing('left');
        this.game.followPlayer(true);
      });
      const t = Number(new URLSearchParams(location.search).get('t'));
      this.choreo.seek(Number.isFinite(t) && t > 0 ? t : 1.6);
    }
    if (name === 'coop-bedtime') {
      // Everyone else has turned in: the farmhands are asleep in their cabins, you're the one still up.
      for (const b of this.bots) {
        b.p.ready = true;
        b.p.map = 'cabin';
      }
      this.asleep = true;
      this.game.events.emit('net:beds', { ready: [2, 3, 4], total: 4, sleeping: false });
    }
    this.net.emitRoster();
  }

  /**
   * `animals-coop`: the three farmhands in the paddock working the herd (pillar 13 on screen): Juniper
   * pets the cow at the trough (real `pet` intents through the host path — the heart pops here), Pip
   * hugs a fresh bale over to the manger, Rowan holds up a brimming milk pail. Chat is about the animals.
   */
  private stageAnimals(mk: (i: number, x: number, z: number, facing: Facing, script: Bot['script']) => Bot): void {
    const idle: Bot['script'] = () => {};
    // (Juniper pets Maple from the far side of her shoulder, facing the camera: from the near side she hid
    // the cow and her chat bubble piled onto Rowan's.)
    this.bots = [mk(0, 49.1, 38.1, 'down', idle), mk(1, 37.75, 40.55, 'down', idle), mk(2, 47.15, 40.75, 'down', idle)];
    this.net.refreshCabins(new Map([[0, PRESET_LOOKS[0]!.scarf], [1, PRESET_LOOKS[1]!.scarf], [2, PRESET_LOOKS[2]!.scarf]]));
    const line = (id: number, text: string): void => {
      const p = this.net.remotes.get(id);
      if (p) this.game.events.emit('net:chat', { id, name: p.name, text, color: hex(p.look.scarf) });
    };
    line(3, 'Topped up the hay rack, the goats are thrilled');
    line(2, 'The ducks found the new pond!');
    this.bots[0]!.p.chat('Who’s a good cow? Maple is!', 1e6);
    this.bots[2]!.p.chat('First milk of the season!', 1e6);
    this.emote(this.bots[1]!, 'heart', true);
    // The animal system drives the work (it owns the herd + the host-side intent path); deferred a tick
    // so its own demo staging (herd placement) has run.
    const roles = ['pet', 'hay', 'milk'] as const;
    queueMicrotask(() => {
      const animals = this.game.services.animals as unknown as { stageFarmhands?: (l: unknown[]) => void } | undefined;
      animals?.stageFarmhands?.(this.bots.map((b, i) => ({ peer: b.p.id, farmer: b.p.farmer, role: roles[i] })));
    });
    this.net.emitRoster();
  }

  private place(b: Bot): void {
    const map = this.game.world.current;
    b.p.farmer.position.set(b.x, map ? map.heightAt(b.x, b.z) : 0, b.z);
    b.p.farmer.targetYaw = yawOf(b.facing);
  }

  /** Staged "Farm today" tally for the day-end card (coop-dayend demo). */
  tally(): DayTally[] {
    const me = this.net.profile();
    const shown = this.net.players().find((p) => p.isMe)?.name;
    const rows: DayTally[] = [{ id: 1, name: shown || me.name || 'Farmer', look: me.look, isMe: true, n: [18, 24, 6, 12] }];
    const work = [
      [26, 8, 0, 6],
      [4, 31, 12, 18],
      [9, 14, 3, 0],
    ];
    this.bots.forEach((b, i) => rows.push({ id: b.p.id, name: b.p.name, look: b.p.look, isMe: false, n: work[i]! }));
    return rows;
  }

  private emote(b: Bot, e: EmoteId, hold = false): void {
    b.p.emote(e, hold ? 1e6 : undefined);
  }

  clear(): void {
    if (!this.active) return;
    this.active = false;
    this.choreo?.dispose();
    this.choreo = null;
    for (const b of this.bots) this.net.remotes.remove(b.p.id);
    this.bots = [];
    this.net.demoName(null);
    this.net.refreshCabins();
  }

  update(dt: number, _time: number): void {
    if (!this.active || this.asleep) return;
    if (this.choreo) {
      this.choreo.update(dt);
      return;
    }
    for (const b of this.bots) {
      if (b.acting > 0) b.acting -= dt;
      b.p.farmer.speed = 0;
      b.script(b, dt);
      this.place(b);
    }
  }
}
