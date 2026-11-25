/* 非上場企業の公開情報（企業の公式サイトなど）と、利用者が渡した資料から、承認できる候補を作る（PHASE 5B-2）。
 * 出典（URLと確認日、または資料名）が付いた項目だけを候補にする。推測で補わない。 */
import type { Stage1ImportCandidate } from '@/types/strategy';
import type { DocumentProfile } from '@/utils/stage1/importers/profileExtract';
import { consolidationOfSource, mergeProfiles } from '@/utils/stage1/importers/profileExtract';
import type { FieldCandidate, SourceRef, Consolidation } from './companyCandidates';
import { BUSINESS_CONTENT_MAX, type ApplicableCandidate, type FinanceKey, type FinanceYearCandidate, type SegmentItemCandidate, type SegmentYearCandidate } from './filingCandidates';
import { normalizeCompanyName } from './edinetIdentify';
import { mapEdinetIndustry } from './industryMap';

export type PublicCandidate = ApplicableCandidate & {
  origin: 'WEB' | 'DOCUMENT';
  sources: SourceRef[];
};

export type PublicCandidateResult = { status: 'FOUND'; candidate: PublicCandidate } | { status: 'NOT_CONFIRMED'; message: string };

export type WebFact = { text: string; sources: ReadonlyArray<{ title: string; url: string }> };

const PROFILE_LINE = /^(会社名|所在地|業種|従業員数|事業内容|主要商品・サービス|事業展開地域)\s*[:：]\s*(.+)$/;
const SINGLE_VALUE_LABELS = ['会社名', '所在地', '業種', '従業員数'];
const BUSINESS_LABELS = ['事業内容', '主要商品・サービス', '事業展開地域'] as const;
const FINANCE_SOURCE_KEYS: Record<'companyPL' | 'companyBS', FinanceKey[]> = {
  companyPL: ['revenue', 'operatingIncome', 'netIncome'],
  companyBS: ['totalAssets', 'netAssets', 'cash', 'interestBearingDebt'],
};
const YEN_FACTOR: Readonly<Record<string, number>> = { 円: 1, 千円: 1_000, 百万円: 1_000_000 };
const LOW_CONFIDENCE = 0.7;

