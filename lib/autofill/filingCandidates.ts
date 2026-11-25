/* 有価証券報告書（構造化データから抽出済み）を、承認できる候補に変換し、承認された項目だけの反映計画を作る。
 * 出典（書類ID・期末・連結区分・単位）を項目ごとに持つ。推測で補わない。 */
import type { ExtractedFacts } from './xbrlFacts';
import { candidateFromDocument, type CompanyProfileCandidate, type Consolidation, type EdinetDocument, type FieldCandidate, type SourceRef } from './companyCandidates';

export type FinanceYearCandidate = {
  year: number;
  revenue?: FieldCandidate<number>;
  operatingIncome?: FieldCandidate<number>;
  netIncome?: FieldCandidate<number>;
  totalAssets?: FieldCandidate<number>;
  netAssets?: FieldCandidate<number>;
  cash?: FieldCandidate<number>;
  interestBearingDebt?: FieldCandidate<number>;
};

/** 承認して反映できる候補の共通部分（EDINET・公開情報・資料のいずれからも作れる） */
export type ApplicableCandidate = {
  filer: { name: string; secCode: string | null; edinetCode: string | null };
  fiscalYear: number | null;
  profile: CompanyProfileCandidate;
  profileExtra: Partial<{
    location: FieldCandidate<string>;
    employees: FieldCandidate<number>;
    businessContent: FieldCandidate<string>;
    industry: FieldCandidate<string>;
  }>;
  finance: FinanceYearCandidate[];
  segments: SegmentsCandidate | null;
  issues: string[];
};

export type FilingCandidate = ApplicableCandidate & {
  docId: string;
  docTypeCode: string | null;
  periodEnd: string | null;
  amendedFromDocId: string | null;
  reports: ReportRef[];
};

export type SegmentYearCandidate = { year: number; sales?: number; operatingIncome?: number };

/** 事業の名称と、最新期の売上・営業利益（円）。byYear は全期の値（事業別PLの反映に使う） */
export type SegmentItemCandidate = { name: string | null; memberCode: string; sales?: number; operatingIncome?: number; byYear?: SegmentYearCandidate[] };

export type SegmentsCandidate = {
  periodEnd: string | null;
  items: SegmentItemCandidate[];
  issues: string[];
};

export type ReportRef = { docId: string; docTypeCode: string | null; periodEnd: string | null; amendedFromDocId: string | null };

export type ProfileKey = 'companyName' | 'ticker' | 'fiscalYearEnd' | 'isListed' | 'location' | 'employees' | 'businessContent' | 'industry';
export type FinanceKey = 'revenue' | 'operatingIncome' | 'netIncome' | 'totalAssets' | 'netAssets' | 'cash' | 'interestBearingDebt';

export const PROFILE_KEYS: ProfileKey[] = ['companyName', 'ticker', 'fiscalYearEnd', 'isListed', 'location', 'employees', 'businessContent', 'industry'];
export const FINANCE_KEYS: FinanceKey[] = ['revenue', 'operatingIncome', 'netIncome', 'totalAssets', 'netAssets', 'cash', 'interestBearingDebt'];
/** 貸借対照表（時点）の項目。損益と違い、年度の行の BS 側（financeBS）に保存する */
export const BS_FINANCE_KEYS: FinanceKey[] = ['totalAssets', 'netAssets', 'cash', 'interestBearingDebt'];

export const PROFILE_LABEL: Record<ProfileKey, string> = {
  companyName: '会社名',
  ticker: '証券コード',
  fiscalYearEnd: '決算月',
  isListed: '上場区分',
  location: '所在地',
  employees: '従業員数',
  businessContent: '事業内容',
  industry: '業種',
};

export const FINANCE_LABEL: Record<FinanceKey, string> = {
  revenue: '売上高',
  operatingIncome: '営業利益',
  netIncome: '親会社株主に帰属する当期純利益',
  totalAssets: '総資産',
  netAssets: '純資産',
  cash: '現預金',
  interestBearingDebt: '有利子負債',
};

export const BUSINESS_CONTENT_MAX = 2000;

