/**
 * Dev-only visual fixtures. These render real screens from static snapshots
 * and a synthetic analyser so layouts can be inspected without audio. They
 * prove nothing about playback; see tests/e2e for real WebRTC audio tests.
 */
import { useState } from 'react';
import type { RendererStats } from '../core/renderer';
import { Store } from '../session/store';
import type { GuestSnapshot, HostSnapshot, LocalAudioView, SpeakerView } from '../session/types';
import { HelpDrawer } from '../ui/HelpDrawer';
import { LiveRegion } from '../ui/primitives/Feedback';
import { GuestRoom, type GuestRoomController } from '../ui/screens/room/GuestRoom';
import { HostRoom, type HostRoomController } from '../ui/screens/room/HostRoom';
import { TopBar } from '../ui/TopBar';

function fakeAnalyser(level: number): AnalyserNode {
  return {
    fftSize: 1024,
    getFloatTimeDomainData(buf: Float32Array) {
      const t = performance.now() / 1000;
      const env = level * (0.55 + 0.3 * Math.sin(t * 2.1) + 0.15 * Math.sin(t * 7.3));
      for (let i = 0; i < buf.length; i++) buf[i] = env * Math.sin((i / buf.length) * 2 * Math.PI * 9 + t * 40);
    },
  } as unknown as AnalyserNode;
}

const stats = (over: Partial<RendererStats> = {}): RendererStats => ({
  state: 'playing',
  sessionId: 1,
  epoch: 1,
  sourceRate: 48000,
  outputRate: 48000,
  packets: 18234,
  invalidPackets: 0,
  staleSessionPackets: 0,
  staleEpochPackets: 0,
  latePackets: 0,
  lateFrames: 0,
  earlyFrames: 0,
  duplicateFrames: 0,
  framesPlayed: 17_310_000,
  missingFrames: 0,
  underruns: 0,
  resyncs: 0,
  jumps: 1,
  bufferedMs: 1186,
  errorMs: 0.12,
  correctionPpm: 41,
  level: 0.08,
  peak: 0.4,
  sourcePosition: 0,
  outputFrame: 0,
  ...over,
});

const local = (over: Partial<LocalAudioView> = {}): LocalAudioView => ({
  volume: 0.85,
  muted: false,
  trimMs: 0,
  contextState: 'running',
  renderer: stats(),
  timing: {
    timingValid: true,
    anchorSource: 'output-timestamp',
    anchorResidualMs: 0.4,
    localSlope: 1000.012,
    hostSlope: 999.991,
    outputRate: 48000,
    sourceRate: 48000,
    commonBufferMs: 1200,
    trimMs: 0,
    outputLatencyMs: 11.6,
    baseLatencyMs: 2.7,
  },
  outputGain: 0.72,
  ...over,
});

const speaker = (id: string, name: string, role: 'host' | 'guest', phase: SpeakerView['phase'], order: number, over: Partial<SpeakerView> = {}): SpeakerView => ({
  id,
  name,
  role,
  phase,
  muted: false,
  volume: 0.85,
  level: phase === 'playing' ? 0.06 : 0,
  order,
  isSelf: false,
  ...over,
});

function hostSnapshot(over: Partial<HostSnapshot> = {}): HostSnapshot {
  return {
    kind: 'host',
    stage: 'open',
    failure: null,
    code: '0047',
    inviteUrl: `${location.origin}/?room=0047`,
    sessionId: 1,
    locked: false,
    signaling: 'online',
    hostName: 'Maya’s MacBook Pro',
    speakers: [speaker('host', 'Maya’s MacBook Pro', 'host', 'ready', 0, { isSelf: true })],
    capture: { status: 'idle', error: null, suppression: 'unknown', inputActive: false, trackMuted: false, sharingSince: null },
    local: local({ renderer: stats({ state: 'buffering', level: 0 }) }),
    mutedAll: false,
    commonBufferMs: 1200,
    clicksActive: false,
    links: [],
    maxSpeakers: 5,
    outputChanged: false,
    ...over,
  };
}

