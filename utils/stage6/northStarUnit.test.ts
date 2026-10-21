import {
  buildNorthStarRows,
  formatNorthStarValue,
  mjpyToNorthStarDisplay,
  northStarDisplayUnit,
  northStarValueToMJPY,
  yenToNorthStarDisplay,
} from './compute';

const AMOUNT_YEN = 1_300_000_000;

describe('北極星目標: 同一金額は入力単位によらず同じ百万円値になる', () => {
  it('円・千円・百万円・MJPY の表記で同じ金額（13億円）になる', () => {
    expect(northStarValueToMJPY(1_300_000_000, '円')).toBe(1300);
    expect(northStarValueToMJPY(1_300_000, '千円')).toBe(1300);
    expect(northStarValueToMJPY(1300, '百万円')).toBe(1300);
    expect(northStarValueToMJPY(1300, 'MJPY')).toBe(1300);
    expect(northStarValueToMJPY(1_300_000_000, 'JPY')).toBe(1300);
  });

  it('百万円（MJPY）の目標は値をそのまま返し、既存の結果と完全に一致する', () => {
    for (const v of [0, 0.1, 12.345, 1300, 987654.321]) {
      expect(northStarValueToMJPY(v, '百万円')).toBe(v);
      expect(northStarValueToMJPY(v, 'MJPY')).toBe(v);
      expect(mjpyToNorthStarDisplay(v, '百万円')).toBe(v);
    }
  });

  it('単位が無い値は従来どおり円として扱う（推測で単位を変えない）', () => {
    expect(northStarValueToMJPY(AMOUNT_YEN, undefined)).toBe(1300);
  });

  it('未対応の単位（億円など）は従来どおり円として扱う', () => {
    expect(northStarDisplayUnit('億円')).toBe('yen');
  });
});

describe('北極星目標: 表示単位への逆換算', () => {
  it('千円の目標は千円の値で表示できる', () => {
    expect(mjpyToNorthStarDisplay(1300, '千円')).toBe(1_300_000);
    expect(yenToNorthStarDisplay(AMOUNT_YEN, '千円')).toBe(1_300_000);
  });

  it('百万円・円の表示は従来の値と一致する', () => {
    expect(mjpyToNorthStarDisplay(1300, '百万円')).toBe(1300);
    expect(yenToNorthStarDisplay(AMOUNT_YEN, '円')).toBe(AMOUNT_YEN);
    expect(yenToNorthStarDisplay(AMOUNT_YEN, undefined)).toBe(AMOUNT_YEN);
  });

  it('表示文字列: 千円は千円、百万円は数値のみ、円は ¥ 付き', () => {
    expect(formatNorthStarValue(1_300_000, '千円')).toBe('1,300,000 千円');
    expect(formatNorthStarValue(1300, '百万円')).toBe('1,300');
    expect(formatNorthStarValue(AMOUNT_YEN, '円')).toBe('¥1,300,000,000');
    expect(formatNorthStarValue(null, '千円')).toBe('—');
  });
});

describe('北極星目標: 千円で登録した目標の達成率（buildNorthStarRows）', () => {
  const yearly = [{ year: 2026, revenue: 1_000_000_000, op_income: 0 }];

  function revenueRowFor(unit: string, base: number) {
    const rows = buildNorthStarRows({
      companyTargets: [{ id: 't1', label: '売上高', unit, base, dueYear: 2026 }],
      yearlyAll: { base: yearly },
      scenarioKey: 'base',
      projectContrib: [],
    });
    return rows[0];
  }

  it('千円・百万円・円で同じ目標を登録すると、達成率が一致する', () => {
    const thousand = revenueRowFor('千円', 1_300_000);
    const million = revenueRowFor('百万円', 1300);
    const yen = revenueRowFor('円', AMOUNT_YEN);
    expect(thousand.achievementRate).toBeCloseTo(million.achievementRate!, 6);
    expect(yen.achievementRate).toBeCloseTo(million.achievementRate!, 6);
  });

  it('千円の目標の表示値は千円の単位で、差額（予測 − 目標、不足は負）も千円で返る', () => {
    const row = revenueRowFor('千円', 1_300_000);
    expect(row.unit).toBe('千円');
    expect(row.forecastValue).toBeCloseTo(1_000_000, 6);
    expect(row.gap).toBeCloseTo(-300_000, 6);
  });
});
