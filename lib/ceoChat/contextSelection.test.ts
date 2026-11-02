import { selectContextSources, buildSelectedContextBlock } from './contextSelection';
import { MOCK_COMPANY_ROW } from '../../eval/p1b/mockCompany';
import { computeStage1ValueAnalysis } from '@/utils/valueAnalysis';

const STRATEGY_WITH_METRICS = {
  ...MOCK_COMPANY_ROW,
  valueAnalysis: computeStage1ValueAnalysis({
    financePL: MOCK_COMPANY_ROW.financePL,
    financeBS: MOCK_COMPANY_ROW.financeBS,
    pbrManual: MOCK_COMPANY_ROW.pbrManual,
  }).company,
};

describe('質問ごとの企業情報の選択（評価ケース）', () => {
  it.each([
    ['わが社はなぜこの戦略を選んだの？', { rationale: true, finance: false, operation: false, alignment: false, unclear: false }],
    ['社長が一番重視していることは何？', { rationale: true, finance: false, operation: false, alignment: false, unclear: false }],
    ['顧客のどんな課題を解決しようとしている？', { rationale: true, finance: false, operation: false, alignment: false, unclear: false }],
    ['この勝ち筋の根拠は十分なの？', { rationale: true, finance: false, operation: false, alignment: false, unclear: false }],
    ['別の事業の話と混ざっていない？', { rationale: true, finance: false, operation: false, alignment: false, unclear: false }],
    ['わが社のROICはどうなの？', { rationale: false, finance: true, operation: false, alignment: false, unclear: false }],
    ['この画面の使い方を教えて', { rationale: false, finance: false, operation: true, alignment: false, unclear: false }],
    ['どうなってる？', { rationale: false, finance: false, operation: false, alignment: false, unclear: true }],
  ])('%s', (query, expected) => {
    expect(selectContextSources(query)).toEqual(expected);
  });
});

describe('選択された情報のブロック', () => {
  it('戦略の理由の質問では、根拠ブロックを、AIの一般論判定に関係なく入れる', () => {
    const block = buildSelectedContextBlock({
      selection: selectContextSources('わが社はなぜこの戦略を選んだの？'),
      strategy: MOCK_COMPANY_ROW,
      companyDataIncluded: false,
    });
    expect(block).toContain('【戦略の根拠');
    expect(block).toContain('経営者の意図（登録済み）');
  });

  it('業績の質問で、AIプロンプトに財務が無いときは、5指標を入れる', () => {
    const block = buildSelectedContextBlock({
      selection: selectContextSources('わが社のROICはどうなの？'),
      strategy: STRATEGY_WITH_METRICS,
      companyDataIncluded: false,
    });
    expect(block).toContain('③ ROIC（NOPAT÷投下資本）: 10.6%');
    expect(block).not.toContain('【戦略の根拠');
  });

  it('業績の質問で、AIプロンプトに財務が既にあれば、重複して入れない', () => {
    const block = buildSelectedContextBlock({
      selection: selectContextSources('わが社のROICはどうなの？'),
      strategy: MOCK_COMPANY_ROW,
      companyDataIncluded: true,
    });
    expect(block).not.toContain('5指標');
  });

  it('操作だけの質問では、企業の根拠を入れない', () => {
    const block = buildSelectedContextBlock({
      selection: selectContextSources('この画面の使い方を教えて'),
      strategy: MOCK_COMPANY_ROW,
      companyDataIncluded: false,
    });
    expect(block).toBe('');
  });

  it('不明確な質問では、推測せず確認を1つだけ求める指示を入れ、企業情報は入れない', () => {
    const block = buildSelectedContextBlock({
      selection: selectContextSources('どうなってる？'),
      strategy: MOCK_COMPANY_ROW,
      companyDataIncluded: false,
    });
    expect(block).toContain('確認の質問を1つだけ');
    expect(block).not.toContain('【戦略の根拠');
  });
});
