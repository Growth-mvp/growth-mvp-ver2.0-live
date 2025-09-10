// components/ui/button.tsx
'use client';

import { ButtonHTMLAttributes } from 'react';
import clsx from 'clsx';

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary';
  /** 高さやフォントサイズを揃えるためのサイズ。既定: md */
  size?: 'sm' | 'md' | 'lg';
  /** 幅いっぱいにしたい場合 */
  fullWidth?: boolean;
};

export const Button = ({
  variant = 'primary',
  size = 'md',
  fullWidth = false,
  className,
  type = 'button',
  ...props
}: ButtonProps) => {
  const sizeCls =
    size === 'sm'
      ? 'h-8 px-3 text-[13px]'
      : size === 'lg'
      ? 'h-11 px-5 text-[15px]'
      : 'h-9 px-4 text-[14px]'; // md

  return (
    <button
      {...props}
      type={type}
      className={clsx(
        // レイアウト（アイコン+テキストがはみ出さない）
        'inline-flex items-center justify-center gap-2 whitespace-nowrap',
        fullWidth && 'w-full',

        // 形状・アニメーション（Apple風）
        'rounded-xl font-medium shadow-sm transition-colors duration-150',
        'focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-gray-400',
        'disabled:opacity-60 disabled:cursor-not-allowed',

        // サイズ
        sizeCls,

        // バリアント
        variant === 'primary'
          ? 'bg-gray-100 text-gray-900 hover:bg-gray-200 active:bg-gray-300'
          : 'bg-white text-gray-900 border border-gray-300 hover:bg-gray-50',

        className
      )}
    />
  );
};
