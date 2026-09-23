/**
 * New Journal ('newgame'; Title → New Game): the character creator, in the world.
 *
 * The camera glides down from the title's establishing shot to a low portrait of your farmer on the
 * doorstep at golden hour, and slowly orbits them (drag anywhere on the left to turn). Every change is
 * applied to the real in-world farmer (via the co-op profile, so the same look is what friends see), and
 * the companion you pick trots up to the kennel. The parchment ledger on the right holds:
 *   name + farm name · appearance (skin, hair colour + style, shirt, overalls, kerchief, hat style + colour)
 *   · companion (shiba / collie / orange tabby / grey tabby + its name) · journal slot (1–3, with what's
 *   in it) · Back / Begin my story.
 * Begin persists the journal (ui/profile.ts), the look (net profile) and the pet, then plays the intro.
 * `ui=newgame` stages it; `ui=newgame:demo` fills in a sample farmer for screenshots.
 */
import './newgame.css';
import type { Game } from '../core/game';
import { Screen, el, sfx, replay, escapeHtml } from './kit';
import { ICONS } from './icons';
import { HAIR_STYLES, HAT_STYLES, PALETTE, PRESET_LOOKS, DEFAULT_LOOK, randomLook, type FarmerLook, type HairStyle, type HatStyle } from '../entities/remote-look';
import { journal, setJournal, JOURNAL_SLOTS, type PetChoice } from './profile';
import { beginNewGame } from './title';

const SEASON_NAME: Record<string, string> = { spring: 'Spring', summer: 'Summer', fall: 'Fall', winter: 'Winter' };
const hex = (c: number): string => `#${c.toString(16).padStart(6, '0')}`;

const HAIR_LABEL: Record<HairStyle, string> = { tousled: 'Tousled', bob: 'Bob', bun: 'Bun', spiky: 'Spiky', long: 'Long', buzz: 'Buzz' };
const HAT_LABEL: Record<HatStyle, string> = { straw: 'Straw', cap: 'Cap', beanie: 'Beanie', flower: 'Flower', none: 'None' };

const PETS: { species: 'dog' | 'cat'; variant: number; label: string; name: string }[] = [
  { species: 'dog', variant: 0, label: 'Shiba', name: 'Rufus' },
  { species: 'dog', variant: 1, label: 'Collie', name: 'Biscuit' },
  { species: 'cat', variant: 0, label: 'Ginger tabby', name: 'Tuppence' },
  { species: 'cat', variant: 1, label: 'Grey tabby', name: 'Pewter' },
];

const FARM_IDEAS = ['Honeybrook', 'Thistledown', 'Willowmere', 'Bramblegate', 'Cloverhill', 'Foxglove Hollow', 'Mossy Acre', 'Lanternfield'];

