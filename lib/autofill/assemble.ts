/* 過去の有価証券報告書（決算期ごと）を1つの候補にまとめる。
 * 年度ごとの値は、その年度の報告書の値を基本にする。後の書類の値が、丸め（百万円単位）を超えて違う時は、
 * 修正（再表示）とみなし、新しい書類の値を採用して注意に残す。直近5期だけを対象にする。 */
import type { ExtractedFacts, FiscalYearPoint } from './xbrlFacts';
import type { SegmentExtract } from './segments';
import { mapEdinetIndustry } from './industryMap';
import {
  BUSINESS_CONTENT_MAX,
  BS_FINANCE_KEYS,
  FINANCE_KEYS,
  FINANCE_LABEL,
  type FilingCandidate,
  type FinanceKey,
  type FinanceYearCandidate,
  type ReportRef,
  type SegmentsCandidate,
} from './filingCandidates';
import type { Consolidation, FieldCandidate, SourceRef } from './companyCandidates';

export const CANDIDATE_YEARS = 5;

export type ReportExtract = {
  docId: string;
  docTypeCode: string | null;
  periodEnd: string;
  submitDate: string | null;
  amendedFromDocId: string | null;
  facts: ExtractedFacts;
  segments: SegmentExtract;
};

export type FilerInfo = {
  name: string;
  secCode: string | null;
  edinetCode: string;
  listed: boolean;
  industryName: string | null;
  address: string;
};

/** 百万円単位の表示の丸めで生じる差（円）。これを超える差だけを、修正とみなす */
export const ROUNDING_TOLERANCE_YEN = 1_000_000;

/** 取得した報告書の決算期の月日が、すべて同じか（決算期の変更がないか）。取得する期は2年おきでよい */
function sameFiscalYearEnd(periodEnds: string[]): boolean {
  return periodEnds.every((p) => p.slice(5) === periodEnds[0].slice(5));
}

const METRICS: FinanceKey[] = [...FINANCE_KEYS];

