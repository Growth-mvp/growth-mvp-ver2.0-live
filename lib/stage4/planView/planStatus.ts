/* 実行計画書の今の状態と、次に行う操作を、利用者向けの文言で示す。保存や採用の判定は行わない（表示の分類だけ）。 */

export type PlanStatusInput = {
  hasDraft: boolean;
  dirty: boolean;
  adopted: boolean;
  started: boolean;
};

export type PlanStatusView = { title: string; detail: string; next: string };

export function planStatusOf(s: PlanStatusInput): PlanStatusView {
  if (!s.hasDraft) {
    return {
      title: 'まだ計画書がありません',
      detail: 'STAGE3の内容から、AIが実行計画書の草案を作ります。',
      next: '「AIで実行計画書を作る」を押してください。',
    };
  }
  if (s.dirty) {
    return {
      title: '未保存の修正があります',
      detail: 'まだ保存されていません。画面を離れると失われます。',
      next: '「草案として保存」を押してください。',
    };
  }
  if (s.started) {
    return {
      title: '実行開始済み',
      detail: 'この計画は実行に入り、STAGE5で進捗を管理します。',
      next: 'STAGE5で進捗を確認してください。',
    };
  }
  if (s.adopted) {
    return {
      title: '採用済み（実行は未開始）',
      detail: '利用者が内容を承認し、この方針で実行すると決めています。',
      next: '「実行開始の確認へ進む」から、責任者と必要な確認事項を確かめて開始してください。',
    };
  }
  return {
    title: '草案（未採用）',
    detail: '保存された草案です。採用や実行開始はまだ行われていません。',
    next: '内容を確認し、必要なら「AIでもう一度作る」か「計画書を修正する」を使ってください。問題なければ「この計画書を採用」を押してください。',
  };
}

/* 三つの操作の意味（画面に常に出す短い説明） */
export const PLAN_OPERATION_GUIDE: ReadonlyArray<{ name: string; meaning: string }> = [
  { name: '草案として保存', meaning: '計画書を保存します。保存しただけでは、採用や実行開始にはなりません。' },
  { name: 'この計画書を採用', meaning: '利用者が計画内容を承認し、この方針で実行すると決めます。' },
  { name: '実行開始', meaning: '責任者と必要な確認事項を確かめ、STAGE5の進捗管理に進みます。' },
];
