/**
 * Remote farmers on this machine: snapshot buffers + ~100 ms interpolation, the RemoteFarmer
 * meshes (in the scene only while on the viewer's map), and their DOM name tags / chat bubbles.
 *
 * Samples are stamped with the *sender's* clock (each farmer's own frame time); every RemotePlayer
 * runs its own playout clock (playout.ts: offset estimate + adaptive buffer + time dilation, never
 * stepping backwards), so samples relayed from different machines interpolate independently.
 * Tags are laid out after the frame renders (game.afterRender), so they always match the camera of
 * the frame on screen — even while paused. The local farmer gets a speech bubble too.
 */
import * as THREE from 'three';
import type { Game } from '../core/game';
import { RemoteFarmer, type RemoteAnim } from '../entities/remote-farmer';
import { hex, type FarmerLook } from '../entities/remote-look';
import type { EmoteBubble, EmoteId } from '../entities/remote-emotes';
import { Playout } from './playout';

export { INTERP_MS } from './playout';

export const ANIM_CODES: RemoteAnim[] = ['idle', 'walk', 'run', 'fish', 'hidden'];

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
  /** Playout clock + sample buffer (src/net/playout.ts). */
  readonly play = new Playout();
  /** Target jitter buffer (ms), for the roster / tests. */
  get interp(): number {
    return this.play.interp;
  }
  readonly tag: HTMLElement;
  readonly say: SayBubble;
  private label: HTMLElement;
  private tagShown = false;
  private dim = false;
  private tx = -1;
  private ty = -1;
  /** Screen anchor this frame (before layout). */
  readonly anchor: Anchor = { x: 0, y: 0, ppm: 60, z: 0 };
  /** Name pill size, px (measured once per name / UI scale; 0 = stale). */
  tagW = 0;
  tagH = 0;
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
    this.say = new SayBubble(this.tag);
    this.label = document.createElement('div');
    this.label.className = 'coop-name';
    this.tag.appendChild(this.label);
    tags.appendChild(this.tag);
    this.setName(name, look);
  }

  setName(name: string, look: FarmerLook): void {
    this.name = name;
    const label = this.label;
    label.innerHTML = `<i style="background:${hex(look.scarf)}"></i><span></span>`;
    label.querySelector('span')!.textContent = name;
    this.tag.classList.toggle('host', this.isHost);
    this.tagW = 0;
  }

  /** Pill size in px (layout read, only when stale). */
  measure(): void {
    if (this.tagW > 0) return;
    this.tagW = this.label.offsetWidth || 60;
    this.tagH = this.label.offsetHeight || 24;
  }

  setLook(look: FarmerLook): void {
    this.look = look;
    this.farmer.setLook(look);
    this.setName(this.name, look);
  }

  /** A state sample stamped with the sender's clock (ms). */
  push(t: number, x: number, z: number, yaw: number, anim: number, map: string, now = performance.now()): void {
    if (map !== this.map) {
      this.play.reset();
      this.map = map;
    }
    this.play.push(t, x, z, yaw, anim, now);
  }

  /** Place immediately (spawn / snap), no interpolation history. */
  snap(x: number, z: number, map: string): void {
    this.play.reset();
    this.map = map;
    this.farmer.position.set(x, this.farmer.position.y, z);
    this.last = { ...this.last, x, z, map };
  }

  /** Speech bubble over the head (`hold` s overrides the reading-time expiry; demo stills). */
  chat(text: string, hold?: number): void {
    this.say.set(text, hold);
  }

  emote(id: EmoteId, dur?: number): void {
    this.farmer.emote(id, dur);
  }

  /** Pose the farmer at this frame's playout time (`now` = this frame's clock). */
  sample(heightAt: (x: number, z: number) => number, now = performance.now()): void {
    const pl = this.play;
    if (!pl.sample(now)) return;
    const f = this.farmer;
    f.position.set(pl.x, heightAt(pl.x, pl.z), pl.z);
    f.targetYaw = pl.yaw;
    f.speed = pl.speed;
    f.anim = ANIM_CODES[pl.anim] ?? 'idle';
  }

  /** Project the name-tag anchor (head top) for this frame (screen px); false if off screen / hidden. */
  project(cam: THREE.Camera, visible: boolean, v: THREE.Vector3, right: THREE.Vector3): boolean {
    let show = visible && this.farmer.anim !== 'hidden' && !this.away;
    if (show) show = projectAnchor(this.farmer.headWorld(v), cam, right, this.anchor);
    this.onScreen = show;
    return show;
  }

  /** Commit the laid-out tag (pill bottom-centre at px, py). */
  apply(px: number, py: number, dim: boolean): void {
    const show = this.onScreen;
    if (show) {
      px = Math.round(px);
      py = Math.round(py);
      if (px !== this.tx || py !== this.ty) {
        this.tx = px;
        this.ty = py;
        this.tag.style.transform = `translate(${px}px, ${py}px)`;
      }
      if (dim !== this.dim) {
        this.dim = dim;
        this.tag.classList.toggle('dim', dim);
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

/** Screen anchor of a farmer this frame: head top (px), pixels per metre there, NDC depth. */
interface Anchor {
  x: number;
  y: number;
  ppm: number;
  z: number;
}

const _r = new THREE.Vector3();
/** Project world point `v` (clobbered) into `out`; false when off screen. */
function projectAnchor(v: THREE.Vector3, cam: THREE.Camera, right: THREE.Vector3, out: Anchor): boolean {
  _r.copy(v).add(right);
  v.project(cam);
  if (!(v.z < 1 && Math.abs(v.x) < 1.2 && Math.abs(v.y) < 1.2)) return false;
  _r.project(cam);
  out.x = ((v.x + 1) / 2) * innerWidth;
  out.y = ((1 - v.y) / 2) * innerHeight;
  out.z = v.z;
  out.ppm = Math.max(4, Math.hypot(_r.x - v.x, _r.y - v.y) * 0.5 * Math.hypot(innerWidth, innerHeight) * 0.7071);
  return true;
}

/**
 * A chat speech bubble (DOM) above a farmer. Measured once per message (and on a UI-scale change)
 * so the per-frame layout never forces a reflow; laid out by RemotePlayers.placeTags and nudged
 * sideways / up to clear other farmers' bubbles, with its tail kept pointing at its farmer.
 */
class SayBubble {
  readonly el: HTMLElement;
  t = 0;
  w = 0;
  h = 0;
  private dx = 0;
  private dy = 0;

  constructor(parent: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'coop-say';
    parent.appendChild(this.el);
  }

  set(text: string, hold?: number): void {
    this.el.textContent = text;
    this.el.classList.remove('on');
    void this.el.offsetWidth;
    this.el.classList.add('on');
    this.w = 0;
    this.t = hold ?? Math.min(9, 3 + text.length * 0.08);
  }

  get active(): boolean {
    return this.t > 0;
  }

  tick(dt: number): void {
    if (this.t <= 0) return;
    this.t -= dt;
    if (this.t <= 0) this.el.classList.remove('on');
  }

  /** Size in px (layout read, only when stale). */
  measure(): void {
    if (this.w > 0) return;
    this.w = this.el.offsetWidth;
    this.h = this.el.offsetHeight;
  }

  /** Offset from the default spot (centred over the pill) + tail correction. */
  offset(dx: number, dy: number): void {
    dx = Math.round(dx);
    dy = Math.round(dy);
    if (dx === this.dx && dy === this.dy) return;
    this.dx = dx;
    this.dy = dy;
    this.el.style.transform = dx || dy ? `translate(${dx}px, ${dy}px)` : '';
    const tail = Math.max(-this.w / 2 + 18, Math.min(this.w / 2 - 18, -dx));
    this.el.style.setProperty('--tail', `${Math.round(tail)}px`);
  }
}

/** Speech bubble over the local farmer (chat you send shows over your own head too). */
class LocalSay {
  readonly tag: HTMLElement;
  readonly say: SayBubble;
  readonly anchor: Anchor = { x: 0, y: 0, ppm: 60, z: 0 };
  private shown = false;
  private tx = -1;
  private ty = -1;

  constructor(tags: HTMLElement) {
    this.tag = document.createElement('div');
    this.tag.className = 'coop-tag self';
    this.say = new SayBubble(this.tag);
    tags.appendChild(this.tag);
  }

  /** Project our own head for this frame; false when nothing of ours needs laying out. */
  project(game: Game, v: THREE.Vector3, right: THREE.Vector3, emoting: boolean): boolean {
    if (!(this.say.active || emoting) || game.cinematic || !game.player.root.visible) return false;
    const p = game.player.position;
    return projectAnchor(v.set(p.x, p.y + 2.3, p.z), cam(game), right, this.anchor);
  }

  apply(show: boolean): void {
    show = show && this.say.active;
    if (show) {
      const x = Math.round(this.anchor.x);
      const y = Math.round(this.anchor.y);
      if (x !== this.tx || y !== this.ty) {
        this.tx = x;
        this.ty = y;
        this.tag.style.transform = `translate(${x}px, ${y}px)`;
      }
    }
    if (show !== this.shown) {
      this.shown = show;
      this.tag.classList.toggle('on', show);
    }
  }
}

function cam(game: Game): THREE.Camera {
  return game.rc.camera;
}

/** HUD cards tags keep clear of (dimmed over them); re-read twice a second, never per frame. */
const HUD_CARDS = '.h-clock, .hv-toolbar, .hv-energy, .coop-roster:not(.hv-hidden), .hv-np, .coop-log > *';

/**
 * Screen rectangles already claimed this frame (pills, chat and emote bubbles), in a flat pooled
 * array — the layout allocates nothing per frame.
 */
class Rects {
  private a: number[] = [];
  n = 0;
  clear(): void {
    this.n = 0;
  }
  add(x0: number, y0: number, x1: number, y1: number): void {
    const i = this.n++ * 4;
    const a = this.a;
    a[i] = x0;
    a[i + 1] = y0;
    a[i + 2] = x1;
    a[i + 3] = y1;
  }
  /** Index of the first rect overlapping (with `pad` px), or -1. */
  hit(x0: number, y0: number, x1: number, y1: number, pad = 3): number {
    const a = this.a;
    for (let i = 0; i < this.n; i++) {
      const j = i * 4;
      if (x0 < a[j + 2]! + pad && x1 > a[j]! - pad && y0 < a[j + 3]! + pad && y1 > a[j + 1]! - pad) return i;
    }
    return -1;
  }
  top(i: number): number {
    return this.a[i * 4 + 1]!;
  }
}

/** One farmer's overlay stack for this frame's layout. */
interface Actor {
  a: Anchor;
  remote: RemotePlayer | null;
  say: SayBubble;
  bubble: EmoteBubble | null;
}

export class RemotePlayers {
  readonly list = new Map<number, RemotePlayer>();
  readonly tags: HTMLElement;
  private v = new THREE.Vector3();
  private local: LocalSay;
  private lastPlace = 0;
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
    this.local.say.set(text);
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
   * After the frame renders (and before the emote overlay pass): project every farmer with this
   * frame's camera and lay out the overlay. Name pills sit right on the head (stacked a notch when
   * farmers bunch up), emote bubbles beside the pill (never between pill and head), chat bubbles
   * above the pill, nudged sideways / up to clear other bubbles with the tail still on their
   * farmer; anything over a HUD card is dimmed. The whole layer hides while a menu, the day-end card
   * or a cutscene is up. Real-time dt, so bubbles still expire while the sim is paused.
   */
  placeTags(_simDt: number): void {
    const now = performance.now();
    const dt = this.lastPlace ? Math.min(0.1, (now - this.lastPlace) / 1000) : 0;
    this.lastPlace = now;
    const g = this.game;
    this.local.say.tick(dt);
    if (!g.opts.hud) return;
    for (const p of this.list.values()) p.say.tick(dt);
    // Nothing floats over a modal panel (day-end card, menus, dialogue) or a cutscene.
    const hush = !!g.hud.openPanelName || g.cinematic || !!g.renderOverride;
    if (hush !== this.hushed) {
      this.hushed = hush;
      this.tags.classList.toggle('hush', hush);
    }
    const myBubble = this.localBubble();
    if (hush) {
      for (const p of this.list.values()) this.hideBubble(p.farmer.bubble);
      this.hideBubble(myBubble);
      return;
    }
    // UI scale: tags / bubbles grow with the viewport (≈ 14 px text at 720p … 18 px at 1440p).
    const scale = Math.min(1.3, Math.max(1, innerHeight / 900));
    if (scale !== this.scale) {
      this.scale = scale;
      this.tags.style.setProperty('--coop-s', scale.toFixed(3));
      for (const p of this.list.values()) {
        p.tagW = 0;
        p.say.w = 0;
      }
      this.local.say.w = 0;
    }
    if (now - this.hudAt > 500) {
      this.hudAt = now;
      this.readHud();
    }
    const here = g.world.current?.id ?? '';
    const c = g.rc.camera;
    const right = this.right.setFromMatrixColumn(c.matrixWorld, 0).normalize();
    const actors = this.actors;
    let n = 0;
    for (const p of this.list.values()) {
      const vis = p.map === here && (this.visibleCheck?.(p.id) ?? true) && !!p.farmer.root.parent;
      if (p.project(c, vis, this.v, right)) {
        p.measure();
        if (p.say.active) p.say.measure();
        const act = actors[n] ?? (actors[n] = { a: p.anchor, remote: p, say: p.say, bubble: null });
        act.a = p.anchor;
        act.remote = p;
        act.say = p.say;
        act.bubble = p.farmer.bubble.active ? p.farmer.bubble : null;
        n++;
      } else {
        p.apply(0, 0, false);
        this.hideBubble(p.farmer.bubble);
      }
    }
    const meEmote = !!myBubble?.active;
    const meOn = this.local.project(g, this.v, right, meEmote);
    if (meOn) {
      if (this.local.say.active) this.local.say.measure();
      const act = actors[n] ?? (actors[n] = { a: this.local.anchor, remote: null, say: this.local.say, bubble: null });
      act.a = this.local.anchor;
      act.remote = null;
      act.say = this.local.say;
      act.bubble = meEmote ? myBubble : null;
      n++;
    } else this.hideBubble(myBubble);
    this.local.apply(meOn);
    // Lower on screen = nearer the camera: those keep their spot, the ones behind make room.
    const list = this.sorted;
    list.length = n;
    for (let i = 0; i < n; i++) list[i] = actors[i]!;
    list.sort(byNearest);
    const R = this.rects;
    R.clear();
    const hud = this.hud;
    const S = scale;
    for (const act of list) {
      const a = act.a;
      const p = act.remote;
      const x = a.x;
      // Name pill: bottom-centre on the head, moved up a pill at a time past pills in front (≤ 3).
      let y = a.y;
      const pw = p ? p.tagW : 0;
      const ph = p ? p.tagH : 0;
      if (p) {
        for (let k = 0; k < 3; k++) {
          const i = R.hit(x - pw / 2, y - ph, x + pw / 2, y, 2);
          if (i < 0) break;
          y = R.top(i) - 2;
        }
        R.add(x - pw / 2, y - ph, x + pw / 2, y);
        p.apply(x, y, hud.hit(x - pw / 2, y - ph, x + pw / 2, y, 0) >= 0);
      }
      // Emote bubble beside the pill (right, else left), its tail at the pill's end.
      const b = act.bubble;
      if (b) {
        const size = Math.min(92 * S, Math.max(58 * S, 1.1 * a.ppm));
        const gap = p ? pw / 2 + 2 : 10 * S;
        const bottom = y - ph * 0.2;
        let x0 = x + gap;
        const inset = size * 0.1;
        if (R.hit(x0 + inset, bottom - size + inset, x0 + size - inset, bottom) >= 0 || hud.hit(x0, bottom - size, x0 + size, bottom, 0) >= 0) {
          const alt = x - gap - size;
          if (R.hit(alt + inset, bottom - size + inset, alt + size - inset, bottom) < 0 && hud.hit(alt, bottom - size, alt + size, bottom, 0) < 0) x0 = alt;
        }
        R.add(x0 + inset, bottom - size + inset, x0 + size - inset, bottom);
        // Bubble origin (plane spans −0.08…0.92 of its size vertically) → world, at the head's depth.
        const ox = x0 + size / 2;
        const oy = bottom - size * 0.08;
        this.v.set((ox / innerWidth) * 2 - 1, 1 - (oy / innerHeight) * 2, a.z).unproject(c);
        b.pin.copy(this.v);
        b.fit = size / (1.1 * a.ppm);
        b.pinned = true;
        b.pinHidden = hud.hit(x0 + inset, bottom - size + inset, x0 + size - inset, bottom, 0) >= 0;
      }
      // Chat bubble: centred over the pill; else nudged sideways, else stacked up.
      const say = act.say;
      if (say.active && say.w > 0) {
        const w = say.w;
        const h = say.h;
        const base = y - ph - 10 * S; // bubble bottom (tail below it)
        let best = 0;
        let bestDy = 0;
        let found = false;
        for (let row = 0; row < 3 && !found; row++) {
          const dy = -row * (h * 0.55 + 6);
          for (const f of NUDGE) {
            const dx = f * w;
            const x0 = x - w / 2 + dx;
            const y1 = base + dy;
            if (R.hit(x0, y1 - h, x0 + w, y1) < 0 && hud.hit(x0, y1 - h, x0 + w, y1, 0) < 0) {
              best = dx;
              bestDy = dy;
              found = true;
              break;
            }
          }
        }
        const x0 = x - w / 2 + best;
        R.add(x0, base + bestDy - h, x0 + w, base + bestDy);
        say.offset(best, base + bestDy - y);
      }
    }
  }

  private hushed = false;
  private scale = 0;
  private hudAt = -1e9;
  private right = new THREE.Vector3();
  private actors: Actor[] = [];
  private sorted: Actor[] = [];
  private rects = new Rects();
  private hud = new Rects();
  /** Our own emote bubble (net/system.ts owns it), for the layout. */
  localBubble: () => EmoteBubble | null = () => null;

  private hideBubble(b: EmoteBubble | null): void {
    if (!b || !b.active) return;
    b.pinned = true;
    b.pinHidden = true;
  }

  private readHud(): void {
    const H = this.hud;
    H.clear();
    const els = this.game.opts.uiRoot.querySelectorAll<HTMLElement>(HUD_CARDS);
    for (const e of els) {
      const r = e.getBoundingClientRect();
      if (r.width > 4 && r.height > 4 && e.offsetParent !== null) H.add(r.left, r.top, r.right, r.bottom);
    }
  }
}

/** Sideways nudges tried for a chat bubble (fractions of its width). */
const NUDGE = [0, -0.34, 0.34, -0.62, 0.62];

function byNearest(a: Actor, b: Actor): number {
  return b.a.y - a.a.y;
}
