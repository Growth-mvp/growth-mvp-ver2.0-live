import { buildPlanExportDocument, planDocumentPlainText } from './export/planExportDocument';
import { findNumericNotationIssues, normalizeNumericNotation } from './numericNotation';
import { normalizeApprovalWording } from './approvalWording';

describe('金額の3桁区切りと単位', () => {
  it.each([
    ['130000百万円', '130,000百万円'],
    ['11700百万円', '11,700百万円'],
    ['5993000000円', '5,993,000,000円'],
    ['1234.5百万円', '1,234.5百万円'],
    ['107222000000円', '107,222,000,000円'],
  ])('%s を %s にする', (input, expected) => {
    expect(normalizeNumericNotation(input)).toBe(expected);
  });

  it.each([
    ['¥120M', '120百万円'],
    ['¥250M', '250百万円'],
    ['¥488M', '488百万円'],
    ['¥1,234.5M', '1,234.5百万円'],
  ])('%s を日本語の百万円にする', (input, expected) => {
    expect(normalizeNumericNotation(input)).toBe(expected);
  });

  it('表の中の大きな数値にはカンマを付ける', () => {
    expect(normalizeNumericNotation('| 2025年 | 107222000000 | 8358000000 |')).toBe(
      '| 2025年 | 107,222,000,000 | 8,358,000,000 |',
    );
  });

  it('既に正しい表記は変えない', () => {
    for (const text of ['1,234百万円', '120百万円', '1,234.5百万円', '0.0百万円']) {
      expect(normalizeNumericNotation(text)).toBe(text);
    }
  });

  it('負数は符号を保ったまま扱う', () => {
    expect(normalizeNumericNotation('▲4,055.2百万円')).toBe('▲4,055.2百万円');
    expect(normalizeNumericNotation('-4,055.2百万円')).toBe('-4,055.2百万円');
    expect(normalizeNumericNotation('-4055百万円')).toBe('-4,055百万円');
  });
});

describe('誤変換しない表記', () => {
  it.each(['2029年', '18L缶', '200L缶', '20件', '3〜5年', 'PBR1.97倍', 'ROIC18.61%', '0.01倍'])(
    '%s は変えない',
    (text) => {
      expect(normalizeNumericNotation(text)).toBe(text);
    },
  );

  it('比率の全角％は半角の%にそろえ、値は変えない', () => {
    expect(normalizeNumericNotation('-3.01％')).toBe('-3.01%');
    expect(normalizeNumericNotation('ROE 16.9％')).toBe('ROE 16.9%');
  });

  it('年度や管理番号のような数字は金額として扱わない', () => {
    expect(normalizeNumericNotation('管理番号 20261107')).toBe('管理番号 20261107');
    expect(normalizeNumericNotation('2027年3月期')).toBe('2027年3月期');
  });
});

describe('表示の検査', () => {
  it('正規化後に残る問題を検出する', () => {
    expect(findNumericNotationIssues('¥120M')).toHaveLength(1);
    expect(findNumericNotationIssues('売上 107222000000円')).toHaveLength(1);
    expect(findNumericNotationIssues('-3.01％')).toHaveLength(1);
  });

  it('正規化後は問題が残らない', () => {
    const text = normalizeNumericNotation('売上 ¥120M、利益 130000百万円、比率 -3.01％、2029年、▲4,055.2百万円');
    expect(findNumericNotationIssues(text)).toEqual([]);
  });
});

describe('承認状態の表現', () => {
  it('承認を確認できない目標の表現を登録状態の表現にする', () => {
    expect(normalizeApprovalWording('公式な全社売上目標は130,000百万円です。')).toBe(
      '登録された全社売上目標は130,000百万円です。',
    );
    expect(normalizeApprovalWording('正式な全社目標を示します。')).toBe('登録された全社目標を示します。');
    expect(normalizeApprovalWording('会社として決定済みの目標です。')).toBe(
      '登録された目標（承認状態は未確認）です。',
    );
    expect(normalizeApprovalWording('確定した経営計画に基づきます。')).toBe('経営計画に基づきます。');
  });

  it('承認を表す表現を含まない文は変えない', () => {
    const text = '2029年の売上目標は登録されています。承認状態は未確認です。';
    expect(normalizeApprovalWording(text)).toBe(text);
  });
});

/** 表記を取り除いた実数値（カンマ・単位・記号を除く）。値が変わっていないことの確認に使う */
function numericValues(text: string): number[] {
  return [...text.matchAll(/([-−▲△]?)(\d{1,3}(?:,\d{3})+|\d+)(\.\d+)?/g)].map((m) => {
    const sign = m[1] === '-' || m[1] === '−' || m[1] === '▲' || m[1] === '△' ? -1 : 1;
    return sign * Number(`${m[2].replace(/,/g, '')}${m[3] ?? ''}`);
  });
}

describe('数値の実数値・符号の保持', () => {
  it.each([
    '130000百万円、11700百万円',
    '¥120M、¥250M、¥488M',
    '▲4,055.2百万円と-3.01％',
    '107222000000円と8358000000円',
    '| 2025年 | 107222000000 | -5993000000 |',
  ])('%s の実数値が変わらない', (input) => {
    expect(numericValues(normalizeNumericNotation(input))).toEqual(numericValues(input));
  });

  it('単位未確認の実績は円や百万円へ換算しない', () => {
    const row = '| 2025年 | 107222000000 | 8358000000 | 単位未確認 |';
    const out = normalizeNumericNotation(row);
    expect(out).toBe('| 2025年 | 107,222,000,000 | 8,358,000,000 | 単位未確認 |');
    expect(out).not.toContain('百万円');
    expect(out).not.toContain('円');
  });
});

describe('承認状態の表現の保持', () => {
  it.each([
    '承認済みの投資 30.0百万円',
    '承認状態は未確認です。',
    '登録された全社売上目標（承認状態は未確認）',
    '承認未確認の投資 100.0百万円',
  ])('%s は変えない', (text) => {
    expect(normalizeApprovalWording(text)).toBe(text);
  });

  it('承認未確認の情報に承認済みの表現を付けない', () => {
    const out = normalizeApprovalWording('承認未確認の投資 100.0百万円');
    expect(out).not.toContain('承認済み');
  });
});

describe('WordとPDFの文書モデル', () => {
  it('正規化した金額と単位が文書モデルのテキストにも同じ値で残る', () => {
    const markdown = normalizeNumericNotation('2029年の売上は¥130000M、営業利益は11700百万円です。');
    const doc = buildPlanExportDocument({
      audience: 'shareholder',
      companyName: 'テスト株式会社',
      generatedAt: '2026-11-07T00:00:00.000Z',
      markdown,
    });
    const text = planDocumentPlainText(doc);
    expect(text).toContain('130,000百万円');
    expect(text).toContain('11,700百万円');
    expect(text).not.toMatch(/[¥￥]\s*\d+\s*M/);
  });
});
