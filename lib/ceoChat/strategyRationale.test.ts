import { buildStrategyRationaleBlock, selectCanonicalStory, RATIONALE_CHAR_BUDGET } from './strategyRationale';
import { MOCK_COMPANY_ROW, MOCK_EMPTY_ROW } from '../../eval/p1b/mockCompany';

describe('最終ストーリーの正本', () => {
  it('確定版（finalStoryFinal）があれば、古い finalStory より優先する', () => {
    const r = selectCanonicalStory(MOCK_COMPANY_ROW);
    expect(r.status).toBe('confirmed');
    expect(r.chapters[0].title).toBe('危機');
  });

  it('確定版がなければ、下書きとして区別して返す', () => {
    const r = selectCanonicalStory({ finalStory: [{ title: '生成結果', body: 'x' }] });
    expect(r).toEqual({ status: 'draft', chapters: [{ title: '生成結果', body: 'x' }] });
  });

  it('どの版もなければ未作成', () => {
    expect(selectCanonicalStory(MOCK_EMPTY_ROW).status).toBe('none');
  });
});

describe('戦略の根拠ブロック', () => {
  it('12問は質問IDと章を保ち、回答の対応を崩さない', () => {
    const { text } = buildStrategyRationaleBlock(MOCK_COMPANY_ROW);
    expect(text).toContain('- [ch1-q1・第1章] 3〜5年後、お客様や社会はどのように変化し');
    expect(text).toContain('回答: 3〜5年後、中小製造業では設備の保守人材が不足');
    expect(text).toContain('- [ch1-q5] 未入力');
  });

  it('深掘りが元回答に反映済みなら、同じ内容を二重に出さない', () => {
    const { text } = buildStrategyRationaleBlock(MOCK_COMPANY_ROW);
    expect(text.split('現場の点検記録の入力をタブレット化').length - 1).toBe(1);
    expect(text).toContain('（深掘りを元回答に反映済み）');
  });

  it('未反映の深掘りは、元回答には未反映と明示して出す', () => {
    const { text, stats } = buildStrategyRationaleBlock(MOCK_COMPANY_ROW);
    expect(text).toContain('- 未反映の深掘り（ch1-q4）');
    expect(text).toContain('（元の回答には未反映');
    expect(stats.deepDiveUnreflected).toBe(1);
  });

  it('主要な勝ち筋の保存がなければ、選択されたと書かない', () => {
    const { text, stats } = buildStrategyRationaleBlock(MOCK_COMPANY_ROW);
    expect(text).toContain('この項目には正式な採用記録がありません');
    expect(text).not.toContain('勝ち筋の採用記録（保存済み）');
    expect(stats.primarySelected).toBe(false);
  });

  it('保存された主要な勝ち筋があれば、その候補名を出す', () => {
    const { text, stats } = buildStrategyRationaleBlock({ ...MOCK_COMPANY_ROW, winPatternPrimary: 'wp-1' });
    expect(text).toContain('勝ち筋の採用記録（保存済み）: 保守の標準化で選ばれる点検サービス');
    expect(stats.primarySelected).toBe(true);
  });

  it('生成時の根拠が空の勝ち筋は、根拠を補わず「登録なし」と書く', () => {
    const { text } = buildStrategyRationaleBlock(MOCK_COMPANY_ROW);
    expect(text).toContain('部品販売の拡大｜価値ドライバー: 市場評価｜生成時の根拠（AIの説明）: 登録なし');
  });

  it('事業は統合せず、登録事業の名前だけを出す', () => {
    const { text } = buildStrategyRationaleBlock(MOCK_COMPANY_ROW);
    expect(text).toContain('- 登録事業: 点検サービス、部品販売');
    expect(text).toContain('事業をまたいで統合しない');
  });

  it('データがなければ、登録なしと明示し、理由を作らない', () => {
    const { text, stats } = buildStrategyRationaleBlock(MOCK_EMPTY_ROW);
    expect(text).toContain('- 経営者の意図: 登録なし');
    expect(text).toContain('- 最終ストーリー: 未作成');
    expect(stats.answered).toBe(0);
    expect(text).not.toContain('勝ち筋候補（AI生成');
  });

  it('上限を超えるときは項目を丸ごと省略し、省略数を明示する', () => {
    const big = {
      ...MOCK_COMPANY_ROW,
      answers12: MOCK_COMPANY_ROW.answers12.map((a: any) => ({ ...a, answer: a.answer ? 'あ'.repeat(400) : '' })),
    };
    const { text, stats } = buildStrategyRationaleBlock(big, { budget: 1200 });
    expect(text.length).toBeLessThanOrEqual(1200 + 60);
    expect(stats.omitted).toBeGreaterThan(0);
    expect(text).toContain(`（上限のため${stats.omitted}件を省略）`);
    expect(text).toContain('- [ch0-q1・第0章]');
  });

  it('既定の上限は3000文字', () => {
    const { text } = buildStrategyRationaleBlock(MOCK_COMPANY_ROW);
    expect(RATIONALE_CHAR_BUDGET).toBe(3000);
    expect(text.length).toBeLessThanOrEqual(RATIONALE_CHAR_BUDGET);
  });

  it('ストーリー本文はAIプロンプト側にあるときは載せず、状態だけを示す', () => {
    const { text } = buildStrategyRationaleBlock(MOCK_COMPANY_ROW, { storyInAgentPrompt: true });
    expect(text).toContain('最終ストーリーの状態: 確定版（本文は【戦略ストーリー要約】を参照）');
    expect(text).not.toContain('点検の確実さと速さを、地域の中小製造業に届ける');
  });
});
