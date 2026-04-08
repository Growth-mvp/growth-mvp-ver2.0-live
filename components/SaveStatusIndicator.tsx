'use client';

import { useSaveStatus } from '@/hooks/useSaveStatus';

/**
 * SaveStatusIndicator (Apple Minimal Save Status)
 *
 * ⚠️ DEPRECATED: Currently removed from all stage pages
 *
 * Maintained for backward compatibility and potential future header-level display.
 * Save status is now primarily displayed in GlobalSidebarSaveStatus.
 *
 * Reuses judgment logic from useSaveStatus hook (no code duplication)
 */
export default function SaveStatusIndicator() {
  const { status, message } = useSaveStatus();

  const statusColors = {
    error: 'text-red-600',
    saving: 'text-zinc-500 opacity-90',
    dirty: 'text-zinc-500 opacity-70',
    saved: 'text-zinc-500 opacity-70',
  };

  return (
    <span className={`text-sm font-medium whitespace-nowrap tracking-wide ${statusColors[status]}`}>
      {message}
    </span>
  );
}
