/**
 * Co-op bridge to the other pods' host-authoritative hooks (DESIGN §13). Every pod exposes a small
 * "the net layer drives this" surface on its service; this file is the only place that wires them to
 * the wire. Everything is duck-typed (a pod that hasn't shipped its hook yet is simply skipped).
 *
 *   animals / buildings   setAuthority(isHost) · host `<x>:changed` → snapshot() → farmhands
 *                         applySnapshot() · farmhand `<x>:intent` → host applyIntent(peer, intent) ·
 *                         host `<x>:grant` {peer, items} → that farmhand receiveGrant(items) ·
 *                         animals: host poses() at 4 Hz → farmhands applyPoses()
 *   story                 setRole('host'|'guest'|'solo') · `story:dirty` → netState() → applyNetState() ·
 *                         `story:scene` → guests playRemote(scene) · `story:choice` → guests
 *                         cutscene.resolveRemoteChoice(index)
 *   quests (hand-ins)     guest `quest:bundle` → host contributeRemote / contributeGoldRemote
 *   mines                 every 'm.*' payload → mineNet.receive(from, d) · setRole → mineNet.setLink({send})
 *   fishing               `fishing:net` snapshots relayed → fishing.remote(id, snap, t) · farmhand
 *                         setRoller(host round-trip → hostRoll(from, req)) · `fishing:claim` → validateCatch
 *
 * Wire kinds (inside the relay's game channel): 'rep' 'rint' 'rgrant' 'poses' 'rq' 'fish' 'froll'
 * 'frolled' 'fclaim' 'sscene' 'schoice'.
 */
import type { Game } from '../core/game';

type Fn = (...a: unknown[]) => unknown;
type Obj = Record<string, unknown>;

const call = (o: unknown, k: string, ...a: unknown[]): unknown => {
  const f = (o as Obj | null | undefined)?.[k];
  return typeof f === 'function' ? (f as Fn).apply(o, a) : undefined;
};
const has = (o: unknown, k: string): boolean => typeof (o as Obj | null | undefined)?.[k] === 'function';

interface Rep {
  service: string;
  changed: string;
  intent?: string;
  grant?: string;
  get: string;
  apply: string;
}

const REPS: Rep[] = [
  { service: 'animals', changed: 'animals:changed', intent: 'animals:intent', grant: 'animals:grant', get: 'snapshot', apply: 'applySnapshot' },
  { service: 'buildings', changed: 'buildings:changed', intent: 'buildings:intent', grant: 'buildings:grant', get: 'snapshot', apply: 'applySnapshot' },
  { service: 'story', changed: 'story:dirty', get: 'netState', apply: 'applyNetState' },
];

export interface BridgeLink {
  role(): 'solo' | 'host' | 'client';
  myId(): number;
  toHost(d: unknown[]): void;
  toAll(d: unknown[]): void;
  to(id: number, d: unknown[]): void;
  /** Peers standing on `map` (host side, for poses). */
  peersOn(map: string): number[];
}

export class NetBridge {
  private dirty = new Set<string>();
  private tRep = 0;
  private tPoses = 0;
  private applying = false;
  private rolls = new Map<number, (r: unknown) => void>();

  constructor(
    private game: Game,
    private link: BridgeLink,
  ) {
    const on = (name: string, fn: (p: Obj) => void): void => {
      (game.events as unknown as { on(n: string, f: (p: Obj) => void): void }).on(name, fn);
    };
    for (const r of REPS) {
      on(r.changed, () => {
        if (this.link.role() === 'host') this.dirty.add(r.service);
      });
      if (r.intent)
        on(r.intent, (p) => {
          if (this.link.role() === 'client' && !this.applying) this.link.toHost(['rint', r.service, p.intent]);
        });
      if (r.grant)
        on(r.grant, (p) => {
          if (this.link.role() === 'host') this.link.to(Number(p.peer), ['rgrant', r.service, p.items]);
        });
    }
    on('story:scene', (p) => {
      if (this.link.role() === 'host') this.link.toAll(['sscene', p.scene]);
    });
    on('story:choice', (p) => {
      if (this.link.role() === 'host') this.link.toAll(['schoice', p.scene, p.index]);
    });
    // Guest hand-ins at the Hall: forward (the host's netState comes back authoritative).
    on('quest:bundle', (p) => {
      if (this.link.role() !== 'client' || this.applying) return;
      this.link.toHost(['rq', p.bundleId, p.itemId, p.qty]);
    });
    on('fishing:net', (p) => {
      const role = this.link.role();
      if (role === 'solo') return;
      const msg = ['fish', this.link.myId(), p.snap ?? null, performance.now()];
      if (role === 'host') this.link.toAll(msg);
      else this.link.toHost(msg);
    });
    on('fishing:claim', (p) => {
      if (this.link.role() === 'client') this.link.toHost(['fclaim', p.claim]);
    });
  }

  private svc(name: string): unknown {
    return (this.game.services as Obj)[name];
  }

