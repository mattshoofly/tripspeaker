import {
  AlertTriangle,
  ChevronDown,
  Laptop,
  LoaderCircle,
  RefreshCw,
  UserMinus,
  Volume1,
  Volume2,
  VolumeX,
  type LucideIcon,
} from 'lucide-react';
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import type { SpeakerPhase } from '../../../core/protocol';
import { phaseLabel } from '../../../core/status';
import type { SpeakerView } from '../../../session/types';
import { Flip, gsap } from '../../motion/gsap';
import { IconButton } from '../../primitives/Button';
import { Popover } from '../../primitives/Popover';
import { Slider } from '../../primitives/Slider';
import { ActivityBars } from '../../visual/Waveform';
import { formatPct } from './shared';

const PHASE_ICON: Partial<Record<SpeakerPhase, LucideIcon>> = {
  connecting: LoaderCircle,
  syncing: LoaderCircle,
  buffering: LoaderCircle,
  reconnecting: RefreshCw,
  attention: AlertTriangle,
};

export interface SpeakerControls {
  setVolume: (id: string, volume: number) => void;
  setMuted: (id: string, muted: boolean) => void;
  remove?: (id: string) => void;
  /** Which cards this viewer may control. */
  canControl: (s: SpeakerView) => boolean;
}

function StateLine({ s }: { s: SpeakerView }) {
  const Icon = s.muted && (s.phase === 'playing' || s.phase === 'ready' || s.phase === 'buffering') ? VolumeX : PHASE_ICON[s.phase];
  const spinning = s.phase === 'connecting' || s.phase === 'syncing' || s.phase === 'buffering' || s.phase === 'reconnecting';
  return (
    <p className="speaker-state" data-testid="speaker-state">
      {Icon ? <Icon aria-hidden="true" className={spinning && !s.muted ? 'spin' : undefined} /> : <span className="dot" aria-hidden="true" />}
      {phaseLabel(s.phase, s.muted)}
    </p>
  );
}

function VolumeControl({ s, controls }: { s: SpeakerView; controls: SpeakerControls }) {
  return (
    <Popover
      label={`Volume for ${s.name}`}
      className="vol-pop"
      trigger={(p) => (
        <button type="button" className="vol-trigger num" data-muted={s.muted ? '' : undefined} aria-label={`Volume for ${s.name}, ${formatPct(s.volume)}`} {...p}>
          {formatPct(s.volume)}
          <ChevronDown aria-hidden="true" />
        </button>
      )}
    >
      <div className="vol-pop-head">
        <span>{s.isSelf ? 'This Mac' : s.name}</span>
        <span className="num">{s.muted ? 'Muted' : formatPct(s.volume)}</span>
      </div>
      <Slider label={`Volume for ${s.name}`} value={Math.round(s.volume * 100)} min={0} max={100} onChange={(v) => controls.setVolume(s.id, v / 100)} valueText={(v) => `${v}%`} dim={s.muted} ring="#1f221b" />
      {controls.remove && !s.isSelf ? (
        <div className="vol-pop-foot">
          <button type="button" className="btn btn--quiet btn--sm vol-remove" onClick={() => controls.remove?.(s.id)}>
            <UserMinus aria-hidden="true" />
            Remove from room
          </button>
        </div>
      ) : null}
    </Popover>
  );
}

