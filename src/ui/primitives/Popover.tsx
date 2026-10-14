import { useEffect, useId, useRef, useState, type CSSProperties, type ReactNode } from 'react';

interface PopoverProps {
  label: string;
  className?: string;
  trigger: (props: { popoverTarget: string; 'aria-expanded': boolean; 'aria-controls': string; style: CSSProperties }) => ReactNode;
  children: ReactNode;
}

/** Anchored popover using the Popover API (light dismiss + Escape built in). */
export function Popover({ label, className, trigger, children }: PopoverProps) {
  const id = `pop-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const anchor = `--${id}`;
  const ref = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onToggle = (e: Event) => {
      const isOpen = (e as ToggleEvent).newState === 'open';
      setOpen(isOpen);
      if (isOpen) requestAnimationFrame(() => el.querySelector<HTMLElement>('input, button, [tabindex]')?.focus());
    };
    el.addEventListener('toggle', onToggle);
    return () => el.removeEventListener('toggle', onToggle);
  }, []);
  return (
    <>
      {trigger({ popoverTarget: id, 'aria-expanded': open, 'aria-controls': id, style: { anchorName: anchor } as CSSProperties })}
      <div ref={ref} id={id} popover="auto" role="dialog" aria-label={label} className={['popover', className].filter(Boolean).join(' ')} style={{ positionAnchor: anchor } as CSSProperties}>
        {children}
      </div>
    </>
  );
}

export function Switch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return <button type="button" role="switch" aria-checked={checked} aria-label={label} className="switch" onClick={() => onChange(!checked)} />;
}
