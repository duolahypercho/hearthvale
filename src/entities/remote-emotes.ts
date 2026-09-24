/**
 * 3D emote bubbles over a farmer's head: a speech bubble sprite with a procedurally drawn icon
 * (one shared canvas atlas, one sprite per farmer, drawn only while visible). Pops in with an
 * overshoot, bobs, then shrinks away.
 */
import * as THREE from 'three';

export const EMOTES = ['heart', 'happy', 'laugh', 'wow', 'question', 'music', 'sleepy', 'sweat'] as const;
export type EmoteId = (typeof EMOTES)[number];
export const EMOTE_LABEL: Record<EmoteId, string> = {
  heart: 'Love it',
  happy: 'Happy',
  laugh: 'Ha ha!',
  wow: 'Wow!',
  question: 'Huh?',
  music: 'Humming',
  sleepy: 'Sleepy',
  sweat: 'Phew',
};

const CELL = 128;
let atlas: THREE.CanvasTexture | null = null;
let atlasCanvas: HTMLCanvasElement | null = null;

/** The emote atlas canvas (also used by the DOM emote wheel for its icons). */
export function emoteAtlasCanvas(): HTMLCanvasElement {
  if (atlasCanvas) return atlasCanvas;
  const c = document.createElement('canvas');
  c.width = CELL * 4;
  c.height = CELL * 2;
  const g = c.getContext('2d')!;
  EMOTES.forEach((id, i) => {
    const ox = (i % 4) * CELL;
    const oy = Math.floor(i / 4) * CELL;
    g.save();
    g.translate(ox, oy);
    drawBubble(g);
    g.translate(CELL / 2, CELL * 0.43);
    drawIcon(g, id);
    g.restore();
  });
  atlasCanvas = c;
  return c;
}

/** One emote icon as a data URL (DOM use). */
const iconUrls = new Map<EmoteId, string>();
export function emoteIconUrl(id: EmoteId): string {
  let u = iconUrls.get(id);
  if (u) return u;
  const src = emoteAtlasCanvas();
  const c = document.createElement('canvas');
  c.width = c.height = CELL;
  const i = EMOTES.indexOf(id);
  c.getContext('2d')!.drawImage(src, (i % 4) * CELL, Math.floor(i / 4) * CELL, CELL, CELL, 0, 0, CELL, CELL);
  u = c.toDataURL();
  iconUrls.set(id, u);
  return u;
}

function atlasTexture(): THREE.CanvasTexture {
  if (!atlas) {
    atlas = new THREE.CanvasTexture(emoteAtlasCanvas());
    atlas.colorSpace = THREE.SRGBColorSpace;
    atlas.anisotropy = 4;
  }
  return atlas;
}

function drawBubble(g: CanvasRenderingContext2D): void {
  const s = CELL;
  g.save();
  g.shadowColor = 'rgba(40,20,5,0.35)';
  g.shadowBlur = 8;
  g.shadowOffsetY = 3;
  g.fillStyle = '#fffaf0';
  g.strokeStyle = '#4a2e1a';
  g.lineWidth = 6;
  g.beginPath();
  const r = s * 0.36;
  g.arc(s / 2, s * 0.43, r, 0, Math.PI * 2);
  g.fill();
  g.shadowColor = 'transparent';
  g.stroke();
  // Tail
  g.beginPath();
  g.moveTo(s * 0.44, s * 0.76);
  g.lineTo(s * 0.5, s * 0.92);
  g.lineTo(s * 0.58, s * 0.74);
  g.closePath();
  g.fill();
  g.beginPath();
  g.moveTo(s * 0.43, s * 0.775);
  g.lineTo(s * 0.5, s * 0.93);
  g.lineTo(s * 0.59, s * 0.755);
  g.stroke();
  // Cover the stroke seam inside the bubble.
  g.beginPath();
  g.arc(s / 2, s * 0.43, r - 3, 0.25 * Math.PI, 0.75 * Math.PI);
  g.lineTo(s / 2, s * 0.43);
  g.fill();
  g.restore();
}

