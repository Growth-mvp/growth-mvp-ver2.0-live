import { create } from 'zustand';

/** チャットからの生成・確定の依頼。画面（STAGE2）の既存の処理が、準備の完了後に一度だけ実行する */
export type Stage2CommandKind = 'draft' | 'final' | 'commit';

export type Stage2Command = {
  id: string;
  kind: Stage2CommandKind;
  companyId: string;
  strategyId: string;
  userId: string;
  expiresAt: number;
};

export type Stage2Report = { id: string; kind: Stage2CommandKind; ok: boolean; message: string; at: number };

/** 依頼の有効期限（これを過ぎた依頼は実行しない） */
const TTL_MS = 60_000;

type Stage2CommandState = {
  pending: Stage2Command | null;
  lastReport: Stage2Report | null;
  /** 依頼を置く。同時に持てる依頼は1件（新しい依頼は前の依頼に置き換える） */
  request: (cmd: Omit<Stage2Command, 'id' | 'expiresAt'>) => string;
  /** 依頼を受け取る（受け取った依頼は、以後は待ち行列に残らない） */
  take: () => Stage2Command | null;
  report: (r: Omit<Stage2Report, 'at'>) => void;
  clear: () => void;
};

export const useStage2CommandStore = create<Stage2CommandState>((set, get) => ({
  pending: null,
  lastReport: null,
  request: (cmd) => {
    const id =
      typeof crypto !== 'undefined' && crypto.randomUUID
        ? crypto.randomUUID()
        : `cmd_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    set({ pending: { ...cmd, id, expiresAt: Date.now() + TTL_MS } });
    return id;
  },
  take: () => {
    const cmd = get().pending;
    set({ pending: null });
    return cmd;
  },
  report: (r) => set({ lastReport: { ...r, at: Date.now() } }),
  clear: () => set({ pending: null }),
}));