/** Painted pet portraits (card art): shiba, collie, ginger tabby, grey tabby. */
function petArt(species: 'dog' | 'cat', variant: number): string {
  const ink = '#3b2313';
  const bg = `<circle cx="40" cy="40" r="38" fill="${variant ? '#d8e8f4' : '#fbe6c4'}"/><path d="M2 58 C20 50 60 52 78 58 V80 H2Z" fill="#8cc466" opacity=".7"/>`;
  if (species === 'dog') {
    const fur = variant ? '#3a2a22' : '#e0913e';
    const cream = variant ? '#f4efe6' : '#fbe2bf';
    const ears = variant
      ? `<path d="M20 30 C16 18 22 12 30 16 L32 30Z M60 30 C64 18 58 12 50 16 L48 30Z" fill="${fur}" stroke="${ink}" stroke-width="2.2" stroke-linejoin="round"/><path d="M22 20 C20 16 24 15 27 17 Z M58 20 C60 16 56 15 53 17Z" fill="${cream}"/>`
      : `<path d="M19 32 L22 12 L36 24Z M61 32 L58 12 L44 24Z" fill="${fur}" stroke="${ink}" stroke-width="2.2" stroke-linejoin="round"/><path d="M23 26 L24 17 L31 23Z M57 26 L56 17 L49 23Z" fill="#f4b07a"/>`;
    return `<svg viewBox="0 0 80 80">${bg}${ears}
      <path d="M22 64 C20 56 22 50 28 48 H52 C58 50 60 56 58 64 Z" fill="${fur}" stroke="${ink}" stroke-width="2.2"/>
      <path d="M32 64 C32 56 36 52 40 52 C44 52 48 56 48 64Z" fill="${cream}" stroke="${ink}" stroke-width="1.8"/>
      <ellipse cx="40" cy="36" rx="20" ry="17" fill="${fur}" stroke="${ink}" stroke-width="2.4"/>
      <path d="M28 40 C30 50 50 50 52 40 C48 36 44 38 40 38 C36 38 32 36 28 40Z" fill="${cream}"/>
      ${variant ? `<path d="M40 20 C37 26 37 32 40 38 C43 32 43 26 40 20Z" fill="${cream}"/>` : ''}
      <ellipse cx="32" cy="34" rx="2.6" ry="3.2" fill="#1e1410"/><ellipse cx="48" cy="34" rx="2.6" ry="3.2" fill="#1e1410"/>
      <circle cx="33" cy="33" r="1" fill="#fff"/><circle cx="49" cy="33" r="1" fill="#fff"/>
      <ellipse cx="40" cy="41" rx="3.4" ry="2.4" fill="#1e1410"/>
      <path d="M36 45 C38 47 42 47 44 45" fill="none" stroke="${ink}" stroke-width="1.6" stroke-linecap="round"/>
      <path d="M38.5 46 C38.5 50 41.5 50 41.5 46Z" fill="#e8707a"/>
      <path d="M28 52 H52" stroke="${variant ? '#c8433a' : '#3d7fbf'}" stroke-width="3.4" stroke-linecap="round"/><circle cx="40" cy="55" r="2.6" fill="#f0c040" stroke="${ink}" stroke-width="1.2"/></svg>`;
  }
  const fur = variant ? '#8a929c' : '#e8964a';
  const stripe = variant ? '#5a616a' : '#b8622a';
  const belly = variant ? '#e8ecef' : '#fbe2bf';
  return `<svg viewBox="0 0 80 80">${bg}
    <path d="M58 62 C70 60 72 46 64 44" fill="none" stroke="${fur}" stroke-width="6" stroke-linecap="round"/><path d="M58 62 C70 60 72 46 64 44" fill="none" stroke="${ink}" stroke-width="1.6" stroke-linecap="round" opacity=".5"/>
    <path d="M24 64 C22 56 26 50 32 49 H48 C54 50 58 56 56 64 Z" fill="${fur}" stroke="${ink}" stroke-width="2.2"/>
    <path d="M34 64 C34 57 37 54 40 54 C43 54 46 57 46 64Z" fill="${belly}"/>
    <path d="M21 30 L20 12 L34 22Z M59 30 L60 12 L46 22Z" fill="${fur}" stroke="${ink}" stroke-width="2.2" stroke-linejoin="round"/>
    <path d="M24 24 L23.5 16 L30 21Z M56 24 L56.5 16 L50 21Z" fill="#f4a8a8"/>
    <ellipse cx="40" cy="36" rx="20" ry="16" fill="${fur}" stroke="${ink}" stroke-width="2.4"/>
    <path d="M34 21 L36 28 M40 20 V28 M46 21 L44 28" stroke="${stripe}" stroke-width="2.4" stroke-linecap="round"/>
    <path d="M21 36 L27 37 M21 41 L27 40 M59 36 L53 37 M59 41 L53 40" stroke="${stripe}" stroke-width="2" stroke-linecap="round"/>
    <ellipse cx="40" cy="42" rx="8" ry="5.5" fill="${belly}"/>
    <ellipse cx="32" cy="35" rx="3" ry="3.6" fill="#6a9a3a"/><ellipse cx="48" cy="35" rx="3" ry="3.6" fill="#6a9a3a"/>
    <ellipse cx="32" cy="35" rx="1.1" ry="3" fill="#1e1410"/><ellipse cx="48" cy="35" rx="1.1" ry="3" fill="#1e1410"/>
    <circle cx="33" cy="33.5" r=".9" fill="#fff"/><circle cx="49" cy="33.5" r=".9" fill="#fff"/>
    <path d="M38.2 40 H41.8 L40 42Z" fill="#e87a8a"/>
    <path d="M36 44 C38 45.5 40 44 40 42.5 C40 44 42 45.5 44 44" fill="none" stroke="${ink}" stroke-width="1.4" stroke-linecap="round"/>
    <path d="M30 43 L20 42 M30 45 L21 47 M50 43 L60 42 M50 45 L59 47" stroke="${ink}" stroke-width=".9" opacity=".6"/>
    <path d="M30 52 H50" stroke="${variant ? '#8a5ac8' : '#d84a5a'}" stroke-width="3.2" stroke-linecap="round"/><circle cx="40" cy="55" r="2.4" fill="#f0c040" stroke="${ink}" stroke-width="1.2"/></svg>`;
}

