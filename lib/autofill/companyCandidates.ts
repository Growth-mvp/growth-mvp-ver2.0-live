/* 上場企業の基本情報の入力候補（PHASE 5A）。公開資料の書類情報から候補を作り、反映する項目を承認の内容だけに限る。
 * 取得できない項目は候補に含めない（推測で補わない）。書類に無い情報（連結・単体、通貨の単位）は「未確認」と示す。 */

export type Consolidation = 'CONSOLIDATED' | 'NON_CONSOLIDATED' | 'UNKNOWN';

export type EdinetDocument = {
  docId: string;
  secCode: string | null;
  edinetCode: string | null;
  filerName: string;
  docTypeCode: string | null;
  docDescription: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  submitDate: string | null;
  withdrawn: boolean;
};

export type SourceRef = {
  source: 'EDINET';
  docId: string;
  docTypeCode: string | null;
  periodEnd: string | null;
  fetchedAt: string;
};

export type FieldCandidate<T> = {
  value: T;
  source: SourceRef;
  fiscalYear: number | null;
  consolidation: Consolidation;
};

export type ProfileFieldKey = 'companyName' | 'ticker' | 'fiscalYearEnd' | 'isListed';

export type CompanyProfileCandidate = {
  fields: Partial<{
    companyName: FieldCandidate<string>;
    ticker: FieldCandidate<string>;
    fiscalYearEnd: FieldCandidate<string>;
    isListed: FieldCandidate<boolean>;
  }>;
  issues: string[];
};

export type CurrentProfile = {
  companyName: string;
  ticker: string;
  fiscalYearEnd: string;
  isListed: boolean | undefined;
};

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

/** EDINETの証券コード（5桁、末尾は0）を、東証の証券コード（4桁）に直す。対応できない形式は null */
export function tickerOfSecCode(secCode: string | null): string | null {
  if (!secCode) return null;
  const s = secCode.trim();
  if (/^\d{4}$/.test(s)) return s;
  if (/^\d{5}$/.test(s) && s.endsWith('0')) return s.slice(0, 4);
  return null;
}

export function candidateFromDocument(doc: EdinetDocument, fetchedAt: string): CompanyProfileCandidate {
  const issues: string[] = [];
  const fields: CompanyProfileCandidate['fields'] = {};
  const source: SourceRef = {
    source: 'EDINET',
    docId: doc.docId,
    docTypeCode: doc.docTypeCode,
    periodEnd: doc.periodEnd,
    fetchedAt,
  };
  const consolidation: Consolidation = 'UNKNOWN';

  if (doc.filerName.trim()) {
    fields.companyName = { value: doc.filerName.trim(), source, fiscalYear: null, consolidation };
  } else {
    issues.push('提出者名が取得できませんでした（会社名は未入力のまま）');
  }

  const ticker = tickerOfSecCode(doc.secCode);
  if (ticker) {
    fields.ticker = { value: ticker, source, fiscalYear: null, consolidation };
    fields.isListed = { value: true, source, fiscalYear: null, consolidation };
  } else {
    issues.push('証券コードが取得できない、または形式が違うため、上場情報は未入力のまま');
  }

  const match = doc.periodEnd ? DATE_PATTERN.exec(doc.periodEnd) : null;
  const month = match ? Number(match[2]) : NaN;
  if (match && month >= 1 && month <= 12) {
    fields.fiscalYearEnd = {
      value: String(month),
      source,
      fiscalYear: Number(match[1]),
      consolidation,
    };
  } else {
    issues.push('決算期末（期間の終わり）が取得できず、決算月は未入力のまま');
  }

  issues.push('連結・単体は提出書類の情報からは確認できていません（未確認として扱う）');
  return { fields, issues };
}

export type ApplyPlan = {
  patch: Partial<Record<ProfileFieldKey, string | boolean>>;
  applied: ProfileFieldKey[];
  skipped: Array<{ key: ProfileFieldKey; reason: 'already_filled' | 'no_candidate' }>;
};

const KEYS: ProfileFieldKey[] = ['companyName', 'ticker', 'fiscalYearEnd', 'isListed'];

function isFilled(key: ProfileFieldKey, current: CurrentProfile): boolean {
  if (key === 'isListed') return current.isListed === true;
  return current[key].trim() !== '';
}

/** 承認された項目だけを反映する計画を作る。既に入力済みの項目は、利用者が上書きを選んだ時だけ反映する */
export function planApply(args: {
  current: CurrentProfile;
  candidate: CompanyProfileCandidate;
  selected: ProfileFieldKey[];
  overwrite: ProfileFieldKey[];
}): ApplyPlan {
  const patch: ApplyPlan['patch'] = {};
  const applied: ProfileFieldKey[] = [];
  const skipped: ApplyPlan['skipped'] = [];
  for (const key of KEYS) {
    if (!args.selected.includes(key)) continue;
    const field = args.candidate.fields[key];
    if (!field) {
      skipped.push({ key, reason: 'no_candidate' });
      continue;
    }
    if (isFilled(key, args.current) && !args.overwrite.includes(key)) {
      skipped.push({ key, reason: 'already_filled' });
      continue;
    }
    patch[key] = field.value as string | boolean;
    applied.push(key);
  }
  return { patch, applied, skipped };
}

export const PROFILE_FIELD_LABEL: Record<ProfileFieldKey, string> = {
  companyName: '会社名',
  ticker: '証券コード',
  fiscalYearEnd: '決算月',
  isListed: '上場区分',
};
