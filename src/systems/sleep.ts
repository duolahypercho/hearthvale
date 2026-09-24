/**
 * SleepSystem: ends the day. Walk into the farmhouse and interact with grandmother's quilted bed
 * (after 18:00, or any time when exhausted): a small "Go to bed for the night?" prompt, then the farmer
 * lies down with the quilt folded over them, the lamps and the fire dim over ~600 ms, a few sleepy Zzz
 * drift up — then the screen fades, the day ends (shipping pays out, crops grow, animals produce) and
 * the end-of-day summary opens; you wake beside the bed at 6:00.
 * Staying up past 2 am makes the farmer pass out (Calendar ends the day itself), which costs 10 %
 * of the purse (max 1000g) and half the next day's energy (EnergySystem) — someone carries you home.
 *   in:  player:interact, day:end, day:start, animals:summary (carried into the summary),
 *        net:beds (co-op: lie down in bed while waiting for the other farmers)
 *   out: sleep:start, sleep:summary (end-of-day screen: shipping total, penalty, animals, tomorrow), sleep:wake
 * Service `sleep`: sleep() (bed / debug; synchronous calendar roll), canSleep(), goToBed(), ask().
 * Demos: showcase 'bed-ask' opens the prompt, 'bed-lie' tucks the farmer in (dimmed room, Zzz).
 */
import * as THREE from 'three';
import type { System } from '../core/system';
import type { Game } from '../core/game';
import { AnimalPops } from '../entities/animals';

export interface SleepApi {
  canSleep(): boolean;
  /** End the day right now (no fade, no teleport). */
  sleep(): void;
  /** The full bedtime: lie down, dim, fade, end the day, wake up beside the bed. */
  goToBed(): Promise<void>;
  /** The "Go to bed for the night?" prompt (resolves true on yes). */
  ask(): Promise<boolean>;
}

/** The herd's night, as the end-of-day card shows it (from `animals:summary`). */
export interface SleepAnimals {
  total: number;
  fed: number;
  hungry: number;
  hungryNames: string[];
  petted: number;
  produce: { item: string; q: number }[];
  pet?: { name: string; species: string; bowl: boolean };
  /** Tomorrow's chores (ready to milk / shear, eggs in the nests, empty troughs...). */
  chores?: { icon: string; text: string }[];
}

declare module '../core/game' {
  interface GameServices {
    sleep: SleepApi;
  }
}

declare module '../core/events' {
  interface GameEvents {
    'sleep:start': { hour: number };
    'sleep:summary': { passedOut: boolean; shipped: number; penalty: number; day: number; animals?: SleepAnimals };
    /** The farmer is up again (beside the bed, or carried home after passing out). */
    'sleep:wake': { passedOut: boolean };
  }
}

interface BedSpec {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
  wakeX: number;
  wakeZ: number;
}

/** What the farmhouse offers the bedtime (house.ts). */
interface HouseBed {
  bed?: BedSpec;
  pillow?: THREE.Vector3;
  tuckIn?(on: boolean): void;
  dim?: number;
}

const SLEEP_FROM = 18;
const HOUSE = 'house';
/** Fallback wake spot if the house map doesn't publish its bed. */
const WAKE = { x: 9.6, z: 2.9 };
const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

const PROMPT_CSS = `
.hv-bedask{position:absolute;left:50%;bottom:150px;translate:-50% 0;z-index:40;min-width:380px;padding:18px 26px 20px;border-radius:20px;
  background:linear-gradient(180deg,#fbf0d6,#f1dcad);border:4px solid #8a5528;box-shadow:inset 0 2px 0 #fffaf0,0 6px 0 rgba(60,30,10,.35),0 18px 40px rgba(20,10,4,.45);
  font-family:var(--font-body);color:var(--ink,#4a2c14);text-align:center;animation:hvBedIn 240ms var(--ease-back,cubic-bezier(.34,1.56,.64,1)) both;pointer-events:auto}
.hv-bedask.out{animation:hvBedOut 160ms ease-in both}
.hv-bedask h3{margin:0;font-family:var(--font-head);font-weight:700;font-size:26px;display:flex;align-items:center;justify-content:center;gap:10px}
.hv-bedask h3 svg{width:30px;height:30px}
.hv-bedask p{margin:4px 0 14px;font-weight:700;font-size:15px;color:#8a6440}
.hv-bedask .row{display:flex;gap:14px;justify-content:center}
.hv-bedask .u-btn.sel{outline:3px solid #fff3c4;outline-offset:3px}
@keyframes hvBedIn{from{opacity:0;transform:translateY(24px) scale(.9)}to{opacity:1;transform:none}}
@keyframes hvBedOut{to{opacity:0;transform:translateY(12px) scale(.96)}}`;
const MOON = `<svg viewBox="0 0 24 24"><path d="M15 2.8 a9.2 9.2 0 1 0 6.2 13.4 a7.2 7.2 0 0 1 -6.2 -13.4 Z" fill="#f7ebb8" stroke="#a88c40" stroke-width="1.3"/><circle cx="10" cy="14" r="1.3" fill="#e0cc88"/></svg>`;

