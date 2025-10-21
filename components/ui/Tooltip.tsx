'use client';
import { useState, useRef, useEffect } from 'react';

type Props = {
  text: string;
  children: React.ReactNode; // トリガー（? アイコン等）
  side?: 'top' | 'bottom' | 'left' | 'right';
};

export default function Tooltip({ text, children, side = 'top' }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (!ref.current) return;
      if (!ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('click', onDoc);
    return () => document.removeEventListener('click', onDoc);
  }, []);

  const pos = {
    top: 'bottom-full left-1/2 -translate-x-1/2 mb-2',
    bottom: 'top-full left-1/2 -translate-x-1/2 mt-2',
    left: 'right-full top-1/2 -translate-y-1/2 mr-2',
    right: 'left-full top-1/2 -translate-y-1/2 ml-2',
  }[side];

  return (
    <div
      ref={ref}
      className="relative inline-flex items-center"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onClick={() => setOpen((v) => !v)}
    >
      {children}
      {open && (
        <div
          role="tooltip"
          className={`pointer-events-none absolute z-[60] max-w-[260px] rounded-xl border border-zinc-200 bg-white px-3 py-2 text-[12px] text-zinc-800 shadow ${pos}`}
        >
          {text}
        </div>
      )}
    </div>
  );
}
