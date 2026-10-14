import {
  AlertCircle,
  AlertTriangle,
  ArrowUpRight,
  AudioWaveform,
  Link2,
  LoaderCircle,
  Lock,
  LockOpen,
  MonitorUp,
  MoreHorizontal,
  Power,
  RefreshCw,
  Settings2,
  SquareStop,
  Volume2,
  VolumeX,
  WifiOff,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { CaptureErrorKind } from '../../../audio/capture';
import { goHome } from '../../../session/app';
import type { HostController } from '../../../session/host';

export type HostRoomController = Pick<
  HostController,
  | 'store'
  | 'shareTab'
  | 'stopSharing'
  | 'dismissCaptureError'
  | 'playTestClicks'
  | 'setVolume'
  | 'setMuted'
  | 'setTrim'
  | 'setCommonBuffer'
  | 'setHostName'
  | 'setLocked'
  | 'resyncSelf'
  | 'resyncAll'
  | 'setGuestMuted'
  | 'setGuestVolume'
  | 'setAllMuted'
  | 'removeGuest'
  | 'end'
> & { engine: { readonly inputAnalyser: AnalyserNode | null; readonly outputAnalyser: AnalyserNode | null } };
import type { HostSnapshot } from '../../../session/types';
import { Button, IconButton } from '../../primitives/Button';
import { ConfirmDialog } from '../../primitives/Drawer';
import { announce, Checklist, Notice, Pill } from '../../primitives/Feedback';
import { Menu } from '../../primitives/Menu';
import { Slider } from '../../primitives/Slider';
import { InputMeter, Waveform } from '../../visual/Waveform';
import { CalibrationDrawer } from './CalibrationDrawer';
import { Diagnostics } from './Diagnostics';
import { HostSettingsDrawer } from './HostSettingsDrawer';
import { RoomEnded } from './RoomEnded';
import { CopyButton, formatPct, RoomCode, useSnapshot } from './shared';
import { SpeakerStrip } from './SpeakerStrip';
import { useVisualizer } from './useVisualizer';

const SPOTIFY_URL = 'https://open.spotify.com/';

const CAPTURE_COPY: Record<CaptureErrorKind, { title: string; body: string }> = {
  cancelled: { title: 'Nothing was shared.', body: 'The picker closed before a tab was chosen. Choose Share music tab when you’re ready.' },
  'no-audio': { title: 'No audio was shared.', body: 'Choose a Chrome tab and enable Share tab audio.' },
  'not-tab': { title: 'That wasn’t a Chrome tab.', body: 'Windows and screens can’t share sound here. Open the Chrome Tab view and pick your music tab.' },
  denied: {
    title: 'macOS blocked sharing.',
    body: 'Choose a Chrome tab, which needs no extra permission, or allow Chrome under System Settings → Privacy & Security → Screen & System Audio Recording.',
  },
  unsupported: { title: 'This browser can’t share tab audio.', body: 'Host from Chrome on a Mac.' },
  'not-readable': { title: 'Chrome couldn’t read that tab.', body: 'Reload the music tab, then share it again.' },
  failed: { title: 'Sharing didn’t start.', body: 'Try again. If it keeps failing, reload Trip Speaker.' },
};

function useHostAnnouncements(s: HostSnapshot) {
  const prev = useRef<HostSnapshot | null>(null);
  useEffect(() => {
    const p = prev.current;
    prev.current = s;
    if (!p) return;
    if (p.stage !== 'open' && s.stage === 'open' && s.code) announce(`Room ${s.code.split('').join(' ')} is ready.`);
    const before = new Map(p.speakers.map((x) => [x.id, x.name]));
    const after = new Map(s.speakers.map((x) => [x.id, x.name]));
    for (const [id, name] of after) if (!before.has(id)) announce(`${name} joined.`);
    for (const [id, name] of before) if (!after.has(id)) announce(`${name} left.`);
    if (p.capture.status !== 'sharing' && s.capture.status === 'sharing') announce('Sharing your music tab.');
    if (p.capture.status === 'sharing' && s.capture.status === 'stopped') announce('Sharing stopped.');
    if (p.signaling === 'online' && s.signaling !== 'online') announce('Lost contact with the connection service.');
  }, [s]);
}

export function HostRoom({ controller }: { controller: HostRoomController }) {
  const s = useSnapshot(controller.store);
  const [drawer, setDrawer] = useState<null | 'calibration' | 'settings'>(null);
  const [confirmEnd, setConfirmEnd] = useState(false);
  const [vis, setVis] = useVisualizer();
  useHostAnnouncements(s);

  if (s.stage === 'ended') {
    return <RoomEnded title="Room ended." body="Every speaker has stopped playing. Start a new room whenever you’re ready." onAction={goHome} />;
  }
  if (s.stage === 'failed') {
    const copy =
      s.failure === 'audio'
        ? { title: 'Sound couldn’t start.', body: 'Chrome didn’t start audio on this Mac. Reload Trip Speaker and try again.' }
        : s.failure === 'codes'
          ? { title: 'No free room code.', body: 'Every code we tried was busy. Wait a moment and try again.' }
          : { title: 'Can’t reach the connection service.', body: 'Trip Speaker needs the internet to introduce laptops. Check your connection, then try again.' };
    return <RoomEnded title={copy.title} body={copy.body} actionLabel="Back to start" onAction={goHome} testId="room-failed" />;
  }

  const guests = s.speakers.filter((x) => x.role === 'guest');
  const sharing = s.capture.status === 'sharing';
  const playingCount = s.speakers.filter((x) => x.phase === 'playing').length;
  const speakersReady = guests.length > 0 && guests.every((g) => g.phase === 'ready' || g.phase === 'playing' || g.phase === 'buffering');
  const open = s.stage === 'open';

  const diagnostics = <Diagnostics role="host" local={s.local} links={s.links} />;

  return (
    <div className="room page room-page" data-testid="host-room" data-stage={s.stage}>
      <header className="roombar" aria-label="Your room">
        <div className="roombar-main">
          <div className="roombar-id">
            <div className="roombar-label">
              <strong>Your room</strong>
              <span>{open ? 'Friends join with this code' : 'Creating your room…'}</span>
            </div>
            <RoomCode code={open ? s.code : null} />
          </div>
          <div className="roombar-actions">
            <CopyButton text={open ? s.code : null} label="Copy code" announceText="Room code copied." testId="copy-code" />
            <CopyButton text={open ? s.inviteUrl : null} label="Invite link" icon={Link2} announceText="Invite link copied." testId="copy-link" />
          </div>
        </div>
        <div className="roombar-side">
          {s.signaling === 'reconnecting' || s.signaling === 'offline' ? (
            <Pill tone="alert" icon={WifiOff}>
              {s.signaling === 'offline' ? 'New guests can’t join' : 'Reconnecting to service'}
            </Pill>
          ) : null}
          <Pill testId="speaker-pill">
            <span className="num">
              {s.speakers.length} / {s.maxSpeakers}
            </span>{' '}
            speakers
          </Pill>
          <Button
            size="sm"
            variant="secondary"
            icon={s.locked ? Lock : LockOpen}
            active={s.locked}
            aria-pressed={s.locked}
            onClick={() => controller.setLocked(!s.locked)}
            disabled={!open}
          >
            {s.locked ? 'Locked' : 'Lock room'}
          </Button>
          <Menu
            label="Room options"
            items={[
              { id: 'settings', label: 'Sound settings', icon: Settings2, onSelect: () => setDrawer('settings') },
              { id: 'echo', label: 'Hear an echo?', icon: AudioWaveform, onSelect: () => setDrawer('calibration') },
              { id: 'resync', label: 'Resync all speakers', icon: RefreshCw, onSelect: () => controller.resyncAll() },
              { id: 'end', label: 'End room…', icon: Power, tone: 'alert', separatorBefore: true, onSelect: () => setConfirmEnd(true) },
            ]}
            trigger={(p) => (
              <button type="button" className="icon-btn" aria-label="Room options" title="Room options" {...p}>
                <MoreHorizontal aria-hidden="true" />
              </button>
            )}
          />
        </div>
      </header>

      <section className="listen surface" aria-labelledby="listen-title" data-sharing={sharing ? '' : undefined}>
        <div className="listen-status">
          {!open ? (
            <Pill icon={LoaderCircle}>Creating room</Pill>
          ) : sharing ? (
            <Pill tone="live" dot>
              Sharing a tab
            </Pill>
          ) : (
            <Pill tone="live" dot>
              Room ready
            </Pill>
          )}
          {sharing ? (
            <span className="source">
              <InputMeter source={() => controller.engine.inputAnalyser} label="Shared tab input level" />
              <span data-testid="input-status">{s.capture.trackMuted ? 'The tab isn’t sending audio' : s.capture.inputActive ? 'Sound from your tab' : 'No sound from the tab yet'}</span>
            </span>
          ) : null}
        </div>

        <div className="listen-main">
          {sharing ? (
            <>
              <h1 id="listen-title" className="listen-title" data-testid="listen-title">
                {playingCount > 0 ? `Playing on ${playingCount} speaker${playingCount === 1 ? '' : 's'}` : s.capture.inputActive ? 'Starting playback…' : 'Your tab is shared'}
              </h1>
              <p className="listen-body">
                {s.capture.inputActive || playingCount > 0
                  ? `Every speaker plays about ${(s.commonBufferMs / 1000).toFixed(1)} seconds after the tab. Pick songs and pause in Spotify’s own tab.`
                  : 'Nothing is audible yet. Press play in the shared tab. If it is playing, share again and make sure Share tab audio is on. Some tabs can’t be captured.'}
              </p>
              <div className="listen-actions">
                <Button icon={MonitorUp} onClick={() => controller.shareTab()} disabled={s.capture.status === 'requesting'}>
                  Change tab
                </Button>
                <Button variant="quiet" icon={SquareStop} onClick={() => controller.stopSharing()}>
                  Stop sharing
                </Button>
                <a className="text-link" href={SPOTIFY_URL} target="_blank" rel="noopener noreferrer">
                  Open Spotify <ArrowUpRight aria-hidden="true" />
                </a>
              </div>
            </>
          ) : (
            <>
              <h1 id="listen-title" className="listen-title" data-testid="listen-title">
                {s.capture.status === 'stopped' ? 'Sharing stopped' : 'Choose your music tab'}
              </h1>
              <p className="listen-body">
                {s.capture.status === 'stopped'
                  ? 'Speakers are waiting for another music tab. Share one to keep playing.'
                  : 'Share the Chrome tab that’s playing music. Every speaker, including this Mac, plays it about a second later.'}
              </p>
              <div className="listen-actions">
                <Button
                  variant="primary"
                  size="lg"
                  icon={s.capture.status === 'requesting' ? LoaderCircle : MonitorUp}
                  onClick={() => controller.shareTab()}
                  disabled={!open || s.capture.status === 'requesting'}
                >
                  {s.capture.status === 'requesting' ? 'Waiting for the picker…' : 'Share music tab'}
                </Button>
                <a className="text-link" href={SPOTIFY_URL} target="_blank" rel="noopener noreferrer">
                  Open Spotify <ArrowUpRight aria-hidden="true" />
                </a>
              </div>
            </>
          )}
          {s.capture.error && s.capture.status !== 'requesting' ? (
            <Notice
              tone={s.capture.error === 'cancelled' ? undefined : 'alert'}
              icon={AlertCircle}
              title={CAPTURE_COPY[s.capture.error].title}
              testId="capture-error"
              actions={
                <Button size="sm" variant="quiet" onClick={() => controller.dismissCaptureError()}>
                  Dismiss
                </Button>
              }
            >
              {CAPTURE_COPY[s.capture.error].body}
            </Notice>
          ) : null}
          {sharing && s.capture.suppression === 'off' ? (
            <Notice tone="alert" icon={AlertTriangle} title="This Mac is also playing the tab directly." testId="suppression-warning">
              Chrome didn’t mute the original tab, so this laptop plays the music twice and can’t stay in sync with the others. Use the guests
              as speakers, or share again in a current version of Chrome.
            </Notice>
          ) : null}
        </div>

        <div className="listen-side">
          {sharing ? (
            <div className="guide">
              <p className="guide-title">Room status</p>
              <div style={{ marginTop: 14 }}>
                <Checklist
                  label="Room setup"
                  items={[
                    { id: 'room', label: 'Room created', done: open },
                    { id: 'tab', label: 'Music tab shared', done: sharing },
                    { id: 'speakers', label: guests.length ? 'Speakers ready' : 'Waiting for speakers', done: speakersReady, pending: !speakersReady },
                  ]}
                />
              </div>
              <p className="guide-foot field-hint">
                Spotify controls stay in Spotify. Trip Speaker never sees track names or plays video.
              </p>
            </div>
          ) : (
            <div className="guide">
              <p className="guide-title">In Chrome’s picker</p>
              <ol>
                <li>
                  <span>
                    Choose <strong>Chrome Tab</strong>.
                  </span>
                </li>
                <li>
                  <span>
                    Select the <strong>Spotify web player</strong> tab.
                  </span>
                </li>
                <li>
                  <span>
                    Turn on <strong>Share tab audio</strong>, then click <strong>Share</strong>.
                  </span>
                </li>
              </ol>
              <div className="guide-foot">
                <Checklist
                  label="Room setup"
                  items={[
                    { id: 'room', label: 'Room created', done: open },
                    { id: 'tab', label: 'Music tab shared', done: false },
                    { id: 'speakers', label: guests.length ? 'Speakers ready' : 'Waiting for speakers', done: speakersReady, pending: !speakersReady },
                  ]}
                />
              </div>
            </div>
          )}
        </div>

        <div className="listen-wave">
          <span className="listen-wave-label">Room audio · this Mac</span>
          <Waveform source={() => controller.engine.outputAnalyser} mode={vis} label="Room audio level on this Mac" />
        </div>

        <div className="controls">
          <div className="volume">
            <span className="volume-label" id="host-vol-label">
              This Mac
            </span>
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
            <Button size="sm" icon={s.mutedAll ? VolumeX : Volume2} active={s.mutedAll} aria-pressed={s.mutedAll} onClick={() => controller.setAllMuted(!s.mutedAll)} disabled={!open}>
              {s.mutedAll ? 'Unmute all' : 'Mute all'}
            </Button>
            <Button size="sm" icon={AudioWaveform} onClick={() => setDrawer('calibration')} disabled={!open}>
              Test sync
            </Button>
            <Button size="sm" icon={RefreshCw} onClick={() => controller.resyncAll()} disabled={!open}>
              Resync all
            </Button>
            <Button size="sm" icon={Settings2} onClick={() => setDrawer('settings')}>
              Sound settings
            </Button>
          </div>
        </div>
      </section>

      <SpeakerStrip
        speakers={s.speakers}
        maxSpeakers={s.maxSpeakers}
        controls={{
          canControl: () => true,
          setVolume: (id, v) => controller.setGuestVolume(id, v),
          setMuted: (id, m) => controller.setGuestMuted(id, m),
          remove: (id) => controller.removeGuest(id),
        }}
        emptySlot={
          s.speakers.length < s.maxSpeakers ? (
            <span>
              <strong>{guests.length === 0 ? 'Invite a friend' : 'Room for more'}</strong>
              <br />
              {open && s.code ? (
                <>
                  Join with code <span className="num">{s.code}</span>
                </>
              ) : (
                'Code coming up…'
              )}
            </span>
          ) : null
        }
      />

      <footer className="room-foot">
        <span>Keep this tab open and this Mac awake. Closing it ends the room.</span>
        <Button variant="alert" size="sm" icon={Power} onClick={() => setConfirmEnd(true)} data-testid="end-room">
          End room
        </Button>
      </footer>

      <CalibrationDrawer
        open={drawer === 'calibration'}
        onClose={() => setDrawer(null)}
        role="host"
        trimMs={s.local.trimMs}
        setTrim={(ms) => controller.setTrim(ms)}
        onPlayClicks={() => controller.playTestClicks()}
        clicksActive={s.clicksActive}
        clicksDisabled={!open}
        onResync={() => controller.resyncSelf()}
        speakers={s.speakers}
        setSpeakerMuted={(id, m) => controller.setGuestMuted(id, m)}
        outputChanged={s.outputChanged}
        diagnostics={diagnostics}
      />
      <HostSettingsDrawer open={drawer === 'settings'} onClose={() => setDrawer(null)} snapshot={s} controller={controller} visualizer={vis} setVisualizer={setVis} diagnostics={diagnostics} />
      <ConfirmDialog
        open={confirmEnd}
        onClose={() => setConfirmEnd(false)}
        title="End the room for everyone?"
        body="Every laptop stops playing and leaves the room. The code stops working."
        testId="confirm-end"
      >
        <Button variant="secondary" onClick={() => setConfirmEnd(false)} autoFocus>
          Keep playing
        </Button>
        <Button
          variant="alert-fill"
          icon={Power}
          onClick={() => {
            setConfirmEnd(false);
            void controller.end();
          }}
        >
          End room
        </Button>
      </ConfirmDialog>
    </div>
  );
}
