/**
 * AnimalSystem: the farm's livestock and the family pet.
 *
 *   roster      every animal has a name, coat variant, home (coop / barn), friendship (0–1000) and mood
 *               (0–255). Bought at the carpenter's board (service `animals.buy`), saved with the game.
 *   actors      AnimalActors are spawned for the current map only: inside the coop / barn (wandering the
 *               pen, eating at the trough, sleeping in the straw after dusk) and outside in the fenced
 *               pasture on fine days (8:30–17:30, not in winter / rain) — they trot out of the door in
 *               the morning and file back in at dusk. The pet lives in the farmyard by its kennel + bowl
 *               and curls up by the hearth in the farmhouse at night.
 *   petting     interact with an animal: happy hop + heart pop + voice, +15 friendship once a day.
 *               Milk / wool are collected the same way when ready (quality from friendship + mood).
 *   feeding     interact with the trough holding hay: fills every empty slot (1 hay each); hungry
 *               animals walk over and eat. Grazing on a fine day also counts as fed.
 *   produce     each morning fed animals produce: eggs appear in the coop's nesting boxes (interact to
 *               collect), cows / goats / sheep are ready to milk / shear, pigs dig truffles in the pasture.
 *   events      out: animal:petted, animal:produce, animal:bought.
 *   co-op       host-authoritative (DESIGN §13). The host (and solo play) simulates the herd; a client
 *               calls `setAuthority(false)` and mirrors it. Every farmer action is an `AnimalIntent`:
 *               on the host it applies at once, on a client it plays its cosmetics (hop, heart, voice),
 *               applies optimistically and is emitted as `animals:intent` for the net layer to forward;
 *               the host runs `applyIntent(peer, intent)` and answers collected items with
 *               `animals:grant` → client `receiveGrant(items)`. Shared state: host emits
 *               `animals:changed` (throttled) → broadcast `snapshot()` → client `applySnapshot()`.
 *               Herd poses for whoever shares the host's map: host `poses()` a few times a second →
 *               client `applyPoses()` (animals walk to the host's positions, local brain otherwise).
 *   demos       showcase 'animals' stocks a full coop + barn and stages petting hearts (&hearts=0 off,
 *               &pet=dog|cat picks the pet).
 */
import * as THREE from 'three';
import type { System } from '../core/system';
import type { Game } from '../core/game';
import { AnimalActor, AnimalPops, type Species } from '../entities/animals';
import type { PlayerRig, ActionPose } from '../entities/player';
import { flyItemToToolbar } from '../ui/item-fly';
import { animalVoice } from '../entities/animals-voice';
import { LIVESTOCK, ANIMAL_NAMES, PET_NAMES, produceFor, type Livestock, type AnimalHome } from '../entities/animals-data';
import { isInterior } from '../world/interiors/lighting';
import type { PenAnchors } from '../world/interiors/pen';
import { imat } from '../world/interiors/kit';
import { lumpySphere, prep } from '../world/geom';
import { SITES, PASTURE_PROPS } from '../world/buildings/farm';
import { Rng } from '../core/rng';

export interface AnimalRec {
  id: number;
  species: Livestock;
  variant: number;
  name: string;
  home: AnimalHome;
  friendship: number;
  mood: number;
  fed: boolean;
  petted: boolean;
  /** Days since last produce. */
  days: number;
  /** Milk / wool waiting to be collected (milk pail / shears). */
  ready: boolean;
  /** Game minutes spent out on the pasture today (≥ 60 = grazed = fed). */
  grazed?: number;
}

interface PetRec {
  species: 'dog' | 'cat';
  variant: number;
  name: string;
  friendship: number;
  bowl: boolean;
  petted: boolean;
}

interface State {
  animals: AnimalRec[];
  hay: Record<AnimalHome, boolean[]>;
  /** Eggs waiting in the nest boxes (`id` / `sp`: the layer — older saves have none). */
  eggs: { nest: number; item: string; q: number; id?: number; sp?: Livestock }[];
  truffles: { x: number; z: number; q: number }[];
  pet: PetRec;
  nextId: number;
  /** Pop doors: open = the flock goes out to the pasture on fine days. */
  doors: Record<AnimalHome, boolean>;
}

/** A farmer's action on the herd (co-op wire format: plain JSON). `id` 0 = the family pet. */
export type AnimalIntent =
  /** `tool`: the farmer holds a milk pail / shears, so a ready animal hands over its milk / wool. */
  | { kind: 'pet'; id: number; tool?: boolean }
  /** Open / shut a building's pop door (the flock only grazes with it open). */
  | { kind: 'door'; home: AnimalHome }
  | { kind: 'feed'; home: AnimalHome; hay: number }
  | { kind: 'eggs'; nest?: number }
  | { kind: 'truffle'; x: number; z: number }
  | { kind: 'bowl' }
  | { kind: 'buy'; species: Livestock; name?: string };

export interface AnimalGrant {
  itemId: string;
  qty: number;
  quality: number;
}

export interface AnimalSnapshot {
  rev: number;
  state: unknown;
}

/** Herd poses on one map: flat [id, x, z, heading, stateCode] × n (id 0 = the pet). */
export interface AnimalPoses {
  map: string;
  list: number[];
}

export interface AnimalsApi {
  roster(): readonly AnimalRec[];
  count(home: AnimalHome): number;
  capacity(home: AnimalHome): number;
  /** Buy an animal (spends gold). Returns an error message or null. */
  buy(species: Livestock, name?: string): string | null;
  pet(): { species: 'dog' | 'cat'; name: string; friendship: number };
  /** Is this building's pop door open (the flock trots out to graze on fine days)? */
  doorOpen(home: AnimalHome): boolean;
  /** Flip a pop door (creak + swing on the farm model via `animals:door`). */
  toggleDoor(home: AnimalHome): void;
  // ── co-op (see header)
  /** false on a co-op client: mirror the host instead of simulating. */
  setAuthority(host: boolean): void;
  readonly authority: boolean;
  snapshot(): AnimalSnapshot;
  applySnapshot(s: AnimalSnapshot): void;
  /** Host: a remote farmer's action. Items they collect come back as `animals:grant`. */
  applyIntent(peer: string, intent: AnimalIntent): void;
  /** Client: items the host granted this farmer. */
  receiveGrant(items: AnimalGrant[]): void;
  poses(): AnimalPoses;
  applyPoses(p: AnimalPoses): void;
}

declare module '../core/game' {
  interface GameServices {
    animals: AnimalsApi;
  }
}

declare module '../core/events' {
  interface GameEvents {
    'animal:petted': { id: number; species: string; name: string; friendship: number };
    'animal:produce': { id: number; species: string; itemId: string; quality: number };
    'animal:bought': { id: number; species: string; name: string };
    /** Co-op host: shared herd state changed (broadcast `animals.snapshot()`). */
    'animals:changed': { rev: number };
    /** Co-op client: forward this action to the host (`animals.applyIntent(peer, intent)`). */
    'animals:intent': { intent: AnimalIntent };
    /** Co-op host: items a remote farmer collected (route to that peer's `animals.receiveGrant`). */
    'animals:grant': { peer: string; items: AnimalGrant[] };
    /** A pop door opened / shut (farm models swing the hatch; also fired on load / snapshot). */
    'animals:door': { home: string; open: boolean };
    /** Overnight report (emitted from day:start, before the end-of-day screen opens). */
    'animals:summary': AnimalSummary;
  }
}

export interface AnimalSummary {
  /** The day that just ended. */
  day: number;
  fed: number;
  hungry: number;
  unpetted: number;
  /** Per animal: yesterday's care and the overnight friendship change. */
  animals: { id: number; name: string; species: Livestock; fed: boolean; petted: boolean; delta: number; friendship: number }[];
  /** Laid overnight / ready to collect this morning. */
  produce: { item: string; q: number }[];
  pet?: { name: string; species: 'dog' | 'cat'; bowl: boolean };
  /** The morning's to-do list (end-of-day card "Tomorrow's chores"): icon item id + short line. */
  chores?: { icon: string; text: string }[];
}

const CAP = 6;
/** Presentation scale per species (chibi models read small next to the farmer otherwise). */
const SCALE: Record<Species, number> = { chicken: 1.14, duck: 1.14, cow: 1.1, goat: 1.08, sheep: 1.1, pig: 1.08, dog: 1.3, cat: 1.25 };
const QUALITY_NAME = ['', 'silver', 'gold', 'radiant'];

interface Live {
  rec: AnimalRec | null;
  actor: AnimalActor;
  zT: number;
  slot: number;
  leaving: boolean;
}

export class AnimalSystem implements System, AnimalsApi {
  readonly name = 'animals';
  private game!: Game;
  private st: State = AnimalSystem.fresh();
  private live: Live[] = [];
  private group = new THREE.Group();
  private pops = new AnimalPops();
  private props = new THREE.Group();
  private hayMeshes: THREE.Mesh[] = [];
  private eggMeshes: THREE.Mesh[] = [];
  private truffleMeshes: THREE.Mesh[] = [];
  private mapId = '';
  private demoHearts = 0;
  private demoHeartT = 0;
  /** Demo: the animal the staged petting hearts go to (null = whoever is nearest the farmer). */
  private demoPet: Live | null = null;
  private checkT = 0;
  private rng = new Rng('animals');
  /** Morning notes (hungry animals...), shown once the farmer is up again. */
  private morning: { text: string; icon?: string; kind: 'info' | 'good' | 'bad' }[] = [];
  /** Co-op: host (and solo) simulate; clients mirror. */
  authority = true;
  private rev = 0;
  private dirty = false;
  private dirtyT = 0;

  private static fresh(): State {
    return {
      animals: [],
      hay: { coop: Array(CAP).fill(false), barn: Array(CAP).fill(false) },
      eggs: [],
      truffles: [],
      pet: { species: 'dog', variant: 0, name: PET_NAMES.dog, friendship: 250, bowl: false, petted: false },
      nextId: 1,
      doors: { coop: true, barn: true },
    };
  }

  init(game: Game): void {
    this.game = game;
    game.provide('animals', this);
    this.group.name = 'animals';
    this.group.userData.perfTag = 'animals';
    this.group.userData.indoors = true;
    // Animals carry baked vertex AO; skipping the GTAO G-buffer saves a draw call per animal.
    this.group.userData.noAO = true;
    this.props.name = 'animal-props';
    this.props.userData.perfTag = 'animals';
    this.props.userData.indoors = true;
    game.scene.add(this.group, this.pops.group, this.props);

    game.events.on('player:interact', ({ x, z }) => this.interact(x, z));
    game.events.on('player:use', ({ x, z }) => {
      // Watering can on the pet bowl fills it too.
      if (this.mapId === 'farm' && this.isBowl(x, z) && game.services.inventory?.selected()?.id === 'wateringCan') this.fillBowl();
    });
    game.events.on('day:start', ({ day }) => this.newDay(day));
    game.events.on('sleep:wake', () => this.flushMorning());
    // Scything meadow weeds gathers hay once there's a building to store it for.
    game.events.on('tool:impact', ({ tool, hit }) => {
      const b = game.services.buildings;
      if (tool === 'scythe' && hit === 'weed' && (b?.has('coop') || b?.has('barn')) && this.rng.next() < 0.5) game.events.emit('item:give', { itemId: 'hay', qty: 1 });
    });
    // Grazing is earned, not granted: fixedUpdate counts each animal's minutes out on the pasture
    // (pop door open + fine weather + daylight) and an hour of grass counts as a meal.
    this.pops.farmer = game.player.position;
    game.events.on('building:built', () => {
      if (this.mapId === 'farm') this.respawn();
    });
    // Demos set the hour right after staging: stage once that has settled.
    game.events.on('demo:stage', ({ name, showcase }) => {
      this.demoHearts = 0;
      this.pops.clear();
      queueMicrotask(() => this.stageDemo(name, showcase));
    });
    // Debug / demo time jumps: re-seat everyone for the new hour (pet indoors at night, pasture by day).
    game.events.on('time:set', () => {
      if (this.mapId) this.respawn();
    });
  }

