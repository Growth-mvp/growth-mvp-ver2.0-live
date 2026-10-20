import type { FinanceBSRow, FinancePLRow } from '@/types/strategy';
import type { CfAssumptions } from './cashflow';
import type { ExistingLoanInput, LoanCategory, NewLoanInput, RepaymentMethod } from './debt';

export const FINANCE_PLAN_FORMAT_VERSION = 1;
export const FINANCE_PLAN_CALC_VERSION = 'phase4a-v1';

export const SAVE_RESIDUAL_RISKS: readonly string[] = [
  '本番の行レベルセキュリティ（RLS）の現行ポリシーの本文は、SQLで直接確認できていません。匿名キーでのアクセスは権限で拒否されることを確認済みです',
  'Cookieに依存する保存経路（story-process、Step5Confirm、resolveCompanyId）は残っています。STAGE6の保存は、ストアが保持する会社IDを明示して送るため、これらの経路は使いません。ただし同じブラウザで会社を切り替えた場合のCookieの書き換えは残ります',
  '保存・復元の実機確認（F5、別画面、会社切替）は未実施です。検証専用の企業・テスト用アカウントを特定できていないためです',
];

export type SaveAvailability = { enabled: true; residualRisks: readonly string[] };

export function saveAvailability(): SaveAvailability {
  return { enabled: true, residualRisks: SAVE_RESIDUAL_RISKS };
}

export type StoredFinancePlan = SavedFinancePlanV1 & {
  companyId: string;
  savedAt: string;
  meta: CalcSnapshotMeta;
};

export function buildStoredFinancePlan(args: {
  domain: FinancePlanDomain;
  companyId: string;
  meta: CalcSnapshotMeta;
  savedAt: string;
}): StoredFinancePlan {
  return { ...toSavedFinancePlan(args.domain), companyId: args.companyId, savedAt: args.savedAt, meta: args.meta };
}

export type StoredReadResult =
  | { kind: 'NONE' }
  | { kind: 'DIFFERENT_COMPANY' }
  | { kind: 'INVALID'; error: string }
  | { kind: 'OK'; domain: FinancePlanDomain; meta: CalcSnapshotMeta; savedAt: string; warnings: string[] };

export function readStoredFinancePlan(raw: unknown, currentCompanyId: string | null): StoredReadResult {
  if (raw === undefined || raw === null) return { kind: 'NONE' };
  const obj = raw as Partial<StoredFinancePlan>;
  if (!canRestoreFor(typeof obj.companyId === 'string' ? obj.companyId : null, currentCompanyId)) {
    return { kind: 'DIFFERENT_COMPANY' };
  }
  const parsed = parseSavedFinancePlan(raw);
  if (!parsed.ok) return { kind: 'INVALID', error: parsed.error };
  if (!obj.meta || typeof obj.savedAt !== 'string') return { kind: 'INVALID', error: '保存情報が不完全です' };
  return { kind: 'OK', domain: parsed.value, meta: obj.meta, savedAt: obj.savedAt, warnings: parsed.warnings };
}

export type SavedLoanCommon = { id: string; name: string };

export type SavedFinancePlanV1 = {
  formatVersion: 1;
  unit: 'JPY';
  cashFlow: CfAssumptions;
  existingLoans: (SavedLoanCommon & {
    category: LoanCategory;
    balanceYen: number | null;
    annualRate: number | null;
    scheduledPrincipalYen: Record<string, number | null>;
  })[];
  newLoans: (SavedLoanCommon & {
    drawYear: number | null;
    drawMonth: number | null;
    amountYen: number | null;
    annualRate: number | null;
    termYears: number | null;
    graceYears: number | null;
    method: RepaymentMethod;
  })[];
  dividendsYen: Record<string, number | null>;
};

export type FinancePlanDomain = {
  assumptions: CfAssumptions;
  existingLoans: ExistingLoanInput[];
  newLoans: NewLoanInput[];
  dividendsYen: Record<number, number | null | undefined>;
};

const LOAN_CATEGORIES: readonly LoanCategory[] = ['BANK', 'BOND', 'LEASE', 'SHAREHOLDER', 'OTHER'];
const METHODS: readonly RepaymentMethod[] = ['EQUAL_PRINCIPAL', 'BULLET'];

