/**
 * KintaraSystem: the valley's tally of good work and its simulated $KIN token (see data/kintara.ts for the
 * fiction and every number; core/kintara-chain.ts for the ledger and the adapter seam).
 *
 *   in:   shipping:summary, quest:complete / quest:bundleDone / quest:room / quest:hallRestored, festival:minigame,
 *         mine:floor, fishing:catch, day:start, demo:stage, player:interact (the Exchange stall in town square)
 *   out:  kintara:earned, kintara:burned, kintara:minted, kintara:fund, kintara:changed (co-op replication),
 *         kintara:intent / kintara:grant (co-op relay), ui:toast, ui:sfx 'kin-earn' | 'kin-mint'
 *   service: game.services.kintara (KintaraApi)
 *
 * Rules the code enforces (so the economy cannot be gamed from the UI or the debug hooks of a normal session):
 *   - kin is emitted only by `pay()`: one-time milestones (keyed, paid once) or repeatable income, which is
 *     scaled by the yearly schedule, limited per source per day and by a daily ceiling;
 *   - gold never buys kin; kin → gold only at the capped, slipping, taxed Gold Counter; every sink burns kin;
 *   - deeds are soulbound and cost a fee that grows for repeat editions. No randomness, no loot boxes.
 *
 * Co-op (host-authoritative): ONE shared farm wallet, like the shared purse. The host runs the ledger. A farmhand's
 * earning events and actions travel to the host as intents (net/bridge.ts → applyIntent); the host re-validates
 * them against the same caps, replicates the state as a snapshot, and refunds / delivers items through
 * `kintara:grant` (a farmhand's backpack lives on their machine). Farmhands never write the ledger.
 */
import type { System } from '../core/system';
import type { Game } from '../core/game';
import { SimulatedChain, type ChainAdapter, type ChainSupply, type ChainTx, type DeedToken } from '../core/kintara-chain';
import { itemDef } from '../data/items';
import { FISH } from '../data/fish';
import { journal } from '../ui/profile';
import { Villager } from '../entities/villager';
import type { NpcDef } from '../data/npcs';
import { buildKintaraStall, type KintaraStallParts } from '../world/props/kintara-stall';
import {
  KIN,
  SOURCES,
  SHIP_PER_GOLD,
  SHIP_MILESTONES,
  QUEST_KIN,
  BUNDLE_KIN,
  ROOM_KIN,
  HALL_KIN,
  FESTIVAL_WIN_KIN,
  FESTIVAL_PART_KIN,
  FISH_RECORD_KIN,
  COUNTER,
  TITHE,
  MINT_FEE,
  EDITION_MULT,
  MINT_PER_DAY,
  OFFERS,
  FUND_TIERS,
  TOOL_TIER_NAME,
  QUALITY_WORD,
  KEEPER_LINES,
  HALL_STORY,
  KEEPER,
  dailyCap,
  emissionFactor,
  mineMark,
  fishFirstKin,
  counterRate,
  deedRule,
  type EarnSource,
  type DeedRule,
} from '../data/kintara';

export interface FeedEntry {
  /** In-game day index. */
  day: number;
  text: string;
  amount: number;
  /** Positive = earned, negative = burned. */
  kind: 'earn' | 'burn';
}

export interface MintOption {
  itemId: string;
  quality: number;
  name: string;
  rule: DeedRule;
  edition: number;
  maxEdition: number;
  fee: number;
  /** Why it can't be sealed right now (null = ready). */
  blocked: string | null;
  have: number;
}

export interface Result {
  ok: boolean;
  reason?: string;
  /** Co-op farmhand: the host will confirm in the next snapshot. */
  pending?: boolean;
  deed?: DeedToken;
  kin?: number;
  gold?: number;
}

export interface KintaraApi {
  balance(): number;
  address(): string;
  supply(): ChainSupply;
  network(): { name: string; simulated: boolean; id: string };
  verify(): { ok: boolean; height: number; head: string };
  history(limit?: number): ChainTx[];
  feed(): FeedEntry[];
  deeds(): DeedToken[];
  /** Backpack (and attestable tool) options for the Mint tab. */
  mintOptions(): MintOption[];
  mint(itemId: string, quality: number): Result;
  quoteConvert(kin: number): { kin: number; gold: number; rate: number; left: number };
  convert(kin: number): Result;
  offers(): { id: string; itemId: string; qty: number; kin: number; note: string; name: string }[];
  buy(offerId: string): Result;
  donate(kin: number): Result;
  fund(): { kin: number; tier: number; next: number | null };
  today(): { earned: number; cap: number; bySource: Record<string, number>; converted: number; minted: number; counterLeft: number; mintLeft: number };
  lifetime(): { earned: number; burned: number; shipped: number };
  /** The counter is in Hearthvale square; the ledger and collection can be read anywhere. */
  atExchange(): boolean;
  met(): boolean;
  markMet(): void;
  hallDone(): boolean;
  chipVisible(): boolean;
  setChipHidden(hidden: boolean): void;
  /** Swap the ledger backend (a real chain's ChainAdapter). The shipped game never calls this. */
  useAdapter(a: ChainAdapter): void;
  /** Debug / demo: credit kin from the reserve, outside the earn rules. Disabled by `strict`. */
  debugGrant(n: number): void;
  /** Debug: run an earn rule as if the matching gameplay event had fired. */
  debugEarn(source: EarnSource, amount: number, once?: string): number;
  /** The keeper's next line for a situation (rotates; never repeats back to back). */
  line(kind: keyof typeof KEEPER_LINES): string;
  /** Co-op (net/bridge.ts). */
  setAuthority(isHost: boolean): void;
  snapshot(): unknown;
  applySnapshot(s: unknown): void;
  applyIntent(peer: string, intent: unknown): void;
  receiveGrant(g: unknown): void;
}

