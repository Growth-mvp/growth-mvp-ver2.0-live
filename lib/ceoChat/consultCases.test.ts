import {
  selectContextSources,
  hasCompanyReference,
  isGeneralKnowledgeQuestion,
} from './contextSelection';

describe('評価の10問で選ばれる企業情報（経営相談）', () => {
  it.each([
    ['なぜ当社の利益は伸びないのか？', { finance: true, rationale: true, alignment: false }],
    ['今の経営戦略で3年後に成長できるか？', { finance: false, rationale: true, alignment: false }],
    ['新規事業に参入すべきか？', { finance: false, rationale: true, alignment: false }],
    ['営業部門の活動は全社戦略と整合しているか？', { finance: false, rationale: true, alignment: true }],
    ['営業部と製造部の対立をどう解消すべきか？', { finance: false, rationale: true, alignment: true }],
    ['人材採用と設備投資のどちらを優先すべきか？', { finance: true, rationale: true, alignment: false }],
    ['資金繰りが厳しくなったらどうすべきか？', { finance: true, rationale: false, alignment: false }],
    ['この事業から撤退すべきか？', { finance: false, rationale: true, alignment: false }],
    ['来月から何を変えれば業績が改善するか？', { finance: true, rationale: false, alignment: false }],
    ['社長が今、最も優先すべきことは何か？', { finance: false, rationale: true, alignment: false }],
  ])('%s', (query, expected) => {
    const s = selectContextSources(query);
    expect({ finance: s.finance, rationale: s.rationale, alignment: s.alignment, operation: s.operation, unclear: s.unclear }).toEqual({
      ...expected,
      operation: false,
      unclear: false,
    });
  });
});

describe('会社への言及の判定', () => {
  it.each([
    ['わが社の業績が伸びない原因は？', true],
    ['当社の利益は？', true],
    ['社長が一番重視していることは何？', true],
    ['営業部と製造部の対立をどう解消すべきか？', false],
  ])('%s → %s', (query, expected) => {
    expect(hasCompanyReference(query)).toBe(expected);
  });
});

describe('一般的な経営知識の質問', () => {
  it.each([
    ['ROICとは何ですか？', true],
    ['M&Aの一般的な進め方は？', true],
    ['当社のROICとは何か？', false],
    ['新規事業に参入すべきか？', false],
    ['人材育成の代表的な手法とは？', true],
    ['リーダーシップの定義とは？', true],
    ['部門間連携の仕組みにはどんな種類がある？', true],
    ['リーダーシップの手法は？', true],
    ['部門間連携の仕組みを改善したい。どうか？', false],
    ['部門間連携を改善するため、経営企画部が共通KPIと定例会議の仕組みを設計しようと考えています。これで部門間の協力関係は改善するでしょうか？', false],
    ['基礎体力を見直すには？', false],
  ])('%s → %s', (query, expected) => {
    expect(isGeneralKnowledgeQuestion(query)).toBe(expected);
  });
});
