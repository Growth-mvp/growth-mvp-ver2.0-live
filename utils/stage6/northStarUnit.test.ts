import {
  buildNorthStarRows,
  formatNorthStarValue,
  isUnsupportedNorthStarUnit,
  mjpyToNorthStarDisplay,
  northStarDisplayUnit,
  northStarValueToMJPY,
  yenToNorthStarDisplay,
} from './compute';
import { unifiedTargetOf } from './financeOutlook';

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

  it('億円の目標は億円として換算する（円として扱うと1億倍の誤差になる）', () => {
    expect(northStarDisplayUnit('億円')).toBe('oku_yen');
    expect(northStarValueToMJPY(1, '億円')).toBe(100);
    expect(northStarValueToMJPY(1.3, '億円')).toBeCloseTo(130, 9);
    expect(northStarValueToMJPY(-0.5, '億円')).toBeCloseTo(-50, 9);
  });

  it('100,000,000円・100百万円・1億円は同じ百万円値になる', () => {
    expect(northStarValueToMJPY(100_000_000, '円')).toBe(100);
    expect(northStarValueToMJPY(100, '百万円')).toBe(100);
    expect(northStarValueToMJPY(1, '億円')).toBe(100);
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

  it('億円の目標は億円の値で表示する', () => {
    expect(mjpyToNorthStarDisplay(130, '億円')).toBeCloseTo(1.3, 9);
    expect(yenToNorthStarDisplay(130_000_000, '億円')).toBeCloseTo(1.3, 9);
    expect(formatNorthStarValue(1.3, '億円')).toBe('1.3 億円');
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

describe('北極星目標: 億円・百万円・円で同じ金額なら同じ達成率になる', () => {
  const yearly = [{ year: 2026, revenue: 1_000_000_000, op_income: 0 }];
  const revenueRowFor = (unit: string, base: number) =>
    buildNorthStarRows({
      companyTargets: [{ id: 't1', label: '売上高', unit, base, dueYear: 2026 }],
      yearlyAll: { base: yearly },
      scenarioKey: 'base',
      projectContrib: [],
    })[0];

  it('13億円・1300百万円・1,300,000,000円は同じ達成率と差額になる', () => {
    const oku = revenueRowFor('億円', 13);
    const million = revenueRowFor('百万円', 1300);
    const yen = revenueRowFor('円', 1_300_000_000);
    expect(oku.unit).toBe('億円');
    expect(oku.achievementRate).toBeCloseTo(million.achievementRate!, 6);
    expect(yen.achievementRate).toBeCloseTo(million.achievementRate!, 6);
    expect(oku.gap).toBeCloseTo(-3, 6);
  });
});

describe('北極星目標: 万円の換算', () => {
  it('1円＝0.000001百万円、1万円＝0.01百万円、1億円＝100百万円、1百万円＝1百万円', () => {
    expect(northStarValueToMJPY(1, '円')).toBeCloseTo(0.000001, 12);
    expect(northStarValueToMJPY(1, '万円')).toBeCloseTo(0.01, 12);
    expect(northStarValueToMJPY(1, '百万円')).toBe(1);
    expect(northStarValueToMJPY(1, '億円')).toBe(100);
  });

  it('万円の換算は、同じ金額の億円・百万円・円と一致する', () => {
    expect(northStarValueToMJPY(10_000, '万円')).toBeCloseTo(northStarValueToMJPY(1, '億円'), 9);
    expect(northStarValueToMJPY(1300, '万円')).toBeCloseTo(13, 9);
    expect(northStarValueToMJPY(130_000_000, '円')).toBeCloseTo(130, 9);
  });

  it('万円の表示単位は万円で、表示文字列も万円になる', () => {
    expect(northStarDisplayUnit('万円')).toBe('man_yen');
    expect(mjpyToNorthStarDisplay(1, '万円')).toBeCloseTo(100, 9);
    expect(formatNorthStarValue(12.5, '万円')).toBe('12.5 万円');
  });
});

describe('北極星目標: 未対応の金額単位は円と推測せず、値を出さない', () => {
  it('金額として確認できない単位は未対応として判定する', () => {
    expect(isUnsupportedNorthStarUnit('米ドル')).toBe(true);
    expect(isUnsupportedNorthStarUnit('千件')).toBe(true);
    expect(isUnsupportedNorthStarUnit('ドル')).toBe(true);
  });

  it('金額・金額以外の既知の単位と、単位が無い値は未対応としない（従来どおり）', () => {
    for (const u of ['円', 'JPY', '¥', '千円', '万円', '百万円', 'MJPY', '億円', '%', '％', '件', '人', '回', '', undefined]) {
      expect(isUnsupportedNorthStarUnit(u)).toBe(false);
    }
  });

  it('未対応の単位は換算・表示の値を返さない（NaN・表示は「—」）', () => {
    expect(northStarValueToMJPY(1, '米ドル')).toBeNaN();
    expect(mjpyToNorthStarDisplay(1, '米ドル')).toBeNaN();
    expect(yenToNorthStarDisplay(1, '米ドル')).toBeNaN();
    expect(formatNorthStarValue(1, '米ドル')).toBe('—');
  });

  it('未対応の単位の目標は、予測・差額・達成率を出さず、目標の値と単位は残す', () => {
    const yearly = [{ year: 2026, revenue: 1_000_000_000, op_income: 0 }];
    const [row] = buildNorthStarRows({
      companyTargets: [{ id: 't1', label: '売上高', unit: '米ドル', base: 13, dueYear: 2026 }],
      yearlyAll: { base: yearly },
      scenarioKey: 'base',
      projectContrib: [],
    });
    expect(row.unit).toBe('米ドル');
    expect(row.base).toBe(13);
    expect(row.forecastValue).toBeUndefined();
    expect(row.gap).toBeUndefined();
    expect(row.achievementRate).toBeUndefined();
  });

  it('財務サマリーの目標は、未対応の単位では円として作らない（未算出）', () => {
    const out = unifiedTargetOf([{ id: 't1', label: '売上高', unit: '米ドル', base: 13, dueYear: 2026 } as any]);
    expect(out.revenueYen).toBeNull();
    const ok = unifiedTargetOf([{ id: 't2', label: '売上高', unit: '万円', base: 13, dueYear: 2026 } as any]);
    expect(ok.revenueYen).toBeCloseTo(130_000, 6);
  });
});

describe('北極星目標: 万円の達成率は、同じ金額の円・億円の目標と一致する', () => {
  it('13万円・130,000円・0.0013億円は同じ達成率になる', () => {
    const yearly = [{ year: 2026, revenue: 1_000_000_000, op_income: 0 }];
    const rowFor = (unit: string, base: number) =>
      buildNorthStarRows({
        companyTargets: [{ id: 't1', label: '売上高', unit, base, dueYear: 2026 }],
        yearlyAll: { base: yearly },
        scenarioKey: 'base',
        projectContrib: [],
      })[0];
    const man = rowFor('万円', 13);
    expect(rowFor('円', 130_000).achievementRate).toBeCloseTo(man.achievementRate!, 6);
    expect(rowFor('億円', 0.0013).achievementRate).toBeCloseTo(man.achievementRate!, 6);
    expect(man.gap).toBeCloseTo(99_987, 6);
  });
});