declare module '../core/game' {
  interface GameServices {
    kintara: KintaraApi;
  }
}

declare module '../core/events' {
  interface GameEvents {
    'kintara:earned': { amount: number; source: EarnSource; label: string; balance: number };
    'kintara:burned': { amount: number; reason: string; balance: number };
    'kintara:minted': { deed: DeedToken; mine: boolean };
    'kintara:fund': { kin: number; tier: number; up: boolean };
    /** Ledger state changed (co-op: the host replicates a snapshot). */
    'kintara:changed': { rev: number };
    /** Farmhand → host request (net/bridge.ts forwards it). */
    'kintara:intent': { intent: unknown };
    /** Host → one farmhand: items to hand over / refund (+ a toast). */
    'kintara:grant': { peer: number; items: unknown };
    'kintara:hall': Record<string, never>;
  }
}

interface Today {
  key: string;
  earned: number;
  bySource: Record<string, number>;
  converted: number;
  minted: number;
  /** Depth marks paid today (a farmhand's claim can never skip to the bottom of the mine). */
  marks?: number;
}

interface State {
  v: 1;
  chain: unknown;
  today: Today;
  once: string[];
  shipped: number;
  earned: number;
  burned: number;
  fund: number;
  met: boolean;
  hall: boolean;
  keystone: boolean;
  deepest: number;
  fishBest: Record<string, number>;
  fishLast: Record<string, number>;
  feed: FeedEntry[];
}

const SEASONS = ['spring', 'summer', 'fall', 'winter'];
const SEASON_NAME: Record<string, string> = { spring: 'Spring', summer: 'Summer', fall: 'Fall', winter: 'Winter' };
const MAX_FLOOR = 150;
/** At most this many depth marks are paid per day (3 marks = 15 floors; the rest wait for the next floor event). */
const MINE_MARKS_PER_DAY = 3;
const CHIP_KEY = 'hearthvale.kintara.chipHidden';

const blankToday = (key: string): Today => ({ key, earned: 0, bySource: {}, converted: 0, minted: 0 });

export class KintaraSystem implements System, KintaraApi {
  readonly name = 'kintara';
  private game!: Game;
  private chain: ChainAdapter = new SimulatedChain('farm', KIN.reserve);
  private st!: State;
  private authority = true;
  private rev = 0;
  private applying = false;
  private chipHidden = false;
  private lineIx = 0;
  private loadSeen = false;
  private stall: KintaraStallParts | null = null;
  private keeper: Villager | null = null;
  private stallMap: string | null = null;

  init(game: Game): void {
    this.game = game;
    this.st = this.fresh();
    this.relabel();
    try {
      this.chipHidden = localStorage.getItem(CHIP_KEY) === '1';
    } catch {
      /* private mode */
    }
    game.provide('kintara', this);
    const ev = game.events;

    ev.on('shipping:summary', ({ total }) => {
      if (!this.authority) return;
      this.st.shipped += total;
      this.pay('ship', Math.floor(total / SHIP_PER_GOLD), 'Shipping tally');
      for (const [at, kin] of SHIP_MILESTONES) if (this.st.shipped >= at) this.pay('ship', kin, `Shipped ${at.toLocaleString()}g in total`, `ship:${at}`);
    });
    ev.on('quest:complete', () => this.route({ k: 'earn', src: 'quest' }));
    ev.on('quest:bundleDone', ({ bundleId }) => {
      if (this.authority) this.pay('hall', BUNDLE_KIN, 'A Lantern Hall bundle filled', `bundle:${bundleId}`);
    });
    ev.on('quest:room', ({ roomId }) => {
      if (this.authority) this.pay('hall', ROOM_KIN, 'A Lantern Hall room relit', `room:${roomId}`);
    });
    ev.on('quest:hallRestored', () => {
      if (!this.authority) return;
      this.pay('hall', HALL_KIN, 'The Lantern Hall is lit again', 'hall');
      this.hallRestored();
    });
    ev.on('festival:minigame', ({ won }) => this.route({ k: 'earn', src: 'festival', won: !!won }));
    ev.on('mine:floor', ({ deepest }) => this.route({ k: 'earn', src: 'mine', deepest }));
    ev.on('fishing:catch', ({ fishId, size }) => this.route({ k: 'earn', src: 'fish', fishId, size }));
    ev.on('day:start', () => {
      if (!this.authority) return;
      this.rollDay();
      this.tithe();
    });
    ev.on('journal:change', () => this.relabel());
    ev.on('player:interact', ({ x, z }) => this.interactStall(x, z));
    ev.on('kintara:fund', ({ tier }) => this.stall?.setTier(tier));
    ev.on('demo:stage', ({ name }) => {
      if (name === 'kintara' || name.startsWith('ui-kintara')) this.stageDemo(name);
    });
    // A save from before Kintara has no ledger key: loading it must not keep this session's wallet.
    ev.on('load:after', () => {
      if (!this.loadSeen) {
        this.st = this.fresh();
        this.chain = new SimulatedChain(journal.farm, KIN.reserve);
        this.changed();
      }
      this.loadSeen = false;
    });
  }

