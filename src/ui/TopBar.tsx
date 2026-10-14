import { CircleHelp } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { gsap, useGSAP } from './motion/gsap';
import { Wordmark } from './visual/Wordmark';

export function TopBar({ onHelp, inRoom }: { onHelp: () => void; inRoom: boolean }) {
  const ref = useRef<HTMLElement>(null);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 4);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  useGSAP(
    () => {
      const mm = gsap.matchMedia();
      mm.add('(prefers-reduced-motion: no-preference)', () => {
        gsap.from('[data-nav]', { opacity: 0, y: -8, duration: 0.22, stagger: 0.04, ease: 'power2.out', clearProps: 'opacity,transform' });
      });
      return () => mm.revert();
    },
    { scope: ref },
  );

  return (
    <header className="topbar" ref={ref} data-scrolled={scrolled ? '' : undefined}>
      <div className="topbar-inner">
        {inRoom ? (
          <span className="brand-link" data-nav>
            <Wordmark />
          </span>
        ) : (
          <a className="brand-link" href="./" data-nav>
            <Wordmark />
          </a>
        )}
        <nav className="topnav" aria-label="Main">
          {inRoom ? null : (
            <a className="nav-link hide-sm" href="#how" data-nav>
              How it works
            </a>
          )}
          <button type="button" className="nav-link" onClick={onHelp} data-nav aria-haspopup="dialog">
            <CircleHelp aria-hidden="true" />
            <span className="nav-text">Help</span>
          </button>
        </nav>
      </div>
    </header>
  );
}
