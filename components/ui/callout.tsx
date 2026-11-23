// components/ui/callout.tsx
import { HTMLAttributes, ReactNode } from 'react';
import clsx from 'clsx';

export type CalloutTone = 'info' | 'success' | 'caution' | 'danger' | 'neutral';

type CalloutProps = HTMLAttributes<HTMLDivElement> & {
  tone?: CalloutTone;
  /** 色だけに頼らず、意味を文字で示す見出し */
  title?: ReactNode;
};

const toneCls: Record<CalloutTone, string> = {
  info: 'border-accent/20 bg-accent-soft text-accent-ink',
  success: 'border-success/20 bg-success-soft text-success',
  caution: 'border-caution/20 bg-caution-soft text-caution',
  danger: 'border-danger/20 bg-danger-soft text-danger',
  neutral: 'border-zinc-200 bg-zinc-50 text-zinc-800',
};

export function Callout({ tone = 'neutral', title, children, className, ...props }: CalloutProps) {
  return (
    <div
      {...props}
      className={clsx('rounded-2xl border px-4 py-3 text-[15px] leading-6', toneCls[tone], className)}
    >
      {title ? <p className="mb-1 font-medium">{title}</p> : null}
      {children}
    </div>
  );
}