  // ───────────────────────────────────────────── state

  private fresh(): State {
    return { v: 1, chain: null, today: blankToday(this.dayKey()), once: [], shipped: 0, earned: 0, burned: 0, fund: 0, met: false, hall: false, keystone: false, deepest: 0, fishBest: {}, fishLast: {}, feed: [] };
  }

  private dayKey(): string {
    const c = this.game.calendar;
    return `${c.year}:${c.season}:${c.day}`;
  }

  private dayIdx(): number {
    const c = this.game.calendar;
    return (c.year - 1) * 112 + Math.max(0, SEASONS.indexOf(c.season)) * 28 + c.day;
  }

  private dateText(): string {
    const c = this.game.calendar;
    return `${SEASON_NAME[c.season]} ${c.day}, Year ${c.year}`;
  }

  private rollDay(): void {
    if (this.st.today.key !== this.dayKey()) this.st.today = blankToday(this.dayKey());
  }

  private relabel(): void {
    (this.chain as { relabel?(l: string): void }).relabel?.(journal.farm);
  }

  private changed(): void {
    this.rev++;
    this.game.events.emit('kintara:changed', { rev: this.rev });
  }

  private yearFactor(): number {
    return emissionFactor(this.game.calendar.year) * (1 + this.fundBonus());
  }

  private fundTier(): number {
    let t = 0;
    for (const f of FUND_TIERS) if (this.st.fund >= f.at) t++;
    return t;
  }

  private fundBonus(): number {
    let b = 0;
    for (let i = 0; i < this.fundTier(); i++) b += FUND_TIERS[i]!.capBonus;
    return b;
  }

  private feedAdd(text: string, amount: number, kind: 'earn' | 'burn'): void {
    this.st.feed.push({ day: this.dayIdx(), text, amount, kind });
    if (this.st.feed.length > 40) this.st.feed.shift();
  }

  // ───────────────────────────────────────────── earning

  /** Co-op: the host handles a farmer's earning event; a farmhand forwards it as an intent. */
  private route(i: Record<string, unknown>): void {
    if (this.authority) this.earn(i);
    else if (!this.applying) this.game.events.emit('kintara:intent', { intent: i });
  }

  private earn(i: Record<string, unknown>): void {
    switch (i.src) {
      case 'quest':
        this.pay('quest', QUEST_KIN, 'Notice-board job done');
        break;
      case 'festival':
        this.pay('festival', i.won ? FESTIVAL_WIN_KIN : FESTIVAL_PART_KIN, i.won ? 'Festival: first-place ribbon' : 'Festival: joined in');
        break;
      case 'mine': {
        const deepest = Math.min(MAX_FLOOR, Math.max(0, Math.floor(Number(i.deepest))));
        if (!(deepest > 0)) break;
        this.st.deepest = Math.max(this.st.deepest, deepest);
        for (let f = 5; f <= deepest; f += 5) {
          if (this.st.once.includes(`mine:${f}`)) continue;
          if ((this.st.today.marks ?? 0) >= MINE_MARKS_PER_DAY) break;
          if (this.pay('mine', mineMark(f), `Reached mine floor ${f}`, `mine:${f}`)) this.st.today.marks = (this.st.today.marks ?? 0) + 1;
        }
        break;
      }
      case 'fish': {
        const id = String(i.fishId);
        const def = FISH.find((f) => f.id === id);
        if (!def) break;
        const size = Math.max(0, Number(i.size) || 0);
        this.st.fishLast[id] = size;
        const first = fishFirstKin(id);
        const wasNew = !this.st.once.includes(`fish:${id}`);
        if (first > 0) this.pay('fish', first, `First ${def.name} on the tally`, `fish:${id}`);
        const best = this.st.fishBest[id] ?? 0;
        if (size > best) {
          this.st.fishBest[id] = size;
          // A new personal record (not the first catch, which already paid): 5% longer than the last best.
          if (!wasNew && size >= best * 1.05) this.pay('fish', FISH_RECORD_KIN, `${def.name} record: ${Math.round(size)} cm`);
        }
        break;
      }
    }
  }

  /**
   * The single doorway kin enters the world through. `once` = a keyed one-time milestone (bypasses the daily
   * caps, still bounded because each key pays once); without it the payout is repeatable income, scaled by the
   * yearly schedule and cut to the per-source and per-day ceilings.
   */
  private pay(src: EarnSource, amount: number, label: string, once?: string): number {
    if (!this.authority || !(amount > 0)) return 0;
    this.rollDay();
    let n = Math.floor(amount);
    if (once) {
      if (this.st.once.includes(once)) return 0;
    } else {
      const f = this.yearFactor();
      n = Math.max(1, Math.round(n * f));
      const srcCap = Math.round(SOURCES[src].daily * f);
      const dayCap = Math.round(dailyCap(this.game.calendar.year) * (1 + this.fundBonus()));
      n = Math.min(n, srcCap - (this.st.today.bySource[src] ?? 0), dayCap - this.st.today.earned);
      if (n <= 0) return 0;
    }
    const tx = this.chain.emit(this.chain.address(), n, label, this.dayIdx());
    if (!tx) return 0;
    if (once) this.st.once.push(once);
    else {
      this.st.today.earned += n;
      this.st.today.bySource[src] = (this.st.today.bySource[src] ?? 0) + n;
    }
    this.st.earned += n;
    this.feedAdd(label, n, 'earn');
    const ev = this.game.events;
    ev.emit('kintara:earned', { amount: n, source: src, label, balance: this.balance() });
    ev.emit('ui:toast', { text: `<b>+${n} ${KIN.symbol}</b> ${label}`, kind: 'good' });
    ev.emit('ui:sfx', { kind: 'kin-earn' });
    this.changed();
    return n;
  }

