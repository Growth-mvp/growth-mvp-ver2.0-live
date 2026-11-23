// components/ui/page-shell.tsx
import { HTMLAttributes } from 'react';
import clsx from 'clsx';

type PageShellProps = HTMLAttributes<HTMLDivElement> & {
  /** document: 入力・文書系 / dashboard: ダッシュボード・グラフ系 */
  width?: 'document' | 'dashboard';
};

export function PageShell({ width = 'document', className, ...props }: PageShellProps) {
  return (
    <div
      {...props}
      className={clsx(
        'mx-auto w-full px-6 py-8',
        width === 'dashboard' ? 'max-w-6xl' : 'max-w-5xl',
        className
      )}
    />
  );
}
