import { AlertTriangle, AudioWaveform, LoaderCircle, LogOut, RefreshCw, Settings2, Speaker, Volume2, VolumeX, WifiOff } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { phaseLabel } from '../../../core/status';
import { JOIN_ERROR_COPY } from '../../../net/errors';
import { goHome } from '../../../session/app';
import type { GuestController } from '../../../session/guest';
import type { GuestSnapshot } from '../../../session/types';

export type GuestRoomController = Pick<
  GuestController,
  'store' | 'leave' | 'enableAudio' | 'retry' | 'setMuted' | 'setVolume' | 'setTrim' | 'resync' | 'requestTestClicks' | 'outputAnalyser'
>;
import { Button, IconButton } from '../../primitives/Button';
import { Drawer } from '../../primitives/Drawer';
import { announce, Pill } from '../../primitives/Feedback';
import { Slider } from '../../primitives/Slider';
import { Waveform } from '../../visual/Waveform';
import { CalibrationDrawer } from './CalibrationDrawer';
import { Diagnostics } from './Diagnostics';
import { VisualizerChoice } from './HostSettingsDrawer';
import { ConnectionHelp } from '../../ConnectionHelp';
import { RoomEnded } from './RoomEnded';
import { formatPct, RoomCode, useSnapshot } from './shared';
import { SpeakerStrip } from './SpeakerStrip';
import { useVisualizer } from './useVisualizer';

function headline(s: GuestSnapshot): { title: string; body: string } {
  if (s.stage === 'reconnecting')
    return { title: 'Reconnecting', body: `Trying to reach the host again (attempt ${Math.max(1, s.reconnectAttempt)} of ${s.maxReconnectAttempts}). Music resumes in sync once it’s back.` };
  if (s.stage === 'failed') {
    const copy = s.joinError ? JOIN_ERROR_COPY[s.joinError] : JOIN_ERROR_COPY['host-unavailable'];
    return { title: 'Connection needs attention', body: `${copy.title} ${copy.detail}` };
  }
  if (s.audio === 'blocked') return { title: 'Sound is blocked', body: 'Chrome paused audio on this tab. Click Enable this speaker to turn it back on.' };
  switch (s.phase) {
    case 'syncing':
      return { title: 'Getting in sync', body: 'Measuring the timing between this Mac and the host. This takes a moment.' };
    case 'buffering':
      return { title: 'Buffering', body: 'Collecting a little audio so every speaker can start together.' };
    case 'playing':
      return s.local.muted
        ? { title: 'Muted', body: 'The room is playing. Unmute to join in.' }
        : { title: 'Playing together', body: 'Pick songs and pause on the host’s laptop. Adjust this Mac’s volume here.' };
    case 'ready':
    default:
      if (s.sharing === 'stopped') return { title: 'Your host stopped sharing.', body: 'Waiting for another music tab.' };
      if (s.sharing === 'sharing') return { title: 'Ready for music', body: 'The host is sharing a tab, but it’s quiet right now.' };
      return { title: 'Waiting for your host to share music.', body: 'This speaker is connected and in sync. It starts playing as soon as music is shared.' };
  }
}

function useGuestAnnouncements(s: GuestSnapshot) {
  const prev = useRef<GuestSnapshot | null>(null);
  useEffect(() => {
    const p = prev.current;
    prev.current = s;
    if (!p) return;
    if (p.stage !== s.stage) {
      if (s.stage === 'reconnecting') announce('Connection lost. Reconnecting.');
      if (p.stage === 'reconnecting' && s.stage === 'joined') announce('Reconnected.');
      if (s.stage === 'failed') announce('Connection needs attention.');
    }
    if (p.phase !== s.phase && s.phase === 'playing') announce('Playing together.');
    if (p.audio !== 'on' && s.audio === 'on') announce('Speaker enabled.');
  }, [s]);
}