  private burn(n: number, reason: string, silent = false): boolean {
    if (!this.chain.burn(this.chain.address(), n, reason, this.dayIdx())) return false;
    this.st.burned += n;
    this.feedAdd(reason, -n, 'burn');
    this.game.events.emit('kintara:burned', { amount: n, reason, balance: this.balance() });
    if (!silent) this.changed();
    return true;
  }

  private tithe(): void {
    const over = this.balance() - TITHE.above;
    const n = Math.floor(over * TITHE.pct);
    if (n >= 1 && this.burn(n, 'Hearth tithe: lantern oil')) {
      this.game.events.emit('ui:toast', { text: `Hearth tithe: <b>${n} ${KIN.symbol}</b> burned as lantern oil`, kind: 'info' });
    }
  }

  private hallRestored(): void {
    if (this.st.hall) return;
    this.st.hall = true;
    this.st.keystone = true;
    this.game.events.emit('kintara:hall', {});
    this.game.events.emit('ui:toast', { text: 'Perpetua has a <b>Keystone deed</b> waiting at the Exchange', kind: 'gold' });
    this.changed();
  }

  // ───────────────────────────────────────────── read API

  balance(): number {
    return this.chain.balance();
  }
  address(): string {
    return this.chain.address();
  }
  supply(): ChainSupply {
    return this.chain.supply();
  }
  network(): { name: string; simulated: boolean; id: string } {
    return { name: this.chain.network, simulated: this.chain.simulated, id: this.chain.id };
  }
  verify(): { ok: boolean; height: number; head: string } {
    return this.chain.verify();
  }
  history(limit?: number): ChainTx[] {
    return this.chain.history(limit);
  }
  feed(): FeedEntry[] {
    return [...this.st.feed].reverse();
  }
  deeds(): DeedToken[] {
    return this.chain.deeds();
  }
  met(): boolean {
    return this.st.met;
  }
  markMet(): void {
    if (this.st.met) return;
    this.st.met = true;
    this.changed();
  }
  hallDone(): boolean {
    return this.st.hall;
  }
  chipVisible(): boolean {
    return !this.chipHidden && (this.st.met || this.balance() > 0 || this.st.earned > 0);
  }
  setChipHidden(hidden: boolean): void {
    this.chipHidden = hidden;
    try {
      localStorage.setItem(CHIP_KEY, hidden ? '1' : '0');
    } catch {
      /* ignore */
    }
    this.game.events.emit('kintara:changed', { rev: this.rev });
  }
  atExchange(): boolean {
    return this.game.world.current?.id === 'town';
  }
  fund(): { kin: number; tier: number; next: number | null } {
    return { kin: this.st.fund, tier: this.fundTier(), next: FUND_TIERS[this.fundTier()]?.at ?? null };
  }
  lifetime(): { earned: number; burned: number; shipped: number } {
    return { earned: this.st.earned, burned: this.st.burned, shipped: this.st.shipped };
  }
  today(): ReturnType<KintaraApi['today']> {
    this.rollDay();
    const t = this.st.today;
    const cap = Math.round(dailyCap(this.game.calendar.year) * (1 + this.fundBonus()));
    return { earned: t.earned, cap, bySource: { ...t.bySource }, converted: t.converted, minted: t.minted, counterLeft: Math.max(0, COUNTER.perDay - t.converted), mintLeft: Math.max(0, MINT_PER_DAY - t.minted) };
  }

  /** Words for the keeper's bubble: scripted by situation, then rotated so she never repeats back to back. */
  line(kind: keyof typeof KEEPER_LINES): string {
    let set = KEEPER_LINES[kind];
    if (kind === 'hello') {
      if (this.st.hall && this.lineIx % 3 === 0) set = KEEPER_LINES.hall;
      else if (this.game.services.story?.flag('glimmer') === 'accepted' && this.lineIx % 3 === 1) set = KEEPER_LINES.glimmer;
    }
    return set[this.lineIx++ % set.length]!;
  }

  // ───────────────────────────────────────────── minting

  private toolTier(id: string): number {
    const f = this.game.services.farming as unknown as { toolTier?(t: string): number } | undefined;
    return f?.toolTier?.(id) ?? 0;
  }

  private maxEdition(): number {
    return this.fundTier() >= 3 ? 4 : 3;
  }

  private editionsOf(itemId: string, quality: number): number {
    return this.chain.deeds().filter((d) => d.itemId === itemId && d.quality === quality).length;
  }

  private feeFor(rule: DeedRule, itemId: string, edition: number): number {
    if (itemId === 'keystone') return 0;
    return Math.round(MINT_FEE[rule.rarity]! * (EDITION_MULT[edition - 1] ?? EDITION_MULT[EDITION_MULT.length - 1]! * 2));
  }

