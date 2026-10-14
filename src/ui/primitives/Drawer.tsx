import { X } from 'lucide-react';
import { useId, useLayoutEffect, useRef, type ReactNode } from 'react';
import { gsap, useGSAP } from '../motion/gsap';
import { useReducedMotion } from '../motion/useReducedMotion';
import { IconButton } from './Button';

interface DialogShellProps {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  className: string;
  labelledBy: string;
  describedBy?: string;
  variant: 'drawer' | 'modal';
  testId?: string;
}

/**
 * Native modal <dialog>: the browser handles inert background and the
 * top layer; we add Escape/backdrop dismissal, focus return, and motion.
 */
function DialogShell({ open, onClose, children, className, labelledBy, describedBy, variant, testId }: DialogShellProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const returnTo = useRef<HTMLElement | null>(null);
  const reduced = useReducedMotion();
  const { contextSafe } = useGSAP({ scope: dialogRef });

  const animateIn = contextSafe(() => {
    const panel = panelRef.current;
    if (!panel) return;
    gsap.killTweensOf(panel);
    if (reduced) {
      gsap.fromTo(panel, { opacity: 0 }, { opacity: 1, duration: 0.14, ease: 'power2.out', clearProps: 'opacity' });
      return;
    }
    const sheet = variant === 'drawer' && window.matchMedia('(max-width: 640px)').matches;
    const from = variant === 'modal' ? { opacity: 0, scale: 0.975, y: 6 } : sheet ? { opacity: 0, y: 28 } : { opacity: 0, x: 28 };
    gsap.fromTo(panel, from, { opacity: 1, x: 0, y: 0, scale: 1, duration: 0.26, ease: 'power3.out', clearProps: 'transform,opacity' });
  });

  const animateOut = contextSafe(() => {
    const dialog = dialogRef.current;
    const panel = panelRef.current;
    if (!dialog || !panel) return;
    dialog.classList.add('is-closing');
    gsap.killTweensOf(panel);
    const sheet = variant === 'drawer' && window.matchMedia('(max-width: 640px)').matches;
    const to = reduced ? { opacity: 0 } : variant === 'modal' ? { opacity: 0, scale: 0.98 } : sheet ? { opacity: 0, y: 24 } : { opacity: 0, x: 24 };
    gsap.to(panel, {
      ...to,
      duration: reduced ? 0.12 : 0.18,
      ease: 'power2.out',
      onComplete: () => {
        dialog.classList.remove('is-closing');
        if (dialog.open) dialog.close();
        gsap.set(panel, { clearProps: 'transform,opacity' });
        const target = returnTo.current;
        if (target && target.isConnected) target.focus({ preventScroll: true });
      },
    });
  });

  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open) {
      if (!dialog.open) {
        returnTo.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        dialog.showModal();
      }
      dialog.classList.remove('is-closing');
      animateIn();
    } else if (dialog.open) {
      animateOut();
    }
  }, [open, animateIn, animateOut]);

  useLayoutEffect(
    () => () => {
      const dialog = dialogRef.current;
      if (dialog?.open) dialog.close();
    },
    [],
  );

  return (
    <dialog
      ref={dialogRef}
      className={className}
      aria-labelledby={labelledBy}
      aria-describedby={describedBy}
      data-testid={testId}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onKeyDown={(e) => {
        // Keep Tab cycling inside the dialog instead of escaping to browser chrome.
        if (e.key !== 'Tab' || !dialogRef.current) return;
        const focusable = Array.from(
          dialogRef.current.querySelectorAll<HTMLElement>('button, [href], input, textarea, select, summary, [tabindex]:not([tabindex="-1"])'),
        ).filter((el) => !el.hasAttribute('disabled') && el.getClientRects().length > 0 && !el.closest('[popover]:not(:popover-open)'));
        if (!focusable.length) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }}
      onClick={(e) => {
        if (e.target === dialogRef.current) onClose();
      }}
    >
      <div ref={panelRef} className={variant === 'drawer' ? 'drawer-inner' : undefined}>
        {children}
      </div>
    </dialog>
  );
}

export interface DrawerProps {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: ReactNode;
  children: ReactNode;
  testId?: string;
}

export function Drawer({ open, onClose, title, subtitle, children, testId }: DrawerProps) {
  const titleId = useId();
  const subId = useId();
  return (
    <DialogShell open={open} onClose={onClose} className="drawer" labelledBy={titleId} describedBy={subtitle ? subId : undefined} variant="drawer" testId={testId}>
      <header className="drawer-head">
        <div>
          <h2 id={titleId} className="drawer-title">
            {title}
          </h2>
          {subtitle ? (
            <p id={subId} className="drawer-sub">
              {subtitle}
            </p>
          ) : null}
        </div>
        <IconButton label="Close" icon={X} onClick={onClose} />
      </header>
      <div className="drawer-body">{children}</div>
    </DialogShell>
  );
}

export interface ConfirmDialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  body: ReactNode;
  children: ReactNode;
  testId?: string;
}

export function ConfirmDialog({ open, onClose, title, body, children, testId }: ConfirmDialogProps) {
  const titleId = useId();
  const bodyId = useId();
  return (
    <DialogShell open={open} onClose={onClose} className="modal" labelledBy={titleId} describedBy={bodyId} variant="modal" testId={testId}>
      <h2 id={titleId} className="modal-title">
        {title}
      </h2>
      <div id={bodyId} className="modal-body">
        {body}
      </div>
      <div className="modal-actions">{children}</div>
    </DialogShell>
  );
}
