/**
 * EnergySystem: the stamina bar. Tools spend it through the `energy` service; it refills
 * overnight — fully after a proper sleep, only half after passing out, and to 3/4 if the farmer
 * went to bed exhausted.
 *
 * Running dry: at 0 the farmer is exhausted — heavy work (charged tool slams) is refused
 * (`canAct(heavy)`), plain swings still go through but push the bar negative. Below 0 the farmer
 * trudges at ~55 % speed with sweat drops popping off the hat; at MIN_ENERGY (-15) they collapse
 * and pass out (the day ends as a pass-out: half energy tomorrow + the clinic fee).
 *   out: energy:change { energy, max }, energy:exhausted, energy:passout
 */
import * as THREE from 'three';
import type { System } from '../core/system';
import type { Game } from '../core/game';

export interface EnergyApi {
  value(): number;
  max(): number;
  /** Spend stamina (down to MIN_ENERGY). Returns false if the farmer was already exhausted. */
  spend(n: number): boolean;
  restore(n: number): void;
  set(n: number): void;
  exhausted(): boolean;
  /** May the farmer start this action? Heavy actions are refused once the bar is empty. */
  canAct(heavy?: boolean): boolean;
}

declare module '../core/game' {
  interface GameServices {
    energy: EnergyApi;
  }
}

declare module '../core/events' {
  interface GameEvents {
    /** Energy just hit 0 (player slows, HUD pulses, a sigh SFX). */
    'energy:exhausted': Record<string, never>;
    /** The farmer worked past MIN_ENERGY and collapsed (thud SFX; the day ends as a pass-out). */
    'energy:passout': Record<string, never>;
    /** A heavy action was refused because the farmer is too tired (a weary grunt SFX). */
    'energy:refused': { action: string };
  }
}

export const MAX_ENERGY = 270;
/** Working past empty: the bar may run this far negative before the farmer passes out. */
export const MIN_ENERGY = -15;
/** Walk / run speed multiplier while running on fumes (energy < 0). */
const TIRED_SPEED = 0.55;

interface Sweat {
  mesh: THREE.Mesh;
  t: number;
  side: number;
}

export class EnergySystem implements System, EnergyApi {
  readonly name = 'energy';
  private game!: Game;
  private cur = MAX_ENERGY;
  private cap = MAX_ENERGY;
  private passedOut = false;
  private collapsing = false;
  private baseSpeed = 0;
  private baseRun = 0;
  private slowed = false;
  private sweat: Sweat[] = [];
  private sweatT = 0;
  private sweatSide = 1;
  private sweatMat: THREE.MeshStandardMaterial | null = null;
  private sweatGeo: THREE.BufferGeometry | null = null;

  init(game: Game): void {
    this.game = game;
    game.provide('energy', this);
    this.baseSpeed = game.player.speed;
    this.baseRun = game.player.runSpeed;
    game.events.on('day:end', ({ passedOut }) => (this.passedOut = passedOut));
    game.events.on('day:start', () => {
      const wasExhausted = this.cur <= 0;
      this.set(this.passedOut ? this.cap * 0.5 : wasExhausted ? this.cap * 0.75 : this.cap);
      this.passedOut = false;
      this.collapsing = false;
    });
  }

  value(): number {
    return this.cur;
  }

  max(): number {
    return this.cap;
  }

  exhausted(): boolean {
    return this.cur <= 0;
  }

  canAct(heavy = false): boolean {
    if (this.collapsing) return false;
    return heavy ? this.cur > 0 : this.cur > MIN_ENERGY;
  }

  spend(n: number): boolean {
    const was = this.cur;
    this.set(this.cur - n);
    if (was > 0 && this.cur <= 0) this.game.events.emit('energy:exhausted', {});
    if (this.cur <= MIN_ENERGY && !this.collapsing) this.collapse();
    return was > 0;
  }

  restore(n: number): void {
    this.set(this.cur + n);
  }

