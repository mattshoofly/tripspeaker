import { useState, type FormEvent } from 'react';
import { describeSignaling, parseIceServers, parseSignaling, readOverride, resolveConnectionConfig, writeOverride } from '../config';
import { Button } from './primitives/Button';
import { Drawer } from './primitives/Drawer';

const CHECKS = [
  'Chrome on every Mac, all on the same Wi-Fi.',
  'Volume up on each laptop, using its built-in speakers.',
  'Laptops open, awake, and ideally plugged in.',
  'On the host: music playing in a Chrome tab, such as the Spotify web player.',
];

export function HelpDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Drawer open={open} onClose={onClose} title="Help" subtitle="Everything that matters before the first song." testId="help-drawer">
      <section className="drawer-section" aria-labelledby="help-ready">
        <h3 id="help-ready">Before you start</h3>
        <ul className="help-list">
          {CHECKS.map((c) => (
            <li key={c}>{c}</li>
          ))}
        </ul>
      </section>
      <section className="drawer-section" aria-labelledby="help-fix">
        <h3 id="help-fix">If something sounds off</h3>
        <dl className="help-dl">
          <dt>An echo or doubled beat</dt>
          <dd>Open Hear an echo? on the laptop that sounds off, play test clicks, and nudge its timing Earlier or Later.</dd>
          <dt>A laptop is silent</dt>
          <dd>Click Enable this speaker on it, check its volume, and make sure it isn’t muted in Trip Speaker.</dd>
          <dt>Nobody can connect</dt>
          <dd>Your network may keep devices apart. Try a phone hotspot. Trip Speaker needs the internet briefly to introduce laptops.</dd>
          <dt>Sound stops when a lid closes</dt>
          <dd>Mac audio sleeps with the lid closed. Keep laptops open; Trip Speaker asks Chrome to keep the screen awake where it can.</dd>
        </dl>
      </section>
      <section className="drawer-section" aria-labelledby="help-adv">
        <h3 id="help-adv">Advanced connection</h3>
        <ConnectionSettings />
      </section>
    </Drawer>
  );
}

function ConnectionSettings() {
  const current = resolveConnectionConfig();
  const override = readOverride();
  const sig = parseSignaling(override?.signaling);
  const [host, setHost] = useState(sig?.host ?? '');
  const [port, setPort] = useState(sig ? String(sig.port) : '443');
  const [path, setPath] = useState(sig?.path ?? '/');
  const [ice, setIce] = useState(override?.iceServers ? JSON.stringify(override.iceServers, null, 2) : '');
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const save = (e: FormEvent) => {
    e.preventDefault();
    setSaved(false);
    const next: Record<string, unknown> = {};
    if (host.trim()) {
      const parsed = parseSignaling({ host, port, path, secure: Number(port) === 443 ? true : location.protocol === 'https:' });
      if (!parsed) {
        setError('Check the server address and port.');
        return;
      }
      next.signaling = parsed;
    }
    if (ice.trim()) {
      const servers = parseIceServers(ice);
      if (!servers) {
        setError('ICE servers must be a JSON list of { "urls": "stun:…" } entries.');
        return;
      }
      next.iceServers = servers;
    }
    writeOverride(Object.keys(next).length ? next : null);
    setError(null);
    setSaved(true);
  };

  const reset = () => {
    writeOverride(null);
    setHost('');
    setPort('443');
    setPath('/');
    setIce('');
    setError(null);
    setSaved(true);
  };

  return (
    <form className="adv-form" onSubmit={save}>
      <p className="field-hint">
        Optional. Every laptop in a room must use the same server. Values are saved in this browser and visible to anyone using it, so
        never paste private credentials here.
      </p>
      <p className="field-hint">
        Now using: <span className="muted-text">{describeSignaling(current)}</span>
      </p>
      <div className="adv-grid">
        <div className="field">
          <label className="field-label" htmlFor="adv-host">
            PeerJS server host
          </label>
          <input id="adv-host" className="text-input" value={host} placeholder="peer.example.com" onChange={(e) => setHost(e.currentTarget.value)} />
        </div>
        <div className="field">
          <label className="field-label" htmlFor="adv-port">
            Port
          </label>
          <input id="adv-port" className="text-input" inputMode="numeric" value={port} onChange={(e) => setPort(e.currentTarget.value)} />
        </div>
      </div>
      <div className="field">
        <label className="field-label" htmlFor="adv-path">
          Path
        </label>
        <input id="adv-path" className="text-input" value={path} onChange={(e) => setPath(e.currentTarget.value)} />
      </div>
      <div className="field">
        <label className="field-label" htmlFor="adv-ice">
          ICE servers (JSON, public entries only)
        </label>
        <textarea
          id="adv-ice"
          className="text-input"
          value={ice}
          placeholder='[{ "urls": "stun:stun.l.google.com:19302" }]'
          onChange={(e) => setIce(e.currentTarget.value)}
        />
      </div>
      {error ? (
        <p className="field-hint" role="alert" style={{ color: 'var(--alert)' }}>
          {error}
        </p>
      ) : saved ? (
        <p className="field-hint" role="status">
          Saved. New rooms and joins use these settings.
        </p>
      ) : null}
      <div className="adv-actions">
        <Button type="submit" variant="secondary" size="sm">
          Save
        </Button>
        <Button variant="quiet" size="sm" onClick={reset}>
          Use defaults
        </Button>
      </div>
    </form>
  );
}
