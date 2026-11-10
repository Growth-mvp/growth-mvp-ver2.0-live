/* KPIの表示名。STAGE3の登録KPIと、AIが提案した追加KPIを、正式な承認の記録の有無で区別する。 */
export const KPI_STATE_LABEL = {
  /** STAGE3で利用者が確定した目標（確定の記録あり） */
  confirmed: 'STAGE3で確定',
  /** STAGE3に登録されているが、確定の記録がない */
  unconfirmed: 'STAGE3に登録（確定の記録なし）',
  /** STAGE3の値ではない、AIが仮に置いた目標 */
  provisional: 'AIの仮置き（STAGE3の登録値ではない）',
  /** AIが提案した追加KPI（STAGE3には無い） */
  proposed: 'AI提案（追加KPI）',
} as const;
