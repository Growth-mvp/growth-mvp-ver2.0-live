'use client';

import { useCeoDrawerCloseButton } from '@/components/CeoDrawerCloseContext';

import Stage3ReadPanel from './Stage3ReadPanel';

export default function Stage4DocumentScreen() {
  useCeoDrawerCloseButton(true);
  return <Stage3ReadPanel />;
}
