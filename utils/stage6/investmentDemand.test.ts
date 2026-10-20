import {
  applyDuplicateDecision,
  applySpendPatch,
  buildInvestmentDemandSummary,
  buildInvestmentItems,
  fiscalYearOf,
  parseFiscalYearEndMonth,
  type InvestmentItem,
} from './investmentDemand';
import { normalizeStrategyData } from '@/utils/supabase/normalize';

/* eslint-disable @typescript-eslint/no-explicit-any */
type AnyDept = any;

const CAPEX_ONE_TIME = { category: 'CAPEX', recurrence: 'ONE_TIME', amountBasis: 'TOTAL' };

function baseDepartments(): AnyDept[] {
  return [
    {
      name: '営業部',
      projects: [
        {
          title: 'A社開拓',
          planStatus: 'approved',
          skillPlans: [
            {
              id: 'sk1',
              skillName: '提案力',
              cost: 3_000_000,
              dueYm: '2026-09',
              spend: { ...CAPEX_ONE_TIME, paymentYm: '2026-04' },
            },
          ],
          executionHumanInvestments: [{ id: 'hi1', type: 'HIRE', amount: 5_000_000, timingYm: '2026-04' }],
        },
      ],
    },
    {
      name: '開発部',
      projects: [
        {
          title: 'SaaS基盤',
          planStatus: 'draft',
          impactInvestmentMJPY: 20,
          impactInvestmentSpend: { category: 'OPEX', recurrence: 'ONE_TIME', amountBasis: 'TOTAL', paymentYm: '2026-05' },
          skillPlans: [{ id: 'sk2', skillName: 'クラウド', cost: 1_000_000 }],
        },
        {
          title: '既存改善',
          planStatus: 'review',
          okrsV2: [
            {
              id: 'kr1',
              kind: 'INVEST',
              label: '改善投資',
              target: 2_000_000,
              unit: 'JPY',
              scope: 'project',
              baseKey: 'invest',
              spend: { category: 'CAPEX', recurrence: 'ONE_TIME', amountBasis: 'TOTAL', paymentYm: '2026-10' },
            },
            { id: 'kr2', kind: 'INVEST', label: '比率指定', target: 0.3, unit: '%', scope: 'project', baseKey: 'invest' },
          ],
        },
      ],
    },
  ];
}

function findItem(items: InvestmentItem[], predicate: (i: InvestmentItem) => boolean): InvestmentItem {
  const found = items.find(predicate);
  if (!found) throw new Error('item not found');
  return found;
}

function roundTrip(departments: AnyDept[]): AnyDept[] {
  const json = JSON.parse(JSON.stringify({ departments }));
  return normalizeStrategyData(json).departments as AnyDept[];
}

