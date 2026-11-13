'use client';

import { useState, type ReactNode } from 'react';
import { useSearchParams } from 'next/navigation';

import { useCeoDrawerCloseButton } from '@/components/CeoDrawerCloseContext';

import Stage3ReadPanel, { type Stage3Handoff } from './Stage3ReadPanel';
import { StartModeContext } from './startMode';

export default function Stage4DocumentScreen({ top }: { top?: ReactNode } = {}) {
  useCeoDrawerCloseButton(true);
  const params = useSearchParams();
  const handoff: Stage3Handoff | undefined =
    params?.get('from') === 'stage3'
      ? { departmentName: params.get('dept')?.trim() || null, projectId: params.get('projectId')?.trim() || null }
      : undefined;
  const [startMode, setStartMode] = useState(false);
  return (
    <StartModeContext.Provider value={setStartMode}>
      {!startMode && top}
      <Stage3ReadPanel handoff={handoff} />
    </StartModeContext.Provider>
  );
}
