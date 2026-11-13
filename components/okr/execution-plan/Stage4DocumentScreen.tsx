'use client';

import { useSearchParams } from 'next/navigation';

import { useCeoDrawerCloseButton } from '@/components/CeoDrawerCloseContext';

import Stage3ReadPanel, { type Stage3Handoff } from './Stage3ReadPanel';

export default function Stage4DocumentScreen() {
  useCeoDrawerCloseButton(true);
  const params = useSearchParams();
  const handoff: Stage3Handoff | undefined =
    params?.get('from') === 'stage3'
      ? { departmentName: params.get('dept')?.trim() || null, projectId: params.get('projectId')?.trim() || null }
      : undefined;
  return <Stage3ReadPanel handoff={handoff} />;
}