export function buildFilingCandidate(args: {
  doc: EdinetDocument;
  facts: ExtractedFacts;
  fetchedAt: string;
  amendedFromDocId: string | null;
}): FilingCandidate {
  const { doc, facts, fetchedAt } = args;
  const profile = candidateFromDocument(doc, fetchedAt);
  const issues: string[] = [...facts.issues];
  if (args.amendedFromDocId) issues.push(`訂正報告書（${doc.docId}）の値を採用（元の有価証券報告書 ${args.amendedFromDocId} より後に提出）`);

  const source: Extract<SourceRef, { source: 'EDINET' }> = { source: 'EDINET', docId: doc.docId, docTypeCode: doc.docTypeCode, periodEnd: doc.periodEnd, fetchedAt };
  const consolidation: Consolidation = facts.consolidationConfirmed ? 'CONSOLIDATED' : 'UNKNOWN';
  const fy = facts.fiscalYear;

  if (facts.companyName && facts.filerNameDei && facts.companyName !== facts.filerNameDei) {
    issues.push('会社名の表記（表紙と書類情報）が一致しないため、確認が必要');
  }
  if (!facts.companyName && profile.fields.companyName === undefined) {
    issues.push('会社名が取得できませんでした（未入力のまま）');
  }

  const profileExtra: FilingCandidate['profileExtra'] = {};
  if (facts.address) profileExtra.location = { value: facts.address, source, fiscalYear: fy, consolidation: 'NOT_APPLICABLE' };
  if (facts.employees !== null) profileExtra.employees = { value: facts.employees, source, fiscalYear: fy, consolidation: 'UNKNOWN' };
  if (facts.businessText) {
    const text = Array.from(facts.businessText.replace(/^[^【]*【事業の内容】\s*/, '')).slice(0, BUSINESS_CONTENT_MAX).join('');
    profileExtra.businessContent = { value: text, source, fiscalYear: fy, consolidation: 'NOT_APPLICABLE' };
  }
  if (facts.exchange) issues.push(`上場市場：${facts.exchange}（利用者の入力欄に該当項目がないため、候補には含めない）`);
  issues.push('業種（東証33業種）は提出書類の構造化データに無いため、未入力のまま');
  issues.push('事業セグメントの名称と金額は、構造化データの値として取り出せていないため、未入力のまま');

  const finance = new Map<number, FinanceYearCandidate>();
  const pointOf = (year: number): FinanceYearCandidate => {
    let p = finance.get(year);
    if (!p) {
      p = { year };
      finance.set(year, p);
    }
    return p;
  };
  for (const r of [...facts.pl, ...facts.bs]) {
    const p = pointOf(r.year);
    for (const k of FINANCE_KEYS) {
      const v = (r as unknown as Record<string, number | undefined>)[k];
      if (v !== undefined) {
        const cand: FieldCandidate<number> = {
          value: v,
          source: { ...source, periodEnd: `${r.year}` },
          fiscalYear: r.year,
          consolidation,
        };
        (p as unknown as Record<string, FieldCandidate<number>>)[k] = cand;
      }
    }
  }

  return {
    filer: { name: doc.filerName, secCode: profile.fields.ticker?.value ?? null, edinetCode: doc.edinetCode },
    docId: doc.docId,
    docTypeCode: doc.docTypeCode,
    periodEnd: doc.periodEnd,
    fiscalYear: fy,
    amendedFromDocId: args.amendedFromDocId,
    profile,
    profileExtra,
    finance: [...finance.values()].sort((a, b) => a.year - b.year),
    segments: null,
    reports: [{ docId: doc.docId, docTypeCode: doc.docTypeCode, periodEnd: doc.periodEnd, amendedFromDocId: args.amendedFromDocId }],
    issues,
  };
}

export type CurrentFilingProfile = Record<ProfileKey, string | boolean | undefined>;
export type SegmentPatchItem = { name: string; memberCode: string; revenueMillion?: number; profitMillion?: number };
export type CurrentFinanceRow = { year: number } & Partial<Record<FinanceKey, number | null>>;

