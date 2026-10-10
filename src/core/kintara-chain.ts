/**
 * Kintara chain layer: the ONLY place that knows how $KIN balances and deeds are recorded.
 *
 * `ChainAdapter` is the seam a real network would plug into. `SimulatedChain` (the default and the only
 * implementation shipped) is an in-memory, hash-linked ledger that lives inside the save file:
 *   - no wallet software, no private keys, no network access, nothing of real value. An "address" is a label
 *     derived from the farm's name so the UI has something to show;
 *   - every balance change is a transaction linked to the previous one by a hash, so a corrupted or edited
 *     save is detected by `verify()` (and the simulated supply is conserved: reserve + circulating + burned
 *     never changes).
 *
 * Wiring a real chain later means implementing `ChainAdapter` (optimistic local cache + `sync()` against the
 * node), then `game.services.kintara.useAdapter(adapter)`. Nothing else in the game talks to the chain.
 */

export type TxKind = 'genesis' | 'emit' | 'burn' | 'mint';

export interface ChainTx {
  /** Height (0-based, strictly increasing). */
  n: number;
  kind: TxKind;
  account: string;
  amount: number;
  memo: string;
  /** In-game day index the tx belongs to (year*112 + season*28 + day). */
  day: number;
  prev: string;
  hash: string;
}

/** Everything a deed records. Soulbound: the chain refuses to move one after it is minted. */
export interface DeedMeta {
  /** Item the deed attests ('keystone' for the story deed). */
  itemId: string;
  name: string;
  category: 'crop' | 'fish' | 'gem' | 'tool' | 'keepsake';
  rarity: 'common' | 'uncommon' | 'rare' | 'legendary';
  quality: number;
  edition: number;
  mintedBy: string;
  /** Human date, e.g. "Spring 5, Year 1". */
  date: string;
  /** Free-text provenance ("68 cm, Driftsand Beach", "Tier 2 hoe"…). */
  note: string;
}

export interface DeedToken extends DeedMeta {
  tokenId: string;
  owner: string;
  /** Always true: no transfer function exists. */
  soulbound: true;
  tx: string;
  serial: number;
}

export interface ChainSupply {
  /** Not yet emitted. */
  reserve: number;
  /** Sum of all balances. */
  circulating: number;
  /** Destroyed by sinks. */
  burned: number;
  deeds: number;
}

export interface ChainAdapter {
  readonly id: string;
  readonly network: string;
  /** True for the in-save ledger. A real adapter reports false and the UI says so. */
  readonly simulated: boolean;
  address(): string;
  balance(account?: string): number;
  /** Credit `amount` from the reserve to `to`; null when the reserve is empty / amount invalid. */
  emit(to: string, amount: number, memo: string, day: number): ChainTx | null;
  /** Destroy `amount` from `from`; null when the balance is too small. */
  burn(from: string, amount: number, memo: string, day: number): ChainTx | null;
  /** Record a soulbound deed for `to`. */
  mintDeed(to: string, meta: DeedMeta, day: number): DeedToken;
  deeds(owner?: string): DeedToken[];
  history(limit?: number): ChainTx[];
  supply(): ChainSupply;
  /** Re-walk the hash links. */
  verify(): { ok: boolean; height: number; head: string };
  /** Real chains reconcile their optimistic cache here; the simulation has nothing to do. */
  sync?(): Promise<void>;
  /** Serialize / restore (save file, co-op snapshots). */
  exportState(): unknown;
  importState(data: unknown): void;
}

/** cyrb53 → 14 hex digits. Not cryptographic: it only has to notice accidents. */
export function hash53(str: string, seed = 0): string {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return ((h2 >>> 0).toString(16).padStart(8, '0') + (h1 >>> 0).toString(16).padStart(8, '0')).slice(0, 14);
}

/** A readable fake address: "kin1" + 10 base32-ish characters derived from a label. No key exists behind it. */
export function addressFor(label: string): string {
  const alphabet = 'acdefghjklmnpqrstuvwxyz23456789';
  const h = hash53(`kin-address:${label}`) + hash53(`salt:${label}`, 7);
  let out = 'kin1';
  for (let i = 0; i < 12; i++) out += alphabet[parseInt(h.slice(i * 2, i * 2 + 2), 16) % alphabet.length];
  return out;
}

interface SimState {
  v: 1;
  address: string;
  reserve: number;
  burned: number;
  balances: Record<string, number>;
  txs: ChainTx[];
  /** Hash that precedes `txs[0]` (older entries are pruned to keep saves small). */
  base: string;
  pruned: number;
  deeds: DeedToken[];
  height: number;
}