  // ───────────────────────────────────────────── api

  roster(): readonly AnimalRec[] {
    return this.st.animals;
  }

  count(home: AnimalHome): number {
    return this.st.animals.filter((a) => a.home === home).length;
  }

  capacity(home: AnimalHome): number {
    return this.game.services.buildings?.has(home) ? CAP : 0;
  }

  buy(species: Livestock, name?: string): string | null {
    const info = LIVESTOCK[species];
    if (!this.game.services.buildings?.has(info.home)) return `Needs a ${info.home}.`;
    if (this.count(info.home) >= CAP) return `The ${info.home} is full.`;
    const eco = this.game.services.economy;
    if (!this.authority) {
      // Co-op client: the purse is shared and the host spends it; check here for a friendly message.
      if (eco && eco.gold() < info.price) return `Needs ${info.price.toLocaleString()}g.`;
      this.dispatch({ kind: 'buy', species, name });
      return null;
    }
    if (!eco || !eco.spend(info.price, `animal:${species}`)) return `Needs ${info.price.toLocaleString()}g.`;
    const rec = this.add(species, Math.floor(this.rng.next() * info.variants), name);
    this.game.events.emit('animal:bought', { id: rec.id, species, name: rec.name });
    if (this.mapId === info.home || this.mapId === 'farm') this.respawn();
    this.touch();
    return null;
  }

  pet(): { species: 'dog' | 'cat'; name: string; friendship: number } {
    const p = this.st.pet;
    return { species: p.species, name: p.name, friendship: p.friendship };
  }

  doorOpen(home: AnimalHome): boolean {
    return !!this.st.doors[home];
  }

  toggleDoor(home: AnimalHome): void {
    if (!this.game.services.buildings?.has(home)) return;
    const open = !this.st.doors[home];
    this.game.services.audio?.play('door');
    const n = this.count(home);
    const who = home === 'coop' ? 'flock' : 'herd';
    const fine = this.grazing();
    this.toast(
      open
        ? `Opened the ${home} door${n ? (fine ? ` — the ${who} will head out to graze` : ` — too ${this.game.calendar.season === 'winter' ? 'cold' : 'wet'} to graze today`) : ''}`
        : `Shut the ${home} door${n ? ` — the ${who} stays in (fill the ${home === 'barn' ? 'manger' : 'trough'} with hay)` : ''}`,
      'hay',
      'info',
    );
    this.dispatch({ kind: 'door', home });
  }

  private add(species: Livestock, variant: number, name?: string, friendship = 0): AnimalRec {
    const used = new Set(this.st.animals.map((a) => a.name));
    const pool = ANIMAL_NAMES.filter((n) => !used.has(n));
    const rec: AnimalRec = {
      id: this.st.nextId++,
      species,
      variant,
      name: name ?? pool[Math.floor(this.rng.next() * pool.length)] ?? `Friend ${this.st.nextId}`,
      home: LIVESTOCK[species].home,
      friendship,
      mood: 200,
      fed: false,
      petted: false,
      days: 0,
      ready: false,
    };
    this.st.animals.push(rec);
    return rec;
  }

  // ───────────────────────────────────────────── co-op

  setAuthority(host: boolean): void {
    this.authority = host;
    if (host) for (const l of this.live) l.actor.release();
  }

  /** Shared state changed (host): announce it, throttled in update(). */
  private touch(): void {
    if (this.authority) this.dirty = true;
  }

  snapshot(): AnimalSnapshot {
    return { rev: this.rev, state: JSON.parse(JSON.stringify(this.st)) as unknown };
  }

  applySnapshot(s: AnimalSnapshot): void {
    if (this.authority || !s || typeof s.state !== 'object') return;
    const prevIds = this.st.animals.map((a) => `${a.id}:${a.home}`).join(',');
    const prevPet = `${this.st.pet.species}:${this.st.pet.variant}`;
    const doors0 = `${this.st.doors.coop}${this.st.doors.barn}`;
    this.merge(s.state);
    this.rev = s.rev;
    if (doors0 !== `${this.st.doors.coop}${this.st.doors.barn}`) {
      this.syncDoors();
      if (this.mapId && this.mapId !== 'farm') {
        this.respawn();
        return;
      }
    }
    const ids = this.st.animals.map((a) => `${a.id}:${a.home}`).join(',');
    if (ids !== prevIds || prevPet !== `${this.st.pet.species}:${this.st.pet.variant}`) {
      if (this.mapId) this.respawn();
      return;
    }
    // Same herd: re-link the live actors to the fresh records, refresh props (hay, eggs, truffles, bowl).
    for (const l of this.live) {
      if (!l.rec) continue;
      const r = this.st.animals.find((a) => a.id === l.rec!.id);
      if (!r) continue;
      l.rec = r;
      if (r.species === 'sheep') l.actor.wool = r.ready ? 1 : 0.35 + 0.65 * Math.min(1, r.days / LIVESTOCK.sheep.every);
    }
    this.refreshProps();
  }

  /** Farmer action: applied here on the host / solo, forwarded (with optimistic cosmetics) on a client. */
  private dispatch(it: AnimalIntent): void {
    if (this.authority) {
      this.apply(null, it);
      return;
    }
    this.game.events.emit('animals:intent', { intent: it });
    // Optimistic: the props react at once; the host's next snapshot settles it.
    const pen = this.pen();
    if (it.kind === 'eggs') this.st.eggs = it.nest == null ? [] : this.st.eggs.filter((e) => e.nest !== it.nest);
    else if (it.kind === 'truffle') this.st.truffles = this.st.truffles.filter((t) => Math.floor(t.x) !== it.x || Math.floor(t.z) !== it.z);
    else if (it.kind === 'bowl') this.st.pet.bowl = true;
    else if (it.kind === 'door') {
      this.st.doors[it.home] = !this.st.doors[it.home];
      this.game.events.emit('animals:door', { home: it.home, open: this.st.doors[it.home] });
    } else if (it.kind === 'feed' && pen) {
      let n = it.hay;
      const hay = this.st.hay[it.home];
      for (let i = 0; i < hay.length && n > 0; i++) if (!hay[i]) (hay[i] = true), n--;
    }
    this.refreshProps();
  }

  applyIntent(peer: string, intent: AnimalIntent): void {
    if (!this.authority || !intent || typeof intent !== 'object') return;
    this.apply(peer, intent);
  }

  receiveGrant(items: AnimalGrant[]): void {
    for (const g of items ?? []) {
      if (!g || typeof g.itemId !== 'string') continue;
      this.game.events.emit('item:give', { itemId: g.itemId, qty: Math.max(1, g.qty | 0), quality: g.quality | 0 });
      if (g.quality > 0) this.toast(`A <b>${QUALITY_NAME[g.quality]}</b>-star find!`, g.itemId, 'good');
    }
    if (items?.length) this.game.services.audio?.play('pickup');
  }

  /** The authoritative effect of an intent. `peer` null = this machine's farmer. */
  private apply(peer: string | null, it: AnimalIntent): void {
    const out: AnimalGrant[] = [];
    const grant = (itemId: string, quality: number, id: number, species: string, qty = 1): void => {
      this.game.events.emit('animal:produce', { id, species, itemId, quality });
      if (peer == null) this.give(itemId, quality, qty);
      else out.push({ itemId, qty, quality });
    };
    switch (it.kind) {
      case 'pet': {
        if (it.id === 0) {
          const p = this.st.pet;
          if (!p.petted) {
            p.petted = true;
            p.friendship = Math.min(1000, p.friendship + 12);
          }
          break;
        }
        const r = this.st.animals.find((a) => a.id === it.id);
        if (!r) break;
        if (r.ready && it.tool) {
          r.ready = false;
          grant(produceFor(r.species, r.variant), this.quality(r), r.id, r.species);
          const l = this.live.find((v) => v.rec === r);
          if (l && r.species === 'sheep') l.actor.wool = 0.35;
        }
        if (!r.petted) {
          r.petted = true;
          r.friendship = Math.min(1000, r.friendship + 15);
          r.mood = Math.min(255, r.mood + 20);
        }
        // A remote farmer's pet: the host sees the hop + heart too when it's on this map.
        if (peer != null) {
          const l = this.live.find((v) => v.rec === r);
          if (l) {
            l.actor.pet(this.game.player.position);
            this.pops.heart(l.actor.topPoint(), l.actor, { name: r.name, hearts: Math.round(r.friendship / 100) / 2 });
          }
        }
        this.game.events.emit('animal:petted', { id: r.id, species: r.species, name: r.name, friendship: r.friendship });
        break;
      }
      case 'feed': {
        const hay = this.st.hay[it.home];
        if (!hay) break;
        let n = Math.max(0, it.hay | 0);
        for (let i = 0; i < hay.length && n > 0; i++) if (!hay[i]) (hay[i] = true), n--;
        if (n > 0) {
          // Someone else filled it first: hand the spare hay back.
          if (peer == null) this.game.events.emit('item:give', { itemId: 'hay', qty: n });
          else out.push({ itemId: 'hay', qty: n, quality: 0 });
        }
        this.refreshProps();
        break;
      }
      case 'eggs': {
        // One nest (per-box pickup) or the whole shelf (older co-op peers send no nest).
        const take = it.nest == null ? this.st.eggs : this.st.eggs.filter((e) => e.nest === it.nest);
        for (const e of take) grant(e.item, e.q, e.id ?? -1, e.sp ?? (e.item === 'duckEgg' || e.item === 'duckFeather' ? 'duck' : 'chicken'));
        this.st.eggs = this.st.eggs.filter((e) => !take.includes(e));
        this.refreshProps();
        break;
      }
      case 'truffle': {
        const ti = this.st.truffles.findIndex((tr) => Math.floor(tr.x) === it.x && Math.floor(tr.z) === it.z);
        if (ti < 0) break;
        const tr = this.st.truffles.splice(ti, 1)[0]!;
        grant('truffle', tr.q, -1, 'pig');
        this.refreshProps();
        break;
      }
      case 'bowl': {
        if (this.st.pet.bowl) break;
        this.st.pet.bowl = true;
        this.syncBowl();
        break;
      }
      case 'buy': {
        if (peer != null && LIVESTOCK[it.species]) this.buy(it.species, it.name);
        break;
      }
      case 'door': {
        if (it.home !== 'coop' && it.home !== 'barn') break;
        this.st.doors[it.home] = !this.st.doors[it.home];
        this.game.events.emit('animals:door', { home: it.home, open: this.st.doors[it.home] });
        // Re-seat the flock for the new door state (inside ↔ pasture) on whatever map we're on.
        if (this.mapId === it.home || this.mapId === 'farm') this.respawn();
        break;
      }
    }
    if (peer != null && out.length) this.game.events.emit('animals:grant', { peer, items: out });
    this.touch();
  }

  poses(): AnimalPoses {
    const list: number[] = [];
    for (const l of this.live) {
      if (l.leaving) continue;
      const a = l.actor;
      list.push(l.rec ? l.rec.id : 0, Math.round(a.pos.x * 100) / 100, Math.round(a.pos.z * 100) / 100, Math.round(a.heading * 100) / 100, a.stateCode);
    }
    return { map: this.mapId, list };
  }

  applyPoses(p: AnimalPoses): void {
    if (this.authority || !p || p.map !== this.mapId || !Array.isArray(p.list)) return;
    const seen = new Set<Live>();
    for (let i = 0; i + 4 < p.list.length; i += 5) {
      const id = p.list[i]!;
      const l = this.live.find((v) => (v.rec ? v.rec.id : 0) === id);
      if (!l || l.leaving) continue;
      l.actor.follow(p.list[i + 1]!, p.list[i + 2]!, p.list[i + 3]!, p.list[i + 4]!);
      seen.add(l);
    }
    for (const l of this.live) if (!seen.has(l)) l.actor.release();
  }

