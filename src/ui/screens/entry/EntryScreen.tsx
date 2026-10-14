import { AlertCircle, Download, Info, Laptop, Wifi } from 'lucide-react';
import { useCallback, useMemo, useRef, useState } from 'react';
import { startRoom } from '../../../session/app';
import { gsap, useGSAP } from '../../motion/gsap';
import { RevealHeadline } from '../../motion/RevealHeadline';
import { useMediaQuery } from '../../motion/useReducedMotion';
import { Accordion } from '../../primitives/Accordion';
import { Button } from '../../primitives/Button';
import { Notice } from '../../primitives/Feedback';
import { detectSupport, supportMessage } from '../../support';
import { SoundStage } from '../../visual/SoundStage';
import { FAQ } from './faq';
import { JoinPanel, type JoinPanelHandle } from './JoinPanel';

declare global {
  interface Window {
    __tripSpeakerMotion?: { entrances: number };
  }
}

export function EntryScreen({ inviteCode }: { inviteCode: string | null }) {
  const [mode, setMode] = useState<'intro' | 'join'>(inviteCode ? 'join' : 'intro');
  const rootRef = useRef<HTMLDivElement>(null);
  const introRef = useRef<HTMLDivElement>(null);
  const joinRef = useRef<HTMLDivElement>(null);
  const joinHandle = useRef<JoinPanelHandle>(null);
  const joinButton = useRef<HTMLButtonElement>(null);
  const support = useMemo(detectSupport, []);
  const notice = supportMessage(support);
  const compactStage = useMediaQuery('(max-width: 960px)');

  useGSAP(
    () => {
      const mm = gsap.matchMedia();
      mm.add({ motion: '(prefers-reduced-motion: no-preference)', reduce: '(prefers-reduced-motion: reduce)' }, (ctx) => {
        const { reduce } = ctx.conditions as { reduce: boolean };
        window.__tripSpeakerMotion = { entrances: (window.__tripSpeakerMotion?.entrances ?? 0) + 1 };
        const tl = gsap.timeline({ defaults: { ease: 'power3.out' } });
        if (reduce) {
          tl.from('[data-enter]', { opacity: 0, duration: 0.2, ease: 'power2.out', clearProps: 'opacity' });
          return;
        }
        tl.from('[data-enter="eyebrow"]', { opacity: 0, y: 8, duration: 0.34, clearProps: 'opacity,transform' }, 0.04)
          .from('[data-enter="lead"]', { opacity: 0, y: 12, duration: 0.4, clearProps: 'opacity,transform' }, 0.34)
          .from('[data-enter="action"]', { opacity: 0, y: 10, duration: 0.36, stagger: 0.06, clearProps: 'opacity,transform' }, 0.4)
          .from('[data-enter="support"]', { opacity: 0, duration: 0.32, clearProps: 'opacity' }, 0.54)
          .from('[data-enter="stage"]', { opacity: 0, scale: 0.975, duration: 0.56, clearProps: 'opacity,transform' }, 0.12);

        const waves = gsap.utils.toArray<SVGPathElement>('.stage-wave');
        waves.forEach((path) => {
          const len = path.getTotalLength();
          gsap.fromTo(
            path,
            { strokeDasharray: len, strokeDashoffset: len },
            { strokeDashoffset: 0, duration: 0.9, ease: 'power2.out', delay: 0.3, clearProps: 'strokeDasharray,strokeDashoffset' },
          );
        });
        gsap.from('.stage-laptop', { opacity: 0, y: 10, duration: 0.5, stagger: 0.07, delay: 0.18, clearProps: 'opacity,transform' });

        gsap.utils.toArray<HTMLElement>('[data-reveal]').forEach((section) => {
          gsap.from(section.querySelectorAll('[data-reveal-item]'), {
            opacity: 0,
            y: 14,
            duration: 0.44,
            stagger: 0.07,
            clearProps: 'opacity,transform',
            scrollTrigger: { trigger: section, start: 'top 82%', once: true },
          });
        });
      });
      return () => mm.revert();
    },
    { scope: rootRef },
  );

  const { contextSafe } = useGSAP({ scope: rootRef });

  // Panels start hidden via a style that never changes after mount, so React
  // never rewrites the inline opacity GSAP is animating.
  const [initialMode] = useState(mode);

  const swap = useCallback(
    contextSafe((next: 'intro' | 'join') => {
      const incoming = next === 'join' ? joinRef.current : introRef.current;
      const outgoing = next === 'join' ? introRef.current : joinRef.current;
      setMode(next);
      if (!incoming || !outgoing) return;
      const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      gsap.killTweensOf([incoming, outgoing]);
      gsap.to(outgoing, {
        opacity: 0,
        y: reduce ? 0 : -6,
        duration: 0.16,
        ease: 'power2.out',
        onComplete: () => void gsap.set(outgoing, { visibility: 'hidden', y: 0 }),
      });
      gsap.set(incoming, { visibility: 'visible' });
      gsap.fromTo(incoming, { opacity: 0, y: reduce ? 0 : 8 }, { opacity: 1, y: 0, duration: 0.22, delay: 0.05, ease: 'power3.out' });
      // Focus moves immediately; the fade never blocks typing.
      requestAnimationFrame(() => {
        if (next === 'join') joinHandle.current?.focusCode();
        else joinButton.current?.focus({ preventScroll: true });
      });
    }),
    [],
  );

  return (
    <div className="screen entry" ref={rootRef}>
      <section className="hero" aria-label="Trip Speaker">
        <div className="hero-left">
          <div ref={introRef} className="hero-panel hero-intro" inert={mode !== 'intro'} style={initialMode === 'intro' ? undefined : HIDDEN_PANEL}>
            <p className="eyebrow" data-enter="eyebrow">
              A speaker you already packed.
            </p>
            <RevealHeadline className="display">
              One track.
              <br />
              Every Mac.
            </RevealHeadline>
            <p className="lead" data-enter="lead">
              Bring your laptops together. Play your music through all of them.
            </p>
            <div className="hero-actions">
              <Button
                variant="primary"
                size="lg"
                arrow
                data-enter="action"
                disabled={!support.canHost}
                onClick={() => {
                  startRoom();
                }}
              >
                Start a room
              </Button>
              <Button ref={joinButton} variant="secondary" size="lg" arrow data-enter="action" disabled={!support.canListen} onClick={() => swap('join')}>
                Join a room
              </Button>
            </div>
            <p className="hero-support" data-enter="support">
              <span>
                <Laptop aria-hidden="true" />
                Chrome on Mac.
              </span>
              <span>
                <Wifi aria-hidden="true" />
                Same Wi-Fi.
              </span>
              <span>
                <Download aria-hidden="true" />
                No install.
              </span>
            </p>
            {notice ? (
              <div className="support-notice" data-enter="support">
                <Notice tone={notice.tone === 'alert' ? 'alert' : undefined} icon={notice.tone === 'alert' ? AlertCircle : Info} title={notice.title}>
                  {notice.body}
                </Notice>
              </div>
            ) : null}
          </div>
          <div ref={joinRef} className="hero-panel" inert={mode !== 'join'} style={initialMode === 'join' ? undefined : HIDDEN_PANEL}>
            <JoinPanel ref={joinHandle} initialCode={inviteCode ?? ''} onBack={() => swap('intro')} disabled={!support.canListen} />
          </div>
        </div>
        <div data-enter="stage">
          <SoundStage compact={compactStage} />
        </div>
      </section>

      <section id="how" className="how" aria-labelledby="how-title" data-reveal>
        <div className="section-head" data-reveal-item>
          <p className="label">How it works</p>
          <h2 id="how-title">Three steps to one sound.</h2>
        </div>
        <ol className="how-steps">
          <li className="how-step" data-reveal-item>
            <span className="how-num num">01</span>
            <h3>Start a room</h3>
            <p>One laptop hosts and gets a four-digit code. Everyone else joins with it.</p>
          </li>
          <li className="how-step" data-reveal-item>
            <span className="how-num num">02</span>
            <h3>Share your music tab</h3>
            <p>Play Spotify in a Chrome tab, pick that tab, and turn on Share tab audio.</p>
          </li>
          <li className="how-step" data-reveal-item>
            <span className="how-num num">03</span>
            <h3>Listen together</h3>
            <p>Every laptop plays the same moment about a second later. Set each volume and enjoy.</p>
          </li>
        </ol>
      </section>

      <section className="faq" aria-labelledby="faq-title" data-reveal>
        <div className="section-head" data-reveal-item>
          <p className="label">Questions</p>
          <h2 id="faq-title">Before you press play.</h2>
          <p>Short answers about how Trip Speaker actually works.</p>
        </div>
        <div data-reveal-item>
          <Accordion entries={FAQ} />
        </div>
      </section>

      <footer className="site-foot">
        <span>Trip Speaker is not affiliated with Spotify.</span>
        <span>Room codes are for finding each other, not for security.</span>
      </footer>
    </div>
  );
}

const HIDDEN_PANEL = { opacity: 0, visibility: 'hidden' } as const;
