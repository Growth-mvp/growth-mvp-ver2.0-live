// components/ui/button.tsx
'use client';

import { ButtonHTMLAttributes } from 'react';
import clsx from 'clsx';

type ButtonVariant = 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger' | 'destructive';
type ButtonSize = 'sm' | 'md' | 'lg';

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  /** 見た目のバリアント。primary=主要操作 / secondary=補助 / ghost=軽微 / danger=削除・破棄 */
  variant?: ButtonVariant;
  /** 高さやフォントサイズを揃えるためのサイズ。既定: md（高さ40px） */
  size?: ButtonSize;
  /** 幅いっぱいにしたい場合 */
  fullWidth?: boolean;
  /** 処理中。操作を止め、disabled（無効）とは別の見た目にする */
  loading?: boolean;
};

export const Button = ({
  variant = 'primary',
  size = 'md',
  fullWidth = false,
  loading = false,
  className,
  type = 'button',
  disabled,
  ...props
}: ButtonProps) => {
  const sizeCls =
    size === 'sm'
      ? 'h-8 px-3 text-[13px]'
      : size === 'lg'
      ? 'h-12 px-5 text-[16px]'
      : 'h-10 px-4 text-[15px]'; // md

  const variantCls: Record<ButtonVariant, string> = {
    primary: 'bg-accent-action text-white hover:bg-accent-hover active:bg-accent-ink',
    secondary: 'bg-zinc-100 text-zinc-900 hover:bg-zinc-200 active:bg-zinc-300',
    outline: 'bg-white text-zinc-900 border border-zinc-300 hover:bg-zinc-50 active:bg-zinc-100',
    ghost: 'bg-transparent text-zinc-800 hover:bg-zinc-100 active:bg-zinc-200 border-0',
    danger: 'bg-danger text-white hover:opacity-90 active:opacity-80',
    destructive: 'bg-danger text-white hover:opacity-90 active:opacity-80',
  };

  return (
    <button
      {...props}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={clsx(
        // レイアウト（アイコン+テキストがはみ出さない）
        'inline-flex items-center justify-center gap-2 whitespace-nowrap',
        fullWidth && 'w-full',

        // 形状・アニメーション（影なし、役割に応じた角丸）
        'rounded-xl font-medium transition-colors duration-150',
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 focus-visible:ring-offset-2',
        'disabled:cursor-not-allowed disabled:opacity-50',
        loading && 'cursor-progress opacity-80',

        // サイズ
        sizeCls,

        // バリアント
        variantCls[variant],

        className
      )}
    />
  );
};