describe('支出区分の保存と復元', () => {
  it('支出条件は正規化（DB往復相当）後も保持される', () => {
    const depts = baseDepartments();
    depts[1].projects[0].impactAssumptions = {
      peopleCount: 1,
      durationMonths: 2,
      monthlyCostPerPersonMJPY: 1,
      spend: { category: 'OPEX', recurrence: 'RECURRING', amountBasis: 'TOTAL', startYm: '2026-04', endYm: '2026-05' },
    };
    const restored = roundTrip(depts);

    expect(restored[0].projects[0].skillPlans[0].spend).toEqual(depts[0].projects[0].skillPlans[0].spend);
    expect(restored[0].projects[0].executionHumanInvestments[0].spend).toBeUndefined();
    expect(restored[1].projects[1].okrsV2[0].spend).toEqual(depts[1].projects[1].okrsV2[0].spend);
    expect(restored[1].projects[0].impactInvestmentSpend).toEqual(depts[1].projects[0].impactInvestmentSpend);
    expect(restored[1].projects[0].impactAssumptions.spend).toEqual(depts[1].projects[0].impactAssumptions.spend);
  });

  it('保存・復元の前後で集計結果が変わらない', () => {
    const depts = applySpendPatch(baseDepartments(), buildInvestmentItems(baseDepartments())[0].ref, {
      category: 'OPEX',
    });
    const before = buildInvestmentDemandSummary(depts, '3');
    const after = buildInvestmentDemandSummary(roundTrip(depts), '3');
    expect(after.readyYen).toBe(before.readyYen);
    expect(after.yearly).toEqual(before.yearly);
    expect(after.enteredYen).toBe(before.enteredYen);
  });

  it('既存データに区分が無ければ未分類で、確定集計には含まれない', () => {
    const plain = [
      {
        name: '営業部',
        projects: [{ title: 'p', skillPlans: [{ id: 'a', cost: 1_000_000 }], impactInvestmentMJPY: 2 }],
      },
    ];
    const summary = buildInvestmentDemandSummary(plain as AnyDept, '3');
    expect(summary.items.every((i) => i.category === 'UNCLASSIFIED')).toBe(true);
    expect(summary.readyYen).toBe(0);
    expect(summary.unclassifiedCount).toBe(1);
    expect(summary.basisPendingCount).toBe(1);
    expect(summary.basisPendingYen).toBe(1_000_000);
    expect(summary.candidateYen).toBe(2_000_000);
    expect(summary.enteredYen).toBe(0);
  });
});