  // ───────────────────────────────────────────── day cycle

  private grazing(): boolean {
    const c = this.game.calendar;
    return c.season !== 'winter' && (c.weather === 'sun' || c.weather === 'wind');
  }

  private outsideNow(home?: AnimalHome): boolean {
    const h = this.game.calendar.hour;
    return (!home || this.st.doors[home]) && this.grazing() && h >= 8.5 && h < 17.5;
  }

  private quality(a: { friendship: number; mood: number }): number {
    const s = (a.friendship / 1000) * 0.65 + (a.mood / 255) * 0.35 + (this.rng.next() - 0.5) * 0.18;
    return s > 0.97 ? 3 : s > 0.8 ? 2 : s > 0.55 ? 1 : 0;
  }

  private newDay(day = this.game.calendar.day): void {
    if (!this.authority) {
      // Co-op client: the host rolls the herd over; its snapshot follows. Just re-seat for the morning.
      if (this.mapId) this.respawn();
      return;
    }
    this.touch();
    const eggs = this.st.eggs;
    const made = new Map<string, number>();
    const produce: AnimalSummary['produce'] = [];
    const report: AnimalSummary['animals'] = [];
    const homes = { coop: this.st.animals.filter((a) => a.home === 'coop'), barn: this.st.animals.filter((a) => a.home === 'barn') };
    for (const a of this.st.animals) {
      const slot = homes[a.home].indexOf(a);
      const f0 = a.friendship;
      // Hay left in the trough overnight feeds whoever didn't eat.
      if (!a.fed && this.st.hay[a.home][slot]) {
        this.st.hay[a.home][slot] = false;
        a.fed = true;
      }
      const fed = a.fed;
      const petted = a.petted;
      a.mood = THREE.MathUtils.clamp(a.mood + (a.fed ? 30 : -60) + (a.petted ? 20 : -10), 0, 255);
      if (!a.petted) a.friendship = Math.max(0, a.friendship - 8);
      if (!a.fed) a.friendship = Math.max(0, a.friendship - 20);
      const info = LIVESTOCK[a.species];
      if (a.fed) {
        a.days++;
        if (a.days >= info.every) {
          a.days = 0;
          const q = this.quality(a);
          if (info.byHand) {
            a.ready = true;
            produce.push({ item: produceFor(a.species, a.variant), q });
          } else if (info.home === 'coop') {
            const free = [0, 1, 2, 3, 4, 5].filter((n) => !eggs.some((e) => e.nest === n));
            if (free.length) {
              let item = produceFor(a.species, a.variant);
              if (a.species === 'duck' && a.mood > 200 && a.friendship > 600 && this.rng.next() < 0.3) item = 'duckFeather';
              eggs.push({ nest: free[0]!, item, q, id: a.id, sp: a.species });
              made.set(item, (made.get(item) ?? 0) + 1);
              produce.push({ item, q });
            }
          } else if (a.species === 'pig' && (a.grazed ?? 0) >= 60) {
            // Pigs only snuffle up truffles after a day out rooting in the pasture.
            this.digTruffles(q);
            produce.push({ item: 'truffle', q });
          }
        }
      }
      report.push({ id: a.id, name: a.name, species: a.species, fed, petted, delta: a.friendship - f0 + (petted ? 15 : 0), friendship: a.friendship });
      a.fed = false;
      a.petted = false;
      a.grazed = 0;
    }
    const pet = this.st.pet;
    const bowl = pet.bowl;
    if (pet.bowl) pet.friendship = Math.min(1000, pet.friendship + 6);
    pet.bowl = this.game.calendar.weather === 'rain' || this.game.calendar.weather === 'storm';
    pet.petted = false;
    this.refreshProps();
    if (this.mapId) this.respawn();
    // Overnight report for the end-of-day screen + morning notes once the farmer is up.
    const prevDay = day > 1 ? day - 1 : 28;
    if (this.st.animals.length) {
      const hungry = report.filter((r) => !r.fed);
      this.game.events.emit('animals:summary', {
        day: prevDay,
        fed: report.length - hungry.length,
        hungry: hungry.length,
        unpetted: report.filter((r) => !r.petted).length,
        animals: report,
        produce,
        pet: { name: pet.name, species: pet.species, bowl },
        chores: this.chores(),
      });
      this.morning = [];
      if (hungry.length === 1) this.morning.push({ text: `<b>${hungry[0]!.name}</b> looks hungry — fill the ${LIVESTOCK[hungry[0]!.species].home === 'barn' ? 'manger' : 'trough'} with hay`, icon: 'hay', kind: 'bad' });
      else if (hungry.length > 1) this.morning.push({ text: `<b>${hungry[0]!.name}</b> and ${hungry.length - 1} other${hungry.length > 2 ? 's' : ''} look hungry this morning`, icon: 'hay', kind: 'bad' });
      // Everything waiting in the nest boxes (fresh + any left from yesterday), not just tonight's lay.
      const eggN = eggs.length;
      const fresh = [...made.values()].reduce((a, b) => a + b, 0);
      if (eggN) this.morning.push({ text: `<b>${eggN}</b> egg${eggN > 1 ? 's' : ''} waiting in the nest boxes${fresh && fresh < eggN ? ` (${fresh} fresh)` : ''}`, icon: [...made.keys()][0] ?? eggs[0]!.item, kind: 'good' });
      const ready = this.st.animals.filter((a) => a.ready);
      if (ready.length) this.morning.push({ text: `<b>${ready[0]!.name}</b>${ready.length > 1 ? ` and ${ready.length - 1} more are` : ' is'} ready to ${ready[0]!.species === 'sheep' ? 'shear' : 'milk'}`, icon: produceFor(ready[0]!.species, ready[0]!.variant), kind: 'info' });
      // No bed to wake up from (debug day rolls): show them right away.
      if (!this.game.services.sleep) this.flushMorning();
    }
  }

  /** What's waiting for the farmer this morning (after the overnight roll-over). */
  private chores(): { icon: string; text: string }[] {
    const out: { icon: string; text: string }[] = [];
    const st = this.st;
    const plural = (n: number, a: string, b = `${a}s`): string => `${n} ${n === 1 ? a : b}`;
    const milk = st.animals.filter((a) => a.ready && a.species !== 'sheep');
    const wool = st.animals.filter((a) => a.ready && a.species === 'sheep');
    if (milk.length) out.push({ icon: produceFor(milk[0]!.species, milk[0]!.variant), text: `Milk ${milk.length === 1 ? milk[0]!.name : plural(milk.length, 'animal')}` });
    if (wool.length) out.push({ icon: 'wool', text: `Shear ${wool.length === 1 ? wool[0]!.name : plural(wool.length, 'sheep', 'sheep')}` });
    if (st.eggs.length) out.push({ icon: st.eggs[0]!.item, text: `Collect ${plural(st.eggs.length, 'egg')} from the nests` });
    if (st.truffles.length) out.push({ icon: 'truffle', text: `Dig up ${plural(st.truffles.length, 'truffle')} in the pasture` });
    for (const home of ['coop', 'barn'] as const) {
      const n = this.count(home);
      const empty = st.hay[home].slice(0, n).filter((h) => !h).length;
      if (n && empty && (!this.grazing() || !st.doors[home])) out.push({ icon: 'hay', text: `Put ${plural(empty, 'portion')} of hay in the ${home === 'barn' ? 'manger' : 'trough'}` });
    }
    for (const home of ['coop', 'barn'] as const) {
      if (this.count(home) && !st.doors[home] && this.grazing()) out.push({ icon: 'hay', text: `Open the ${home} door — fine day for grazing` });
    }
    if (!st.pet.bowl) out.push({ icon: 'wateringCan', text: `Fill ${st.pet.name}’s water bowl` });
    if (st.animals.length) out.push({ icon: 'heart', text: `Say good morning to ${plural(st.animals.length, 'animal')}` });
    return out.slice(0, 5);
  }

  private flushMorning(): void {
    const notes = this.morning;
    this.morning = [];
    notes.forEach((n, i) => setTimeout(() => this.toast(n.text, n.icon, n.kind), 600 + i * 900));
  }

  private digTruffles(q: number): void {
    const p = this.game.services.buildings?.pasture();
    if (!p || this.st.truffles.length > 8) return;
    const n = 1 + (this.rng.next() < 0.4 ? 1 : 0);
    for (let i = 0; i < n; i++) {
      this.st.truffles.push({ x: Math.floor(p.x0 + 1.5 + this.rng.next() * (p.x1 - p.x0 - 3)) + 0.5, z: Math.floor(p.z0 + 1.5 + this.rng.next() * (p.z1 - p.z0 - 3)) + 0.5, q });
    }
  }

  // ───────────────────────────────────────────── actors

  onMapChange(mapId: string): void {
    this.mapId = mapId;
    this.demoHearts = 0;
    this.pops.clear();
    this.respawn();
  }

  private clearActors(): void {
    for (const l of this.live) {
      this.group.remove(l.actor.root);
      l.actor.forget();
    }
    this.live = [];
  }

  private pen(): PenAnchors | null {
    const m = this.game.world.current;
    return isInterior(m) ? ((m as unknown as { pen?: PenAnchors }).pen ?? null) : null;
  }

  private spawn(rec: AnimalRec | null, species: Species, variant: number, slot: number): Live {
    const actor = new AnimalActor(species, variant);
    actor.setScale(SCALE[species]);
    const map = this.game.world.current!;
    actor.heightAt = (x, z) => map.heightAt(x, z);
    actor.walkable = (x, z) => map.grid.isWalkable(Math.floor(x), Math.floor(z));
    if (rec && species === 'sheep') actor.wool = rec.ready ? 1 : 0.35 + 0.65 * Math.min(1, rec.days / LIVESTOCK.sheep.every);
    actor.player = this.game.player.position;
    actor.slotId = rec ? rec.id : 99;
    this.group.add(actor.root);
    const l: Live = { rec, actor, zT: Math.random() * 2, slot, leaving: false };
    this.live.push(l);
    return l;
  }

  /** Rebuild the actors for the current map from the roster. */
  private respawn(): void {
    this.clearActors();
    this.refreshProps();
    const map = this.game.world.current;
    if (!map) return;
    const pen = this.pen();
    const night = this.isNight();
    if (pen) {
      const mine = this.st.animals.filter((a) => a.home === pen.kind);
      const out = this.outsideNow(pen.kind) && this.game.services.buildings?.has(pen.kind);
      let perch = 0;
      mine.forEach((rec, i) => {
        if (out) return;
        const l = this.spawn(rec, rec.species, rec.variant, i);
        const s = pen.slots[i % pen.slots.length]!;
        const a = l.actor;
        this.seat(a, s, pen);
        // Hens roost on the perches; ducks sleep in the straw.
        const roost = rec.species === 'chicken' ? pen.perches?.[perch++] : undefined;
        if (roost) a.bedSpot = roost;
        a.sleeping = night;
        const p = night ? a.bedSpot! : s.stall ? new THREE.Vector3((a.area.x0 + a.area.x1) / 2 + (Math.random() - 0.5) * 0.3, 0, THREE.MathUtils.lerp(a.area.z0, a.area.z1, Math.random())) : this.randomIn(pen.area, a);
        const h = night ? (roost ? (Math.random() - 0.5) * 0.4 : (s.bedHeading ?? Math.PI * (0.6 + Math.random() * 0.8)) + (Math.random() - 0.5) * 0.5) : s.stall ? (Math.random() - 0.5) * 0.6 : Math.random() * Math.PI * 2;
        a.place(p.x, p.z, h);
        a.settle();
      });
    } else if (map.id === 'farm') {
      const b = this.game.services.buildings;
      if (b && this.outsideNow()) {
        const homes: Record<AnimalHome, number> = { coop: 0, barn: 0 };
        for (const rec of this.st.animals) {
          const slot = homes[rec.home]++;
          if (!b.has(rec.home) || !this.outsideNow(rec.home)) continue;
          const l = this.spawn(rec, rec.species, rec.variant, slot);
          this.setupPasture(l.actor);
          const p = this.randomIn(l.actor.area, l.actor);
          l.actor.place(p.x, p.z, Math.random() * Math.PI * 2);
          l.actor.settle();
        }
      }
      this.spawnPet(false);
    } else if (map.id === 'house' && (this.game.calendar.hour >= 19 || this.game.calendar.hour < 6.5)) {
      this.spawnPet(true);
    } else if (map.id === 'house' && this.game.calendar.hour < 9) {
      // Early mornings the pet lingers indoors, sitting on the warm hearth rug before heading out.
      this.spawnPet(true, true);
    }
  }