export type SegmentPLRowPatch = { year: number; revenue?: number; operatingIncome?: number };
export type SegmentPLPatch = Record<string, SegmentPLRowPatch[]>;

export type FilingApplyPlan = {
  segmentsPatch: SegmentPatchItem[] | null;
  segmentsSkipped: 'not_selected' | 'no_candidate' | 'already_filled' | null;
  segmentPlPatch: SegmentPLPatch | null;
  profilePatch: Partial<Record<ProfileKey, string | boolean>>;
  profileApplied: ProfileKey[];
  profileSkipped: Array<{ key: ProfileKey; reason: 'already_filled' | 'no_candidate' }>;
  financeRows: CurrentFinanceRow[];
  financeApplied: Array<{ year: number; keys: FinanceKey[] }>;
  financeSkipped: Array<{ year: number; key: FinanceKey; reason: 'already_filled' | 'no_candidate' | 'same_value' }>;
};

function isEmpty(v: unknown): boolean {
  if (v === undefined || v === null) return true;
  if (typeof v === 'string') return v.trim() === '';
  if (typeof v === 'number') return false;
  return false;
}

function candidateValueOf(c: ApplicableCandidate, key: ProfileKey): string | boolean | number | undefined {
  if (key === 'companyName') return c.profile.fields.companyName?.value;
  if (key === 'ticker') return c.profile.fields.ticker?.value;
  if (key === 'fiscalYearEnd') return c.profile.fields.fiscalYearEnd?.value;
  if (key === 'isListed') return c.profile.fields.isListed?.value;
  if (key === 'location') return c.profileExtra.location?.value;
  if (key === 'employees') return c.profileExtra.employees?.value;
  if (key === 'industry') return c.profileExtra.industry?.value;
  return c.profileExtra.businessContent?.value;
}

/** 承認された項目だけを反映する。入力済みの項目は、上書きを選んだ時だけ変える。財務は年度ごとに判断する */
export function planFilingApply(args: {
  current: CurrentFilingProfile;
  currentFinance: CurrentFinanceRow[];
  candidate: ApplicableCandidate;
  selectedProfile: ProfileKey[];
  overwriteProfile: ProfileKey[];
  selectedYears: number[];
  overwriteYears: number[];
  selectedSegments?: boolean;
  overwriteSegments?: boolean;
  currentSegmentCount?: number;
  /** 登録中の事業別PL（事業の名称ごと）。年度の行を既存の値と比べるために使う */
  currentSegmentPL?: Record<string, Array<{ year: number } & Record<string, unknown>>>;
  /** 事業別PLを反映してよい事業の名称（登録中の事業と一致するものだけ） */
  segmentPlNames?: string[];
}): FilingApplyPlan {
  const segmentsPlan = planSegments(args);
  const segmentPlPatch = planSegmentPL(args);
  const profilePatch: FilingApplyPlan['profilePatch'] = {};
  const profileApplied: ProfileKey[] = [];
  const profileSkipped: FilingApplyPlan['profileSkipped'] = [];
  for (const key of PROFILE_KEYS) {
    if (!args.selectedProfile.includes(key)) continue;
    const value = candidateValueOf(args.candidate, key);
    if (value === undefined) {
      profileSkipped.push({ key, reason: 'no_candidate' });
      continue;
    }
    const filled = key === 'isListed' ? args.current.isListed === true : !isEmpty(args.current[key]);
    if (filled && !args.overwriteProfile.includes(key)) {
      profileSkipped.push({ key, reason: 'already_filled' });
      continue;
    }
    profilePatch[key] = key === 'employees' ? String(value) : (value as string | boolean);
    profileApplied.push(key);
  }

  const rows = new Map<number, CurrentFinanceRow>();
  for (const r of args.currentFinance) rows.set(r.year, { ...r });
  const financeApplied: FilingApplyPlan['financeApplied'] = [];
  const financeSkipped: FilingApplyPlan['financeSkipped'] = [];
  for (const y of args.candidate.finance) {
    if (!args.selectedYears.includes(y.year)) continue;
    const row: CurrentFinanceRow = rows.get(y.year) ?? { year: y.year };
    const keys: FinanceKey[] = [];
    for (const k of FINANCE_KEYS) {
      const cand = y[k];
      if (!cand) {
        financeSkipped.push({ year: y.year, key: k, reason: 'no_candidate' });
        continue;
      }
      const existing = row[k];
      if (existing !== undefined && existing !== null) {
        if (existing === cand.value) {
          financeSkipped.push({ year: y.year, key: k, reason: 'same_value' });
          continue;
        }
        if (!args.overwriteYears.includes(y.year)) {
          financeSkipped.push({ year: y.year, key: k, reason: 'already_filled' });
          continue;
        }
      }
      row[k] = cand.value;
      keys.push(k);
    }
    if (keys.length > 0) {
      rows.set(y.year, row);
      financeApplied.push({ year: y.year, keys });
    }
  }

  return {
    segmentsPatch: segmentsPlan.patch,
    segmentsSkipped: segmentsPlan.skipped,
    segmentPlPatch,
    profilePatch,
    profileApplied,
    profileSkipped,
    financeRows: [...rows.values()].sort((a, b) => a.year - b.year),
    financeApplied,
    financeSkipped,
  };
}

