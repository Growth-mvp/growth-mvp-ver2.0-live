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
};

export type FilingCandidate = {
  filer: { name: string; secCode: string | null; edinetCode: string | null };
  docId: string;
  docTypeCode: string | null;
  periodEnd: string | null;
  fiscalYear: number | null;
  amendedFromDocId: string | null;
  profile: CompanyProfileCandidate;
  profileExtra: Partial<{
    location: FieldCandidate<string>;
    employees: FieldCandidate<number>;
    businessContent: FieldCandidate<string>;
  }>;
  finance: FinanceYearCandidate[];
  issues: string[];
};

export type ProfileKey = 'companyName' | 'ticker' | 'fiscalYearEnd' | 'isListed' | 'location' | 'employees' | 'businessContent';
export type FinanceKey = 'revenue' | 'operatingIncome' | 'netIncome' | 'totalAssets' | 'netAssets';

export const PROFILE_KEYS: ProfileKey[] = ['companyName', 'ticker', 'fiscalYearEnd', 'isListed', 'location', 'employees', 'businessContent'];
export const FINANCE_KEYS: FinanceKey[] = ['revenue', 'operatingIncome', 'netIncome', 'totalAssets', 'netAssets'];

export const PROFILE_LABEL: Record<ProfileKey, string> = {
  companyName: '会社名',
  ticker: '証券コード',
  fiscalYearEnd: '決算月',
  isListed: '上場区分',
  location: '所在地',
  employees: '従業員数',
  businessContent: '事業内容',
};

export const FINANCE_LABEL: Record<FinanceKey, string> = {
  revenue: '売上高',
  operatingIncome: '営業利益',
  netIncome: '親会社株主に帰属する当期純利益',
  totalAssets: '総資産',
  netAssets: '純資産',
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

  const source: SourceRef = { source: 'EDINET', docId: doc.docId, docTypeCode: doc.docTypeCode, periodEnd: doc.periodEnd, fetchedAt };
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
    issues,
  };
}

export type CurrentFilingProfile = Record<ProfileKey, string | boolean | undefined>;
export type CurrentFinanceRow = { year: number } & Partial<Record<FinanceKey, number | null>>;

export type FilingApplyPlan = {
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

function candidateValueOf(c: FilingCandidate, key: ProfileKey): string | boolean | number | undefined {
  if (key === 'companyName') return c.profile.fields.companyName?.value;
  if (key === 'ticker') return c.profile.fields.ticker?.value;
  if (key === 'fiscalYearEnd') return c.profile.fields.fiscalYearEnd?.value;
  if (key === 'isListed') return c.profile.fields.isListed?.value;
  if (key === 'location') return c.profileExtra.location?.value;
  if (key === 'employees') return c.profileExtra.employees?.value;
  return c.profileExtra.businessContent?.value;
}

/** 承認された項目だけを反映する。入力済みの項目は、上書きを選んだ時だけ変える。財務は年度ごとに判断する */
export function planFilingApply(args: {
  current: CurrentFilingProfile;
  currentFinance: CurrentFinanceRow[];
  candidate: FilingCandidate;
  selectedProfile: ProfileKey[];
  overwriteProfile: ProfileKey[];
  selectedYears: number[];
  overwriteYears: number[];
}): FilingApplyPlan {
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
    profilePatch,
    profileApplied,
    profileSkipped,
    financeRows: [...rows.values()].sort((a, b) => a.year - b.year),
    financeApplied,
    financeSkipped,
  };
}