const ACTIVE_SPEAKERS: SpeakerView[] = [
  speaker('host', 'Maya’s MacBook Pro', 'host', 'playing', 0, { isSelf: true, level: 0.07 }),
  speaker('g1', 'Sam’s MacBook Air', 'guest', 'playing', 1, { level: 0.06, volume: 0.7 }),
  speaker('g2', 'Lena’s Mac', 'guest', 'playing', 2, { muted: true }),
  speaker('g3', 'Office MacBook', 'guest', 'reconnecting', 3, { level: null }),
];

function guestSnapshot(over: Partial<GuestSnapshot> = {}): GuestSnapshot {
  const selfPhase = over.phase ?? 'playing';
  return {
    kind: 'guest',
    stage: 'joined',
    joinError: null,
    code: '0047',
    hostName: 'Maya’s MacBook Pro',
    selfId: 'g1',
    speakers: ACTIVE_SPEAKERS.map((s) => (s.id === 'g1' ? { ...s, isSelf: true, phase: selfPhase } : { ...s, isSelf: false })),
    audio: 'on',
    phase: 'playing',
    sharing: 'sharing',
    sourceActive: true,
    local: local(),
    clock: { thetaMs: 182_341.27, rttMs: 3.4, uncertaintyMs: 1.7, samples: 41 },
    reconnectAttempt: 0,
    maxReconnectAttempts: 8,
    audioChannel: { ordered: false, maxRetransmits: null, maxPacketLifeTime: null, protocol: null },
    packetsReceived: 18234,
    clicksActive: false,
    outputChanged: false,
    commonBufferMs: 1200,
    ...over,
  };
}

const noop = () => undefined;

function hostController(snapshot: HostSnapshot, level: number): HostRoomController {
  const a = fakeAnalyser(level);
  const store = new Store(snapshot);
  const patchLocal = (p: Partial<LocalAudioView>) => store.update((s) => ({ ...s, local: { ...s.local, ...p } }));
  return {
    store,
    engine: { inputAnalyser: a, outputAnalyser: a },
    shareTab: noop,
    stopSharing: noop,
    dismissCaptureError: noop,
    playTestClicks: noop,
    setVolume: (volume) => patchLocal({ volume }),
    setMuted: (muted) => patchLocal({ muted }),
    setTrim: (trimMs) => patchLocal({ trimMs }),
    setCommonBuffer: noop,
    setHostName: noop,
    setLocked: noop,
    resyncSelf: noop,
    resyncAll: noop,
    setGuestMuted: noop,
    setGuestVolume: noop,
    setAllMuted: noop,
    removeGuest: noop,
    end: async () => undefined,
  };
}

function guestController(snapshot: GuestSnapshot, level: number): GuestRoomController {
  const a = fakeAnalyser(level);
  const store = new Store(snapshot);
  const patchLocal = (p: Partial<LocalAudioView>) => store.update((s) => ({ ...s, local: { ...s.local, ...p } }));
  return {
    store,
    leave: async () => undefined,
    enableAudio: noop,
    retry: noop,
    setMuted: (muted) => patchLocal({ muted }),
    setVolume: (volume) => patchLocal({ volume }),
    setTrim: (trimMs) => patchLocal({ trimMs }),
    resync: noop,
    requestTestClicks: noop,
    outputAnalyser: () => a,
  };
}

