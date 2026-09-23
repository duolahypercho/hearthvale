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
}

const CAP = 6;
/** Presentation scale per species (chibi models read small next to the farmer otherwise). */
const SCALE: Record<Species, number> = { chicken: 1.14, duck: 1.14, cow: 1.1, goat: 1.08, sheep: 1.1, pig: 1.08, dog: 1.3, cat: 1.25 };
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
  /** Morning notes (hungry animals...), shown once the farmer is up again. */
  private morning: { text: string; icon?: string; kind: 'info' | 'good' | 'bad' }[] = [];

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

  private newDay(day = this.game.calendar.day): void {
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
              eggs.push({ nest: free[0]!, item, q });
              made.set(item, (made.get(item) ?? 0) + 1);
              produce.push({ item, q });
            }
          } else if (a.species === 'pig' && this.grazing()) {
            this.digTruffles(q);
            produce.push({ item: 'truffle', q });
          }
        }
      }
      report.push({ id: a.id, name: a.name, species: a.species, fed, petted, delta: a.friendship - f0 + (petted ? 15 : 0), friendship: a.friendship });
      a.fed = false;
      a.petted = false;
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
      });
      this.morning = [];
      if (hungry.length === 1) this.morning.push({ text: `<b>${hungry[0]!.name}</b> looks hungry — fill the ${LIVESTOCK[hungry[0]!.species].home === 'barn' ? 'manger' : 'trough'} with hay`, icon: 'hay', kind: 'bad' });
      else if (hungry.length > 1) this.morning.push({ text: `<b>${hungry[0]!.name}</b> and ${hungry.length - 1} other${hungry.length > 2 ? 's' : ''} look hungry this morning`, icon: 'hay', kind: 'bad' });
      const eggN = [...made.values()].reduce((a, b) => a + b, 0);
      if (eggN) this.morning.push({ text: `The coop has <b>${eggN}</b> fresh egg${eggN > 1 ? 's' : ''} this morning`, icon: [...made.keys()][0], kind: 'good' });
      const ready = this.st.animals.filter((a) => a.ready);
      if (ready.length) this.morning.push({ text: `<b>${ready[0]!.name}</b>${ready.length > 1 ? ` and ${ready.length - 1} more are` : ' is'} ready to ${ready[0]!.species === 'sheep' ? 'shear' : 'milk'}`, icon: produceFor(ready[0]!.species, ready[0]!.variant), kind: 'info' });
      // No bed to wake up from (debug day rolls): show them right away.
      if (!this.game.services.sleep) this.flushMorning();
    }
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
    a.grazes = true;
    a.curious = true;
    a.sleeping = false;
  }

  private spawnPet(indoors: boolean): void {
    const pet = this.st.pet;
    const l = this.spawn(null, pet.species, pet.variant, -1);
    const a = l.actor;
    a.sitter = true;
    if (indoors) {
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
      // Hand-lettered name plaques over the stalls (barn) / the flock's chalkboard (coop).
      const mine = this.st.animals.filter((a) => a.home === pen.kind);
      if (pen.kind === 'barn' && pen.plaques) {
        mine.forEach((a, i) => {
          const at = pen.plaques![i];
          if (!at) return;
          const m = new THREE.Mesh(plaqueGeo(), nameMaterial(a.name, 'plaque'));
          m.position.set(at.x, at.y, at.z);
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
    const pen = this.pen();
    const holding = this.game.services.inventory?.selected()?.id;
    const t = pen?.trough;
    const onTrough = !!t && x >= t.x0 && x <= t.x1 && z >= t.z0 && z <= t.z1;
    // Hay in hand + a manger / trough tile: always feed.
    if (pen && onTrough && holding === 'hay') {
      this.feed(pen);
      return;
    }
    if (pen?.kind === 'coop' && z <= 0 && x <= 2 && this.collectEggs()) return;
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
      const ti = this.st.truffles.findIndex((tr) => Math.floor(tr.x) === x && Math.floor(tr.z) === z);
      if (ti >= 0) {
        const tr = this.st.truffles.splice(ti, 1)[0]!;
        this.give('truffle', tr.q, -1, 'pig');
        this.refreshProps();
      }
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
    a.pet();
    this.pops.heart(a.topPoint(), a);
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
    this.fadeHat(dt, game);
  }

  // ───────────────────────────────────────────── hat fade

  private hatMats: THREE.Material[] | null = null;
  private hatK = 1;
  private _hp = new THREE.Vector3();
  private _hq = new THREE.Vector3();
  private _hl: THREE.Vector3[] = [];

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
          const c = mm.clone();
          c.alphaHash = true;
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
      for (const h of this.pops.hearts(this._hl)) if (behind(h)) want = 0.35;
      if (want === 1) {
        for (const l of this.live) {
          const a = l.actor;
          if (Math.hypot(a.pos.x - pp.x, a.pos.z - pp.z) > 2.2) continue;
          if (behind(a.topPoint(this._hq.clone())) || behind(a.pos.clone().setY(a.pos.y + a.gait.top * a.scale * 0.5))) {
            want = 0.35;
            break;
          }
        }
      }
    }
    this.hatK += (want - this.hatK) * (1 - Math.exp(-10 * dt));
    for (const m of this.hatMats) m.opacity = this.hatK;
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
      const free = this.live.find((l) => l.rec && !st.hay[pen.kind][l.slot]);
      if (free) free.actor.place(pp.x + 0.78, pp.z + 0.05, -Math.PI / 2);
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

let _plaque: THREE.PlaneGeometry | null = null;
function plaqueGeo(): THREE.PlaneGeometry {
  if (!_plaque) _plaque = new THREE.PlaneGeometry(0.56, 0.16);
  return _plaque;
}

const nameMats = new Map<string, THREE.MeshStandardMaterial>();
/** Painted name card: dark lettering on a cream plaque, or chalk on a slate board (one name per line). */
function nameMaterial(text: string, style: 'plaque' | 'chalk'): THREE.MeshStandardMaterial {
  const key = `${style}:${text}`;
  let m = nameMats.get(key);
  if (m) return m;
  const lines = text.split('\n');
  const W = style === 'plaque' ? 256 : 256;
  const H = style === 'plaque' ? 72 : 160;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d')!;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  if (style === 'plaque') {
    g.fillStyle = '#f2e6c8';
    g.fillRect(0, 0, W, H);
    g.strokeStyle = 'rgba(120,80,40,.5)';
    g.lineWidth = 4;
    g.strokeRect(6, 6, W - 12, H - 12);
    g.font = '600 40px Fredoka, Nunito, sans-serif';
    g.fillStyle = '#5a3218';
    g.fillText(lines[0] ?? '', W / 2, H / 2 + 2);
    // A little heart after the name
    g.fillStyle = '#d04a5a';
    g.font = '28px sans-serif';
    g.fillText('\u2665', W - 26, H / 2 + 2);
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