  mintOptions(): MintOption[] {
    const inv = this.game.services.inventory;
    const out: MintOption[] = [];
    const seen = new Set<string>();
    const add = (itemId: string, quality: number, have: number, attestTier = false): void => {
      const key = `${itemId}|${quality}`;
      if (seen.has(key)) return;
      const rule = deedRule(itemId, quality);
      if (!rule) return;
      seen.add(key);
      const edition = this.editionsOf(itemId, quality) + 1;
      const fee = this.feeFor(rule, itemId, edition);
      let blocked: string | null = null;
      if (edition > this.maxEdition()) blocked = 'Every edition is already inscribed';
      else if (this.today().mintLeft <= 0) blocked = 'The clerk\'s queue is full today';
      else if (!this.atExchange()) blocked = 'Bring it to the Exchange in town';
      else if (this.balance() < fee) blocked = `Needs ${fee} ${KIN.symbol}`;
      else if (attestTier && !this.authority) blocked = 'Tool deeds are sealed on the host\'s farm';
      out.push({ itemId, quality, name: itemId === 'keystone' ? HALL_STORY.keystoneName : (itemDef(itemId)?.name ?? itemId), rule, edition, maxEdition: this.maxEdition(), fee, blocked, have });
    };
    inv?.slots.forEach((s) => {
      if (s) add(s.id, s.quality ?? 0, s.qty);
    });
    for (const t of ['hoe', 'wateringCan', 'axe', 'pickaxe', 'scythe']) {
      const tier = this.toolTier(t);
      if (tier >= 1 && inv?.count(t)) add(t, tier, 1, true);
    }
    if (this.st.keystone && !this.chain.deeds().some((d) => d.itemId === 'keystone')) add('keystone', 0, 1, true);
    const rank = { legendary: 0, rare: 1, uncommon: 2, common: 3 } as const;
    return out.sort((a, b) => rank[a.rule.rarity] - rank[b.rule.rarity] || b.fee - a.fee || a.name.localeCompare(b.name));
  }

  private note(rule: DeedRule, itemId: string, quality: number): string {
    switch (rule.category) {
      case 'fish': {
        const s = this.st.fishLast[itemId];
        return s ? `${Math.round(s)} cm, landed in ${SEASON_NAME[this.game.calendar.season]}` : `${QUALITY_WORD[quality] ?? 'plain'} catch`;
      }
      case 'crop':
        return `${QUALITY_WORD[quality] ?? 'plain'} harvest, ${SEASON_NAME[this.game.calendar.season]}`;
      case 'gem':
        return this.st.deepest ? `Cut from the Hollows (deepest floor ${this.st.deepest})` : 'Dug from the Hollows';
      case 'tool':
        return `${TOOL_TIER_NAME[quality] ?? 'Basic'} tier, sealed by hand`;
      default:
        return HALL_STORY.keystoneNote;
    }
  }

  /** Host-side seal: validate everything, burn the fee, write the deed. The caller has dealt with the item. */
  private seal(itemId: string, quality: number, by: string): Result {
    this.rollDay();
    const rule = deedRule(itemId, quality);
    if (!rule) return { ok: false, reason: 'That cannot be sealed into a deed' };
    if (itemId === 'keystone' && (!this.st.keystone || this.chain.deeds().some((d) => d.itemId === 'keystone'))) return { ok: false, reason: 'No Keystone is waiting' };
    if (this.st.today.minted >= MINT_PER_DAY) return { ok: false, reason: 'The clerk\'s queue is full today' };
    const edition = this.editionsOf(itemId, quality) + 1;
    if (edition > this.maxEdition()) return { ok: false, reason: 'Every edition is already inscribed' };
    const fee = this.feeFor(rule, itemId, edition);
    if (fee > 0 && this.balance() < fee) return { ok: false, reason: `Needs ${fee} ${KIN.symbol}` };
    if (fee > 0 && !this.burn(fee, `Inscription fee: ${itemDef(itemId)?.name ?? itemId}`, true)) return { ok: false, reason: 'The ledger refused the fee' };
    const def = itemDef(itemId);
    const deed = this.chain.mintDeed(
      this.chain.address(),
      { itemId, name: itemId === 'keystone' ? HALL_STORY.keystoneName : (def?.name ?? itemId), category: rule.category, rarity: rule.rarity, quality, edition, mintedBy: by, date: this.dateText(), note: this.note(rule, itemId, quality) },
      this.dayIdx(),
    );
    this.st.today.minted++;
    this.game.events.emit('kintara:minted', { deed, mine: by === journal.name });
    this.changed();
    return { ok: true, deed, kin: -fee };
  }

