import { studentApi } from './api';
import * as examRecorder from './examRecorder';
import { closeLiveChannel, openLiveChannel, sendLiveSignal, type LiveChannel, type LiveSessionConfig, type LiveSignal, type LiveSignalEvent } from './liveSignaling';

// Một thí sinh chỉ phục vụ một tenant_admin cùng lúc. Một admin vẫn có thể xem
// nhiều thí sinh vì mỗi thí sinh dùng một topic WebRTC độc lập.
const MAX_VIEWERS_PER_STUDENT = 1;

export interface LivePublisher {
  stop(): Promise<void>;
}

export async function startLivePublisher(): Promise<LivePublisher | null> {
  const response = await studentApi.getLiveSession();
  const config = response.data as LiveSessionConfig;
  if (!config.enabled) return null;

  let channel: LiveChannel | null = null;
  const peers = new Map<string, RTCPeerConnection>();
  let stopped = false;

  const closePeer = (viewerSessionId: string, notify = false) => {
    const peer = peers.get(viewerSessionId);
    if (!peer) return;
    peers.delete(viewerSessionId);
    if (notify && channel) {
      sendLiveSignal(channel, 'hangup', { sender: 'student', viewerSessionId, target: viewerSessionId });
    }
    peer.close();
  };

  const syncCapture = (capture: MediaStream | null) => {
    for (const [viewerSessionId, peer] of peers) {
      const track = capture?.getVideoTracks()[0] || null;
      const sender = peer.getSenders().find((item) => item.track?.kind === 'video');
      if (sender && track && track.readyState === 'live') {
        void sender.replaceTrack(track).catch(() => closePeer(viewerSessionId, true));
      } else {
        closePeer(viewerSessionId, true);
      }
    }
  };
  const unsubscribeCapture = examRecorder.onCaptureStreamChanged(syncCapture);

  const handleSignal = async (event: LiveSignalEvent, signal: LiveSignal) => {
    if (stopped || signal.sender !== 'admin') return;
    if (event === 'hangup' && signal.target) return closePeer(signal.target);
    if (event !== 'watch-request' || peers.size >= MAX_VIEWERS_PER_STUDENT || peers.has(signal.viewerSessionId)) return;

    const capture = examRecorder.getCaptureStream();
    const track = capture?.getVideoTracks()[0];
    if (!capture || !track || track.readyState !== 'live') return;

    const peer = new RTCPeerConnection({ iceServers: config.iceServers });
    peers.set(signal.viewerSessionId, peer);
    peer.addTrack(track, capture);
    peer.onicecandidate = ({ candidate }) => {
      if (candidate && channel) sendLiveSignal(channel, 'ice-candidate', {
        sender: 'student', viewerSessionId: signal.viewerSessionId, target: signal.viewerSessionId, payload: candidate.toJSON(),
      });
    };
    peer.onconnectionstatechange = () => {
      if (peer.connectionState === 'failed' || peer.connectionState === 'closed') closePeer(signal.viewerSessionId);
    };
    try {
      const offer = await peer.createOffer();
      await peer.setLocalDescription(offer);
      if (channel) sendLiveSignal(channel, 'offer', {
        sender: 'student', viewerSessionId: signal.viewerSessionId, target: signal.viewerSessionId, payload: offer,
      });
    } catch {
      closePeer(signal.viewerSessionId);
    }
  };

  const opened = await openLiveChannel(config, (event, signal) => {
    if (event === 'answer' && signal.sender === 'admin' && signal.target) {
      const peer = peers.get(signal.target);
      if (peer && signal.payload) void peer.setRemoteDescription(signal.payload as RTCSessionDescriptionInit).catch(() => closePeer(signal.target!));
      return;
    }
    if (event === 'ice-candidate' && signal.sender === 'admin' && signal.target) {
      const peer = peers.get(signal.target);
      if (peer && signal.payload) void peer.addIceCandidate(signal.payload as RTCIceCandidateInit).catch(() => undefined);
      return;
    }
    void handleSignal(event, signal);
  });
  channel = opened;

  return {
    async stop() {
      if (stopped) return;
      stopped = true;
      unsubscribeCapture();
      for (const viewerSessionId of [...peers.keys()]) closePeer(viewerSessionId, true);
      await closeLiveChannel(channel);
    },
  };
}
