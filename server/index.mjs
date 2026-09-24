#!/usr/bin/env node
/**
 * Hearthvale co-op relay + lobby server (no dependencies).
 *
 *   npm run server                 # ws://<host>:8787/ws   (PORT / --port to change)
 *   node server/index.mjs --port 0 # any free port (printed)
 *
 * - Lobbies with 6-char invite codes (1 host + up to 3 farmhands).
 * - The HOST's browser is authoritative: this server never simulates anything, it only relays
 *   game messages between the host and its farmhands (and doubles as a signaling channel, so peers
 *   can later upgrade to WebRTC P2P by relaying SDP / ICE through the same `R` messages).
 * - Rejoin: every peer gets a token; a dropped farmhand can reclaim its slot (same id) within
 *   REJOIN_MS; a dropped host gets HOST_GRACE_MS to come back before the lobby closes.
 * - Identity: farmhands send a persistent per-browser player id (`pid`, localStorage). A crashed tab
 *   (no session token) reclaims its held slot by pid; a second live tab with the same pid gets a
 *   derived pid (`<pid>~<id>`), so the host never mixes two players' personal saves.
 * - Names are unique per lobby ("Ash", "Ash 2"). A full lobby evicts a slot that has been away for
 *   EVICT_MS to make room. The host can kick a farmhand ({t:'kick', id}); a kicked pid is refused for
 *   KICK_BAN_MS.
 * - Also serves the production build (dist/) when present, so `npm run build && npm run server`
 *   is a complete one-port deployment.
 *
 * Wire format (text frames):
 *   control   JSON objects   {"t":"host"|"join"|"leave"|"ping"|"kick", ...}   ⇄   {"t":"hosted"|"joined"|"peer+"|"peer-"|"peer~"|"error"|"pong"|"closed"|"host~"|"host+", ...}
 *   relay     "R<to>|<payload>"  client → server   (<to> = peer id, or * for everyone else)
 *             "M<from>|<payload>" server → client  (payload is forwarded verbatim, never parsed)
 */
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { resolve, dirname, extname, join, normalize } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { randomBytes } from 'node:crypto';
import { acceptUpgrade } from './ws.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'dist');
const MAX_PLAYERS = 4;
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const REJOIN_MS = 120_000;
const HOST_GRACE_MS = 20_000;
const IDLE_MS = 30_000;
const EVICT_MS = 10_000;
const KICK_BAN_MS = 60_000;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.wasm': 'application/wasm',
};

/**
 * @typedef {{ id: number, name: string, look: unknown, token: string, conn: import('./ws.mjs').WsConn | null,
 *             lobby: Lobby, awayTimer: NodeJS.Timeout | null, awaySince: number, pid: string }} Peer
 * @typedef {{ code: string, hostId: number, peers: Map<number, Peer>, nextId: number, created: number,
 *             closeTimer: NodeJS.Timeout | null, relayed: number, banned: Map<string, number> }} Lobby
 */

