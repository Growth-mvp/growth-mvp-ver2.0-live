import type {
  FinanceEffect,
  FinanceEffectKind,
  FinanceEffectMethod,
  FinanceEffectSource,
  SpendAmountBasis,
} from '@/types/strategy';

export const FINANCE_EFFECT_KINDS: FinanceEffectKind[] = ['REVENUE_UP', 'COST_REDUCTION', 'COST_INCREASE', 'NOT_FINANCIAL'];
export const FINANCE_EFFECT_METHODS: FinanceEffectMethod[] = ['QUANTITY_UNIT_PRICE', 'FUNNEL', 'DIRECT_AMOUNT'];
const AMOUNT_BASES: SpendAmountBasis[] = ['TOTAL', 'MONTHLY', 'ANNUAL'];
const SOURCES: FinanceEffectSource[] = ['AI_PROPOSED', 'USER_INPUT'];

export const FINANCE_EFFECT_KIND_LABEL: Record<FinanceEffectKind, string> = {
  REVENUE_UP: '売上増加',
  COST_REDUCTION: '原価削減',
  COST_INCREASE: '追加費用',
  NOT_FINANCIAL: '財務換算しない',
};

export const FINANCE_EFFECT_METHOD_LABEL: Record<FinanceEffectMethod, string> = {
  QUANTITY_UNIT_PRICE: '数量×単価',
  FUNNEL: '商談数×受注率×平均受注額',
  DIRECT_AMOUNT: '直接金額',
};

export const FINANCE_EFFECT_BASIS_LABEL: Record<SpendAmountBasis, string> = {
  TOTAL: '一回限り（総額）',
  MONTHLY: '月額',
  ANNUAL: '年額',
};

export type FinanceEffectStatus = 'NOT_SET' | 'NOT_FINANCIAL' | 'INCOMPLETE' | 'DRAFT' | 'CONFIRMED';

export type FinanceEffectResult = {
  status: FinanceEffectStatus;
  missing: string[];
  /** 入力された期間あたりの金額（円）。一回限りなら総額、月額なら1か月、年額なら1年 */
  amountYen?: number;
  totalYen?: number;
  monthlyYen?: number;
  annualYen?: number;
  /** 一回限りの効果（符号つき。売上増は含めない） */
  oneTimeOperatingEffectYen?: number;
  /** 年額の営業利益への効果（符号つき。売上増は含めない） */
  annualOperatingEffectYen?: number;
  /** 売上増加の年額（売上増加の施策のみ） */
  annualRevenueYen?: number;
  /** 売上増加で原価率が入力された場合の参考原価（年額。利益へは差し引かない） */
  referenceCostYen?: number;
  formula?: string;
};

const YM = /^\d{4}-(0[1-9]|1[0-2])$/;

