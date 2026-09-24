/**
 * Co-op socket worker: owns the relay WebSocket off the main thread (net/transport.ts talks to it).
 *
 * Why a worker: the main thread spends most of every frame rendering, so a socket there only sees
 * messages between frames. Here the socket is serviced immediately, which gives
 *  - honest network RTT: app pings (["~ping", t]) are answered by the *peer's worker* straight away
 *    and timed here, so the number is relay + network latency, not "a frame on each side";
 *  - a relay ping (ctrl {t:'ping'}) for the client ↔ server leg;
 *  - heartbeats that keep flowing while the main thread is busy (long loads, map changes).
 *
 * main → worker  {k:'open', url} · {k:'send', s} · {k:'close', leave} · {k:'drop'} · {k:'cfg', pingTo}
 * worker → main  {k:'open'} · {k:'close'} · {k:'msg', s} · {k:'rtt', peer, relay}
 */

interface WorkerScope {
  onmessage: ((e: MessageEvent) => void) | null;
  postMessage(m: unknown): void;
}
const scope = self as unknown as WorkerScope;

let ws: WebSocket | null = null;
let pingTo: number | null = null;
let seqPing = 0;
let timer = 0;

const post = (m: unknown): void => scope.postMessage(m);

/** Round-trip samples → median of the last 9 (a busy machine's spikes don't move it). */
class Rtt {
  private s: number[] = [];
  value = 0;
  add(v: number): number {
    this.s.push(v);
    if (this.s.length > 9) this.s.shift();
    const o = [...this.s].sort((a, b) => a - b);
    this.value = o[o.length >> 1]!;
    return this.value;
  }
  reset(): void {
    this.s.length = 0;
    this.value = 0;
  }
}
const peer = new Rtt();
const relay = new Rtt();

function tick(): void {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  const now = performance.now();
  seqPing++;
  ws.send(JSON.stringify({ t: 'ping', c: now }));
  if (pingTo !== null) ws.send(`R${pingTo}|["~ping",${now}]`);
}

function open(url: string): void {
  let sock: WebSocket;
  try {
    sock = new WebSocket(url);
  } catch {
    post({ k: 'close', bad: true });
    return;
  }
  ws = sock;
  sock.onopen = () => {
    if (ws !== sock) return;
    post({ k: 'open' });
    tick();
  };
  sock.onmessage = (e: MessageEvent) => {
    if (ws !== sock) return;
    const s = e.data as string;
    if (typeof s !== 'string' || !s.length) return;
    // Fast paths: answer / time app pings without waking the main thread.
    if (s.charCodeAt(0) === 77 /* M */) {
      const bar = s.indexOf('|');
      if (bar > 0 && s.charCodeAt(bar + 3) === 126 /* ~ */) {
        const from = s.slice(1, bar);
        const body = s.slice(bar + 1);
        if (body.startsWith('["~ping",')) {
          sock.send(`R${from}|["~pong",${body.slice(9, -1)}]`);
          return;
        }
        if (body.startsWith('["~pong",')) {
          const t = Number(body.slice(9, -1));
          if (Number.isFinite(t)) {
            post({ k: 'rtt', peer: peer.add(performance.now() - t), relay: relay.value });
          }
          return;
        }
      }
    } else if (s.startsWith('{"t":"pong"')) {
      try {
        const m = JSON.parse(s) as { c?: number };
        if (typeof m.c === 'number') relay.add(performance.now() - m.c);
        if (pingTo === null) post({ k: 'rtt', peer: 0, relay: relay.value });
      } catch {
        /* ignore */
      }
      return;
    }
    post({ k: 'msg', s });
  };
  sock.onclose = () => {
    if (ws !== sock) return;
    ws = null;
    post({ k: 'close' });
  };
  sock.onerror = () => {
    /* onclose follows */
  };
}

scope.onmessage = (e: MessageEvent) => {
  const m = e.data as { k: string; url?: string; s?: string; leave?: boolean; pingTo?: number | null };
  switch (m.k) {
    case 'open':
      if (ws) {
        const old = ws;
        ws = null;
        try {
          old.close();
        } catch {
          /* ignore */
        }
      }
      peer.reset();
      relay.reset();
      open(m.url!);
      if (!timer) timer = setInterval(tick, 1000) as unknown as number;
      return;
    case 'send':
      if (ws && ws.readyState === WebSocket.OPEN) ws.send(m.s!);
      return;
    case 'cfg':
      pingTo = m.pingTo ?? null;
      peer.reset();
      return;
    case 'close': {
      const old = ws;
      ws = null;
      if (old) {
        try {
          if (m.leave && old.readyState === WebSocket.OPEN) old.send('{"t":"leave"}');
          old.close();
        } catch {
          /* ignore */
        }
      }
      clearInterval(timer);
      timer = 0;
      return;
    }
    case 'drop':
      // Tests: a network blip (the main thread sees a close and reconnects).
      ws?.close();
      return;
  }
};
