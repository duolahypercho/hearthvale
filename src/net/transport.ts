/**
 * Browser side of the relay connection (server/index.mjs): lobby control messages (JSON) and the
 * relayed game channel ("R<to>|payload" out, "M<from>|payload" in). Game payloads are packed JSON
 * arrays. Reconnects with backoff and rejoins with the lobby token.
 *
 * The socket itself lives in a Web Worker (net/socket-worker.ts) so network RTT, heartbeats and
 * ping answers never wait for a rendered frame; if workers are unavailable it falls back to a
 * main-thread WebSocket (then RTT is measured with app pings instead).
 *
 * Reliable delivery across blips: while the socket is down, every non-volatile game message is
 * queued (volatile = 20 Hz state like 'st' / 's' / 'p', which is simply superseded) and flushed,
 * in order, once the lobby has re-admitted us (flush() after 'joined' / 'hosted').
 */

export type Ctrl =
  | { t: 'hosted'; code: string; id: number; token: string; peers: PeerInfo[]; rejoin?: boolean }
  | { t: 'joined'; code: string; id: number; token: string; pid?: string; name?: string; hostId: number; peers: PeerInfo[]; rejoin?: boolean }
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

/** Game message kinds that are superseded by the next one (never queued while offline). */
const VOLATILE = new Set(['st', 's', 'p', 'ping', 'pong', 'poses', 'cal', 'fish']);
const MAX_QUEUE = 400;

type Sock = {
  open(url: string): void;
  send(s: string): void;
  close(leave: boolean): void;
  drop(): void;
  setPingTo(id: number | null): void;
  readonly isWorker: boolean;
};

export class Transport {
  private sock: Sock;
  private isOpenFlag = false;
  private closedByUser = false;
  private retry = 0;
  private retryTimer = 0;
  /** Messages waiting for the socket (sent in order by flush()). */
  private queue: string[] = [];
  /** Admitted to the lobby on the current socket (ctrl 'joined' / 'hosted' seen). */
  private admitted = false;
  /** Sent on every (re)connect before anything else (host / join with token). */
  hello: (() => object) | null = null;
  bytesOut = 0;
  bytesIn = 0;
  msgsIn = 0;
  msgsOut = 0;
  /** Network RTT through the relay to the host (farmhands; worker-timed), ms. */
  peerRtt = 0;
  /** RTT to the relay server itself, ms. */
  relayRtt = 0;

  constructor(
    readonly url: string,
    private h: TransportHandlers,
  ) {
    this.sock = this.makeSock();
  }

  private makeSock(): Sock {
    const onOpen = (): void => this.onOpen();
    const onClose = (): void => this.onClose();
    const onMsg = (s: string): void => this.onMessage(s);
    let worker: Worker | null = null;
    try {
      worker = new Worker(new URL('./socket-worker.ts', import.meta.url), { type: 'module', name: 'hv-socket' });
    } catch {
      worker = null;
    }
    if (worker) {
      const w = worker;
      w.onmessage = (e: MessageEvent) => {
        const m = e.data as { k: string; s?: string; peer?: number; relay?: number };
        if (m.k === 'msg') onMsg(m.s!);
        else if (m.k === 'open') onOpen();
        else if (m.k === 'close') onClose();
        else if (m.k === 'rtt') {
          if (m.peer) this.peerRtt = m.peer;
          if (m.relay) this.relayRtt = m.relay;
        }
      };
      return {
        isWorker: true,
        open: (url) => w.postMessage({ k: 'open', url }),
        send: (s) => w.postMessage({ k: 'send', s }),
        close: (leave) => {
          w.postMessage({ k: 'close', leave });
          // Let the goodbye frame go out, then free the thread.
          setTimeout(() => w.terminate(), 400);
        },
        drop: () => w.postMessage({ k: 'drop' }),
        setPingTo: (id) => w.postMessage({ k: 'cfg', pingTo: id }),
      };
    }
    // Fallback: a main-thread socket.
    let ws: WebSocket | null = null;
    return {
      isWorker: false,
      open: (url) => {
        let s: WebSocket;
        try {
          s = new WebSocket(url);
        } catch {
          onClose();
          return;
        }
        ws = s;
        s.onopen = () => ws === s && onOpen();
        s.onmessage = (e) => ws === s && typeof e.data === 'string' && onMsg(e.data);
        s.onclose = () => {
          if (ws !== s) return;
          ws = null;
          onClose();
        };
      },
      send: (s) => ws?.readyState === WebSocket.OPEN && ws.send(s),
      close: (leave) => {
        const s = ws;
        ws = null;
        try {
          if (leave && s?.readyState === WebSocket.OPEN) s.send('{"t":"leave"}');
          s?.close();
        } catch {
          /* ignore */
        }
      },
      drop: () => ws?.close(),
      setPingTo: () => {},
    };
  }

  /** Worker-timed RTT available (else the caller measures with app pings). */
  get timedInWorker(): boolean {
    return this.sock.isWorker;
  }

  connect(): void {
    this.closedByUser = false;
    this.open();
  }

  private open(): void {
    this.h.status(this.retry ? 'reconnecting' : 'connecting');
    this.isOpenFlag = false;
    this.admitted = false;
    this.sock.open(this.url);
  }

  private onOpen(): void {
    this.retry = 0;
    this.isOpenFlag = true;
    this.h.status('open');
    const hi = this.hello?.();
    if (hi) this.sendCtrl(hi);
  }

  private onMessage(s: string): void {
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
  }

  private onClose(): void {
    const was = this.isOpenFlag;
    this.isOpenFlag = false;
    this.admitted = false;
    if (this.closedByUser) {
      this.h.status('closed');
      return;
    }
    void was;
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
  }

  get isOpen(): boolean {
    return this.isOpenFlag;
  }

  sendCtrl(obj: object): void {
    if (!this.isOpenFlag) return;
    const s = JSON.stringify(obj);
    this.bytesOut += s.length;
    this.sock.send(s);
  }

  /** The lobby re-admitted us: send everything that queued up while we were away. */
  flush(): void {
    this.admitted = true;
    const q = this.queue;
    this.queue = [];
    for (const s of q) this.raw(s);
  }

  /** Farmhands: time app pings to this peer (the host) in the worker. */
  setPingTarget(id: number | null): void {
    this.sock.setPingTo(id);
  }

  private raw(s: string): void {
    this.bytesOut += s.length;
    this.msgsOut++;
    this.sock.send(s);
  }

  /** Relay a game message to one peer id or '*' (everyone else). Queued while disconnected. */
  send(to: number | '*', payload: unknown[]): void {
    const s = `R${to}|${JSON.stringify(payload)}`;
    if (this.isOpenFlag && this.admitted) {
      this.raw(s);
      return;
    }
    if (this.closedByUser || VOLATILE.has(payload[0] as string)) return;
    this.queue.push(s);
    if (this.queue.length > MAX_QUEUE) this.queue.shift();
  }

  close(): void {
    this.closedByUser = true;
    clearTimeout(this.retryTimer);
    this.sock.close(true);
    this.isOpenFlag = false;
    this.queue = [];
  }

  /** Drop the socket without leaving (tests: simulate a network blip → auto rejoin). */
  drop(): void {
    this.sock.drop();
  }

  /** Messages waiting for a reconnect. */
  get queued(): number {
    return this.queue.length;
  }
}