  /** Session role changed: hand authority to the host, make farmhands mirror. */
  setRole(role: 'solo' | 'host' | 'client'): void {
    const isHost = role !== 'client';
    call(this.svc('mineNet'), 'setLink', role === 'solo' ? null : { send: (to: number | '*' | 'host', d: unknown[]) => (to === 'host' ? this.link.toHost(d) : to === '*' ? this.link.toAll(d) : this.link.to(to, d)) });
    call(this.svc('animals'), 'setAuthority', isHost);
    call(this.svc('buildings'), 'setAuthority', isHost);
    call(this.svc('story'), 'setRole', role === 'host' ? 'host' : role === 'client' ? 'guest' : 'solo');
    const fishing = this.svc('fishing');
    if (role === 'client') {
      let rid = 1;
      call(fishing, 'setRoller', (req: Obj) => {
        const id = rid++;
        this.link.toHost(['froll', id, req]);
        return new Promise((resolve, reject) => {
          this.rolls.set(id, resolve);
          setTimeout(() => {
            if (this.rolls.delete(id)) reject(new Error('host roll timed out'));
          }, 4000);
        });
      });
    } else call(fishing, 'setRoller', null);
  }

  /** Host → a (re)joining farmhand: every replicated state at once. */
  snapshots(): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const r of REPS) {
      const s = this.svc(r.service);
      if (has(s, r.get)) out[r.service] = call(s, r.get);
    }
    return out;
  }

  applySnapshots(all: Record<string, unknown> | undefined): void {
    if (!all) return;
    for (const r of REPS) if (r.service in all) this.applyRep(r, all[r.service]);
  }

  private applyRep(r: Rep, data: unknown): void {
    this.applying = true;
    try {
      call(this.svc(r.service), r.apply, data);
    } catch (err) {
      console.error(`[net] ${r.service}.${r.apply} failed`, err);
    } finally {
      this.applying = false;
    }
  }

  /** Returns true when the message was a bridge message. */
  handle(kind: string, from: number, d: unknown[]): boolean {
    const role = this.link.role();
    // Mines (world/mine/coop.ts): every 'm.*' payload goes to the mineNet service.
    if (kind.startsWith('m.')) {
      call(this.svc('mineNet'), 'receive', from, d);
      return true;
    }
    switch (kind) {
      case 'rep': {
        const r = REPS.find((x) => x.service === d[1]);
        if (r && role === 'client') this.applyRep(r, d[2]);
        return true;
      }
      case 'rint': {
        if (role === 'host') call(this.svc(String(d[1])), 'applyIntent', String(from), d[2]);
        return true;
      }
      case 'rgrant': {
        if (role === 'client') call(this.svc(String(d[1])), 'receiveGrant', d[2]);
        return true;
      }
      case 'poses': {
        if (role === 'client') call(this.svc('animals'), 'applyPoses', d[1]);
        return true;
      }
      case 'rq': {
        if (role !== 'host') return true;
        const [, bundleId, itemId, qty] = d as [string, string, string, number];
        const q = this.svc('quests');
        if (itemId === 'gold') call(q, 'contributeGoldRemote', bundleId, qty);
        else call(q, 'contributeRemote', bundleId, itemId, qty);
        return true;
      }
      case 'sscene': {
        if (role === 'client') void call(this.svc('story'), 'playRemote', d[1]);
        return true;
      }
      case 'schoice': {
        if (role === 'client') call(this.svc('cutscene'), 'resolveRemoteChoice', d[2]);
        return true;
      }
      case 'fish': {
        const [, id, snap, t] = d as [string, number, unknown, number];
        const sender = role === 'host' ? from : id;
        if (sender === this.link.myId()) return true;
        call(this.svc('fishing'), 'remote', sender, snap, role === 'host' ? t : undefined);
        // Host relays a farmhand's angling to everyone else.
        if (role === 'host') for (const p of this.link.peersOn('*')) if (p !== from) this.link.to(p, ['fish', from, snap, t]);
        return true;
      }
      case 'froll': {
        if (role !== 'host') return true;
        const roll = call(this.svc('fishing'), 'hostRoll', from, d[2]);
        this.link.to(from, ['frolled', d[1], roll ?? null]);
        return true;
      }
      case 'frolled': {
        const res = this.rolls.get(Number(d[1]));
        if (res) {
          this.rolls.delete(Number(d[1]));
          res(d[2]);
        }
        return true;
      }
      case 'fclaim': {
        if (role === 'host') {
          const ok = call(this.svc('fishing'), 'validateCatch', from, d[1]);
          if (ok === false) console.warn(`[net] farmhand ${from}: catch claim did not match an issued roll`);
        }
        return true;
      }
    }
    return false;
  }

  /** Is `id` currently fishing (their RemoteAngler draws the rod, so the farmer shouldn't)? */
  fishing(id: number): boolean {
    return call(this.svc('fishing'), 'remoteActive', id) === true;
  }

  /** Host: throttled rebroadcast of dirty replicated state + animal poses. */
  tick(dt: number): void {
    if (this.link.role() !== 'host') return;
    this.tRep += dt;
    if (this.tRep >= 0.25 && this.dirty.size) {
      this.tRep = 0;
      for (const name of this.dirty) {
        const r = REPS.find((x) => x.service === name)!;
        const s = this.svc(name);
        if (has(s, r.get)) this.link.toAll(['rep', name, call(s, r.get)]);
      }
      this.dirty.clear();
    }
    this.tPoses += dt;
    if (this.tPoses >= 0.25) {
      this.tPoses = 0;
      const a = this.svc('animals');
      if (!has(a, 'poses')) return;
      const p = call(a, 'poses') as { map?: string; list?: unknown[] } | undefined;
      if (!p || !p.map || !p.list?.length) return;
      for (const id of this.link.peersOn(p.map)) this.link.to(id, ['poses', p]);
    }
  }
}