  /** Wire an actor to its pen slot: manger stand spot (reach behind the mouth point), bed, own stall. */
  private seat(a: AnimalActor, s: PenAnchors['slots'][number], pen: PenAnchors): void {
    const reach = a.gait.reach * a.scale;
    a.feedHeading = s.feedHeading;
    a.feedSpot = new THREE.Vector3(s.feed.x - Math.sin(s.feedHeading) * reach, 0, s.feed.z - Math.cos(s.feedHeading) * reach);
    a.bedSpot = s.bed;
    if (s.stall) {
      // Stall life: confined to its own stall, between the bedding and the manger.
      const len = a.gait.len * a.scale;
      const st = s.stall;
      a.area = { x0: st.x0, z0: Math.min(st.z0 + len, a.feedSpot.z - 0.05), x1: st.x1, z1: a.feedSpot.z };
      a.stalled = true;
      a.confine = true;
      a.walkable = () => true;
    } else {
      a.area = pen.area;
      a.curious = true;
    }
  }

  private setupPasture(a: AnimalActor): void {
    const p = this.game.services.buildings!.pasture();
    a.area = { x0: p.x0 + 0.9, z0: p.z0 + 1.0, x1: p.x1 - 0.9, z1: p.z1 - 0.9 };
    a.blockers = PASTURE_PROPS;
    a.grazes = true;
    a.curious = true;
    a.sleeping = false;
  }

  private spawnPet(indoors: boolean, morning = false): void {
    const pet = this.st.pet;
    const l = this.spawn(null, pet.species, pet.variant, -1);
    const a = l.actor;
    a.sitter = true;
    if (indoors && morning) {
      a.area = { x0: 6.1, z0: 2.4, x1: 8.0, z1: 3.4 };
      a.curious = true;
      a.place(7.2, 2.7, 0.35);
    } else if (indoors) {
      // Curled up in the wicker pet bed by the hearth.
      a.area = { x0: 5.2, z0: 1.4, x1: 7.9, z1: 3.4 };
      a.sleeping = true;
      a.bedSpot = new THREE.Vector3(7.95, 0.1, 1.5);
      a.place(7.95, 1.5, -0.6);
    } else {
      const d = SITES.doghouse;
      a.area = { x0: 30.5, z0: 17.6, x1: 37.6, z1: 21.5 };
      a.sleeping = this.game.calendar.hour >= 21 || this.game.calendar.hour < 6.2;
      a.bedSpot = new THREE.Vector3(d.x + 0.2, 0, d.z + 1.25);
      const p = a.sleeping ? a.bedSpot : new THREE.Vector3(SITES.bowl.x + 0.9, 0, SITES.bowl.z + 0.8);
      a.place(p.x, p.z, a.sleeping ? 0.3 : -0.6);
    }
    a.settle();
  }

  private randomIn(r: { x0: number; z0: number; x1: number; z1: number }, a: AnimalActor): THREE.Vector3 {
    const pet = a.species === 'dog' || a.species === 'cat';
    for (let i = 0; i < 30; i++) {
      const x = r.x0 + Math.random() * (r.x1 - r.x0);
      const z = r.z0 + Math.random() * (r.z1 - r.z0);
      if (!a.walkable(x, z)) continue;
      if (a.blockers.some((b) => x > b.x0 - 0.6 && x < b.x1 + 0.6 && z > b.z0 - 0.6 && z < b.z1 + 0.6)) continue;
      // The pet keeps well clear of the livestock (no cat perched on a cow's back from the high camera).
      if (pet && this.live.some((l) => l.rec && Math.hypot(l.actor.pos.x - x, l.actor.pos.z - z) < 1.2 + l.actor.gait.len * l.actor.scale)) continue;
      if (this.live.some((l) => l.actor !== a && l.actor.pos.distanceTo(new THREE.Vector3(x, l.actor.pos.y, z)) < l.actor.gait.radius + a.gait.radius + 0.1)) continue;
      return new THREE.Vector3(x, 0, z);
    }
    return new THREE.Vector3((r.x0 + r.x1) / 2, 0, (r.z0 + r.z1) / 2);
  }

  private isNight(): boolean {
    const h = this.game.calendar.hour;
    return h >= 19 || h < 6;
  }

  // ───────────────────────────────────────────── props (hay, eggs, truffles, bowl)

  private refreshProps(): void {
    for (const m of [...this.hayMeshes, ...this.eggMeshes, ...this.truffleMeshes]) this.props.remove(m);
    this.hayMeshes = [];
    this.eggMeshes = [];
    this.truffleMeshes = [];
    const pen = this.pen();
    if (pen) {
      const hay = this.st.hay[pen.kind];
      pen.slots.forEach((s, i) => {
        if (!hay[i]) return;
        const m = new THREE.Mesh(hayGeo(), imat('straw'));
        m.position.copy(s.hay);
        m.rotation.y = i * 1.7;
        m.castShadow = true;
        m.receiveShadow = true;
        this.props.add(m);
        this.hayMeshes[i] = m;
      });
      // Hand-lettered name plaques over the stalls (barn) / the flock's chalkboard (coop).
      const mine = this.st.animals.filter((a) => a.home === pen.kind);
      if (pen.kind === 'barn' && pen.plaques) {
        mine.forEach((a, i) => {
          const at = pen.plaques![i];
          if (!at) return;
          // A painted sign hung on the half-door, its foot kicked out so it faces up at the camera: the
          // name + a heart meter stay legible at gameplay zoom.
          const hearts = Math.round(a.friendship / 100) / 2;
          const m = new THREE.Mesh(plaqueGeo(), nameMaterial(`${a.name}\n${hearts}`, 'plaque'));
          m.position.set(at.x, at.y, at.z + 0.1);
          m.rotation.x = -0.5;
          m.castShadow = true;
          m.userData.noAO = true;
          this.props.add(m);
          this.hayMeshes.push(m);
        });
      } else if (pen.kind === 'coop' && mine.length) {
        const m = new THREE.Mesh(new THREE.PlaneGeometry(0.78, 0.48), nameMaterial(mine.map((a) => a.name).join('\n'), 'chalk'));
        m.position.copy(pen.board?.at ?? new THREE.Vector3(8.925, 1.51, 4.6));
        m.rotation.y = pen.board?.ry ?? -Math.PI / 2;
        m.userData.noAO = true;
        this.props.add(m);
        this.hayMeshes.push(m);
      }
      if (pen.kind === 'coop') {
        for (const e of this.st.eggs) {
          const n = pen.nests[e.nest];
          if (!n) continue;
          const m = new THREE.Mesh(eggGeo(), eggMat(e.item));
          m.position.set(n.x + ((e.nest * 37) % 5) * 0.03 - 0.06, n.y + 0.15, n.z + 0.1);
          m.rotation.set(0.9, e.nest, 0.3);
          m.castShadow = true;
          this.props.add(m);
          this.eggMeshes.push(m);
        }
      }
    } else if (this.mapId === 'farm') {
      for (const t of this.st.truffles) {
        const m = new THREE.Mesh(truffleGeo(), truffleMat());
        const map = this.game.world.current!;
        m.position.set(t.x, map.heightAt(t.x, t.z) + 0.05, t.z);
        m.rotation.y = t.x * 3.1;
        m.castShadow = true;
        this.props.add(m);
        this.truffleMeshes.push(m);
      }
    }
    this.syncBowl();
  }

  private syncBowl(): void {
    (this.game.services.buildings as unknown as { setBowl?: (f: boolean) => void } | undefined)?.setBowl?.(this.st.pet.bowl);
  }

  // ───────────────────────────────────────────── interaction

  private toast(text: string, icon?: string, kind: 'info' | 'good' | 'bad' = 'good'): void {
    this.game.events.emit('ui:toast', { text, icon, kind });
  }

  private voice(s: Species, pitch = 1): void {
    animalVoice(s, pitch, !!this.game.services.audio?.running);
  }

  private isBowl(x: number, z: number): boolean {
    return x === Math.floor(SITES.bowl.x) && z === Math.floor(SITES.bowl.z);
  }

  private fillBowl(): void {
    if (this.st.pet.bowl) return;
    this.dispatch({ kind: 'bowl' });
    this.syncBowl();
    this.game.services.audio?.play('refill');
    this.toast(`You filled ${this.st.pet.name}'s water bowl`, undefined, 'info');
  }

  /** Pop-door hatch tiles: outside on the farm (beside the coop's dutch door / the barn's right leaf) and
   *  inside each building (the hatch in the knee wall right of the doorway). */
  private hatchAt(x: number, z: number): AnimalHome | null {
    const pen = this.pen();
    if (pen?.hatch && x === pen.hatch.x && z === pen.hatch.z) return pen.kind;
    if (this.mapId !== 'farm') return null;
    const b = this.game.services.buildings;
    for (const home of ['coop', 'barn'] as const) {
      const hx = SITES[home].door.x + 1;
      if (b?.has(home) && x === hx && z === SITES[home].door.z) return home;
    }
    return null;
  }

  private interact(x: number, z: number): void {
    const hatch = this.hatchAt(x, z);
    if (hatch) {
      this.toggleDoor(hatch);
      return;
    }
    const pen = this.pen();
    const holding = this.game.services.inventory?.selected()?.id;
    const t = pen?.trough;
    const onTrough = !!t && x >= t.x0 && x <= t.x1 && z >= t.z0 && z <= t.z1;
    // Hay in hand + a manger / trough tile. Barn animals spend the day at the manger, so an animal that
    // wants attention (ready to milk / shear, or not yet petted today) wins; otherwise fill empty slots,
    // and a full trough never swallows the click when there's an animal there to pet.
    if (pen && onTrough && holding === 'hay') {
      const hit = this.hitAnimal(x, z);
      const wants = !!hit?.rec && (hit.rec.ready || !hit.rec.petted);
      if (hit && (wants || !this.troughHasRoom(pen))) {
        this.petActor(hit);
        return;
      }
      this.feed(pen);
      return;
    }
    if (pen?.kind === 'coop' && z <= 0 && x <= 2 && this.st.eggs.length) {
      // Per nest box: the column in front of the farmer, lower box first.
      const col = THREE.MathUtils.clamp(x, 0, 2);
      const e = this.st.eggs.find((q) => q.nest === col) ?? this.st.eggs.find((q) => q.nest === col + 3) ?? this.st.eggs.find((q) => q.nest % 3 === col);
      if (e) {
        this.liftEgg(e, pen);
        this.dispatch({ kind: 'eggs', nest: e.nest });
        return;
      }
    }
    // Otherwise an animal in reach wins (animals spend their day standing at the trough).
    const hit = this.hitAnimal(x, z);
    if (hit) {
      this.petActor(hit);
      return;
    }
    if (pen && onTrough) {
      this.feed(pen);
      return;
    }
    if (this.mapId === 'farm') {
      if (this.isBowl(x, z)) {
        this.fillBowl();
        return;
      }
      if (this.st.truffles.some((tr) => Math.floor(tr.x) === x && Math.floor(tr.z) === z)) this.dispatch({ kind: 'truffle', x, z });
    }
  }

