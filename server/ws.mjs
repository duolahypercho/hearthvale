/**
 * Minimal RFC 6455 WebSocket server connection (no dependencies).
 *
 * Handles the HTTP upgrade handshake, masked client frames, fragmentation, ping/pong and close.
 * Text frames only are surfaced as 'message' (string); binary frames are surfaced as Buffers.
 * Good enough for a lobby relay: payloads are small JSON / packed-text game messages.
 */
import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const MAX_PAYLOAD = 8 * 1024 * 1024;

/**
 * Complete the upgrade handshake on `socket`. Returns a WsConn or null (bad request → 400).
 * @param {import('node:http').IncomingMessage} req
 * @param {import('node:stream').Duplex} socket
 * @param {Buffer} head
 */
export function acceptUpgrade(req, socket, head) {
  const key = req.headers['sec-websocket-key'];
  if (req.headers.upgrade?.toLowerCase() !== 'websocket' || typeof key !== 'string') {
    socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
    return null;
  }
  const accept = createHash('sha1').update(key + GUID).digest('base64');
  socket.write(
    'HTTP/1.1 101 Switching Protocols\r\n' +
      'Upgrade: websocket\r\n' +
      'Connection: Upgrade\r\n' +
      `Sec-WebSocket-Accept: ${accept}\r\n\r\n`,
  );
  const conn = new WsConn(socket);
  if (head && head.length) conn.feed(head);
  return conn;
}

export class WsConn extends EventEmitter {
  /** @param {import('node:stream').Duplex} socket */
  constructor(socket) {
    super();
    this.socket = socket;
    this.buf = Buffer.alloc(0);
    this.frags = [];
    this.fragOp = 0;
    this.open = true;
    this.lastSeen = Date.now();
    this.bytesIn = 0;
    this.bytesOut = 0;
    if (typeof socket.setNoDelay === 'function') socket.setNoDelay(true);
    socket.on('data', (d) => this.feed(d));
    socket.on('close', () => this.finish(1006, 'socket closed'));
    socket.on('error', () => this.finish(1006, 'socket error'));
  }

  /** @param {Buffer} data */
  feed(data) {
    this.lastSeen = Date.now();
    this.bytesIn += data.length;
    this.buf = this.buf.length ? Buffer.concat([this.buf, data]) : data;
    for (;;) {
      const b = this.buf;
      if (b.length < 2) return;
      const fin = (b[0] & 0x80) !== 0;
      const op = b[0] & 0x0f;
      const masked = (b[1] & 0x80) !== 0;
      let len = b[1] & 0x7f;
      let off = 2;
      if (len === 126) {
        if (b.length < 4) return;
        len = b.readUInt16BE(2);
        off = 4;
      } else if (len === 127) {
        if (b.length < 10) return;
        const big = b.readBigUInt64BE(2);
        if (big > BigInt(MAX_PAYLOAD)) return this.fail(1009, 'frame too large');
        len = Number(big);
        off = 10;
      }
      if (len > MAX_PAYLOAD) return this.fail(1009, 'frame too large');
      const maskOff = off;
      if (masked) off += 4;
      if (b.length < off + len) return;
      let payload = b.subarray(off, off + len);
      if (masked) {
        const m0 = b[maskOff];
        const m1 = b[maskOff + 1];
        const m2 = b[maskOff + 2];
        const m3 = b[maskOff + 3];
        const out = Buffer.allocUnsafe(len);
        for (let i = 0; i < len; i++) {
          const m = (i & 3) === 0 ? m0 : (i & 3) === 1 ? m1 : (i & 3) === 2 ? m2 : m3;
          out[i] = payload[i] ^ m;
        }
        payload = out;
      } else payload = Buffer.from(payload);
      this.buf = b.subarray(off + len);
      this.frame(fin, op, payload);
      if (!this.open) return;
    }
  }

  frame(fin, op, payload) {
    if (op === 0x8) {
      // Close: echo and end.
      const code = payload.length >= 2 ? payload.readUInt16BE(0) : 1005;
      this.sendFrame(0x8, payload.subarray(0, 2));
      this.finish(code, payload.subarray(2).toString('utf8'));
      this.socket.end();
      return;
    }
    if (op === 0x9) return this.sendFrame(0xa, payload);
    if (op === 0xa) return;
    if (op === 0x0) {
      this.frags.push(payload);
      if (!fin) return;
      const all = Buffer.concat(this.frags);
      this.frags = [];
      return this.deliver(this.fragOp, all);
    }
    if (!fin) {
      this.fragOp = op;
      this.frags = [payload];
      return;
    }
    this.deliver(op, payload);
  }

  deliver(op, payload) {
    if (op === 0x1) this.emit('message', payload.toString('utf8'));
    else if (op === 0x2) this.emit('message', payload);
  }

  /** Send a text (string) or binary (Buffer) message. */
  send(data) {
    if (!this.open) return false;
    if (typeof data === 'string') return this.sendFrame(0x1, Buffer.from(data, 'utf8'));
    return this.sendFrame(0x2, data);
  }

  ping() {
    this.sendFrame(0x9, Buffer.alloc(0));
  }

  sendFrame(op, payload) {
    if (this.socket.destroyed) return false;
    const len = payload.length;
    let head;
    if (len < 126) {
      head = Buffer.from([0x80 | op, len]);
    } else if (len < 65536) {
      head = Buffer.alloc(4);
      head[0] = 0x80 | op;
      head[1] = 126;
      head.writeUInt16BE(len, 2);
    } else {
      head = Buffer.alloc(10);
      head[0] = 0x80 | op;
      head[1] = 127;
      head.writeBigUInt64BE(BigInt(len), 2);
    }
    this.bytesOut += head.length + len;
    // One write per frame (Nagle is off): header + payload in a single packet.
    this.socket.write(len ? Buffer.concat([head, payload], head.length + len) : head);
    return true;
  }

  close(code = 1000, reason = '') {
    if (!this.open) return;
    const r = Buffer.from(String(reason).slice(0, 100), 'utf8');
    const p = Buffer.alloc(2 + r.length);
    p.writeUInt16BE(code, 0);
    r.copy(p, 2);
    this.sendFrame(0x8, p);
    this.finish(code, reason);
    setTimeout(() => this.socket.destroy(), 200).unref?.();
  }

  fail(code, reason) {
    this.close(code, reason);
  }

  finish(code, reason) {
    if (!this.open) return;
    this.open = false;
    this.emit('close', code, reason);
  }
}
