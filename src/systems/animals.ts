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
 *   demos       showcase 'animals' stocks a full coop + barn and stages petting hearts (&hearts=0 off,
 *               &pet=dog|cat picks the pet).
 */
import * as THREE from 'three';
import type { System } from '../core/system';
import type { Game } from '../core/game';
import { AnimalActor, AnimalPops, type Species } from '../entities/animals';
import { animalVoice } from '../entities/animals-voice';
import { LIVESTOCK, ANIMAL_NAMES, PET_NAMES, produceFor, type Livestock, type AnimalHome } from '../entities/animals-data';
import { isInterior } from '../world/interiors/lighting';
import type { PenAnchors } from '../world/interiors/pen';
import { imat } from '../world/interiors/kit';
import { lumpySphere, prep } from '../world/geom';
import { SITES } from '../world/buildings/farm';
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
  /** Milk / wool waiting to be collected (by hand). */
  ready: boolean;
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
  eggs: { nest: number; item: string; q: number }[];
  truffles: { x: number; z: number; q: number }[];
  pet: PetRec;
  nextId: number;
  /** Pop doors: open = the flock goes out to the pasture on fine days. */
  doors: Record<AnimalHome, boolean>;
}

export interface AnimalsApi {
  roster(): readonly AnimalRec[];
  count(home: AnimalHome): number;
  capacity(home: AnimalHome): number;
  /** Buy an animal (spends gold). Returns an error message or null. */
  buy(species: Livestock, name?: string): string | null;
  pet(): { species: 'dog' | 'cat'; name: string; friendship: number };
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
  }
}

