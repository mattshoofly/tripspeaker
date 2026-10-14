/*
 * Headline word reveal adapted from React Bits "SplitText"
 * (https://reactbits.dev, MIT + Commons Clause, © 2026 David Haz).
 * Changes: words masked by line, no ScrollTrigger, reduced-motion aware,
 * plays once per mount, and leaves the heading readable if GSAP fails.
 */
import { forwardRef, useImperativeHandle, useRef, type ReactNode } from 'react';
import { gsap, SplitText, useGSAP } from './gsap';

export interface RevealHeadlineProps {
  as?: 'h1' | 'h2';
  className?: string;
  children: ReactNode;
  delay?: number;
  onPlay?: () => void;
}

export const RevealHeadline = forwardRef<HTMLHeadingElement, RevealHeadlineProps>(function RevealHeadline(
  { as: Tag = 'h1', className, children, delay = 0.1, onPlay },
  forwarded,
) {
  const ref = useRef<HTMLHeadingElement>(null);
  const played = useRef(false);
  useImperativeHandle(forwarded, () => ref.current as HTMLHeadingElement, []);

  useGSAP(
    () => {
      const el = ref.current;
      if (!el) return;
      const mm = gsap.matchMedia();
      mm.add('(prefers-reduced-motion: no-preference)', () => {
        let split: SplitText | null = null;
        try {
          split = SplitText.create(el, {
            type: 'lines,words',
            mask: 'lines',
            linesClass: 'hl-line',
            aria: 'auto',
            autoSplit: true,
            onSplit(self) {
              // Re-splits after font load or resize keep their progress instead of replaying.
              const tween = gsap.from(self.words, {
                yPercent: 108,
                duration: 0.62,
                ease: 'power3.out',
                stagger: 0.07,
                delay: played.current ? 0 : delay,
                onStart: () => {
                  if (!played.current) onPlay?.();
                  played.current = true;
                },
              });
              return tween;
            },
          });
        } catch (err) {
          console.warn('Trip Speaker: headline animation skipped', err);
        }
        return () => split?.revert();
      });
      return () => mm.revert();
    },
    { scope: ref },
  );

  return (
    <Tag ref={ref} className={className}>
      {children}
    </Tag>
  );
});
