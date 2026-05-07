"use client";

import React, { useEffect, useRef } from "react";

type AutoResizeTextareaProps =
  React.TextareaHTMLAttributes<HTMLTextAreaElement> & {
    minRows?: number;
    maxRows?: number;
  };

export function AutoResizeTextarea({
  minRows = 3,
  maxRows = 12,
  className = "",
  value,
  onChange,
  ...props
}: AutoResizeTextareaProps) {
  const ref = useRef<HTMLTextAreaElement | null>(null);
  const resize = () => {
    const el = ref.current;
    if (!el) return;

    el.style.height = "auto";

    const computed = window.getComputedStyle(el);
    const lineHeight = parseFloat(computed.lineHeight || "24") || 24;

    const minHeight = minRows * lineHeight;
    const maxHeight = maxRows * lineHeight;

    const nextHeight = Math.min(
      Math.max(el.scrollHeight, minHeight),
      maxHeight
    );

    el.style.height = `${nextHeight}px`;
    el.style.overflowY = el.scrollHeight > maxHeight ? "auto" : "hidden";
  };

  useEffect(() => {
    resize();
  }, [value, minRows, maxRows]);

  return (
    <textarea
      ref={ref}
      value={value}
      onChange={(e) => {
        onChange?.(e);
        requestAnimationFrame(resize);
      }}
      rows={minRows}
      className={[
        "w-full resize-none rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm leading-6 text-slate-900",
        "placeholder:text-slate-400",
        "focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-100",
        "disabled:bg-slate-50 disabled:text-slate-400",
        className,
      ].join(" ")}
      {...props}
    />
  );
}

export default AutoResizeTextarea;
