import { Check, Copy, type LucideIcon } from 'lucide-react';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { Store } from '../../../session/store';
import { gsap, useGSAP } from '../../motion/gsap';
import { announce } from '../../primitives/Feedback';

export function useSnapshot<T>(store: Store<T>): T {
  return useSyncExternalStore(store.subscribe, store.get);
}

/** Clipboard write that must run inside the click; falls back on insecure LAN origins. */
export function copyText(text: string): Promise<void> {
  if (navigator.clipboard?.writeText && window.isSecureContext) return navigator.clipboard.writeText(text);
  return new Promise((resolve, reject) => {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    if (ok) resolve();
    else reject(new Error('Copy failed'));
  });
}

export function CopyButton({
  text,
  label,
  announceText,
  icon: Icon = Copy,
  testId,
}: {
  text: string | null;
  label: string;
  announceText: string;
  icon?: LucideIcon;
  testId?: string;
}) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const ref = useRef<HTMLButtonElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { contextSafe } = useGSAP({ scope: ref });
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);

  const pop = contextSafe(() => {
    const icon = ref.current?.querySelector('.copy-icon svg');
    if (!icon || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    gsap.fromTo(icon, { scale: 0.4, rotation: -30, opacity: 0 }, { scale: 1, rotation: 0, opacity: 1, duration: 0.22, ease: 'power3.out' });
  });

  return (
    <button
      ref={ref}
      type="button"
      className="btn btn--secondary btn--sm copy-btn"
      data-testid={testId}
      data-state={state}
      disabled={!text}
      onClick={() => {
        if (!text) return;
        copyText(text).then(
          () => {
            setState('copied');
            announce(announceText);
            requestAnimationFrame(pop);
          },
          () => setState('failed'),
        );
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => setState('idle'), 1800);
      }}
    >
      <span className="copy-icon" aria-hidden="true">
        {state === 'copied' ? <Check key="check" /> : <Icon key="icon" />}
      </span>
      <span>{state === 'copied' ? 'Copied' : state === 'failed' ? 'Copy failed' : label}</span>
    </button>
  );
}

export function RoomCode({ code, size }: { code: string | null; size?: 'sm' }) {
  const digits = (code ?? '····').split('');
  return (
    <span className="room-code num" data-size={size} aria-label={code ? `Room code ${code.split('').join(' ')}` : 'Room code pending'} data-testid="room-code" data-code={code ?? ''}>
      {digits.map((d, i) => (
        <span key={i} className="room-code-digit" aria-hidden="true">
          {d}
        </span>
      ))}
    </span>
  );
}

export function formatMs(ms: number | null | undefined, digits = 1): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return '—';
  return `${ms.toFixed(digits)} ms`;
}

export function formatPct(v: number): string {
  return `${Math.round(v * 100)}%`;
}