interface SlotInfo {
  id: string;
  empty: boolean;
  title: string;
  sub: string;
}

function readSlot(id: string): SlotInfo {
  try {
    const raw = localStorage.getItem(`hearthvale.save.${id}`);
    if (!raw) return { id, empty: true, title: 'Empty journal', sub: 'a fresh page' };
    const f = JSON.parse(raw) as { savedAt?: string; data?: { core?: { calendar?: { season?: string; day?: number; year?: number } }; economy?: { gold?: number }; journal?: { name?: string; farm?: string } } };
    const cal = f.data?.core?.calendar;
    const who = f.data?.journal?.name ?? 'A farmer';
    return { id, empty: false, title: `${who}`, sub: `${SEASON_NAME[cal?.season ?? 'spring']} ${cal?.day ?? 1} · Y${cal?.year ?? 1} · ${(f.data?.economy?.gold ?? 0).toLocaleString()}g` };
  } catch {
    return { id, empty: true, title: 'Empty journal', sub: 'a fresh page' };
  }
}

export class NewGameScreen extends Screen {
  private look: FarmerLook = { ...DEFAULT_LOOK };
  private name = '';
  private farm = '';
  private pet: PetChoice = { species: 'dog', variant: 0, name: 'Rufus' };
  private slot = 'slot1';
  private demo = false;
  private aoWas: boolean | null = null;
  private raf = 0;
  private t0 = 0;
  private orbit = 0;
  private dragX: number | null = null;
  private yawUser = 0;
  private from = { yaw: 0, pitch: 36, distance: 30, ox: 0, oy: 0, oz: 0 };
  private plate!: HTMLElement;
  private optsBox!: HTMLElement;
  private petBox!: HTMLElement;
  private slotBox!: HTMLElement;

  constructor(game: Game, parent: HTMLElement) {
    super(game, parent, 'hv-newgame', {});
  }

