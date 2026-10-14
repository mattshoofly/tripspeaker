import type { LucideIcon } from 'lucide-react';
import { useEffect, useId, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react';

export interface MenuItem {
  id: string;
  label: string;
  icon?: LucideIcon;
  onSelect: () => void;
  tone?: 'alert';
  separatorBefore?: boolean;
}

interface MenuProps {
  label: string;
  items: MenuItem[];
  trigger: (props: { popoverTarget: string; 'aria-haspopup': 'menu'; 'aria-expanded': boolean; style: CSSProperties; 'aria-controls': string }) => ReactNode;
}

/** Popover-API menu: light dismiss and Escape are native; arrows move between items. */
export function Menu({ label, items, trigger }: MenuProps) {
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const menuId = `menu-${id}`;
  const anchor = `--anchor-${id}`;
  const ref = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onToggle = (e: Event) => {
      const isOpen = (e as ToggleEvent).newState === 'open';
      setOpen(isOpen);
      if (isOpen) requestAnimationFrame(() => el.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus());
    };
    el.addEventListener('toggle', onToggle);
    return () => el.removeEventListener('toggle', onToggle);
  }, []);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const buttons = Array.from(ref.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? []);
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    let next = -1;
    if (e.key === 'ArrowDown') next = (index + 1) % buttons.length;
    else if (e.key === 'ArrowUp') next = (index - 1 + buttons.length) % buttons.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = buttons.length - 1;
    else if (e.key === 'Tab') ref.current?.hidePopover();
    if (next >= 0) {
      e.preventDefault();
      buttons[next]?.focus();
    }
  };

  return (
    <>
      {trigger({
        popoverTarget: menuId,
        'aria-haspopup': 'menu',
        'aria-expanded': open,
        'aria-controls': menuId,
        style: { anchorName: anchor } as CSSProperties,
      })}
      <div
        ref={ref}
        id={menuId}
        popover="auto"
        role="menu"
        aria-label={label}
        className="popover menu"
        style={{ positionAnchor: anchor } as CSSProperties}
        onKeyDown={onKeyDown}
      >
        {items.map((item) => (
          <div key={item.id}>
            {item.separatorBefore ? <div className="menu-sep" role="separator" /> : null}
            <button
              type="button"
              role="menuitem"
              className="menu-item"
              data-tone={item.tone}
              onClick={() => {
                ref.current?.hidePopover();
                item.onSelect();
              }}
            >
              {item.icon ? <item.icon aria-hidden="true" /> : null}
              {item.label}
            </button>
          </div>
        ))}
      </div>
    </>
  );
}