const CAP = 6;
/** Presentation scale per species (chibi models read small next to the farmer otherwise). */
const SCALE: Record<Species, number> = { chicken: 1.12, duck: 1.12, cow: 1.22, goat: 1.12, sheep: 1.14, pig: 1.12, dog: 1.38, cat: 1.3 };
const QUALITY_NAME = ['', 'silver', 'gold', 'iridium'];

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
  private checkT = 0;
  private rng = new Rng('animals');

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
    game.events.on('day:start', () => this.newDay());
    game.events.on('time:hour', ({ hour }) => {
      // A fine day: everyone grazes.
      if (hour === 12 && this.grazing()) for (const a of this.st.animals) a.fed = true;
    });
    game.events.on('building:built', () => {
      if (this.mapId === 'farm') this.respawn();
    });
    // Demos set the hour right after staging: stage once that has settled.
    game.events.on('demo:stage', ({ name, showcase }) => {
      this.demoHearts = 0;
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
    if (!eco || !eco.spend(info.price, `animal:${species}`)) return `Needs ${info.price.toLocaleString()}g.`;
    const rec = this.add(species, Math.floor(this.rng.next() * info.variants), name);
    this.game.events.emit('animal:bought', { id: rec.id, species, name: rec.name });
    if (this.mapId === info.home || this.mapId === 'farm') this.respawn();
    return null;
  }

  pet(): { species: 'dog' | 'cat'; name: string; friendship: number } {
    const p = this.st.pet;
    return { species: p.species, name: p.name, friendship: p.friendship };
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

  private newDay(): void {
    const eggs = this.st.eggs;
    const made = new Map<string, number>();
    const homes = { coop: this.st.animals.filter((a) => a.home === 'coop'), barn: this.st.animals.filter((a) => a.home === 'barn') };
    for (const a of this.st.animals) {
      const slot = homes[a.home].indexOf(a);
      // Hay left in the trough overnight feeds whoever didn't eat.
      if (!a.fed && this.st.hay[a.home][slot]) {
        this.st.hay[a.home][slot] = false;
        a.fed = true;
      }
      a.mood = THREE.MathUtils.clamp(a.mood + (a.fed ? 30 : -60) + (a.petted ? 20 : -10), 0, 255);
      if (!a.petted) a.friendship = Math.max(0, a.friendship - 8);
      if (!a.fed) a.friendship = Math.max(0, a.friendship - 20);
      const info = LIVESTOCK[a.species];
      if (a.fed) {
        a.days++;
        if (a.days >= info.every) {
          a.days = 0;
          const q = this.quality(a);
          if (info.byHand) a.ready = true;
          else if (info.home === 'coop') {
            const free = [0, 1, 2, 3, 4, 5].filter((n) => !eggs.some((e) => e.nest === n));
            if (free.length) {
              let item = produceFor(a.species, a.variant);
              if (a.species === 'duck' && a.mood > 200 && a.friendship > 600 && this.rng.next() < 0.3) item = 'duckFeather';
              eggs.push({ nest: free[0]!, item, q });
              made.set(item, (made.get(item) ?? 0) + 1);
            }
          } else if (a.species === 'pig' && this.grazing()) this.digTruffles(q);
        }
      }
      a.fed = false;
      a.petted = false;
    }
    const pet = this.st.pet;
    if (pet.bowl) pet.friendship = Math.min(1000, pet.friendship + 6);
    pet.bowl = this.game.calendar.weather === 'rain' || this.game.calendar.weather === 'storm';
    pet.petted = false;
    this.refreshProps();
    if (this.mapId) this.respawn();
    const eggN = [...made.values()].reduce((a, b) => a + b, 0);
    if (eggN) this.toast(`The coop has <b>${eggN}</b> fresh egg${eggN > 1 ? 's' : ''} this morning`, [...made.keys()][0]);
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
    this.respawn();
  }

  private clearActors(): void {
    for (const l of this.live) {
      this.group.remove(l.actor.root);
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
      mine.forEach((rec, i) => {
        if (out) return;
        const l = this.spawn(rec, rec.species, rec.variant, i);
        const s = pen.slots[i % pen.slots.length]!;
        const a = l.actor;
        a.area = pen.area;
        a.feedSpot = s.feed;
        a.feedHeading = s.feedHeading;
        a.bedSpot = s.bed;
        a.sleeping = night;
        const p = night ? s.bed : this.randomIn(pen.area, a);
        a.place(p.x, p.z, night ? Math.PI * (0.6 + Math.random() * 0.8) : Math.random() * Math.PI * 2);
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
    }
  }

  private setupPasture(a: AnimalActor): void {
    const p = this.game.services.buildings!.pasture();
    a.area = { x0: p.x0 + 0.9, z0: p.z0 + 1.0, x1: p.x1 - 0.9, z1: p.z1 - 0.9 };
    a.grazes = true;
    a.sleeping = false;
  }

  private spawnPet(indoors: boolean): void {
    const pet = this.st.pet;
    const l = this.spawn(null, pet.species, pet.variant, -1);
    const a = l.actor;
    a.sitter = true;
    if (indoors) {
      // Curled up on the braided rug in front of the hearth.
      a.area = { x0: 5.2, z0: 2.0, x1: 7.8, z1: 3.4 };
      a.sleeping = true;
      a.bedSpot = new THREE.Vector3(6.2, 0, 2.15);
      a.place(6.2, 2.15, 0.9);
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
    for (let i = 0; i < 30; i++) {
      const x = r.x0 + Math.random() * (r.x1 - r.x0);
      const z = r.z0 + Math.random() * (r.z1 - r.z0);
      if (!a.walkable(x, z)) continue;
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
      if (pen.kind === 'coop') {
        for (const e of this.st.eggs) {
          const n = pen.nests[e.nest];
          if (!n) continue;
          const m = new THREE.Mesh(eggGeo(), eggMat(e.item));
          m.position.set(n.x + ((e.nest * 37) % 5) * 0.03 - 0.06, n.y + 0.13, n.z + 0.08);
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
    this.st.pet.bowl = true;
    this.syncBowl();
    this.game.services.audio?.play('refill');
    this.toast(`You filled ${this.st.pet.name}'s water bowl`, undefined, 'info');
  }

  private interact(x: number, z: number): void {
    const cx = x + 0.5;
    const cz = z + 0.5;
    const pen = this.pen();
    if (pen) {
      const t = pen.trough;
      if (x >= t.x0 && x <= t.x1 && z >= t.z0 && z <= t.z1 && this.feed(pen)) return;
      if (pen.kind === 'coop' && z <= 0 && x <= 2 && this.collectEggs()) return;
    }
    if (this.mapId === 'farm') {
      if (this.isBowl(x, z)) {
        this.fillBowl();
        return;
      }
      const ti = this.st.truffles.findIndex((tr) => Math.floor(tr.x) === x && Math.floor(tr.z) === z);
      if (ti >= 0) {
        const tr = this.st.truffles.splice(ti, 1)[0]!;
        this.give('truffle', tr.q, -1, 'pig');
        this.refreshProps();
        return;
      }
    }
    // Nearest animal to the faced tile (or right in front of the player).
    const pp = this.game.player.position;
    let best: Live | null = null;
    let bd = Infinity;
    for (const l of this.live) {
      if (l.leaving) continue;
      const a = l.actor;
      const d = Math.min(Math.hypot(a.pos.x - cx, a.pos.z - cz), Math.hypot(a.pos.x - pp.x, a.pos.z - pp.z) + 0.25);
      if (d < a.gait.radius + 0.75 && d < bd) {
        bd = d;
        best = l;
      }
    }
    if (best) this.petActor(best);
  }

  private petActor(l: Live, quiet = false): void {
    const a = l.actor;
    a.pet();
    this.pops.heart(a.topPoint());
    if (!quiet) this.voice(a.species, a.species === 'chicken' || a.species === 'duck' ? 1.1 : 1);
    if (quiet) return;
    this.game.services.audio?.play('heart');
    if (!l.rec) {
      const p = this.st.pet;
      if (!p.petted) {
        p.petted = true;
        p.friendship = Math.min(1000, p.friendship + 12);
      }
      return;
    }
    const r = l.rec;
    if (r.ready) {
      r.ready = false;
      const item = produceFor(r.species, r.variant);
      this.give(item, this.quality(r), r.id, r.species);
      if (r.species === 'sheep') a.wool = 0.35;
    }
    if (!r.petted) {
      r.petted = true;
      r.friendship = Math.min(1000, r.friendship + 15);
      r.mood = Math.min(255, r.mood + 20);
    }
    this.game.events.emit('animal:petted', { id: r.id, species: r.species, name: r.name, friendship: r.friendship });
  }

  private give(itemId: string, q: number, id: number, species: string): void {
    this.game.events.emit('item:give', { itemId, qty: 1, quality: q });
    this.game.events.emit('animal:produce', { id, species, itemId, quality: q });
    this.game.services.audio?.play('pickup');
    if (q > 0) this.toast(`A <b>${QUALITY_NAME[q]}</b>-star find!`, itemId, 'good');
  }

  private feed(pen: PenAnchors): boolean {
    const hay = this.st.hay[pen.kind];
    const inv = this.game.services.inventory;
    const want = Math.max(1, this.count(pen.kind));
    let placed = 0;
    for (let i = 0; i < Math.min(want, hay.length); i++) {
      if (hay[i]) continue;
      if (!inv || !inv.remove('hay', 1)) break;
      hay[i] = true;
      placed++;
    }
    if (!placed) {
      if (hay.slice(0, want).every(Boolean)) this.toast('The trough is already full', 'hay', 'info');
      else this.toast('You need <b>hay</b> — the carpenter’s board sells it', 'hay', 'bad');
      return true;
    }
    this.game.services.audio?.play('place');
    this.toast(`Filled the trough with <b>${placed}</b> hay`, 'hay', 'info');
    this.refreshProps();
    return true;
  }

  private collectEggs(): boolean {
    if (!this.st.eggs.length) return false;
    for (const e of this.st.eggs) this.give(e.item, e.q, -1, 'chicken');
    this.st.eggs = [];
    this.refreshProps();
    return true;
  }

  // ───────────────────────────────────────────── per frame

  fixedUpdate(dt: number, game: Game): void {
    this.checkT -= dt;
    if (this.checkT > 0) return;
    this.checkT = 0.5;
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
    const actors = this.live.map((l) => l.actor);
    for (const l of this.live) {
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
          l.rec.fed = true;
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
        const near = [...this.live].sort((a, b) => a.actor.pos.distanceTo(pp) - b.actor.pos.distanceTo(pp))[0];
        if (near) this.petActor(near, true);
      }
    }
    this.pops.update(dt, game.rc.camera);
  }

  // ───────────────────────────────────────────── demos

  private stageDemo(name: string, showcase: string[]): void {
    this.demoHearts = 0;
    if (!showcase.includes('animals')) return;
    const params = new URLSearchParams(location.search);
    const st = AnimalSystem.fresh();
    this.st = st;
    const petKind = params.get('pet') === 'cat' ? 'cat' : 'dog';
    st.pet = { species: petKind, variant: Number(params.get('petVariant') ?? 0) % 2, name: PET_NAMES[petKind], friendship: 700, bowl: true, petted: false };
    const coop: [Livestock, number, number][] = [['chicken', 0, 820], ['chicken', 1, 640], ['duck', 1, 720], ['chicken', 0, 400], ['duck', 0, 560], ['chicken', 1, 900]];
    const barn: [Livestock, number, number][] = [['cow', 0, 800], ['cow', 1, 620], ['sheep', 0, 700], ['goat', 1, 540], ['pig', 0, 880], ['sheep', 1, 450]];
    for (const [s, v, f] of [...coop, ...barn]) this.add(s, v, undefined, f).mood = 230;
    for (const a of st.animals) if (a.species === 'sheep') a.ready = true;
    st.eggs = [
      { nest: 0, item: 'egg', q: 1 },
      { nest: 1, item: 'brownEgg', q: 0 },
      { nest: 3, item: 'duckEgg', q: 2 },
      { nest: 4, item: 'egg', q: 0 },
    ];
    st.hay.coop = [true, true, true, false, false, false];
    st.hay.barn = [true, false, true, true, false, false];
    if (name === 'animals-pasture') st.truffles = [{ x: 49.5, z: 41.5, q: 2 }, { x: 43.5, z: 42.5, q: 1 }];
    // Interior showcases keep the pop doors shut so the flock is home.
    if (this.pen()) st.doors = { coop: false, barn: false };
    this.respawn();
    // Stage: a few animals already at the trough, one right by the player for the petting hearts.
    const pen = this.pen();
    const night = this.isNight();
    if (pen && night) {
      // Night showcase: everyone tucked into the straw; no petting hearts.
      this.demoHearts = 0;
      return;
    }
    if (pen) {
      const pp = this.game.player.position;
      this.live.forEach((l, i) => {
        if (!l.rec) return;
        const a = l.actor;
        if (st.hay[pen.kind][l.slot] && i % 2 === 0) {
          a.hungry = true;
          a.place(a.feedSpot!.x, a.feedSpot!.z, a.feedHeading);
        }
      });
      const free = this.live.find((l) => l.rec && !st.hay[pen.kind][l.slot]);
      if (free) free.actor.place(pp.x + (pen.kind === 'coop' ? 0.75 : 1.05), pp.z - 0.55, -2.2);
    } else if (this.mapId === 'farm') {
      // Hand-placed pasture composition (world coords) so the framing reads.
      const spots: Record<string, [number, number, number][]> = {
        cow: [[44.2, 39.6, -0.6], [48.6, 41.2, 2.6]],
        sheep: [[46.6, 38.4, 1.2], [50.2, 38.9, -2.2]],
        goat: [[41.2, 41.4, 0.8]],
        pig: [[48.3, 42.6, 3.8]],
        chicken: [[40.1, 38.4, 2.4], [40.9, 39.3, -1.0], [37.9, 39.9, 0.5], [42.0, 38.1, 1.9]],
        duck: [[43.0, 42.6, 1.4], [43.8, 42.9, -2.5]],
      };
      const used: Record<string, number> = {};
      for (const l of this.live) {
        if (!l.rec) continue;
        const k = l.rec.species;
        const s = spots[k]?.[used[k] = (used[k] ?? -1) + 1];
        if (s) {
          l.actor.place(s[0], s[1], s[2]);
          l.actor.settle();
        }
      }
      const pet = this.live.find((l) => !l.rec);
      if (pet && name === 'animals-pasture') {
        pet.actor.area = { x0: 42.5, z0: 38.0, x1: 44.5, z1: 40.0 };
        pet.actor.place(43.0, 39.6, -0.5);
      } else if (pet) {
        // Yard shot: sitting by the bowl, looking up at the farmer.
        pet.actor.area = { x0: SITES.bowl.x - 1.2, z0: SITES.bowl.z + 0.2, x1: SITES.bowl.x - 0.2, z1: SITES.bowl.z + 1.0 };
        pet.actor.place(SITES.bowl.x - 0.6, SITES.bowl.z + 0.5, 1.2);
      }
    }
    this.demoHearts = params.get('hearts') === '0' ? 0 : 1;
    this.demoHeartT = 0.2;
  }

  // ───────────────────────────────────────────── save

  save(): unknown {
    return this.st;
  }

  load(data: unknown): void {
    const d = data as Partial<State> | null;
    const f = AnimalSystem.fresh();
    this.st = { ...f, ...(d ?? {}), hay: { ...f.hay, ...(d?.hay ?? {}) }, pet: { ...f.pet, ...(d?.pet ?? {}) } };
    if (this.mapId) this.respawn();
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
      const r = Math.sin(a) * 0.045 * (1 - 0.18 * Math.cos(a));
      pts.push(new THREE.Vector2(r, -Math.cos(a) * 0.06));
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
    m = new THREE.MeshStandardMaterial({ color: col, roughness: 0.38 });
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