  /** The animal the farmer is reaching for: body capsule nearest to points along the facing ray. */
  private hitAnimal(x: number, z: number): Live | null {
    const pp = this.game.player.position;
    let dx = x + 0.5 - pp.x;
    let dz = z + 0.5 - pp.z;
    const dl = Math.hypot(dx, dz) || 1;
    dx /= dl;
    dz /= dl;
    const samples = [0.45, 0.9, 1.35].map((k) => [pp.x + dx * k, pp.z + dz * k] as const);
    samples.push([x + 0.5, z + 0.5]);
    let best: Live | null = null;
    let bs = Infinity;
    for (const l of this.live) {
      if (l.leaving) continue;
      const c = l.actor.capsule();
      samples.forEach(([sx, sz], i) => {
        const ux = c.bx - c.ax;
        const uz = c.bz - c.az;
        const l2 = ux * ux + uz * uz;
        const k = l2 > 1e-8 ? THREE.MathUtils.clamp(((sx - c.ax) * ux + (sz - c.az) * uz) / l2, 0, 1) : 0;
        const d = Math.hypot(sx - (c.ax + ux * k), sz - (c.az + uz * k)) - c.r;
        const score = d + i * 0.04;
        if (d < 0.45 && score < bs) {
          bs = score;
          best = l;
        }
      });
    }
    return best;
  }

  private petActor(l: Live, quiet = false): void {
    const a = l.actor;
    const pp = this.game.player.position;
    const near = Math.hypot(a.pos.x - pp.x, a.pos.z - pp.z) < 2.2;
    // Milk / wool: needs the right tool in the backpack (a milk pail / shears from the carpenter).
    const rec = l.rec;
    if (!quiet && rec?.ready && LIVESTOCK[rec.species].byHand) {
      const tool = rec.species === 'sheep' ? 'shears' : 'milkPail';
      const inv = this.game.services.inventory;
      if (inv && inv.count(tool) > 0 && near) {
        this.harvestPose(l, rec.species === 'sheep' ? 'shear' : 'milk');
        this.dispatch({ kind: 'pet', id: rec.id, tool: true });
        this.pops.heart(a.topPoint(), a, { name: rec.name, hearts: Math.round(Math.min(1000, rec.friendship + (rec.petted ? 0 : 15)) / 100) / 2 });
        this.voice(a.species, 1.05);
        return;
      }
      if (!rec.petted || !this.hintedTool.has(rec.id)) {
        this.hintedTool.add(rec.id);
        this.toast(`<b>${rec.name}</b> is ready — you’ll need ${rec.species === 'sheep' ? '<b>shears</b>' : 'a <b>milk pail</b>'} (carpenter’s board, Supplies)`, tool, 'info');
      }
    }
    a.pet(pp);
    const fr = rec ? rec.friendship + (rec.petted ? 0 : 15) : this.st.pet.friendship;
    const name = rec ? rec.name : this.st.pet.name;
    this.pops.heart(a.topPoint(), a, { name, hearts: Math.round(Math.min(1000, fr) / 100) / 2 });
    // The farmer crouches and reaches out (only when actually beside the animal).
    if (near) {
      this.settleForPet(a);
      this.petPose(a);
    }
    if (!quiet) this.voice(a.species, a.species === 'chicken' || a.species === 'duck' ? 1.1 : 1);
    if (quiet) return;
    this.game.services.audio?.play('heart');
    this.dispatch({ kind: 'pet', id: rec ? rec.id : 0 });
  }

  private hintedTool = new Set<number>();

  /**
   * Petting distance: the animal eases round to face the farmer with its muzzle ~0.5 m from them (at
   * the reaching hand, never in the farmer's hip); stall animals stay put behind the manger.
   */
  private settleForPet(a: AnimalActor): void {
    if (a.stalled || a.isSleeping || a.perched) return;
    const pp = this.game.player.position;
    let dx = a.pos.x - pp.x;
    let dz = a.pos.z - pp.z;
    const d = Math.hypot(dx, dz) || 1;
    dx /= d;
    dz /= d;
    const want = a.gait.reach * a.scale + 0.6;
    const tx = pp.x + dx * want;
    const tz = pp.z + dz * want;
    if (!a.walkable(tx, tz)) return;
    a.easeTo(tx, tz, Math.atan2(-dx, -dz));
  }

  private give(itemId: string, q: number, qty = 1): void {
    this.game.events.emit('item:give', { itemId, qty, quality: q });
    this.game.services.audio?.play('pickup');
    if (q > 0) this.toast(`A <b>${QUALITY_NAME[q]}</b>-star find!`, itemId, 'good');
  }

  /** An empty hay slot for one of this building's animals? */
  private troughHasRoom(pen: PenAnchors): boolean {
    const want = Math.max(1, this.count(pen.kind));
    return this.st.hay[pen.kind].slice(0, want).some((h) => !h);
  }

  private feed(pen: PenAnchors): boolean {
    const hay = this.st.hay[pen.kind];
    const inv = this.game.services.inventory;
    const want = Math.max(1, this.count(pen.kind));
    let placed = 0;
    for (let i = 0; i < Math.min(want, hay.length); i++) {
      if (hay[i]) continue;
      if (!inv || !inv.remove('hay', 1)) break;
      placed++;
    }
    if (!placed) {
      if (hay.slice(0, want).every(Boolean)) this.toast('The trough is already full', 'hay', 'info');
      else this.toast('You need <b>hay</b> — the carpenter’s board sells it', 'hay', 'bad');
      return true;
    }
    this.dispatch({ kind: 'feed', home: pen.kind, hay: placed });
    this.game.services.audio?.play('place');
    this.toast(`Filled the trough with <b>${placed}</b> hay`, 'hay', 'info');
    return true;
  }

  // ───────────────────────────────────────────── per frame

  private lastHour = -1;

  /** Pasture time: every animal out on the grass (pop door open, fine day, daylight) banks minutes;
   *  an hour of grazing is a meal (hay in the trough is then left for tomorrow). */
  private graze(game: Game): void {
    const h = game.calendar.hour;
    const dh = h - this.lastHour;
    this.lastHour = h;
    if (!this.authority || dh <= 0 || dh > 0.5) return;
    const b = game.services.buildings;
    for (const a of this.st.animals) {
      if (!b?.has(a.home) || !this.outsideNow(a.home)) continue;
      a.grazed = (a.grazed ?? 0) + dh * 60;
      if (!a.fed && a.grazed >= 60) {
        a.fed = true;
        this.touch();
      }
    }
  }

  fixedUpdate(dt: number, game: Game): void {
    this.checkT -= dt;
    if (this.checkT > 0) return;
    this.checkT = 0.5;
    this.graze(game);
    const pen = this.pen();
    const night = this.isNight();
    if (pen) {
      const hay = this.st.hay[pen.kind];
      for (const l of this.live) {
        if (!l.rec) continue;
        l.actor.sleeping = night;
        l.actor.hungry = !l.rec.fed && !!hay[l.slot];
      }
    } else if (this.mapId === 'farm') {
      const b = game.services.buildings;
      if (!b) return;
      // Morning: file out of the door; dusk: file back in.
      const homes: Record<AnimalHome, number> = { coop: 0, barn: 0 };
      for (const rec of this.st.animals) {
        const slot = homes[rec.home]++;
        if (!b.has(rec.home)) continue;
        const l = this.live.find((v) => v.rec === rec);
        const out = this.outsideNow(rec.home);
        if (out && !l) {
          const d = b.doorFront(rec.home);
          const n = this.spawn(rec, rec.species, rec.variant, slot);
          this.setupPasture(n.actor);
          n.actor.place(d.x + (Math.random() - 0.5) * 0.4, d.z, 0);
          n.actor.settle();
          const p = this.randomIn(n.actor.area, n.actor);
          n.actor.goTo(p.x, p.z);
          break; // one at a time, a little parade
        }
        if (!out && l && !l.leaving) {
          l.leaving = true;
          const d = b.doorFront(rec.home);
          l.actor.goTo(d.x, d.z - 0.3, () => {
            this.group.remove(l.actor.root);
            this.live.splice(this.live.indexOf(l), 1);
          });
        }
      }
      const pet = this.live.find((l) => !l.rec);
      if (pet) pet.actor.sleeping = game.calendar.hour >= 21 || game.calendar.hour < 6.2;
    }
  }

  update(dt: number, game: Game): void {
    const t = game.time;
    const actors = this._actors;
    actors.length = 0;
    for (const l of this.live) actors.push(l.actor);
    const farmers = this.remoteFarmers();
    for (const l of this.live) {
      l.actor.farmers = farmers;
      l.actor.update(dt, t, actors);
      if (l.actor.isSleeping) {
        l.zT -= dt;
        if (l.zT < 0) {
          l.zT = 2 + Math.random() * 1.5;
          this.pops.z(l.actor.topPoint().add(new THREE.Vector3(0.1, 0.05, 0)));
        }
      }
      // Eating hay empties that trough slot (and feeds the animal).
      if (l.rec && l.actor.isEating && l.actor.hungry && l.slot >= 0) {
        const pen = this.pen();
        if (pen && this.st.hay[pen.kind][l.slot]) {
          if (this.authority && !l.rec.fed) this.touch();
          if (this.authority) l.rec.fed = true;
          const m = this.hayMeshes[l.slot];
          if (m) m.scale.setScalar(0.55);
        }
      }
    }
    // Demo: a steady trickle of hearts over whoever is nearest the player.
    if (this.demoHearts > 0) {
      this.demoHeartT -= dt;
      if (this.demoHeartT < 0) {
        this.demoHeartT = 1.15;
        const pp = game.player.position;
        const near = this.demoPet && this.live.includes(this.demoPet) ? this.demoPet : [...this.live].sort((a, b) => a.actor.pos.distanceTo(pp) - b.actor.pos.distanceTo(pp))[0];
        if (near) this.petActor(near, true);
      }
    }
    this.pops.update(dt, game.rc.camera);
    this.updateLifts(dt);
    this.updateHarvest(dt);
    this.fadeHat(dt, game);
    // Co-op: announce shared-state changes at most ~5x a second.
    this.dirtyT -= dt;
    if (this.dirty && this.dirtyT <= 0) {
      this.dirty = false;
      this.dirtyT = 0.2;
      this.game.events.emit('animals:changed', { rev: ++this.rev });
    }
  }

  private _farmers: THREE.Vector3[] = [];

  /** Co-op farmers standing on this map (animals keep a personal-space ring round each). */
  private remoteFarmers(): THREE.Vector3[] {
    const out = this._farmers;
    out.length = 0;
    if (!this.live.length) return out;
    const net = this.game.services.net as unknown as { remotes?: { list?: Map<number, { map: string; away: boolean; farmer: { root: THREE.Object3D } }> } } | undefined;
    const list = net?.remotes?.list;
    if (!list?.size) return out;
    for (const p of list.values()) if (!p.away && p.map === this.mapId && p.farmer?.root) out.push(p.farmer.root.position);
    return out;
  }

  // ───────────────────────────────────────────── farmer poses (pet / lift)

  private poseT = -1;
  private poseReentry = false;
  private poseKind: 'pet' | 'lift' | 'milk' | 'shear' = 'pet';
  private petLow = false;
  private poseDriver: ((rig: PlayerRig, dt: number) => ActionPose | null) | null = null;
  private posePrev: ((rig: PlayerRig, dt: number) => ActionPose | null) | null = null;
  /** Demo stills: hold the pose at this time (s) instead of finishing it. */
  private poseFreeze = -1;

