import { forwardRef, useId, useMemo } from 'react';

/**
 * Entry-screen illustration: three abstract laptops joined by one waveform.
 * It is a fixed drawing, not a live view of any room.
 */

interface LaptopSpec {
  id: string;
  x: number;
  y: number;
  w: number;
  host?: boolean;
  depth: number;
}

const LAPTOPS: LaptopSpec[] = [
  { id: 'far', x: 34, y: 142, w: 176, depth: 0.5 },
  { id: 'right', x: 404, y: 128, w: 190, depth: 0.7 },
  { id: 'host', x: 160, y: 166, w: 300, host: true, depth: 1 },
];

const VIEW_W = 620;
const VIEW_H = 470;
const WAVE_Y = 226;

function screenRect(l: LaptopSpec) {
  const h = l.w * 0.64;
  const bezel = l.w * 0.04;
  return { x: l.x + bezel, y: l.y + bezel, w: l.w - bezel * 2, h: h - bezel * 2.2, outerH: h };
}

function wavePath(): string {
  const pts: string[] = [];
  const x0 = 24;
  const x1 = VIEW_W - 24;
  for (let x = x0; x <= x1; x += 3) {
    const u = (x - x0) / (x1 - x0);
    const env = Math.pow(Math.sin(Math.PI * u), 1.35);
    const y =
      WAVE_Y +
      env *
        (22 * Math.sin(2 * Math.PI * (x / 58) + 0.6) +
          9 * Math.sin(2 * Math.PI * (x / 23) + 1.7) +
          5 * Math.sin(2 * Math.PI * (x / 11) + 0.2));
    pts.push(`${x === x0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`);
  }
  return pts.join(' ');
}

function Laptop({ l, clipId }: { l: LaptopSpec; clipId: string }) {
  const s = screenRect(l);
  const baseY = l.y + s.outerH;
  const lip = l.w * 0.075;
  const deck = l.w * 0.05;
  const stroke = `rgba(243,243,233,${0.28 + 0.34 * l.depth})`;
  return (
    <g className="stage-laptop" data-laptop={l.id}>
      <ellipse cx={l.x + l.w / 2} cy={baseY + deck + l.w * 0.03} rx={l.w * 0.6} ry={l.w * 0.032} fill="rgba(0,0,0,0.45)" />
      <rect x={l.x} y={l.y} width={l.w} height={s.outerH} rx={l.w * 0.045} fill="#171a14" stroke={stroke} strokeWidth="1.25" />
      <rect x={s.x} y={s.y} width={s.w} height={s.h} rx={l.w * 0.022} fill="#0d0f0b" />
      <clipPath id={clipId}>
        <rect x={s.x} y={s.y} width={s.w} height={s.h} rx={l.w * 0.022} />
      </clipPath>
      <path
        d={`M${l.x - lip} ${baseY + deck} L${l.x + l.w + lip} ${baseY + deck} Q${l.x + l.w + lip * 0.6} ${baseY} ${l.x + l.w} ${baseY} L${l.x} ${baseY} Q${l.x - lip * 0.6} ${baseY} ${l.x - lip} ${baseY + deck} Z`}
        fill="#1d2019"
        stroke={stroke}
        strokeWidth="1.25"
        strokeLinejoin="round"
      />
      <line x1={l.x + l.w / 2 - l.w * 0.08} y1={baseY + deck - 1} x2={l.x + l.w / 2 + l.w * 0.08} y2={baseY + deck - 1} stroke={stroke} strokeWidth="1.25" strokeLinecap="round" />
      {l.host ? <circle cx={l.x + l.w / 2} cy={l.y + l.w * 0.022} r={2.2} fill="var(--accent)" /> : null}
    </g>
  );
}

export const SoundStage = forwardRef<HTMLElement, { compact?: boolean }>(function SoundStage({ compact }, ref) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '');
  const d = useMemo(wavePath, []);
  const host = LAPTOPS.find((l) => l.host)!;
  const hostScreen = screenRect(host);
  return (
    <figure className="stage" ref={ref} data-compact={compact ? '' : undefined}>
      <div className="stage-frame">
        <svg className="stage-svg" viewBox={`0 0 ${VIEW_W} ${VIEW_H}`} role="img" aria-labelledby={`${uid}-t`}>
          <title id={`${uid}-t`}>Illustration: three laptops connected by one waveform</title>
          <defs>
            <linearGradient id={`${uid}-floor`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="rgba(243,243,233,0)" />
              <stop offset="1" stopColor="rgba(243,243,233,0.05)" />
            </linearGradient>
            <clipPath id={`${uid}-hostscreen`}>
              <rect x={hostScreen.x} y={hostScreen.y} width={hostScreen.w} height={hostScreen.h} />
            </clipPath>
          </defs>
          <g className="stage-grid" stroke="rgba(243,243,233,0.05)" strokeWidth="1">
            {[0.2, 0.4, 0.6, 0.8].map((f) => (
              <line key={f} x1={VIEW_W * f} y1={40} x2={VIEW_W * f} y2={VIEW_H - 40} />
            ))}
          </g>
          <path className="stage-wave stage-wave--thread" d={d} fill="none" stroke="rgba(243,243,233,0.22)" strokeWidth="1.25" strokeLinecap="round" />
          {LAPTOPS.map((l) => (
            <Laptop key={l.id} l={l} clipId={`${uid}-${l.id}`} />
          ))}
          {LAPTOPS.map((l) => (
            <path
              key={`w-${l.id}`}
              className="stage-wave stage-wave--screen"
              d={d}
              fill="none"
              clipPath={`url(#${uid}-${l.id})`}
              stroke={l.host ? 'var(--accent)' : 'rgba(243,243,233,0.85)'}
              strokeWidth={l.host ? 1.8 : 1.5}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          ))}
        </svg>
      </div>
      <figcaption className="stage-caption">
        <span className="stage-caption-mark" aria-hidden="true" />
        Illustration — one track, every laptop
      </figcaption>
    </figure>
  );
});
