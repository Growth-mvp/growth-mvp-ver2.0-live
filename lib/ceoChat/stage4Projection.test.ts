import { buildExecutionSummaryBlock } from './stage4Projection';

const SALES_PROJECT = {
  title: '新規顧客開拓',
  ownerName: '佐藤花子',
  planStatus: 'approved',
  valueDriverLinks: ['売上成長'],
  okrsV2: [
    { label: '新規商談数', target: 120, unit: '件', owner: '佐藤花子', due: '2027-03', milestones: [{ title: '提案資料の完成', dueYm: '2026-12' }] },
    { label: '継続率', target: 95, unit: '%', owner: '鈴木一郎', due: '2027-06' },
  ],
  impact: { metricDelta: [{ metric: '受注率', delta: 2, unit: 'pt' }] },
};

const DEPARTMENTS = [
  { name: '製造部', mission: '品質と原価を守る', projects: [{ title: '工程の標準化', ownerName: '田中次郎', okrsV2: [{ label: '不良率', target: 1, unit: '%', owner: '田中次郎', due: '2027-01' }] }] },
  { name: '営業部', mission: '新規と既存の顧客を伸ばす', projects: [SALES_PROJECT] },
];

function lineOf(text: string, needle: string): string {
  const line = text.split('\n').find((l) => l.includes(needle));
  if (!line) throw new Error(`line not found: ${needle}`);
  return line;
}

describe('KR ごとの担当・期限は、そのKRの行にだけ出る', () => {
  it('同じプロジェクトの別のKRの担当・期限と混ざらない', () => {
    const { text } = buildExecutionSummaryBlock(DEPARTMENTS, '');
    const newLine = lineOf(text, 'KR: 新規商談数');
    const retLine = lineOf(text, 'KR: 継続率');
    expect(newLine).toContain('担当 佐藤花子');
    expect(newLine).toContain('期限 2027-03');
    expect(newLine).not.toContain('鈴木一郎');
    expect(retLine).toContain('担当 鈴木一郎');
    expect(retLine).toContain('期限 2027-06');
    expect(retLine).not.toContain('佐藤花子');
  });

  it('目標値と単位、マイルストーンを出す', () => {
    const { text } = buildExecutionSummaryBlock(DEPARTMENTS, '');
    expect(lineOf(text, 'KR: 新規商談数')).toContain('目標 120件');
    expect(lineOf(text, 'KR: 新規商談数')).toContain('マイルストーン 提案資料の完成（2026-12）');
  });
});

describe('値が無い場合は推測せず「未登録」と書く', () => {
  it('KR に担当・期限が無いとき、プロジェクトの担当者を KR の担当として使わない', () => {
    const { text } = buildExecutionSummaryBlock(
      [{ name: '営業部', projects: [{ title: 'P', ownerName: '佐藤花子', okrsV2: [{ label: 'KR1', target: 1, unit: '件' }] }] }],
      ''
    );
    const kr = lineOf(text, 'KR: KR1');
    expect(kr).toContain('担当 未登録');
    expect(kr).toContain('期限 未登録');
    expect(kr).not.toContain('佐藤花子');
  });

  it('プロジェクトの担当・計画状態・価値指標との対応が無いときは未登録', () => {
    const { text } = buildExecutionSummaryBlock([{ name: '営業部', projects: [{ title: 'P' }] }], '');
    expect(text).toContain('プロジェクト: P｜担当 未登録｜計画 未登録｜価値指標との対応（登録）: 未登録');
  });

  it('未知の計画状態は、そのまま出さず未登録にする', () => {
    const { text } = buildExecutionSummaryBlock([{ name: '営業部', projects: [{ title: 'P', planStatus: 'weird' }] }], '');
    expect(text).toContain('計画 未登録');
  });
});

describe('費用・人的投資・承認者IDは出さない', () => {
  it('金額と内部IDを含めない', () => {
    const { text } = buildExecutionSummaryBlock(
      [
        {
          name: '営業部',
          projects: [
            {
              title: 'P',
              ownerUserId: 'uid-secret',
              approvedBy: 'uid-approver',
              humanInvestments: [{ type: 'HIRE', amount: 1200000 }],
              executionHumanInvestments: [{ type: 'TRAINING', amount: 3400000 }],
              impact: { expectedAnnual: { amount: 5600000 }, metricDelta: [{ metric: '受注率', delta: 2, unit: 'pt' }] },
              okrsV2: [{ label: 'KR', target: 1, unit: '件', spend: { amount: 7800000 }, notes: '予算 900万円' }],
            },
          ],
        },
      ],
      ''
    );
    for (const secret of ['uid-secret', 'uid-approver', '1200000', '3400000', '5600000', '7800000', '900万', '予算']) {
      expect(text).not.toContain(secret);
    }
    expect(text).toContain('受注率 +2pt');
  });
});

describe('質問に関連する部門を先に出す', () => {
  it('営業部門の質問では営業部が先になる', () => {
    const { text } = buildExecutionSummaryBlock(DEPARTMENTS, '営業部門は来月何をする予定か？');
    expect(text.indexOf('■ 部門: 営業部')).toBeLessThan(text.indexOf('■ 部門: 製造部'));
  });

  it('関係ない質問では登録順のまま', () => {
    const { text } = buildExecutionSummaryBlock(DEPARTMENTS, '社長が今、最も優先すべきことは何か？');
    expect(text.indexOf('■ 部門: 製造部')).toBeLessThan(text.indexOf('■ 部門: 営業部'));
  });
});

describe('上限を超えたら省略を明示する', () => {
  it('上限の中に収め、省略の件数を書く', () => {
    const many = Array.from({ length: 30 }, (_, i) => ({
      title: `プロジェクト${i}`,
      okrsV2: [{ label: `KR${i}`, target: i, unit: '件', owner: '担当', due: '2027-01' }],
    }));
    const { text, omitted } = buildExecutionSummaryBlock([{ name: '営業部', projects: many }], '', 400);
    expect(omitted).toBeGreaterThan(0);
    expect(text).toContain(`（上限のため${omitted}行を省略）`);
  });
});

describe('空・旧形式', () => {
  it('部門が無いとき', () => {
    expect(buildExecutionSummaryBlock([], '').text).toContain('（部門・プロジェクトなし）');
  });

  it('プロジェクトが無い部門', () => {
    expect(buildExecutionSummaryBlock([{ name: '営業部', projects: [] }], '').text).toContain('（プロジェクトなし）');
  });

  it('okrsV2 が無い旧形式は、目標文と KR 文を出す', () => {
    const { text } = buildExecutionSummaryBlock(
      [{ name: '営業部', projects: [{ title: 'P', okrs: [{ objective: '旧目標', keyResults: ['旧KR'] }] }] }],
      ''
    );
    expect(text).toContain('O: 旧目標 / KR: 旧KR');
  });

  it('ミッションは120字までに切る', () => {
    const { text } = buildExecutionSummaryBlock([{ name: '営業部', mission: 'あ'.repeat(300), projects: [] }], '');
    expect(text).toContain(`（ミッション: ${'あ'.repeat(120)}）`);
  });
});
