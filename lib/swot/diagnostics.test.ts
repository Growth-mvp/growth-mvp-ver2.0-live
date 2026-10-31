import { buildSegmentReports, summarizeAdoption } from './diagnostics';
import type { OtAnalysis, OtItem, WebResult } from './generateOt';
import { matchCompanyMarkets } from './marketTaxonomy';

const item = (sourceIndex: number | null, text = 'オフィス需要の変化が収益に影響する可能性がある。'): OtItem => ({
  text,
  basis: 'hypothesis',
  evidence: '前提',
  sourceIndex,
});

const analysis = (opportunities: OtItem[], threats: OtItem[] = []): OtAnalysis => ({ opportunities, threats });

const LEASING_FINDING = {
  theme: '不動産賃貸（オフィス・住宅・店舗の賃貸）',
  statement: '賃貸物件の空室率は都心部で低下した。',
  sourceIndex: 1,
  categoryId: 'p_real_estate_leasing',
};

const web = (diagnostics?: WebResult['diagnostics']): WebResult => ({
  status: 'completed',
  findings: [LEASING_FINDING],
  sources: [{ index: 1, url: 'https://example.com/leasing', title: 'Leasing', retrievedAt: '2026-10-30T00:00:00.000Z' }],
  searchCalls: 1,
  diagnostics,
});

const realEstate = matchCompanyMarkets({
  segments: [{ productTexts: ['不動産賃貸', '賃貸物件'], customerTexts: ['入居者'] }],
});

describe('採否診断（AI の採用と出典の紐づけを分けて数える）', () => {
  it('採用された候補の出典紐づけが外れても、not_selected とせず、紐づけの喪失を残す', () => {
    const selected = analysis([item(1)]);
    const checked = analysis([item(null)]);

    const [seg] = buildSegmentReports(realEstate, web(), selected, checked);

    expect(seg).toMatchObject({ classified: true, reason: 'adopted', adoptedOpportunity: 1, unlinkedAdoptions: 1 });
    expect(summarizeAdoption(web(), selected, checked)).toEqual({ adopted: 1, linked: 0, unlinked: 1, unattributed: 0 });
  });

  it('AI が出典を付けなかった採用候補は not_selected とせず、採用の帰属不明として残す', () => {
    const selected = analysis([item(null)]);

    const [seg] = buildSegmentReports(realEstate, web(), selected, selected);

    expect(seg).toMatchObject({ reason: 'adoption_unattributed', adoptedOpportunity: 0, unlinkedAdoptions: 0 });
    expect(summarizeAdoption(web(), selected, selected)).toEqual({ adopted: 1, linked: 0, unlinked: 0, unattributed: 1 });
  });

  it('採用も上限による除外も無く、検索結果だけがある場合にだけ not_selected とする', () => {
    const none = analysis([]);

    const [seg] = buildSegmentReports(realEstate, web(), none, none);

    expect(seg).toMatchObject({ reason: 'not_selected', adoptedOpportunity: 0, adoptedThreat: 0 });
  });

  it('上限で除外された分があれば、採用が無くても dropped_by_limit とする', () => {
    const none = analysis([]);
    const diagnostics = {
      webSearchCalls: 1,
      toolSources: 1,
      annotations: 4,
      lines: 4,
      attributedLines: 4,
      rejectedLines: 0,
      findings: 1,
      byCategory: { p_real_estate_leasing: { findings: 1, dropped: 2 } },
    };

    const [seg] = buildSegmentReports(realEstate, web(diagnostics), none, none);

    expect(seg).toMatchObject({ reason: 'dropped_by_limit', droppedByLimit: 2 });
  });
});
