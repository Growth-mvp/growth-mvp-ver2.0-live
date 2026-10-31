import * as fs from 'fs';
import * as path from 'path';
import { buildSegmentReports, summarizeAdoption } from './diagnostics';
import type { Finding, OtAnalysis, OtItem, WebResult } from './generateOt';
import { MARKET_TAXONOMY, type CompanyMatch, type MarketCategory } from './marketTaxonomy';
import { buildCandidatePool, parseCandidatePool } from './candidatePool';
import { basisOf, toSafeSources } from './suggestionView';

const ROUND3_PATH = path.join('C:', 'Users', 'ishih', 'swot-compare-backup', 'round3-result', 'generate-ot-response.json');
const exists = fs.existsSync(ROUND3_PATH);
const suite = exists ? describe : describe.skip;

/** 保存データの出典番号と公開市場分類の対応。検索の診断（byCategory と各事業の件数）と一致することを下で確認する */
const CATEGORY_BY_SOURCE: Record<number, string | undefined> = {
  1: 'p_metal_can',
  2: 'c_paint_chemical',
  3: 'p_real_estate_leasing',
  4: 'p_can_18l',
  5: 'c_food_maker',
  6: 'p_art_can',
  7: 's_plastic_container',
  8: 'k_environment',
  9: undefined,
};

const category = (id: string): MarketCategory => {
  const c = MARKET_TAXONOMY.find((x) => x.id === id);
  if (!c) throw new Error(`unknown category ${id}`);
  return c;
};

const MATCH: CompanyMatch = {
  segments: [
    {
      rank: 1,
      product: ['p_metal_can', 'p_can_18l', 'p_art_can'].map(category),
      customer: ['c_paint_chemical', 'c_food_maker'].map(category),
    },
    { rank: 2, product: [category('p_real_estate_leasing')], customer: [] },
  ],
  product: [],
  customer: [],
  substitute: [],
  criteria: [],
  unmatchedSegments: 0,
  droppedCategories: 0,
};

suite('第3回の実データによる Phase 0 の再検証（オフライン）', () => {
  const json = exists ? JSON.parse(fs.readFileSync(ROUND3_PATH, 'utf8')) : null;

  const webFromSaved = (): WebResult => {
    const findings: Finding[] = json.sources.map((s: { index: number }) => ({
      theme: '再現',
      statement: '保存データに本文は無いため空の主張を置く',
      sourceIndex: s.index,
      ...(CATEGORY_BY_SOURCE[s.index] ? { categoryId: CATEGORY_BY_SOURCE[s.index] } : {}),
    }));
    return {
      status: 'completed',
      findings,
      sources: json.sources,
      searchCalls: json.meta.webSearch.searchCalls,
      diagnostics: json.meta.webSearch.diagnostics,
    };
  };

  /** 保存された insights は出典チェック後の結果。根拠欄が [3] を示す項目は、チェック前の紐づけが 3 だったとみなす */
  const finalAnalysis = (): OtAnalysis => ({
    opportunities: json.insights.opportunity as OtItem[],
    threats: json.insights.threat as OtItem[],
  });
  const rawAnalysis = (): OtAnalysis => {
    const final = finalAnalysis();
    const opportunities = final.opportunities.map((item) => ({ ...item }));
    const cited = /^\[(\d+)\]/.exec(opportunities[4].evidence);
    if (opportunities[4].sourceIndex === null && cited) opportunities[4].sourceIndex = Number(cited[1]);
    return { opportunities, threats: final.threats };
  };

  it('保存データは、不動産賃貸の事業が not_selected と診断されていた（修正前の現象）', () => {
    expect(json.meta.diagnostics.segments[1]).toMatchObject({ reason: 'not_selected', findings: 1, adoptedOpportunity: 0 });
    expect(json.meta.quality.unlinkedCitations).toBe(1);
  });

  it('保存された検索の件数は、再現に使う分類の対応と一致する', () => {
    const web = webFromSaved();
    const reports = buildSegmentReports(MATCH, web, finalAnalysis(), finalAnalysis());
    expect(reports[0].findings).toBe(json.meta.diagnostics.segments[0].findings);
    expect(reports[1].findings).toBe(json.meta.diagnostics.segments[1].findings);
  });

  it('出典チェック後の結果だけで判定すると、不動産は not_selected ではなく採用の帰属不明になる', () => {
    const reports = buildSegmentReports(MATCH, webFromSaved(), finalAnalysis(), finalAnalysis());
    expect(reports[1].reason).toBe('adoption_unattributed');
  });

  it('AI の元の出典紐づけを使うと、不動産賃貸は採用として数え、紐づけの喪失を診断に残す（Phase 0 の修正）', () => {
    const web = webFromSaved();
    const reports = buildSegmentReports(MATCH, web, rawAnalysis(), finalAnalysis());
    expect(reports[0]).toMatchObject({ reason: 'adopted', adoptedOpportunity: 3, adoptedThreat: 2, unlinkedAdoptions: 0 });
    expect(reports[1]).toMatchObject({ reason: 'adopted', adoptedOpportunity: 1, unlinkedAdoptions: 1 });
    expect(summarizeAdoption(web, rawAnalysis(), finalAnalysis())).toEqual({ adopted: 10, linked: 9, unlinked: 1, unattributed: 1 });
  });

  it('候補の根拠表示は、出典のある項目も本文未確認、出典の無い項目は根拠付き仮説として表示される', () => {
    const sources = toSafeSources(json.sources);
    const opp = finalAnalysis().opportunities;
    expect(basisOf(opp[0], sources)).toEqual({ kind: 'hypothesis_source', index: 1 });
    expect(basisOf(opp[4], sources)).toEqual({ kind: 'hypothesis_rationale' });
    expect(json.sources.every((s: { contentVerified: boolean }) => s.contentVerified === false)).toBe(true);
  });

  it('保存データの候補は、新しい候補一覧に変換でき、紐づけの喪失と本文未確認の状態を残す', () => {
    const pool = buildCandidatePool(json);
    expect(pool.candidates).toHaveLength(10);
    expect(new Set(pool.candidates.map((c) => c.id)).size).toBe(10);
    const linked = pool.candidates.filter((c) => c.sourceLink === 'linked');
    expect(linked).toHaveLength(9);
    expect(linked.every((c) => c.unverified.includes('source_body_not_checked'))).toBe(true);
    const unlinked = pool.candidates.find((c) => c.sourceLink === 'cited_but_unlinked');
    expect(unlinked).toMatchObject({ kind: 'opportunity', grounding: 'hypothesis_with_rationale' });
    expect(unlinked?.text).toContain('東京のオフィス空室率低下');
    expect(parseCandidatePool(JSON.parse(JSON.stringify(pool)))).toEqual(pool);
  });
});