describe('一時支出・継続支出の年度別集計', () => {
  it('一時支出は支出月の年度に1回だけ計上される', () => {
    const summary = buildInvestmentDemandSummary(baseDepartments(), '3');
    const skill = findItem(summary.items, (i) => i.label === '提案力');
    expect(skill.ready).toBe(true);
    expect(skill.allocation).toEqual([{ ym: '2026-04', amountYen: 3_000_000 }]);
    expect(summary.yearly).toEqual([{ fiscalYear: 2027, label: '2027年3月期', amountYen: 5_000_000 }]);
    expect(summary.readyYen).toBe(5_000_000);
  });

  it('支出月が無い一時支出は時期未設定として分離する', () => {
    const summary = buildInvestmentDemandSummary(baseDepartments(), '3');
    const human = findItem(summary.items, (i) => i.source === 'HUMAN_INVESTMENT');
    expect(human.scheduleStatus).toBe('MISSING');
    expect(human.ready).toBe(false);
    expect(human.referenceYm).toBe('2026-04');
  });

  it('実行時期（timingYm）は支出月として自動利用しない', () => {
    const depts = [{ name: 'd', projects: [{ title: 'p', executionHumanInvestments: [{ id: 'h', type: 'HIRE', amount: 1_000, timingYm: '2026-04' }] }] }];
    const [item] = buildInvestmentItems(depts as AnyDept);
    expect(item.paymentYm).toBeNull();
    expect(item.allocation).toEqual([]);
  });

  it('継続支出は月額の期間合計を年度ごとに配分する', () => {
    const depts = [
      {
        name: 'd',
        projects: [
          {
            title: 'p',
            skillPlans: [
              {
                id: 's',
                skillName: '月額',
                cost: 100_000,
                spend: { category: 'OPEX', recurrence: 'RECURRING', amountBasis: 'MONTHLY', startYm: '2026-04', endYm: '2027-03' },
              },
            ],
          },
        ],
      },
    ];
    const summary = buildInvestmentDemandSummary(depts as AnyDept, '12');
    expect(summary.readyYen).toBe(1_200_000);
    expect(summary.yearly).toEqual([
      { fiscalYear: 2026, label: '2026年12月期', amountYen: 900_000 },
      { fiscalYear: 2027, label: '2027年12月期', amountYen: 300_000 },
    ]);
  });

  it('年額は期間の月数に応じて按分される', () => {
    const depts = [
      {
        name: 'd',
        projects: [
          {
            title: 'p',
            skillPlans: [
              {
                id: 's',
                cost: 1_200_000,
                spend: { category: 'OPEX', recurrence: 'RECURRING', amountBasis: 'ANNUAL', startYm: '2026-04', endYm: '2026-09' },
              },
            ],
          },
        ],
      },
    ];
    const summary = buildInvestmentDemandSummary(depts as AnyDept, '12');
    expect(summary.readyYen).toBe(600_000);
  });

  it('総額は期間に均等配分し、合計が一致する（端数を含む）', () => {
    const depts = [
      {
        name: 'd',
        projects: [
          {
            title: 'p',
            skillPlans: [
              {
                id: 's',
                cost: 1_000_001,
                spend: { category: 'OPEX', recurrence: 'RECURRING', amountBasis: 'TOTAL', startYm: '2026-01', endYm: '2026-03' },
              },
            ],
          },
        ],
      },
    ];
    const [item] = buildInvestmentItems(depts as AnyDept);
    expect(item.allocation.map((a) => a.amountYen)).toEqual([333_334, 333_334, 333_333]);
    const summary = buildInvestmentDemandSummary(depts as AnyDept, '12');
    expect(summary.yearly.reduce((s, y) => s + y.amountYen, 0)).toBe(summary.readyYen);
  });

  it('終了月が開始月より前の継続支出は確定しない', () => {
    const depts = [
      {
        name: 'd',
        projects: [
          {
            title: 'p',
            skillPlans: [
              {
                id: 's',
                cost: 1_000,
                spend: { category: 'OPEX', recurrence: 'RECURRING', amountBasis: 'TOTAL', startYm: '2026-05', endYm: '2026-04' },
              },
            ],
          },
        ],
      },
    ];
    const [item] = buildInvestmentItems(depts as AnyDept);
    expect(item.scheduleStatus).toBe('INVALID');
    expect(item.ready).toBe(false);
  });

  it('基準（総額・月額・年額）が未確認の場合は確定しない', () => {
    const depts = [
      {
        name: 'd',
        projects: [
          {
            title: 'p',
            skillPlans: [
              { id: 's', cost: 1_000, spend: { category: 'OPEX', recurrence: 'ONE_TIME', paymentYm: '2026-04' } },
            ],
          },
        ],
      },
    ];
    const summary = buildInvestmentDemandSummary(depts as AnyDept, '3');
    expect(summary.readyYen).toBe(0);
    expect(summary.basisPendingYen).toBe(1_000);
  });

  it('一時支出に月額・年額の基準を指定しても確定しない', () => {
    const depts = [
      {
        name: 'd',
        projects: [
          {
            title: 'p',
            skillPlans: [
              { id: 's', cost: 1_000, spend: { category: 'OPEX', recurrence: 'ONE_TIME', amountBasis: 'MONTHLY', paymentYm: '2026-04' } },
            ],
          },
        ],
      },
    ];
    const [item] = buildInvestmentItems(depts as AnyDept);
    expect(item.ready).toBe(false);
  });
});