  set(n: number): void {
    this.cur = Math.max(MIN_ENERGY, Math.min(this.cap, Math.round(n)));
    this.game.events.emit('energy:change', { energy: this.cur, max: this.cap });
  }

  /** Worked past the limit: the farmer sways, drops and the day ends as a pass-out. */
  private collapse(): void {
    this.collapsing = true;
    const g = this.game;
    g.events.emit('energy:passout', {});
    g.events.emit('ui:toast', { text: 'You worked yourself to the bone… <b>everything goes dark</b>', kind: 'bad' });
    g.player.controllable = false;
    g.rc.rig.addShake(0.25);
    window.setTimeout(() => {
      g.player.controllable = true;
      if (this.collapsing) g.calendar.endDay(true);
    }, 1400);
  }

  update(dt: number, game: Game): void {
    const pl = game.player;
    const tired = this.cur < 0;
    // Trudge when running on fumes (restore the speeds once rested). Only touched on a change.
    if (tired !== this.slowed && this.baseSpeed > 0) {
      this.slowed = tired;
      pl.speed = this.baseSpeed * (tired ? TIRED_SPEED : 1);
      pl.runSpeed = this.baseRun * (tired ? TIRED_SPEED : 1);
    }
    this.updateSweat(dt, tired, pl.root);
  }

  /** Sweat drops flick off the farmer's brow every ~0.8 s while exhausted. */
  private updateSweat(dt: number, on: boolean, root: THREE.Object3D): void {
    if (on) {
      this.sweatT -= dt;
      if (this.sweatT <= 0) {
        this.sweatT = 0.8;
        this.sweatSide = -this.sweatSide;
        this.spawnSweat(root);
      }
    }
    for (let i = this.sweat.length - 1; i >= 0; i--) {
      const s = this.sweat[i]!;
      s.t += dt;
      const t = s.t / 0.7;
      if (t >= 1) {
        s.mesh.visible = false;
        continue;
      }
      // Pops out sideways from the temple, arcs and falls, shrinking.
      s.mesh.visible = true;
      s.mesh.position.set(s.side * (0.34 + t * 0.32), 2.3 + Math.sin(t * Math.PI) * 0.22 - t * t * 0.5, 0.25);
      s.mesh.rotation.z = -s.side * (0.4 + t * 0.9);
      const k = t < 0.15 ? t / 0.15 : 1 - Math.max(0, (t - 0.6) / 0.4);
      s.mesh.scale.setScalar(Math.max(0.001, k));
    }
  }

  private spawnSweat(root: THREE.Object3D): void {
    if (!this.sweatGeo) {
      // Teardrop: a sphere pulled up into a point.
      const g = new THREE.SphereGeometry(0.055, 10, 8);
      const p = g.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < p.count; i++) {
        const y = p.getY(i);
        if (y > 0) {
          const k = 1 - (y / 0.055) * 0.85;
          p.setX(i, p.getX(i) * k);
          p.setZ(i, p.getZ(i) * k);
          p.setY(i, y * 2.1);
        }
      }
      g.computeVertexNormals();
      this.sweatGeo = g;
      this.sweatMat = new THREE.MeshStandardMaterial({ color: 0x9fd8ff, roughness: 0.15, emissive: 0x2a5a80, emissiveIntensity: 0.35 });
    }
    let s = this.sweat.find((x) => x.t >= 0.7 && x.mesh.parent === root);
    if (!s) {
      const mesh = new THREE.Mesh(this.sweatGeo, this.sweatMat!);
      mesh.name = 'sweat';
      mesh.visible = false;
      root.add(mesh);
      s = { mesh, t: 0, side: 1 };
      this.sweat.push(s);
    }
    s.t = 0;
    s.side = this.sweatSide;
  }

  save(): unknown {
    return { energy: this.cur, max: this.cap };
  }

  load(data: unknown): void {
    const d = data as { energy?: number; max?: number };
    if (typeof d?.max === 'number') this.cap = d.max;
    if (typeof d?.energy === 'number') this.set(d.energy);
  }
}
