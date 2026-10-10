/**
 * BuildingSystem: farm buildings, their interiors and getting in / out of them.
 *
 *   - registers the interior maps (house, coop, barn) + the interior lighting hook;
 *   - doors: interact with (or walk into) the farmhouse / coop / barn door → fade, enter; the
 *     interior's doorway warp (GameMap.warps, handled by WarpSystem) brings you back out;
 *   - camera: interiors use their own close diorama framing; the outdoor framing is restored on exit;
 *   - construction: the carpenter panel orders a coop / barn → a staked construction site appears,
 *     the building is finished the next morning (`building:built`); service `buildings`;
 *   - demos: coop-interior / barn-interior / animals-pasture stage the buildings instantly.
 *   - co-op (host-authoritative, DESIGN §13): a client `setAuthority(false)`; its carpenter orders take
 *     the wood / stone from its own backpack and go out as `buildings:intent` → host
 *     `applyIntent(peer, intent)` (spends the shared purse; refunds a lost race via `buildings:grant`
 *     → client `receiveGrant`). Host emits `buildings:changed` → broadcast `snapshot()` →
 *     client `applySnapshot()`.
 */
import type { System } from '../../core/system';
import type { Game } from '../../core/game';
import { installInteriorLighting, isInterior } from '../interiors/lighting';
import { HouseInterior, HOUSE_DOOR } from '../interiors/house';
import { CoopInterior } from '../interiors/coop';
import { BarnInterior } from '../interiors/barn';
import { FarmBuildings, SITES, type BuildingKind } from './farm';
import { CarpenterPanel, COSTS_VIEW } from './carpenter';

export interface BuildingsApi {
  /** Finished buildings. */
  has(kind: BuildingKind): boolean;
  /** Under construction (finishes next morning). */
  pending(kind: BuildingKind): boolean;
  /** Order a building (spends gold / materials). Returns an error message or null. */
  order(kind: BuildingKind): string | null;
  /** Build instantly (debug / demos). */
  complete(kind: BuildingKind): void;
  /** Pasture rectangle (world coords) animals may roam on sunny days. */
  pasture(): { x0: number; z0: number; x1: number; z1: number };
  /** Outdoor door front (world) of a building. */
  doorFront(kind: BuildingKind): { x: number; z: number };
  /** Show / hide the water in the pet bowl. */
  setBowl(full: boolean): void;
  // ── co-op (see header)
  setAuthority(host: boolean): void;
  snapshot(): BuildingsSnapshot;
  applySnapshot(s: BuildingsSnapshot): void;
  applyIntent(peer: string, intent: BuildingIntent): void;
  receiveGrant(items: { itemId: string; qty: number }[]): void;
}

export type BuildingIntent = { kind: 'order'; building: BuildingKind };
export interface BuildingsSnapshot {
  built: BuildingKind[];
  orders: BuildingKind[];
}

declare module '../../core/game' {
  interface GameServices {
    buildings: BuildingsApi;
  }
}

declare module '../../core/events' {
  interface GameEvents {
    'building:ordered': { kind: string };
    'building:built': { kind: string };
    /** Player entered / left a building interior. */
    'building:enter': { kind: string };
    /** Co-op host: farm buildings changed (broadcast `buildings.snapshot()`). */
    'buildings:changed': Record<string, never>;
    /** Co-op client: forward to the host (`buildings.applyIntent(peer, intent)`). */
    'buildings:intent': { intent: BuildingIntent };
    /** Co-op host: hand these back to a remote farmer (`buildings.receiveGrant`). */
    'buildings:grant': { peer: string; items: { itemId: string; qty: number }[] };
  }
}

export const COSTS = COSTS_VIEW;

const OUTDOOR_CAM_DEFAULT = { yaw: 0, pitch: 50, distance: 24, offX: 0, offZ: 0 };

export class BuildingSystem implements System, BuildingsApi {
  readonly name = 'buildings';
  private game!: Game;
  private built = new Set<BuildingKind>();
  private orders = new Set<BuildingKind>();
  /** Built by a demo (removed again when another demo is staged). */
  private demoBuilt = new Set<BuildingKind>();
  private farm: FarmBuildings | null = null;
  private outdoorCam = { ...OUTDOOR_CAM_DEFAULT };
  private wasInside = false;
  private busy = false;
  private pushT = 0;
  private bowlFull = false;
  /** Co-op: host (and solo) own the farm's buildings; clients mirror. */
  private authority = true;