export class SleepSystem implements System, SleepApi {
  readonly name = 'sleep';
  private game!: Game;
  private shipped = 0;
  private animals: SleepAnimals | undefined;
  private busy = false;
  private asking = false;
  private carryHome = false;
  /** Lying in the farmhouse bed (root transform held here after the player's own update). */
  private lying = false;
  private lieAt = new THREE.Vector3();
  private dimTarget = 0;
  private zzz = false;
  private zT = 0;
  private pops = new AnimalPops();

  init(game: Game): void {
    this.game = game;
    game.provide('sleep', this);
    game.scene.add(this.pops.group);
    game.events.on('shipping:summary', ({ total }) => (this.shipped = total));
    game.events.on('animals:summary', (s) => {
      this.animals = {
        total: s.animals.length,
        fed: s.fed,
        hungry: s.hungry,
        hungryNames: s.animals.filter((a) => !a.fed).map((a) => a.name),
        petted: s.animals.length - s.unpetted,
        produce: s.produce.map((p) => ({ item: p.item, q: p.q })),
        pet: s.pet ? { name: s.pet.name, species: s.pet.species, bowl: s.pet.bowl } : undefined,
        chores: s.chores?.slice(0, 5),
      };
    });
    game.events.on('player:interact', ({ x, z }) => {
      const bed = this.bed();
      if (!bed || this.busy || this.asking || x < Math.floor(bed.x0) || x > Math.floor(bed.x1) || z < Math.floor(bed.z0) || z > Math.floor(bed.z1)) return;
      if (!this.canSleep()) {
        game.events.emit('ui:toast', { text: 'Not sleepy yet… the quilt can wait until <b>6 pm</b>', kind: 'info' });
        return;
      }
      void this.ask().then((yes) => {
        if (yes) void this.goToBed();
      });
    });
    game.events.on('day:end', ({ passedOut, day }) => {
      let penalty = 0;
      if (passedOut) {
        const eco = game.services.economy;
        penalty = eco ? Math.min(1000, Math.floor(eco.gold() * 0.1)) : 0;
        if (penalty) eco?.add(-penalty, 'passed-out');
        this.carryHome = !this.busy;
      }
      this.animals = undefined;
      // Shipping pays out on day:end, the herd reports on day:start: read both after they have run.
      queueMicrotask(() => {
        game.events.emit('sleep:summary', { passedOut, shipped: this.shipped, penalty, day, animals: this.animals });
        this.shipped = 0;
      });
    });
    game.events.on('day:start', () => {
      if (!this.carryHome) return;
      this.carryHome = false;
      void this.wakeAtHome(true);
    });
    // Co-op: in bed waiting for the other farmers → lie down under the quilt; cancelled → get up.
    game.events.on('net:beds', ({ sleeping }) => {
      if (sleeping && !this.lying && !this.busy && this.bed()) {
        void game.hud.fade(true).then(async () => {
          this.lieDown(true);
          await wait(100);
          await game.hud.fade(false);
        });
      } else if (!sleeping && this.lying) {
        // sleepNow() re-enters goToBed() right after announcing; only get up if nothing follows.
        queueMicrotask(() => {
          if (!this.busy && this.lying) {
            this.lieDown(false);
            this.standBeside();
          }
        });
      }
    });
    game.events.on('map:change', () => {
      if (this.lying && this.game.world.current?.id !== HOUSE) this.lieDown(false);
    });
    game.events.on('demo:stage', ({ showcase }) => {
      if (this.lying) this.lieDown(false);
      this.dimTarget = 0;
      this.zzz = false;
      const house = this.house();
      if (house) house.dim = 0;
      if (showcase.includes('bed-ask')) setTimeout(() => void this.ask(), 60);
      // End-of-day card after a night with the stocked coop + barn (the Animals row).
      if (showcase.includes('dayend')) setTimeout(() => this.sleep(), 400);
      if (showcase.includes('bed-lie')) {
        queueMicrotask(() => {
          this.lieDown(true);
          this.dimTarget = 0.55;
          this.zzz = true;
          this.zT = 0;
        });
      }
    });
  }

