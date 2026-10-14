import { AudioWaveform, ChevronDown, Minus, Plus, RefreshCw, RotateCcw, Speaker } from 'lucide-react';
import type { ReactNode } from 'react';
import { TRIM_LIMIT_MS } from '../../../core/timeline';
import type { SpeakerView } from '../../../session/types';
import { Button, IconButton } from '../../primitives/Button';
import { Drawer } from '../../primitives/Drawer';
import { Notice } from '../../primitives/Feedback';
import { Switch } from '../../primitives/Popover';
import { Slider } from '../../primitives/Slider';

export function trimDirection(ms: number): string {
  if (ms > 0) return 'Later';
  if (ms < 0) return 'Earlier';
  return 'No offset';
}

export function formatTrim(ms: number): string {
  if (ms === 0) return '0 ms';
  return `${ms > 0 ? '+' : '−'}${Math.abs(ms)} ms`;
}

export interface CalibrationDrawerProps {
  open: boolean;
  onClose: () => void;
  role: 'host' | 'guest';
  trimMs: number;
  setTrim: (ms: number) => void;
  onPlayClicks: () => void;
  clicksActive: boolean;
  clicksDisabled?: boolean;
  onResync: () => void;
  speakers: SpeakerView[];
  setSpeakerMuted: (id: string, muted: boolean) => void;
  outputChanged: boolean;
  diagnostics: ReactNode;
}

export function CalibrationDrawer(p: CalibrationDrawerProps) {
  const isolatable = p.role === 'host' ? p.speakers : p.speakers.filter((s) => s.isSelf);
  const step = (delta: number) => p.setTrim(Math.max(-TRIM_LIMIT_MS, Math.min(TRIM_LIMIT_MS, p.trimMs + delta)));
  return (
    <Drawer
      open={p.open}
      onClose={p.onClose}
      title="Hear an echo?"
      subtitle="If a beat sounds doubled, this laptop is a little early or late. Play test clicks and nudge it until the clicks land as one."
      testId="calibration-drawer"
    >
      {p.outputChanged ? (
        <Notice icon={Speaker} title="The audio output changed.">
          Headphones or speakers were switched on this Mac, which can shift its timing. Play test clicks to recheck.
        </Notice>
      ) : null}

      <section className="drawer-section" aria-labelledby="cal-clicks">
        <h3 id="cal-clicks">1 · Play test clicks</h3>
        <p className="field-hint">
          Clicks travel through the same connection and timing as the music, then play on every speaker together. Stand about the same
          distance from each laptop.
        </p>
        <div className="trim-actions">
          <Button variant="secondary" icon={AudioWaveform} onClick={p.onPlayClicks} disabled={p.clicksActive || p.clicksDisabled} data-testid="play-clicks">
            {p.clicksActive ? 'Clicks playing…' : 'Play test clicks'}
          </Button>
        </div>
      </section>

      <section className="drawer-section" aria-labelledby="cal-iso">
        <h3 id="cal-iso">2 · Compare speakers</h3>
        <p className="field-hint">
          {p.role === 'host'
            ? 'Mute all but two laptops to hear which one is off.'
            : 'Mute this laptop to hear the others without it. Only the host can mute other laptops.'}
        </p>
        <ul className="iso-list">
          {isolatable.map((s) => (
            <li key={s.id} className="iso-item">
              <span>
                {s.name}
                {s.isSelf ? <span className="faint-text"> · this Mac</span> : null}
              </span>
              <Switch checked={!s.muted} onChange={(on) => p.setSpeakerMuted(s.id, !on)} label={`${s.name} plays`} />
            </li>
          ))}
        </ul>
      </section>

      <section className="drawer-section" aria-labelledby="cal-trim">
        <h3 id="cal-trim">3 · Adjust this Mac</h3>
        <div className="trim">
          <div className="trim-readout">
            <span className="trim-value num" data-testid="trim-value">
              {formatTrim(p.trimMs)}
            </span>
            <span className="trim-dir">{trimDirection(p.trimMs)}</span>
          </div>
          <div className="trim-row">
            <IconButton label="1 millisecond earlier" icon={Minus} onClick={() => step(-1)} disabled={p.trimMs <= -TRIM_LIMIT_MS} />
            <Slider
              label="Timing for this Mac"
              value={p.trimMs}
              min={-TRIM_LIMIT_MS}
              max={TRIM_LIMIT_MS}
              step={1}
              centered
              onChange={p.setTrim}
              valueText={(v) => (v === 0 ? 'No offset' : `${Math.abs(v)} milliseconds ${v > 0 ? 'later' : 'earlier'}`)}
            />
            <IconButton label="1 millisecond later" icon={Plus} onClick={() => step(1)} disabled={p.trimMs >= TRIM_LIMIT_MS} />
          </div>
          <div className="trim-scale" aria-hidden="true">
            <span>← Earlier</span>
            <span>Later →</span>
          </div>
          <p className="field-hint">If this laptop sounds behind the others, move it Earlier. If it sounds ahead, move it Later.</p>
          <div className="trim-actions">
            <Button variant="quiet" size="sm" icon={RotateCcw} onClick={() => p.setTrim(0)} disabled={p.trimMs === 0}>
              Reset
            </Button>
            <Button variant="quiet" size="sm" icon={RefreshCw} onClick={p.onResync}>
              Resync this speaker
            </Button>
          </div>
        </div>
      </section>

      <section className="drawer-section">
        <details className="diag">
          <summary>
            Advanced diagnostics
            <ChevronDown aria-hidden="true" />
          </summary>
          {p.diagnostics}
        </details>
      </section>
    </Drawer>
  );
}
