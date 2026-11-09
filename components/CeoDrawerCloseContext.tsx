'use client';

import { createContext, useContext, useEffect } from 'react';

export type CeoDrawerCloseControl = { setVisible: (visible: boolean) => void };

export const CeoDrawerCloseContext = createContext<CeoDrawerCloseControl | null>(null);

/* 画面がvisibleの間だけ、狭い画面のAI経営コンサルタント・ドロワーに「閉じる」ボタンを出す（既定は出さない） */
export function useCeoDrawerCloseButton(visible: boolean): void {
  const setVisible = useContext(CeoDrawerCloseContext)?.setVisible;
  useEffect(() => {
    if (!setVisible) return;
    setVisible(visible);
    return () => setVisible(false);
  }, [setVisible, visible]);
}
