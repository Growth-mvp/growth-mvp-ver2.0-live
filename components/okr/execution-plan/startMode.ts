import { createContext, useContext } from 'react';

/* 実行開始の表示かどうかを、親の画面（反映候補・OKRの見出し）に伝える。開始の表示の間は、親の見出しを出さない */
export const StartModeContext = createContext<((on: boolean) => void) | null>(null);

export function useSetStartMode(): ((on: boolean) => void) | null {
  return useContext(StartModeContext);
}
