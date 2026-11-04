'use client';

import type { KeyboardEvent, PointerEvent } from 'react';
import { useRef } from 'react';
import {
  CEO_PANEL_WIDTH_MIN,
  clampCeoPanelWidth,
  maxCeoPanelWidth,
} from '@/lib/layout/ceoPanelWidth';

const KEY_STEP = 16;

type Props = {
  width: number;
  onChange: (width: number) => void;
  onCommit: (width: number) => void;
  onDraggingChange?: (dragging: boolean) => void;
  className?: string;
};

type DragState = { pointerId: number; startX: number; startWidth: number; last: number };

export default function CeoPanelResizeHandle({
  width,
  onChange,
  onCommit,
  onDraggingChange,
  className,
}: Props) {
  const dragRef = useRef<DragState | null>(null);

  const handlePointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = { pointerId: e.pointerId, startX: e.clientX, startWidth: width, last: width };
    onDraggingChange?.(true);
  };

  const handlePointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    const next = clampCeoPanelWidth(drag.startWidth + (drag.startX - e.clientX), window.innerWidth);
    drag.last = next;
    onChange(next);
  };

  const endDrag = (e: PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    dragRef.current = null;
    onCommit(drag.last);
    onDraggingChange?.(false);
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const delta = e.key === 'ArrowLeft' ? KEY_STEP : e.key === 'ArrowRight' ? -KEY_STEP : 0;
    if (delta === 0) return;
    e.preventDefault();
    const next = clampCeoPanelWidth(width + delta, window.innerWidth);
    onChange(next);
    onCommit(next);
  };

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="AI経営コンサルタントの幅"
      aria-valuenow={width}
      aria-valuemin={CEO_PANEL_WIDTH_MIN}
      aria-valuemax={maxCeoPanelWidth(window.innerWidth)}
      tabIndex={0}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onKeyDown={handleKeyDown}
      className={[
        'absolute inset-y-0 left-0 z-10 w-2 cursor-col-resize touch-none select-none',
        'hover:bg-zinc-300/50 focus:outline-none focus-visible:bg-zinc-300/70',
        className ?? '',
      ].join(' ')}
    />
  );
}
