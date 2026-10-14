import { useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { app } from './session/app';
import { HelpDrawer } from './ui/HelpDrawer';
import { gsap, useGSAP } from './ui/motion/gsap';
import { LiveRegion } from './ui/primitives/Feedback';
import { EntryScreen } from './ui/screens/entry/EntryScreen';
import { GuestRoom } from './ui/screens/room/GuestRoom';
import { HostRoom } from './ui/screens/room/HostRoom';
import { TopBar } from './ui/TopBar';

let initialScreenKey: string | null = null;

/** Brief crossfade between app states; the very first screen has its own entrance. */
function ScreenFade({ screenKey, children }: { screenKey: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  if (initialScreenKey === null) initialScreenKey = screenKey;
  useGSAP(
    () => {
      if (screenKey === initialScreenKey) return;
      window.scrollTo({ top: 0 });
      const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      gsap.fromTo(ref.current, { opacity: 0, y: reduce ? 0 : 6 }, { opacity: 1, y: 0, duration: 0.22, ease: 'power2.out', clearProps: 'opacity,transform' });
    },
    { scope: ref },
  );
  return (
    <div className="screen" ref={ref}>
      {children}
    </div>
  );
}

export function App() {
  const view = useSyncExternalStore(app.subscribe, app.get);
  const [helpOpen, setHelpOpen] = useState(false);
  const key = view.screen === 'home' ? `home-${view.visit}` : view.screen;
  return (
    <>
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <TopBar onHelp={() => setHelpOpen(true)} inRoom={view.screen !== 'home'} />
      <main id="main" className="app-main" tabIndex={-1}>
        <ScreenFade key={key} screenKey={key}>
          {view.screen === 'home' ? (
            <EntryScreen inviteCode={view.inviteCode} />
          ) : view.screen === 'host' ? (
            <HostRoom controller={view.host} />
          ) : (
            <GuestRoom controller={view.guest} />
          )}
        </ScreenFade>
      </main>
      <HelpDrawer open={helpOpen} onClose={() => setHelpOpen(false)} />
      <LiveRegion />
    </>
  );
}
