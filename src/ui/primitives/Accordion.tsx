import { Plus } from 'lucide-react';
import { useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { gsap, useGSAP } from '../motion/gsap';
import { useReducedMotion } from '../motion/useReducedMotion';

export interface AccordionEntry {
  id: string;
  title: string;
  body: ReactNode;
}

function Item({ entry, headingLevel }: { entry: AccordionEntry; headingLevel: 3 | 4 }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const iconRef = useRef<HTMLSpanElement>(null);
  const firstRun = useRef(true);
  const reduced = useReducedMotion();
  const panelId = useId();
  const triggerId = useId();
  useGSAP({ scope: rootRef });

  useLayoutEffect(() => {
    const panel = panelRef.current;
    const icon = iconRef.current;
    if (!panel || !icon) return;
    const instant = firstRun.current || reduced;
    firstRun.current = false;
    gsap.killTweensOf([panel, icon]);
    if (open) {
      panel.hidden = false;
      if (instant) {
        gsap.set(panel, { height: 'auto' });
        gsap.set(icon, { rotation: 45 });
      } else {
        gsap.fromTo(panel, { height: panel.offsetHeight }, { height: 'auto', duration: 0.24, ease: 'power3.out' });
        gsap.to(icon, { rotation: 45, duration: 0.22, ease: 'power3.out' });
      }
    } else if (instant) {
      gsap.set(panel, { height: 0 });
      gsap.set(icon, { rotation: 0 });
      panel.hidden = true;
    } else {
      gsap.to(panel, { height: 0, duration: 0.2, ease: 'power2.out', onComplete: () => void (panel.hidden = true) });
      gsap.to(icon, { rotation: 0, duration: 0.2, ease: 'power3.out' });
    }
  }, [open, reduced]);

  const Heading = headingLevel === 3 ? 'h3' : 'h4';
  return (
    <div className="accordion-item" ref={rootRef}>
      <Heading style={{ font: 'inherit', margin: 0 }}>
        <button
          id={triggerId}
          type="button"
          className="accordion-trigger"
          aria-expanded={open}
          aria-controls={panelId}
          onClick={() => setOpen((v) => !v)}
        >
          <span>{entry.title}</span>
          <span className="accordion-icon" ref={iconRef} aria-hidden="true">
            <Plus />
          </span>
        </button>
      </Heading>
      <div id={panelId} role="region" aria-labelledby={triggerId} className="accordion-panel" ref={panelRef}>
        <div className="accordion-panel-inner">{entry.body}</div>
      </div>
    </div>
  );
}

export function Accordion({ entries, headingLevel = 3 }: { entries: AccordionEntry[]; headingLevel?: 3 | 4 }) {
  return (
    <div className="accordion">
      {entries.map((e) => (
        <Item key={e.id} entry={e} headingLevel={headingLevel} />
      ))}
    </div>
  );
}