  mint(itemId: string, quality = 0): Result {
    const rule = deedRule(itemId, quality);
    if (!rule) return { ok: false, reason: 'That cannot be sealed into a deed' };
    if (!this.atExchange()) return { ok: false, reason: 'Bring it to the Exchange in town' };
    const inv = this.game.services.inventory;
    if (!rule.attest) {
      const slot = inv?.slots.findIndex((s) => s && s.id === itemId && (s.quality ?? 0) === quality) ?? -1;
      if (slot < 0) return { ok: false, reason: 'You are not carrying that' };
      if (this.authority) {
        // Validate before the item leaves the pack.
        const edition = this.editionsOf(itemId, quality) + 1;
        const fee = this.feeFor(rule, itemId, edition);
        if (this.st.today.minted >= MINT_PER_DAY) return { ok: false, reason: 'The clerk\'s queue is full today' };
        if (edition > this.maxEdition()) return { ok: false, reason: 'Every edition is already inscribed' };
        if (this.balance() < fee) return { ok: false, reason: `Needs ${fee} ${KIN.symbol}` };
        inv!.takeFromSlot(slot, 1);
        const r = this.seal(itemId, quality, journal.name);
        if (!r.ok) this.game.events.emit('item:give', { itemId, qty: 1, quality });
        return r;
      }
      // Farmhand: the item leaves the pack now; the host seals it or hands it back (kintara:grant).
      inv!.takeFromSlot(slot, 1);
      this.game.events.emit('kintara:intent', { intent: { k: 'mint', itemId, quality, by: journal.name } });
      return { ok: true, pending: true };
    }
    // Attestation (tools, the Keystone): nothing leaves the pack.
    if (!this.authority) return { ok: false, reason: 'Tool deeds are sealed on the host\'s farm' };
    if (itemId !== 'keystone') {
      if (!inv?.count(itemId) || this.toolTier(itemId) < quality) return { ok: false, reason: 'No such tool in your pack' };
    }
    return this.seal(itemId, quality, journal.name);
  }

  // ───────────────────────────────────────────── counter, market, fund

  quoteConvert(kin: number): { kin: number; gold: number; rate: number; left: number } {
    this.rollDay();
    const left = Math.max(0, COUNTER.perDay - this.st.today.converted);
    const n = Math.max(0, Math.min(Math.floor(kin), left, this.balance()));
    let gross = 0;
    for (let i = 0; i < n; i++) gross += counterRate(this.st.today.converted + i);
    return { kin: n, gold: Math.floor(gross * (1 - COUNTER.tax)), rate: counterRate(this.st.today.converted), left };
  }

  convert(kin: number): Result {
    if (!this.atExchange()) return { ok: false, reason: 'The Gold Counter is in town' };
    if (!this.authority) {
      if (!(kin >= 1)) return { ok: false, reason: 'Nothing to trade' };
      this.game.events.emit('kintara:intent', { intent: { k: 'convert', kin: Math.floor(kin) } });
      return { ok: true, pending: true };
    }
    const q = this.quoteConvert(kin);
    if (q.kin < 1) return { ok: false, reason: q.left <= 0 ? 'The counter has closed for today' : 'No kin to trade' };
    if (!this.burn(q.kin, `Gold Counter: ${q.kin} kin for ${q.gold}g`, true)) return { ok: false, reason: 'The ledger refused' };
    this.st.today.converted += q.kin;
    this.game.services.economy?.add(q.gold, 'kintara');
    this.game.events.emit('ui:sfx', { kind: 'coin' });
    this.changed();
    return { ok: true, kin: -q.kin, gold: q.gold };
  }

  offers(): ReturnType<KintaraApi['offers']> {
    return OFFERS.filter((o) => itemDef(o.itemId)).map((o) => ({ ...o, name: itemDef(o.itemId)!.name }));
  }

  private hand(peer: number | null, itemId: string, qty: number, text: string): void {
    if (peer === null) this.game.events.emit('item:give', { itemId, qty });
    else this.game.events.emit('kintara:grant', { peer, items: { items: [{ itemId, qty }], text } });
  }

  buy(offerId: string): Result {
    const o = OFFERS.find((x) => x.id === offerId);
    if (!o) return { ok: false, reason: 'Not on the board' };
    if (!this.atExchange()) return { ok: false, reason: 'The market stall is in town' };
    if (!this.authority) {
      this.game.events.emit('kintara:intent', { intent: { k: 'buy', offer: offerId } });
      return { ok: true, pending: true };
    }
    return this.doBuy(o, null);
  }

  private doBuy(o: (typeof OFFERS)[number], peer: number | null): Result {
    if (this.balance() < o.kin) return { ok: false, reason: `Needs ${o.kin} ${KIN.symbol}` };
    if (!this.burn(o.kin, `Market: ${itemDef(o.itemId)?.name ?? o.itemId}`, true)) return { ok: false, reason: 'The ledger refused' };
    this.hand(peer, o.itemId, o.qty, `<b>${o.qty}× ${itemDef(o.itemId)?.name}</b> from the Exchange`);
    this.game.events.emit('ui:sfx', { kind: 'buy' });
    this.changed();
    return { ok: true, kin: -o.kin };
  }

  donate(kin: number): Result {
    const n = Math.floor(kin);
    if (!(n >= 1)) return { ok: false, reason: 'Nothing to donate' };
    if (!this.atExchange()) return { ok: false, reason: 'The Lantern Fund jar is in town' };
    if (!this.authority) {
      this.game.events.emit('kintara:intent', { intent: { k: 'donate', kin: n } });
      return { ok: true, pending: true };
    }
    return this.doDonate(n);
  }

