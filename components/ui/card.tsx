// components/ui/card.tsx
import { HTMLAttributes } from 'react';
import clsx from 'clsx';

type CardProps = HTMLAttributes<HTMLDivElement> & {
  /** 浮いて見せたい場合のみ影を付ける（既定は影なし） */
  elevated?: boolean;
};

export function Card({ className, elevated = false, ...props }: CardProps) {
  return (
    <div
      {...props}
      className={clsx(
        'rounded-2xl border border-zinc-200 bg-white p-5',
        elevated && 'shadow-card',
        className
      )}
    />
  );
}

export function CardHeader({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      {...props}
      className={clsx('mb-2 text-[17px] font-medium text-zinc-900', className)}
    />
  );
}

export function CardContent({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      {...props}
      className={clsx('text-[15px] text-zinc-800', className)}
    />
  );
}