function isYm(v: unknown): v is string {
  return typeof v === 'string' && YM.test(v);
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function nonEmpty(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0;
}

function yen(v: number): string {
  return `${Math.round(v).toLocaleString('ja-JP')}円`;
}

/** 財務効果の算定。入力が不足・不正なら未算定（missing に理由を入れ、金額は返さない） */
export function computeFinanceEffect(effect: FinanceEffect | null | undefined): FinanceEffectResult {
  if (!effect || !FINANCE_EFFECT_KINDS.includes(effect.kind)) {
    return { status: 'NOT_SET', missing: [] };
  }
  if (effect.kind === 'NOT_FINANCIAL') {
    return { status: 'NOT_FINANCIAL', missing: [] };
  }

  const missing: string[] = [];
  const { method, amountBasis } = effect;

  if (!method || !FINANCE_EFFECT_METHODS.includes(method)) missing.push('算定方法');
  if (!amountBasis || !AMOUNT_BASES.includes(amountBasis)) missing.push('金額の単位（一回限り・月額・年額）');
  if (!isYm(effect.startYm)) missing.push('効果の開始時期');
  if (effect.endYm !== undefined && (!isYm(effect.endYm) || (isYm(effect.startYm) && effect.endYm < effect.startYm))) {
    missing.push('効果の終了時期（開始より後の月）');
  }
  if (!nonEmpty(effect.sourceNote)) missing.push('算定根拠・出所');
  if (effect.costRatePct !== undefined && (!isFiniteNumber(effect.costRatePct) || effect.costRatePct < 0 || effect.costRatePct > 100)) {
    missing.push('原価率（0〜100%）');
  }

  let perPeriod: number | undefined;
  let formula: string | undefined;

  if (method === 'QUANTITY_UNIT_PRICE') {
    const okQty = isFiniteNumber(effect.quantity) && effect.quantity > 0;
    const okPrice = isFiniteNumber(effect.unitPriceYen) && effect.unitPriceYen >= 0;
    if (!okQty) missing.push('数量');
    if (!okPrice) missing.push('単価');
    if (okQty && okPrice) {
      perPeriod = effect.quantity! * effect.unitPriceYen!;
      formula = `${effect.quantity}（数量）× ${yen(effect.unitPriceYen!)}（単価）`;
    }
  } else if (method === 'FUNNEL') {
    if (effect.kind !== 'REVENUE_UP') missing.push('商談数×受注率×平均受注額は売上増加の施策にのみ使えます');
    const okMeetings = isFiniteNumber(effect.meetingsPerPeriod) && effect.meetingsPerPeriod >= 0;
    const okRate = isFiniteNumber(effect.winRatePct) && effect.winRatePct >= 0 && effect.winRatePct <= 100;
    const okDeal = isFiniteNumber(effect.averageDealYen) && effect.averageDealYen >= 0;
    if (!okMeetings) missing.push('商談数');
    if (!okRate) missing.push('受注率（0〜100%）');
    if (!okDeal) missing.push('平均受注額');
    if (okMeetings && okRate && okDeal && effect.kind === 'REVENUE_UP') {
      perPeriod = effect.meetingsPerPeriod! * (effect.winRatePct! / 100) * effect.averageDealYen!;
      formula = `${effect.meetingsPerPeriod}件 × ${effect.winRatePct}% × ${yen(effect.averageDealYen!)}`;
    }
  } else if (method === 'DIRECT_AMOUNT') {
    if (!isFiniteNumber(effect.directAmountYen) || effect.directAmountYen < 0) missing.push('直接金額');
    else {
      perPeriod = effect.directAmountYen;
      formula = `直接入力：${yen(effect.directAmountYen)}`;
    }
  }

  if (missing.length > 0 || perPeriod === undefined || !amountBasis) {
    return { status: 'INCOMPLETE', missing };
  }

  const sign = effect.kind === 'COST_INCREASE' ? -1 : 1;
  const result: FinanceEffectResult = {
    status: effect.confirmed ? 'CONFIRMED' : 'DRAFT',
    missing: [],
    amountYen: perPeriod,
    formula: `${formula}（${FINANCE_EFFECT_BASIS_LABEL[amountBasis]}）`,
  };
  const operatingPerPeriod = operatingPerPeriodOf(effect, sign * perPeriod);

  if (amountBasis === 'TOTAL') {
    result.totalYen = perPeriod;
    if (operatingPerPeriod !== undefined) result.oneTimeOperatingEffectYen = operatingPerPeriod;
    return result;
  }

  const annual = amountBasis === 'MONTHLY' ? perPeriod * 12 : perPeriod;
  result.monthlyYen = amountBasis === 'MONTHLY' ? perPeriod : perPeriod / 12;
  result.annualYen = annual;
  const annualOperating =
    operatingPerPeriod === undefined ? undefined : amountBasis === 'MONTHLY' ? operatingPerPeriod * 12 : operatingPerPeriod;

  if (effect.kind === 'REVENUE_UP') {
    result.annualRevenueYen = annual;
    if (effect.costRatePct !== undefined && isFiniteNumber(effect.costRatePct)) {
      result.referenceCostYen = annual * (effect.costRatePct / 100);
    }
    if (annualOperating !== undefined) result.annualOperatingEffectYen = annualOperating;
  } else {
    result.annualOperatingEffectYen = annualOperating;
  }
  return result;
}

/** 営業利益への効果（期間あたり・符号つき）。売上増加は利用者が入力した増分のみ使い、費用・原価からは推定しない */
function operatingPerPeriodOf(effect: FinanceEffect, costEffectPerPeriod: number): number | undefined {
  if (effect.kind !== 'REVENUE_UP') return costEffectPerPeriod;
  return isFiniteNumber(effect.operatingIncomeEffectYen) ? effect.operatingIncomeEffectYen : undefined;
}

/** 同じ効果種類で、対象範囲が同じ、または同じ算定方法で期間が重なる他施策（重複の可能性。自動では除外しない） */
export function findFinanceEffectOverlapCandidates(departments: unknown, deptIdx: number, projIdx: number): string[] {
  const depts = Array.isArray(departments) ? departments : [];
  const entries: { label: string; effect: FinanceEffect | undefined; d: number; p: number }[] = [];
  depts.forEach((dept: any, d) => {
    const projects = Array.isArray(dept?.projects) ? dept.projects : [];
    projects.forEach((proj: any, p: number) => {
      const label = `${String(dept?.name ?? '').trim() || '部門未設定'} / ${String(proj?.title ?? proj?.name ?? '').trim() || '施策未設定'}`;
      entries.push({ label, effect: normalizeFinanceEffect(proj?.financeEffect), d, p });
    });
  });
  const self = entries.find((e) => e.d === deptIdx && e.p === projIdx)?.effect;
  if (!self || !isFinancialKind(self.kind) || !isYm(self.startYm)) return [];

  const selfScope = nonEmpty(self.scopeNote) ? self.scopeNote.trim() : null;
  return entries
    .filter((e) => !(e.d === deptIdx && e.p === projIdx))
    .filter((e) => {
      const o = e.effect;
      if (!o || o.kind !== self.kind || !isYm(o.startYm)) return false;
      const sameScope = selfScope !== null && nonEmpty(o.scopeNote) && o.scopeNote.trim() === selfScope;
      const sameMethod = o.method !== undefined && o.method === self.method;
      return sameScope || (sameMethod && periodsOverlap(self, o));
    })
    .map((e) => e.label);
}

function isFinancialKind(kind: FinanceEffectKind): boolean {
  return kind === 'REVENUE_UP' || kind === 'COST_REDUCTION' || kind === 'COST_INCREASE';
}

function periodsOverlap(a: FinanceEffect, b: FinanceEffect): boolean {
  const aEnd = isYm(a.endYm) ? a.endYm : '9999-12';
  const bEnd = isYm(b.endYm) ? b.endYm : '9999-12';
  return (a.startYm as string) <= bEnd && (b.startYm as string) <= aEnd;
}

/** 保存済みデータを読むときの防御。不正な項目は捨て、読めない場合は undefined（未設定扱い） */
export function normalizeFinanceEffect(raw: unknown): FinanceEffect | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const r = raw as Record<string, unknown>;
  if (!FINANCE_EFFECT_KINDS.includes(r.kind as FinanceEffectKind)) return undefined;

  const out: FinanceEffect = {
    kind: r.kind as FinanceEffectKind,
    source: SOURCES.includes(r.source as FinanceEffectSource) ? (r.source as FinanceEffectSource) : 'USER_INPUT',
    confirmed: r.confirmed === true,
  };
  if (FINANCE_EFFECT_METHODS.includes(r.method as FinanceEffectMethod)) out.method = r.method as FinanceEffectMethod;
  if (AMOUNT_BASES.includes(r.amountBasis as SpendAmountBasis)) out.amountBasis = r.amountBasis as SpendAmountBasis;
  if (isYm(r.startYm)) out.startYm = r.startYm;
  if (isYm(r.endYm)) out.endYm = r.endYm;

  const numericKeys = [
    'quantity',
    'unitPriceYen',
    'meetingsPerPeriod',
    'winRatePct',
    'averageDealYen',
    'directAmountYen',
    'costRatePct',
    'operatingIncomeEffectYen',
  ] as const;
  for (const key of numericKeys) {
    if (isFiniteNumber(r[key])) out[key] = r[key] as number;
  }

  for (const key of ['scopeNote', 'sourceNote', 'overlapNote', 'confirmedAt'] as const) {
    if (typeof r[key] === 'string') out[key] = r[key] as string;
  }
  return out;
}

