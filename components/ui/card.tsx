// components/ui/card.tsx
import { HTMLAttributes } from 'react';
import clsx from 'clsx';

type CardProps = HTMLAttributes<HTMLDivElement> & {
  /** 浮いて見せたい場合のみ影を付ける（既定は影なし） */
  elevated?: boolean;
};

// 呼び出し側が枠線・内側余白を指定した場合は、既定値を重ねない（Tailwindの生成順で既定が勝つのを防ぐ）
const SPECIFIES_BORDER = /(^|\s)border(\s|-|$)/;
const SPECIFIES_PADDING = /(^|\s)p[xytrbl]?-/;

export function Card({ className, elevated = false, ...props }: CardProps) {
  const specifiesBorder = SPECIFIES_BORDER.test(className ?? '');
  const specifiesPadding = SPECIFIES_PADDING.test(className ?? '');
  return (
    <div
      {...props}
      className={clsx(
        'rounded-2xl bg-white',
        !specifiesBorder && 'border border-zinc-200',
        !specifiesPadding && 'p-5',
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