function SpeakerCard({ s, controls, leaving }: { s: SpeakerView; controls?: SpeakerControls; leaving?: boolean }) {
  const can = controls?.canControl(s) ?? false;
  return (
    <li
      className="speaker"
      data-flip={s.id}
      data-speaker={s.id}
      data-phase={s.phase}
      data-muted={s.muted ? '' : undefined}
      data-self={s.isSelf ? '' : undefined}
      data-leaving={leaving ? '' : undefined}
      aria-label={`${s.name}${s.isSelf ? ' (this Mac)' : ''}, ${s.role}, ${phaseLabel(s.phase, s.muted)}`}
    >
      <div className="speaker-top">
        <div style={{ minWidth: 0 }}>
          <p className="speaker-name" title={s.name}>
            {s.name}
          </p>
          <p className="speaker-sub">{s.isSelf ? 'This Mac' : s.role === 'host' ? 'Shares the music' : 'Guest speaker'}</p>
        </div>
        <span className="role-badge" data-role={s.role}>
          {s.role === 'host' ? 'Host' : 'Guest'}
        </span>
      </div>
      <StateLine s={s} />
      <div className="speaker-bottom">
        <span className="speaker-meta">
          <ActivityBars level={s.level} muted={s.muted} />
          {can ? null : <span className="num">{s.muted ? 'Muted' : formatPct(s.volume)}</span>}
        </span>
        {can && controls ? (
          <span className="speaker-tools">
            <VolumeControl s={s} controls={controls} />
            <IconButton
              label={s.muted ? `Unmute ${s.name}` : `Mute ${s.name}`}
              icon={s.muted ? VolumeX : s.volume < 0.5 ? Volume1 : Volume2}
              aria-pressed={s.muted}
              onClick={() => controls.setMuted(s.id, !s.muted)}
            />
          </span>
        ) : null}
      </div>
    </li>
  );
}

export function SpeakerStrip({
  speakers,
  maxSpeakers,
  controls,
  emptySlot,
  title = 'Speakers',
}: {
  speakers: SpeakerView[];
  maxSpeakers: number;
  controls?: SpeakerControls;
  emptySlot?: ReactNode;
  title?: string;
}) {
  const listRef = useRef<HTMLUListElement>(null);
  const flipState = useRef<Flip.FlipState | null>(null);
  const key = speakers.map((s) => s.id).join('|') + (emptySlot ? '|+' : '');
  const prevKey = useRef(key);
  const prevSpeakers = useRef(speakers);
  const [leaving, setLeaving] = useState<SpeakerView[]>([]);

  // Capture layout before React commits the new list (the DOM still shows the old one).
  if (key !== prevKey.current) {
    const reduce = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (listRef.current && !reduce) flipState.current = Flip.getState(listRef.current.querySelectorAll('[data-flip]'));
    const ids = new Set(speakers.map((s) => s.id));
    const gone = prevSpeakers.current.filter((s) => !ids.has(s.id));
    prevKey.current = key;
    if (gone.length && !reduce) setLeaving((l) => [...l.filter((x) => !ids.has(x.id)), ...gone]);
  }
  prevSpeakers.current = speakers;

  useLayoutEffect(() => {
    const state = flipState.current;
    flipState.current = null;
    const list = listRef.current;
    if (!state || !list) return;
    const tween = Flip.from(state, {
      targets: list.querySelectorAll('[data-flip]'),
      duration: 0.28,
      ease: 'power3.out',
      absolute: true,
      onEnter: (els) => gsap.fromTo(els, { opacity: 0, scale: 0.97 }, { opacity: 1, scale: 1, duration: 0.26, ease: 'power3.out' }),
      onLeave: (els) => gsap.to(els, { opacity: 0, scale: 0.97, duration: 0.2, ease: 'power2.out' }),
    });
    const t = setTimeout(() => setLeaving([]), 340);
    return () => {
      clearTimeout(t);
      tween.progress(1);
    };
  }, [key]);

  const ids = new Set(speakers.map((s) => s.id));
  const items = [...speakers.map((s) => ({ s, leaving: false })), ...leaving.filter((l) => !ids.has(l.id)).map((s) => ({ s, leaving: true }))].sort(
    (a, b) => a.s.order - b.s.order,
  );

  return (
    <section className="strip-section" aria-labelledby="strip-title">
      <div className="strip-head">
        <h2 id="strip-title">{title}</h2>
        <p className="num" data-testid="speaker-count">
          {speakers.length} of {maxSpeakers} · each guest uses about 0.8 Mbit/s of Wi-Fi
        </p>
      </div>
      <ul className="strip" ref={listRef} data-testid="speaker-strip">
        {items.map(({ s, leaving: isLeaving }) => (
          <SpeakerCard key={s.id} s={s} controls={controls} leaving={isLeaving} />
        ))}
        {emptySlot ? (
          <li className="speaker speaker--slot" data-flip="slot">
            <Laptop aria-hidden="true" width={20} height={20} />
            {emptySlot}
          </li>
        ) : null}
      </ul>
    </section>
  );
}