export type FinanceEffectViewModel = {
  statusLabel: string;
  tone: 'muted' | 'warning' | 'info' | 'success';
  missingText: string | null;
  notice: string;
};

/** 画面の表示文言（状態と不足項目）。STAGE6へは反映されないことを必ず添える */
const MISSING_FIELD_HINT: Record<string, string> = {
  '算定方法': '「算定方法」',
  '金額の単位（一回限り・月額・年額）': '「金額の単位」',
  '効果の開始時期': '「効果の開始月」',
  '効果の終了時期（開始より後の月）': '「終了月」',
  '算定根拠・出所': '「算定根拠・出所」',
  '原価率（0〜100%）': '「原価率」',
  '数量': '「数量」',
  '単価': '「単価（百万円）」',
  '商談数': '「商談数」',
  '受注率（0〜100%）': '「受注率（%）」',
  '平均受注額': '「平均受注額（百万円）」',
  '直接金額': '「金額（百万円）」',
};

function missingTextOf(missing: string[]): string {
  return `不足：${missing.map((m) => (MISSING_FIELD_HINT[m] ? `${m}（${MISSING_FIELD_HINT[m]}に入力）` : m)).join('、')}`;
}

export function financeEffectViewModel(effect: FinanceEffect | undefined): FinanceEffectViewModel {
  const result = computeFinanceEffect(effect);
  const notice = '利用者が確認済みにした算定根拠だけが、STAGE6の条件付きPL・CF試算に反映されます。経営目標・旧北極星の金額には加算しません。未確認の内容は反映されません。';
  switch (result.status) {
    case 'NOT_SET':
      return { statusLabel: '未設定（任意）', tone: 'muted', missingText: null, notice };
    case 'NOT_FINANCIAL':
      return { statusLabel: '財務換算しない施策', tone: 'muted', missingText: null, notice };
    case 'INCOMPLETE':
      return {
        statusLabel: '未算定（入力不足）',
        tone: 'warning',
        missingText: result.missing.length ? missingTextOf(result.missing) : null,
        notice,
      };
    case 'DRAFT':
      return { statusLabel: '未確定（確認待ち）', tone: 'info', missingText: null, notice };
    case 'CONFIRMED':
      return { statusLabel: '利用者が確認済み', tone: 'success', missingText: null, notice };
  }
}

