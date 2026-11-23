// components/ui/badge.tsx
import { HTMLAttributes } from 'react';
import clsx from 'clsx';

interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: 'default' | 'success' | 'warning' | 'danger';
}

export function Badge({ className, variant = 'default', ...props }: BadgeProps) {
  const baseStyle = 'inline-block rounded-full px-2.5 py-0.5 text-[12px] font-medium';
  const variantStyle = {
    default: 'bg-zinc-100 text-zinc-800',
    success: 'bg-success-soft text-success',
    warning: 'bg-caution-soft text-caution',
    danger: 'bg-danger-soft text-danger',
  };

  return (
    <span
      {...props}
      className={clsx(baseStyle, variantStyle[variant], className)}
    />
  );
}
