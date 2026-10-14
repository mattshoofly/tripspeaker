import { useEffect, useRef } from 'react';
import type { VisualizerMode } from '../../session/prefs';

export interface WaveformProps {
  /** Returns the analyser to read, or null when there is no audio graph yet. */
  source: () => AnalyserNode | null;
  mode: VisualizerMode;
  label: string;
  className?: string;
}

const COLUMN_PX = 4;

/** Maps RMS to 0..1 on a -60..0 dBFS scale; true silence stays at 0. */
export function levelToHeight(rms: number): number {
  if (!(rms > 0.0005)) return 0;
  const db = 20 * Math.log10(rms);
  return Math.max(0, Math.min(1, (db + 60) / 54));
}

/**
 * Scrolling level history drawn from real analyser samples. It runs on its
 * own animation frame at a capped rate, never touches React state, and a
 * drawing failure only stops the drawing.
 */
export function Waveform({ source, mode, label, className }: WaveformProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sourceRef = useRef(source);
  sourceRef.current = source;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let width = 0;
    let height = 0;
    let dpr = 1;
    let history = new Float32Array(0);
    let samples: Float32Array<ArrayBuffer> = new Float32Array(1024);
    let raf = 0;
    let last = 0;
    let visible = true;
    let failed = false;
    const fps = mode === 'calm' ? 8 : 24;
    const accent = getComputedStyle(canvas).getPropertyValue('--accent').trim() || '#D5F86F';

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      dpr = Math.min(2, window.devicePixelRatio || 1);
      width = Math.max(1, Math.round(rect.width));
      height = Math.max(1, Math.round(rect.height));
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      const cols = Math.max(8, Math.ceil(width / COLUMN_PX) + 2);
      const next = new Float32Array(cols);
      next.set(history.subarray(Math.max(0, history.length - cols)), Math.max(0, cols - history.length));
      history = next;
      draw();
    };

    const read = (): number => {
      const analyser = sourceRef.current();
      if (!analyser) return 0;
      if (samples.length !== analyser.fftSize) samples = new Float32Array(analyser.fftSize);
      analyser.getFloatTimeDomainData(samples);
      let sum = 0;
      for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
      return levelToHeight(Math.sqrt(sum / samples.length));
    };

    const draw = () => {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);
      const mid = height / 2 + 6;
      const amp = Math.max(4, height / 2 - 18) * (mode === 'calm' ? 0.6 : 1);
      ctx.lineWidth = 1;
      ctx.strokeStyle = 'rgba(243,243,233,0.14)';
      ctx.beginPath();
      ctx.moveTo(0, mid + 0.5);
      ctx.lineTo(width, mid + 0.5);
      ctx.stroke();
      if (mode === 'off') return;

      const n = history.length;
      const xAt = (i: number) => width - (n - 1 - i) * COLUMN_PX;
      let any = false;
      for (let i = 0; i < n; i++) if (history[i] > 0.01) any = true;
      if (any) {
        ctx.beginPath();
        ctx.moveTo(xAt(0), mid);
        for (let i = 0; i < n; i++) ctx.lineTo(xAt(i), mid - history[i] * amp);
        for (let i = n - 1; i >= 0; i--) ctx.lineTo(xAt(i), mid + history[i] * amp);
        ctx.closePath();
        ctx.fillStyle = 'rgba(243,243,233,0.075)';
        ctx.fill();

        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';
        ctx.lineWidth = 1.25;
        ctx.strokeStyle = 'rgba(243,243,233,0.62)';
        for (const sign of [-1, 1]) {
          ctx.beginPath();
          for (let i = 0; i < n; i++) {
            const y = mid + sign * history[i] * amp;
            if (i === 0) ctx.moveTo(xAt(i), y);
            else ctx.lineTo(xAt(i), y);
          }
          ctx.stroke();
        }
        if (mode === 'live') {
          const tail = Math.min(n, 28);
          ctx.strokeStyle = accent;
          ctx.lineWidth = 1.6;
          for (const sign of [-1, 1]) {
            ctx.beginPath();
            for (let i = n - tail; i < n; i++) {
              const y = mid + sign * history[i] * amp;
              if (i === n - tail) ctx.moveTo(xAt(i), y);
              else ctx.lineTo(xAt(i), y);
            }
            ctx.stroke();
          }
        }
      }
      const head = history[n - 1] ?? 0;
      ctx.fillStyle = head > 0.01 ? accent : 'rgba(243,243,233,0.35)';
      ctx.beginPath();
      ctx.arc(width - 3, mid, 2.5, 0, Math.PI * 2);
      ctx.fill();
    };

    const frame = (t: number) => {
      raf = requestAnimationFrame(frame);
      if (!visible || failed) return;
      if (t - last < 1000 / fps) return;
      last = t;
      try {
        history.copyWithin(0, 1);
        history[history.length - 1] = read();
        draw();
      } catch (err) {
        failed = true;
        cancelAnimationFrame(raf);
        console.warn('Trip Speaker: visualizer stopped', err);
      }
    };

    const ro = new ResizeObserver(resize);
    ro.observe(canvas);
    const io = new IntersectionObserver((entries) => {
      visible = entries.some((e) => e.isIntersecting);
    });
    io.observe(canvas);
    resize();
    if (mode !== 'off') raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
    };
  }, [mode]);

  return <canvas ref={canvasRef} className={['waveform', className].filter(Boolean).join(' ')} role="img" aria-label={label} data-mode={mode} />;
}

/** Small bar meter for the host's shared-tab input, read directly from an analyser. */
export function InputMeter({ source, label }: { source: () => AnalyserNode | null; label: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const sourceRef = useRef(source);
  sourceRef.current = source;
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const bars = Array.from(el.children) as HTMLElement[];
    let raf = 0;
    let last = 0;
    let buf: Float32Array<ArrayBuffer> = new Float32Array(1024);
    const tick = (t: number) => {
      raf = requestAnimationFrame(tick);
      if (t - last < 66) return;
      last = t;
      const a = sourceRef.current();
      let h = 0;
      if (a) {
        if (buf.length !== a.fftSize) buf = new Float32Array(a.fftSize);
        a.getFloatTimeDomainData(buf);
        let s = 0;
        for (let i = 0; i < buf.length; i++) s += buf[i] * buf[i];
        h = levelToHeight(Math.sqrt(s / buf.length));
      }
      bars.forEach((bar, i) => bar.toggleAttribute('data-on', h >= ((i + 0.5) / bars.length) * 0.9));
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);
  return (
    <span className="input-meter" ref={ref} role="img" aria-label={label}>
      {[0, 1, 2, 3, 4].map((i) => (
        <span key={i} className="input-meter-bar" />
      ))}
    </span>
  );
}

/** Coarse activity bars from a reported level (status messages), not a live signal. */
export function ActivityBars({ level, muted }: { level: number | null; muted: boolean }) {
  if (level === null) return null;
  const h = levelToHeight(level);
  return (
    <span className="activity" aria-hidden="true" data-muted={muted ? '' : undefined}>
      {[0.25, 0.55, 0.85].map((t) => (
        <span key={t} className="activity-bar" data-on={h >= t ? '' : undefined} />
      ))}
    </span>
  );
}
