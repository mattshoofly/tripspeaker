import { ArrowLeft } from 'lucide-react';
import { useEffect, useRef, type ReactNode } from 'react';
import { Button } from '../../primitives/Button';

function EndedArt() {
  return (
    <svg className="ended-art" viewBox="0 0 132 92" fill="none" aria-hidden="true">
      <rect x="18" y="8" width="96" height="62" rx="5" stroke="currentColor" strokeWidth="1.25" />
      <rect x="23" y="13" width="86" height="51" rx="2.5" fill="#0d0f0b" />
      <path d="M30 39 H102" stroke="rgba(243,243,233,0.35)" strokeWidth="1.25" strokeLinecap="round" />
      <path d="M8 76 H124 L118 70 H14 Z" stroke="currentColor" strokeWidth="1.25" strokeLinejoin="round" />
      <circle cx="66" cy="10.5" r="1.4" fill="currentColor" />
    </svg>
  );
}

export function RoomEnded({
  title,
  body,
  actionLabel = 'Back to start',
  onAction,
  extra,
  testId = 'room-ended',
}: {
  title: string;
  body: ReactNode;
  actionLabel?: string;
  onAction: () => void;
  extra?: ReactNode;
  testId?: string;
}) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => headingRef.current?.focus({ preventScroll: true }), []);
  return (
    <section className="ended" data-testid={testId} aria-labelledby="ended-title">
      <div className="ended-card">
        <EndedArt />
        <h1 id="ended-title" className="ended-title" tabIndex={-1} ref={headingRef}>
          {title}
        </h1>
        <p className="ended-body">{body}</p>
        <div className="listen-actions" style={{ justifyContent: 'center' }}>
          {extra}
          <Button variant="primary" size="lg" icon={ArrowLeft} onClick={onAction}>
            {actionLabel}
          </Button>
        </div>
      </div>
    </section>
  );
}
