import { computeFinanceEffect } from '@/lib/financeEffect';
import type { FinanceEffect } from '@/types/strategy';
import type { FinanceRole, PlanFinanceItem } from './types';

export type FinanceEstimate = {
  itemKey: string;
  /** AI_ESTIMATE_UNCONFIRMED：根拠のある入力から計算した試算（未確認）。INPUT_MISSING：入力が不足。NOT_ESTIMATED：自由項目で算定式に入らない */
  status: 'AI_ESTIMATE_UNCONFIRMED' | 'INPUT_MISSING' | 'NOT_ESTIMATED';
  amountYen: number | null;
  formula: string | null;
  missing: string[];
};

/** 算定式ごとに必要な役割。ここに無い役割は、どの算定式にも入らない（自由項目として保持される） */
const REQUIRED_ROLES: Record<Exclude<PlanFinanceItem['method'], 'FREE'>, FinanceRole[]> = {
  FUNNEL: ['MEETINGS', 'WIN_RATE', 'AVG_DEAL'],
  QUANTITY_UNIT_PRICE: ['QUANTITY', 'UNIT_PRICE'],
  DIRECT_AMOUNT: ['DIRECT_AMOUNT'],
};

const ROLE_LABEL: Record<FinanceRole, string> = {
  MEETINGS: '商談数',
  WIN_RATE: '受注率',
  AVG_DEAL: '平均受注額',
  QUANTITY: '数量',
  UNIT_PRICE: '単価',
  DIRECT_AMOUNT: '直接金額',
  YIELD_RATE: '歩留まり',
  COST_RATE: '原価率',
  CONVERSION_RATE: '転換率',
  RETENTION_RATE: '定着率',
  OTHER: 'その他',
};

/**
 * AIが出した算定入力だけを、既存の財務効果の算定式（読み取り専用）で計算する。
 * 結果は常に未確認。経路Bの financeEffect / financeEffects には書き込まない。
 * 自由項目（method が FREE）と、算定式に入らない役割は、金額を作らない。
 */
export function estimateFinanceItem(item: PlanFinanceItem): FinanceEstimate {
  if (item.method === 'FREE') {
    return { itemKey: item.key, status: 'NOT_ESTIMATED', amountYen: null, formula: null, missing: [] };
  }

  const usable = (role: FinanceRole) => {
    const input = item.inputs.find((i) => i.role === role);
    return input && input.value !== null && input.basis !== 'UNCONFIRMED' ? input.value : undefined;
  };
  const missing = REQUIRED_ROLES[item.method].filter((r) => usable(r) === undefined).map((r) => ROLE_LABEL[r]);
  if (missing.length > 0) {
    return { itemKey: item.key, status: 'INPUT_MISSING', amountYen: null, formula: null, missing };
  }

  const effect = {
    kind: item.kind,
    method: item.method,
    quantity: usable('QUANTITY'),
    unitPriceYen: usable('UNIT_PRICE'),
    meetingsPerPeriod: usable('MEETINGS'),
    winRatePct: usable('WIN_RATE'),
    averageDealYen: usable('AVG_DEAL'),
    directAmountYen: usable('DIRECT_AMOUNT'),
    amountBasis: item.amountBasis,
    startYm: item.startYm,
    endYm: item.endYm ?? undefined,
    sourceNote: item.sourceNote,
    source: 'AI_PROPOSED',
    confirmed: false,
  } as FinanceEffect;

  const r = computeFinanceEffect(effect);
  if (r.status === 'DRAFT') {
    return {
      itemKey: item.key,
      status: 'AI_ESTIMATE_UNCONFIRMED',
      amountYen: r.totalYen ?? r.annualYen ?? r.monthlyYen ?? null,
      formula: r.formula ?? null,
      missing: [],
    };
  }
  return { itemKey: item.key, status: 'INPUT_MISSING', amountYen: null, formula: null, missing: r.missing };
}
