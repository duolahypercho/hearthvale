/**
 * Remote farmers on this machine: snapshot buffers + ~100 ms interpolation, the RemoteFarmer
 * meshes (in the scene only while on the viewer's map), and their DOM name tags / chat bubbles.
 */
import * as THREE from 'three';
import type { Game } from '../core/game';
import { RemoteFarmer, type RemoteAnim } from '../entities/remote-farmer';
import { hex, type FarmerLook } from '../entities/remote-look';
import type { EmoteId } from '../entities/remote-emotes';

/** Interpolation delay behind the freshest possible sample. */
export const INTERP_MS = 100;

export const ANIM_CODES: RemoteAnim[] = ['idle', 'walk', 'run', 'fish', 'hidden'];

interface Sample {
  t: number;
  x: number;
  z: number;
  yaw: number;
  anim: number;
}

export class RemotePlayer {
  readonly farmer: RemoteFarmer;
  map = '';
  ready = false;
  away = false;
  ping = 0;
  isHost = false;
  cabin = -1;
  /** Last authoritative position (host validation / snapshots). */
  last = { x: 0, z: 0, t: 0, ct: 0, map: '', yaw: 0, anim: 0 };
  /** Latest stamina the farmhand reported (host-side validation / roster). */
  energy = 0;
  lastUse = 0;
  lastSeq = 0;
  private buf: Sample[] = [];
  /** min(receive time − source time) over a sliding window: one-way delay + clock offset. */
  private baseDelay = Infinity;
  private delayWindow: { at: number; d: number }[] = [];
  readonly tag: HTMLElement;
  private chatEl: HTMLElement;
  private chatT = 0;
  private tagShown = false;
  private tx = -1;
  private ty = -1;

  constructor(
    readonly id: number,
    public name: string,
    public look: FarmerLook,
    tags: HTMLElement,
  ) {
    this.farmer = new RemoteFarmer(look);
    this.tag = document.createElement('div');
    this.tag.className = 'coop-tag';
    this.chatEl = document.createElement('div');
    this.chatEl.className = 'coop-say';
    this.tag.appendChild(this.chatEl);
    const label = document.createElement('div');
    label.className = 'coop-name';
    this.tag.appendChild(label);
    tags.appendChild(this.tag);
    this.setName(name, look);
  }

  setName(name: string, look: FarmerLook): void {
    this.name = name;
    const label = this.tag.querySelector('.coop-name') as HTMLElement;
    label.innerHTML = `<i style="background:${hex(look.scarf)}"></i><span></span>`;
    label.querySelector('span')!.textContent = name;
    this.tag.classList.toggle('host', this.isHost);
  }

  setLook(look: FarmerLook): void {
    this.look = look;
    this.farmer.setLook(look);
    this.setName(this.name, look);
  }

  /** A state sample stamped with the sender's clock (ms). */
  push(t: number, x: number, z: number, yaw: number, anim: number, map: string): void {
    const now = performance.now();
    // A different clock (rejoin after a reload, host restart): start the buffer over.
    const tail = this.buf[this.buf.length - 1];
    if (tail && t < tail.t - 1000) {
      this.buf.length = 0;
      this.delayWindow.length = 0;
    }
    const d = now - t;
    this.delayWindow.push({ at: now, d });
    while (this.delayWindow.length && now - this.delayWindow[0]!.at > 3000) this.delayWindow.shift();
    let m = Infinity;
    for (const w of this.delayWindow) m = Math.min(m, w.d);
    this.baseDelay = m;
    if (map !== this.map) {
      this.buf.length = 0;
      this.map = map;
    }
    const lastS = this.buf[this.buf.length - 1];
    if (lastS && t <= lastS.t) return;
    // Teleports (warps, beds) snap instead of sliding across the map.
    if (lastS && Math.hypot(x - lastS.x, z - lastS.z) > 4) this.buf.length = 0;
    this.buf.push({ t, x, z, yaw, anim });
    if (this.buf.length > 40) this.buf.splice(0, this.buf.length - 40);
  }

  /** Place immediately (spawn / snap), no interpolation history. */
  snap(x: number, z: number, map: string): void {
    this.buf.length = 0;
    this.map = map;
    this.farmer.position.set(x, this.farmer.position.y, z);
    this.last = { ...this.last, x, z, map };
  }

  chat(text: string): void {
    this.chatEl.textContent = text;
    this.chatEl.classList.remove('on');
    void this.chatEl.offsetWidth;
    this.chatEl.classList.add('on');
    this.chatT = Math.min(9, 3 + text.length * 0.08);
  }

  emote(id: EmoteId, dur?: number): void {
    this.farmer.emote(id, dur);
  }

