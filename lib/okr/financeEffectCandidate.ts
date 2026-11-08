/* AI算定前提（impactAssumptions）から、財務効果の未確認候補を作る。候補は利用者が確認するまで試算に入らない。 */
import type { FinanceEffect } from '@/types/strategy';
import { getImpactResultFromAssumptions, toFiniteNumber, type ImpactAssumptions } from './impactAssumptions';
import type { ImpactRoleKey } from './impactAssumptions';

export type AssumptionOrigin = 'AI_PROPOSED' | 'PRESET' | 'USER_INPUT';

export const ORIGIN_LABEL: Record<AssumptionOrigin, string> = {
  AI_PROPOSED: 'AIが提案（未確認）',
  PRESET: '固定プリセット（利用者が選択）',
  USER_INPUT: '利用者が入力・修正',
};

export const UNVERIFIED_ORIGIN_LABEL = '根拠が確認できない既存値（出所不明）';

const MILLION = 1_000_000;

export type CandidateResult =
  | { ok: true; effect: FinanceEffect; formula: string }
  | { ok: false; reason: string };

export function buildFinanceEffectCandidate(args: {
  role: ImpactRoleKey | undefined;
  assumptions: ImpactAssumptions | undefined;
  rationale?: string;
  origin: AssumptionOrigin | undefined;
}): CandidateResult {
  if (args.role === 'FUTURE') {
    return { ok: false, reason: '必要な投資は投資計画（既存の投資の計算）で扱うため、財務効果の候補は作りません' };
  }
  const calc = getImpactResultFromAssumptions(args.role, args.assumptions);
  if (!calc) return { ok: false, reason: '算定前提がないため、候補を作れません' };

  const a = args.assumptions ?? {};
  const source = args.origin === 'AI_PROPOSED' ? 'AI_PROPOSED' : 'USER_INPUT';
  const originText = args.origin ? ORIGIN_LABEL[args.origin] : UNVERIFIED_ORIGIN_LABEL;
  const sourceNote = [
    args.rationale?.trim() || '根拠文は未入力',
    `算定式：${calc.formula}`,
    `前提の出所：${originText}`,
  ].join('\n');

  if (args.role === 'REVENUE') {
    const targetCustomers = toFiniteNumber(a.targetCustomers);
    const conversionRatePct = toFiniteNumber(a.conversionRatePct);
    const averageDealMJPY = toFiniteNumber(a.averageDealMJPY);
    if (targetCustomers === undefined || conversionRatePct === undefined || averageDealMJPY === undefined) {
      return { ok: false, reason: '売上の算定前提（対象顧客数・受注率・平均単価）が揃っていません' };
    }
    return {
      ok: true,
      formula: calc.formula,
      effect: {
        kind: 'REVENUE_UP',
        method: 'FUNNEL',
        meetingsPerPeriod: targetCustomers,
        winRatePct: conversionRatePct,
        averageDealYen: Math.round(averageDealMJPY * MILLION),
        source,
        confirmed: false,
        sourceNote,
      },
    };
  }

  // COST（費用削減）：既存の算定の結果（現在コスト × 削減率）を、直接金額として保持する
  return {
    ok: true,
    formula: calc.formula,
    effect: {
      kind: 'COST_REDUCTION',
      method: 'DIRECT_AMOUNT',
      directAmountYen: Math.round(calc.resultValue * MILLION),
      source,
      confirmed: false,
      sourceNote,
    },
  };
}

export type CandidateCheck = {
  key: 'meaning' | 'incremental' | 'basis' | 'startYm' | 'operatingIncome';
  label: string;
  done: boolean;
  /** true の項目が未了なら、AI提案の効果は確認できない（確認条件を緩めない） */
  blocking: boolean;
};

/** 利用者が確認すべき項目。AI提案の効果では、意味の確認と追加効果の確認を必須にする */
export function candidateChecks(effect: FinanceEffect): CandidateCheck[] {
  const aiProposed = effect.source === 'AI_PROPOSED';
  const checks: CandidateCheck[] = [];
  if (aiProposed && effect.method === 'FUNNEL') {
    checks.push({
      key: 'meaning',
      label: 'AIの「対象顧客数」を、商談数として扱ってよいか',
      done: effect.meetingBasisConfirmed === true,
      blocking: true,
    });
  }
  if (effect.kind === 'REVENUE_UP') {
    checks.push({
      key: 'incremental',
      label: '既存の売上に対する追加効果か',
      done: effect.isIncremental === true,
      blocking: aiProposed,
    });
    checks.push({
      key: 'operatingIncome',
      label: '営業利益への増分（未入力の場合は未算定）',
      done: typeof effect.operatingIncomeEffectYen === 'number' && Number.isFinite(effect.operatingIncomeEffectYen),
      blocking: false,
    });
  }
  checks.push({ key: 'basis', label: '金額の単位（一回限り・月額・年額）', done: effect.amountBasis !== undefined, blocking: true });
  checks.push({ key: 'startYm', label: '効果の開始月', done: typeof effect.startYm === 'string' && effect.startYm !== '', blocking: true });
  return checks;
}

/** AI提案の効果は、必須の確認項目がすべて済んでいないと確認できない */
export function blockingChecksDone(effect: FinanceEffect): boolean {
  return candidateChecks(effect).every((c) => !c.blocking || c.done);
}

/**
 * 候補を、施策の既存の効果に書き込む。
 * 同じ種類の効果が既にあれば何もしない（確認済みの効果も上書きしない）。
 * 1つ目の効果は financeEffect、2つ目以降は financeEffects に保持する。
 */
export function planCandidateWrite(args: {
  primary: FinanceEffect | undefined;
  additional: FinanceEffect[] | undefined;
  candidate: FinanceEffect;
}): { outcome: 'created' | 'created_additional' | 'already_has_same_kind'; patch: { financeEffect?: FinanceEffect; financeEffects?: FinanceEffect[] } } {
  const additional = Array.isArray(args.additional) ? args.additional : [];
  const existing = [args.primary, ...additional].filter((e): e is FinanceEffect => !!e);
  if (existing.some((e) => e.kind === args.candidate.kind)) {
    return { outcome: 'already_has_same_kind', patch: {} };
  }
  if (!args.primary) {
    return { outcome: 'created', patch: { financeEffect: args.candidate } };
  }
  return { outcome: 'created_additional', patch: { financeEffects: [...additional, args.candidate] } };
}
