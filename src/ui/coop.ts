/**
 * Co-op UI (DESIGN pillar 13):
 *   'coop' screen    character creator (live 3D turntable preview, name, skin / hair / outfit / hat) +
 *                    Host / Join-by-code / lobby (invite code tiles, 4 farmer slots, pings, Kick) —
 *                    `coop:title` when opened from the title screen, `coop:demo` = staged lobby.
 *                    Rendered cheaply (ui/coop-stage.ts): the world is a cached blurred still and the
 *                    turntable is drawn by the main renderer — no second WebGL context.
 *   HUD              roster plate (top-left: farmers, ping, who's in bed), chat log + input (T),
 *                    emote wheel (hold G, 1-8), "waiting for the others" bedtime overlay,
 *                    a "Co-op" card injected into the pause menu (player list, invite code, open to co-op).
 */
import './coop.css';
import * as THREE from 'three';
import type { Game } from '../core/game';
import type { NetApi, PlayerView } from '../net/system';
import { Screen, el, sfx, replay, escapeHtml, frame } from './kit';
import { RemoteFarmer } from '../entities/remote-farmer';
import { EMOTES, EMOTE_LABEL, emoteIconUrl, type EmoteId } from '../entities/remote-emotes';
import { HAIR_STYLES, HAT_STYLES, PALETTE, PRESET_LOOKS, DEMO_HOST_LOOK, hex, randomLook, extra, EYE_STYLES, BROW_STYLES, MOUTH_STYLES, OUTFIT_CUTS, ACCESSORIES, type FarmerLook, type HairStyle, type HatStyle, type EyeStyle, type BrowStyle, type MouthStyle, type OutfitCut, type Accessory } from '../entities/remote-look';
import { resetCamera } from './pause';
import { ICONS, itemIconUrl } from './icons';
import { LobbyRenderer, type TurntableView } from './coop-stage';

const PEOPLE_ICON = `<svg viewBox="0 0 24 24" width="22" height="22"><circle cx="8.5" cy="8" r="3.4" fill="#f5c9a0" stroke="#5a3418" stroke-width="1.3"/><path d="M2.6 19.5 C3 14.6 5.6 13 8.5 13 C11.4 13 14 14.6 14.4 19.5Z" fill="#5f8a5c" stroke="#2f4a2c" stroke-width="1.3"/><circle cx="16.2" cy="9" r="3" fill="#e0a878" stroke="#5a3418" stroke-width="1.3"/><path d="M12.4 19.5 C12.8 15.4 14.4 14 16.2 14 C19 14 21 15.6 21.4 19.5Z" fill="#4b6c9e" stroke="#26375a" stroke-width="1.3"/></svg>`;
const CROWN = `<svg viewBox="0 0 24 16" width="18" height="12"><path d="M2 14 L3.5 4 L8.5 9 L12 2 L15.5 9 L20.5 4 L22 14Z" fill="#f7cf4a" stroke="#8a5a0a" stroke-width="1.6" stroke-linejoin="round"/></svg>`;
const ZZZ = `<b class="zz" aria-hidden="true">z<small>z</small></b>`;
const SAY_ICON = `<svg viewBox="0 0 24 22" width="22" height="20"><path d="M4 2.5 H20 A2.5 2.5 0 0 1 22.5 5 V13 A2.5 2.5 0 0 1 20 15.5 H11 L6 20 V15.5 H4 A2.5 2.5 0 0 1 1.5 13 V5 A2.5 2.5 0 0 1 4 2.5Z" fill="#fffaf0" stroke="#6a3c1a" stroke-width="1.8" stroke-linejoin="round"/><circle cx="7.5" cy="9" r="1.4" fill="#6a3c1a"/><circle cx="12" cy="9" r="1.4" fill="#6a3c1a"/><circle cx="16.5" cy="9" r="1.4" fill="#6a3c1a"/></svg>`;

const HAIR_LABEL: Record<HairStyle, string> = { tousled: 'Tousled', bob: 'Bob', bun: 'Bun', spiky: 'Spiky', long: 'Long', buzz: 'Buzz' };
const HAT_LABEL: Record<HatStyle, string> = { straw: 'Straw', cap: 'Cap', beanie: 'Beanie', flower: 'Flower', none: 'None' };
const EYE_LABEL: Record<EyeStyle, string> = { round: 'Round', bright: 'Sparkly', sleepy: 'Sleepy', joyful: 'Joyful' };
const BROW_LABEL: Record<BrowStyle, string> = { soft: 'Soft', bold: 'Bold', arched: 'Arched' };
const MOUTH_LABEL: Record<MouthStyle, string> = { smile: 'Smile', grin: 'Grin', cat: 'Cat', o: 'Ooh' };
const CUT_LABEL: Record<OutfitCut, string> = { overalls: 'Overalls', pinafore: 'Pinafore', vest: 'Waistcoat', apron: 'Apron' };
const ACC_LABEL: Record<Accessory, string> = { none: 'None', glasses: 'Glasses', flower: 'Daisy', scarf: 'Scarf' };
type MakerTab = 'look' | 'face' | 'outfit';
const MAKER_TABS: { id: MakerTab; label: string }[] = [
  { id: 'look', label: 'Hair & hat' },
  { id: 'face', label: 'Face' },
  { id: 'outfit', label: 'Outfit' },
];

/** Little portrait disc for a farmer (kerchief ring, hair cap, skin face). */
function avatar(look: FarmerLook, size = 34): string {
  return `<span class="coop-av" style="--s:${size}px;--skin:${hex(look.skin)};--hair:${hex(look.hair)};--ring:${hex(look.scarf)};--hat:${hex(look.hatColor)}"><i class="face"></i><i class="hair"></i>${look.hat !== 'none' ? '<i class="hat"></i>' : ''}</span>`;
}

function pingBars(ms: number): string {
  const n = ms <= 0 ? 0 : ms < 60 ? 3 : ms < 150 ? 2 : 1;
  return `<span class="coop-ping q${n}" title="${Math.round(ms)} ms"><i></i><i></i><i></i></span>`;
}

// ───────────────────────────────────────────────────────── 3D preview

