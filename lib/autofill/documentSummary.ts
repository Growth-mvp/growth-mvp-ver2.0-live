/* 資料から作った候補のうち、取得できた項目と取得できなかった項目を、利用者向けの言葉にする（AIは使わない）。 */
import type { ApplicableCandidate } from './filingCandidates';

export type DocumentSummary = { obtained: string[]; missing: string[] };

const PL_KEYS = ['revenue', 'operatingIncome', 'netIncome'] as const;
const BS_KEYS = ['totalAssets', 'netAssets', 'cash', 'interestBearingDebt'] as const;

function yearsWith(c: ApplicableCandidate, keys: ReadonlyArray<string>): number[] {
  return c.finance
    .filter((y) => keys.some((k) => (y as unknown as Record<string, unknown>)[k] !== undefined))
    .map((y) => y.year)
    .sort((a, b) => a - b);
}

export function describeDocumentCandidate(c: ApplicableCandidate): DocumentSummary {
  const obtained: string[] = [];
  const missing: string[] = [];

  if (c.profile.fields.companyName) obtained.push('会社名');
  else missing.push('会社名');
  if (c.profile.fields.fiscalYearEnd) obtained.push('決算月');
  else missing.push('決算月');
  if (c.profileExtra.location) obtained.push('所在地');
  else missing.push('所在地');
  if (c.profileExtra.employees) obtained.push('従業員数');
  else missing.push('従業員数');
  if (c.profileExtra.businessContent) obtained.push('事業内容');
  else missing.push('事業内容');
  if (c.profileExtra.industry) obtained.push('業種');
  else missing.push('業種（東証33業種として区分できず）');

  const plYears = yearsWith(c, PL_KEYS);
  if (plYears.length > 0) obtained.push(`全社PL（${plYears.join('・')}年度）`);
  else missing.push('全社PL（売上高・営業利益）');

  const bsYears = yearsWith(c, BS_KEYS);
  if (bsYears.length > 0) {
    obtained.push(`貸借対照表（${bsYears.join('・')}年度）`);
    const missingBs = plYears.filter((y) => !bsYears.includes(y));
    if (missingBs.length > 0) missing.push(`貸借対照表（${missingBs.join('・')}年度は資料になし）`);
  } else {
    missing.push('貸借対照表');
  }

  const segments = c.segments?.items.filter((i) => i.name) ?? [];
  if (segments.length > 0) {
    const withPL = segments.filter((i) => (i.byYear?.length ?? 0) > 0);
    obtained.push(`事業セグメント${segments.length}件`);
    if (withPL.length > 0) obtained.push(`事業別PL（${withPL.length}事業）`);
  } else {
    missing.push('事業セグメント・事業別PL');
  }

  return { obtained, missing };
}