  protected render(arg?: string): void {
    this.demo = arg === 'demo';
    this.root.innerHTML = '';
    const net = this.game.services.net;
    const prof = net?.profile();
    this.look = this.demo ? { ...PRESET_LOOKS[0]! } : { ...(prof?.look ?? DEFAULT_LOOK) };
    this.name = this.demo ? 'Marigold' : prof?.name && prof.name !== 'Farmer' ? prof.name : '';
    this.farm = this.demo ? 'Honeybrook Farm' : '';
    this.pet = this.demo ? { species: 'cat', variant: 0, name: 'Tuppence' } : { ...journal.pet };
    const slots = JOURNAL_SLOTS.map(readSlot);
    this.slot = (slots.find((s) => s.empty) ?? slots[0]!).id;

    // Left: stage affordances around the in-world farmer.
    const stage = el('div', 'ng-stage interactive');
    stage.innerHTML = `<div class="ng-hint">${ICONS.play}<span>drag to turn</span></div>`;
    stage.addEventListener('pointerdown', (e) => {
      this.dragX = e.clientX;
      stage.setPointerCapture(e.pointerId);
      stage.classList.add('grab');
    });
    stage.addEventListener('pointermove', (e) => {
      if (this.dragX === null) return;
      this.yawUser -= (e.clientX - this.dragX) * 0.35;
      this.dragX = e.clientX;
    });
    const up = (): void => {
      this.dragX = null;
      stage.classList.remove('grab');
    };
    stage.addEventListener('pointerup', up);
    stage.addEventListener('pointercancel', up);
    this.plate = el('div', 'ng-plate');
    const dice = el('button', 'u-btn small ng-dice', `<svg viewBox="0 0 24 24" width="20" height="20"><rect x="3" y="3" width="18" height="18" rx="4" fill="#fff6e0" stroke="#5e3517" stroke-width="1.8"/><circle cx="8" cy="8" r="1.7" fill="#5e3517"/><circle cx="16" cy="16" r="1.7" fill="#5e3517"/><circle cx="12" cy="12" r="1.7" fill="#5e3517"/><circle cx="16" cy="8" r="1.7" fill="#5e3517"/><circle cx="8" cy="16" r="1.7" fill="#5e3517"/></svg><span>Surprise me</span>`);
    dice.dataset.nav = '';
    dice.addEventListener('click', () => {
      this.look = randomLook();
      sfx(this.game, 'toggle');
      replay(dice, 'bump');
      this.commitLook();
    });
    stage.append(this.plate, dice);

    // Right: the ledger.
    const f = el('div', 'u-frame interactive ng-frame');
    f.innerHTML = `<i class="u-rivet tl"></i><i class="u-rivet tr"></i><i class="u-rivet bl"></i><i class="u-rivet br"></i><div class="u-ribbon"><span>A New Journal</span></div><div class="u-paper"></div>`;
    const body = f.querySelector('.u-paper') as HTMLElement;

    const who = el('div', 'ng-who');
    who.append(this.field('Your name', this.name, 'e.g. Juniper', 18, (v) => (this.name = v), 'name'), this.field('Farm name', this.farm, `e.g. ${FARM_IDEAS[Math.floor(Math.random() * FARM_IDEAS.length)]} Farm`, 22, (v) => (this.farm = v), 'farm'));

    const look = el('section', 'ng-sec ng-look', `<h3><span>Appearance</span></h3>`);
    this.optsBox = el('div', 'ng-opts');
    look.appendChild(this.optsBox);

    const side = el('div', 'ng-side');
    const petSec = el('section', 'ng-sec', `<h3>${ICONS.paw}<span>Companion</span></h3>`);
    this.petBox = el('div', 'ng-pets');
    petSec.appendChild(this.petBox);
    petSec.appendChild(this.field('Their name', this.pet.name, 'Rufus', 14, (v) => (this.pet.name = v || this.pet.name), 'pet'));
    const slotSec = el('section', 'ng-sec', `<h3>${ICONS.save}<span>Journal slot</span></h3>`);
    this.slotBox = el('div', 'ng-slots');
    slotSec.appendChild(this.slotBox);
    side.append(petSec, slotSec);

    const mid = el('div', 'ng-mid');
    mid.append(look, side);

    const go = el('div', 'ng-go');
    const back = el('button', 'u-btn', `<span>Back</span>`);
    back.dataset.nav = '';
    back.addEventListener('click', () => {
      sfx(this.game, 'close');
      this.game.events.emit('ui:open', { name: 'title' });
    });
    const begin = el('button', 'u-btn green ng-begin is-default', `${ICONS.sprout}<span>Begin my story</span>`);
    begin.dataset.nav = '';
    begin.addEventListener('click', () => this.begin(begin));
    go.append(back, el('div', 'ng-sum'), begin);

    body.append(who, mid, go);
    this.root.append(stage, f);
    this.renderOpts();
    this.renderPets();
    this.renderSlots(slots);
    this.renderPlate();
    if (this.demo) this.applyLook();
  }

