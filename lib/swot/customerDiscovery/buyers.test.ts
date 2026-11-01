import { extractBuyers, normalizeBuyerKey } from './buyers';

/** 丹青社の STAGE1 の顧客欄（読み取り専用で取得した実データ） */
const TANSEI_SEGMENTS = [
  { name: '商業その他施設事業', keyCustomers: ['商業施設事業者、ホテル・不動産事業者、エンターテインメント事業者'] },
  {
    name: 'チェーンストア事業',
    keyCustomers: ['外食チェーン、アパレルチェーン、コンビニエンスストア、食品スーパー、生活雑貨、スポーツ・アウトドア等の多店舗企業'],
  },
  { name: '文化施設事業', keyCustomers: ['国・地方自治体、博物館・美術館等の運営主体、教育・文化関連団体、企業'] },
  { name: 'その他', keyCustomers: ['丹青社グループ、法人顧客等'] },
];
const TANSEI_NAME = '株式会社　丹青社';

describe('購入者抽出（実データ）', () => {
  it('実在の購入者を事業をまたいで取り出し、社内組織と具体性のない表記を除く', () => {
    const r = extractBuyers(TANSEI_SEGMENTS, TANSEI_NAME);
    expect(r.status).toBe('ok');
    if (r.status !== 'ok') return;
    expect(r.buyers.map((b) => b.label)).toEqual([
      '商業施設事業者',
      'ホテル・不動産事業者',
      'エンターテインメント事業者',
      '外食チェーン',
      'アパレルチェーン',
      'コンビニエンスストア',
      '食品スーパー',
      '生活雑貨',
      'スポーツ・アウトドア等の多店舗企業',
      '国・地方自治体',
      '博物館・美術館等の運営主体',
      '教育・文化関連団体',
    ]);
    expect(r.buyers.map((b) => b.ref)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    expect(r.excluded).toEqual([
      { label: '企業', segment: '文化施設事業', reason: 'generic' },
      { label: '丹青社グループ', segment: 'その他', reason: 'internal' },
      { label: '法人顧客等', segment: 'その他', reason: 'generic' },
    ]);
  });

  it('「・」を含む実在の購入者（ホテル・不動産事業者など）を分割しない', () => {
    const r = extractBuyers(TANSEI_SEGMENTS, TANSEI_NAME);
    if (r.status !== 'ok') throw new Error('unexpected');
    expect(r.buyers.some((b) => b.label === 'ホテル・不動産事業者')).toBe(true);
    expect(r.buyers.some((b) => b.label === 'ホテル')).toBe(false);
  });

  it('社内組織は、「グループ」の語ではなく会社名で判定する', () => {
    const r = extractBuyers(
      [
        { name: 'A', keyCustomers: ['丹青社の関連会社、医療グループ'] },
      ],
      TANSEI_NAME
    );
    if (r.status !== 'ok') throw new Error('unexpected');
    expect(r.buyers.map((b) => b.label)).toEqual(['医療グループ']);
    expect(r.excluded).toEqual([{ label: '丹青社の関連会社', segment: 'A', reason: 'internal' }]);
  });

  it('会社名が無いときは抽出しない（不明として扱う）', () => {
    expect(extractBuyers(TANSEI_SEGMENTS, undefined)).toEqual({ status: 'no_company_name', buyers: [], excluded: [] });
    expect(extractBuyers(TANSEI_SEGMENTS, '  ')).toEqual({ status: 'no_company_name', buyers: [], excluded: [] });
  });

  it('同じ表記は1人に統合し、どの事業から来たかを残す（空の表記は除く）', () => {
    const r = extractBuyers(
      [
        { name: '事業1', keyCustomers: ['自治体、 、  教育機関'] },
        { name: '事業2', keyCustomers: ['自治体等'] },
      ],
      TANSEI_NAME
    );
    if (r.status !== 'ok') throw new Error('unexpected');
    expect(r.buyers).toEqual([
      { ref: 1, label: '自治体', segments: ['事業1', '事業2'] },
      { ref: 2, label: '教育機関', segments: ['事業1'] },
    ]);
    expect(r.excluded).toEqual([{ label: '', segment: '事業1', reason: 'empty' }]);
  });

  it('購入者が無い事業は何も作らない', () => {
    const r = extractBuyers([{ name: 'X', keyCustomers: [] }], TANSEI_NAME);
    expect(r).toEqual({ status: 'ok', buyers: [], excluded: [] });
  });

  it('比較用の表記は、株式会社・空白・末尾の「等」を除く', () => {
    expect(normalizeBuyerKey('株式会社　丹青社')).toBe('丹青社');
    expect(normalizeBuyerKey('法人顧客等')).toBe('法人顧客');
  });
});