describe('重複候補の検出と解消', () => {
  it('総額系と個別明細が併存する場合は総額系を重複候補にする', () => {
    const items = buildInvestmentItems(baseDepartments());
    const impact = findItem(items, (i) => i.source === 'IMPACT_INVESTMENT');
    const skill = findItem(items, (i) => i.label === 'クラウド');
    expect(impact.duplicateStatus).toBe('CANDIDATE');
    expect(impact.counted).toBe(false);
    expect(skill.duplicateStatus).toBe('NONE');
  });

  it('金額が一致するだけでは同一支出と判定せず、両方を要確認にする', () => {
    const depts = [
      {
        name: 'd',
        projects: [
          {
            title: 'p',
            skillPlans: [{ id: 'a', skillName: 'A', cost: 500_000 }],
            executionHumanInvestments: [{ id: 'b', type: 'TRAINING', amount: 500_000 }],
          },
        ],
      },
    ];
    const items = buildInvestmentItems(depts as AnyDept);
    expect(items.every((i) => i.duplicateStatus === 'CANDIDATE')).toBe(true);
    expect(items.some((i) => i.duplicateStatus === 'SAME_DUPLICATE')).toBe(false);
  });

  it('同一支出として集計対象を指定すると、除外側は二重計上されない', () => {
    let depts = baseDepartments();
    const impactId = 'IMPACT_INVESTMENT:impact';
    depts = applyDuplicateDecision(depts, 1, 0, impactId, 'SAME_DUPLICATE', 'SKILL_PLAN:sk2');

    const summary = buildInvestmentDemandSummary(depts, '3');
    const impact = findItem(summary.items, (i) => i.itemId === impactId);
    const skill = findItem(summary.items, (i) => i.itemId === 'SKILL_PLAN:sk2');
    expect(impact.duplicateStatus).toBe('SAME_DUPLICATE');
    expect(impact.counted).toBe(false);
    expect(skill.duplicateStatus).toBe('SAME_KEEP');
    expect(summary.candidateYen).toBe(0);
  });

  it('集計対象の明細が未確定のまま重複指定しても除外されず、要確認として残る', () => {
    let depts = baseDepartments();
    depts = applySpendPatch(depts, buildInvestmentItems(depts).find((i) => i.itemId === 'IMPACT_INVESTMENT:impact')!.ref, {
      duplicateReview: { decision: 'SAME_DUPLICATE', sameAsItemId: 'SKILL_PLAN:sk2' },
    });
    const impact = findItem(buildInvestmentItems(depts), (i) => i.source === 'IMPACT_INVESTMENT');
    expect(impact.duplicateStatus).toBe('CANDIDATE');
    expect(impact.counted).toBe(false);
  });

  it('存在しない明細を参照する重複指定は確定しない', () => {
    let depts = baseDepartments();
    depts = applySpendPatch(depts, buildInvestmentItems(depts).find((i) => i.itemId === 'IMPACT_INVESTMENT:impact')!.ref, {
      duplicateReview: { decision: 'SAME_DUPLICATE', sameAsItemId: 'SKILL_PLAN:none' },
    });
    const impact = findItem(buildInvestmentItems(depts), (i) => i.source === 'IMPACT_INVESTMENT');
    expect(impact.duplicateStatus).toBe('CANDIDATE');
  });

  it('重複確認を未確認に戻すと候補に戻り、集計から外れる', () => {
    let depts = baseDepartments();
    depts = applyDuplicateDecision(depts, 1, 0, 'IMPACT_INVESTMENT:impact', 'SAME_DUPLICATE', 'SKILL_PLAN:sk2');
    depts = applyDuplicateDecision(depts, 1, 0, 'IMPACT_INVESTMENT:impact', null);
    const impact = findItem(buildInvestmentItems(depts), (i) => i.source === 'IMPACT_INVESTMENT');
    expect(impact.duplicateStatus).toBe('CANDIDATE');
    expect(impact.counted).toBe(false);
  });

  it('同額でも別支出と判断されれば両方を集計する（誤統合しない）', () => {
    const depts = [
      {
        name: 'd',
        projects: [
          {
            title: 'p',
            skillPlans: [{ id: 'a', skillName: 'A', cost: 500_000, spend: { ...CAPEX_ONE_TIME, paymentYm: '2026-04' } }],
            executionHumanInvestments: [
              { id: 'b', type: 'TRAINING', amount: 500_000, spend: { category: 'OPEX', recurrence: 'ONE_TIME', amountBasis: 'TOTAL', paymentYm: '2026-04' } },
            ],
          },
        ],
      },
    ];
    let result = applyDuplicateDecision(depts as AnyDept, 0, 0, 'SKILL_PLAN:a', 'DIFFERENT');
    result = applyDuplicateDecision(result, 0, 0, 'HUMAN_INVESTMENT:b', 'DIFFERENT');
    const summary = buildInvestmentDemandSummary(result, '3');
    expect(summary.readyCount).toBe(2);
    expect(summary.readyYen).toBe(1_000_000);
  });

  it('同じIDの明細が別プロジェクトにあっても判断は対象プロジェクトだけに作用する', () => {
    const depts = [
      {
        name: 'd',
        projects: [
          { title: 'p1', skillPlans: [{ id: 'same', cost: 1_000 }] },
          { title: 'p2', skillPlans: [{ id: 'same', cost: 2_000 }] },
        ],
      },
    ];
    const result = applyDuplicateDecision(depts as AnyDept, 0, 0, 'SKILL_PLAN:same', 'DIFFERENT');
    expect(result[0].projects[0]?.skillPlans?.[0]?.spend?.duplicateReview?.decision).toBe('DIFFERENT');
    expect(result[0].projects[1]?.skillPlans?.[0]?.spend).toBeUndefined();
  });

  it('期待成果の前提が投資額と同額なら派生値として集計から除外する', () => {
    const depts = [
      {
        name: 'd',
        projects: [
          {
            title: 'p',
            impactInvestmentMJPY: 12,
            impactInvestmentSpend: { category: 'OPEX', recurrence: 'ONE_TIME', amountBasis: 'TOTAL', paymentYm: '2026-04' },
            impactAssumptions: { peopleCount: 2, durationMonths: 3, monthlyCostPerPersonMJPY: 2, externalCostMJPY: 0 },
          },
        ],
      },
    ];
    const items = buildInvestmentItems(depts as AnyDept);
    const assumption = findItem(items, (i) => i.source === 'IMPACT_ASSUMPTION');
    expect(assumption.duplicateStatus).toBe('DERIVED');
    const summary = buildInvestmentDemandSummary(depts as AnyDept, '3');
    expect(summary.enteredYen).toBe(12_000_000);
  });
});

