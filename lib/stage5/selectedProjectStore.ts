import { create } from 'zustand';
import { isSameDraftTarget, type DraftTarget } from '@/lib/stage5/consultDraft';

/* 中央の実行支援パネルで選択中の案件。右側のAI経営コンサルタントが、相談の対象として読む。
 * 会社・戦略を切り替えたら、古い対象を残さないように空にする（呼び出し側が行う）。 */

export type SelectedProject = {
  companyId: string;
  strategyId: string;
  departmentId: string;
  projectId: string;
  projectTitle: string;
  departmentName: string;
};

export type ConsultRequest = { text: string; nonce: number };

/** 相談から作られ、利用者が反映を選んだ入力案。反映先の案件が変わると破棄する */
export type DraftCandidate = { target: DraftTarget; text: string; nonce: number };

type State = {
  selection: SelectedProject | null;
  consult: ConsultRequest | null;
  draft: DraftCandidate | null;
  setSelection: (s: SelectedProject | null) => void;
  requestConsult: (text: string) => void;
  setDraft: (target: DraftTarget, text: string) => void;
  clearDraft: () => void;
};

export const useSelectedProjectStore = create<State>((set, get) => ({
  selection: null,
  consult: null,
  draft: null,
  setSelection: (s) => {
    const cur = get().selection;
    if (cur === s) return;
    const draft = get().draft;
    const keptDraft = draft && isSameDraftTarget(draft.target, s) ? draft : null;
    if (cur && s && cur.projectId === s.projectId && cur.companyId === s.companyId && cur.strategyId === s.strategyId) {
      set({ selection: { ...cur, ...s }, draft: keptDraft });
      return;
    }
    set({ selection: s, draft: keptDraft });
  },
  requestConsult: (text) => set({ consult: { text, nonce: (get().consult?.nonce ?? 0) + 1 } }),
  setDraft: (target, text) => set({ draft: { target, text, nonce: (get().draft?.nonce ?? 0) + 1 } }),
  clearDraft: () => set({ draft: null }),
}));

/** 相談の履歴を、対象ごとに分けるための識別子（対象が無ければ空） */
export function consultKeyOf(sel: SelectedProject | null): string {
  return sel ? `${sel.companyId}|${sel.strategyId}|${sel.departmentId}|${sel.projectId}` : '';
}
