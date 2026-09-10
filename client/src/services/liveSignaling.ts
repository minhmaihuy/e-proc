import { createClient, type RealtimeChannel, type SupabaseClient } from '@supabase/supabase-js';

export interface LiveIceServer {
  urls: string | string[];
  username?: string;
  credential?: string;
}

export interface LiveSessionConfig {
  enabled: boolean;
  transport?: 'self_hosted' | 'supabase';
  topic?: string;
  signalingToken?: string;
  signalingPath?: string;
  realtimeToken?: string;
  supabaseUrl?: string;
  supabasePublishableKey?: string;
  iceServers?: LiveIceServer[];
  turnAvailable?: boolean;
  expiresAt?: string;
}

export type LiveSignalEvent = 'watch-request' | 'offer' | 'answer' | 'ice-candidate' | 'hangup';

export interface LiveSignal {
  sender: 'student' | 'admin';
  viewerSessionId: string;
  target?: string;
  payload?: RTCSessionDescriptionInit | RTCIceCandidateInit | Record<string, never>;
}

const SIGNAL_EVENTS: LiveSignalEvent[] = ['watch-request', 'offer', 'answer', 'ice-candidate', 'hangup'];
const UUID_PATTERN = /^[0-9a-f-]{36}$/i;
const MAX_SIGNAL_BYTES = 64 * 1024;

export type LiveChannel =
  | { transport: 'self_hosted'; socket: WebSocket }
  | { transport: 'supabase'; client: SupabaseClient; channel: RealtimeChannel };

export async function openLiveChannel(
  config: LiveSessionConfig,
  onSignal: (event: LiveSignalEvent, signal: LiveSignal) => void,
): Promise<LiveChannel> {
  if (!config.enabled || !config.topic) {
    throw new Error('Live monitoring is not configured.');
  }
  if (config.transport === 'supabase') return openSupabaseChannel(config, onSignal);
  return openSelfHostedChannel(config, onSignal);
}

async function openSelfHostedChannel(
  config: LiveSessionConfig,
  onSignal: (event: LiveSignalEvent, signal: LiveSignal) => void,
): Promise<LiveChannel> {
  if (!config.signalingToken) throw new Error('Self-hosted signaling is not configured.');
  const endpoint = new URL(config.signalingPath || '/api/live/signaling', window.location.origin);
  endpoint.protocol = endpoint.protocol === 'https:' ? 'wss:' : 'ws:';
  const socket = new WebSocket(endpoint, ['eproc-live', config.signalingToken]);
  socket.addEventListener('message', (message) => {
    if (typeof message.data !== 'string' || message.data.length > MAX_SIGNAL_BYTES) return;
    try {
      const value = JSON.parse(message.data) as { event?: LiveSignalEvent; signal?: unknown };
      if (SIGNAL_EVENTS.includes(value.event as LiveSignalEvent) && isLiveSignal(value.signal)) onSignal(value.event!, value.signal);
    } catch { /* Invalid server payload must not affect the assessment. */ }
  });
  await new Promise<void>((resolve, reject) => {
    const timeout = window.setTimeout(() => reject(new Error('Signaling connection timed out.')), 12_000);
    socket.addEventListener('open', () => { window.clearTimeout(timeout); resolve(); }, { once: true });
    socket.addEventListener('error', () => { window.clearTimeout(timeout); reject(new Error('Signaling connection failed.')); }, { once: true });
    socket.addEventListener('close', () => { window.clearTimeout(timeout); reject(new Error('Signaling connection closed.')); }, { once: true });
  });
  return { transport: 'self_hosted', socket };
}

async function openSupabaseChannel(
  config: LiveSessionConfig,
  onSignal: (event: LiveSignalEvent, signal: LiveSignal) => void,
): Promise<LiveChannel> {
  if (!config.realtimeToken || !config.supabaseUrl || !config.supabasePublishableKey || !config.topic) {
    throw new Error('Supabase signaling is not configured.');
  }
  const client = createClient(config.supabaseUrl, config.supabasePublishableKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  client.realtime.setAuth(config.realtimeToken);
  const channel = client.channel(config.topic, { config: { private: true } });
  for (const event of SIGNAL_EVENTS) {
    channel.on('broadcast', { event }, ({ payload }) => {
      if (isLiveSignal(payload)) onSignal(event, payload);
    });
  }
  try {
    await new Promise<void>((resolve, reject) => {
      const timeout = window.setTimeout(() => reject(new Error('Signaling connection timed out.')), 12_000);
      channel.subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          window.clearTimeout(timeout);
          resolve();
        }
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          window.clearTimeout(timeout);
          reject(new Error(`Signaling channel ${status.toLowerCase()}.`));
        }
      });
    });
    return { transport: 'supabase', client, channel };
  } catch (error) {
    await client.removeChannel(channel);
    throw error;
  }
}

export function sendLiveSignal(channel: LiveChannel, event: LiveSignalEvent, signal: LiveSignal): void {
  if (!isLiveSignal(signal) || JSON.stringify(signal).length > MAX_SIGNAL_BYTES) return;
  if (channel.transport === 'self_hosted') {
    if (channel.socket.readyState === WebSocket.OPEN) channel.socket.send(JSON.stringify({ event, signal }));
    return;
  }
  void channel.channel.send({ type: 'broadcast', event, payload: signal });
}

export async function closeLiveChannel(channel: LiveChannel | null): Promise<void> {
  if (!channel) return;
  if (channel.transport === 'self_hosted') {
    if (channel.socket.readyState < WebSocket.CLOSING) channel.socket.close(1000, 'Ended');
    return;
  }
  await channel.client.removeChannel(channel.channel);
}

export function isLiveSignal(value: unknown): value is LiveSignal {
  if (!value || typeof value !== 'object') return false;
  const signal = value as Partial<LiveSignal>;
  return (signal.sender === 'student' || signal.sender === 'admin')
    && typeof signal.viewerSessionId === 'string'
    && UUID_PATTERN.test(signal.viewerSessionId)
    && (signal.target === undefined || (typeof signal.target === 'string' && UUID_PATTERN.test(signal.target)))
    && (signal.payload === undefined || (typeof signal.payload === 'object' && signal.payload !== null));
}
