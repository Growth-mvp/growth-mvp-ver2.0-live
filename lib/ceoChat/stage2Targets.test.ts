import {
  buildStage2TargetBlock,
  isOperatingIncomeLabel,
  isRevenueLabel,
  isStage2TargetQuestion,
  normalizeStage2Targets,
  sanitizeStage2Label,
  STAGE2_UNIT_ALLOWLIST,
  toMillionYenIfMoney,
} from './stage2Targets';

const TARGET_REVENUE = { label: '売上高', unit: '百万円', base: 12000, dueYear: 2030, prioritySimple: 'primary' };
const TARGET_OP = { label: '営業利益', unit: '百万円', base: 50, dueYear: 2030, prioritySimple: 'primary' };

describe('質問の判定（経営目標に関係する質問を広く拾う）', () => {
  it.each([
    'うちの会社はいくら目指すの？',
    '2030年の売上目標は？',
    '営業利益目標は？',
    '売上高',
    '目標を達成できそうか？',
    '現在の売上と目標の差は？',
    '非金額KPIの目標は？',
    'STAGE2に目標が未登録の場合は？',
    '最終的にどこまで伸ばしたいの？',
    '数字でいうと来期の到達点は？',
  ])('%s は目標に関係する', (q) => {
    expect(isStage2TargetQuestion(q)).toBe(true);
  });

  it('経営目標と関係のない質問は対象外にする', () => {
    expect(isStage2TargetQuestion('営業部門の進捗はどうなっているか？')).toBe(false);
  });
});

describe('単位換算（登録単位に従い、金額以外は換算しない）', () => {
  it('百万円はそのまま', () => {
    expect(toMillionYenIfMoney(12000, '百万円')).toBe(12000);
  });
  it('千円は百万円へ換算する', () => {
    expect(toMillionYenIfMoney(12_000_000, '千円')).toBe(12000);
  });
  it('円は百万円へ換算する', () => {
    expect(toMillionYenIfMoney(12_000_000_000, '円')).toBe(12000);
  });
  it('%・件・人・回は金額として換算しない', () => {
    expect(toMillionYenIfMoney(12, '%')).toBeNull();
    expect(toMillionYenIfMoney(3, '件')).toBeNull();
    expect(toMillionYenIfMoney(4, '人')).toBeNull();
    expect(toMillionYenIfMoney(5, '回')).toBeNull();
  });
  it('金額の大きさから推測せず、「千件」のような未知の単位も換算しない', () => {
    expect(toMillionYenIfMoney(12, '億円')).toBeNull();
    expect(toMillionYenIfMoney(12, '千件')).toBeNull();
    expect(toMillionYenIfMoney(12, '')).toBeNull();
  });
});

describe('データ選択（未登録・不正値・件数）', () => {
  it('ラベルや数値が不正な項目は除外する', () => {
    const { rows, total } = normalizeStage2Targets([
      { label: '', base: 1, unit: '百万円' },
      { label: '売上高', base: 'abc', unit: '百万円' },
      TARGET_REVENUE,
    ]);
    expect(rows).toHaveLength(1);
    expect(total).toBe(1);
  });

  it('重要度は保存された prioritySimple だけを使う', () => {
    const { rows } = normalizeStage2Targets([{ ...TARGET_REVENUE, priority: 4 }]);
    expect(rows[0].importance).toBe('主KPI');
    const { rows: none } = normalizeStage2Targets([{ label: 'A', base: 1, unit: '件', priority: 4 }]);
    expect(none[0].importance).toBeNull();
  });

  it('件数は上限を超える分を省略し、その旨を書く', () => {
    const many = Array.from({ length: 8 }, (_, i) => ({ label: `指標${i}`, base: i + 1, unit: '件', dueYear: 2030 }));
    const block = buildStage2TargetBlock({ companyTargets: many, actual: null });
    expect(block).toContain('指標5');
    expect(block).not.toContain('指標6');
    expect(block).toContain('他 2 件は省略');
  });
});