/** 確認内容そのもの。ここが変わると確認は無効になる（overlapNote は表示上の注記なので含めない） */
const CONFIRMATION_MATERIAL_KEYS = [
  'kind',
  'method',
  'amountBasis',
  'startYm',
  'endYm',
  'quantity',
  'unitPriceYen',
  'meetingsPerPeriod',
  'winRatePct',
  'averageDealYen',
  'directAmountYen',
  'costRatePct',
  'operatingIncomeEffectYen',
  'scopeNote',
  'sourceNote',
  'source',
] as const;

export function isFinanceEffectMaterialChange(prev: FinanceEffect | undefined, next: FinanceEffect | undefined): boolean {
  if (!prev || !next) return prev !== next;
  return CONFIRMATION_MATERIAL_KEYS.some((k) => prev[k] !== next[k]);
}

/** 保存前に確認状態を整える。確認内容が変わった・新規なら未確認。同じ内容の確認は、元の確認日時を保つ */
export function guardFinanceEffectConfirmation(prev: unknown, nextRaw: unknown): FinanceEffect | undefined {
  const next = normalizeFinanceEffect(nextRaw);
  if (!next) return undefined;
  const before = normalizeFinanceEffect(prev);
  const sameContent = before !== undefined && !isFinanceEffectMaterialChange(before, next);

  if (!next.confirmed || !sameContent) {
    const out: FinanceEffect = { ...next, confirmed: false };
    delete out.confirmedAt;
    return out;
  }
  const confirmedAt = before.confirmed ? before.confirmedAt : next.confirmedAt;
  const out: FinanceEffect = { ...next, confirmed: true };
  if (confirmedAt) out.confirmedAt = confirmedAt;
  else delete out.confirmedAt;
  return out;
}