  private field(label: string, value: string, ph: string, max: number, set: (v: string) => void, key: string): HTMLElement {
    const row = el('label', `ng-field f-${key}`, `<span>${label}</span>`);
    const input = el('input', 'ng-input');
    input.type = 'text';
    input.value = value;
    input.placeholder = ph;
    input.maxLength = max;
    input.spellcheck = false;
    input.autocomplete = 'off';
    input.dataset.nav = '';
    input.dataset.noclick = '1';
    input.addEventListener('u-activate', () => input.focus());
    input.addEventListener('input', () => {
      set(input.value.trim());
      this.renderPlate();
    });
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter' || e.key === 'Escape') input.blur();
    });
    row.appendChild(input);
    return row;
  }

  private renderPlate(): void {
    const n = this.name || 'Your name';
    const f = this.farm || 'your farm';
    this.plate.innerHTML = `<b class="${this.name ? '' : 'ph'}">${escapeHtml(n)}</b><small>of <em class="${this.farm ? '' : 'ph'}">${escapeHtml(f)}</em></small>`;
    const sum = this.root.querySelector('.ng-sum');
    if (sum) sum.innerHTML = `${escapeHtml(JOURNAL_SLOTS.indexOf(this.slot as (typeof JOURNAL_SLOTS)[number]) + 1 ? `Journal ${JOURNAL_SLOTS.indexOf(this.slot as (typeof JOURNAL_SLOTS)[number]) + 1}` : '')} · ${this.pet.species === 'dog' ? 'with a dog' : 'with a cat'}`;
  }

  private swatchRow(label: string, key: keyof FarmerLook, colors: readonly number[]): HTMLElement {
    const row = el('div', 'ng-row', `<span class="lbl">${label}</span>`);
    const sw = el('div', 'ng-sw');
    for (const c of colors) {
      const b = el('button', `ng-dot${this.look[key] === c ? ' on' : ''}`);
      b.style.setProperty('--c', hex(c));
      b.dataset.nav = '';
      b.setAttribute('aria-label', `${label} ${hex(c)}`);
      b.addEventListener('click', () => {
        (this.look as unknown as Record<string, number>)[key] = c;
        sfx(this.game, 'click');
        this.commitLook();
      });
      sw.appendChild(b);
    }
    row.appendChild(sw);
    return row;
  }

  private chipRow<T extends string>(label: string, values: readonly T[], names: Record<T, string>, cur: T, set: (v: T) => void): HTMLElement {
    const row = el('div', 'ng-row chips', `<span class="lbl">${label}</span>`);
    const chips = el('div', 'ng-chips');
    for (const v of values) {
      const b = el('button', `ng-chip${v === cur ? ' on' : ''}`, names[v]);
      b.dataset.nav = '';
      b.addEventListener('click', () => {
        set(v);
        sfx(this.game, 'click');
        this.commitLook();
      });
      chips.appendChild(b);
    }
    row.appendChild(chips);
    return row;
  }

  private renderOpts(): void {
    const focusIdx = this.focusIndex(this.optsBox);
    this.optsBox.innerHTML = '';
    this.optsBox.append(
      this.swatchRow('Skin', 'skin', PALETTE.skin),
      this.swatchRow('Hair', 'hair', PALETTE.hair),
      this.chipRow('Style', HAIR_STYLES, HAIR_LABEL, this.look.hairStyle, (v) => (this.look.hairStyle = v)),
      this.swatchRow('Shirt', 'shirt', PALETTE.shirt),
      this.swatchRow('Overalls', 'overalls', PALETTE.overalls),
      this.swatchRow('Kerchief', 'scarf', PALETTE.scarf),
      this.chipRow('Hat', HAT_STYLES, HAT_LABEL, this.look.hat, (v) => (this.look.hat = v)),
      this.swatchRow('Hat colour', 'hatColor', PALETTE.hatColor),
    );
    this.restoreFocus(this.optsBox, focusIdx);
  }

  private renderPets(): void {
    const focusIdx = this.focusIndex(this.petBox);
    this.petBox.innerHTML = '';
    for (const p of PETS) {
      const on = p.species === this.pet.species && p.variant === this.pet.variant;
      const b = el('button', `ng-pet${on ? ' on' : ''}`, `<span class="art">${petArt(p.species, p.variant)}</span><b>${p.label}</b>`);
      b.dataset.nav = '';
      b.addEventListener('click', () => {
        const renamed = !PETS.some((x) => x.name === this.pet.name);
        this.pet = { species: p.species, variant: p.variant, name: renamed ? this.pet.name : p.name };
        const input = this.root.querySelector<HTMLInputElement>('.f-pet input');
        if (input && !renamed) input.value = p.name;
        sfx(this.game, 'toggle');
        this.renderPets();
        replay(this.petBox.querySelector('.ng-pet.on'), 'bump');
        this.renderPlate();
        this.applyPet();
      });
      this.petBox.appendChild(b);
    }
    this.restoreFocus(this.petBox, focusIdx);
  }

  private renderSlots(slots = JOURNAL_SLOTS.map(readSlot)): void {
    const focusIdx = this.focusIndex(this.slotBox);
    this.slotBox.innerHTML = '';
    slots.forEach((s, i) => {
      const on = s.id === this.slot;
      const b = el('button', `ng-slot${on ? ' on' : ''}${s.empty ? ' empty' : ' used'}`, `<span class="no">${i + 1}</span><span class="tx"><b>${escapeHtml(s.title)}</b><small>${escapeHtml(s.sub)}</small></span>${!s.empty && on ? '<em>will be replaced</em>' : ''}`);
      b.dataset.nav = '';
      b.addEventListener('click', () => {
        this.slot = s.id;
        sfx(this.game, 'click');
        this.renderSlots(slots);
        this.renderPlate();
      });
      this.slotBox.appendChild(b);
    });
    this.restoreFocus(this.slotBox, focusIdx);
  }

  private focusIndex(box: HTMLElement): number {
    const cur = this.nav.current;
    if (!cur || !box.contains(cur)) return -1;
    return [...box.querySelectorAll('[data-nav]')].indexOf(cur);
  }

  private restoreFocus(box: HTMLElement, i: number): void {
    if (i < 0) return;
    const e = box.querySelectorAll<HTMLElement>('[data-nav]')[i];
    if (e) this.nav.set(e, document.body.classList.contains('u-kbd'));
  }

  private commitLook(): void {
    this.renderOpts();
    this.applyLook();
  }

  /** Dress the real farmer (and remember it as the co-op profile look). */
  private applyLook(): void {
    const net = this.game.services.net;
    if (!net) return;
    net.setProfile({ name: this.name || net.profile().name, look: { ...this.look } });
  }

  /** The family pet at the kennel becomes the chosen companion. */
  private applyPet(): void {
    const a = this.game.services.animals;
    if (!a) return;
    try {
      const snap = a.snapshot();
      const st = snap.state as { pet?: Record<string, unknown> };
      if (!st.pet) return;
      st.pet = { ...st.pet, species: this.pet.species, variant: this.pet.variant, name: this.pet.name };
      const was = a.authority;
      a.setAuthority(false);
      a.applySnapshot({ rev: snap.rev + 1, state: st });
      a.setAuthority(was);
    } catch (e) {
      console.warn('[newgame] pet swap failed', e);
    }
  }

  private begin(btn: HTMLElement): void {
    const nameIn = this.root.querySelector<HTMLInputElement>('.f-name input');
    if (!this.name) {
      replay(nameIn?.parentElement, 'shake');
      nameIn?.focus();
      sfx(this.game, 'error');
      return;
    }
    if (this.demo) {
      replay(btn, 'bump');
      return;
    }
    sfx(this.game, 'coin');
    const farm = this.farm || `${this.name}'s Farm`;
    setJournal(this.game, { name: this.name, farm: /farm|acre|hollow|field|meadow|ranch|homestead/i.test(farm) ? farm : `${farm} Farm`, pet: { ...this.pet }, slot: this.slot });
    this.applyLook();
    this.applyPet();
    beginNewGame(this.game);
  }

  // ── Camera: glide from the title shot to a low orbiting portrait of the farmer ──

  override open(arg?: string): void {
    const g = this.game;
    g.hud.root.classList.add('hv-title-mode');
    g.player.controllable = false;
    g.setPaused(true);
    g.calendar.setHour(18.4);
    const map = g.world.current;
    if (map && map.id === 'farm') g.player.teleport(map.spawn.x, map.spawn.z);
    g.player.setFacing('down');
    g.followPlayer(true);
    const rig = g.rc.rig;
    this.from = { yaw: rig.yaw, pitch: rig.pitch, distance: rig.distance, ox: rig.lookOffset.x, oy: rig.lookOffset.y, oz: rig.lookOffset.z };
    this.t0 = performance.now();
    this.orbit = 0;
    this.yawUser = 0;
    // The AO G-buffer misses the farmer at portrait range (background occlusion bleeds through the body):
    // skip AO while the camera is this close; restored on close.
    const gtao = (g.rc.post as unknown as { gtao?: { enabled: boolean } | null }).gtao;
    if (gtao && this.aoWas === null) {
      this.aoWas = gtao.enabled;
      gtao.enabled = false;
    }
    super.open(arg);
    cancelAnimationFrame(this.raf);
    const loop = (now: number): void => {
      if (!this.isOpen) return;
      this.raf = requestAnimationFrame(loop);
      this.frameCam(now);
    };
    this.raf = requestAnimationFrame(loop);
    this.frameCam(this.demo ? this.t0 + 5000 : this.t0);
  }

  private frameCam(now: number): void {
    const rig = this.game.rc.rig;
    const k = Math.min(1, (now - this.t0) / 1300);
    const e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
    if (this.dragX === null) this.orbit += 0.004;
    const yaw = -12 + Math.sin(this.orbit) * 22 + this.yawUser;
    const pitch = 15;
    const dist = 6.6;
    // Push the look target to screen-right of the farmer so they stand in the left third.
    const y = (yaw * Math.PI) / 180;
    const side = 1.85;
    const ox = Math.cos(y) * side;
    const oz = -Math.sin(y) * side;
    const L = (a: number, b: number): number => a + (b - a) * e;
    rig.yaw = L(this.from.yaw, yaw);
    rig.pitch = L(this.from.pitch, pitch);
    rig.distance = L(this.from.distance, dist);
    rig.lookOffset.set(L(this.from.ox, ox), L(this.from.oy, 0.95), L(this.from.oz, oz));
  }

  override back(): boolean {
    const t = document.activeElement;
    if (t instanceof HTMLInputElement) {
      t.blur();
      return true;
    }
    this.game.events.emit('ui:open', { name: 'title' });
    return true;
  }

  protected override onClose(): void {
    cancelAnimationFrame(this.raf);
    const gtao = (this.game.rc.post as unknown as { gtao?: { enabled: boolean } | null }).gtao;
    if (gtao && this.aoWas !== null) gtao.enabled = this.aoWas;
    this.aoWas = null;
    this.game.rc.rig.lookOffset.y = 0;
    this.game.hud.root.classList.remove('hv-title-mode');
    this.game.player.controllable = true;
  }
}
