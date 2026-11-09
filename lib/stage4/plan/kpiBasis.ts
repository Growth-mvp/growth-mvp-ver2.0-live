/* 既存のKPIの状態を、目標値の根拠（targetBasis）から判定する。
 * USER_CONFIRMED：利用者が確定した目標。AIは変更できない。
 * AI_PROVISIONAL：AIが仮に置いた目標。確定ではなく、AIが書き直せる。
 * UNKNOWN：根拠の印がない。STAGE3で入力された値の可能性があるため、AIは変更できないが、確定とは表示しない。 */

export type KpiBasis = 'USER_CONFIRMED' | 'AI_PROVISIONAL' | 'UNKNOWN';

export function kpiBasisOf(raw: { targetBasis?: unknown }): KpiBasis {
  if (raw.targetBasis === 'USER_CONFIRMED') return 'USER_CONFIRMED';
  if (raw.targetBasis === 'AI_PROVISIONAL') return 'AI_PROVISIONAL';
  return 'UNKNOWN';
}

/** AIが変更できない（確定 or 状態不明の入力値）KPIと、AIが仮に置いたKPIに分ける。basis が無い場合は状態不明として扱う */
export function splitKpisByBasis<T extends { basis?: KpiBasis }>(kpis: T[]): { locked: T[]; aiProvisional: T[] } {
  return {
    locked: kpis.filter((k) => k.basis !== 'AI_PROVISIONAL'),
    aiProvisional: kpis.filter((k) => k.basis === 'AI_PROVISIONAL'),
  };
}