function numberOrNull(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function keyedNumbers(record: Record<number, number | null | undefined>): Record<string, number | null> {
  const out: Record<string, number | null> = {};
  for (const [k, v] of Object.entries(record)) {
    if (v === undefined) continue;
    out[k] = v;
  }
  return out;
}

export function toSavedFinancePlan(domain: FinancePlanDomain): SavedFinancePlanV1 {
  return {
    formatVersion: 1,
    unit: 'JPY',
    cashFlow: { ...domain.assumptions },
    existingLoans: domain.existingLoans.map((l) => ({
      id: l.id,
      name: l.name,
      category: l.category,
      balanceYen: l.balanceYen,
      annualRate: l.annualRate,
      scheduledPrincipalYen: keyedNumbers(l.scheduledPrincipalYen),
    })),
    newLoans: domain.newLoans.map((l) => ({
      id: l.id,
      name: l.name,
      drawYear: l.drawYear,
      drawMonth: l.drawMonth,
      amountYen: l.amountYen,
      annualRate: l.annualRate,
      termYears: l.termYears,
      graceYears: l.graceYears,
      method: l.method,
    })),
    dividendsYen: keyedNumbers(domain.dividendsYen),
  };
}

export type ParseResult =
  | { ok: true; value: FinancePlanDomain; warnings: string[] }
  | { ok: false; error: string };

const CASH_FIELDS: (keyof CfAssumptions)[] = [
  'minCashYen',
  'taxRate',
  'depreciationYen',
  'arRatio',
  'inventoryRatio',
  'apRatio',
  'targetRevenueYen',
  'targetOperatingIncomeYen',
  'targetYear',
];

export function parseSavedFinancePlan(raw: unknown): ParseResult {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, error: '保存データの形式が不正です' };
  }
  const obj = raw as Record<string, unknown>;
  if (obj.formatVersion !== FINANCE_PLAN_FORMAT_VERSION) {
    return { ok: false, error: '未対応の保存形式のため復元できません' };
  }
  if (obj.unit !== 'JPY') {
    return { ok: false, error: '金額の単位が確認できないため復元できません（円として保存されていません）' };
  }

  const warnings: string[] = [];
  const cashRaw = (obj.cashFlow ?? {}) as Record<string, unknown>;
  const assumptions = {} as CfAssumptions;
  for (const f of CASH_FIELDS) {
    const v = cashRaw[f];
    if (v !== undefined && v !== null && typeof v !== 'number') {
      warnings.push(`${f}の値が数値ではないため未入力として扱いました`);
    }
    assumptions[f] = numberOrNull(v) as never;
  }

  const existingRaw = Array.isArray(obj.existingLoans) ? obj.existingLoans : [];
  const existingLoans: ExistingLoanInput[] = existingRaw.map((r: unknown, i) => {
    const rr = (r ?? {}) as Record<string, unknown>;
    const sched: Record<number, number | null> = {};
    for (const [k, v] of Object.entries((rr.scheduledPrincipalYen ?? {}) as Record<string, unknown>)) {
      sched[Number(k)] = numberOrNull(v);
    }
    const category = LOAN_CATEGORIES.includes(rr.category as LoanCategory) ? (rr.category as LoanCategory) : 'OTHER';
    if (!LOAN_CATEGORIES.includes(rr.category as LoanCategory)) warnings.push(`借入${i + 1}の区分が不明のため「その他」として扱いました`);
    return {
      id: String(rr.id ?? `e${i}`),
      name: String(rr.name ?? ''),
      category,
      balanceYen: numberOrNull(rr.balanceYen),
      annualRate: numberOrNull(rr.annualRate),
      scheduledPrincipalYen: sched,
    };
  });

  const newRaw = Array.isArray(obj.newLoans) ? obj.newLoans : [];
  const newLoans: NewLoanInput[] = newRaw.map((r: unknown, i) => {
    const rr = (r ?? {}) as Record<string, unknown>;
    const method = METHODS.includes(rr.method as RepaymentMethod) ? (rr.method as RepaymentMethod) : 'EQUAL_PRINCIPAL';
    if (!METHODS.includes(rr.method as RepaymentMethod)) warnings.push(`新規借入${i + 1}の返済方式が不明のため元金均等として扱いました`);
    return {
      id: String(rr.id ?? `n${i}`),
      name: String(rr.name ?? ''),
      drawYear: numberOrNull(rr.drawYear),
      drawMonth: numberOrNull(rr.drawMonth),
      amountYen: numberOrNull(rr.amountYen),
      annualRate: numberOrNull(rr.annualRate),
      termYears: numberOrNull(rr.termYears),
      graceYears: numberOrNull(rr.graceYears),
      method,
    };
  });

  const dividendsYen: Record<number, number | null> = {};
  const divRaw = (obj.dividendsYen ?? {}) as Record<string, unknown>;
  for (const [k, v] of Object.entries(divRaw)) {
    dividendsYen[Number(k)] = numberOrNull(v);
  }

  return { ok: true, value: { assumptions, existingLoans, newLoans, dividendsYen }, warnings };
}

function canonical(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v === undefined ? null : v);
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  const obj = v as Record<string, unknown>;
  const keys = Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonical(obj[k])}`).join(',')}}`;
}