describe('未分類・時期未設定・単位・0と未入力', () => {
  it('分類未確定・時期未設定・単位確認待ちを確定とは別に数える', () => {
    const summary = buildInvestmentDemandSummary(baseDepartments(), '3');
    expect(summary.unclassifiedCount).toBeGreaterThan(0);
    expect(summary.basisPendingCount).toBeGreaterThan(0);
    expect(summary.unitPendingCount).toBe(1);
    expect(findItem(summary.items, (i) => i.label === '比率指定').amountYen).toBeNull();
  });

  it('総額は分かっているが支出月が無い一時支出は時期未設定額に入る', () => {
    const depts = [
      {
        name: 'd',
        projects: [
          {
            title: 'p',
            skillPlans: [{ id: 's', cost: 1_000_000, spend: { category: 'CAPEX', recurrence: 'ONE_TIME', amountBasis: 'TOTAL' } }],
          },
        ],
      },
    ];
    const summary = buildInvestmentDemandSummary(depts as AnyDept, '3');
    expect(summary.unscheduledYen).toBe(1_000_000);
    expect(summary.readyYen).toBe(0);
  });

  it('金額0は0円の項目、未入力は未入力として区別する', () => {
    const depts = [
      {
        name: 'd',
        projects: [{ title: 'p', skillPlans: [{ id: 'z', skillName: 'zero', cost: 0 }, { id: 'e', skillName: 'empty' }] }],
      },
    ];
    const items = buildInvestmentItems(depts as AnyDept);
    expect(findItem(items, (i) => i.label === 'zero').amountStatus).toBe('OK');
    expect(findItem(items, (i) => i.label === 'empty').amountStatus).toBe('MISSING');
  });

  it('負の金額は確定しない', () => {
    const depts = [{ name: 'd', projects: [{ title: 'p', skillPlans: [{ id: 'n', cost: -10, spend: { ...CAPEX_ONE_TIME, paymentYm: '2026-04' } }] }] }];
    const [item] = buildInvestmentItems(depts as AnyDept);
    expect(item.amountStatus).toBe('INVALID');
    expect(item.ready).toBe(false);
  });

  it('期待成果の前提は総額として扱い、単位は円換算する', () => {
    const items = buildInvestmentItems(baseDepartments());
    expect(findItem(items, (i) => i.source === 'IMPACT_INVESTMENT').amountYen).toBe(20_000_000);
    expect(findItem(items, (i) => i.label === '提案力').amountYen).toBe(3_000_000);
  });
});

