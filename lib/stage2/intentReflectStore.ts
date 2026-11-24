import { create } from 'zustand';

/* AI経営コンサルタントの相談から作った「経営者の思い」を、STAGE2の入力欄へ渡すための一時的な状態。
 * 保存はしない。会社・戦略が違う画面では反映せず、破棄する。 */

export type IntentTarget = { companyId: string; strategyId: string };

export type IntentDraft = { target: IntentTarget; text: string; nonce: number };

type State = {
  pending: IntentDraft | null;
  setPending: (target: IntentTarget, text: string) => void;
  clearPending: () => void;
};

export const useIntentReflectStore = create<State>((set, get) => ({
  pending: null,
  setPending: (target, text) => set({ pending: { target, text, nonce: (get().pending?.nonce ?? 0) + 1 } }),
  clearPending: () => set({ pending: null }),
}));
