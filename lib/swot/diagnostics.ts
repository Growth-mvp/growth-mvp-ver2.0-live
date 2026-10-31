import type { FailureCode, OtAnalysis, OtItem, WebResult } from './generateOt';
import type { CompanyMatch } from './marketTaxonomy';

/** 検索1回ごとの件数と結果。本文・URL・注釈の中身は含めない */
export type CallStat = {
  id: string;
  status: 'ok' | 'failed';
  errorCode: FailureCode | null;
  elapsedMs: number;
  findings: number;
  droppedByLimit: number;
  duplicateLines: number;
  unattributedLines: number;
  rejectedLines: number;
};

export type SegmentReport = {
  rank: number;
  classified: boolean;
  categoryIds: string[];
  findings: number;
  droppedByLimit: number;
  adoptedOpportunity: number;
  adoptedThreat: number;
  unlinkedAdoptions: number;
  reason: 'unclassified' | 'no_market_info' | 'adopted' | 'dropped_by_limit' | 'adoption_unattributed' | 'not_selected';
};

export type AdoptionSummary = {
  adopted: number;
  linked: number;
  unlinked: number;
  unattributed: number;
};

type Adoption = {
  kind: 'opportunity' | 'threat';
  sourceIndex: number | null;
  unlinked: boolean;
};

/**
 * AI が選んだ項目（出典チェック前）と、チェック後に残った出典の紐づけを比べる。
 * 採否は AI の選択で決め、出典の紐づけが外れた項目は別に数える（採用を取り消したことにはしない）。
 */
function adoptionsOf(selected: OtAnalysis, checked: OtAnalysis): Adoption[] {
  const pair = (kind: Adoption['kind'], raw: readonly OtItem[], fixed: readonly OtItem[]): Adoption[] =>
    raw.map((item, i) => ({
      kind,
      sourceIndex: item.sourceIndex,
      unlinked: item.sourceIndex !== null && fixed[i]?.sourceIndex === null,
    }));
  return [
    ...pair('opportunity', selected.opportunities, checked.opportunities),
    ...pair('threat', selected.threats, checked.threats),
  ];
}

function categoriesBySourceOf(web: WebResult): Map<number, Set<string>> {
  const out = new Map<number, Set<string>>();
  for (const f of web.findings) {
    if (!f.categoryId) continue;
    const set = out.get(f.sourceIndex) ?? new Set<string>();
    set.add(f.categoryId);
    out.set(f.sourceIndex, set);
  }
  return out;
}

export function summarizeAdoption(web: WebResult, selected: OtAnalysis, checked: OtAnalysis): AdoptionSummary {
  const categories = categoriesBySourceOf(web);
  const adoptions = adoptionsOf(selected, checked);
  return {
    adopted: adoptions.length,
    linked: adoptions.filter((a) => a.sourceIndex !== null && !a.unlinked).length,
    unlinked: adoptions.filter((a) => a.unlinked).length,
    unattributed: adoptions.filter((a) => !(a.sourceIndex !== null && categories.has(a.sourceIndex))).length,
  };
}

/**
 * 分類された事業ごとの採否を、内部診断として集計する。
 * 採否の理由は文章にせず、取得件数・上限による除外・採用件数から決める（事業名・顧客名は含めない）。
 */
export function buildSegmentReports(
  match: CompanyMatch,
  web: WebResult,
  selected: OtAnalysis,
  checked: OtAnalysis
): SegmentReport[] {
  const categories = categoriesBySourceOf(web);
  const categoriesOf = (a: Adoption): string[] =>
    a.sourceIndex === null ? [] : Array.from(categories.get(a.sourceIndex) ?? []);
  const adoptions = adoptionsOf(selected, checked);
  const unattributed = adoptions.filter((a) => categoriesOf(a).length === 0).length;
  const byCategory = web.diagnostics?.byCategory ?? {};

  return match.segments.map((s) => {
    const categoryIds = [...s.product, ...s.customer].map((c) => c.id);
    const classified = categoryIds.length > 0;
    const findings = web.findings.filter((f) => f.categoryId !== undefined && categoryIds.includes(f.categoryId)).length;
    const droppedByLimit = categoryIds.reduce((n, id) => n + (byCategory[id]?.dropped ?? 0), 0);
    const hits = adoptions.filter((a) => categoriesOf(a).some((id) => categoryIds.includes(id)));
    const adoptedOpportunity = hits.filter((a) => a.kind === 'opportunity').length;
    const adoptedThreat = hits.filter((a) => a.kind === 'threat').length;
    const reason: SegmentReport['reason'] = !classified
      ? 'unclassified'
      : findings === 0
        ? 'no_market_info'
        : hits.length > 0
          ? 'adopted'
          : droppedByLimit > 0
            ? 'dropped_by_limit'
            : unattributed > 0
              ? 'adoption_unattributed'
              : 'not_selected';
    return {
      rank: s.rank,
      classified,
      categoryIds,
      findings,
      droppedByLimit,
      adoptedOpportunity,
      adoptedThreat,
      unlinkedAdoptions: hits.filter((a) => a.unlinked).length,
      reason,
    };
  });
}