  init(game: Game): void {
    this.game = game;
    game.provide('buildings', this);
    installInteriorLighting(game);
    game.world.registerMap('house', (g) => new HouseInterior(g));
    game.world.registerMap('coop', (g) => new CoopInterior(g));
    game.world.registerMap('barn', (g) => new BarnInterior(g));
    game.hud.registerPanel('carpenter', new CarpenterPanel(game, game.hud.root));

    game.events.on('player:interact', ({ x, z }) => this.interact(x, z));
    game.events.on('day:start', () => {
      for (const k of [...this.orders]) {
        this.orders.delete(k);
        this.built.add(k);
        this.refreshFarm();
        game.events.emit('building:built', { kind: k });
        this.changed();
      }
    });
    game.events.on('demo:stage', ({ showcase }) => this.stageDemo(showcase));
    game.events.on('animals:door', ({ home, open }) => {
      if (home === 'coop' || home === 'barn') this.farm?.setDoor(home, open);
    });
  }

  // ───────────────────────────────────────────── api

  has(kind: BuildingKind): boolean {
    return this.built.has(kind);
  }

  pending(kind: BuildingKind): boolean {
    return this.orders.has(kind);
  }

  order(kind: BuildingKind): string | null {
    if (this.built.has(kind) || this.orders.has(kind)) return 'Already on the farm.';
    const c = COSTS[kind];
    const inv = this.game.services.inventory;
    const eco = this.game.services.economy;
    if (!eco || eco.gold() < c.gold) return `Needs ${c.gold.toLocaleString()}g.`;
    if (!inv || inv.count('wood') < c.wood) return `Needs ${c.wood} wood.`;
    if (inv.count('stone') < c.stone) return `Needs ${c.stone} stone.`;
    inv.remove('wood', c.wood);
    inv.remove('stone', c.stone);
    if (!this.authority) {
      // Co-op client: materials come from this farmer's backpack; the host spends the shared purse.
      this.game.events.emit('buildings:intent', { intent: { kind: 'order', building: kind } });
      return null;
    }
    eco.spend(c.gold, `build:${kind}`);
    this.placeOrder(kind);
    return null;
  }

  private placeOrder(kind: BuildingKind): void {
    this.orders.add(kind);
    this.refreshFarm();
    this.game.events.emit('building:ordered', { kind });
    this.changed();
  }

  // ───────────────────────────────────────────── co-op

  private changed(): void {
    if (this.authority) this.game.events.emit('buildings:changed', {});
  }

  setAuthority(host: boolean): void {
    this.authority = host;
  }

  snapshot(): BuildingsSnapshot {
    return { built: [...this.built], orders: [...this.orders] };
  }

  applySnapshot(s: BuildingsSnapshot): void {
    if (this.authority || !s) return;
    const known = (k: unknown): k is BuildingKind => k === 'coop' || k === 'barn';
    const before = [...this.built].sort().join();
    this.built = new Set((s.built ?? []).filter(known));
    this.orders = new Set((s.orders ?? []).filter(known));
    this.refreshFarm();
    for (const k of this.built) if (!before.includes(k)) this.game.events.emit('building:built', { kind: k });
  }

