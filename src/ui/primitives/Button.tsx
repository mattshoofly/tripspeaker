import { ArrowRight, type LucideIcon } from 'lucide-react';
import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';

type Variant = 'primary' | 'secondary' | 'quiet' | 'alert' | 'alert-fill';
type Size = 'sm' | 'md' | 'lg';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  icon?: LucideIcon;
  arrow?: boolean;
  block?: boolean;
  active?: boolean;
  children: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', icon: Icon, arrow, block, active, className, children, type = 'button', ...rest },
  ref,
) {
  const classes = ['btn', `btn--${variant}`, size !== 'md' && `btn--${size}`, block && 'btn--block', className].filter(Boolean).join(' ');
  return (
    <button ref={ref} type={type} className={classes} data-active={active ? 'true' : undefined} {...rest}>
      {Icon ? <Icon aria-hidden="true" /> : null}
      <span>{children}</span>
      {arrow ? <ArrowRight className="btn-arrow" aria-hidden="true" /> : null}
    </button>
  );
});

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
  icon: LucideIcon;
  bare?: boolean;
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, icon: Icon, bare, className, type = 'button', ...rest },
  ref,
) {
  return (
    <button ref={ref} type={type} aria-label={label} title={label} className={['icon-btn', bare && 'icon-btn--bare', className].filter(Boolean).join(' ')} {...rest}>
      <Icon aria-hidden="true" />
    </button>
  );
});