const STAGE_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.9999, 1.0);
}`;
// The parchment stage behind the farmer (the same gradients the CSS stage used): warm radial light
// and a soft green floor shadow. Display-referred colours, not tone mapped.
const STAGE_FRAG = /* glsl */ `
varying vec2 vUv;
void main() {
  vec2 p = vec2(vUv.x, 1.0 - vUv.y);
  // Soft meadow-morning backdrop: a sage sky behind the hat (a cream straw hat used to vanish into
  // the cream card), warm haze toward the horizon, then a deeper green floor the grass tile sits on.
  vec3 sky = mix(vec3(0.70, 0.83, 0.80), vec3(0.98, 0.93, 0.80), smoothstep(0.05, 0.62, p.y));
  float glow = 1.0 - smoothstep(0.0, 0.5, length((p - vec2(0.5, 0.45)) / vec2(0.7, 0.55)));
  sky += vec3(0.06, 0.05, 0.02) * glow;
  vec3 floorC = mix(vec3(0.55, 0.66, 0.38), vec3(0.36, 0.48, 0.24), smoothstep(0.7, 1.0, p.y));
  vec3 c = mix(sky, floorC, smoothstep(0.66, 0.74, p.y));
  // Vignette.
  vec2 q = (p - 0.5) * vec2(1.0, 1.15);
  c *= 1.0 - 0.38 * smoothstep(0.32, 0.78, length(q));
  gl_FragColor = vec4(c, 1.0);
}`;

/** Character-creator turntable: a scene the lobby renderer draws with the main WebGL context. */
class FarmerPreview implements TurntableView {
  readonly canvas: HTMLCanvasElement;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(30, 300 / 262, 0.1, 50);
  width = 300;
  height = 262;
  private farmer: RemoteFarmer;
  private spin = 0.35;
  private drag: number | null = null;
  private t = 0;

  constructor(look: FarmerLook) {
    this.canvas = el('canvas', 'coop-preview');
    const pr = Math.min(2, devicePixelRatio || 1);
    this.canvas.width = Math.round(this.width * pr);
    this.canvas.height = Math.round(this.height * pr);
    this.farmer = new RemoteFarmer(look);
    // A portrait, not a turntable of the back of a head: the farmer keeps glancing at you.
    this.farmer.gaze = 0;
    this.scene.add(this.farmer.root);
    const bg = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({ vertexShader: STAGE_VERT, fragmentShader: STAGE_FRAG, depthWrite: false }));
    bg.frustumCulled = false;
    bg.renderOrder = -10;
    this.scene.add(bg);
    // Warm portrait lighting (the New Journal's late-afternoon key): low golden key from the front
    // left, a honey bounce off the ground, a cool sky rim that separates hat and shoulders.
    const hemi = new THREE.HemisphereLight(0xfff0d2, 0x8a7a4a, 1.9);
    const key = new THREE.DirectionalLight(0xffd49a, 3.1);
    key.position.set(-2.2, 3.2, 3.8);
    const fill = new THREE.DirectionalLight(0xffe8c8, 0.9);
    fill.position.set(3, 1.2, 2.5);
    const rim = new THREE.DirectionalLight(0xb8d4ff, 1.8);
    rim.position.set(2.5, 2.8, -3.2);
    this.scene.add(hemi, key, fill, rim);
    // A little grass tile to stand on: soil sides, a tufted top, a soft contact shadow under the boots.
    const tile = new THREE.Group();
    const soil = new THREE.Mesh(new THREE.CylinderGeometry(0.98, 0.9, 0.22, 40), new THREE.MeshStandardMaterial({ color: 0x8a5a34, roughness: 0.95 }));
    soil.position.y = -0.12;
    const turf = new THREE.Mesh(new THREE.CylinderGeometry(1.0, 1.0, 0.07, 40), new THREE.MeshStandardMaterial({ color: 0x7cb04c, roughness: 0.9 }));
    turf.position.y = -0.02;
    tile.add(soil, turf);
    const tufts = new THREE.InstancedMesh(new THREE.ConeGeometry(0.035, 0.14, 4), new THREE.MeshStandardMaterial({ color: 0x8cc35a, roughness: 0.8 }), 70);
    const m4 = new THREE.Matrix4();
    for (let i = 0; i < 70; i++) {
      const a = i * 2.39996;
      const rr = 0.42 + ((i * 37) % 53) / 53 * 0.52;
      m4.makeRotationZ((((i * 13) % 7) - 3) * 0.08).setPosition(Math.cos(a) * rr, 0.06, Math.sin(a) * rr);
      tufts.setMatrixAt(i, m4);
    }
    tile.add(tufts);
    const shadowTex = (() => {
      const c = document.createElement('canvas');
      c.width = c.height = 64;
      const g = c.getContext('2d')!;
      const grd = g.createRadialGradient(32, 32, 2, 32, 32, 32);
      grd.addColorStop(0, 'rgba(20,30,10,0.55)');
      grd.addColorStop(1, 'rgba(20,30,10,0)');
      g.fillStyle = grd;
      g.fillRect(0, 0, 64, 64);
      return new THREE.CanvasTexture(c);
    })();
    const shadow = new THREE.Mesh(new THREE.PlaneGeometry(1.3, 1.0), new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false }));
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = 0.017;
    tile.add(shadow);
    this.scene.add(tile);
    // Framed like a portrait: boots to hat fill ~85 % of the stage height.
    // (r4: the hat crown kissed the top edge; pulled back + down so every hat has headroom.)
    this.camera.position.set(0, 1.5, 4.95);
    this.camera.lookAt(0, 1.08, 0);
    this.canvas.addEventListener('pointerdown', (e) => {
      this.drag = e.clientX;
      this.canvas.setPointerCapture(e.pointerId);
    });
    this.canvas.addEventListener('pointermove', (e) => {
      if (this.drag === null) return;
      this.farmer.yaw += (e.clientX - this.drag) * 0.012;
      this.farmer.targetYaw = this.farmer.yaw;
      this.drag = e.clientX;
    });
    this.canvas.addEventListener('pointerup', () => (this.drag = null));
  }

  setLook(look: FarmerLook): void {
    this.farmer.setLook(look);
    this.farmer.emote('happy');
  }

  wave(): void {
    this.farmer.act('pull', null);
  }

  /** "Try an emote": a wave + the emote's bubble popping over the turntable farmer (DOM, on the stage). */
  tryEmote(id: EmoteId, bubble: HTMLElement): void {
    this.farmer.wave(1.4);
    bubble.innerHTML = `<img src="${emoteIconUrl(id)}" alt=""/><span>${EMOTE_LABEL[id]}</span>`;
    replay(bubble, 'pop');
  }

  /** Stop the spin at `yaw` (radians, 0 = facing the camera). */
  hold(yaw: number): void {
    this.spin = 0;
    this.farmer.yaw = yaw;
    this.farmer.targetYaw = yaw;
  }

  tick(dt: number): void {
    // Fill the whole stage (its width follows the panel).
    const w = this.canvas.clientWidth || 300;
    const h = this.canvas.clientHeight || 262;
    if (w !== this.width || h !== this.height) {
      this.width = w;
      this.height = h;
      const pr = Math.min(2, devicePixelRatio || 1);
      this.canvas.width = Math.round(w * pr);
      this.canvas.height = Math.round(h * pr);
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
    }
    dt = Math.min(0.05, dt);
    this.t += dt;
    if (this.drag === null) {
      this.farmer.yaw += dt * this.spin;
      this.farmer.targetYaw = this.farmer.yaw;
    }
    this.farmer.update(dt, this.t);
  }
}

// ───────────────────────────────────────────────────────── screen

type View = 'menu' | 'lobby' | 'joining' | 'joined';

class CoopScreen extends Screen {
  private preview: FarmerPreview | null = null;
  private look: FarmerLook;
  private name: string;
  private fromTitle = false;
  private demo = false;
  private err = '';
  private view: View = 'menu';
  private stage: LobbyRenderer;

  constructor(
    game: Game,
    parent: HTMLElement,
    private net: NetApi,
  ) {
    super(game, parent, 'hv-coop', { backdrop: true, backdropCloses: false });
    this.stage = new LobbyRenderer(game);
    const p = net.profile();
    this.look = { ...p.look };
    this.name = p.name;
    game.events.on('net:status', () => this.isOpen && !this.demo && this.renderSession());
    game.events.on('net:roster', () => this.isOpen && !this.demo && this.renderSession());
    game.events.on('net:error', ({ text }) => {
      this.err = text;
      if (this.isOpen) this.renderSession();
    });
  }

  protected render(arg?: string): void {
    this.fromTitle = arg === 'title';
    this.demo = arg === 'demo';
    this.err = '';
    const p = this.net.profile();
    this.look = this.demo ? { ...DEMO_HOST_LOOK } : { ...p.look };
    this.name = this.demo ? 'Marigold' : p.name;
    this.root.querySelector('.coop-wrap')?.remove();
    const wrap = el('div', 'coop-wrap');
    const a = frame('Your Farmer', 'coop-maker');
    const b = frame('Co-op Farm', 'coop-session');
    wrap.append(a.frame, b.frame);
    this.root.appendChild(wrap);
    const close = el('button', 'u-close', `<svg viewBox="0 0 20 20"><path d="M5 5 L15 15 M15 5 L5 15" stroke="#fff" stroke-width="3.2" stroke-linecap="round"/></svg>`);
    close.dataset.nav = '';
    close.addEventListener('click', () => this.leaveScreen());
    b.frame.appendChild(close);
    this.renderMaker(a.body);
    this.renderSession();
  }

  private leaveScreen(): void {
    sfx(this.game, 'close');
    if (this.fromTitle && this.net.role() === 'solo') this.game.events.emit('ui:open', { name: 'title' });
    else this.game.events.emit('ui:open', { name: 'none' });
  }

  override back(): boolean {
    this.leaveScreen();
    return true;
  }

  // ── character creator ──

  private renderMaker(body: HTMLElement): void {
    this.preview = new FarmerPreview(this.look);
    this.stage.setView(this.preview);
    const stage = el('div', 'coop-stage');
    stage.appendChild(this.preview.canvas);
    const dice = el('button', 'u-btn small coop-dice', `<svg viewBox="0 0 24 24" width="18" height="18"><rect x="3" y="3" width="18" height="18" rx="4" fill="#fff6e0" stroke="#5e3517" stroke-width="1.8"/><circle cx="8" cy="8" r="1.7" fill="#5e3517"/><circle cx="16" cy="16" r="1.7" fill="#5e3517"/><circle cx="12" cy="12" r="1.7" fill="#5e3517"/><circle cx="16" cy="8" r="1.7" fill="#5e3517"/><circle cx="8" cy="16" r="1.7" fill="#5e3517"/></svg><span>Surprise me</span>`);
    dice.dataset.nav = '';
    dice.addEventListener('click', () => {
      this.look = randomLook();
      sfx(this.game, 'toggle');
      this.commitLook(body);
    });
    stage.appendChild(dice);
    // Try an emote: cycles through the wheel's emotes on the turntable (bubble + a wave).
    const bubble = el('div', 'coop-try-bubble');
    stage.appendChild(bubble);
    const tryBtn = el('button', 'u-btn small coop-try', `<img src="${emoteIconUrl('happy')}" alt=""/><span>Try an emote</span>`);
    tryBtn.dataset.nav = '';
    let ei = 0;
    tryBtn.addEventListener('click', () => {
      const id = EMOTES[ei++ % EMOTES.length]!;
      sfx(this.game, 'toggle');
      this.preview?.tryEmote(id, bubble);
      tryBtn.querySelector('img')!.src = emoteIconUrl(EMOTES[ei % EMOTES.length]!);
    });
    stage.appendChild(tryBtn);
    body.appendChild(stage);

    const nameRow = el('label', 'coop-name-row', `<span>Name</span>`);
    const input = el('input', 'coop-input');
    input.type = 'text';
    input.maxLength = 20;
    input.value = this.name;
    input.spellcheck = false;
    input.addEventListener('input', () => {
      this.name = input.value;
      this.refreshMeCard();
    });
    input.addEventListener('change', () => this.saveProfile());
    input.addEventListener('keydown', (e) => e.stopPropagation());
    nameRow.appendChild(input);
    body.appendChild(nameRow);

    this.renderMakerOptions(body);
  }

  private chipRow<T extends string>(label: string, values: readonly T[], names: Record<T, string>, cur: T, set: (v: T) => void, body: HTMLElement): HTMLElement {
    const row = el('div', 'coop-row', `<span class="lbl">${label}</span>`);
    const chips = el('div', 'coop-chips');
    for (const v of values) {
      const b = el('button', `coop-chip${v === cur ? ' on' : ''}`, names[v]);
      b.dataset.nav = '';
      b.addEventListener('click', () => {
        set(v);
        sfx(this.game, 'click');
        this.commitLook(body);
      });
      chips.appendChild(b);
    }
    row.appendChild(chips);
    return row;
  }

  private commitLook(body: HTMLElement): void {
    this.preview?.setLook(this.look);
    this.refreshMeCard();
    // Refresh the selection states without rebuilding the preview.
    body.querySelectorAll('.coop-opts').forEach((n) => n.remove());
    this.renderMakerOptions(body);
    this.saveProfile();
  }

  private makerTab: MakerTab = 'look';
  /** Tallest tab's options height (px), so switching tabs never re-centres the panels. */
  private optsMinH = 0;

  /** Your own lobby card follows the creator live (avatar + name), without replaying the slot animations. */
  private refreshMeCard(): void {
    const s = this.root.querySelector<HTMLElement>('.coop-session .coop-slot.me');
    if (!s) return;
    const av = s.firstElementChild;
    const tmp = document.createElement('div');
    tmp.innerHTML = avatar(this.look, 42);
    if (av && tmp.firstElementChild) av.replaceWith(tmp.firstElementChild);
    const b = s.querySelector('b');
    if (b?.firstChild?.nodeType === Node.TEXT_NODE) b.firstChild.textContent = this.name.trim() || 'Farmer';
  }

  /** Measure every tab once and pin the options box to the tallest. */
  private pinOptsHeight(body: HTMLElement, opts: HTMLElement): void {
    if (this.optsMinH) {
      opts.style.minHeight = `${this.optsMinH}px`;
      return;
    }
    const cur = this.makerTab;
    let h = 0;
    for (const t of MAKER_TABS) {
      this.makerTab = t.id;
      const probe = this.buildMakerOptions(body);
      probe.style.position = 'absolute';
      probe.style.visibility = 'hidden';
      probe.style.width = `${opts.offsetWidth}px`;
      body.appendChild(probe);
      h = Math.max(h, probe.offsetHeight);
      probe.remove();
    }
    this.makerTab = cur;
    if (h > 0) {
      this.optsMinH = h;
      opts.style.minHeight = `${h}px`;
    }
  }

  private renderMakerOptions(body: HTMLElement): void {
    const opts = this.buildMakerOptions(body);
    body.appendChild(opts);
    this.pinOptsHeight(body, opts);
  }

  private buildMakerOptions(body: HTMLElement): HTMLElement {
    const opts = el('div', 'coop-opts');
    const tabs = el('div', 'coop-tabs');
    for (const t of MAKER_TABS) {
      const b = el('button', `coop-tab${t.id === this.makerTab ? ' on' : ''}`, t.label);
      b.dataset.nav = '';
      b.addEventListener('click', () => {
        if (this.makerTab === t.id) return;
        this.makerTab = t.id;
        sfx(this.game, 'click');
        body.querySelectorAll('.coop-opts').forEach((n) => n.remove());
        this.renderMakerOptions(body);
      });
      tabs.appendChild(b);
    }
    opts.appendChild(tabs);
    const swatch = (key: keyof FarmerLook, label: string, colors: readonly number[]): void => {
      const row = el('div', 'coop-row', `<span class="lbl">${label}</span>`);
      const sw = el('div', 'coop-sw');
      for (const c of colors) {
        const b = el('button', `coop-dot${this.look[key] === c ? ' on' : ''}`);
        b.style.setProperty('--c', hex(c));
        b.dataset.nav = '';
        b.addEventListener('click', () => {
          (this.look as unknown as Record<string, number>)[key] = c;
          sfx(this.game, 'click');
          this.commitLook(body);
        });
        sw.appendChild(b);
      }
      row.appendChild(sw);
      opts.appendChild(row);
    };
    const L = this.look;
    if (this.makerTab === 'look') {
      swatch('skin', 'Skin', PALETTE.skin);
      swatch('hair', 'Hair', PALETTE.hair);
      opts.appendChild(this.chipRow('Style', HAIR_STYLES, HAIR_LABEL, L.hairStyle, (v) => (L.hairStyle = v as HairStyle), body));
      opts.appendChild(this.chipRow('Hat', HAT_STYLES, HAT_LABEL, L.hat, (v) => (L.hat = v as HatStyle), body));
      swatch('hatColor', 'Hat colour', PALETTE.hatColor);
    } else if (this.makerTab === 'face') {
      opts.appendChild(this.chipRow('Eyes', EYE_STYLES, EYE_LABEL, extra(L, 'eyes'), (v) => (L.eyes = v), body));
      opts.appendChild(this.chipRow('Brows', BROW_STYLES, BROW_LABEL, extra(L, 'brows'), (v) => (L.brows = v), body));
      opts.appendChild(this.chipRow('Mouth', MOUTH_STYLES, MOUTH_LABEL, extra(L, 'mouth'), (v) => (L.mouth = v), body));
      opts.appendChild(this.chipRow('Extra', ACCESSORIES, ACC_LABEL, extra(L, 'accessory'), (v) => (L.accessory = v), body));
      swatch('skin', 'Skin', PALETTE.skin);
    } else {
      opts.appendChild(this.chipRow('Cut', OUTFIT_CUTS, CUT_LABEL, extra(L, 'outfit'), (v) => (L.outfit = v), body));
      swatch('overalls', CUT_LABEL[extra(L, 'outfit')], PALETTE.overalls);
      swatch('shirt', 'Shirt', PALETTE.shirt);
      swatch('scarf', extra(L, 'accessory') === 'scarf' ? 'Scarf' : 'Kerchief', PALETTE.scarf);
    }
    return opts;
  }

  private saveProfile(): void {
    if (this.demo) return;
    this.net.setProfile({ name: this.name, look: { ...this.look } });
  }

  // ── session side ──

  private sessionBody(): HTMLElement | null {
    return this.root.querySelector('.coop-session .u-paper');
  }

  private renderSession(): void {
    const body = this.sessionBody();
    if (!body) return;
    const role = this.net.role();
    const st = this.net.status();
    this.view = this.demo ? 'lobby' : role === 'host' ? 'lobby' : role === 'client' ? (st === 'playing' ? 'joined' : 'joining') : 'menu';
    body.innerHTML = '';
    if (this.view === 'menu') this.menuView(body);
    else if (this.view === 'joining') this.joiningView(body);
    else this.lobbyView(body);
    this.nav.attach(this.root, this.root.querySelector<HTMLElement>('.coop-session [data-nav].is-default'));
  }

  private menuView(body: HTMLElement): void {
    const hostCard = el('div', 'coop-card host');
    hostCard.innerHTML = `<div class="ic">${PEOPLE_ICON}</div><h3>Host a farm</h3><p>Open your farm to up to <b>3 friends</b>. Each farmhand gets a cabin on your land, their own backpack and energy — the fields, the purse and the calendar are shared.</p>`;
    const hb = el('div', 'coop-btns');
    const mk = (label: string, cls: string, fn: () => void): HTMLElement => {
      const b = el('button', `u-btn ${cls}`, `<span>${label}</span>`);
      b.dataset.nav = '';
      b.addEventListener('click', () => {
        sfx(this.game, 'click');
        fn();
      });
      return b;
    };
    if (this.fromTitle) {
      hb.appendChild(mk('New farm', 'green is-default', () => void this.startHost('new')));
      if (this.latestSave()) hb.appendChild(mk('My saved farm', '', () => void this.startHost('save')));
    } else hb.appendChild(mk('Open my farm', 'green is-default', () => void this.startHost('here')));
    hostCard.appendChild(hb);

    const joinCard = el('div', 'coop-card join');
    joinCard.innerHTML = `<div class="ic"><svg viewBox="0 0 24 24" width="22" height="22"><path d="M4 21 V9 L12 3 L20 9 V21Z" fill="#e8c890" stroke="#5a3418" stroke-width="1.5" stroke-linejoin="round"/><rect x="9.5" y="13" width="5" height="8" rx="1" fill="#b8643e" stroke="#5a3418" stroke-width="1.3"/></svg></div><h3>Join a farm</h3><p>Ask your host for their <b>6-letter invite code</b>.</p>`;
    const code = el('input', 'coop-code-in');
    code.type = 'text';
    code.maxLength = 6;
    code.placeholder = 'ABC123';
    code.spellcheck = false;
    code.autocomplete = 'off';
    code.addEventListener('input', () => {
      code.value = code.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
    });
    code.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') go();
    });
    const go = (): void => {
      if (code.value.length < 6) {
        replay(code, 'shake');
        sfx(this.game, 'error');
        return;
      }
      this.err = '';
      this.saveProfile();
      void this.net.join(code.value, { fromTitle: this.fromTitle }).catch((e: Error) => {
        this.err = e.message;
        this.renderSession();
      });
      this.renderSession();
    };
    const jb = el('div', 'coop-btns');
    jb.append(code, mk('Join', 'blue', go));
    joinCard.appendChild(jb);
    if (this.err) joinCard.appendChild(el('div', 'coop-err', escapeHtml(this.err)));

    const server = el('details', 'coop-server');
    server.innerHTML = `<summary>Server</summary>`;
    const si = el('input', 'coop-input small');
    si.value = this.net.serverUrl;
    si.addEventListener('keydown', (e) => e.stopPropagation());
    si.addEventListener('change', () => {
      this.net.serverUrl = si.value.trim();
      try {
        localStorage.setItem('hearthvale.server', this.net.serverUrl);
      } catch {
        /* ignore */
      }
    });
    server.appendChild(si);
    server.appendChild(el('small', '', 'Run <code>npm run server</code> on the host machine (port 8787).'));
    body.append(hostCard, joinCard, server);
  }

  private latestSave(): string | null {
    for (const s of ['auto', 'slot1', 'slot2', 'slot3']) {
      try {
        if (localStorage.getItem(`hearthvale.save.${s}`)) return s;
      } catch {
        return null;
      }
    }
    return null;
  }

  private async startHost(mode: 'new' | 'save' | 'here'): Promise<void> {
    this.saveProfile();
    this.err = '';
    if (mode === 'save') {
      const s = this.latestSave();
      if (s) this.game.saves.load(s);
    }
    try {
      await this.net.host();
    } catch (e) {
      this.err = `${(e as Error).message} — is <code>npm run server</code> running?`;
    }
    this.renderSession();
  }

  private joiningView(body: HTMLElement): void {
    body.innerHTML = `<div class="coop-wait"><div class="barrow"><i></i><i></i><i></i></div><h3>Knocking on the farmhouse door…</h3><p>Farm <b>${escapeHtml(this.net.code() ?? '')}</b> · ${escapeHtml(this.net.status())}</p>${this.err ? `<div class="coop-err">${escapeHtml(this.err)}</div>` : ''}</div>`;
    const b = el('button', 'u-btn red small', '<span>Cancel</span>');
    b.dataset.nav = '';
    b.addEventListener('click', () => {
      this.net.leave();
      this.renderSession();
    });
    body.querySelector('.coop-wait')!.appendChild(b);
  }

  private lobbyView(body: HTMLElement): void {
    const code = this.demo ? 'HV7K2Q' : (this.net.code() ?? '······');
    const players: PlayerView[] = this.demo ? demoPlayers(this.name, this.look) : this.net.players();
    const hosting = this.demo || this.net.role() === 'host';
    const codeBox = el('div', 'coop-codebox');
    codeBox.innerHTML = `<small>${hosting ? 'Invite code — share it with your friends' : 'Farm code'}</small><div class="tiles">${[...code].map((c, i) => `<b style="animation-delay:${i * 60}ms">${escapeHtml(c)}</b>`).join('')}</div>`;
    const copy = el('button', 'u-btn small', '<span>Copy</span>');
    copy.dataset.nav = '';
    copy.addEventListener('click', () => {
      void navigator.clipboard?.writeText(code).catch(() => {});
      copy.querySelector('span')!.textContent = 'Copied!';
      sfx(this.game, 'coin');
    });
    codeBox.appendChild(copy);
    body.appendChild(codeBox);

    const slots = el('div', 'coop-slots');
    for (let i = 0; i < 4; i++) {
      const p = players[i];
      if (!p) {
        slots.appendChild(el('div', 'coop-slot empty', `<span class="coop-av empty"></span><div><b>Open slot</b><small>waiting for a farmhand…</small></div>`));
        continue;
      }
      const s = el('div', `coop-slot${p.isMe ? ' me' : ''}${p.away ? ' away' : ''}`);
      s.style.animationDelay = `${i * 70}ms`;
      s.innerHTML = `${avatar(p.look, 42)}<div><b>${escapeHtml(p.name)}${p.isHost ? ` ${CROWN}` : ''}</b><small>${p.isHost ? 'Host' : p.cabin >= 0 ? `Farmhand · cabin ${p.cabin + 1}` : 'Farmhand'}${p.isMe ? ' · you' : ''}${p.away ? ' · reconnecting…' : ''}</small></div><span class="side">${p.isMe && p.isHost ? '' : pingBars(p.ping)}</span>`;
      if (hosting && !p.isMe) s.querySelector('.side')!.appendChild(this.kickButton(p));
      slots.appendChild(s);
    }
    body.appendChild(slots);

    const btns = el('div', 'coop-btns wide');
    const start = el('button', 'u-btn green is-default', `<span>${this.fromTitle ? 'Start farming' : 'Back to the farm'}</span>`);
    start.dataset.nav = '';
    start.addEventListener('click', () => {
      sfx(this.game, 'click');
      if (this.demo) return;
      this.begin();
    });
    const leave = el('button', 'u-btn red', `<span>${hosting ? 'Close farm' : 'Leave'}</span>`);
    leave.dataset.nav = '';
    leave.addEventListener('click', () => {
      sfx(this.game, 'click');
      if (this.demo) return;
      this.net.leave();
      this.renderSession();
    });
    btns.append(start, leave);
    body.appendChild(btns);
    body.appendChild(el('div', 'coop-hint', `<b>T</b> chat · hold <b>G</b> emotes · the day ends when <b>everyone</b> is in bed`));
    body.appendChild(
      el(
        'ul',
        'coop-how',
        `<li><b>Shared:</b> the fields, the purse, the calendar and the weather</li><li><b>Your own:</b> backpack, energy, skills and friendships</li><li>Farmhands sleep in their <b>cabins</b> — knock on your door to turn in</li>`,
      ),
    );
  }

  /** Host: a small "Kick" on a farmhand's card (asks once). */
  private kickButton(p: PlayerView): HTMLElement {
    const b = el('button', 'coop-kick', `<span>Kick</span>`);
    b.dataset.nav = '';
    b.title = `Ask ${p.name} to leave (frees the slot)`;
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      if (this.demo) return;
      if (!b.classList.contains('sure')) {
        b.classList.add('sure');
        b.querySelector('span')!.textContent = 'Sure?';
        sfx(this.game, 'toggle');
        setTimeout(() => {
          b.classList.remove('sure');
          const sp = b.querySelector('span');
          if (sp) sp.textContent = 'Kick';
        }, 2500);
        return;
      }
      sfx(this.game, 'click');
      this.net.kick(p.id);
    });
    return b;
  }

  /** Leave the title backdrop and start the day (host from title). */
  private begin(): void {
    const g = this.game;
    const fromTitle = this.fromTitle;
    void g.hud.fade(true).then(() => {
      g.events.emit('ui:open', { name: 'none' });
      if (fromTitle) {
        const map = g.world.current;
        if (map && map.id === 'farm') {
          g.player.teleport(map.spawn.x, map.spawn.z);
          g.player.setFacing(map.spawn.facing);
        }
        g.calendar.setHour(6.2);
      }
      g.setPaused(false);
      resetCamera(g);
      setTimeout(() => void g.hud.fade(false), 200);
    });
  }

  override open(arg?: string): void {
    super.open(arg);
    this.stage.begin(this.preview);
    // The HUD under the lobby is softened (it used to sit under the CSS backdrop blur).
    this.game.hud.root.classList.add('h-coop-open');
    if (arg === 'demo') {
      // Stills: hold a friendly three-quarter pose instead of catching the turntable mid-spin.
      this.preview?.hold(0.45);
      setTimeout(() => this.preview?.wave(), 250);
    }
  }

  protected override onClose(): void {
    this.stage.end();
    this.game.hud.root.classList.remove('h-coop-open');
  }
}

function demoPlayers(name: string, look: FarmerLook): PlayerView[] {
  const base = { ready: false, map: 'farm', away: false };
  return [
    { ...base, id: 1, name, look, isHost: true, isMe: true, ping: 0, cabin: -1 },
    // Same farmhands (names + looks) as the coop-farm demo (net/demo.ts).
    { ...base, id: 2, name: 'Juniper', look: PRESET_LOOKS[0]!, isHost: false, isMe: false, ping: 34, cabin: 0 },
    { ...base, id: 3, name: 'Pip', look: PRESET_LOOKS[1]!, isHost: false, isMe: false, ping: 71, cabin: 1 },
  ];
}

// ───────────────────────────────────────────────────────── HUD pieces

export class CoopUi {
  private screen: CoopScreen;
  private hud: HTMLElement;
  private roster: HTMLElement;
  private chatBox: HTMLElement;
  private chatLog: HTMLElement;
  private chatInput: HTMLInputElement;
  private chatRow: HTMLElement;
  private chatCount: HTMLElement;
  private wheel: HTMLElement;
  private sleepEl: HTMLElement;
  /** "Juniper and Pip are in bed" — the gentle holdout nudge for the last farmer still up. */
  private nudge: HTMLElement;
  private nudgeKey = '';
  private wheelOpen = false;
  private wheelSel: EmoteId | null = null;
  private rosterKey = '';
  private lines: { node: HTMLElement; t: number }[] = [];
  private forceShown = false;

  constructor(
    private game: Game,
    private net: NetApi,
  ) {
    this.screen = new CoopScreen(game, game.hud.screens, net);
    game.hud.registerPanel('coop', this.screen);
    this.hud = el('div', 'coop-hud');
    if (!game.opts.hud) this.hud.classList.add('hv-hidden');
    game.opts.uiRoot.appendChild(this.hud);
    this.roster = el('div', 'coop-roster hv-hidden');
    this.chatBox = el('div', 'coop-chat');
    this.chatLog = el('div', 'coop-log');
    // Parchment "Say:" row: speech-bubble icon, the line, a character counter and the key hint.
    this.chatRow = el('div', 'coop-chat-row hv-hidden', `<span class="ic" aria-hidden="true">${SAY_ICON}</span><span class="lb">Say:</span>`);
    this.chatInput = el('input', 'coop-chat-in');
    this.chatInput.maxLength = 140;
    this.chatInput.placeholder = 'Say something nice…';
    this.chatInput.setAttribute('aria-label', 'Chat message');
    this.chatCount = el('span', 'ct', '0/140');
    const hint = el('div', 'hint', '<kbd>Enter</kbd> to send · <kbd>Esc</kbd> cancel');
    this.chatRow.append(this.chatInput, this.chatCount, hint);
    this.chatBox.append(this.chatLog, this.chatRow);
    this.wheel = el('div', 'coop-wheel hv-hidden');
    this.sleepEl = el('div', 'coop-sleep hv-hidden');
    this.nudge = el('div', 'coop-nudge');
    this.hud.append(this.roster, this.chatBox, this.wheel, this.sleepEl, this.nudge);
    this.buildWheel();

    game.events.on('net:roster', ({ players }) => this.renderRoster(players));
    game.events.on('net:status', () => this.renderRoster(net.players()));
    game.events.on('net:chat', (m) => this.addLine(m));
    game.events.on('net:beds', (b) => this.renderSleep(b));
    // Staged stills for critics: coop-emote (wheel open, a wedge picked) / coop-chat (typing a line),
    // or any coop demo with &coopui=wheel|chat (&emote=<id> picks the wedge).
    game.events.on('demo:stage', ({ name }) => {
      const q = new URLSearchParams(location.search);
      const what = name === 'coop-emote' ? 'wheel' : name === 'coop-chat' ? 'chat' : q.get('coopui');
      if (!what) return;
      setTimeout(() => {
        if (what === 'wheel') {
          this.openWheel();
          const e = q.get('emote') as EmoteId | null;
          this.selectWedge(e && (EMOTES as readonly string[]).includes(e) ? e : 'happy');
        } else if (what === 'chat') {
          this.openChat();
          this.chatInput.value = q.get('say') ?? 'Meet at the shipping bin? Bringing the parsnips';
          this.chatCount.textContent = `${this.chatInput.value.length}/140`;
        }
      }, 400);
    });
    // The day-end card gets a "Farm today" row: what each farmer did (co-op only).
    game.events.on('sleep:summary', () => setTimeout(() => this.injectDayEnd(), 0));
    game.events.on('ui:open', ({ name }) => {
      if (name === 'pause') this.injectPause();
      if (name.startsWith('dayend')) setTimeout(() => this.injectDayEnd(), 0);
      this.hud.classList.toggle('menu', name !== 'none' && name !== 'dialogue');
    });
    this.chatInput.addEventListener('input', () => {
      const n = this.chatInput.value.length;
      this.chatCount.textContent = `${n}/140`;
      this.chatCount.classList.toggle('near', n > 120);
    });
    this.chatInput.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') {
        const t = this.chatInput.value;
        this.chatInput.value = '';
        this.closeChat();
        if (t.trim()) this.net.chat(t);
      } else if (e.key === 'Escape') this.closeChat();
    });
    window.addEventListener('keydown', this.onKey);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('pointermove', this.onPointer, { passive: true });
  }

  private canPlay(): boolean {
    const open = this.game.hud.openPanelName;
    return !open && this.game.player.controllable;
  }

  private onKey = (e: KeyboardEvent): void => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
    if (e.code === 'KeyT' && !e.repeat && this.canPlay() && this.net.players().length > 1) {
      e.preventDefault();
      this.openChat();
    } else if (e.code === 'KeyG' && !e.repeat && this.canPlay()) {
      this.openWheel();
    } else if (this.wheelOpen && /^Digit[1-8]$/.test(e.code)) {
      this.wheelSel = EMOTES[Number(e.code.slice(5)) - 1] ?? null;
      e.stopImmediatePropagation();
      this.closeWheel(true);
    }
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    if (e.code === 'KeyG' && this.wheelOpen) this.closeWheel(true);
  };

  private onPointer = (e: PointerEvent): void => {
    if (!this.wheelOpen) return;
    const z = this.uiZoom();
    const dx = e.clientX - this.wheelAt.x * z;
    const dy = e.clientY - this.wheelAt.y * z;
    if (Math.hypot(dx, dy) < 30 * z) return this.selectWedge(null);
    const a = (Math.atan2(dx, -dy) + Math.PI * 2 + Math.PI / 8) % (Math.PI * 2);
    this.selectWedge(EMOTES[Math.floor(a / (Math.PI / 4))] ?? null);
  };

  /** The wheel's centre (CSS px, before --uiz): the local farmer's chest on screen. */
  private wheelAt = { x: 0, y: 0 };
  private zoomCache = 1;
  private uiZoom(): number {
    return this.zoomCache;
  }

  private placeWheel(): void {
    const p = this.game.player.position;
    const v = new THREE.Vector3(p.x, p.y + 1.1, p.z).project(this.game.rc.camera);
    const z = this.uiZoom();
    // Keep the whole ring on screen.
    const R = 130;
    const x = Math.min(innerWidth / z - R, Math.max(R, ((v.x + 1) / 2) * (innerWidth / z)));
    const y = Math.min(innerHeight / z - R - 90, Math.max(R, ((1 - v.y) / 2) * (innerHeight / z)));
    this.wheelAt = { x, y };
    this.wheel.style.left = `${Math.round(x)}px`;
    this.wheel.style.top = `${Math.round(y)}px`;
  }

  private buildWheel(): void {
    this.wheel.innerHTML = `<div class="ring"></div><div class="mid">Emote</div>`;
    EMOTES.forEach((id, i) => {
      const a = (i / EMOTES.length) * Math.PI * 2;
      const b = el('button', 'wedge', `<img src="${emoteIconUrl(id)}" alt=""/><kbd>${i + 1}</kbd>`);
      b.setAttribute('aria-label', `${EMOTE_LABEL[id]} (${i + 1})`);
      b.style.left = `${Math.sin(a) * 90}px`;
      b.style.top = `${-Math.cos(a) * 90}px`;
      b.style.animationDelay = `${i * 18}ms`;
      b.dataset.emote = id;
      b.addEventListener('pointerenter', () => this.selectWedge(id));
      b.addEventListener('click', () => {
        this.wheelSel = id;
        this.closeWheel(true);
      });
      this.wheel.appendChild(b);
    });
  }

  private selectWedge(id: EmoteId | null): void {
    this.wheelSel = id;
    this.wheel.querySelectorAll<HTMLElement>('.wedge').forEach((w) => w.classList.toggle('on', w.dataset.emote === id));
    const mid = this.wheel.querySelector('.mid')!;
    mid.textContent = id ? EMOTE_LABEL[id] : 'Emote';
  }

  openWheel(): void {
    this.wheelOpen = true;
    this.wheelSel = null;
    this.selectWedge(null);
    this.wheel.classList.remove('hv-hidden');
    this.zoomCache = Number(getComputedStyle(this.wheel).zoom) || 1;
    this.placeWheel();
    replay(this.wheel, 'in');
  }

  private closeWheel(send: boolean): void {
    this.wheelOpen = false;
    this.wheel.classList.add('hv-hidden');
    if (send && this.wheelSel) this.net.emote(this.wheelSel);
  }

  /** Farmhand watching the host's heart event: a parchment chip at the top of the screen. */
  spectating(host: string | null): void {
    if (!host) {
      this.watchChip?.remove();
      this.watchChip = null;
      return;
    }
    if (!this.watchChip) {
      this.watchChip = el('div', 'coop-watch');
      this.hud.appendChild(this.watchChip);
    }
    this.watchChip.innerHTML = `<span class="eye" aria-hidden="true">${PEOPLE_ICON}</span><span>Watching <b></b>’s scene</span>`;
    this.watchChip.querySelector('b')!.textContent = host;
    replay(this.watchChip, 'in');
  }
  private watchChip: HTMLElement | null = null;

  openChat(): void {
    this.chatRow.classList.remove('hv-hidden');
    replay(this.chatRow, 'in');
    this.chatBox.classList.add('typing');
    this.chatCount.textContent = `${this.chatInput.value.length}/140`;
    this.game.input.enabled = false;
    this.net.typing(true);
    setTimeout(() => this.chatInput.focus(), 0);
  }

  private closeChat(): void {
    this.chatInput.blur();
    this.chatRow.classList.add('hv-hidden');
    this.chatBox.classList.remove('typing');
    this.net.typing(false);
    if (!this.game.hud.openPanelName) this.game.input.enabled = true;
  }

  /** Empty the chat log (a demo still re-staged on the same page). */
  clearLog(): void {
    for (const l of this.lines) l.node.remove();
    this.lines = [];
  }

  private addLine(m: { id: number; name: string; text: string; color: string; system?: boolean }): void {
    const n = el('div', `ln${m.system ? ' sys' : ''}`);
    if (m.system) n.innerHTML = m.text;
    else {
      n.innerHTML = `<b style="color:${m.color}"></b><span></span>`;
      n.querySelector('b')!.textContent = m.name;
      n.querySelector('span')!.textContent = m.text;
    }
    this.chatLog.appendChild(n);
    this.lines.push({ node: n, t: 8 });
    while (this.lines.length > 7) this.lines.shift()!.node.remove();
  }

  private renderRoster(players: PlayerView[]): void {
    const st = this.net.status();
    const key = JSON.stringify([players.map((p) => [p.id, p.name, p.ready, Math.round(p.ping / 20), p.away, p.look.scarf, p.look.hair, p.map]), st, this.net.code()]);
    if (key === this.rosterKey) return;
    this.rosterKey = key;
    const show = players.length > 1 || this.net.role() !== 'solo';
    this.roster.classList.toggle('hv-hidden', !show);
    if (!show) return;
    const code = this.net.code();
    const warn = st === 'reconnecting' || st === 'host-away' ? `<span class="warn">${st === 'reconnecting' ? 'reconnecting…' : 'host away…'}</span>` : '';
    const rows = players
      .map(
        (p) =>
          `<div class="pl${p.away ? ' away' : ''}${p.isMe ? ' me' : ''}">${avatar(p.look, 26)}<b>${escapeHtml(p.name)}</b>${p.isHost ? CROWN : ''}${p.ready ? ZZZ : ''}<span class="where">${p.map && p.map !== 'farm' ? escapeHtml(p.map) : ''}</span>${p.isMe && p.isHost ? '' : pingBars(p.ping)}</div>`,
      )
      .join('');
    this.roster.innerHTML = `<div class="hd">${PEOPLE_ICON}<span>Co-op${code ? ` · <b>${escapeHtml(code)}</b>` : ''}</span>${warn}</div>${rows}<div class="ft"><b>T</b> chat · <b>G</b> emote</div>`;
  }

  private renderSleep(b: { ready: number[]; total: number; sleeping: boolean }): void {
    this.sleepEl.classList.toggle('hv-hidden', !b.sleeping);
    this.renderNudge(b);
    if (!b.sleeping) return;
    const players = this.net.players();
    const ready = new Set(b.ready);
    const waiting = players.filter((p) => !ready.has(p.id)).length;
    this.sleepEl.innerHTML = `<div class="stars"></div><div class="card"><div class="moon"></div><h3>Sweet dreams…</h3><p>${waiting ? `Waiting for <b>${waiting}</b> ${waiting === 1 ? 'farmer' : 'farmers'} to turn in` : 'Everyone is in bed — goodnight!'}</p><div class="beds">${players
      .map((p) => `<div class="bed${ready.has(p.id) ? ' in' : ''}">${avatar(p.look, 30)}<small>${escapeHtml(p.name)}</small>${ready.has(p.id) ? ZZZ : '<em>awake</em>'}</div>`)
      .join('')}</div></div>`;
    const row = el('div', 'coop-sleep-btns');
    const c = el('button', 'u-btn small', '<span>Get up</span>');
    c.addEventListener('click', () => this.net.cancelBed());
    row.appendChild(c);
    // Host: after a while, "Sleep anyway" ends the day for everyone (nobody is held hostage by an
    // AFK farmhand — the awake ones wake up in their cabins).
    if (this.net.role() === 'host' && waiting) {
      const f = el('button', 'u-btn small blue coop-force', '<span>Sleep anyway</span>');
      f.title = 'End the day for everyone now';
      f.addEventListener('click', () => this.net.forceSleep());
      row.appendChild(f);
    }
    this.sleepEl.querySelector('.card')!.appendChild(row);
    this.forceShown = false;
  }

  /**
   * Holdout nudge: we're still up while other farmers are already in bed — a soft moonlit card at
   * the top of the screen (names + sleeping avatars) and the roster's sleepers glow. Never blocks
   * play; gone the moment we turn in or they get up.
   */
  private renderNudge(b: { ready: number[]; sleeping: boolean }): void {
    const me = this.net.myId();
    const ready = new Set(b.ready);
    const players = this.net.players();
    const abed = players.length < 2 || b.sleeping || ready.has(me) ? [] : players.filter((p) => !p.isMe && ready.has(p.id));
    const key = abed.map((p) => p.id).join(',');
    if (key === this.nudgeKey) return;
    this.nudgeKey = key;
    this.roster.classList.toggle('bedtime', abed.length > 0);
    if (!abed.length) {
      this.nudge.classList.remove('on');
      return;
    }
    const names = abed.map((p) => escapeHtml(p.name));
    const who = names.length === 1 ? `<b>${names[0]}</b> is` : `<b>${names.slice(0, -1).join('</b>, <b>')}</b> and <b>${names[names.length - 1]}</b> are`;
    const n = abed.length;
    this.nudge.innerHTML = `<div class="moon"></div><div class="heads">${abed.map((p) => `<span>${avatar(p.look, 30)}${ZZZ}</span>`).join('')}</div><div class="tx"><p>${who} in bed</p> <small>${n === 1 ? 'A farmer is' : `${n} farmers are`} waiting for you to turn in — the day ends when everyone sleeps</small></div>`;
    this.nudge.classList.remove('on');
    void this.nudge.offsetWidth;
    this.nudge.classList.add('on');
  }

  /** "Farm today" on the day-end card: each farmer's harvest / watering / tilling / sowing. */
  private injectDayEnd(): void {
    const rows = this.net.dayTally();
    const card = this.game.hud.screens.querySelector<HTMLElement>('.hv-dayend .de-card');
    const foot = card?.querySelector('.de-foot');
    if (!rows || rows.length < 2 || !card || !foot || card.querySelector('.coop-today')) return;
    const hoe = `<img src="${itemIconUrl('hoe')}" alt=""/>`;
    const kinds: [string, string][] = [
      [ICONS.basket ?? '', 'harvested'],
      [ICONS.drop ?? '', 'watered'],
      [hoe, 'tilled'],
      [ICONS.sprout ?? '', 'sown'],
    ];
    // The busiest farmer of the day gets a little ribbon.
    const total = (n: number[]): number => n.reduce((a, b) => a + b, 0);
    const best = rows.reduce((a, b) => (total(b.n) > total(a.n) ? b : a));
    const box = el('div', 'coop-today');
    // Header + a one-line legend for the four tallies, and the ribbon says what it's for.
    const legend = kinds.map(([ic, w]) => `<i>${ic}${w[0]!.toUpperCase()}${w.slice(1)}</i>`).join('<b>·</b>');
    box.innerHTML = `<div class="ct-hd"><div class="de-h">Farm today</div><div class="ct-key">${legend}</div></div><div class="ct-row">${rows
      .map(
        (r) =>
          `<div class="ct-f${r.isMe ? ' me' : ''}${r === best && total(r.n) > 0 ? ' best' : ''}" style="--c:${hex(r.look.scarf)}"${r === best && total(r.n) > 0 ? ' title="Busiest farmer today (most jobs done)"' : ''}>${r === best && total(r.n) > 0 ? '<em class="ct-best">★ Busiest</em>' : ''}${avatar(r.look, 34)}<div class="ct-tx"><b>${escapeHtml(r.name)}${r.isMe ? ' <em>you</em>' : ''}</b><span>${r.n
            .map((v, i) => `<i class="${v > 0 ? '' : 'z'}" title="${kinds[i]![1]}">${kinds[i]![0]}${v}</i>`)
            .join('')}</span></div></div>`,
      )
      .join('')}</div>`;
    card.insertBefore(box, foot);
  }

  private injectPause(): void {
    const wrap = this.game.hud.screens.querySelector('.hv-pause .pause-wrap');
    if (!wrap || wrap.querySelector('.coop-pause')) return;
    const { frame: f, body } = frame('Co-op', 'coop-pause');
    const players = this.net.players();
    const role = this.net.role();
    if (role === 'solo') {
      body.innerHTML = `<p>Invite up to three friends to farm with you.</p>`;
    } else {
      body.innerHTML = `<div class="code">Code <b>${escapeHtml(this.net.code() ?? '')}</b></div>${players
        .map((p) => `<div class="pl" data-id="${p.id}">${avatar(p.look, 28)}<b>${escapeHtml(p.name)}</b>${p.isHost ? CROWN : ''}${p.ready ? ZZZ : ''}${p.away ? '<em>away</em>' : ''}${p.isMe && p.isHost ? '' : pingBars(p.ping)}</div>`)
        .join('')}`;
      if (role === 'host') {
        for (const row of body.querySelectorAll<HTMLElement>('.pl')) {
          const id = Number(row.dataset.id);
          if (id === this.net.myId()) continue;
          const k = el('button', 'coop-kick', '<span>Kick</span>');
          k.dataset.nav = '';
          k.addEventListener('click', () => {
            if (!k.classList.contains('sure')) {
              k.classList.add('sure');
              k.querySelector('span')!.textContent = 'Sure?';
              return;
            }
            this.net.kick(id);
            row.remove();
          });
          row.appendChild(k);
        }
      }
    }
    const b = el('button', 'u-btn small green', `<span>${role === 'solo' ? 'Open farm to co-op' : 'Farmers & invite'}</span>`);
    b.dataset.nav = '';
    b.addEventListener('click', () => this.game.events.emit('ui:open', { name: 'coop' }));
    body.appendChild(b);
    wrap.appendChild(f);
  }

  update(dt: number): void {
    // The roster plate + chat step out under any open panel, incl. the day-end card (the hud opens
    // that one straight from `sleep:summary`, with no `ui:open` event).
    const open = this.game.hud.openPanelName;
    const menu = !!open && open !== 'dialogue';
    if (menu !== this.hud.classList.contains('menu')) this.hud.classList.toggle('menu', menu);
    for (const l of this.lines) {
      l.t -= dt;
      l.node.classList.toggle('old', l.t < 0 && !this.chatBox.classList.contains('typing'));
    }
    if (this.wheelOpen && !this.canPlay() && this.game.hud.openPanelName) this.closeWheel(false);
    if (this.wheelOpen) this.placeWheel();
    // Reveal "Sleep anyway" once the host has waited 10 s.
    const since = this.net.bedSince();
    if (!this.forceShown && since && performance.now() - since > 10_000) {
      const f = this.sleepEl.querySelector('.coop-force');
      if (f) {
        f.classList.add('on');
        this.forceShown = true;
      }
    }
  }
}
