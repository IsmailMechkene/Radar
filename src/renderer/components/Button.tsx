import type { LucideIcon } from 'lucide-react';
import type { ComponentPropsWithRef, ReactNode } from 'react';
import { Icon } from './Icon';
import { cn } from './lib/cn';

export type ButtonVariant = 'primary' | 'secondary' | 'plain' | 'destructive';
export type ButtonSize = 'sm' | 'md' | 'lg';

interface ButtonProps extends ComponentPropsWithRef<'button'> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: LucideIcon;
  iconRight?: LucideIcon;
  /** Square icon-only button; pass an aria-label. */
  iconOnly?: boolean;
  children?: ReactNode;
}

const VARIANTS: Record<ButtonVariant, string> = {
  primary: 'bg-accent text-on-accent font-semibold',
  secondary: 'bg-surface hairline border-line-2 font-medium shadow-control',
  plain: 'bg-transparent text-accent-text font-medium',
  destructive: 'bg-red-fill text-on-accent font-semibold',
};

const SIZES: Record<ButtonSize, string> = {
  sm: 'h-6 rounded-xs text-footnote',
  md: 'h-7 rounded-sm text-body',
  lg: 'h-7.5 rounded-md text-body',
};

// Secondary/plain padding (solid buttons are wider, see below). lg = drawer actions, 10 px.
const PADDING: Record<ButtonSize, string> = { sm: 'px-2.5', md: 'px-3', lg: 'px-2.5' };
const SQUARE: Record<ButtonSize, string> = { sm: 'w-6', md: 'w-7', lg: 'w-7.5' };

export function Button({
  variant = 'secondary',
  size = 'md',
  icon,
  iconRight,
  iconOnly,
  className,
  children,
  type = 'button',
  ...rest
}: ButtonProps) {
  const solid = variant === 'primary' || variant === 'destructive';
  return (
    <button
      type={type}
      className={cn(
        'focus-ring app-no-drag inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap',
        'transition-[filter,transform,background-color] duration-(--duration-base) ease-out',
        'enabled:hover:brightness-96 enabled:active:scale-98 disabled:opacity-40',
        VARIANTS[variant],
        SIZES[size],
        iconOnly ? cn(SQUARE[size], 'px-0') : solid && size !== 'sm' ? 'px-3.5' : PADDING[size],
        className,
      )}
      {...rest}
    >
      {icon && <Icon icon={icon} size={size === 'sm' ? 12 : 14} />}
      {children}
      {iconRight && <Icon icon={iconRight} size={size === 'sm' ? 12 : 14} />}
    </button>
  );
}
