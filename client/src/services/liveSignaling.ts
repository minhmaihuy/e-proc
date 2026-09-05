import { createClient, type RealtimeChannel, type SupabaseClient } from '@supabase/supabase-js';

export interface LiveIceServer {
  urls: string | string[];
  username?: string;
  credential?: string;
}

export interface LiveSessionConfig {
  enabled: boolean;
  topic?: string;
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

export async function openLiveChannel(
  config: LiveSessionConfig,
  onSignal: (event: LiveSignalEvent, signal: LiveSignal) => void,
): Promise<{ client: SupabaseClient; channel: RealtimeChannel }> {
  if (!config.enabled || !config.topic || !config.realtimeToken || !config.supabaseUrl || !config.supabasePublishableKey) {
    throw new Error('Live monitoring is not configured.');
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
    return { client, channel };
  } catch (error) {
    await client.removeChannel(channel);
    throw error;
  }
}

export function sendLiveSignal(channel: RealtimeChannel, event: LiveSignalEvent, signal: LiveSignal): void {
  if (!isLiveSignal(signal) || JSON.stringify(signal).length > MAX_SIGNAL_BYTES) return;
  void channel.send({ type: 'broadcast', event, payload: signal });
}

export async function closeLiveChannel(client: SupabaseClient | null, channel: RealtimeChannel | null): Promise<void> {
  if (client && channel) await client.removeChannel(channel);
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