describe('planStatus（計画状態）の参照', () => {
  it('承認済み以外の投資も集計し、承認済みとは別に表示できる', () => {
    const depts = [
      {
        name: 'd',
        projects: [
          { title: '承認', planStatus: 'approved', skillPlans: [{ id: 'a', cost: 1_000_000, spend: { ...CAPEX_ONE_TIME, paymentYm: '2026-04' } }] },
          { title: '草案', planStatus: 'draft', skillPlans: [{ id: 'b', cost: 2_000_000, spend: { ...CAPEX_ONE_TIME, paymentYm: '2026-04' } }] },
        ],
      },
    ];
    const summary = buildInvestmentDemandSummary(depts as AnyDept, '3');
    expect(summary.approvedReadyYen).toBe(1_000_000);
    expect(summary.unapprovedReadyYen).toBe(2_000_000);
    expect(summary.readyYen).toBe(3_000_000);
  });
});

describe('複数事業・複数プロジェクトの集計', () => {
  it('部門ごとの確定額と年度別合計が一致する', () => {
    const depts = [
      {
        name: '部門A',
        projects: [
          { title: 'p1', skillPlans: [{ id: 'a', cost: 1_000, spend: { ...CAPEX_ONE_TIME, paymentYm: '2026-04' } }] },
          { title: 'p2', skillPlans: [{ id: 'b', cost: 2_000, spend: { ...CAPEX_ONE_TIME, paymentYm: '2027-04' } }] },
        ],
      },
      {
        name: '部門B',
        projects: [{ title: 'p3', skillPlans: [{ id: 'c', cost: 4_000, spend: { ...CAPEX_ONE_TIME, paymentYm: '2026-04' } }] }],
      },
    ];
    const summary = buildInvestmentDemandSummary(depts as AnyDept, '3');
    expect(summary.byDepartment).toEqual([
      { deptName: '部門A', amountYen: 3_000 },
      { deptName: '部門B', amountYen: 4_000 },
    ]);
    expect(summary.yearly.reduce((s, y) => s + y.amountYen, 0)).toBe(summary.readyYen);
  });
});

describe('決算月と年度', () => {
  it('決算月に従って年度を決める', () => {
    expect(fiscalYearOf('2026-03', 3)).toBe(2026);
    expect(fiscalYearOf('2026-04', 3)).toBe(2027);
    expect(parseFiscalYearEndMonth('3')).toBe(3);
    expect(parseFiscalYearEndMonth('2026-03')).toBeNull();
  });

  it('決算月が未設定なら暦年扱いとし、その旨を結果に残す', () => {
    const summary = buildInvestmentDemandSummary(baseDepartments(), undefined);
    expect(summary.fiscalYearEndMonth).toBeNull();
  });
});

describe('入力データの非破壊', () => {
  it('集計と判断の適用で入力データを変更しない', () => {
    const depts = baseDepartments();
    const before = JSON.stringify(depts);
    buildInvestmentDemandSummary(depts, '3');
    applyDuplicateDecision(depts, 1, 0, 'IMPACT_INVESTMENT:impact', 'SAME_DUPLICATE', 'SKILL_PLAN:sk2');
    applySpendPatch(depts, buildInvestmentItems(depts)[0].ref, { category: 'CAPEX' });
    expect(JSON.stringify(depts)).toBe(before);
  });

  it('departments が未定義・空でも例外にならない', () => {
    expect(buildInvestmentItems(undefined)).toEqual([]);
    expect(buildInvestmentDemandSummary(null, '3').readyYen).toBe(0);
    expect(buildInvestmentItems([{ name: 'x', projects: undefined }] as AnyDept)).toEqual([]);
  });
});