  private doDonate(n: number): Result {
    if (this.balance() < n) return { ok: false, reason: `Needs ${n} ${KIN.symbol}` };
    const before = this.fundTier();
    if (!this.burn(n, 'Lantern Fund: oil for the Hall', true)) return { ok: false, reason: 'The ledger refused' };
    this.st.fund += n;
    const tier = this.fundTier();
    this.game.events.emit('kintara:fund', { kin: this.st.fund, tier, up: tier > before });
    if (tier > before) {
      const t = FUND_TIERS[tier - 1]!;
      this.game.events.emit('ui:toast', { text: `Lantern Fund: <b>${t.title}</b>. ${t.perk}`, kind: 'gold' });
      this.game.events.emit('ui:sfx', { kind: 'kin-mint' });
    }
    this.changed();
    return { ok: true, kin: -n };
  }

  // ───────────────────────────────────────────── world presence

  onMapChange(mapId: string): void {
    if (mapId !== 'town') return;
    const town = this.game.world.current;
    if (!town) return;
    if (!this.stall) {
      this.stall = buildKintaraStall();
      this.game.lighting.addNightLight(this.stall.light, 1.5);
      this.stall.setTier(this.fundTier());
      const def = { id: KEEPER.id, name: KEEPER.name, role: KEEPER.role, look: KEEPER.look, schedule: [[6, 'stall', 'read']], walk: { speed: 1, stride: 0.4, bounce: 0.03, sway: 0.1, hunch: 0.1, arms: 0.3 } } as unknown as NpcDef;
      this.keeper = new Villager(def);
      this.keeper.activity = 'read';
    }
    const g = this.stall.group;
    g.position.set(STALL.x, town.heightAt(STALL.x, STALL.z) - 0.02, STALL.z);
    g.rotation.y = STALL.rot;
    town.root.add(g);
    const k = this.keeper!;
    // The keeper stands at the open end of the counter (not behind the awning), leaning on it, facing the square.
    const lx = -1.95;
    const lz = 0.3;
    const kx = STALL.x + lx * Math.cos(STALL.rot) + lz * Math.sin(STALL.rot);
    const kz = STALL.z - lx * Math.sin(STALL.rot) + lz * Math.cos(STALL.rot);
    k.setPosition(kx, town.heightAt(kx, kz), kz);
    k.setYaw(STALL.rot + 0.3);
    town.root.add(k.root);
    this.stallMap = mapId;
    // Solid counter: the farmer walks up to it, never through it.
    for (let tz = 31; tz <= 32; tz++) for (let tx = 26; tx <= 29; tx++) town.grid.setObject(tx, tz, { kind: 'prop', id: 'kintara-stall', solid: true });
  }

  update(dt: number): void {
    if (this.stallMap !== 'town' || this.game.world.current?.id !== 'town' || !this.keeper) return;
    this.keeper.update(dt, (x, z) => this.game.world.current!.heightAt(x, z), !this.game.paused);
  }

  private nearStall(x: number, z: number): boolean {
    if (this.game.world.current?.id !== 'town') return false;
    const p = this.game.player.position;
    return Math.hypot(x + 0.5 - STALL.x, z + 0.5 - STALL.z) < 3.0 && Math.hypot(p.x - STALL.x, p.z - STALL.z) < 4.2;
  }

  private interactStall(x: number, z: number): void {
    if (!this.nearStall(x, z)) return;
    this.game.events.emit('ui:open', { name: 'kintara' });
  }

  // ───────────────────────────────────────────── adapters / debug

  useAdapter(a: ChainAdapter): void {
    this.chain = a;
    this.changed();
  }

  debugGrant(n: number): void {
    if (!this.authority) return;
    this.chain.emit(this.chain.address(), Math.max(0, Math.floor(n)), 'debug grant', this.dayIdx());
    this.st.met = true;
    this.changed();
  }

  debugEarn(source: EarnSource, amount: number, once?: string): number {
    return this.pay(source, amount, `Debug: ${SOURCES[source].label}`, once);
  }

  /** `demo('kintara')`: a lived-in wallet (only when nothing has been earned yet). */
  private stageDemo(name: string): void {
    if (!this.authority) return;
    this.st.met = true;
    if (this.st.earned === 0 && this.chain.deeds().length === 0) {
      const addr = this.chain.address();
      const d0 = Math.max(1, this.dayIdx() - 9);
      const log: [string, number, EarnSource][] = [
        ['First Silver Dace on the tally', 3, 'fish'],
        ['Shipping tally', 4, 'ship'],
        ['Notice-board job done', 3, 'quest'],
        ['Reached mine floor 5', 5, 'mine'],
        ['Shipped 1,000g in total', 3, 'ship'],
        ['Festival: first-place ribbon', 8, 'festival'],
        ['First Lantern Eel on the tally', 6, 'fish'],
        ['A Lantern Hall bundle filled', 12, 'hall'],
        ['Shipping tally', 7, 'ship'],
        ['Reached mine floor 10', 8, 'mine'],
      ];
      log.forEach(([label, n], i) => {
        this.chain.emit(addr, n, label, d0 + i);
        this.st.feed.push({ day: d0 + i, text: label, amount: n, kind: 'earn' });
        this.st.earned += n;
      });
      this.chain.emit(addr, 154, 'demo float', d0 + 9);
      this.st.earned += 154;
      const meta = (itemId: string, nm: string, category: DeedToken['category'], rarity: DeedToken['rarity'], quality: number, note: string) => ({ itemId, name: nm, category, rarity, quality, edition: 1, mintedBy: journal.name, date: this.dateText(), note });
      this.chain.mintDeed(addr, meta('pumpkin', 'Pumpkin', 'crop', 'rare', 2, 'gold harvest, Fall'), d0 + 10);
      this.chain.mintDeed(addr, meta('emberKoi', 'Ember Koi', 'fish', 'rare', 0, '58 cm, landed in Fall'), d0 + 10);
      this.chain.mintDeed(addr, meta('amethyst', 'Amethyst', 'gem', 'uncommon', 0, 'Cut from the Hollows (deepest floor 10)'), d0 + 10);
      this.chain.mintDeed(addr, meta('hoe', 'Hoe', 'tool', 'uncommon', 1, 'Copper tier, sealed by hand'), d0 + 10);
      this.st.fund = 80;
      this.st.once.push('hall');
      this.st.deepest = 10;
      this.feedAdd('Lantern Fund: oil for the Hall', -80, 'burn');
      this.chain.burn(addr, 20, 'demo', d0 + 10);
      this.st.burned += 20;
      this.changed();
    }
    // Things worth sealing, so the Mint tab has rows (only fills empty space; never in normal play).
    if (name !== 'kintara') {
      const inv = this.game.services.inventory;
      const give = (id: string, qty: number, q = 0): void => {
        if (!inv?.count(id) && itemDef(id)) inv?.add(id, qty, q);
      };
      give('cauliflower', 2, 2);
      give('lanternEel', 1, 1);
      give('ruby', 1);
      give('aquamarine', 1);
      give('bristleback', 1);
    }
  }