function parseEmployees(value: string): number | null {
  const m = /(\d{1,3}(?:,\d{3})+|\d+)\s*(?:名|人)/.exec(value.normalize('NFKC'));
  if (!m) return null;
  const n = Number(m[1].replace(/,/g, ''));
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

function uniqueSources(refs: SourceRef[]): SourceRef[] {
  const seen = new Map<string, SourceRef>();
  for (const r of refs) {
    const key = r.source === 'WEB' ? r.url : r.source === 'DOCUMENT' ? `doc:${r.fileName}` : `edinet:${r.docId}`;
    if (!seen.has(key)) seen.set(key, r);
  }
  return [...seen.values()];
}

/** 公開情報の検索結果（出典つきの行）から、非上場企業の基本情報の候補を作る。会社名が依頼と一致しない時は作らない */
export function buildWebProfileCandidate(args: { query: string; facts: ReadonlyArray<WebFact>; confirmedOn: string }): PublicCandidateResult {
  const picked = new Map<string, { value: string; source: SourceRef }>();
  const conflicts = new Set<string>();
  for (const f of args.facts) {
    const m = PROFILE_LINE.exec(f.text.trim());
    const src = f.sources[0];
    if (!m || !src) continue;
    const label = m[1];
    const value = m[2].trim();
    if (!value) continue;
    const prev = picked.get(label);
    if (!prev) {
      picked.set(label, { value, source: { source: 'WEB', url: src.url, title: src.title, confirmedOn: args.confirmedOn, verified: false } });
    } else if (SINGLE_VALUE_LABELS.includes(label) && prev.value !== value) {
      conflicts.add(label);
    }
  }

  const name = picked.get('会社名');
  if (!name || normalizeCompanyName(name.value) !== normalizeCompanyName(args.query)) {
    return { status: 'NOT_CONFIRMED', message: '公開情報で依頼の会社名を確認できなかったため、候補を作りませんでした。正式な会社名で依頼し直してください。' };
  }

  const issues: string[] = [];
  const profileExtra: ApplicableCandidate['profileExtra'] = {};
  const location = picked.get('所在地');
  if (location) profileExtra.location = { value: location.value, source: location.source, fiscalYear: null, consolidation: 'NOT_APPLICABLE' };

  const employees = picked.get('従業員数');
  if (employees) {
    const n = parseEmployees(employees.value);
    if (n !== null) profileExtra.employees = { value: n, source: employees.source, fiscalYear: null, consolidation: 'UNKNOWN' };
    else issues.push('従業員数は人数として読み取れなかったため、未入力のまま');
  }

  const industry = picked.get('業種');
  if (industry) {
    const mapped = mapEdinetIndustry(industry.value);
    if (mapped.status === 'MAPPED') profileExtra.industry = { value: mapped.value, source: industry.source, fiscalYear: null, consolidation: 'NOT_APPLICABLE' };
    else issues.push(`業種「${industry.value}」はSTAGE1の業種区分に対応付けられなかったため、未入力のまま`);
  }

  const parts = BUSINESS_LABELS.flatMap((label) => {
    const hit = picked.get(label);
    return hit ? [{ label, ...hit }] : [];
  });
  if (parts.length > 0) {
    const text = parts.map((p) => (p.label === '事業内容' ? p.value : `${p.label}：${p.value}`)).join('\n');
    const value = Array.from(text).slice(0, BUSINESS_CONTENT_MAX).join('');
    profileExtra.businessContent = { value, source: parts[0].source, fiscalYear: null, consolidation: 'NOT_APPLICABLE' };
  }

  for (const label of conflicts) issues.push(`${label}の出典どうしで記載が違うため、先頭の出典の値を候補にしました（要確認）`);
  issues.push('上場情報・決算月・財務の数値は公開情報の検索では取得していません（財務は資料の読み込みで取得します）');

  const sources = uniqueSources([...picked.values()].map((p) => p.source));
  return {
    status: 'FOUND',
    candidate: {
      origin: 'WEB',
      filer: { name: name.value, secCode: null, edinetCode: null },
      fiscalYear: null,
      profile: {
        fields: { companyName: { value: name.value, source: name.source, fiscalYear: null, consolidation: 'NOT_APPLICABLE' } },
        issues: [],
      },
      profileExtra,
      finance: [],
      segments: null,
      issues,
      sources,
    },
  };
}

export type DocumentInput = {
  candidates: ReadonlyArray<Stage1ImportCandidate>;
  profiles: ReadonlyArray<DocumentProfile>;
  fetchedAt: string;
};

/** 項目の単位を円に換算する係数。単位表記が無い項目は円と仮定し（承認画面で確認させる）、対応していない単位は null */
function yenFactor(c: Stage1ImportCandidate, field: string): { factor: number; unit: string | null } | null {
  const unit = c.fieldUnits?.[field] ?? c.sheetUnit ?? null;
  if (unit === null) return { factor: 1, unit: null };
  const factor = YEN_FACTOR[unit];
  return factor === undefined ? null : { factor, unit };
}

/** 「資料名（3ページ）」「資料名（シート名）」から、資料名だけを取り出す */
function fileOfWhere(where: string): string {
  return where.replace(/（[^（）]*）$/, '');
}

function docSource(fileName: string, fetchedAt: string): SourceRef {
  return { source: 'DOCUMENT', fileName, periodEnd: null, fetchedAt };
}

/** 資料の読み取り結果から、基本情報・財務（PL・BS）・事業別財務の候補を作る。
 * 単位が確認できた金額は円に換算する。単位表記が無い金額は円と仮定し、承認画面で確認させる。対応していない単位は取り込まない */
export function buildDocumentCandidate(args: DocumentInput): PublicCandidateResult {
  const issues: string[] = [];
  const unitsConverted = new Set<string>();
  const unitsUnsupported = new Set<string>();
  const unitsUnconfirmed = new Set<string>();
  const consolidations = new Set<Consolidation>();

  const money = args.candidates.filter((c) => c.year !== undefined && (c.kind === 'companyPL' || c.kind === 'companyBS'));
  const byYear = new Map<number, FinanceYearCandidate>();
  const sources: SourceRef[] = [];
  let conflicted = false;
  for (const c of money) {
    const year = c.year as number;
    const fileName = c.source ?? '資料';
    const ref = docSource(fileName, args.fetchedAt);
    const consolidation = consolidationOfSource(c.source);
    consolidations.add(consolidation);
    const row = byYear.get(year) ?? { year };
    let used = false;
    for (const k of FINANCE_SOURCE_KEYS[c.kind as 'companyPL' | 'companyBS']) {
      const v = c.fields[k];
      if (typeof v !== 'number' || !Number.isFinite(v)) continue;
      const f = yenFactor(c, k);
      if (f === null) {
        unitsUnsupported.add(c.fieldUnits?.[k] ?? c.sheetUnit ?? '');
        continue;
      }
      if (f.unit === null) unitsUnconfirmed.add(fileName);
      else if (f.unit !== '円') unitsConverted.add(`${fileName}（${f.unit}→円）`);
      if (row[k] !== undefined) {
        conflicted = true;
        continue;
      }
      const cand: FieldCandidate<number> = { value: Math.round(v * f.factor), source: ref, fiscalYear: year, consolidation };
      row[k] = cand;
      used = true;
    }
    if (used) {
      byYear.set(year, row);
      sources.push(ref);
    }
  }
  const finance = [...byYear.values()].sort((a, b) => a.year - b.year);

  const segmentRows = args.candidates.filter((c) => c.kind === 'segmentPL' && c.year !== undefined && c.segmentName);
  const latestSegmentYear = segmentRows.length > 0 ? Math.max(...segmentRows.map((c) => c.year as number)) : null;
  const segmentItems: SegmentItemCandidate[] = [];
  for (const c of segmentRows.filter((r) => r.year === latestSegmentYear)) {
    const name = (c.segmentName as string).trim();
    if (!name || segmentItems.some((s) => s.name === name)) continue;
    const sales = convertField(c, 'revenue', unitsConverted, unitsUnsupported, unitsUnconfirmed);
    const op = convertField(c, 'operatingIncome', unitsConverted, unitsUnsupported, unitsUnconfirmed);
    if (sales === undefined && op === undefined) continue;
    segmentItems.push({ name, memberCode: name, sales, operatingIncome: op });
    sources.push(docSource(c.source ?? '資料', args.fetchedAt));
  }
  for (const item of segmentItems) {
    const byYear: SegmentYearCandidate[] = [];
    for (const c of segmentRows.filter((r) => (r.segmentName as string).trim() === item.name)) {
      const year = c.year as number;
      if (byYear.some((y) => y.year === year)) continue;
      const sales = convertField(c, 'revenue', unitsConverted, unitsUnsupported, unitsUnconfirmed);
      const operatingIncome = convertField(c, 'operatingIncome', unitsConverted, unitsUnsupported, unitsUnconfirmed);
      if (sales === undefined && operatingIncome === undefined) continue;
      byYear.push({ year, sales, operatingIncome });
    }
    item.byYear = byYear.sort((a, b) => a.year - b.year);
  }
  const segments = segmentItems.length > 0 ? { periodEnd: latestSegmentYear === null ? null : String(latestSegmentYear), items: segmentItems, issues: [] } : null;

  const merged = mergeProfiles(args.profiles);
  const profile: ApplicableCandidate['profile'] = { fields: {}, issues: [] };
  const profileExtra: ApplicableCandidate['profileExtra'] = {};
  if (merged.companyName) {
    profile.fields.companyName = {
      value: String(merged.companyName.value),
      source: docSource(merged.companyName.where, args.fetchedAt),
      fiscalYear: null,
      consolidation: 'NOT_APPLICABLE',
    };
  }
  if (merged.fiscalYearEnd) {
    profile.fields.fiscalYearEnd = {
      value: String(merged.fiscalYearEnd.value),
      source: docSource(merged.fiscalYearEnd.where, args.fetchedAt),
      fiscalYear: null,
      consolidation: 'NOT_APPLICABLE',
    };
  }
  if (merged.location) {
    profileExtra.location = { value: String(merged.location.value), source: docSource(merged.location.where, args.fetchedAt), fiscalYear: null, consolidation: 'NOT_APPLICABLE' };
  }
  if (merged.employees) {
    profileExtra.employees = { value: Number(merged.employees.value), source: docSource(merged.employees.where, args.fetchedAt), fiscalYear: null, consolidation: 'UNKNOWN' };
  }
  if (merged.industry) {
    const mapped = mapEdinetIndustry(String(merged.industry.value));
    if (mapped.status === 'MAPPED') profileExtra.industry = { value: mapped.value, source: docSource(merged.industry.where, args.fetchedAt), fiscalYear: null, consolidation: 'NOT_APPLICABLE' };
    else issues.push(`業種「${merged.industry.value}」はSTAGE1の業種区分に対応付けられなかったため、未入力のまま`);
  }
  if (merged.businessContent) {
    profileExtra.businessContent = {
      value: String(merged.businessContent.value),
      source: docSource(merged.businessContent.where, args.fetchedAt),
      fiscalYear: null,
      consolidation: 'NOT_APPLICABLE',
    };
  }
  for (const finding of [merged.companyName, merged.location, merged.employees, merged.businessContent]) {
    if (finding) sources.push(docSource(fileOfWhere(finding.where), args.fetchedAt));
  }

  if (args.candidates.some((c) => c.fields.equity !== undefined)) issues.push('株主資本は純資産と別の項目のため、取り込んでいません（純資産の欄には入れていません）');
  if (unitsUnsupported.size > 0) issues.push(`対応していない単位（${[...unitsUnsupported].filter(Boolean).join('、')}）の金額は取り込んでいません（円・千円・百万円のみ換算します）`);
  if (unitsConverted.size > 0) issues.push(`単位を換算して円で取り込みました：${[...unitsConverted].join('、')}`);
  if (unitsUnconfirmed.size > 0) issues.push(`金額の単位が明示されていない資料（${[...unitsUnconfirmed].join('、')}）は、円単位で記載されていることを承認前に確認してください`);
  if (consolidations.has('UNKNOWN') || consolidations.size === 0) issues.push('連結・単体は資料の名称から判断できないため、未確認として扱う');
  if (consolidations.has('CONSOLIDATED')) issues.push('連結と書かれた取込元の金額は連結として扱う（取込元の名称による）');
  if (consolidations.has('NON_CONSOLIDATED')) issues.push('単体（個別）と書かれた取込元の金額は単体として扱う（取込元の名称による）');
  if (money.some((c) => c.confidence < LOW_CONFIDENCE)) issues.push('一部の数値はPDFの読み取り精度が低いため、取り込み前に資料と照合してください');
  if (conflicted) issues.push('同じ年度の金額が複数の資料にあるため、先に読んだ資料の値を候補にしました（要確認）');
  if (!merged.companyName) issues.push('資料から会社名を読み取れなかったため、会社名は未入力のまま');

  const hasAny = finance.length > 0 || segments !== null || Object.keys(profile.fields).length > 0 || Object.keys(profileExtra).length > 0;
  if (!hasAny) {
    return {
      status: 'NOT_CONFIRMED',
      message: `資料から取り込める内容がありませんでした${unitsUnsupported.size > 0 ? '（対応していない単位が明示されています）' : ''}。`,
    };
  }

  return {
    status: 'FOUND',
    candidate: {
      origin: 'DOCUMENT',
      filer: { name: merged.companyName ? String(merged.companyName.value) : '', secCode: null, edinetCode: null },
      fiscalYear: finance.length > 0 ? finance[finance.length - 1].year : null,
      profile,
      profileExtra,
      finance,
      segments,
      issues: issues.filter(Boolean),
      sources: uniqueSources(sources),
    },
  };
}

function convertField(
  c: Stage1ImportCandidate,
  field: string,
  converted: Set<string>,
  unsupported: Set<string>,
  unconfirmed: Set<string>,
): number | undefined {
  const v = c.fields[field];
  if (typeof v !== 'number' || !Number.isFinite(v)) return undefined;
  const f = yenFactor(c, field);
  if (f === null) {
    unsupported.add(c.fieldUnits?.[field] ?? c.sheetUnit ?? '');
    return undefined;
  }
  const fileName = c.source ?? '資料';
  if (f.unit === null) unconfirmed.add(fileName);
  else if (f.unit !== '円') converted.add(`${fileName}（${f.unit}→円）`);
  return Math.round(v * f.factor);
}