/** 事業別PLの年度ごとの値を、登録中の行に反映する。値が違う年度は、上書きを選んだ年度だけ変える */
function planSegmentPL(args: {
  candidate: ApplicableCandidate;
  currentSegmentPL?: Record<string, Array<{ year: number } & Record<string, unknown>>>;
  segmentPlNames?: string[];
  overwriteYears: number[];
}): SegmentPLPatch | null {
  const names = args.segmentPlNames ?? [];
  const patch: SegmentPLPatch = {};
  for (const item of args.candidate.segments?.items ?? []) {
    if (!item.name || !names.includes(item.name)) continue;
    const rows = new Map<number, Record<string, unknown> & { year: number }>();
    for (const r of args.currentSegmentPL?.[item.name] ?? []) rows.set(r.year, { ...r });
    let changed = false;
    for (const y of item.byYear ?? []) {
      const row = rows.get(y.year) ?? { year: y.year };
      const values: Array<['revenue' | 'operatingIncome', number | undefined]> = [
        ['revenue', y.sales],
        ['operatingIncome', y.operatingIncome],
      ];
      for (const [k, v] of values) {
        if (v === undefined) continue;
        const existing = row[k];
        if (typeof existing === 'number') {
          if (existing === v) continue;
          if (!args.overwriteYears.includes(y.year)) continue;
        }
        row[k] = v;
        changed = true;
      }
      rows.set(y.year, row);
    }
    if (changed) patch[item.name] = [...rows.values()].sort((a, b) => a.year - b.year) as SegmentPLRowPatch[];
  }
  return Object.keys(patch).length > 0 ? patch : null;
}

/** セグメントは、名前が分かるものだけ反映する。売上・利益は百万円（事業部一覧の単位）に換算し、丸めない。既存のセグメントがあれば上書きを選んだ時だけ */
function planSegments(args: { candidate: ApplicableCandidate; selectedSegments?: boolean; overwriteSegments?: boolean; currentSegmentCount?: number }): {
  patch: SegmentPatchItem[] | null;
  skipped: FilingApplyPlan['segmentsSkipped'];
} {
  if (!args.selectedSegments) return { patch: null, skipped: 'not_selected' };
  const items = (args.candidate.segments?.items ?? []).filter((i) => i.name);
  if (items.length === 0) return { patch: null, skipped: 'no_candidate' };
  if ((args.currentSegmentCount ?? 0) > 0 && !args.overwriteSegments) return { patch: null, skipped: 'already_filled' };
  const toMillion = (v: number | undefined) => (v === undefined ? undefined : v / 1_000_000);
  return {
    patch: items.map((i) => ({ name: i.name as string, memberCode: i.memberCode, revenueMillion: toMillion(i.sales), profitMillion: toMillion(i.operatingIncome) })),
    skipped: null,
  };
}