export function startServer({ port = Number(process.env.PORT ?? 8787), host = '0.0.0.0', log = true, serveDist = true } = {}) {
  /** @type {Map<string, Lobby>} */
  const lobbies = new Map();
  const say = (...a) => log && console.log('[hv-server]', ...a);

  const newCode = () => {
    for (;;) {
      const b = randomBytes(6);
      let c = '';
      for (let i = 0; i < 6; i++) c += CODE_ALPHABET[b[i] % CODE_ALPHABET.length];
      if (!lobbies.has(c)) return c;
    }
  };
  const token = () => randomBytes(12).toString('hex');
  /** "Ash" → "Ash 2" if another farmer in the lobby already goes by that name. */
  const uniqueName = (lobby, name) => {
    const taken = new Set([...lobby.peers.values()].map((p) => p.name.toLowerCase()));
    if (!taken.has(name.toLowerCase())) return name;
    for (let n = 2; ; n++) {
      const cand = `${name.slice(0, 21)} ${n}`;
      if (!taken.has(cand.toLowerCase())) return cand;
    }
  };
  const clean = (s, n) => String(s ?? '').replace(/[\u0000-\u001f<>]/g, '').slice(0, n);

  const send = (peer, obj) => peer.conn?.send(typeof obj === 'string' ? obj : JSON.stringify(obj));
  const broadcast = (lobby, obj, exceptId = -1) => {
    const s = typeof obj === 'string' ? obj : JSON.stringify(obj);
    for (const p of lobby.peers.values()) if (p.id !== exceptId) p.conn?.send(s);
  };
  const roster = (lobby) => [...lobby.peers.values()].map((p) => ({ id: p.id, name: p.name, look: p.look, away: !p.conn }));

  const closeLobby = (lobby, reason) => {
    if (!lobbies.has(lobby.code)) return;
    lobbies.delete(lobby.code);
    for (const p of lobby.peers.values()) {
      if (p.awayTimer) clearTimeout(p.awayTimer);
      send(p, { t: 'closed', reason });
      p.conn?.close(1000, reason);
    }
    if (lobby.closeTimer) clearTimeout(lobby.closeTimer);
    say(`lobby ${lobby.code} closed (${reason})`);
  };

  const dropPeer = (peer, reason) => {
    const lobby = peer.lobby;
    if (!lobbies.has(lobby.code)) return;
    peer.conn = null;
    if (peer.id === lobby.hostId) {
      if (reason === 'left') return closeLobby(lobby, 'host-left');
      broadcast(lobby, { t: 'host~' });
      lobby.closeTimer = setTimeout(() => closeLobby(lobby, 'host-timeout'), HOST_GRACE_MS);
      say(`lobby ${lobby.code}: host dropped, grace ${HOST_GRACE_MS / 1000}s`);
      return;
    }
    if (reason === 'left') {
      lobby.peers.delete(peer.id);
      broadcast(lobby, { t: 'peer-', id: peer.id, reason });
      say(`lobby ${lobby.code}: ${peer.name}#${peer.id} left`);
      return;
    }
    // Keep the slot warm for a rejoin with the same token.
    peer.awaySince = Date.now();
    broadcast(lobby, { t: 'peer~', id: peer.id, reason });
    peer.awayTimer = setTimeout(() => {
      lobby.peers.delete(peer.id);
      broadcast(lobby, { t: 'peer-', id: peer.id, reason: 'timeout' });
    }, REJOIN_MS);
    say(`lobby ${lobby.code}: ${peer.name}#${peer.id} dropped (${reason}), slot held`);
  };

  const onConnection = (conn, remote) => {
    /** @type {Peer | null} */
    let me = null;

    conn.on('message', (raw) => {
      if (typeof raw !== 'string' || !raw.length) return;
      // Hot path: relay without parsing the payload.
      if (raw.charCodeAt(0) === 82 /* R */) {
        if (!me) return;
        const bar = raw.indexOf('|');
        if (bar < 0) return;
        const to = raw.slice(1, bar);
        const out = `M${me.id}|${raw.slice(bar + 1)}`;
        const lobby = me.lobby;
        lobby.relayed++;
        if (to === '*') {
          for (const p of lobby.peers.values()) if (p.id !== me.id) p.conn?.send(out);
        } else lobby.peers.get(Number(to))?.conn?.send(out);
        return;
      }
      let msg;
      try {
        msg = JSON.parse(raw);
      } catch {
        return;
      }
      switch (msg.t) {
        case 'ping':
          conn.send(JSON.stringify({ t: 'pong', c: msg.c, s: Date.now() }));
          return;
        case 'kick': {
          if (!me || me.id !== me.lobby.hostId) return;
          const lobby = me.lobby;
          const target = lobby.peers.get(Number(msg.id));
          if (!target || target.id === lobby.hostId) return;
          if (target.awayTimer) clearTimeout(target.awayTimer);
          lobby.peers.delete(target.id);
          if (target.pid) lobby.banned.set(target.pid, Date.now() + KICK_BAN_MS);
          send(target, { t: 'closed', reason: 'kicked' });
          target.conn?.close(1000, 'kicked');
          target.conn = null;
          broadcast(lobby, { t: 'peer-', id: target.id, reason: 'kicked' });
          say(`lobby ${lobby.code}: ${target.name}#${target.id} kicked`);
          return;
        }
        case 'host': {
          if (me) return;
          // Host rejoin within the grace period.
          if (msg.code && msg.token) {
            const lobby = lobbies.get(String(msg.code).toUpperCase());
            const hostPeer = lobby?.peers.get(lobby.hostId);
            if (lobby && hostPeer && hostPeer.token === msg.token && !hostPeer.conn) {
              if (lobby.closeTimer) clearTimeout(lobby.closeTimer);
              lobby.closeTimer = null;
              hostPeer.conn = conn;
              me = hostPeer;
              send(me, { t: 'hosted', code: lobby.code, id: me.id, token: me.token, peers: roster(lobby), rejoin: true });
              broadcast(lobby, { t: 'host+' }, me.id);
              say(`lobby ${lobby.code}: host back`);
              return;
            }
          }
          const lobby = { code: newCode(), hostId: 1, peers: new Map(), nextId: 2, created: Date.now(), closeTimer: null, relayed: 0, banned: new Map() };
          me = { id: 1, name: clean(msg.name, 24) || 'Host', look: msg.look ?? null, token: token(), conn, lobby, awayTimer: null, awaySince: 0, pid: clean(msg.pid, 48) };
          lobby.peers.set(1, me);
          lobbies.set(lobby.code, lobby);
          send(me, { t: 'hosted', code: lobby.code, id: 1, token: me.token, peers: roster(lobby) });
          say(`lobby ${lobby.code} opened by ${me.name} (${remote})`);
          return;
        }
        case 'join': {
          if (me) return;
          const code = String(msg.code ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
          const lobby = lobbies.get(code);
          if (!lobby) return void conn.send(JSON.stringify({ t: 'error', code: 'nolobby', text: `No farm with code ${code || '—'}` }));
          const pid = clean(msg.pid, 48).replace(/[^\w~-]/g, '');
          if (pid && (lobby.banned.get(pid) ?? 0) > Date.now()) return void conn.send(JSON.stringify({ t: 'error', code: 'kicked', text: 'The host asked you to leave this farm — try again in a minute' }));
          // Rejoin: reclaim the held slot (session token, or the same player's pid after a crash / new tab).
          {
            const farmhands = [...lobby.peers.values()].filter((p) => p.id !== lobby.hostId);
            const old = (msg.token ? farmhands.find((p) => p.token === msg.token) : null) ?? (pid ? farmhands.find((p) => p.pid === pid && !p.conn) : null);
            if (old) {
              if (old.awayTimer) clearTimeout(old.awayTimer);
              old.awayTimer = null;
              old.awaySince = 0;
              old.conn?.close(4000, 'replaced');
              old.conn = conn;
              if (msg.name) old.name = clean(msg.name, 24);
              if (msg.look) old.look = msg.look;
              me = old;
              send(me, { t: 'joined', code, id: me.id, token: me.token, pid: me.pid, hostId: lobby.hostId, peers: roster(lobby), rejoin: true });
              broadcast(lobby, { t: 'peer+', id: me.id, name: me.name, look: me.look, rejoin: true }, me.id);
              say(`lobby ${code}: ${me.name}#${me.id} rejoined`);
              return;
            }
          }
          if (lobby.peers.size >= MAX_PLAYERS) {
            // Make room: evict the farmhand that has been away the longest (if long enough).
            const now = Date.now();
            const away = [...lobby.peers.values()].filter((p) => p.id !== lobby.hostId && !p.conn && now - p.awaySince >= EVICT_MS).sort((a, b) => a.awaySince - b.awaySince)[0];
            if (!away) return void conn.send(JSON.stringify({ t: 'error', code: 'full', text: 'That farm already has 4 farmers' }));
            if (away.awayTimer) clearTimeout(away.awayTimer);
            lobby.peers.delete(away.id);
            broadcast(lobby, { t: 'peer-', id: away.id, reason: 'evicted' });
            say(`lobby ${code}: evicted away slot ${away.name}#${away.id}`);
          }
          const id = lobby.nextId++;
          // A second live tab of the same browser: derive a distinct pid (own backpack, own slot).
          const livePid = pid && [...lobby.peers.values()].some((p) => p.pid === pid);
          me = { id, name: uniqueName(lobby, clean(msg.name, 24) || `Farmhand ${id}`), look: msg.look ?? null, token: token(), conn, lobby, awayTimer: null, awaySince: 0, pid: pid ? (livePid ? `${pid}~${id}` : pid) : `anon-${token()}` };
          lobby.peers.set(id, me);
          send(me, { t: 'joined', code, id, token: me.token, pid: me.pid, name: me.name, hostId: lobby.hostId, peers: roster(lobby) });
          broadcast(lobby, { t: 'peer+', id, name: me.name, look: me.look }, id);
          say(`lobby ${code}: ${me.name}#${id} joined (${lobby.peers.size}/${MAX_PLAYERS})`);
          return;
        }
        case 'leave':
          if (me) dropPeer(me, 'left');
          me = null;
          conn.close(1000, 'bye');
          return;
        default:
          return;
      }
    });

    conn.on('close', () => {
      if (me && me.conn === conn) dropPeer(me, 'dropped');
    });
  };

  const http = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://x');
    if (url.pathname === '/health') {
      res.writeHead(200, { 'content-type': 'application/json', 'access-control-allow-origin': '*' });
      res.end(JSON.stringify({ ok: true, lobbies: lobbies.size, players: [...lobbies.values()].reduce((n, l) => n + l.peers.size, 0) }));
      return;
    }
    if (!serveDist) {
      res.writeHead(404);
      res.end('hearthvale relay');
      return;
    }
    try {
      let p = normalize(join(DIST, decodeURIComponent(url.pathname)));
      if (!p.startsWith(DIST)) throw new Error('outside');
      const st = await stat(p).catch(() => null);
      if (!st || st.isDirectory()) p = join(st ? p : DIST, 'index.html');
      const body = await readFile(p);
      res.writeHead(200, { 'content-type': MIME[extname(p)] ?? 'application/octet-stream' });
      res.end(body);
    } catch {
      res.writeHead(404, { 'content-type': 'text/plain' });
      res.end('Hearthvale relay is running. Build the game (npm run build) to serve it from here, or use npm run dev.');
    }
  });

  http.on('upgrade', (req, socket, head) => {
    const conn = acceptUpgrade(req, socket, head);
    if (conn) onConnection(conn, req.socket.remoteAddress ?? '?');
  });

  // Heartbeat: ping every 10 s, drop sockets silent for IDLE_MS.
  const beat = setInterval(() => {
    const now = Date.now();
    for (const lobby of lobbies.values()) {
      for (const p of lobby.peers.values()) {
        const c = p.conn;
        if (!c) continue;
        if (now - c.lastSeen > IDLE_MS) c.close(4001, 'idle');
        else c.ping();
      }
    }
  }, 10_000);
  beat.unref?.();

  return new Promise((resolveStart) => {
    http.listen(port, host, () => {
      const addr = http.address();
      const actual = typeof addr === 'object' && addr ? addr.port : port;
      say(`listening on ws://${host === '0.0.0.0' ? 'localhost' : host}:${actual}/ws${serveDist ? '  (serving dist/ over http too)' : ''}`);
      resolveStart({
        port: actual,
        lobbies,
        close: () =>
          new Promise((r) => {
            clearInterval(beat);
            for (const l of [...lobbies.values()]) closeLobby(l, 'server-stop');
            http.close(() => r());
            http.closeAllConnections?.();
          }),
      });
    });
  });
}

// Run directly: `node server/index.mjs [--port N]`
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const i = process.argv.indexOf('--port');
  const port = i > 0 ? Number(process.argv[i + 1]) : Number(process.env.PORT ?? 8787);
  startServer({ port });
}