describe('回答用ブロック', () => {
  it('STAGE2の業績目標であることと、STAGE6・STAGE1と区別する旨を明示する', () => {
    const block = buildStage2TargetBlock({ companyTargets: [TARGET_REVENUE], actual: null });
    expect(block).toContain('STAGE2で経営者が設定した目標');
    expect(block).toContain('STAGE6の財務計画の目標・業績見込み・STAGE1の実績とは区別');
  });

  it('金額目標を登録単位のまま、目標年度と重要度つきで示す', () => {
    const block = buildStage2TargetBlock({ companyTargets: [TARGET_REVENUE, TARGET_OP], actual: null });
    expect(block).toContain('"売上高"：12,000 百万円｜目標年度 2030年度｜重要度 主KPI');
    expect(block).toContain('"営業利益"：50 百万円｜目標年度 2030年度｜重要度 主KPI');
  });

  it('千円で登録された金額は百万円換算を併記する', () => {
    const block = buildStage2TargetBlock({
      companyTargets: [{ label: '売上高', unit: '千円', base: 12_000_000, dueYear: 2030, prioritySimple: 'primary' }],
      actual: null,
    });
    expect(block).toContain('"売上高"：12,000,000 千円（百万円換算 12,000 百万円）');
  });

  it('非金額目標は金額換算を付けない', () => {
    const block = buildStage2TargetBlock({
      companyTargets: [{ label: '顧客満足度', unit: '%', base: 85, dueYear: 2030, prioritySimple: 'secondary' }],
      actual: null,
    });
    const line = block.split('\n').find((l) => l.includes('顧客満足度')) ?? '';
    expect(line).toContain('"顧客満足度"：85 %');
    expect(line).not.toContain('百万円換算');
    expect(line).toContain('重要度 副KPI');
  });

  it('正常取得で未登録と確認できる場合は、未登録と書き、数値を出さず推測しないよう指示する', () => {
    const block = buildStage2TargetBlock({ companyTargets: [], actual: null, absenceConfirmed: true });
    expect(block).toContain('未登録です');
    expect(block).toContain('目標値を推測せず');
    expect(block.replace(/STAGE\d/g, '')).not.toMatch(/\d/);
  });

  it('未登録と確認できない場合は、未登録と断定せず確認できないと書く', () => {
    const block = buildStage2TargetBlock({ companyTargets: [], actual: null, absenceConfirmed: false });
    expect(block).not.toContain('未登録です');
    expect(block).not.toContain('登録されていません');
    expect(block).toContain('今回参照した情報では業績目標を確認できません');
    expect(block).toContain('目標値を推測せず');
  });

  it('目標年度と実績年度が同じなら差額を計算する', () => {
    const block = buildStage2TargetBlock({
      companyTargets: [{ label: '売上高', unit: '百万円', base: 1200, dueYear: 2025, prioritySimple: 'primary' }],
      actual: { year: 2025, revenue: 1_000_000_000, operatingIncome: null },
    });
    expect(block).toContain('目標 1,200 百万円 − 実績 1,000 百万円 = 200 百万円');
  });

  it('目標年度と実績年度が違う場合は差額を計算せず、比較不能と明示する', () => {
    const block = buildStage2TargetBlock({
      companyTargets: [TARGET_REVENUE],
      actual: { year: 2025, revenue: 1_000_000_000, operatingIncome: 100_000_000 },
    });
    expect(block).toContain('STAGE1の実績（2025年度）：売上 1,000 百万円｜営業利益 100 百万円');
    expect(block).toContain('目標年度（2030年度）と実績年度（2025年度）が一致しないため、差額は算出していません');
    expect(block).not.toContain('= ');
  });

  it('目標年度が未登録なら差額を計算しない', () => {
    const block = buildStage2TargetBlock({
      companyTargets: [{ label: '売上高', unit: '百万円', base: 1200, prioritySimple: 'primary' }],
      actual: { year: 2025, revenue: 1_000_000_000, operatingIncome: null },
    });
    expect(block).toContain('目標年度 未登録');
    expect(block).not.toContain('= ');
  });

  it('STAGE6の業績見込みは算出していないと明示する', () => {
    const block = buildStage2TargetBlock({ companyTargets: [TARGET_REVENUE], actual: null });
    expect(block).toContain('業績見込み（STAGE6の業績シミュレーション）はこの回答では算出していません');
  });
});
