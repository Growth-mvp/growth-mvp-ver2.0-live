import { buildExecutionSummaryBlock } from './stage4Projection';
import { STAGE4_SCALE_FIXTURES, makeFixtureDepts } from '../../eval/quality/stage4ScaleFixture';

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

function makeDepts(nDept: number, nProj: number, nKr: number) {
  return Array.from({ length: nDept }, (_, i) => ({
    name: `部門${String(i).padStart(2, '0')}`,
    mission: `部門${i}のミッション`,
    projects: Array.from({ length: nProj }, (_, j) => ({
      title: `施策${i}-${j}`,
      ownerName: `担当${i}-${j}`,
      planStatus: 'approved',
      valueDriverLinks: ['売上成長'],
      okrsV2: Array.from({ length: nKr }, (_, k) => ({ label: `KPI${i}-${j}-${k}`, target: 100, unit: '件', owner: `担当${i}`, due: '2027-06' })),
    })),
  }));
}

function deptLineCount(text: string): number {
  return text.split('\n').filter((l) => l.startsWith('■ 部門: ')).length;
}

function assertKrNeverOrphaned(text: string) {
  let inProject = false;
  for (const line of text.split('\n')) {
    if (line.startsWith('■ 部門: ')) inProject = false;
    if (line.startsWith('  - プロジェクト: ')) inProject = true;
    if (line.startsWith('    - ')) expect(inProject).toBe(true);
  }
}

describe('充足状況を明示する（件数は省略前の元データから数える）', () => {
  it('全件のときは、全件だと書く', () => {
    const { text, complete, projects, departments } = buildExecutionSummaryBlock(DEPARTMENTS, '');
    expect(complete).toBe(true);
    expect(text).toContain('（充足状況: 部門2件すべて、施策2件すべてを参照。全件）');
    expect(projects).toEqual({ total: 2, shown: 2, withKr: 2 });
    expect(departments).toEqual({ total: 2, shown: 2, detailed: 2 });
  });

  it('小規模（3部門15施策）は、従来どおり全施策の名前を出す', () => {
    const { text, complete } = buildExecutionSummaryBlock(makeDepts(3, 5, 2), '');
    expect(complete).toBe(true);
    for (let i = 0; i < 3; i++) for (let j = 0; j < 5; j++) expect(text).toContain(`プロジェクト: 施策${i}-${j}｜`);
  });

  it('10部門80施策は、全部門の概要を出し、一部のみだと明示する', () => {
    const r = buildExecutionSummaryBlock(makeDepts(10, 8, 3), '全社の部門別の実行状況を教えて');
    expect(r.complete).toBe(false);
    expect(deptLineCount(r.text)).toBe(10);
    expect(r.text).toContain('部門 全10件中10件を参照');
    expect(r.text).toContain('施策 全80件中10件を参照');
    expect(r.text).toContain('施策の詳細は一部のみです');
    expect(r.text).toContain('この制約を結論より前に適用すること');
    expect(r.text.length).toBeLessThanOrEqual(2400);
  });

  it('40部門600施策は、概要の数と部分的な参照数を正しく書く', () => {
    const r = buildExecutionSummaryBlock(makeDepts(40, 15, 4), '');
    expect(deptLineCount(r.text)).toBe(40);
    expect(r.projects.total).toBe(600);
    expect(r.projects.shown).toBeLessThan(600);
    expect(r.text).toContain('施策 全600件中');
    expect(r.text.length).toBeLessThanOrEqual(2400);
  });

  it('概要まで収まらないときは、省略された部門の名前を例示し、残りは件数で示す', () => {
    const r = buildExecutionSummaryBlock(makeDepts(200, 1, 1), '');
    expect(deptLineCount(r.text)).toBeLessThan(200);
    expect(r.text).toContain('概要も省略された部門:');
    expect(r.text).toMatch(/ほか\d+部門/);
    expect(r.text.length).toBeLessThanOrEqual(2400);
  });
});

describe('先頭部門への偏りを減らし、言及された部門を優先する', () => {
  it('全部門に施策の詳細（KR付き）を1つずつ先に配る', () => {
    const r = buildExecutionSummaryBlock(makeDepts(10, 8, 3), '');
    for (let i = 0; i < 10; i++) expect(r.text).toContain(`プロジェクト: 施策${i}-0｜`);
  });

  it('質問に部門名があれば、その部門の施策が出る', () => {
    const r = buildExecutionSummaryBlock(makeDepts(40, 15, 4), '部門39の施策は進んでいるか？');
    expect(r.text).toContain('プロジェクト: 施策39-0｜');
    expect(r.text.indexOf('■ 部門: 部門39')).toBeGreaterThan(-1);
  });
});