function fnv1a(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

export function hashOf(value: unknown): string {
  return fnv1a(canonical(value));
}

export type SourceSummary = {
  financePL: FinancePLRow[];
  financeBS: FinanceBSRow[];
  investment: {
    approvedReadyYen: number;
    unapprovedReadyYen: number;
    unclassifiedYen: number;
    unscheduledYen: number;
    candidateYen: number;
    basisPendingYen: number;
    yearlyByCategory: { fiscalYear: number; CAPEX: number; OPEX: number; OTHER: number }[];
  };
};

export function sourceHashOf(src: SourceSummary): string {
  const pl = src.financePL.map((r) => ({
    year: r.year,
    revenue: r.revenue,
    operatingIncome: r.operatingIncome,
    netIncome: r.netIncome,
    depreciation: r.depreciation,
    interest: r.interest,
    tax: r.tax,
  }));
  const bs = src.financeBS.map((r) => ({
    year: r.year,
    cash: r.cash,
    ar: r.ar,
    inventory: r.inventory,
    ap: r.ap,
    interestBearingDebt: r.interestBearingDebt,
  }));
  return hashOf({ pl, bs, investment: src.investment });
}

export type CalcSnapshotMeta = {
  calcVersion: string;
  companyId: string | null;
  baseYear: number | null;
  bsBaseYear: number | null;
  assumptionsHash: string;
  sourceHash: string;
  unconfirmed: {
    unapprovedReadyYen: number;
    unclassifiedYen: number;
    unscheduledYen: number;
    candidateYen: number;
    basisPendingYen: number;
  };
  computedAt: string;
};

export type Freshness =
  | { kind: 'NO_SAVED' }
  | { kind: 'CURRENT'; hasUnconfirmed: boolean }
  | { kind: 'STALE'; reasons: string[] }
  | { kind: 'DIFFERENT_COMPANY' };

export function judgeFreshness(saved: CalcSnapshotMeta | null, current: CalcSnapshotMeta): Freshness {
  if (!saved) return { kind: 'NO_SAVED' };
  if (saved.companyId !== current.companyId) return { kind: 'DIFFERENT_COMPANY' };
  const reasons: string[] = [];
  if (saved.calcVersion !== current.calcVersion) reasons.push('計算ロジックのバージョンが変わりました');
  if (saved.assumptionsHash !== current.assumptionsHash) reasons.push('入力前提が変わりました');
  if (saved.sourceHash !== current.sourceHash) reasons.push('STAGE1またはSTAGE4の元データが変わりました');
  if (reasons.length > 0) return { kind: 'STALE', reasons };
  const u = current.unconfirmed;
  const hasUnconfirmed =
    u.unapprovedReadyYen > 0 || u.unclassifiedYen > 0 || u.unscheduledYen > 0 || u.candidateYen > 0 || u.basisPendingYen > 0;
  return { kind: 'CURRENT', hasUnconfirmed };
}

export function canRestoreFor(savedCompanyId: string | null, currentCompanyId: string | null): boolean {
  return !!savedCompanyId && !!currentCompanyId && savedCompanyId === currentCompanyId;
}

export function describeSaveError(err: { status?: number; code?: string; message?: string } | null | undefined): string {
  if (!err) return '保存に失敗しました。入力内容は画面に残っています。';
  if (err.status === 409 || err.code === 'REVISION_CONFLICT') {
    return '他の利用者が先に更新しました。再読み込みしてから保存し直してください（入力内容は画面に残っています）。';
  }
  if (err.status === 401 || err.status === 403) {
    return '保存する権限または所属を確認できませんでした。保存は行われていません。';
  }
  return '保存に失敗しました。入力内容は画面に残っています。';
}

export function freshnessLabel(f: Freshness): string {
  switch (f.kind) {
    case 'NO_SAVED':
      return '保存済みの計画はありません（現在の試算のみ）';
    case 'CURRENT':
      return f.hasUnconfirmed
        ? '保存済みの前提と最新の元データが一致（ただし未確定・未承認の投資が含まれます）'
        : '保存済みの前提と最新の元データが一致';
    case 'STALE':
      return `過去の計算です（${f.reasons.join('、')}）`;
    case 'DIFFERENT_COMPANY':
      return '別の会社の計画のため表示しません';
  }
}

export function workingHashOf(csv: unknown): string | undefined {
  const working = (csv as { financePlanAssumptions?: { meta?: { assumptionsHash?: unknown } } } | null | undefined)
    ?.financePlanAssumptions;
  const hash = working?.meta?.assumptionsHash;
  return typeof hash === 'string' ? hash : undefined;
}

export function applyWorkingSnapshot(csv: unknown, snapshot: unknown): Record<string, unknown> {
  const base = csv && typeof csv === 'object' && !Array.isArray(csv) ? (csv as Record<string, unknown>) : {};
  return { ...base, financePlanAssumptions: snapshot };
}

export function pickFinancePlanForSave(incoming: unknown, existing: unknown): unknown {
  const fromIncoming = (incoming as { financePlanAssumptions?: unknown } | null | undefined)?.financePlanAssumptions;
  if (fromIncoming !== undefined && fromIncoming !== null) return fromIncoming;
  return (existing as { financePlanAssumptions?: unknown } | null | undefined)?.financePlanAssumptions;
}

export function financePlanUnsaved(args: {
  currentHash: string;
  savedHash: string | undefined;
  workingHash: string | undefined;
  hasInput: boolean;
}): boolean {
  const baseline = args.savedHash ?? args.workingHash;
  if (baseline === undefined) return args.hasInput;
  return args.currentHash !== baseline;
}