  /**
   * Farmer poses layered over the player's action-pose hook (the tool actions keep working: the previous
   * driver runs whenever no pose is playing):
   *   pet   crouch + reach: bends at the waist, drops the hips, strokes the animal with the right hand
   *         (a little patting rhythm), head tipped down;
   *   lift  "look what I found": faces the camera, arms flung wide, the find floating over the hat.
   */
  private playPose(kind: 'pet' | 'lift' | 'milk' | 'shear'): void {
    const pl = this.game.player;
    if (!this.poseDriver) {
      this.poseDriver = (rig, dt) => {
        if (this.poseT < 0) {
          // Other drivers (mine / forage actions) wrap and re-wrap the hook: never recurse through a cycle.
          if (this.poseReentry) return null;
          this.poseReentry = true;
          try {
            return this.posePrev?.(rig, dt) ?? null;
          } finally {
            this.poseReentry = false;
          }
        }
        const T = this.poseKind === 'lift' ? 1.05 : this.poseKind === 'pet' ? 0.95 : 1.0;
        this.poseT = this.poseFreeze >= 0 ? Math.min(this.poseT + dt, this.poseFreeze) : this.poseT + dt;
        const t = this.poseT;
        if (t >= T) {
          this.poseT = -1;
          pl.busy = false;
          rig.armR.scale.y = 1;
          rig.armL.scale.y = 1;
          return this.posePrev?.(rig, dt) ?? null;
        }
        if (t > 0.5 && this.poseFreeze < 0) pl.busy = false;
        const inT = this.poseKind === 'lift' ? 0.12 : 0.14;
        const e = t < inT ? 1 - Math.pow(1 - t / inT, 3) : t > T - 0.22 ? Math.pow((T - t) / 0.22, 2) * (3 - 2 * ((T - t) / 0.22)) : 1;
        if (this.poseKind === 'lift') {
          // Both arms thrown up and out in a V (cartoon-stretched past the big hat), the find held high.
          const hold = t > inT ? Math.sin((t - inT) * 5) * 0.03 : 0;
          // A cheerful "ta-da" V: arms flung up and out to the sides (outward is +z on the right arm),
          // stretched a touch so the chibi hands clear the big cheeks; the find floats over the hat.
          rig.armR.rotation.x = (-2.7 + hold) * e;
          rig.armL.rotation.x = (-2.7 - hold) * e;
          rig.armR.rotation.z = -0.12 + 1.12 * e;
          rig.armL.rotation.z = 0.12 - 1.12 * e;
          rig.armR.scale.y = 1 + 0.35 * e;
          rig.armL.scale.y = 1 + 0.35 * e;
          rig.torso.rotation.x = -0.08 * e;
          rig.head.rotation.x = -0.12 * e;
          return { sy: 1 + 0.05 * e, bob: 0.03 * e };
        }
        if (this.poseKind === 'milk' || this.poseKind === 'shear') {
          // Milking: squat low, both hands forward pumping in turn. Shearing: one hand steadies the
          // fleece, the other snips in quick little strokes.
          const milk = this.poseKind === 'milk';
          const pump = t > inT && t < T - 0.2 ? Math.sin((t - inT) * (milk ? 22 : 30)) : 0;
          rig.torso.rotation.x = (milk ? 0.55 : 0.4) * e;
          rig.head.rotation.x = -0.25 * e;
          rig.armR.rotation.x = (-1.2 + pump * (milk ? 0.22 : 0.1)) * e;
          rig.armL.rotation.x = (-1.2 - pump * (milk ? 0.22 : 0)) * e;
          rig.armR.rotation.z = (milk ? -0.05 : -0.25 + pump * 0.18) * e;
          rig.armL.rotation.z = (milk ? 0.05 : 0.3) * e;
          rig.legL.rotation.x = -0.5 * e;
          rig.legR.rotation.x = 0.35 * e;
          return { sy: 1 - (milk ? 0.2 : 0.1) * e, bob: (milk ? -0.12 : -0.05) * e };
        }
        const low = this.petLow ? 1 : 0.55;
        const pat = t > 0.14 && t < T - 0.2 ? Math.sin((t - 0.14) * 17) * 0.16 : 0;
        // Bend at the hips but keep the face up (a forward-tipped head turns the big hat into a lid).
        rig.torso.rotation.x = 0.48 * low * e;
        rig.head.rotation.x = -0.22 * low * e;
        rig.armR.rotation.x = (-1.05 - 0.25 * low + pat) * e;
        rig.armR.rotation.z = -0.12 - 0.1 * e;
        rig.armL.rotation.x = -0.35 * e;
        rig.armL.rotation.z = 0.12 + 0.18 * e;
        rig.legL.rotation.x = -0.35 * low * e;
        rig.legR.rotation.x = 0.25 * low * e;
        return { sy: 1 - 0.13 * low * e, bob: -0.07 * low * e };
      };
    }
    if (pl.actionPose !== this.poseDriver) {
      this.posePrev = pl.actionPose;
      pl.actionPose = this.poseDriver;
    }
    this.poseKind = kind;
    this.poseT = 0;
    pl.busy = true;
  }

  private petPose(a: AnimalActor): void {
    this.petLow = a.gait.top * a.scale < 0.9;
    this.faceAnimal(a);
    this.playPose('pet');
  }

  /** Turn the farmer (smoothly, any angle) towards the animal's head. */
  private faceAnimal(a: AnimalActor): void {
    const pp = this.game.player.position;
    const m = a.muzzle(this._lt2);
    const yaw = Math.atan2(m.x - pp.x, m.z - pp.z);
    (this.game.player as unknown as { targetYaw: number }).targetYaw = yaw;
  }

  private pail: THREE.Mesh | null = null;
  private harvestFx: { t: number; at: THREE.Vector3; kind: 'milk' | 'wool'; fired: boolean; item: string; actor: AnimalActor } | null = null;