  private house(): HouseBed | null {
    const m = this.game.world.current;
    return m?.id === HOUSE ? (m as unknown as HouseBed) : null;
  }

  private bed(): BedSpec | null {
    return this.house()?.bed ?? null;
  }

  canSleep(): boolean {
    return this.game.calendar.hour >= SLEEP_FROM || !!this.game.services.energy?.exhausted();
  }

  sleep(): void {
    this.game.events.emit('sleep:start', { hour: this.game.calendar.hour });
    this.game.calendar.endDay(false);
  }

  // ───────────────────────────────────────────── prompt

  ask(): Promise<boolean> {
    if (this.asking) return Promise.resolve(false);
    this.asking = true;
    const g = this.game;
    const wasCtl = g.player.controllable;
    g.player.controllable = false;
    if (!document.getElementById('hv-bedask-css')) {
      const st = document.createElement('style');
      st.id = 'hv-bedask-css';
      st.textContent = PROMPT_CSS;
      document.head.appendChild(st);
    }
    const box = document.createElement('div');
    box.className = 'hv-bedask';
    const late = g.calendar.hour >= 24;
    box.innerHTML = `<h3>${MOON}Go to bed for the night?</h3><p>${late ? 'It’s very late — the valley is fast asleep.' : 'The day ends and you wake refreshed at 6 am.'}</p>
      <div class="row"><button class="u-btn green sel" data-v="1">Sleep</button><button class="u-btn" data-v="0">Not yet</button></div>`;
    (document.getElementById('ui-root') ?? document.body).appendChild(box);
    const btns = [...box.querySelectorAll<HTMLButtonElement>('button')];
    let sel = 0;
    const mark = (): void => btns.forEach((b, i) => b.classList.toggle('sel', i === sel));
    const t0 = performance.now();
    return new Promise<boolean>((resolve) => {
      const done = (yes: boolean): void => {
        window.removeEventListener('keydown', onKey, true);
        box.classList.add('out');
        setTimeout(() => box.remove(), 170);
        this.asking = false;
        if (!yes) g.player.controllable = wasCtl || !this.busy;
        g.services.audio?.play(yes ? 'ui:click' : 'ui:close');
        resolve(yes);
      };
      const onKey = (e: KeyboardEvent): void => {
        const k = e.key.toLowerCase();
        const nav = ['arrowleft', 'arrowright', 'a', 'd', 'tab'].includes(k);
        const ok = ['enter', ' ', 'e', 'y'].includes(k);
        const no = ['escape', 'n', 'q', 'backspace'].includes(k);
        if (!nav && !ok && !no) return;
        e.preventDefault();
        e.stopImmediatePropagation();
        // The interact press that opened the prompt must not answer it.
        if (performance.now() - t0 < 180 || e.repeat) return;
        if (nav) {
          sel = 1 - sel;
          mark();
          g.services.audio?.play('ui:tick');
        } else done(no ? false : sel === 0);
      };
      window.addEventListener('keydown', onKey, true);
      btns.forEach((b, i) => {
        b.addEventListener('mouseenter', () => ((sel = i), mark()));
        b.addEventListener('click', () => done(b.dataset.v === '1'));
      });
    });
  }

  // ───────────────────────────────────────────── bedtime

