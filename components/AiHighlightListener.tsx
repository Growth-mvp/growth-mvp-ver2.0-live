'use client';

import { useEffect } from 'react';
import { useAiHighlightStore } from '@/store/aiHighlightStore';

const FRESH_MS = 8000;
const HIGHLIGHT_MS = 2500;
const SEARCH_INTERVAL_MS = 100;
const SEARCH_TRIES = 40;

/** AIが反映した入力欄へスクロールし、一時的に青い枠で示す。値には触れない */
export default function AiHighlightListener() {
  const target = useAiHighlightStore((s) => s.target);
  const at = useAiHighlightStore((s) => s.at);

  useEffect(() => {
    if (!target || Date.now() - at > FRESH_MS) return;
    let tries = 0;
    let restore: (() => void) | null = null;
    const search = window.setInterval(() => {
      tries += 1;
      const found = document.querySelector<HTMLElement>(`[data-ai-target="${target}"]`);
      if (!found && tries < SEARCH_TRIES) return;
      window.clearInterval(search);
      if (!found) return;
      const prevOutline = found.style.outline;
      const prevOffset = found.style.outlineOffset;
      found.style.outline = '2px solid #2563eb';
      found.style.outlineOffset = '2px';
      found.scrollIntoView({ behavior: 'smooth', block: 'center' });
      const timer = window.setTimeout(() => restore?.(), HIGHLIGHT_MS);
      restore = () => {
        window.clearTimeout(timer);
        found.style.outline = prevOutline;
        found.style.outlineOffset = prevOffset;
      };
    }, SEARCH_INTERVAL_MS);
    return () => {
      window.clearInterval(search);
      restore?.();
    };
  }, [target, at]);

  return null;
}