  /** Milking (crouch, two-handed pumping, squirts into a pail) or shearing (snip-snip, fluff puffs). */
  private harvestPose(l: Live, kind: 'milk' | 'shear'): void {
    const a = l.actor;
    this.settleForPet(a);
    this.petLow = true;
    this.faceAnimal(a);
    this.playPose(kind);
    const side = new THREE.Vector3(Math.cos(a.heading), 0, -Math.sin(a.heading));
    const pp = this.game.player.position;
    const toFarmer = side.dot(new THREE.Vector3(pp.x - a.pos.x, 0, pp.z - a.pos.z)) > 0 ? 1 : -1;
    const at = a.pos.clone().addScaledVector(side, toFarmer * a.gait.radius * a.scale * 0.6);
    at.y = a.pos.y + (kind === 'milk' ? a.gait.top * a.scale * 0.32 : a.gait.top * a.scale * 0.62);
    if (kind === 'milk') {
      if (!this.pail) {
        const g = new THREE.CylinderGeometry(0.14, 0.11, 0.24, 16, 1, true);
        this.pail = new THREE.Mesh(g, imat('tin'));
        this.pail.castShadow = true;
        this.pail.userData.noAO = true;
        const milk = new THREE.Mesh(new THREE.CircleGeometry(0.13, 16).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0xfbf8f0, roughness: 0.3 }));
        milk.position.y = 0.06;
        this.pail.add(milk);
      }
      this.pail.position.set(at.x, a.pos.y + 0.12, at.z);
      this.pail.visible = true;
      this.props.add(this.pail);
    }
    this.harvestFx = { t: 0, at, kind: kind === 'milk' ? 'milk' : 'wool', fired: false, item: produceFor(l.rec!.species, l.rec!.variant), actor: a };
    this.game.services.audio?.play(kind === 'milk' ? 'refill' : 'scythe');
    if (l.rec?.species === 'sheep') a.wool = 0.35;
  }

  private updateHarvest(dt: number): void {
    const h = this.harvestFx;
    if (!h) return;
    h.t += dt;
    if (!h.fired && h.t > 0.12) {
      h.fired = true;
      this.pops.burst(h.at, h.kind);
    }
    if (h.t > 0.75 && h.item) {
      this.flyToBar(h.item, 0, h.at);
      h.item = '';
    }
    if (h.t > 0.95) {
      if (this.pail) this.props.remove(this.pail);
      this.harvestFx = null;
    }
  }

  // ───────────────────────────────────────────── egg lift

  private lifts: { m: THREE.Mesh; star: THREE.Mesh | null; t: number; from: THREE.Vector3; item: string; q: number; flew: boolean }[] = [];

  /** The egg hops out of its nest box into the farmer's raised hands, held overhead (+ quality star). */
  private liftEgg(e: { nest: number; item: string; q: number }, pen: PenAnchors): void {
    const n = pen.nests[e.nest];
    if (!n) return;
    const m = new THREE.Mesh(eggGeo(), eggMat(e.item));
    m.scale.setScalar(1.25);
    m.position.set(n.x, n.y + 0.14, n.z + 0.08);
    m.userData.noAO = true;
    let star: THREE.Mesh | null = null;
    if (e.q > 0) {
      star = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: starTexture(e.q), transparent: true, depthTest: false, depthWrite: false, toneMapped: false }));
      star.renderOrder = 23;
      star.visible = false;
      this.props.add(star);
    }
    this.props.add(m);
    this.lifts.push({ m, star, t: 0, from: m.position.clone(), item: e.item, q: e.q, flew: false });
    // Turn round to the camera and show it off, both hands up (the classic "look what I found" beat).
    this.game.player.setFacing('down');
    this.playPose('lift');
    this.game.services.audio?.play('pickup');
  }

  private updateLifts(dt: number): void {
    const pl = this.game.player;
    const cam = this.game.rc.camera;
    for (let i = this.lifts.length - 1; i >= 0; i--) {
      const L = this.lifts[i]!;
      L.t += this.poseFreeze >= 0 ? Math.min(dt, Math.max(0, 0.6 - L.t)) : dt;
      const t = L.t;
      const top = this._lt.copy(pl.position).setY(pl.position.y + 2.62);
      if (t < 0.22) {
        const k = t / 0.22;
        const e = 1 - Math.pow(1 - k, 3);
        L.m.position.lerpVectors(L.from, top, e);
        L.m.position.y += Math.sin(k * Math.PI) * 0.45;
      } else L.m.position.copy(top);
      L.m.rotation.set(0.25, t * 2.2, 0.15);
      const pop = t < 0.22 ? 1.25 : t < 0.34 ? 1.25 + Math.sin(((t - 0.22) / 0.12) * Math.PI) * 0.35 : 1.25;
      L.m.scale.setScalar((t > 0.85 ? Math.max(0, 1 - (t - 0.85) / 0.15) : 1) * pop * 1.75);
      if (L.star) {
        L.star.visible = t > 0.24 && t < 0.95;
        L.star.position.copy(top).add(this._lt2.set(0.3, 0.22, 0));
        L.star.quaternion.copy(cam.quaternion);
        const s = 0.42 * (t < 0.34 ? Math.min(1, (t - 0.24) / 0.1) * 1.2 : 1);
        L.star.scale.setScalar(Math.max(0.01, s));
      }
      if (t > 0.85 && !L.flew) {
        L.flew = true;
        this.flyToBar(L.item, L.q, L.m.position);
      }
      if (t >= 1) {
        this.props.remove(L.m);
        if (L.star) {
          this.props.remove(L.star);
          (L.star.material as THREE.Material).dispose();
          L.star.geometry.dispose();
        }
        this.lifts.splice(i, 1);
      }
    }
  }

  private _lt = new THREE.Vector3();
  private _lt2 = new THREE.Vector3();

  private flyToBar(itemId: string, quality: number, pos: THREE.Vector3): void {
    const inv = this.game.services.inventory;
    const slot = inv ? inv.slots.findIndex((s) => s?.id === itemId) : -1;
    const v = pos.clone().project(this.game.rc.camera);
    const el = this.game.rc.renderer.domElement.getBoundingClientRect();
    try {
      flyItemToToolbar(this.game.opts.uiRoot, itemId, { x: el.left + (v.x * 0.5 + 0.5) * el.width, y: el.top + (-v.y * 0.5 + 0.5) * el.height }, slot, quality, { duration: 460, bounce: 1.15 });
    } catch {
      /* HUD not mounted (tests) */
    }
  }

  // ───────────────────────────────────────────── hat fade

  private _actors: AnimalActor[] = [];
  private _ht = new THREE.Vector3();
  private hatMats: THREE.Material[] | null = null;
  private hatK = 1;
  private _hp = new THREE.Vector3();
  private _hq = new THREE.Vector3();

  /**
   * The farmer's straw hat is big from the high camera: dither it down (alpha-hashed, no sorting
   * issues) whenever the animal being petted / a heart pop sits behind it on screen.
   */
  private fadeHat(dt: number, game: Game): void {
    const hat = (game.player as unknown as { rig?: { hat?: THREE.Object3D } }).rig?.hat;
    if (!hat) return;
    if (!this.hatMats) {
      this.hatMats = [];
      hat.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        const list = (Array.isArray(m.material) ? m.material : [m.material]).map((mm) => {
          // Plain alpha blend (not alphaHash): hashed dithering read as noisy stripes on the brim and
          // leaked into the shadow map. The hat is one small convex mesh, so sorting is a non-issue.
          const c = mm.clone();
          c.onBeforeCompile = mm.onBeforeCompile;
          c.customProgramCacheKey = mm.customProgramCacheKey;
          this.hatMats!.push(c);
          return c;
        });
        m.material = Array.isArray(m.material) ? list : list[0]!;
      });
    }
    let want = 1;
    if (this.live.length) {
      const cam = game.rc.camera;
      hat.getWorldPosition(this._hp);
      const camD = this._hp.distanceTo(cam.position);
      const c = this._hq.copy(this._hp).project(cam);
      const cx = c.x;
      const cy = c.y;
      // Hat radius on screen (NDC y units, ~0.42 m brim).
      const r = (0.42 / (camD * Math.tan(THREE.MathUtils.degToRad((cam as THREE.PerspectiveCamera).fov / 2)))) * 1.15;
      const asp = (cam as THREE.PerspectiveCamera).aspect;
      const behind = (p: THREE.Vector3): boolean => {
        if (p.distanceTo(cam.position) < camD + 0.05) return false;
        const q = this._hq.copy(p).project(cam);
        return Math.hypot((q.x - cx) * asp, q.y - cy) < r;
      };
      const pp = game.player.position;
      // (Hearts and name tags draw over everything, so only animal bodies hidden under the brim count.)
      {
        for (const l of this.live) {
          const a = l.actor;
          if (Math.hypot(a.pos.x - pp.x, a.pos.z - pp.z) > 2.2) continue;
          if (behind(a.topPoint(this._ht)) || behind(this._ht.copy(a.pos).setY(a.pos.y + a.gait.top * a.scale * 0.5))) {
            want = 0.35;
            break;
          }
        }
      }
    }
    this.hatK += (want - this.hatK) * (1 - Math.exp(-10 * dt));
    // Blend only while fading (the rig's vertex colours carry an alpha channel: an always-transparent
    // hat read as see-through straw).
    const fading = this.hatK < 0.985;
    for (const m of this.hatMats) {
      m.opacity = fading ? this.hatK : 1;
      m.transparent = fading;
      m.depthWrite = !fading;
    }
  }

  // ───────────────────────────────────────────── demos

  private stageDemo(name: string, showcase: string[]): void {
    this.demoHearts = 0;
    this.demoPet = null;
    this.poseFreeze = -1;
    this.poseT = -1;
    if (!showcase.includes('animals')) return;
    const params = new URLSearchParams(location.search);
    const st = AnimalSystem.fresh();
    this.st = st;
    const petKind = params.get('pet') === 'cat' ? 'cat' : 'dog';
    st.pet = { species: petKind, variant: Number(params.get('petVariant') ?? 0) % 2, name: PET_NAMES[petKind], friendship: 700, bowl: true, petted: false };
    const coop: [Livestock, number, number][] = [['chicken', 0, 820], ['chicken', 1, 640], ['duck', 1, 720], ['chicken', 0, 400], ['duck', 0, 560], ['chicken', 1, 900]];
    const barn: [Livestock, number, number][] = [['cow', 0, 800], ['cow', 1, 620], ['sheep', 0, 700], ['goat', 1, 540], ['pig', 0, 880], ['sheep', 1, 450]];
    const gallery = name === 'animals-gallery';
    if (gallery) {
      // Every species and coat side by side (the building caps don't apply to a line-up).
      coop.splice(0, coop.length, ['chicken', 0, 800], ['chicken', 1, 800], ['duck', 0, 800], ['duck', 1, 800]);
      barn.splice(0, barn.length, ['cow', 0, 800], ['cow', 1, 800], ['goat', 0, 800], ['goat', 1, 800], ['sheep', 0, 800], ['sheep', 1, 800], ['pig', 0, 800], ['pig', 1, 800]);
    }
    for (const [s, v, f] of [...coop, ...barn]) this.add(s, v, undefined, f).mood = 230;
    for (const a of st.animals) if (a.species === 'sheep') a.ready = true;
    // &petted=1 pre-marks today's petting (default: nobody petted yet, so a critic's pet shows the +friendship).
    if (params.get('petted') === '1') for (const a of st.animals) a.petted = true;
    st.eggs = [
      { nest: 0, item: 'egg', q: 1 },
      { nest: 1, item: 'brownEgg', q: 0 },
      { nest: 3, item: 'duckEgg', q: 2 },
      { nest: 4, item: 'egg', q: 0 },
    ];
    st.hay.coop = [true, true, true, false, false, false];
    // (Only two of the barn munching: the rest stand chin-up over their mangers, faces to camera.)
    st.hay.barn = [false, false, false, true, false, true];
    if (name === 'animals-pasture') st.truffles = [{ x: 49.5, z: 41.5, q: 2 }, { x: 43.5, z: 42.5, q: 1 }];
    // Interior showcases keep the pop doors shut so the flock is home.
    if (this.pen()) st.doors = { coop: false, barn: false };
    this.syncDoors();
    this.respawn();
    this.touch();
    // Stage: a few animals already at the trough, one right by the player for the petting hearts.
    const pen = this.pen();
    const night = this.isNight();
    if (pen && night) {
      // Night showcase: everyone tucked into the straw; no petting hearts.
      this.demoHearts = 0;
      this.holdHay();
      return;
    }
    if (pen?.kind === 'barn') {
      // Everyone up at the front of their stall looking out over the manger; the fed ones munching.
      for (const l of this.live) {
        if (!l.rec || !l.actor.feedSpot) continue;
        const a = l.actor;
        a.hungry = !!st.hay.barn[l.slot];
        a.place(a.feedSpot!.x + (Math.random() - 0.5) * 0.2, a.feedSpot!.z - (a.hungry ? 0 : 0.15), (Math.random() - 0.5) * 0.3);
        a.settle();
      }
    } else if (pen) {
      const pp = this.game.player.position;
      this.live.forEach((l, i) => {
        if (!l.rec) return;
        const a = l.actor;
        if (st.hay[pen.kind][l.slot] && i % 2 === 0) {
          a.hungry = true;
          a.place(a.feedSpot!.x, a.feedSpot!.z, a.feedHeading);
        }
      });
      // The petted bird stands in front of the farmer (towards the camera when facing down) so the
      // farmer never hides it or its heart.
      const free = this.live.find((l) => l.rec && !st.hay[pen.kind][l.slot] && l.rec.species === 'chicken') ?? this.live.find((l) => l.rec && !st.hay[pen.kind][l.slot]);
      const f = this.game.player.facing;
      const [fx, fz] = f === 'down' ? [0, 1] : f === 'up' ? [0, -1] : f === 'left' ? [-1, 0] : [1, 0];
      // (a little to the side too, so its heart doesn't sit on the farmer's face)
      const [sxo, szo] = fx === 0 ? [0.95, fz * 0.4] : [fx * 0.95, 0.4];
      if (free) {
        const a = free.actor;
        const d = Math.hypot(sxo, szo);
        const want = a.gait.reach * a.scale + 0.62;
        const x = pp.x + (sxo / d) * want;
        const z = pp.z + (szo / d) * want;
        a.area = { x0: x - 0.05, z0: z - 0.05, x1: x + 0.05, z1: z + 0.05 };
        a.curious = false;
        a.place(x, z, Math.atan2(-sxo, -szo));
        this.demoPet = free;
      }
      // Coop life: a hen wallowing in the dust bath, another dozing on the roost bar in the sun.
      if (pen.kind === 'coop') {
        const idle = this.live.filter((l) => l.rec && l !== free && !l.actor.hungry && l.rec.species === 'chicken');
        const bath = idle[0];
        if (bath) {
          bath.actor.area = { x0: 2.65, z0: 2.05, x1: 2.85, z1: 2.25 };
          bath.actor.curious = false;
          bath.actor.place(2.75, 2.15, 0.9);
          bath.actor.settle();
        }
        const roost = idle[1] ?? this.live.find((l) => l.rec && l !== free && l !== bath && !l.actor.hungry);
        const bar = pen.perches?.[1];
        if (roost && bar) {
          roost.actor.bedSpot = bar;
          roost.actor.perched = true;
          roost.actor.confine = true;
          roost.actor.calm = true;
          roost.actor.curious = false;
          roost.actor.area = { x0: bar.x, z0: bar.z, x1: bar.x, z1: bar.z };
          roost.actor.place(bar.x, bar.z, 0.3);
          roost.actor.settle();
        }
      }
      if (showcase.includes('eggs')) {
        // Morning round: a gold-star egg lifted overhead from the lower-left nest box, held for the shot.
        this.demoHearts = 0;
        st.eggs = [
          { nest: 0, item: 'egg', q: 1 },
          { nest: 1, item: 'brownEgg', q: 0 },
          { nest: 2, item: 'egg', q: 2 },
          { nest: 5, item: 'duckEgg', q: 1 },
          { nest: 3, item: 'egg', q: 0 },
          { nest: 4, item: 'brownEgg', q: 1 },
        ];
        this.refreshProps();
        const nest = Number(params.get('nest') ?? 2) % 6;
        const e = st.eggs.find((q) => q.nest === nest) ?? st.eggs[0]!;
        this.poseFreeze = 0.5;
        this.liftEgg(e, pen);
        this.apply(null, { kind: 'eggs', nest: e.nest });
        this.holdHay();
        return;
      }
    } else if (this.mapId === 'farm') {
      // Hand-placed pasture composition (world coords) so the framing reads.
      // (Every spot keeps a body length clear of its neighbours and of the trough / hay rack; the goat
      // stands front-right of the farmer so the petting reads with the farmer turned 3/4 to camera.)
      const spots: Record<string, [number, number, number][]> = {
        cow: showcase.includes('pet-close') ? [[48.2, 38.7, -0.5], [50.4, 41.6, 0.6]] : [[44.7, 39.3, -0.5], [48.5, 41.5, 0.6]],
        sheep: [[46.9, 38.1, 1.2], [48.9, 38.3, -0.9]],
        goat: [[41.1, 42.35, Math.atan2(-0.8, -0.85)]],
        pig: [[46.2, 42.5, 3.8]],
        chicken: [[40.1, 38.4, 2.4], [40.9, 39.3, -1.0], [38.0, 39.9, 0.5], [42.1, 38.0, 1.9]],
        duck: [[43.2, 41.9, 1.4], [44.4, 42.3, -2.5]],
      };
      if (gallery) {
        const row: Record<string, [number, number, number][]> = {
          cow: [[38.9, 39.2, 0.4], [41.0, 39.2, 0.4]],
          goat: [[42.9, 39.4, 0.4], [44.3, 39.4, 0.4]],
          sheep: [[45.7, 39.4, 0.4], [47.1, 39.4, 0.4]],
          pig: [[48.5, 39.4, 0.4], [49.9, 39.4, 0.4]],
          chicken: [[41.6, 40.9, 0.45], [42.5, 40.9, 0.45]],
          duck: [[43.5, 40.9, 0.45], [44.4, 40.9, 0.45]],
        };
        const n: Record<string, number> = {};
        for (const l of this.live) {
          const k = l.rec?.species ?? 'pet';
          const s = k === 'pet' ? ([46.2, 41.0, 0.5] as [number, number, number]) : row[k]?.[(n[k] = (n[k] ?? -1) + 1)];
          if (!s) continue;
          l.actor.area = { x0: s[0], z0: s[1], x1: s[0], z1: s[1] };
          l.actor.curious = false;
          l.actor.sitter = false;
          l.actor.calm = true;
          l.actor.place(s[0], s[1], s[2]);
          l.actor.settle();
        }
        this.demoHearts = 0;
        this.holdHay();
        return;
      }
      const used: Record<string, number> = {};
      for (const l of this.live) {
        if (!l.rec) continue;
        const k = l.rec.species;
        const s = spots[k]?.[used[k] = (used[k] ?? -1) + 1];
        // Staged stills: nobody wanders up to the farmer mid-shot.
        l.actor.curious = false;
        if (s) {
          l.actor.place(s[0], s[1], s[2]);
          l.actor.settle();
          // The farmer's petting partner holds its spot.
          if (k === 'goat' && !showcase.includes('pet-close')) {
            l.actor.area = { x0: s[0] - 0.05, z0: s[1] - 0.05, x1: s[0] + 0.05, z1: s[1] + 0.05 };
            this.demoPet = l;
          }
        }
      }
      if (showcase.includes('pet-close')) {
        // Petting close-up: a sheep right in front of the farmer, turned to them.
        const pp = this.game.player.position;
        const sheep = this.live.find((l) => l.rec?.species === 'sheep');
        if (sheep) {
          // Front-left of the farmer (towards the camera), muzzle at the farmer's hand.
          const a = sheep.actor;
          const dx = -0.88;
          const dz = 0.5;
          const dl = Math.hypot(dx, dz);
          const d = a.gait.reach * a.scale + 0.62;
          const x = pp.x + (dx / dl) * d;
          const z = pp.z + (dz / dl) * d;
          a.area = { x0: x - 0.05, z0: z - 0.05, x1: x + 0.05, z1: z + 0.05 };
          a.curious = false;
          a.place(x, z, Math.atan2(-dx, -dz));
          a.settle();
          this.demoPet = sheep;
        }
      }
      const pet = this.live.find((l) => !l.rec);
      if (pet && name === 'animals-pasture') {
        // Sits in its own clearing between the cow and the ducks (never on / behind a big animal).
        pet.actor.area = { x0: 42.6, z0: 40.1, x1: 43.2, z1: 40.7 };
        pet.actor.blockers = PASTURE_PROPS;
        pet.actor.place(42.9, 40.4, 0.4);
      } else if (pet) {
        // Yard shot: sitting by the bowl, looking up at the farmer.
        pet.actor.area = { x0: SITES.bowl.x - 1.2, z0: SITES.bowl.z + 0.2, x1: SITES.bowl.x - 0.2, z1: SITES.bowl.z + 1.0 };
        pet.actor.place(SITES.bowl.x - 0.6, SITES.bowl.z + 0.5, 1.2);
      }
    }
    this.demoHearts = params.get('hearts') === '0' ? 0 : 1;
    this.demoHeartT = 0.2;
    this.holdHay();
  }

  /** Demos: hay in hand (a toolbar slot), so no tile cursor sits under the shot and feeding is one click. */
  private holdHay(): void {
    const inv = this.game.services.inventory;
    if (!inv) return;
    let slot = inv.slots.slice(0, 10).findIndex((s) => !s || s.id === 'hay');
    if (slot < 0) slot = 9;
    inv.setSlot(slot, { id: 'hay', qty: 24 });
    this.game.events.emit('toolbar:select', { slot });
  }

  // ───────────────────────────────────────────── save

  save(): unknown {
    return this.st;
  }

  /** Tell the farm models where the pop doors stand (after a load / snapshot / demo). */
  private syncDoors(): void {
    for (const home of ['coop', 'barn'] as const) this.game.events.emit('animals:door', { home, open: !!this.st.doors[home] });
  }

  load(data: unknown): void {
    this.merge(data);
    this.syncDoors();
    if (this.mapId) this.respawn();
    this.touch();
  }

  /** Replace the state from saved / host JSON, filling anything missing from a fresh farm. */
  private merge(data: unknown): void {
    const d = data as Partial<State> | null;
    const f = AnimalSystem.fresh();
    this.st = { ...f, ...(d ?? {}), hay: { ...f.hay, ...(d?.hay ?? {}) }, pet: { ...f.pet, ...(d?.pet ?? {}) }, doors: { ...f.doors, ...(d?.doors ?? {}) } };
  }
}

