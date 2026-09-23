/**
 * Browser side of the relay connection (server/index.mjs): lobby control messages (JSON) and the
 * relayed game channel ("R<to>|payload" out, "M<from>|payload" in). Game payloads are packed JSON
 * arrays (see net/protocol.ts). Reconnects with backoff and rejoins with the lobby token.
 */

export type Ctrl =
  | { t: 'hosted'; code: string; id: number; token: string; peers: PeerInfo[]; rejoin?: boolean }
  | { t: 'joined'; code: string; id: number; token: string; hostId: number; peers: PeerInfo[]; rejoin?: boolean }
  | { t: 'peer+'; id: number; name: string; look: unknown; rejoin?: boolean }
  | { t: 'peer-'; id: number; reason: string }
  | { t: 'peer~'; id: number; reason: string }
  | { t: 'host~' }
  | { t: 'host+' }
  | { t: 'error'; code: string; text: string }
  | { t: 'closed'; reason: string }
  | { t: 'pong'; c: number; s: number };

export interface PeerInfo {
  id: number;
  name: string;
  look: unknown;
  away?: boolean;
}

export interface TransportHandlers {
  ctrl(msg: Ctrl): void;
  game(from: number, payload: unknown[]): void;
  status(s: 'connecting' | 'open' | 'reconnecting' | 'closed'): void;
}

/** Default relay URL: `?server=` param, then localStorage, then this host on :8787. */
export function defaultServerUrl(): string {
  try {
    const q = new URLSearchParams(location.search).get('server');
    if (q) return q;
    const s = localStorage.getItem('hearthvale.server');
    if (s) return s;
  } catch {
    /* ignore */
  }
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const host = location.hostname || '127.0.0.1';
  return `${proto}://${host}:8787/ws`;
}

export class Transport {
  private ws: WebSocket | null = null;
  private closedByUser = false;
  private retry = 0;
  private retryTimer = 0;
  /** Sent on every (re)connect before anything else (host / join with token). */
  hello: (() => object) | null = null;
  bytesOut = 0;
  bytesIn = 0;
  msgsIn = 0;
  msgsOut = 0;

  constructor(
    readonly url: string,
    private h: TransportHandlers,
  ) {}

  connect(): void {
    this.closedByUser = false;
    this.open();
  }

  private open(): void {
    this.h.status(this.retry ? 'reconnecting' : 'connecting');
    let ws: WebSocket;
    try {
      ws = new WebSocket(this.url);
    } catch (err) {
      console.warn('[net] bad server url', this.url, err);
      this.h.ctrl({ t: 'error', code: 'url', text: `Can't reach ${this.url}` });
      this.h.status('closed');
      return;
    }
    this.ws = ws;
    ws.onopen = () => {
      this.retry = 0;
      this.h.status('open');
      const hi = this.hello?.();
      if (hi) this.sendCtrl(hi);
    };
    ws.onmessage = (e) => {
      const s = e.data as string;
      if (typeof s !== 'string' || !s.length) return;
      this.bytesIn += s.length;
      this.msgsIn++;
      if (s.charCodeAt(0) === 77 /* M */) {
        const bar = s.indexOf('|');
        if (bar < 0) return;
        const from = Number(s.slice(1, bar));
        let payload: unknown;
        try {
          payload = JSON.parse(s.slice(bar + 1));
        } catch {
          return;
        }
        if (Array.isArray(payload)) this.h.game(from, payload);
        return;
      }
      try {
        this.h.ctrl(JSON.parse(s) as Ctrl);
      } catch {
        /* ignore */
      }
    };
    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.ws = null;
      if (this.closedByUser) {
        this.h.status('closed');
        return;
      }
      // Backoff: 0.5 s, 1 s, 2 s … 8 s; give up after ~10 tries.
      this.retry++;
      if (this.retry > 10) {
        this.h.status('closed');
        this.h.ctrl({ t: 'closed', reason: 'unreachable' });
        return;
      }
      this.h.status('reconnecting');
      const wait = Math.min(8000, 500 * 2 ** (this.retry - 1));
      this.retryTimer = window.setTimeout(() => this.open(), wait);
    };
    ws.onerror = () => {
      /* onclose follows */
    };
  }

  get isOpen(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  sendCtrl(obj: object): void {
    if (!this.isOpen) return;
    const s = JSON.stringify(obj);
    this.bytesOut += s.length;
    this.ws!.send(s);
  }

  /** Relay a game message to one peer id or '*' (everyone else). */
  send(to: number | '*', payload: unknown[]): void {
    if (!this.isOpen) return;
    const s = `R${to}|${JSON.stringify(payload)}`;
    this.bytesOut += s.length;
    this.msgsOut++;
    this.ws!.send(s);
  }

  close(): void {
    this.closedByUser = true;
    clearTimeout(this.retryTimer);
    if (this.ws) {
      try {
        if (this.isOpen) this.ws.send(JSON.stringify({ t: 'leave' }));
        this.ws.close();
      } catch {
        /* ignore */
      }
    }
    this.ws = null;
  }

  /** Drop the socket without leaving (tests: simulate a network blip → auto rejoin). */
  drop(): void {
    this.ws?.close();
  }
}
