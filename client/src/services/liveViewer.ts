import type { RealtimeChannel, SupabaseClient } from '@supabase/supabase-js';
import { closeLiveChannel, openLiveChannel, sendLiveSignal, type LiveSessionConfig, type LiveSignal } from './liveSignaling';

export type LiveViewerStatus = 'connecting' | 'connected-direct' | 'connected-relay' | 'failed' | 'ended';

export interface LiveViewer {
  stop(): Promise<void>;
}

export async function startLiveViewer(
  config: LiveSessionConfig & { viewerSessionId: string },
  callbacks: { onStream(stream: MediaStream): void; onStatus(status: LiveViewerStatus): void },
): Promise<LiveViewer> {
  let client: SupabaseClient | null = null;
  let channel: RealtimeChannel | null = null;
  let peer: RTCPeerConnection | null = null;
  let stopped = false;
  let timeout: number | null = null;
  const pendingCandidates: RTCIceCandidateInit[] = [];

  const close = async (notify: boolean, status: LiveViewerStatus) => {
    if (stopped) return;
    stopped = true;
    if (timeout !== null) window.clearTimeout(timeout);
    if (notify && channel) {
      sendLiveSignal(channel, 'hangup', { sender: 'admin', viewerSessionId: config.viewerSessionId, target: config.viewerSessionId });
    }
    peer?.close();
    await closeLiveChannel(client, channel);
    callbacks.onStatus(status);
  };

  const classifyTransport = async () => {
    if (!peer) return;
    const stats = await peer.getStats();
    let localCandidate: (RTCStats & { candidateType?: string }) | undefined;
    stats.forEach((item) => {
      const candidatePair = item as RTCStats & { selected?: boolean; localCandidateId?: string };
      if (item.type === 'candidate-pair' && candidatePair.selected && candidatePair.localCandidateId) {
        localCandidate = stats.get(candidatePair.localCandidateId) as (RTCStats & { candidateType?: string }) | undefined;
      }
    });
    callbacks.onStatus(localCandidate?.candidateType === 'relay'
      ? 'connected-relay'
      : 'connected-direct');
  };

  const handleSignal = async (event: string, signal: LiveSignal) => {
    if (stopped || signal.sender !== 'student' || signal.target !== config.viewerSessionId) return;
    if (event === 'hangup') return close(false, 'ended');
    if (event === 'ice-candidate' && signal.payload) {
      const candidate = signal.payload as RTCIceCandidateInit;
      if (!peer?.remoteDescription) pendingCandidates.push(candidate);
      else await peer.addIceCandidate(candidate).catch(() => undefined);
      return;
    }
    if (event !== 'offer' || !signal.payload || peer) return;

    peer = new RTCPeerConnection({ iceServers: config.iceServers });
    peer.ontrack = ({ streams }) => { if (streams[0]) callbacks.onStream(streams[0]); };
    peer.onicecandidate = ({ candidate }) => {
      if (candidate && channel) sendLiveSignal(channel, 'ice-candidate', {
        sender: 'admin', viewerSessionId: config.viewerSessionId, target: config.viewerSessionId, payload: candidate.toJSON(),
      });
    };
    peer.onconnectionstatechange = () => {
      if (peer?.connectionState === 'connected') void classifyTransport();
      if (peer?.connectionState === 'failed') void close(true, 'failed');
    };
    try {
      await peer.setRemoteDescription(signal.payload as RTCSessionDescriptionInit);
      for (const candidate of pendingCandidates.splice(0)) await peer.addIceCandidate(candidate);
      const answer = await peer.createAnswer();
      await peer.setLocalDescription(answer);
      if (channel) sendLiveSignal(channel, 'answer', {
        sender: 'admin', viewerSessionId: config.viewerSessionId, target: config.viewerSessionId, payload: answer,
      });
    } catch {
      await close(true, 'failed');
    }
  };

  const opened = await openLiveChannel(config, (event, signal) => { void handleSignal(event, signal); });
  client = opened.client;
  channel = opened.channel;
  callbacks.onStatus('connecting');
  sendLiveSignal(channel, 'watch-request', { sender: 'admin', viewerSessionId: config.viewerSessionId });
  timeout = window.setTimeout(() => { void close(true, 'failed'); }, 20_000);

  return { stop: async () => close(true, 'ended') };
}
