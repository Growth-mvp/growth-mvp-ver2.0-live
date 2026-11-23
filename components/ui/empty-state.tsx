// components/ui/empty-state.tsx
import { HTMLAttributes, ReactNode } from 'react';
import clsx from 'clsx';

type EmptyStateProps = HTMLAttributes<HTMLDivElement> & {
  title?: ReactNode;
  description?: ReactNode;
  /** 必要な場合のみ操作ボタンを渡す */
  action?: ReactNode;
};

export function EmptyState({ title, description, action, className, ...props }: EmptyStateProps) {
  return (
    <div
      {...props}
      className={clsx(
        'flex flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-zinc-300 bg-zinc-50 px-6 py-8 text-center',
        className
      )}
    >
      {title ? <p className="text-[15px] font-medium text-zinc-800">{title}</p> : null}
      {description ? <p className="text-[13px] leading-5 text-zinc-600">{description}</p> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}