function drawIcon(g: CanvasRenderingContext2D, id: EmoteId): void {
  const ink = '#4a2e1a';
  g.lineCap = 'round';
  g.lineJoin = 'round';
  const face = (fill: string): void => {
    g.fillStyle = fill;
    g.strokeStyle = ink;
    g.lineWidth = 4;
    g.beginPath();
    g.arc(0, 0, 27, 0, Math.PI * 2);
    g.fill();
    g.stroke();
  };
  switch (id) {
    case 'heart': {
      g.fillStyle = '#e8506a';
      g.strokeStyle = '#7a1a2a';
      g.lineWidth = 4;
      g.beginPath();
      g.moveTo(0, 22);
      g.bezierCurveTo(-34, 0, -26, -28, 0, -12);
      g.bezierCurveTo(26, -28, 34, 0, 0, 22);
      g.fill();
      g.stroke();
      g.fillStyle = 'rgba(255,255,255,0.6)';
      g.beginPath();
      g.ellipse(-11, -8, 6, 4, -0.6, 0, Math.PI * 2);
      g.fill();
      break;
    }
    case 'happy': {
      face('#ffd35a');
      g.fillStyle = ink;
      g.beginPath();
      g.arc(-9, -6, 3.5, 0, Math.PI * 2);
      g.arc(9, -6, 3.5, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = ink;
      g.lineWidth = 4;
      g.beginPath();
      g.arc(0, 2, 12, 0.15 * Math.PI, 0.85 * Math.PI);
      g.stroke();
      g.fillStyle = 'rgba(240,110,90,0.55)';
      g.beginPath();
      g.arc(-16, 6, 5, 0, Math.PI * 2);
      g.arc(16, 6, 5, 0, Math.PI * 2);
      g.fill();
      break;
    }
    case 'laugh': {
      face('#ffc94a');
      g.strokeStyle = ink;
      g.lineWidth = 4;
      g.beginPath();
      g.moveTo(-14, -6);
      g.lineTo(-7, -10);
      g.lineTo(-14, -14);
      g.moveTo(14, -6);
      g.lineTo(7, -10);
      g.lineTo(14, -14);
      g.stroke();
      g.fillStyle = '#8a2a1a';
      g.beginPath();
      g.moveTo(-14, 2);
      g.quadraticCurveTo(0, 26, 14, 2);
      g.closePath();
      g.fill();
      g.stroke();
      break;
    }
    case 'wow': {
      g.fillStyle = '#ff9a3a';
      g.strokeStyle = ink;
      g.lineWidth = 4;
      g.beginPath();
      g.roundRect(-7, -30, 14, 38, 6);
      g.fill();
      g.stroke();
      g.beginPath();
      g.arc(0, 20, 7, 0, Math.PI * 2);
      g.fill();
      g.stroke();
      break;
    }
    case 'question': {
      g.strokeStyle = '#3d6f8f';
      g.lineWidth = 11;
      g.beginPath();
      g.arc(0, -10, 14, -Math.PI * 0.95, Math.PI * 0.35);
      g.quadraticCurveTo(2, 2, 1, 10);
      g.stroke();
      g.fillStyle = '#3d6f8f';
      g.beginPath();
      g.arc(1, 24, 6.5, 0, Math.PI * 2);
      g.fill();
      break;
    }
    case 'music': {
      g.fillStyle = '#7a5ac8';
      g.strokeStyle = '#7a5ac8';
      g.lineWidth = 6;
      g.beginPath();
      g.moveTo(-8, 16);
      g.lineTo(-8, -22);
      g.lineTo(18, -28);
      g.lineTo(18, 10);
      g.stroke();
      g.beginPath();
      g.ellipse(-15, 18, 9, 7, -0.4, 0, Math.PI * 2);
      g.ellipse(11, 12, 9, 7, -0.4, 0, Math.PI * 2);
      g.fill();
      break;
    }
    case 'sleepy': {
      g.fillStyle = '#5a7ab8';
      g.font = 'bold 34px Fredoka, Nunito, sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText('Z', -10, 8);
      g.font = 'bold 24px Fredoka, Nunito, sans-serif';
      g.fillText('z', 10, -8);
      g.font = 'bold 16px Fredoka, Nunito, sans-serif';
      g.fillText('z', 22, -22);
      break;
    }
    case 'sweat': {
      face('#ffd35a');
      g.strokeStyle = ink;
      g.lineWidth = 4;
      g.beginPath();
      g.moveTo(-14, -6);
      g.lineTo(-5, -6);
      g.moveTo(5, -6);
      g.lineTo(14, -6);
      g.moveTo(-9, 12);
      g.quadraticCurveTo(0, 6, 9, 12);
      g.stroke();
      g.fillStyle = '#6ec0f0';
      g.strokeStyle = '#2a6a9a';
      g.lineWidth = 3;
      g.beginPath();
      g.moveTo(22, -26);
      g.quadraticCurveTo(32, -10, 22, -6);
      g.quadraticCurveTo(12, -10, 22, -26);
      g.fill();
      g.stroke();
      break;
    }
  }
}

const BUBBLE_GEO = new THREE.PlaneGeometry(1, 1).translate(0, 0.42, 0);

/**
 * Bubbles are drawn in their own tiny overlay pass AFTER post-processing (renderEmoteOverlay, run from
 * game.afterRender): tilt-shift, bloom and the grade used to smear the white bubble into a pale ghost
 * whenever it sat in the blurred top band of the screen. Drawn crisp and on top, like the name pills.
 */
const overlay = new THREE.Scene();
overlay.name = 'emote-overlay';
overlay.matrixWorldAutoUpdate = false;
const live = new Set<EmoteBubble>();
const _v = new THREE.Vector3();
let lastFrame = -1;

/**
 * Draw every live emote bubble over the frame the renderer just produced. Skips frames where the
 * world was not redrawn (throttled menu backdrops), so bubbles never land on a stale / cleared canvas.
 */
export function renderEmoteOverlay(renderer: THREE.WebGLRenderer, camera: THREE.Camera): void {
  const frame = renderer.info.render.frame;
  const drew = frame !== lastFrame;
  lastFrame = frame;
  if (!drew || live.size === 0) return;
  let any = false;
  for (const b of live) {
    const a = b.anchor;
    const on = !!a.parent && a.visible && b.active;
    b.sprite.visible = on;
    if (!on) continue;
    any = true;
    a.localToWorld(_v.set(0, b.lift, 0));
    b.sprite.position.copy(_v);
    camera.getWorldQuaternion(b.sprite.quaternion);
    b.sprite.updateMatrixWorld();
  }
  if (!any) return;
  const auto = renderer.autoClear;
  const target = renderer.getRenderTarget();
  renderer.autoClear = false;
  renderer.setRenderTarget(null);
  renderer.clearDepth();
  renderer.render(overlay, camera);
  renderer.setRenderTarget(target);
  renderer.autoClear = auto;
  // Our own render bumped the frame counter: remember it so the next check still works.
  lastFrame = renderer.info.render.frame;
}

/** A camera-facing quad over `anchor` (a farmer root), drawn by renderEmoteOverlay. */
export class EmoteBubble {
  readonly sprite: THREE.Mesh;
  private tex: THREE.Texture;
  private t = -1;
  private dur = 2.6;
  /** Height of the bubble's base above the anchor, m. */
  lift = 2.75;

  constructor(readonly anchor: THREE.Object3D) {
    this.tex = atlasTexture().clone();
    this.tex.repeat.set(0.25, 0.5);
    this.tex.needsUpdate = true;
    const m = new THREE.MeshBasicMaterial({ map: this.tex, transparent: true, alphaTest: 0.35, depthWrite: false, depthTest: false, fog: false, toneMapped: false });
    this.sprite = new THREE.Mesh(BUBBLE_GEO, m);
    this.sprite.name = 'emote';
    this.sprite.visible = false;
    this.sprite.frustumCulled = false;
    this.sprite.scale.setScalar(0.001);
  }

  /** Pop the bubble for `dur` seconds (demo stills pass a long hold). */
  show(id: EmoteId, dur = 2.6): void {
    this.dur = dur;
    const i = Math.max(0, EMOTES.indexOf(id));
    this.tex.offset.set((i % 4) * 0.25, 0.5 - Math.floor(i / 4) * 0.5);
    this.t = 0;
    if (!live.has(this)) {
      live.add(this);
      overlay.add(this.sprite);
    }
  }

  get active(): boolean {
    return this.t >= 0;
  }

  update(dt: number, time: number): void {
    if (this.t < 0) return;
    this.t += dt;
    const t = this.t;
    let s: number;
    if (t < 0.28) {
      const k = t / 0.28;
      s = 1 + 2.2 * Math.pow(k - 1, 3) + 1.2 * Math.pow(k - 1, 2);
    } else if (t < this.dur - 0.25) s = 1 + Math.sin(time * 5) * 0.03;
    else s = Math.max(0, (this.dur - t) / 0.25);
    const size = 1.1 * Math.max(0.001, s);
    this.sprite.scale.set(size, size, 1);
    this.lift = 2.75 + Math.sin(time * 3) * 0.04;
    if (t >= this.dur) this.hide();
  }

  private hide(): void {
    this.t = -1;
    this.sprite.visible = false;
    live.delete(this);
    this.sprite.removeFromParent();
  }

  dispose(): void {
    this.hide();
    this.tex.dispose();
    (this.sprite.material as THREE.Material).dispose();
  }
}