  async goToBed(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    const g = this.game;
    g.player.controllable = false;
    if (this.bed()) {
      if (!this.lying) {
        await g.hud.fade(true);
        this.lieDown(true);
        await wait(120);
        await g.hud.fade(false);
      }
      // Lamps and fire ease down, a few sleepy Zzz, then the night.
      this.dimTarget = 1;
      this.zzz = true;
      this.zT = 0.25;
      g.services.audio?.play('sleep');
      await wait(1500);
    }
    await g.hud.fade(true);
    await wait(300);
    this.zzz = false;
    this.sleep();
    if (this.lying) this.lieDown(false);
    this.dimTarget = 0;
    const house = this.house();
    if (house) house.dim = 0;
    await this.wakeAtHome(false);
    this.busy = false;
  }

  /** Lie the farmer on the quilt, head on the pillow (or get up again). */
  private lieDown(on: boolean): void {
    const g = this.game;
    const house = this.house();
    const root = g.player.root;
    const rig = g.player.rig;
    // The contact-shadow blob (a flat child mesh of the root) would stand upright on its edge.
    for (const c of root.children) if ((c as THREE.Mesh).isMesh) c.visible = !on;
    if (rig.hat) rig.hat.visible = !on;
    house?.tuckIn?.(on);
    this.lying = on && !!house;
    if (!this.lying) {
      root.rotation.set(0, 0, 0);
      root.position.copy(g.player.position);
      this.pops.clear();
      return;
    }
    const bed = house!.bed!;
    const pillow = house!.pillow ?? new THREE.Vector3((bed.x0 + bed.x1) / 2, 0.86, bed.z0 + 0.5);
    g.player.teleport((bed.x0 + bed.x1) / 2, Math.min(bed.z1 - 0.3, pillow.z + 1.4));
    g.player.setFacing('down');
    // On its back, feet towards the foot of the bed, face up; then slide so the head rests on the pillow.
    root.rotation.set(-Math.PI / 2, 0, 0);
    root.position.set(pillow.x, pillow.y, pillow.z + 1.5);
    root.updateMatrixWorld(true);
    const head = rig.head.getWorldPosition(new THREE.Vector3());
    this.lieAt.copy(root.position).add(new THREE.Vector3(pillow.x - head.x, pillow.y + 0.08 - head.y, pillow.z + 0.12 - head.z));
    root.position.copy(this.lieAt);
    g.followPlayer(false);
  }

  private standBeside(): void {
    const g = this.game;
    const bed = this.bed();
    g.player.teleport(bed?.wakeX ?? WAKE.x, bed?.wakeZ ?? WAKE.z);
    g.player.setFacing('down');
  }

  update(dt: number, game: Game): void {
    if (this.lying) {
      const r = game.player.root;
      r.rotation.set(-Math.PI / 2, 0, 0);
      r.position.copy(this.lieAt);
      // Eyes shut (the rig's blink groups hold a mesh named 'eye'; the player re-opens them every frame).
      for (const c of game.player.rig.head.children) if (c.children.some((m) => m.name === 'eye')) c.scale.y = 0.12;
    }
    const house = this.house();
    if (house && (house.dim ?? 0) !== this.dimTarget) {
      const d = this.dimTarget - (house.dim ?? 0);
      house.dim = Math.abs(d) < 0.01 ? this.dimTarget : (house.dim ?? 0) + Math.sign(d) * Math.min(Math.abs(d), dt / 0.6);
    }
    if (this.zzz && this.lying) {
      this.zT -= dt;
      if (this.zT <= 0) {
        this.zT = 0.55;
        const h = game.player.rig.head.getWorldPosition(new THREE.Vector3());
        this.pops.z(h.add(new THREE.Vector3(0.18 + Math.random() * 0.1, 0.35, 0.05)));
      }
    }
    this.pops.update(dt, game.rc.camera);
  }

  /** Put the farmer beside the bed in the farmhouse (fading in). */
  private async wakeAtHome(passedOut: boolean): Promise<void> {
    const g = this.game;
    g.player.controllable = false;
    if (passedOut) await g.hud.fade(true);
    try {
      if (g.world.current?.id !== HOUSE && g.world.has(HOUSE)) await g.world.load(HOUSE);
    } catch (err) {
      console.error('[sleep] could not load the farmhouse', err);
    }
    this.standBeside();
    g.followPlayer(true);
    await wait(250);
    await g.hud.fade(false);
    g.player.controllable = true;
    g.events.emit('sleep:wake', { passedOut });
  }
}