export function buildMultiYearCandidate(args: { filer: FilerInfo; reports: ReportExtract[]; fetchedAt: string }): FilingCandidate {
  const { filer, fetchedAt } = args;
  const reports = [...args.reports].sort((a, b) => b.periodEnd.localeCompare(a.periodEnd));
  if (reports.length === 0) throw new Error('no_reports');
  const latest = reports[0];
  const fy = Number(latest.periodEnd.slice(0, 4));
  const issues: string[] = [];
  const srcOf = (r: ReportExtract): Extract<SourceRef, { source: 'EDINET' }> => ({ source: 'EDINET', docId: r.docId, docTypeCode: r.docTypeCode, periodEnd: r.periodEnd, fetchedAt });
  const latestSrc = srcOf(latest);

  if (!sameFiscalYearEnd(reports.map((r) => r.periodEnd))) {
    issues.push('取得した決算期の月日が報告書ごとに異なる（決算期の変更の可能性。年度の対応を確認）');
  }

  const profile: FilingCandidate['profile'] = { fields: {}, issues: [] };
  const companyName = latest.facts.companyName ?? filer.name;
  profile.fields.companyName = { value: companyName, source: latestSrc, fiscalYear: fy, consolidation: 'NOT_APPLICABLE' };
  if (filer.secCode) profile.fields.ticker = { value: filer.secCode, source: latestSrc, fiscalYear: fy, consolidation: 'NOT_APPLICABLE' };
  profile.fields.isListed = { value: filer.listed, source: latestSrc, fiscalYear: fy, consolidation: 'NOT_APPLICABLE' };
  profile.fields.fiscalYearEnd = { value: String(Number(latest.periodEnd.slice(5, 7))), source: latestSrc, fiscalYear: fy, consolidation: 'NOT_APPLICABLE' };

  const profileExtra: FilingCandidate['profileExtra'] = {};
  const address = latest.facts.address ?? filer.address;
  if (address) profileExtra.location = { value: address, source: latestSrc, fiscalYear: fy, consolidation: 'NOT_APPLICABLE' };
  if (latest.facts.employees !== null) {
    profileExtra.employees = { value: latest.facts.employees, source: latestSrc, fiscalYear: fy, consolidation: 'UNKNOWN' };
  }
  if (latest.facts.businessText) {
    const text = Array.from(latest.facts.businessText.replace(/^[^【]*【事業の内容】\s*/, '')).slice(0, BUSINESS_CONTENT_MAX).join('');
    profileExtra.businessContent = { value: text, source: latestSrc, fiscalYear: fy, consolidation: 'NOT_APPLICABLE' };
  }
  const industry = mapEdinetIndustry(filer.industryName);
  if (industry.status === 'MAPPED') {
    profileExtra.industry = { value: industry.value, source: { ...latestSrc, docId: `EDINETコードリスト（${filer.edinetCode}）`, docTypeCode: null }, fiscalYear: null, consolidation: 'NOT_APPLICABLE' };
    issues.push(`業種：EDINETの提出者業種「${industry.edinetName}」を、業種区分に対応させた（対応表による）`);
  } else {
    issues.push(`業種：EDINETの提出者業種（${industry.edinetName ?? '未設定'}）を、業種区分に対応させられないため未入力のまま`);
  }
  if (latest.facts.exchange) issues.push(`上場市場：${latest.facts.exchange}（候補には含めない）`);

  // 年度ごとの値：最も新しい書類で値がある年度を採る（食い違いは注意に残す）
  const finance = new Map<number, FinanceYearCandidate>();
  const valueOf = (r: ReportExtract, year: number, k: FinanceKey): number | undefined => {
    const table: FiscalYearPoint[] = BS_FINANCE_KEYS.includes(k) ? r.facts.bs : r.facts.pl;
    const p = table.find((x) => x.year === year);
    return p ? (p as unknown as Record<string, number | undefined>)[k] : undefined;
  };
  const years = new Set<number>();
  for (const r of reports) for (const p of [...r.facts.pl, ...r.facts.bs]) years.add(p.year);
  for (const year of [...years].filter((y) => y > fy - CANDIDATE_YEARS).sort((a, b) => a - b)) {
    const entry: FinanceYearCandidate = { year };
    for (const k of METRICS) {
      // 基本はその年度の報告書の値（当期の値）。後の書類の値が丸めを超えて違う時は、修正（再表示）とみなし新しい書類の値を採る
      const own = reports.find((r) => Number(r.periodEnd.slice(0, 4)) === year && valueOf(r, year, k) !== undefined);
      const base = own ?? reports.find((r) => valueOf(r, year, k) !== undefined);
      if (!base) continue;
      let holder = base;
      let value = valueOf(base, year, k) as number;
      for (const other of reports) {
        if (other === base) continue;
        const ov = valueOf(other, year, k);
        if (ov === undefined || Math.abs(ov - value) <= ROUNDING_TOLERANCE_YEN) continue;
        if (other.periodEnd > holder.periodEnd) {
          issues.push(`${year}年度の${FINANCE_LABEL[k]}：${other.docId}の値（${ov}）が${holder.docId}の値（${value}）と異なる（修正（再表示）の可能性）。新しい書類の値を採用`);
          holder = other;
          value = ov;
        } else {
          issues.push(`${year}年度の${FINANCE_LABEL[k]}：${other.docId}の値（${ov}）が${holder.docId}の値（${value}）と異なる（過去の書類との差）。${holder.docId}の値を採用`);
        }
      }
      const cand: FieldCandidate<number> = { value, source: { ...srcOf(holder), periodEnd: String(year) }, fiscalYear: year, consolidation: holder.facts.consolidationConfirmed ? ('CONSOLIDATED' as Consolidation) : ('UNKNOWN' as Consolidation) };
      (entry as unknown as Record<string, FieldCandidate<number>>)[k] = cand;
    }
    if (METRICS.some((k) => (entry as unknown as Record<string, unknown>)[k] !== undefined)) finance.set(year, entry);
  }

  const segments: SegmentsCandidate | null = latest.segments.items.length > 0
    ? {
        periodEnd: latest.segments.periodEnd,
        items: latest.segments.items.map((it, i) => ({
          name: latest.segments.names[i] ?? null,
          memberCode: it.memberCode,
          sales: it.sales,
          operatingIncome: it.operatingIncome,
        })),
        issues: [...latest.segments.issues],
      }
    : null;

  for (const r of reports) for (const t of r.facts.issues) if (!issues.includes(t)) issues.push(t);
  if (latest.amendedFromDocId) issues.push(`訂正報告書（${latest.docId}）の値を採用（元の有価証券報告書 ${latest.amendedFromDocId} より後に提出）`);

  const reportRefs: ReportRef[] = reports.map((r) => ({ docId: r.docId, docTypeCode: r.docTypeCode, periodEnd: r.periodEnd, amendedFromDocId: r.amendedFromDocId }));

  return {
    filer: { name: filer.name, secCode: filer.secCode, edinetCode: filer.edinetCode },
    docId: latest.docId,
    docTypeCode: latest.docTypeCode,
    periodEnd: latest.periodEnd,
    fiscalYear: fy,
    amendedFromDocId: latest.amendedFromDocId,
    profile,
    profileExtra,
    finance: [...finance.values()].sort((a, b) => a.year - b.year),
    segments,
    reports: reportRefs,
    issues,
  };
}
