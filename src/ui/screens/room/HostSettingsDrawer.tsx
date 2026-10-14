import { ChevronDown } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { COMMON_BUFFER_MAX_MS, COMMON_BUFFER_MIN_MS } from '../../../core/timeline';
import { describeSignaling, resolveConnectionConfig } from '../../../config';
import type { VisualizerMode } from '../../../session/prefs';
import type { HostSnapshot } from '../../../session/types';
import type { HostRoomController } from './HostRoom';
import { Drawer } from '../../primitives/Drawer';
import { Slider } from '../../primitives/Slider';

export function VisualizerChoice({ value, onChange }: { value: VisualizerMode; onChange: (m: VisualizerMode) => void }) {
  const options: { id: VisualizerMode; label: string }[] = [
    { id: 'live', label: 'Live' },
    { id: 'calm', label: 'Calm' },
    { id: 'off', label: 'Still' },
  ];
  return (
    <div className="segmented" role="radiogroup" aria-label="Visualizer">
      {options.map((o) => (
        <label key={o.id}>
          <input type="radio" name="visualizer" value={o.id} checked={value === o.id} onChange={() => onChange(o.id)} />
          <span>{o.label}</span>
        </label>
      ))}
    </div>
  );
}

export function HostSettingsDrawer({
  open,
  onClose,
  snapshot: s,
  controller,
  visualizer,
  setVisualizer,
  diagnostics,
}: {
  open: boolean;
  onClose: () => void;
  snapshot: HostSnapshot;
  controller: Pick<HostRoomController, 'setHostName' | 'setCommonBuffer'>;
  visualizer: VisualizerMode;
  setVisualizer: (m: VisualizerMode) => void;
  diagnostics: ReactNode;
}) {
  const [name, setName] = useState(s.hostName);
  const config = resolveConnectionConfig();
  return (
    <Drawer open={open} onClose={onClose} title="Sound settings" subtitle="Room-wide timing, this Mac’s name, and the visualizer." testId="settings-drawer">
      <section className="drawer-section" aria-labelledby="set-name">
        <h3 id="set-name">This Mac</h3>
        <div className="field">
          <label className="field-label" htmlFor="host-name">
            Name guests see
          </label>
          <input
            id="host-name"
            className="text-input"
            maxLength={32}
            value={name}
            onChange={(e) => setName(e.currentTarget.value)}
            onBlur={() => controller.setHostName(name)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') controller.setHostName(name);
            }}
          />
        </div>
      </section>

      <section className="drawer-section" aria-labelledby="set-delay">
        <h3 id="set-delay">Shared delay</h3>
        <div className="slider-row" style={{ gridTemplateColumns: 'minmax(0,1fr) auto' }}>
          <Slider
            label="Shared delay for every speaker"
            value={s.commonBufferMs}
            min={COMMON_BUFFER_MIN_MS}
            max={COMMON_BUFFER_MAX_MS}
            step={50}
            onChange={(v) => controller.setCommonBuffer(v)}
            valueText={(v) => `${(v / 1000).toFixed(2)} seconds`}
          />
          <span className="slider-value">{(s.commonBufferMs / 1000).toFixed(2)} s</span>
        </div>
        <p className="field-hint">
          Every speaker waits this long before playing, so slow Wi-Fi moments don’t cause gaps. Longer is steadier; changing it briefly re-times
          every speaker at once.
        </p>
      </section>

      <section className="drawer-section" aria-labelledby="set-vis">
        <h3 id="set-vis">Visualizer</h3>
        <VisualizerChoice value={visualizer} onChange={setVisualizer} />
        <p className="field-hint">Calm and Still use less motion. Playback is unaffected either way.</p>
      </section>

      <section className="drawer-section" aria-labelledby="set-conn">
        <h3 id="set-conn">Connection</h3>
        <dl className="kv">
          <dt>Service</dt>
          <dd>{s.signaling === 'online' ? 'Connected' : s.signaling === 'reconnecting' ? 'Reconnecting' : s.signaling === 'offline' ? 'Unavailable' : 'Connecting'}</dd>
          <dt>Server</dt>
          <dd>{describeSignaling(config)}</dd>
          <dt>Tab audio suppression</dt>
          <dd data-tone={s.capture.suppression === 'off' ? 'alert' : undefined}>
            {s.capture.status !== 'sharing' ? 'Checked when you share' : s.capture.suppression === 'on' ? 'On — only the delayed copy plays' : s.capture.suppression === 'off' ? 'Off — this Mac plays twice' : 'Not reported'}
          </dd>
          {s.capture.status === 'sharing' && s.capture.processing ? (
            <>
              <dt>Chrome voice processing on the tab</dt>
              <dd>
                {[
                  s.capture.processing.echoCancellation ? 'echo cancellation on' : 'echo cancellation off',
                  s.capture.processing.noiseSuppression ? 'noise suppression on' : 'noise suppression off',
                  s.capture.processing.autoGainControl ? 'auto gain on' : 'auto gain off',
                ].join(', ')}
              </dd>
            </>
          ) : null}
        </dl>
        <details className="diag">
          <summary>
            Advanced diagnostics
            <ChevronDown aria-hidden="true" />
          </summary>
          {diagnostics}
        </details>
      </section>
    </Drawer>
  );
}