  applyIntent(peer: string, intent: BuildingIntent): void {
    if (!this.authority || intent?.kind !== 'order') return;
    const kind = intent.building;
    const c = COSTS[kind];
    if (!c) return;
    const eco = this.game.services.economy;
    // r12: the farmhand's materials are checked against the host's mirror of their backpack (sent
    // 250 ms after a change, so the order arrives ahead of the post-spend copy and the mirror still
    // holds the pre-order count). A mirror that has not moved since their last accepted order still
    // carries that order's wood / stone: it is debited, so one stale backpack can't pay twice. An
    // unknown farmhand (no mirror) or one who never had the materials: refused, nothing handed back
    // beyond what the mirror shows they own (a forged order can't mint wood).
    const have = (id: 'wood' | 'stone'): number | null => {
      const n = this.peerCount(peer, id);
      if (n == null) return null;
      const d = this.peerDebit.get(`${peer}:${id}`);
      return d && d.seen === n ? n - d.spent : n;
    };
    const wood = have('wood');
    const stone = have('stone');
    const refund = (w: number, st: number): void => {
      const items = [{ itemId: 'wood', qty: Math.max(0, Math.min(c.wood, w)) }, { itemId: 'stone', qty: Math.max(0, Math.min(c.stone, st)) }].filter((i) => i.qty > 0);
      if (items.length) this.game.events.emit('buildings:grant', { peer, items });
    };
    if (wood == null || stone == null || wood < c.wood || stone < c.stone) {
      this.rejected++;
      refund(wood ?? 0, stone ?? 0);
      return;
    }
    if (this.built.has(kind) || this.orders.has(kind) || !eco || !eco.spend(c.gold, `build:${kind}`)) {
      // Lost the race (or the purse ran dry): the materials go back to that farmer.
      refund(c.wood, c.stone);
      return;
    }
    for (const id of ['wood', 'stone'] as const) {
      const key = `${peer}:${id}`;
      const n = this.peerCount(peer, id) ?? 0;
      const d = this.peerDebit.get(key);
      this.peerDebit.set(key, { seen: n, spent: (d && d.seen === n ? d.spent : 0) + c[id] });
    }
    this.placeOrder(kind);
  }

  /** Host: carpenter orders from farmhands refused (no materials in their mirrored backpack). */
  rejected = 0;
  private peerDebit = new Map<string, { seen: number; spent: number }>();

  /** Host mirror of a farmhand's backpack (net layer; null = not a known farmhand). */
  private peerCount(peer: string, itemId: string): number | null {
    const net = this.game.services.net as unknown as { peerItemCount?: (id: number, item: string) => number | null } | undefined;
    const n = net?.peerItemCount?.(Number(peer), itemId);
    return typeof n === 'number' ? n : null;
  }

  receiveGrant(items: { itemId: string; qty: number }[]): void {
    for (const i of items ?? []) if (i && typeof i.itemId === 'string' && i.qty > 0) this.game.events.emit('item:give', { itemId: i.itemId, qty: i.qty | 0 });
  }

  complete(kind: BuildingKind): void {
    this.orders.delete(kind);
    if (this.built.has(kind)) return;
    this.built.add(kind);
    this.refreshFarm();
    this.game.events.emit('building:built', { kind });
    this.changed();
  }

  pasture(): { x0: number; z0: number; x1: number; z1: number } {
    return SITES.pasture;
  }

  doorFront(kind: BuildingKind): { x: number; z: number } {
    const s = SITES[kind];
    return { x: s.door.x + 0.5, z: s.door.z + 1.4 };
  }

  setBowl(full: boolean): void {
    this.bowlFull = full;
    this.farm?.setBowl(full);
  }

  // ───────────────────────────────────────────── farm structures

  private refreshFarm(): void {
    const map = this.game.world.current;
    if (map?.id !== 'farm') return;
    if (!this.farm) this.farm = new FarmBuildings(this.game, map);
    this.farm.sync(this.built, this.orders);
    this.farm.setBowl(this.bowlFull);
  }

  onMapChange(mapId: string, game: Game): void {
    const map = game.world.current;
    const rig = game.rc.rig;
    if (isInterior(map)) {
      if (!this.wasInside) this.outdoorCam = { yaw: rig.yaw, pitch: rig.pitch, distance: rig.distance, offX: rig.lookOffset.x, offZ: rig.lookOffset.z };
      const c = map.camera;
      rig.yaw = c.yaw;
      rig.pitch = c.pitch;
      rig.distance = c.distance;
      rig.lookOffset.set(c.offsetX, 0, c.offsetZ);
      rig.snap();
      this.wasInside = true;
      game.events.emit('building:enter', { kind: mapId });
    } else if (this.wasInside) {
      const c = this.outdoorCam;
      rig.yaw = c.yaw;
      rig.pitch = c.pitch;
      rig.distance = c.distance;
      rig.lookOffset.set(c.offX, 0, c.offZ);
      rig.snap();
      this.wasInside = false;
    }
    if (mapId === 'farm') this.refreshFarm();
  }

  // ───────────────────────────────────────────── doors