describe('部門・施策・KRの対応関係を壊さない', () => {
  it('省略で施策名が消えても、KRだけが残ることはない', () => {
    for (const [nd, np] of [[3, 15], [10, 8], [40, 15]] as const) {
      const { text } = buildExecutionSummaryBlock(makeDepts(nd, np, 4), '');
      assertKrNeverOrphaned(text);
    }
  });

  it('KRを一部だけ表示したときは、施策名と表示件数を書く', () => {
    const many = [{ title: '大きい施策', okrsV2: Array.from({ length: 20 }, (_, i) => ({ label: `KR${i}`, target: i, unit: '件' })) }];
    const { text } = buildExecutionSummaryBlock([{ name: '営業部', projects: many }], '', 600);
    expect(text).toContain('プロジェクト: 大きい施策');
    expect(text).toMatch(/KR20件のうち\d+件を表示/);
    assertKrNeverOrphaned(text);
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

describe('評価フィクスチャの件数・対応関係・単位（規模別）', () => {
  it.each(Object.keys(STAGE4_SCALE_FIXTURES) as Array<keyof typeof STAGE4_SCALE_FIXTURES>)('%s: 充足状況の数字は表示行数と一致する', (scale) => {
    const depts = STAGE4_SCALE_FIXTURES[scale]();
    const r = buildExecutionSummaryBlock(depts, '全社の状況を教えて');
    const deptTotal = depts.length;
    const projTotal = depts.reduce((n, d) => n + d.projects.length, 0);
    const shownDeptLines = r.text.split('\n').filter((l) => l.startsWith('■ 部門: ')).length;
    const shownProjHeaders = r.text.split('\n').filter((l) => l.startsWith('  - プロジェクト: ')).length;
    expect(r.departments.total).toBe(deptTotal);
    expect(r.projects.total).toBe(projTotal);
    expect(shownDeptLines).toBe(r.departments.shown);
    expect(shownProjHeaders).toBe(r.projects.shown);
    expect(r.text).toContain(`部門 全${deptTotal}件中${r.departments.shown}件を参照`);
    expect(r.text).toContain(`施策 全${projTotal}件中${r.projects.shown}件を参照`);
    assertKrNeverOrphaned(r.text);
    expect(r.text.length).toBeLessThanOrEqual(2400);
  });

  it('一部だけ参照したときは、全社の順位を断定しない制約を結論より前に書く。全件のときは書かない', () => {
    const partial = buildExecutionSummaryBlock(STAGE4_SCALE_FIXTURES['40部門・600施策'](), '全社で重要な施策は？').text;
    expect(partial.split('\n')[1]).toContain('この制約を結論より前に適用すること');
    expect(partial.split('\n')[1]).toContain('全社で最も重要・全社第1位');
    const full = buildExecutionSummaryBlock(makeFixtureDepts(2, 3, 2), '').text;
    expect(full).toContain('全件）');
    expect(full).not.toContain('結論より前に適用');
  });

  it('KRの単位は、同じラベルなら全施策で一定（数値KRに一律の単位を付けない）', () => {
    const unitByLabel = new Map<string, Set<string>>();
    for (const scale of Object.keys(STAGE4_SCALE_FIXTURES) as Array<keyof typeof STAGE4_SCALE_FIXTURES>) {
      for (const d of STAGE4_SCALE_FIXTURES[scale]()) {
        for (const p of d.projects) {
          for (const kr of p.okrsV2) {
            const base = kr.label.replace(/（補助\d+）$/, '');
            if (!unitByLabel.has(base)) unitByLabel.set(base, new Set());
            unitByLabel.get(base)!.add(kr.unit);
          }
        }
      }
    }
    expect(unitByLabel.size).toBeGreaterThan(20);
    for (const [, units] of unitByLabel) expect(units.size).toBe(1);
    expect(unitByLabel.get('新規商談数')).toEqual(new Set(['件']));
    expect(unitByLabel.get('新規受注率')).toEqual(new Set(['%']));
    expect(unitByLabel.get('初回提案までの日数')).toEqual(new Set(['日']));
    expect(unitByLabel.get('稼働率')).toEqual(new Set(['%']));
  });
});