  /** Interpolate to (now − baseDelay − INTERP_MS) in the sender's clock. */
  sample(heightAt: (x: number, z: number) => number): void {
    const b = this.buf;
    const f = this.farmer;
    if (!b.length) return;
    const rt = performance.now() - this.baseDelay - INTERP_MS;
    let a = b[0]!;
    let c = b[b.length - 1]!;
    let x: number;
    let z: number;
    let speed = 0;
    if (rt <= a.t) {
      x = a.x;
      z = a.z;
      c = a;
    } else if (rt >= c.t) {
      // Extrapolate briefly (≤ 120 ms) along the last segment, then hold.
      const p = b.length > 1 ? b[b.length - 2]! : c;
      const dt = Math.max(1, c.t - p.t);
      const k = Math.min(rt - c.t, 120) / dt;
      x = c.x + (c.x - p.x) * k;
      z = c.z + (c.z - p.z) * k;
      speed = rt - c.t < 150 ? (Math.hypot(c.x - p.x, c.z - p.z) / dt) * 1000 : 0;
      a = c;
    } else {
      let i = 0;
      while (i < b.length - 2 && b[i + 1]!.t < rt) i++;
      a = b[i]!;
      c = b[i + 1]!;
      const k = (rt - a.t) / Math.max(1, c.t - a.t);
      x = a.x + (c.x - a.x) * k;
      z = a.z + (c.z - a.z) * k;
      speed = (Math.hypot(c.x - a.x, c.z - a.z) / Math.max(1, c.t - a.t)) * 1000;
    }
    f.position.set(x, heightAt(x, z), z);
    f.targetYaw = c.yaw;
    f.speed = speed;
    f.anim = ANIM_CODES[c.anim] ?? 'idle';
  }

  /** Name tag / chat bubble position (screen px). */
  place(cam: THREE.Camera, visible: boolean, dt: number, v: THREE.Vector3): void {
    if (this.chatT > 0) {
      this.chatT -= dt;
      if (this.chatT <= 0) this.chatEl.classList.remove('on');
    }
    let show = visible && this.farmer.anim !== 'hidden';
    if (show) {
      this.farmer.headWorld(v).project(cam);
      show = v.z < 1 && Math.abs(v.x) < 1.2 && Math.abs(v.y) < 1.2;
      if (show) {
        const px = Math.round(((v.x + 1) / 2) * innerWidth);
        const py = Math.round(((1 - v.y) / 2) * innerHeight);
        if (px !== this.tx || py !== this.ty) {
          this.tx = px;
          this.ty = py;
          this.tag.style.transform = `translate(${px}px, ${py}px)`;
        }
      }
    }
    if (show !== this.tagShown) {
      this.tagShown = show;
      this.tag.classList.toggle('on', show);
    }
  }

  dispose(): void {
    this.farmer.dispose();
    this.tag.remove();
  }
}

export class RemotePlayers {
  readonly list = new Map<number, RemotePlayer>();
  readonly tags: HTMLElement;
  private v = new THREE.Vector3();
  /** Is this farmer's angling drawn by the fishing pod (RemoteAngler)? Then we skip our own rod. */
  fishingCheck: ((id: number) => boolean) | null = null;
  /** Extra visibility filter (mine floors share a map id). */
  visibleCheck: ((id: number) => boolean) | null = null;

  constructor(private game: Game) {
    this.tags = document.createElement('div');
    this.tags.className = 'coop-tags';
    if (!game.opts.hud) this.tags.style.display = 'none';
    game.opts.uiRoot.appendChild(this.tags);
  }

  add(id: number, name: string, look: FarmerLook): RemotePlayer {
    let p = this.list.get(id);
    if (p) {
      p.setLook(look);
      p.setName(name, look);
      return p;
    }
    p = new RemotePlayer(id, name, look, this.tags);
    this.list.set(id, p);
    return p;
  }

  get(id: number): RemotePlayer | undefined {
    return this.list.get(id);
  }

  remove(id: number): void {
    const p = this.list.get(id);
    if (!p) return;
    p.dispose();
    this.list.delete(id);
  }

  clear(): void {
    for (const id of [...this.list.keys()]) this.remove(id);
  }

  /** Per frame: interpolate, animate, keep meshes in the scene only on our map, place tags. */
  update(dt: number, time: number, interpolate = true): void {
    const map = this.game.world.current;
    const here = map?.id ?? '';
    const cam = this.game.rc.camera;
    const heightAt = (x: number, z: number): number => (map ? map.heightAt(x, z) : 0);
    for (const p of this.list.values()) {
      const same = p.map === here && !this.game.cinematic && (this.visibleCheck?.(p.id) ?? true);
      if (interpolate) p.sample(heightAt);
      if (p.farmer.anim === 'fish' && this.fishingCheck?.(p.id)) p.farmer.anim = 'idle';
      const root = p.farmer.root;
      if (same && root.parent !== this.game.scene) this.game.scene.add(root);
      else if (!same && root.parent) root.removeFromParent();
      if (same) p.farmer.update(dt, time);
      p.place(cam, same, dt, this.v);
    }
  }
}