export function GuestRoom({ controller }: { controller: GuestRoomController }) {
  const s = useSnapshot(controller.store);
  const [drawer, setDrawer] = useState<null | 'calibration' | 'settings'>(null);
  const [clicksRequested, setClicksRequested] = useState(false);
  const [vis, setVis] = useVisualizer();
  useGuestAnnouncements(s);
  useEffect(() => {
    if (!clicksRequested) return;
    // A click train lasts ~6 s and is heard ~1.2 s after the host plays it.
    const t = setTimeout(() => setClicksRequested(false), 8000);
    return () => clearTimeout(t);
  }, [clicksRequested]);

  if (s.stage === 'ended') {
    return <RoomEnded title="The room has ended." body="Your host ended the session. Thanks for listening." onAction={goHome} />;
  }
  if (s.stage === 'removed') {
    return <RoomEnded title="You’re out of the room." body="The host removed this speaker. You can join again if the room is unlocked." onAction={goHome} />;
  }

  const h = headline(s);
  const connected = s.stage === 'joined';
  const diagnostics = <Diagnostics role="guest" local={s.local} clock={s.clock} packetsReceived={s.packetsReceived} audioChannel={s.audioChannel} />;
  const needsEnable = s.audio === 'off' || s.audio === 'enabling' || s.audio === 'blocked';
  const self = s.speakers.find((x) => x.isSelf);

  return (
    <div className="room page room-page" data-testid="guest-room" data-phase={s.phase} data-stage={s.stage} data-audio={s.audio}>
      <header className="roombar" aria-label="Room">
        <div className="roombar-main">
          <div className="roombar-id">
            <div className="roombar-label">
              <strong>Room</strong>
              <span>{s.hostName ? `Hosted by ${s.hostName}` : 'Connected to the host'}</span>
            </div>
            <RoomCode code={s.code} size="sm" />
          </div>
        </div>
        <div className="roombar-side">
          {s.stage === 'reconnecting' ? (
            <Pill tone="alert" icon={RefreshCw}>
              Reconnecting
            </Pill>
          ) : s.stage === 'failed' ? (
            <Pill tone="alert" icon={WifiOff}>
              Offline
            </Pill>
          ) : (
            <Pill tone={s.phase === 'playing' && !s.local.muted ? 'live' : undefined} dot testId="guest-phase">
              {phaseLabel(s.phase, s.local.muted)}
            </Pill>
          )}
          <Button size="sm" variant="quiet" icon={LogOut} onClick={() => void controller.leave().then(goHome)} data-testid="leave-room">
            Leave room
          </Button>
        </div>
      </header>

      <section className="listen surface" aria-labelledby="listen-title">
        <div className="listen-status">
          <Pill icon={connected ? undefined : s.stage === 'failed' ? AlertTriangle : LoaderCircle} dot={connected}>
            {connected ? 'Connected' : s.stage === 'failed' ? 'Disconnected' : 'Reconnecting'}
          </Pill>
          {s.outputChanged ? (
            <button type="button" className="btn btn--quiet btn--sm" onClick={() => setDrawer('calibration')}>
              <Speaker aria-hidden="true" />
              Output changed — recheck sync
            </button>
          ) : null}
        </div>

        <div className="listen-main">
          {needsEnable ? (
            <div className="enable">
              <h1 id="listen-title" className="listen-title" data-testid="listen-title">
                {s.audio === 'blocked' ? 'Sound is blocked' : 'Turn this Mac into a speaker'}
              </h1>
              <p className="listen-body">Chrome needs one click on this tab before it can play sound.</p>
              <Button
                variant="primary"
                size="lg"
                icon={s.audio === 'enabling' ? LoaderCircle : Volume2}
                onClick={() => controller.enableAudio()}
                disabled={s.audio === 'enabling'}
                data-testid="enable-speaker"
              >
                {s.audio === 'enabling' ? 'Enabling…' : 'Enable this speaker'}
              </Button>
            </div>
          ) : (
            <>
              <h1 id="listen-title" className="listen-title" data-testid="listen-title">
                {h.title}
              </h1>
              <p className="listen-body">{h.body}</p>
              {s.stage === 'failed' ? (
                <>
                  <div className="listen-actions">
                    <Button variant="primary" icon={RefreshCw} onClick={() => controller.retry()}>
                      Try again
                    </Button>
                  </div>
                  {s.connectionReport ? <ConnectionHelp report={s.connectionReport} /> : null}
                </>
              ) : null}
            </>
          )}
        </div>

        <div className="listen-side">
          <div className="guide">
            <p className="guide-title">This speaker</p>
            <dl className="kv" style={{ marginTop: 12 }}>
              <dt>Connection</dt>
              <dd>{connected ? 'Connected' : s.stage === 'failed' ? 'Lost' : 'Reconnecting'}</dd>
              <dt>Sound</dt>
              <dd>{s.audio === 'on' ? 'On' : s.audio === 'enabling' ? 'Starting' : s.audio === 'blocked' ? 'Blocked' : 'Not enabled'}</dd>
              <dt>Timing</dt>
              <dd>{!connected ? 'Waiting for the host' : s.local.timing?.timingValid ? 'In sync' : s.audio === 'on' ? 'Measuring' : '—'}</dd>
              <dt>Host music</dt>
              <dd>
                {!connected
                  ? 'Unknown until reconnected'
                  : s.sharing === 'sharing'
                    ? s.sourceActive
                      ? 'Playing'
                      : 'Shared, quiet'
                    : s.sharing === 'stopped'
                      ? 'Stopped'
                      : 'Not shared yet'}
              </dd>
            </dl>
            {s.audio === 'on' && s.local.timing?.anchorSource === 'estimated' ? (
              <p className="guide-foot field-hint">This Mac doesn’t report exact output timing, so its sync is estimated. Use test clicks to check it.</p>
            ) : null}
          </div>
        </div>

        <div className="listen-wave">
          <span className="listen-wave-label">Room audio · this Mac</span>
          <Waveform source={() => controller.outputAnalyser()} mode={vis} label="Room audio level on this Mac" />
        </div>

        <div className="controls">
          <div className="volume">
            <span className="volume-label">This Mac</span>
            <IconButton
              label={s.local.muted ? 'Unmute this Mac' : 'Mute this Mac'}
              icon={s.local.muted ? VolumeX : Volume2}
              aria-pressed={s.local.muted}
              onClick={() => controller.setMuted(!s.local.muted)}
            />
            <Slider
              label="Volume on this Mac"
              value={Math.round(s.local.volume * 100)}
              min={0}
              max={100}
              onChange={(v) => controller.setVolume(v / 100)}
              valueText={(v) => `${v}%`}
              dim={s.local.muted}
            />
            <span className="slider-value">{s.local.muted ? 'Muted' : formatPct(s.local.volume)}</span>
          </div>
          <div className="controls-group">
            <Button size="sm" icon={AudioWaveform} onClick={() => setDrawer('calibration')} disabled={needsEnable}>
              Hear an echo?
            </Button>
            <Button size="sm" icon={RefreshCw} onClick={() => controller.resync()} disabled={needsEnable || !connected}>
              Resync this speaker
            </Button>
            <IconButton label="Display settings" icon={Settings2} onClick={() => setDrawer('settings')} />
          </div>
        </div>
      </section>

      {s.speakers.length ? (
        <SpeakerStrip
          speakers={s.speakers}
          maxSpeakers={5}
          title="In this room"
          controls={{
            canControl: (x) => x.isSelf,
            setVolume: (_id, v) => controller.setVolume(v),
            setMuted: (_id, m) => controller.setMuted(m),
          }}
        />
      ) : null}

      <footer className="room-foot">
        <span>Keep this Mac open and awake while you listen.</span>
        {self ? <span className="num">This Mac: {self.name}</span> : null}
      </footer>

      <CalibrationDrawer
        open={drawer === 'calibration'}
        onClose={() => setDrawer(null)}
        role="guest"
        trimMs={s.local.trimMs}
        setTrim={(ms) => controller.setTrim(ms)}
        onPlayClicks={() => {
          controller.requestTestClicks();
          setClicksRequested(true);
        }}
        clicksActive={clicksRequested}
        clicksDisabled={!connected}
        onResync={() => controller.resync()}
        speakers={s.speakers}
        setSpeakerMuted={(_id, m) => controller.setMuted(m)}
        outputChanged={s.outputChanged}
        diagnostics={diagnostics}
      />
      <Drawer open={drawer === 'settings'} onClose={() => setDrawer(null)} title="Display settings" subtitle="How this Mac shows the room’s audio." testId="guest-settings">
        <section className="drawer-section" aria-labelledby="g-vis">
          <h3 id="g-vis">Visualizer</h3>
          <VisualizerChoice value={vis} onChange={setVis} />
          <p className="field-hint">Calm and Still use less motion. Playback is unaffected either way.</p>
        </section>
        <section className="drawer-section">
          <h3>Diagnostics</h3>
          {diagnostics}
        </section>
      </Drawer>
    </div>
  );
}