// ───────────────────────────────────────────── small shared props

let _hay: THREE.BufferGeometry | null = null;
function hayGeo(): THREE.BufferGeometry {
  if (!_hay) {
    const g = prep(lumpySphere(0.2, 2, 0.35, new Rng('hay-portion')), 0xfff0c0);
    g.scale(1.45, 0.8, 0.85);
    _hay = g;
  }
  return _hay;
}

let _egg: THREE.BufferGeometry | null = null;
function eggGeo(): THREE.BufferGeometry {
  if (!_egg) {
    const pts: THREE.Vector2[] = [];
    for (let i = 0; i <= 12; i++) {
      const a = (i / 12) * Math.PI;
      const r = Math.sin(a) * 0.063 * (1 - 0.18 * Math.cos(a));
      pts.push(new THREE.Vector2(r, -Math.cos(a) * 0.084));
    }
    _egg = new THREE.LatheGeometry(pts, 14);
  }
  return _egg;
}

const eggMats = new Map<string, THREE.MeshStandardMaterial>();
function eggMat(item: string): THREE.MeshStandardMaterial {
  let m = eggMats.get(item);
  if (!m) {
    const col = item === 'brownEgg' ? 0xd99a62 : item === 'duckEgg' ? 0xd4ecdf : item === 'duckFeather' ? 0x3a8a5a : 0xfbf5ea;
    // A soft self-lit rim (fresnel) so eggs read in the shadowed nest boxes from the high camera.
    m = new THREE.MeshStandardMaterial({ color: col, roughness: 0.38, emissive: new THREE.Color(col).multiplyScalar(0.12) });
    m.onBeforeCompile = (sh) => {
      sh.fragmentShader = sh.fragmentShader.replace(
        '#include <emissivemap_fragment>',
        '#include <emissivemap_fragment>\n  float rimK = pow(1.0 - clamp(dot(normalize(vNormal), normalize(vViewPosition)), 0.0, 1.0), 2.2);\n  totalEmissiveRadiance += diffuseColor.rgb * rimK * 0.55;',
      );
    };
    eggMats.set(item, m);
  }
  return m;
}

let _tru: THREE.BufferGeometry | null = null;
let _truM: THREE.MeshStandardMaterial | null = null;
function truffleGeo(): THREE.BufferGeometry {
  if (!_tru) _tru = lumpySphere(0.09, 2, 0.4, new Rng('truffle'));
  return _tru;
}
function truffleMat(): THREE.MeshStandardMaterial {
  if (!_truM) _truM = new THREE.MeshStandardMaterial({ color: 0x3a2a22, roughness: 0.75 });
  return _truM;
}

let _plaque: THREE.PlaneGeometry | null = null;
function plaqueGeo(): THREE.PlaneGeometry {
  if (!_plaque) _plaque = new THREE.PlaneGeometry(0.88, 0.4);
  return _plaque;
}

const nameMats = new Map<string, THREE.MeshStandardMaterial>();
/** Painted name card: dark lettering on a cream plaque, or chalk on a slate board (one name per line). */
function nameMaterial(text: string, style: 'plaque' | 'chalk'): THREE.MeshStandardMaterial {
  const key = `${style}:${text}`;
  let m = nameMats.get(key);
  if (m) return m;
  const lines = text.split('\n');
  const W = style === 'plaque' ? 352 : 256;
  const H = style === 'plaque' ? 160 : 160;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d')!;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  if (style === 'plaque') {
    // Dark oak frame, cream painted board, hand-lettered name, a row of hearts (friendship).
    g.fillStyle = '#5a3a24';
    g.beginPath();
    g.roundRect(0, 0, W, H, 22);
    g.fill();
    g.fillStyle = '#7a5234';
    g.beginPath();
    g.roundRect(6, 6, W - 12, H - 12, 18);
    g.fill();
    const pg = g.createLinearGradient(0, 16, 0, H - 16);
    pg.addColorStop(0, '#fbf1d8');
    pg.addColorStop(1, '#ecd9ae');
    g.fillStyle = pg;
    g.beginPath();
    g.roundRect(16, 16, W - 32, H - 32, 12);
    g.fill();
    for (const [nx, ny] of [[26, 26], [W - 26, 26], [26, H - 26], [W - 26, H - 26]]) {
      g.fillStyle = '#3a2618';
      g.beginPath();
      g.arc(nx!, ny!, 5, 0, Math.PI * 2);
      g.fill();
    }
    g.font = '700 58px Fredoka, Nunito, sans-serif';
    g.fillStyle = '#4a2a14';
    g.fillText(lines[0] ?? '', W / 2, 64);
    const hv = Number(lines[1] ?? 0);
    for (let i = 0; i < 5; i++) {
      const on = hv >= i + 1 ? 1 : hv >= i + 0.5 ? 0.5 : 0;
      const x = W / 2 + (i - 2) * 38;
      const y = 118;
      const heart = (fill: string): void => {
        g.beginPath();
        g.moveTo(x, y + 11);
        g.bezierCurveTo(x - 18, y - 1, x - 16, y - 17, x, y - 8);
        g.bezierCurveTo(x + 16, y - 17, x + 18, y - 1, x, y + 11);
        g.closePath();
        g.fillStyle = fill;
        g.fill();
        g.lineWidth = 3;
        g.strokeStyle = on ? '#7a1830' : '#a88a64';
        g.stroke();
      };
      heart(on ? '#e0385a' : '#dcc8a4');
      if (on === 0.5) {
        g.save();
        g.beginPath();
        g.rect(x, y - 20, 20, 40);
        g.clip();
        heart('#dcc8a4');
        g.restore();
      }
    }
  } else {
    g.fillStyle = '#2e3a34';
    g.fillRect(0, 0, W, H);
    g.fillStyle = 'rgba(235,235,225,.9)';
    const n = lines.length;
    const cols = n > 3 ? 2 : 1;
    const rows = Math.ceil(n / cols);
    g.font = `500 ${rows > 2 ? 26 : 30}px Fredoka, Nunito, sans-serif`;
    lines.forEach((ln, i) => {
      const col = Math.floor(i / rows);
      const row = i % rows;
      g.fillText(ln, (W / cols) * (col + 0.5), (H / (rows + 0.4)) * (row + 0.7));
    });
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  m = new THREE.MeshStandardMaterial({ map: t, roughness: style === 'plaque' ? 0.7 : 0.95 });
  nameMats.set(key, m);
  return m;
}

const starTex = new Map<number, THREE.Texture>();
/** Quality star (silver / gold / iridium) for the egg lift. */
function starTexture(q: number): THREE.Texture {
  let t = starTex.get(q);
  if (t) return t;
  const S = 96;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d')!;
  const [a, b, o] = q === 1 ? ['#ffffff', '#b8c4d0', '#5e6a78'] : q === 2 ? ['#fff6b0', '#f5c542', '#9a6a14'] : ['#f0d8ff', '#b56adf', '#5a2a8a'];
  g.beginPath();
  for (let i = 0; i < 10; i++) {
    const r = i % 2 ? 18 : 40;
    const an = -Math.PI / 2 + (i * Math.PI) / 5;
    g.lineTo(S / 2 + Math.cos(an) * r, S / 2 + 4 + Math.sin(an) * r);
  }
  g.closePath();
  const gr = g.createLinearGradient(0, 8, 0, S - 8);
  gr.addColorStop(0, a);
  gr.addColorStop(1, b);
  g.fillStyle = gr;
  g.lineJoin = 'round';
  g.lineWidth = 7;
  g.strokeStyle = o;
  g.stroke();
  g.fill();
  t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  starTex.set(q, t);
  return t;
}
