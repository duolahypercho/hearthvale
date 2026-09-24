/**
 * Remote farmers on this machine: snapshot buffers + ~100 ms interpolation, the RemoteFarmer
 * meshes (in the scene only while on the viewer's map), and their DOM name tags / chat bubbles.
 *
 * Samples are stamped with the *sender's* clock (each farmer's own frame time); every RemotePlayer
 * learns its own clock offset (min receive − send delay), so samples relayed from different
 * machines interpolate independently. Tags are placed after the frame renders (game.afterRender),
 * so they always match the camera of the frame on screen — even while paused — and are nudged
 * apart when farmers bunch up. The local farmer gets a speech bubble too.
 */
import * as THREE from 'three';
import type { Game } from '../core/game';
import { RemoteFarmer, type RemoteAnim } from '../entities/remote-farmer';
import { hex, type FarmerLook } from '../entities/remote-look';
import type { EmoteId } from '../entities/remote-emotes';

/** Interpolation delay behind the freshest possible sample (the floor of the adaptive buffer). */
export const INTERP_MS = 100;
/** Ceiling of the adaptive jitter buffer. */
const INTERP_MAX = 260;

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
  /**
   * Adaptive jitter buffer: how far behind the freshest sample we render. Starts at INTERP_MS and
   * grows with the arrival jitter we actually see (busy machines deliver samples in bursts), so the
   * buffer never runs dry mid-walk; it shrinks back slowly when the link calms down.
   */
  interp = INTERP_MS;
  readonly tag: HTMLElement;
  private chatEl: HTMLElement;
  private chatT = 0;
  private tagShown = false;
  private tx = -1;
  private ty = -1;
  /** Screen anchor this frame (before declutter), px; width estimate of the name pill. */
  sx = 0;
  sy = 0;
  tagW = 60;
  onScreen = false;

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
    this.tagW = 34 + name.length * 8.4;
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
    const win = this.delayWindow;
    win.push({ at: now, d });
    while (win.length && now - win[0]!.at > 3000) win.shift();
    let m = Infinity;
    for (const w of win) m = Math.min(m, w.d);
    this.baseDelay = m;
    // Jitter = the second-worst lateness in the window (one hiccup doesn't set the buffer).
    let j1 = 0;
    let j2 = 0;
    for (const w of win) {
      const late = w.d - m;
      if (late > j1) {
        j2 = j1;
        j1 = late;
      } else if (late > j2) j2 = late;
    }
    const want = Math.min(INTERP_MAX, Math.max(INTERP_MS, j2 + 40));
    this.interp += (want - this.interp) * (want > this.interp ? 0.25 : 0.02);
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

  /** Speech bubble over the head (`hold` s overrides the reading-time expiry; demo stills). */
  chat(text: string, hold?: number): void {
    this.chatEl.textContent = text;
    this.chatEl.classList.remove('on');
    void this.chatEl.offsetWidth;
    this.chatEl.classList.add('on');
    this.chatT = hold ?? Math.min(9, 3 + text.length * 0.08);
  }

  emote(id: EmoteId, dur?: number): void {
    this.farmer.emote(id, dur);
  }

  /** Interpolate to (now − baseDelay − interp) in the sender's clock; `now` = this frame's clock. */
  sample(heightAt: (x: number, z: number) => number, now = performance.now()): void {
    const b = this.buf;
    const f = this.farmer;
    if (!b.length) return;
    const rt = now - this.baseDelay - this.interp;
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

  /** Project the name-tag anchor for this frame (screen px); false if off screen / hidden. */
  project(cam: THREE.Camera, visible: boolean, dt: number, v: THREE.Vector3): boolean {
    if (this.chatT > 0) {
      this.chatT -= dt;
      if (this.chatT <= 0) this.chatEl.classList.remove('on');
    }
    let show = visible && this.farmer.anim !== 'hidden' && !this.away;
    if (show) {
      this.farmer.headWorld(v).project(cam);
      show = v.z < 1 && Math.abs(v.x) < 1.2 && Math.abs(v.y) < 1.2;
      if (show) {
        this.sx = ((v.x + 1) / 2) * innerWidth;
        this.sy = ((1 - v.y) / 2) * innerHeight;
      }
    }
    this.onScreen = show;
    return show;
  }

  /** Commit the (decluttered) tag position. */
  apply(px: number, py: number): void {
    const show = this.onScreen;
    if (show) {
      px = Math.round(px);
      py = Math.round(py);
      if (px !== this.tx || py !== this.ty) {
        this.tx = px;
        this.ty = py;
        this.tag.style.transform = `translate(${px}px, ${py}px)`;
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

/** Speech bubble over the local farmer (chat you send shows over your own head too). */
class LocalSay {
  readonly tag: HTMLElement;
  private el: HTMLElement;
  private t = 0;
  private shown = false;
  private tx = -1;
  private ty = -1;

  constructor(tags: HTMLElement) {
    this.tag = document.createElement('div');
    this.tag.className = 'coop-tag self';
    this.el = document.createElement('div');
    this.el.className = 'coop-say';
    this.tag.appendChild(this.el);
    tags.appendChild(this.tag);
  }

  say(text: string): void {
    this.el.textContent = text;
    this.el.classList.remove('on');
    void this.el.offsetWidth;
    this.el.classList.add('on');
    this.t = Math.min(9, 3 + text.length * 0.08);
  }

  get active(): boolean {
    return this.t > 0;
  }

  place(game: Game, dt: number, v: THREE.Vector3, lift = 2.3): { x: number; y: number } | null {
    if (this.t > 0) {
      this.t -= dt;
      if (this.t <= 0) this.el.classList.remove('on');
    }
    let show = this.t > 0 && !game.cinematic && game.player.root.visible;
    let x = 0;
    let y = 0;
    if (show) {
      const p = game.player.position;
      v.set(p.x, p.y + lift, p.z).project(game.rc.camera);
      show = v.z < 1 && Math.abs(v.x) < 1.2 && Math.abs(v.y) < 1.2;
      x = Math.round(((v.x + 1) / 2) * innerWidth);
      y = Math.round(((1 - v.y) / 2) * innerHeight);
      if (show && (x !== this.tx || y !== this.ty)) {
        this.tx = x;
        this.ty = y;
        this.tag.style.transform = `translate(${x}px, ${y}px)`;
      }
    }
    if (show !== this.shown) {
      this.shown = show;
      this.tag.classList.toggle('on', show);
    }
    return show ? { x, y } : null;
  }
}

/** Name pills this close (px) get stacked instead of overlapping. */
const TAG_H = 25;

export class RemotePlayers {
  readonly list = new Map<number, RemotePlayer>();
  readonly tags: HTMLElement;
  private v = new THREE.Vector3();
  private local: LocalSay;
  /** Is an emote bubble showing over our own farmer? (the speech bubble then sits above it) */
  localEmoting: () => boolean = () => false;
  private lastPlace = 0;
  private order: RemotePlayer[] = [];
  private placed: { x: number; y: number; w: number }[] = [];
  /** Is this farmer's angling drawn by the fishing pod (RemoteAngler)? Then we skip our own rod. */
  fishingCheck: ((id: number) => boolean) | null = null;
  /** Extra visibility filter (mine floors share a map id). */
  visibleCheck: ((id: number) => boolean) | null = null;

  constructor(private game: Game) {
    this.tags = document.createElement('div');
    this.tags.className = 'coop-tags';
    if (!game.opts.hud) this.tags.style.display = 'none';
    game.opts.uiRoot.appendChild(this.tags);
    this.local = new LocalSay(this.tags);
  }

  /** Our own chat line, as a bubble over our farmer. */
  sayLocal(text: string): void {
    this.local.say(text);
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

  /** Per frame: interpolate, animate, keep meshes in the scene only on our map (tags: placeTags). */
  update(dt: number, time: number, interpolate = true, now = performance.now()): void {
    dt = Math.max(0, dt);
    const map = this.game.world.current;
    const here = map?.id ?? '';
    const cam = this.game.rc.camera;
    const heightAt = (x: number, z: number): number => (map ? map.heightAt(x, z) : 0);
    for (const p of this.list.values()) {
      const same = p.map === here && !p.away && !this.game.cinematic && (this.visibleCheck?.(p.id) ?? true);
      if (interpolate) p.sample(heightAt, now);
      if (p.farmer.anim === 'fish' && this.fishingCheck?.(p.id)) p.farmer.anim = 'idle';
      const root = p.farmer.root;
      if (same && root.parent !== this.game.scene) this.game.scene.add(root);
      else if (!same && root.parent) root.removeFromParent();
      if (same) p.farmer.update(dt, time);
    }
  }

  /**
   * After the frame renders: project every tag with this frame's camera and stack overlapping name
   * pills (nearest farmer keeps its spot, the ones behind move up). Real-time dt, so bubbles still
   * expire while the sim is paused.
   */
  placeTags(_simDt: number): void {
    const now = performance.now();
    const dt = this.lastPlace ? Math.min(0.1, (now - this.lastPlace) / 1000) : 0;
    this.lastPlace = now;
    const here = this.game.world.current?.id ?? '';
    const cam = this.game.rc.camera;
    const order = this.order;
    order.length = 0;
    for (const p of this.list.values()) {
      const vis = p.map === here && !this.game.cinematic && (this.visibleCheck?.(p.id) ?? true) && !!p.farmer.root.parent;
      if (p.project(cam, vis, dt, this.v)) order.push(p);
      else p.apply(0, 0);
    }
    const placed = this.placed;
    placed.length = 0;
    const me = this.local.place(this.game, dt, this.v, this.localEmoting() ? 3.85 : 2.3);
    if (me) placed.push({ x: me.x, y: me.y - 10, w: 120 });
    // Lower on screen = nearer the camera: those keep their place.
    order.sort((a, b) => b.sy - a.sy);
    for (const p of order) {
      let y = p.sy;
      for (let guard = 0; guard < 6; guard++) {
        let hit = false;
        for (const q of placed) {
          if (Math.abs(q.x - p.sx) < (q.w + p.tagW) / 2 + 4 && Math.abs(q.y - y) < TAG_H) {
            y = q.y - TAG_H;
            hit = true;
          }
        }
        if (!hit) break;
      }
      placed.push({ x: p.sx, y, w: p.tagW });
      p.apply(p.sx, y);
    }
  }
}