export type LegacyImpactView = {
  rows: { label: string; value: string }[];
  notes: string[];
};

const LEGACY_TOLERANCE_MJPY = 0.0005;

/** 従来の成果見込み（旧値）と財務効果の算定根拠を並べ、食い違いを注記する。旧値は検証済みの値ではない */
export function compareLegacyImpact(
  effect: FinanceEffect | undefined,
  legacy: { revenueMJPY?: number; opIncomeMJPY?: number },
): LegacyImpactView {
  const fmt = (mjpy: number) => `${Math.round(mjpy * 1000) / 1000}百万円`;
  const rows: LegacyImpactView['rows'] = [];
  const notes: string[] = [];

  if (legacy.revenueMJPY !== undefined) {
    rows.push({ label: '従来の売上見込み（旧値・検証済みではありません）', value: fmt(legacy.revenueMJPY) });
  }
  if (legacy.opIncomeMJPY !== undefined) {
    rows.push({ label: '従来の営業利益見込み（旧値・検証済みではありません）', value: fmt(legacy.opIncomeMJPY) });
  }

  const fe = normalizeFinanceEffect(effect);
  const r = computeFinanceEffect(fe);
  const confirmedLabel = fe?.confirmed ? '確認済み' : '未確認';

  if (fe?.kind === 'NOT_FINANCIAL') {
    if (legacy.revenueMJPY !== undefined || legacy.opIncomeMJPY !== undefined) {
      notes.push('財務換算しない施策ですが、従来の見込み額が入っています。');
    }
    return { rows, notes };
  }

  const finRevenueMJPY = r.annualRevenueYen !== undefined ? r.annualRevenueYen / MILLION_YEN : undefined;
  const finOpMJPY =
    r.annualOperatingEffectYen !== undefined
      ? r.annualOperatingEffectYen / MILLION_YEN
      : r.oneTimeOperatingEffectYen !== undefined
        ? r.oneTimeOperatingEffectYen / MILLION_YEN
        : undefined;

  if (fe && isFinancialKindForView(fe.kind)) {
    rows.push({
      label: '財務効果の年額売上',
      value: finRevenueMJPY !== undefined ? `${fmt(finRevenueMJPY)}（${confirmedLabel}）` : '未算定',
    });
    rows.push({
      label: '財務効果の営業利益への効果',
      value: finOpMJPY !== undefined ? `${fmt(finOpMJPY)}（${confirmedLabel}）` : '未算定',
    });
  } else if (legacy.revenueMJPY !== undefined || legacy.opIncomeMJPY !== undefined) {
    notes.push('財務効果の算定根拠は未入力です。従来の見込み額は、財務効果に移すまで統一試算には入りません。');
  }

  if (legacy.revenueMJPY !== undefined && finRevenueMJPY !== undefined && Math.abs(legacy.revenueMJPY - finRevenueMJPY) > LEGACY_TOLERANCE_MJPY) {
    notes.push(`従来の売上見込み（${fmt(legacy.revenueMJPY)}）と財務効果の年額売上（${fmt(finRevenueMJPY)}）が異なります。統一試算には財務効果だけを使い、旧値は自動では採用しません。`);
  }
  if (legacy.opIncomeMJPY !== undefined && finOpMJPY !== undefined && Math.abs(legacy.opIncomeMJPY - finOpMJPY) > LEGACY_TOLERANCE_MJPY) {
    notes.push(`従来の営業利益見込み（${fmt(legacy.opIncomeMJPY)}）と財務効果の営業利益への効果（${fmt(finOpMJPY)}）が異なります。`);
  }
  if (fe && !fe.confirmed && (legacy.revenueMJPY !== undefined || legacy.opIncomeMJPY !== undefined)) {
    notes.push('財務効果は未確認です。確認するまで、統一試算には入りません。');
  }

  return { rows, notes };
}

const MILLION_YEN = 1_000_000;

function isFinancialKindForView(kind: FinanceEffectKind): boolean {
  return kind === 'REVENUE_UP' || kind === 'COST_REDUCTION' || kind === 'COST_INCREASE';
}