  private doorAt(x: number, z: number): 'house' | BuildingKind | null {
    if (this.game.world.current?.id !== 'farm') return null;
    if (x === HOUSE_DOOR.x && z === HOUSE_DOOR.z) return 'house';
    for (const k of ['coop', 'barn'] as const) {
      const d = SITES[k].door;
      if (this.built.has(k) && x === d.x && z === d.z) return k;
    }
    return null;
  }

  private interact(x: number, z: number): void {
    const d = this.doorAt(x, z);
    if (d) {
      void this.enter(d);
      return;
    }
    if (this.game.world.current?.id === 'farm' && this.farm?.isBoard(x, z)) this.game.events.emit('ui:open', { name: 'carpenter' });
  }

  async enter(target: 'house' | BuildingKind): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    const g = this.game;
    g.player.controllable = false;
    await g.hud.fade(true);
    const spawn = await (async () => {
      const m = await g.world.load(target);
      return m.spawn;
    })();
    g.player.teleport(spawn.x, spawn.z);
    g.player.setFacing('up');
    g.followPlayer(true);
    await new Promise((r) => setTimeout(r, 120));
    await g.hud.fade(false);
    g.player.controllable = true;
    this.busy = false;
  }

  /** Walking into a door (pushing against it for a moment) also opens it. */
  fixedUpdate(dt: number, game: Game): void {
    if (this.busy || game.paused || !game.player.controllable || game.world.current?.id !== 'farm') return;
    const p = game.player.position;
    const t = game.player.facingTile();
    const d = game.player.facing === 'up' ? this.doorAt(t.x, t.z) : null;
    const axis = game.input.moveAxis();
    const pushing = d && Math.abs(p.x - (t.x + 0.5)) < 0.55 && p.z - (t.z + 1) < 0.5 && Math.hypot(axis.x, axis.y) > 0.3;
    this.pushT = pushing ? this.pushT + dt : 0;
    if (pushing && this.pushT > 0.18 && d) {
      this.pushT = 0;
      void this.enter(d);
    }
  }

  /** r20: our interiors widen the tilt-shift's clear band while we're inside (restored on leaving). */
  private lensInside = false;

  update(dt: number, game: Game): void {
    if (game.world.current?.id === 'farm') this.farm?.update(dt, game);
    // A room is a whole diorama in frame: the default lens (clear band 0.26, 0.7 strength) smeared the
    // back wall — grandmother's portrait, the shelves, the coop's nest boxes, the stall row — into mush.
    // Held every frame while inside one of our rooms (a demo stage elsewhere resets the lens after load).
    const id = game.world.current?.id;
    const ours = id === 'house' || id === 'coop' || id === 'barn';
    if (ours) {
      game.rc.tiltBand = 0.42;
      game.rc.tiltStrength = 0.4;
      this.lensInside = true;
    } else if (this.lensInside) {
      game.rc.tiltBand = 0.26;
      game.rc.tiltStrength = 0.7;
      this.lensInside = false;
    }
  }

  // ───────────────────────────────────────────── demos

  private stageDemo(showcase: string[]): void {
    const wants = showcase.includes('animals');
    if (wants) {
      // 'no-coop' (r12 animals-overnight): the coop plot stays empty so the demo can order it.
      const skip = showcase.includes('no-coop') ? 'coop' : null;
      if (skip) {
        this.orders.delete(skip);
        if (this.built.delete(skip)) this.demoBuilt.delete(skip);
        this.refreshFarm();
      }
      for (const k of ['coop', 'barn'] as const) {
        if (k !== skip && !this.built.has(k)) {
          this.demoBuilt.add(k);
          this.complete(k);
        }
      }
      return;
    }
    if (this.demoBuilt.size) {
      for (const k of this.demoBuilt) this.built.delete(k);
      this.demoBuilt.clear();
      this.refreshFarm();
    }
  }

  // ───────────────────────────────────────────── save

  save(): unknown {
    return { built: [...this.built].filter((k) => !this.demoBuilt.has(k)), orders: [...this.orders] };
  }

  load(data: unknown): void {
    const d = data as { built?: BuildingKind[]; orders?: BuildingKind[] };
    this.built = new Set(d?.built ?? []);
    this.orders = new Set(d?.orders ?? []);
    this.demoBuilt.clear();
    this.refreshFarm();
  }
}

export type { BuildingKind };
