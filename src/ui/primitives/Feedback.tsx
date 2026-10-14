import { Check, type LucideIcon } from 'lucide-react';
import { useSyncExternalStore, type ReactNode } from 'react';
import { Store } from '../../session/store';

export function Pill({ tone, icon: Icon, dot, children, testId }: { tone?: 'live' | 'alert'; icon?: LucideIcon; dot?: boolean; children: ReactNode; testId?: string }) {
  return (
    <span className="pill" data-tone={tone} data-testid={testId}>
      {Icon ? <Icon aria-hidden="true" /> : dot ? <span className="dot" aria-hidden="true" /> : null}
      {children}
    </span>
  );
}

export function Notice({
  tone,
  icon: Icon,
  title,
  children,
  actions,
  testId,
}: {
  tone?: 'alert' | 'live';
  icon: LucideIcon;
  title: ReactNode;
  children?: ReactNode;
  actions?: ReactNode;
  testId?: string;
}) {
  return (
    <div className="notice" data-tone={tone} data-testid={testId}>
      <Icon aria-hidden="true" />
      <p className="notice-title">{title}</p>
      {children ? <div className="notice-body">{children}</div> : null}
      {actions ? <div className="notice-actions">{actions}</div> : null}
    </div>
  );
}

export interface CheckEntry {
  id: string;
  label: string;
  done: boolean;
  pending?: boolean;
}

export function Checklist({ items, label }: { items: CheckEntry[]; label: string }) {
  return (
    <ul className="checklist" aria-label={label}>
      {items.map((item) => (
        <li key={item.id} className="check-item" data-done={item.done ? '' : undefined} data-pending={!item.done && item.pending ? '' : undefined}>
          <span className="check-mark" aria-hidden="true">
            <Check />
          </span>
          <span>
            {item.label}
            <span className="sr-only">{item.done ? ', done' : ', not yet'}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

const announcements = new Store<{ text: string; n: number }>({ text: '', n: 0 });
let clearTimer: ReturnType<typeof setTimeout> | null = null;

/** Polite announcement for meaningful status changes only (never per-sample updates). */
export function announce(text: string): void {
  const prev = announcements.get();
  if (prev.text.replace(/\u200b/g, '') === text) return;
  announcements.set({ text: prev.n % 2 ? text : `${text}\u200b`, n: prev.n + 1 });
  if (clearTimer) clearTimeout(clearTimer);
  clearTimer = setTimeout(() => announcements.set({ text: '', n: announcements.get().n + 1 }), 4000);
}

export function LiveRegion() {
  const { text } = useSyncExternalStore(announcements.subscribe, announcements.get);
  return (
    <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">
      {text}
    </div>
  );
}
