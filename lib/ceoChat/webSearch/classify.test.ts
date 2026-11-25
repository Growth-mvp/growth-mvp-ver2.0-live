import { classifySearchNeed, isExplicitWebSearchRequest } from './classify';

describe('外部検索の判定（A：社内情報だけ → 検索OFF）', () => {
  it.each([
    '当社の戦略の弱点は何か',
    '営業部門の実行計画を評価して',
    '部門間の計画に矛盾はないか',
    '営業利益目標を達成できそうか',
    '当社のKPIの設定は適切か',
    '人事制度の見直しは必要か',
    '業界中央値と比べて当社の利益率は？',
  ])('%s', (q) => {
    expect(classifySearchNeed(q)).toEqual({ category: 'A', searchNeeded: false });
  });
});

describe('外部検索の判定（B：外部情報が必要 → 検索ON）', () => {
  it.each([
    '金属缶市場の最新動向を教えて',
    '主要競合企業はどのような戦略を取っているか',
    '顧客業界の需要は今後拡大するか',
    '最新の法改正が業界に与える影響は何か',
    '最近の技術革新によって新たな事業機会はあるか',
  ])('%s', (q) => {
    expect(classifySearchNeed(q)).toEqual({ category: 'B', searchNeeded: true });
  });
});

describe('外部検索の判定（C：社内情報と外部情報の照合 → 検索ON）', () => {
  it.each([
    '当社の高付加価値化戦略は市場環境から見て妥当か',
    '当社の競争優位性は今後も維持できるか',
    '競合と比較して当社の戦略には何が不足しているか',
    '今後3年間の市場環境を踏まえ、当社の戦略を見直して',
    '当社の戦略は今後も通用するか',
    '最新の法改正が当社に与える影響は何か',
  ])('%s', (q) => {
    expect(classifySearchNeed(q)).toEqual({ category: 'C', searchNeeded: true });
  });
});

describe('外部検索の判定（成長・競争の語で検索ON）', () => {
  it.each([
    '当社の成長機会は何か',
    '当社の事業機会を整理して',
    '当社が新規事業に参入する余地はあるか',
    '当社のライバルに対して何で勝てるか',
  ])('%s', (q) => {
    expect(classifySearchNeed(q).searchNeeded).toBe(true);
  });

  it.each([
    '当社の施策の進捗は',
    '社内のKPIを確認したい',
    '当社の事業計画の進捗を教えて',
  ])('社内のみの質問は検索OFF: %s', (q) => {
    expect(classifySearchNeed(q)).toEqual({ category: 'A', searchNeeded: false });
  });
});

describe('外部検索の判定（語の誤一致の防止）', () => {
  it('英字の AI は、単語の一部（maintain など）に一致しない', () => {
    expect(classifySearchNeed('当社の人員を maintain する計画を見て').category).toBe('A');
  });

  it('空の質問は検索しない', () => {
    expect(classifySearchNeed('')).toEqual({ category: 'A', searchNeeded: false });
  });
});

describe('外部検索の判定（利用者の明示的な検索指示は検索ON）', () => {
  it.each([
    ['WEB検索して、当社の人員計画を整理して', 'C'],
    ['Web検索で当社の採用計画を確認して', 'C'],
    ['インターネット検索で、一般的な研修制度を調べて', 'B'],
    ['外部検索をして、人事評価の事例を教えて', 'B'],
    ['ネットで検索してください。組織の事例を教えて', 'B'],
  ])('%s', (q, category) => {
    expect(classifySearchNeed(q)).toEqual({ category, searchNeeded: true });
    expect(isExplicitWebSearchRequest(q)).toBe(true);
  });

  it('検索の指示の節が、同じ文の能力の質問より優先される', () => {
    expect(classifySearchNeed('市場をWEB検索して、この施策が当社でできるか？').searchNeeded).toBe(true);
  });
});

describe('外部検索の判定（検索機能の能力を尋ねる質問は検索しない）', () => {
  it.each(['あなたはWEB検索できますか？', 'WEB検索はできますか', '外部検索の機能はありますか？', 'インターネットに接続できますか'])(
    '%s',
    (q) => {
      expect(isExplicitWebSearchRequest(q)).toBe(false);
      expect(classifySearchNeed(q)).toEqual({ category: 'A', searchNeeded: false });
    }
  );
});

describe('外部検索の判定（一般質問で外部情報が必要な語）', () => {
  it.each(['物価高の今後の見通しを教えて', '最近の円安は事業にどう影響するか', '業界の統計データはどこで確認できるか'])(
    '%s',
    (q) => {
      expect(classifySearchNeed(q).searchNeeded).toBe(true);
    }
  );
});
