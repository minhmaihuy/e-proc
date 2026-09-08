import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LiveSignal, LiveSignalEvent } from './liveSignaling';

const signalingMocks = vi.hoisted(() => ({
  closeLiveChannel: vi.fn(),
  openLiveChannel: vi.fn(),
  sendLiveSignal: vi.fn(),
}));

vi.mock('./liveSignaling', async () => {
  const actual = await vi.importActual<typeof import('./liveSignaling')>('./liveSignaling');
  return { ...actual, ...signalingMocks };
});

import { startLiveViewer } from './liveViewer';

class MockPeerConnection {
  static instances: MockPeerConnection[] = [];

  connectionState: RTCPeerConnectionState = 'new';
  remoteDescription: RTCSessionDescription | null = null;
  onconnectionstatechange: ((this: RTCPeerConnection, event: Event) => unknown) | null = null;
  onicecandidate: ((this: RTCPeerConnection, event: RTCPeerConnectionIceEvent) => unknown) | null = null;
  ontrack: ((this: RTCPeerConnection, event: RTCTrackEvent) => unknown) | null = null;

  constructor() {
    MockPeerConnection.instances.push(this);
  }

  async setRemoteDescription(description: RTCSessionDescriptionInit): Promise<void> {
    this.remoteDescription = description as RTCSessionDescription;
  }

  async addIceCandidate(): Promise<void> {}

  async createAnswer(): Promise<RTCSessionDescriptionInit> {
    return { type: 'answer', sdp: 'test-answer' };
  }

  async setLocalDescription(): Promise<void> {}

  async getStats(): Promise<RTCStatsReport> {
    return new Map() as RTCStatsReport;
  }

  close(): void {}
}

const viewerSessionId = '3c51e1af-e5f6-4ba8-9db7-1aebcd19b070';

describe('startLiveViewer', () => {
  let onSignal: ((event: LiveSignalEvent, signal: LiveSignal) => void) | null = null;

  beforeEach(() => {
    vi.useFakeTimers();
    MockPeerConnection.instances = [];
    vi.stubGlobal('RTCPeerConnection', MockPeerConnection);
    signalingMocks.openLiveChannel.mockImplementation(async (
      _config: unknown,
      callback: (event: LiveSignalEvent, signal: LiveSignal) => void,
    ) => {
      onSignal = callback;
      return { socket: {} as WebSocket };
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('does not close an established viewer after the connection timeout', async () => {
    await startLiveViewer({
      enabled: true,
      topic: 'live:tenant:fsa-cls:batch:2:student:123:attempt:0123456789abcdef01234567',
      signalingToken: 'test-token',
      viewerSessionId,
    }, {
      onStream: vi.fn(),
      onStatus: vi.fn(),
    });

    onSignal?.('offer', {
      sender: 'student',
      viewerSessionId,
      target: viewerSessionId,
      payload: { type: 'offer', sdp: 'test-offer' },
    });
    await Promise.resolve();
    await Promise.resolve();

    const peer = MockPeerConnection.instances[0];
    if (!peer) throw new Error('Expected the viewer to create a peer connection.');
    peer.connectionState = 'connected';
    peer.onconnectionstatechange?.call(peer as unknown as RTCPeerConnection, new Event('connectionstatechange'));
    await Promise.resolve();

    await vi.advanceTimersByTimeAsync(20_000);
    expect(signalingMocks.closeLiveChannel).not.toHaveBeenCalled();
  });
});
