import { classifyFactEntity, coreCompanyName } from './entity';

const SELF = '日本製罐株式会社';

describe('社名の正規化', () => {
  it('法人格と空白を除き、全角・半角の表記ゆれをそろえる', () => {
    expect(coreCompanyName('日本製罐株式会社')).toBe('日本製罐');
    expect(coreCompanyName('株式会社 日本製罐')).toBe('日本製罐');
    expect(coreCompanyName('（株）日本製罐')).toBe('日本製罐');
    expect(coreCompanyName('㈱日本製罐')).toBe('日本製罐');
    expect(coreCompanyName(undefined)).toBe('');
  });
});

describe('自社の判定', () => {
  it.each([
    '日本製罐の2024年3月期の美術缶売上は前年を上回った。',
    '日本製罐株式会社の美術缶売上は前年を上回った。',
    '株式会社日本製罐の美術缶売上は前年を上回った。',
    '（株）日本製罐は美術缶の需要を伸ばした。',
    '日本製罐（略称）の美術缶売上は増えた。',
  ])('自社として扱う: %s', (text) => {
    expect(classifyFactEntity(text, SELF)).toBe('self');
  });
});

describe('同名・略称・関連会社の取り違え防止', () => {
  it('関連会社（グループ・ホールディングス・子会社）は自社とみなさず、分類不能にする', () => {
    expect(classifyFactEntity('日本製罐グループの海外売上は増えた。', SELF)).toBe('unclassified');
    expect(classifyFactEntity('日本製罐ホールディングスの決算は良好だった。', SELF)).toBe('unclassified');
    expect(classifyFactEntity('日本製罐株式会社の子会社が新工場を建てた。', SELF)).toBe('unclassified');
  });

  it('社名が別の企業の一部になっている場合は、自社とみなさない', () => {
    expect(classifyFactEntity('日本製罐工業株式会社の受注は増えた。', SELF)).toBe('competitor');
    expect(classifyFactEntity('東日本製罐株式会社の美術缶売上は減った。', SELF)).toBe('competitor');
  });

  it('自社名と他社名が同じ文に出る比較は、競合事例として断定しない', () => {
    expect(
      classifyFactEntity('日本製罐株式会社と東洋製罐株式会社の美術缶売上を比べると差が広がった。', SELF)
    ).toBe('unclassified');
  });
});

describe('競合・市場の判定', () => {
  it('社名が明記された他社は競合企業として扱う', () => {
    expect(classifyFactEntity('東洋製罐株式会社は美術缶の受注を伸ばした。', SELF)).toBe('competitor');
    expect(classifyFactEntity('東洋製罐ホールディングスの美術缶事業は拡大した。', SELF)).toBe('competitor');
  });

  it('社名のない一般的な市場の事実は市場として扱う', () => {
    expect(classifyFactEntity('金属缶市場の出荷は横ばいだった。', SELF)).toBe('market');
    expect(classifyFactEntity('大手缶メーカーが生産能力を増やした。', SELF)).toBe('market');
  });

  it('自社名が不明な場合は、自社として判定しない', () => {
    expect(classifyFactEntity('日本製罐の美術缶売上は増えた。', undefined)).toBe('market');
    expect(classifyFactEntity('日本製罐の美術缶売上は増えた。', '')).toBe('market');
  });

  it('1文字の社名では、自社の照合を行わない', () => {
    expect(classifyFactEntity('社の売上は増えた。', '社')).toBe('market');
  });
});