const FIXTURES: Record<string, () => { host?: HostRoomController; guest?: GuestRoomController }> = {
  'host-starting': () => ({ host: hostController(hostSnapshot({ stage: 'starting', code: null, inviteUrl: null, signaling: 'connecting' }), 0) }),
  'host-setup': () => ({ host: hostController(hostSnapshot(), 0) }),
  'host-guests-waiting': () => ({
    host: hostController(
      hostSnapshot({
        speakers: [
          speaker('host', 'Maya’s MacBook Pro', 'host', 'ready', 0, { isSelf: true }),
          speaker('g1', 'Sam’s MacBook Air', 'guest', 'ready', 1),
          speaker('g2', 'Lena’s Mac', 'guest', 'sound-off', 2, { level: null }),
        ],
      }),
      0,
    ),
  }),
  'host-capture-error': () => ({ host: hostController(hostSnapshot({ capture: { status: 'error', error: 'no-audio', suppression: 'unknown', inputActive: false, trackMuted: false, sharingSince: null } }), 0) }),
  'host-active': () => ({
    host: hostController(
      hostSnapshot({
        speakers: ACTIVE_SPEAKERS,
        capture: { status: 'sharing', error: null, suppression: 'on', inputActive: true, trackMuted: false, sharingSince: 1 },
        local: local(),
        links: [
          { id: 'g1', name: 'Sam’s MacBook Air', sent: 18234, dropped: 0, backpressureEpisodes: 0, bufferedBytes: 1952, channel: { ordered: false, maxRetransmits: null, maxPacketLifeTime: null, protocol: null } },
          { id: 'g2', name: 'Lena’s Mac', sent: 18190, dropped: 12, backpressureEpisodes: 1, bufferedBytes: 0, channel: { ordered: false, maxRetransmits: null, maxPacketLifeTime: null, protocol: null } },
        ],
      }),
      0.09,
    ),
  }),
  'host-quiet-tab': () => ({
    host: hostController(
      hostSnapshot({
        speakers: ACTIVE_SPEAKERS.slice(0, 2).map((s) => ({ ...s, phase: 'ready' as const, level: 0 })),
        capture: { status: 'sharing', error: null, suppression: 'off', inputActive: false, trackMuted: false, sharingSince: 1 },
      }),
      0,
    ),
  }),
  'host-full': () => ({
    host: hostController(
      hostSnapshot({
        locked: true,
        speakers: [...ACTIVE_SPEAKERS, speaker('g4', 'Studio Mac mini', 'guest', 'playing', 4)],
        capture: { status: 'sharing', error: null, suppression: 'on', inputActive: true, trackMuted: false, sharingSince: 1 },
      }),
      0.08,
    ),
  }),
  'host-ended': () => ({ host: hostController(hostSnapshot({ stage: 'ended' }), 0) }),
  'guest-enable': () => ({ guest: guestController(guestSnapshot({ audio: 'off', phase: 'sound-off', local: local({ renderer: null, timing: null }) }), 0) }),
  'guest-syncing': () => ({ guest: guestController(guestSnapshot({ phase: 'syncing', sourceActive: false }), 0) }),
  'guest-waiting': () => ({ guest: guestController(guestSnapshot({ phase: 'ready', sharing: 'idle', sourceActive: false }), 0) }),
  'guest-active': () => ({ guest: guestController(guestSnapshot(), 0.08) }),
  'guest-reconnecting': () => ({ guest: guestController(guestSnapshot({ stage: 'reconnecting', phase: 'reconnecting', reconnectAttempt: 2 }), 0) }),
  'guest-failed': () => ({ guest: guestController(guestSnapshot({ stage: 'failed', phase: 'attention', joinError: 'timeout', reconnectAttempt: 8 }), 0) }),
  'guest-ended': () => ({ guest: guestController(guestSnapshot({ stage: 'ended' }), 0) }),
  'guest-removed': () => ({ guest: guestController(guestSnapshot({ stage: 'removed' }), 0) }),
};

export function FixtureApp({ name }: { name: string }) {
  const [help, setHelp] = useState(false);
  const [view] = useState(() => (FIXTURES[name] ?? FIXTURES['host-setup'])());
  return (
    <>
      <TopBar onHelp={() => setHelp(true)} inRoom />
      <main id="main" className="app-main">
        <div className="screen">{view.host ? <HostRoom controller={view.host} /> : view.guest ? <GuestRoom controller={view.guest} /> : null}</div>
      </main>
      <HelpDrawer open={help} onClose={() => setHelp(false)} />
      <LiveRegion />
    </>
  );
}

export const FIXTURE_NAMES = Object.keys(FIXTURES);
