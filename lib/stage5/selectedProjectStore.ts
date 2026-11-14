import { create } from 'zustand';

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

type State = {
  selection: SelectedProject | null;
  consult: ConsultRequest | null;
  setSelection: (s: SelectedProject | null) => void;
  requestConsult: (text: string) => void;
};

export const useSelectedProjectStore = create<State>((set, get) => ({
  selection: null,
  consult: null,
  setSelection: (s) => {
    const cur = get().selection;
    if (cur === s) return;
    if (cur && s && cur.projectId === s.projectId && cur.companyId === s.companyId && cur.strategyId === s.strategyId) {
      set({ selection: { ...cur, ...s } });
      return;
    }
    set({ selection: s });
  },
  requestConsult: (text) => set({ consult: { text, nonce: (get().consult?.nonce ?? 0) + 1 } }),
}));

/** 相談の履歴を、対象ごとに分けるための識別子（対象が無ければ空） */
export function consultKeyOf(sel: SelectedProject | null): string {
  return sel ? `${sel.companyId}|${sel.strategyId}|${sel.departmentId}|${sel.projectId}` : '';
}
