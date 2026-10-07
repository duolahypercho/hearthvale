/**
 * Co-op demo staging (`?demo=coop-farm`): three scripted farmhands on the host's farm, no server —
 * everyone around one ripe strawberry bed (one picking the back row facing the camera, the host at
 * the east end of that row, one calling the others over for coffee), one trotting the harvest down the path; cabins, name tags, emote bubbles, the roster plate and a short chat log
 * (earlier lines — never a copy of the bubbles). Runs on real time (demos pause the sim).
 */
import * as THREE from 'three';
import type { Game } from '../core/game';
import { CABIN_SITES } from './cabins';
import { farmerMaterial } from '../entities/remote-farmer';
import { MeshBuilder, mat, bevelCylinder } from '../world/geom';
import type { Facing } from '../core/events';
import type { NetSystem } from './system';
import { actionFor } from './system';
import { IMPACT } from '../entities/farmer-actions';
import { PRESET_LOOKS, hex } from '../entities/remote-look';
import { DEBRIS } from './farmsync';
import type { RemotePlayer } from './players';
import type { DayTally } from './system';
import type { EmoteId } from '../entities/remote-emotes';
import { FarmChoreo, BED, HOST_SPOT, LANE_Z } from './demo-farm';

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
  /** Bumped per stage() (a deferred re-seek only applies to the staging that scheduled it). */
  private stageId = 0;
  /** The staged demo's name. */
  private name = '';

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
    this.name = name;
    this.stageId++;
    this.asleep = false;
    // The staged host is Saffron (as in the coop-lobby demo), unless you've named your farmer.
    this.net.demoName('Saffron');
    const names = ['Juniper', 'Fennel', 'Briar'];
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
        // (incl. round Juniper's cabin: r6 had a boulder on her doormat in coop-bedtime)
        for (let z = 21; z <= 31; z++)
          for (let x = 13; x <= 34; x++) {
            const o = grid.getObject(x, z);
            if (o && DEBRIS.has(o.kind)) grid.removeObject(x, z);
          }
        // The shared job: a ripe strawberry bed right in front of the field — red fruit to pick.
        this.game.services.farming?.plantBlock('strawberry', BED.x0, BED.z0, BED.x1 - BED.x0 + 1, BED.z1 - BED.z0 + 1, true);
      });
    }
    if (name === 'coop-chat') {
      this.stagePorch(mk);
      return;
    }
    const idle: Bot['script'] = () => {};
    this.bots = [mk(0, BED.x0 + 0.5, LANE_Z, 'down', idle), mk(1, BED.x1 + 0.5, LANE_Z, 'down', idle), mk(2, 20.73, 25.65, 'right', idle)];
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
      // (Earlier in the morning; the choreography's own lines join the log as they're said and every
      // chip fades after 8 s, so the log never contradicts the bubbles.)
      line(2, 'Strawberries are ripe! Grab a basket');
      line(3, 'Can’s full, I’ll water the berries');
      // The 26 s work loop; &t=<sec> seeks it (stills mid-action). By default a still taken right after
      // load lands in the coffee beat: Rowan back at the basket waving everyone over, Juniper calling
      // back, Pip grinning — all four farmers facing the camera, the chat log matching the bubbles.
      this.choreo = new FarmChoreo(this.game, this.net, this.bots.map((b) => b.p), this.name === 'coop-emote');
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
        this.choreo?.hostPose();
        this.game.followPlayer(true);
      });
      const q = new URLSearchParams(location.search);
      // (farming pod) a demo-table token `t=<sec>` seeks too (coop-farm-work: farmhands mid-action).
      const t = Number(q.get('t') ?? showcase.find((s) => s.startsWith('t='))?.slice(2));
      const t0 = Number.isFinite(t) && t > 0 ? t : 19.9;
      this.choreo.seek(t0);
      // The loop runs on real time, and boot + shader warm-up can take tens of seconds on a busy
      // machine: a still taken "2.5 s after ready" drifted anywhere in the loop (r5's critic shots
      // caught everyone walking away). Restart the loop at t0 once the game is ready.
      // (r7) Re-seeked synchronously on 'game:ready' — in the very frame ready resolves, before any
      // awaiting capture resumes — so no still / sequence ever shows the pre-seek pose jump (r6: Briar
      // vanished between the first two frames of a capture).
      const staged = this.stageId;
      this.game.events.once('game:ready', () => {
        if (!this.active || !this.choreo || staged !== this.stageId) return;
        this.seek(t0);
        if (name === 'coop-emote') this.emotePops();
      });
    }
    if (name === 'coop-bedtime') {
      // Everyone else has turned in: the farmhands are asleep in their cabins, you're the one still up.
      for (const b of this.bots) {
        b.p.ready = true;
        b.p.map = 'cabin';
      }
      this.asleep = true;
      this.game.events.emit('net:beds', { ready: [2, 3, 4], total: 4, sleeping: false });
      // You stand beside the step, three-quarters to the lens, glancing at Juniper's lit door (r6: back
      // to the camera on the doorstep, covering the door).
      queueMicrotask(() => {
        if (!this.active) return;
        const pl = this.game.player as unknown as { targetYaw: number; setFacing(f: Facing): void };
        pl.setFacing('left');
        pl.targetYaw = -0.55;
      });
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

  /**
   * `coop-chat` (r7: its own composition, not the berry-bed frame): golden hour on Juniper's porch. She
   * stands on her step with a fresh pot's mug, Fennel and Briar cradle theirs on the grass in front, the
   * host comes round the crate typing a reply (the parchment Say row + the "…" over their head). The bubbles
   * are what's being said now; the log holds the afternoon's earlier lines (never a copy of a bubble).
   */
  private stagePorch(mk: (i: number, x: number, z: number, facing: Facing, script: Bot['script']) => Bot): void {
    const idle: Bot['script'] = () => {};
    const site = CABIN_SITES[0]!;
    const cx = site.x0 + 1.5;
    const front = site.z0 + 3;
    // (the lens looks in from the south-east, clear of the blossom tree: everyone stands in an open arc)
    this.bots = [mk(0, cx - 0.3, front + 0.1, 'down', idle), mk(1, cx - 1.65, front + 1.25, 'down', idle), mk(2, cx + 1.75, front + 1.35, 'down', idle)];
    this.bots[0]!.p.farmer.targetYaw = 0.35;
    this.bots[1]!.p.farmer.targetYaw = 0.8;
    this.bots[2]!.p.farmer.targetYaw = 0.05;
    this.net.refreshCabins(new Map([[0, PRESET_LOOKS[0]!.scarf], [1, PRESET_LOOKS[1]!.scarf], [2, PRESET_LOOKS[2]!.scarf]]));
    for (const [i, c] of [0xf4ead8, 0x9fc6e8, 0xe8b64a].entries()) {
      const m = buildMug(c);
      this.mugs.push(m);
      this.bots[i]!.p.farmer.carry(m);
      m.position.set(0, 0.1, 0.3);
      m.scale.setScalar(1.25);
    }
    const line = (id: number, text: string): void => {
      const p = this.net.remotes.get(id);
      if (p) this.game.events.emit('net:chat', { id, name: p.name, text, color: hex(p.look.scarf) });
    };
    line(4, 'Six baskets shipped!');
    line(3, 'Berries are watered!');
    line(2, 'Coffee’s on at my cabin, come on over!');
    this.bots[0]!.p.chat('Fresh pot! Mugs are on the crate', 1e6);
    this.bots[2]!.p.chat('Best part of the day.', 1e6);
    this.emote(this.bots[1]!, 'happy', true);
    // You, round the far side of the crate, three-quarters to the lens (the lens is re-aimed with you).
    queueMicrotask(() => {
      if (!this.active) return;
      const pl = this.game.player;
      const rig = this.game.rc.rig;
      const to = { x: cx + 2.9, z: front + 0.3 };
      rig.lookOffset.x -= to.x - pl.position.x;
      rig.lookOffset.z -= to.z - pl.position.z;
      pl.teleport(to.x, to.z);
      pl.setFacing('left');
      (pl as unknown as { targetYaw: number }).targetYaw = -0.3;
      this.game.followPlayer(true);
    });
    this.net.emitRoster();
  }

  private mugs: THREE.Object3D[] = [];

  private place(b: Bot): void {
    const map = this.game.world.current;
    b.p.farmer.position.set(b.x, map ? map.heightAt(b.x, b.z) : 0, b.z);
    b.p.farmer.targetYaw = yawOf(b.facing);
  }

  /** Staged "Farm today" tally for the day-end card (coop-dayend demo). */
  tally(): DayTally[] {
    const me = this.net.profile();
    const mine = this.net.players().find((p) => p.isMe);
    const rows: DayTally[] = [{ id: 1, name: mine?.name || me.name || 'Farmer', look: mine?.look ?? me.look, isMe: true, n: [18, 24, 6, 12, 340] }];
    const work = [
      [26, 8, 0, 6, 0],
      [4, 31, 12, 18, 0],
      [9, 14, 3, 0, 615],
    ];
    this.bots.forEach((b, i) => rows.push({ id: b.p.id, name: b.p.name, look: b.p.look, isMe: false, n: work[i]! }));
    return rows;
  }

  /** Restart the coop-farm loop at `t` s (stills from a live page; same as `&t=`). */
  seek(t: number): void {
    if (!this.choreo) return;
    this.choreo.dispose();
    for (const b of this.bots) b.p.chat('', 0);
    // The whole bed ripe again (the disposed loop's re-fruit timers never fire).
    this.net.sync.remote({ quiet: true }, () => this.game.services.farming?.plantBlock('strawberry', BED.x0, BED.z0, BED.x1 - BED.x0 + 1, BED.z1 - BED.z0 + 1, true));
    this.choreo = new FarmChoreo(this.game, this.net, this.bots.map((b) => b.p), this.name === 'coop-emote');
    this.choreo.seek(t);
    this.choreo.hostPose();
  }

  /**
   * coop-emote: Fennel throws a "Wow!" — held at the pop's peak (bubble overshoot + sparkle ring + his
   * mid-air hop) for stills; Juniper answers with a heart a beat later (live). Your own wheel opens
   * beside your farmer (ui/coop.ts).
   */
  private emotePops(): void {
    const fennel = this.bots[1]?.p;
    const juniper = this.bots[0]?.p;
    if (!fennel || !juniper) return;
    fennel.emote('wow', 1e6);
    fennel.farmer.bubble.freezeAt = new URLSearchParams(location.search).get('live') === '1' ? null : 0.16;
    this.choreo?.muteEmotes.add(fennel.id);
    juniper.emote('heart', 1e6);
  }

  private emote(b: Bot, e: EmoteId, hold = false): void {
    b.p.emote(e, hold ? 1e6 : undefined);
  }

  clear(): void {
    if (!this.active) return;
    this.active = false;
    for (const b of this.bots) b.p.farmer.carry(null);
    for (const m of this.mugs) m.traverse((o) => (o as THREE.Mesh).geometry?.dispose());
    this.mugs = [];
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

/** A cosy mug (glazed body, handle, dark coffee) — one mesh on the shared farmer material. */
function buildMug(glaze: number): THREE.Object3D {
  const m = farmerMaterial();
  const b = new MeshBuilder();
  b.add(m, bevelCylinder(0.085, 0.075, 0.16, 0.02, 14), mat(0, 0, 0), { tint: glaze });
  b.add(m, new THREE.CylinderGeometry(0.072, 0.072, 0.01, 14), mat(0, 0.15, 0), { tint: 0x4a2814 });
  b.add(m, new THREE.TorusGeometry(0.05, 0.016, 6, 12), mat(0.09, 0.08, 0, 0, 0, 0), { tint: glaze });
  const mesh = new THREE.Mesh(b.geometries().get(m)!, m);
  mesh.castShadow = true;
  mesh.name = 'coop-mug';
  return mesh;
}
