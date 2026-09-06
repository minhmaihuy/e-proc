import crypto from 'node:crypto';
import type { IncomingMessage, Server } from 'node:http';
import type { Duplex } from 'node:stream';
import jwt from 'jsonwebtoken';

const PATHNAME = '/api/live/signaling';
const PROTOCOL = 'eproc-live';
const MAX_MESSAGE_BYTES = 64 * 1024;
const MAX_MESSAGES_PER_WINDOW = 80;
const RATE_WINDOW_MS = 10_000;
const UUID_PATTERN = /^[0-9a-f-]{36}$/i;
const TOPIC_PATTERN = /^live:tenant:[a-z0-9][a-z0-9-]{0,62}:batch:[1-9]\d*:student:[1-9]\d*:attempt:[a-f0-9]{24}$/;

export type LiveSignalEvent = 'watch-request' | 'offer' | 'answer' | 'ice-candidate' | 'hangup';
const LIVE_EVENTS = new Set<LiveSignalEvent>(['watch-request', 'offer', 'answer', 'ice-candidate', 'hangup']);

interface LiveSignal {
  sender: 'student' | 'admin';
  viewerSessionId: string;
  target?: string;
  payload?: Record<string, unknown>;
}

interface SignalingClaims extends jwt.JwtPayload {
  topic?: string;
  actor?: 'student' | 'admin';
  viewer_session_id?: string;
}

interface SignalingClient {
  socket: Duplex;
  topic: string;
  actor: 'student' | 'admin';
  viewerSessionId?: string;
  buffer: Buffer;
  sentAt: number[];
  lastSeenAt: number;
  closed: boolean;
}

function close(socket: Duplex, code = 1008, reason = 'Policy violation'): void {
  if (socket.destroyed) return;
  const bytes = Buffer.from(reason.slice(0, 120));
  const payload = Buffer.allocUnsafe(2 + bytes.length);
  payload.writeUInt16BE(code, 0);
  bytes.copy(payload, 2);
  sendFrame(socket, 0x8, payload);
  socket.end();
}

function sendFrame(socket: Duplex, opcode: number, payload: Buffer): void {
  if (socket.destroyed || payload.length > MAX_MESSAGE_BYTES) return;
  const header = payload.length < 126
    ? Buffer.from([0x80 | opcode, payload.length])
    : Buffer.from([0x80 | opcode, 126, payload.length >> 8, payload.length & 0xff]);
  socket.write(Buffer.concat([header, payload]));
}

function isLiveSignal(value: unknown): value is LiveSignal {
  if (!value || typeof value !== 'object') return false;
  const signal = value as Partial<LiveSignal>;
  return (signal.sender === 'student' || signal.sender === 'admin')
    && typeof signal.viewerSessionId === 'string' && UUID_PATTERN.test(signal.viewerSessionId)
    && (signal.target === undefined || (typeof signal.target === 'string' && UUID_PATTERN.test(signal.target)))
    && (signal.payload === undefined || (typeof signal.payload === 'object' && signal.payload !== null));
}

export function verifyLiveSignalingToken(token: string): SignalingClaims | null {
  try {
    const claims = jwt.verify(token, process.env.JWT_SECRET || '', {
      algorithms: ['HS256'], audience: 'eproc-live-signaling', issuer: 'eproc-live-signaling',
    }) as SignalingClaims;
    if (!TOPIC_PATTERN.test(claims.topic || '') || (claims.actor !== 'student' && claims.actor !== 'admin')) return null;
    if (claims.actor === 'admin' && !UUID_PATTERN.test(claims.viewer_session_id || '')) return null;
    return claims;
  } catch {
    return null;
  }
}

function tokenFromProtocols(request: IncomingMessage): string | null {
  const protocols = String(request.headers['sec-websocket-protocol'] || '').split(',').map((value) => value.trim());
  const index = protocols.indexOf(PROTOCOL);
  const token = index >= 0 ? protocols[index + 1] : null;
  return token && /^[A-Za-z0-9._-]{32,4096}$/.test(token) ? token : null;
}

function isAllowedOrigin(request: IncomingMessage, allowedOrigins: readonly string[]): boolean {
  const origin = request.headers.origin;
  return typeof origin === 'string' && allowedOrigins.includes(origin);
}

