// components/ui/button.tsx
'use client';

import { ButtonHTMLAttributes } from 'react';
import clsx from 'clsx';

type ButtonVariant = 'primary' | 'secondary' | 'outline' | 'ghost' | 'destructive';
type ButtonSize = 'sm' | 'md' | 'lg';

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  /** 見た目のバリアント */
  variant?: ButtonVariant;
  /** 高さやフォントサイズを揃えるためのサイズ。既定: md */
  size?: ButtonSize;
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

  // 既存のトーンをベースに、outline/ghost/destructive を追加
  const variantCls: Record<ButtonVariant, string> = {
    primary: 'bg-gray-100 text-gray-900 hover:bg-gray-200 active:bg-gray-300',
    secondary: 'bg-white text-gray-900 border border-gray-300 hover:bg-gray-50',
    outline: 'bg-white text-gray-900 border border-gray-300', // hoverは親からclassNameで上書き可能
    ghost: 'bg-transparent text-gray-800 hover:bg-gray-50 shadow-none border-0',
    destructive: 'bg-red-600 text-white hover:bg-red-700',
  };

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
        variantCls[variant],

        className
      )}
    />
  );
};