  // ───────────────────────────────────────────── co-op (net/bridge.ts)

  setAuthority(isHost: boolean): void {
    this.authority = isHost;
    this.changed();
  }

  snapshot(): unknown {
    return this.save();
  }

  applySnapshot(s: unknown): void {
    this.applying = true;
    try {
      const before = this.chain.deeds().length;
      this.restore(s);
      const after = this.chain.deeds();
      if (after.length > before && !this.authority) {
        const d = after[after.length - 1]!;
        if (d.mintedBy === journal.name) this.game.events.emit('kintara:minted', { deed: d, mine: true });
      }
    } finally {
      this.applying = false;
    }
  }

  /** Host: a farmhand's request. Re-validates everything; items travel back by kintara:grant. */
  applyIntent(peerStr: string, intent: unknown): void {
    if (!this.authority) return;
    const peer = Number(peerStr);
    const i = (intent ?? {}) as Record<string, unknown>;
    const refund = (itemId: string, quality: number, text: string): void => {
      this.game.events.emit('kintara:grant', { peer, items: { items: [{ itemId, qty: 1, quality }], text } });
    };
    switch (i.k) {
      case 'earn':
        this.earn(i);
        break;
      case 'mint': {
        const itemId = String(i.itemId);
        const quality = Math.max(0, Math.min(3, Math.floor(Number(i.quality) || 0)));
        const rule = deedRule(itemId, quality);
        const by = String(i.by ?? 'Farmhand').slice(0, 18);
        if (!rule || rule.attest) return refund(itemId, quality, 'Perpetua could not seal that. It is back in your pack.');
        const r = this.seal(itemId, quality, by);
        if (!r.ok) refund(itemId, quality, `${r.reason}. It is back in your pack.`);
        break;
      }
      case 'convert': {
        const q = this.quoteConvert(Number(i.kin));
        if (q.kin >= 1 && this.burn(q.kin, `Gold Counter: ${q.kin} kin for ${q.gold}g`, true)) {
          this.st.today.converted += q.kin;
          this.game.services.economy?.add(q.gold, 'kintara');
          this.changed();
        }
        break;
      }
      case 'buy': {
        const o = OFFERS.find((x) => x.id === String(i.offer));
        if (o) this.doBuy(o, peer);
        break;
      }
      case 'donate':
        this.doDonate(Math.floor(Number(i.kin) || 0));
        break;
    }
  }

  receiveGrant(g: unknown): void {
    const p = (Array.isArray(g) ? { items: g } : g) as { items?: { itemId: string; qty: number; quality?: number }[]; text?: string };
    for (const it of p.items ?? []) this.game.events.emit('item:give', { itemId: String(it.itemId), qty: Math.max(1, Math.floor(it.qty) || 1), quality: it.quality ?? 0 });
    if (p.text) this.game.events.emit('ui:toast', { text: p.text, kind: 'info' });
  }

  // ───────────────────────────────────────────── save / load

  save(): unknown {
    return { ...this.st, chain: this.chain.exportState() };
  }

  load(data: unknown): void {
    this.loadSeen = true;
    this.restore(data);
  }

  private restore(data: unknown): void {
    const d = data as Partial<State> | null;
    if (!d || d.v !== 1) return;
    this.chain.importState(d.chain);
    this.st = { ...this.fresh(), ...d, chain: null } as State;
    this.st.today = d.today ?? blankToday(this.dayKey());
    if (!this.chain.verify().ok) {
      console.warn('[kintara] ledger failed verification after load');
      this.game.events.emit('ui:toast', { text: 'The Kintara ledger did not verify. Perpetua is looking into it.', kind: 'bad' });
    }
    this.relabel();
    this.changed();
  }
}

// ─────────────────────────────────────────────── world: the stall and its keeper

/** Where the Exchange stands in Hearthvale square (south-west of the fountain, facing the camera). */
export const STALL = { x: 28.0, z: 32.6, rot: 0.32 };