export function attachSelfHostedLiveSignaling(server: Server, allowedOrigins: readonly string[]): void {
  const topics = new Map<string, Set<SignalingClient>>();

  // Browsers reply to protocol Ping frames automatically. Close stale sockets so
  // an interrupted network cannot retain a room member indefinitely.
  const heartbeat = setInterval(() => {
    const cutoff = Date.now() - 60_000;
    for (const peers of topics.values()) {
      for (const client of peers) {
        if (client.lastSeenAt < cutoff) close(client.socket, 1001, 'Connection timed out');
        else sendFrame(client.socket, 0x9, Buffer.alloc(0));
      }
    }
  }, 25_000);
  heartbeat.unref();
  server.once('close', () => clearInterval(heartbeat));

  const remove = (client: SignalingClient) => {
    if (client.closed) return;
    client.closed = true;
    const peers = topics.get(client.topic);
    peers?.delete(client);
    if (peers?.size === 0) topics.delete(client.topic);
  };

  const send = (client: SignalingClient, event: LiveSignalEvent, signal: LiveSignal) => {
    sendFrame(client.socket, 0x1, Buffer.from(JSON.stringify({ event, signal })));
  };

  const receive = (client: SignalingClient, text: string) => {
    if (Buffer.byteLength(text) > MAX_MESSAGE_BYTES) return close(client.socket, 1009, 'Message too large');
    const now = Date.now();
    client.sentAt = client.sentAt.filter((at) => now - at < RATE_WINDOW_MS);
    if (client.sentAt.length >= MAX_MESSAGES_PER_WINDOW) return close(client.socket, 1008, 'Rate limited');
    client.sentAt.push(now);
    let value: { event?: unknown; signal?: unknown };
    try { value = JSON.parse(text); } catch { return close(client.socket, 1003, 'Invalid JSON'); }
    if (!LIVE_EVENTS.has(value.event as LiveSignalEvent) || !isLiveSignal(value.signal)) return close(client.socket, 1003, 'Invalid signal');
    const event = value.event as LiveSignalEvent;
    const signal = value.signal;
    if (signal.sender !== client.actor || (client.actor === 'admin' && signal.viewerSessionId !== client.viewerSessionId)) {
      return close(client.socket, 1008, 'Signal is not authorized');
    }
    for (const peer of topics.get(client.topic) || []) if (peer !== client) send(peer, event, signal);
  };

  const consumeFrames = (client: SignalingClient) => {
    while (client.buffer.length >= 2) {
      const first = client.buffer[0];
      const second = client.buffer[1];
      const fin = (first & 0x80) !== 0;
      const opcode = first & 0x0f;
      const masked = (second & 0x80) !== 0;
      let length = second & 0x7f;
      let offset = 2;
      if (!fin || !masked || length === 127) return close(client.socket, 1003, 'Unsupported frame');
      if (length === 126) {
        if (client.buffer.length < 4) return;
        length = client.buffer.readUInt16BE(2);
        offset = 4;
      }
      if (length > MAX_MESSAGE_BYTES) return close(client.socket, 1009, 'Message too large');
      const frameLength = offset + 4 + length;
      if (client.buffer.length < frameLength) return;
      const mask = client.buffer.subarray(offset, offset + 4);
      const payload = Buffer.from(client.buffer.subarray(offset + 4, frameLength));
      for (let index = 0; index < payload.length; index += 1) payload[index] ^= mask[index % 4];
      client.buffer = client.buffer.subarray(frameLength);
      client.lastSeenAt = Date.now();
      if (opcode === 0x8) return close(client.socket, 1000, 'Closed');
      if (opcode === 0x9) { sendFrame(client.socket, 0xA, payload); continue; }
      if (opcode === 0xA) continue;
      if (opcode !== 0x1) return close(client.socket, 1003, 'Text frames only');
      receive(client, payload.toString('utf8'));
    }
  };

  server.on('upgrade', (request, socket, head) => {
    const requestUrl = new URL(request.url || '/', 'http://localhost');
    if (requestUrl.pathname !== PATHNAME) return socket.destroy();
    if (!isAllowedOrigin(request, allowedOrigins)) return socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
    const token = tokenFromProtocols(request);
    const claims = token ? verifyLiveSignalingToken(token) : null;
    const key = request.headers['sec-websocket-key'];
    if (!claims || typeof key !== 'string' || request.headers['sec-websocket-version'] !== '13') {
      return socket.end('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
    }
    const client: SignalingClient = {
      socket, topic: claims.topic!, actor: claims.actor!, viewerSessionId: claims.viewer_session_id,
      buffer: Buffer.alloc(0), sentAt: [], lastSeenAt: Date.now(), closed: false,
    };
    const peers = topics.get(client.topic) || new Set<SignalingClient>();
    for (const peer of peers) if (peer.actor === client.actor) close(peer.socket, 1000, 'Replaced by a newer session');
    peers.add(client);
    topics.set(client.topic, peers);
    const accept = crypto.createHash('sha1').update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest('base64');
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\nSec-WebSocket-Protocol: ${PROTOCOL}\r\n\r\n`);
    if (head.length) { client.buffer = Buffer.from(head); consumeFrames(client); }
    socket.on('data', (chunk) => { client.buffer = Buffer.concat([client.buffer, chunk]); consumeFrames(client); });
    socket.on('close', () => remove(client));
    socket.on('error', () => remove(client));
  });
}