const KEEP_TXS = 240;
const txHash = (t: Omit<ChainTx, 'hash'>): string => hash53(`${t.n}|${t.kind}|${t.account}|${t.amount}|${t.memo}|${t.day}|${t.prev}`);

export class SimulatedChain implements ChainAdapter {
  readonly id = 'sim';
  readonly network = 'Hearthvale Tally (simulated)';
  readonly simulated = true;
  private s: SimState;

  constructor(addressLabel: string, reserve: number) {
    const address = addressFor(addressLabel);
    const genesis: ChainTx = { n: 0, kind: 'genesis', account: 'reserve', amount: reserve, memo: 'the valley reserve is opened', day: 0, prev: '0', hash: '' };
    genesis.hash = txHash(genesis);
    this.s = { v: 1, address, reserve, burned: 0, balances: { [address]: 0 }, txs: [genesis], base: '0', pruned: 0, deeds: [], height: 1 };
  }

  address(): string {
    return this.s.address;
  }

  /** The farm was renamed: the address follows (balances move with it; this is a label, not a key). */
  relabel(label: string): void {
    const next = addressFor(label);
    if (next === this.s.address) return;
    const bal = this.s.balances[this.s.address] ?? 0;
    delete this.s.balances[this.s.address];
    this.s.balances[next] = bal;
    for (const d of this.s.deeds) if (d.owner === this.s.address) d.owner = next;
    this.s.address = next;
  }

  balance(account = this.s.address): number {
    return this.s.balances[account] ?? 0;
  }

  private push(kind: TxKind, account: string, amount: number, memo: string, day: number): ChainTx {
    const prev = this.s.txs[this.s.txs.length - 1]?.hash ?? this.s.base;
    const t: ChainTx = { n: this.s.height++, kind, account, amount, memo, day, prev, hash: '' };
    t.hash = txHash(t);
    this.s.txs.push(t);
    if (this.s.txs.length > KEEP_TXS) {
      const drop = this.s.txs.splice(0, this.s.txs.length - KEEP_TXS);
      this.s.base = drop[drop.length - 1]!.hash;
      this.s.pruned += drop.length;
    }
    return t;
  }

  emit(to: string, amount: number, memo: string, day: number): ChainTx | null {
    const n = Math.floor(amount);
    if (!(n > 0) || n > this.s.reserve) return null;
    this.s.reserve -= n;
    this.s.balances[to] = (this.s.balances[to] ?? 0) + n;
    return this.push('emit', to, n, memo, day);
  }

  burn(from: string, amount: number, memo: string, day: number): ChainTx | null {
    const n = Math.floor(amount);
    if (!(n > 0) || (this.s.balances[from] ?? 0) < n) return null;
    this.s.balances[from]! -= n;
    this.s.burned += n;
    return this.push('burn', from, n, memo, day);
  }

  mintDeed(to: string, meta: DeedMeta, day: number): DeedToken {
    const serial = this.s.deeds.length + 1;
    const tx = this.push('mint', to, 0, `deed #${serial} ${meta.itemId} q${meta.quality} ed${meta.edition}`, day);
    const tok: DeedToken = { ...meta, tokenId: `KD-${String(serial).padStart(4, '0')}`, owner: to, soulbound: true, tx: tx.hash, serial };
    this.s.deeds.push(tok);
    return tok;
  }

  deeds(owner?: string): DeedToken[] {
    return owner ? this.s.deeds.filter((d) => d.owner === owner) : [...this.s.deeds];
  }

  history(limit = 40): ChainTx[] {
    return this.s.txs.slice(-limit);
  }

  supply(): ChainSupply {
    let circulating = 0;
    for (const v of Object.values(this.s.balances)) circulating += v;
    return { reserve: this.s.reserve, circulating, burned: this.s.burned, deeds: this.s.deeds.length };
  }

  verify(): { ok: boolean; height: number; head: string } {
    let prev = this.s.base;
    for (const t of this.s.txs) {
      if (t.prev !== prev || t.hash !== txHash(t)) return { ok: false, height: this.s.height, head: prev };
      prev = t.hash;
    }
    return { ok: true, height: this.s.height, head: prev };
  }

  exportState(): unknown {
    return JSON.parse(JSON.stringify(this.s));
  }

  importState(data: unknown): void {
    const d = data as Partial<SimState> | null;
    if (!d || d.v !== 1 || !Array.isArray(d.txs) || !d.balances || typeof d.reserve !== 'number') return;
    this.s = JSON.parse(JSON.stringify(d)) as SimState;
  }
}
