import { aggregateExecution, buildExecutionSummaryBlock, detectProjectionIntent } from './stage4Projection';
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
    expect(kr).toContain('担当 KR担当未入力');
    expect(kr).toContain('期限 未登録');
    expect(kr).not.toContain('佐藤花子');
  });

  it('プロジェクトの担当・計画状態・価値指標との対応が無いときは未登録', () => {
    const { text } = buildExecutionSummaryBlock([{ name: '営業部', projects: [{ title: 'P' }] }], '');
    expect(text).toContain('プロジェクト: P｜担当 未入力｜計画 未設定｜価値指標との対応（登録）: 未登録');
  });

  it('未知の計画状態は、未登録とは別に「その他」と表示する', () => {
    const { text } = buildExecutionSummaryBlock([{ name: '営業部', projects: [{ title: 'P', planStatus: 'weird' }] }], '');
    expect(text).toContain('計画 その他');
    expect(text).not.toContain('計画 未設定');
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
    expect(projects).toEqual({ total: 2, shown: 2, withKr: 2, visible: 2 });
    expect(departments).toEqual({ total: 2, shown: 2, detailed: 2 });
  });

  it('小規模（3部門15施策）は、従来どおり全施策の名前を出す', () => {
    const { text, projects } = buildExecutionSummaryBlock(makeDepts(3, 5, 2), '');
    expect(projects.visible).toBe(15);
    expect(projects.shown).toBeGreaterThanOrEqual(13);
    for (let i = 0; i < 3; i++) for (let j = 0; j < 5; j++) expect(text).toContain(`施策${i}-${j}`);
  });

  it('10部門80施策は、全部門の概要を出し、一部のみだと明示する', () => {
    const r = buildExecutionSummaryBlock(makeDepts(10, 8, 3), '全社の部門別の実行状況を教えて');
    expect(r.complete).toBe(false);
    expect(deptLineCount(r.text)).toBe(10);
    expect(r.text).toContain('部門 全10件中10件を参照');
    expect(r.text).toMatch(/施策 全80件中\d+件を名称・概要で参照/);
    expect(r.text).toContain('施策の詳細は一部のみ');
    expect(r.text).toContain('結論より前に適用');
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
  it('全部門の概要を出し、詳細（KR付き）は合計10件を複数の部門に配る', () => {
    const r = buildExecutionSummaryBlock(makeDepts(10, 8, 3), '');
    const lines = r.text.split('\n');
    expect(lines.filter((l) => l.startsWith('■ 部門: ')).length).toBe(10);
    expect(r.projects.shown).toBe(10);
    let depts = 0;
    let cur = 0;
    let withDetail = 0;
    for (const l of lines) {
      if (l.startsWith('■ 部門: ')) {
        if (cur > 0) withDetail += 1;
        cur = 0;
        depts += 1;
      }
      if (l.startsWith('  - プロジェクト: ')) cur += 1;
    }
    if (cur > 0) withDetail += 1;
    expect(depts).toBe(10);
    expect(withDetail).toBeGreaterThanOrEqual(8);
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
    expect(r.text).toContain(`施策 全${projTotal}件中${r.projects.visible}件を名称・概要で参照`);
    const overviewLines = r.text.split('\n').filter((l) => l.startsWith('    ・')).length;
    expect(overviewLines).toBe(r.projects.visible - r.projects.shown);
    assertKrNeverOrphaned(r.text);
    expect(r.text.length).toBeLessThanOrEqual(2400);
  });

  it('一部だけ参照したときは、全社の順位を断定しない制約を結論より前に書く。全件のときは書かない', () => {
    const partial = buildExecutionSummaryBlock(STAGE4_SCALE_FIXTURES['40部門・600施策'](), '全社で重要な施策は？').text;
    expect(partial.split('\n')[1]).toContain('結論より前に適用');
    expect(partial.split('\n')[1]).toContain('全社順位（最重要・第1位など）は断定せず');
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

describe('全件集計は元データ全体から数え、未登録・0・空文字を区別する', () => {
  const MIXED = [
    {
      name: '営業部',
      projects: [
        { title: 'A', planStatus: 'approved', ownerName: '佐藤', okrsV2: [{ label: 'k1', target: 1, unit: '件', due: '2027-01' }, { label: 'k2', target: 2, unit: '%' }] },
        { title: 'B', planStatus: '', ownerName: '  ', okrsV2: [] },
        { title: 'C', planStatus: 'weird', okrsV2: [{ label: 'k3', target: 3, unit: '日', due: '' }] },
        { title: 'D', planStatus: undefined, ownerName: null, okrs: [{ objective: '旧', keyResults: ['旧KR'] }] },
      ],
    },
    { name: '製造部', projects: [] },
  ];

  it('件数は、未登録・その他・0を別々に数える', () => {
    expect(aggregateExecution(MIXED)).toEqual({
      departments: 2,
      projects: 4,
      byPlanStatus: { 承認済み: 1, 確認中: 0, 下書き: 0, その他: 1, 未登録: 2 },
      ownerMissing: 3,
      projectsDueMissing: 2,
      projectsEither: 4,
      projectsBoth: 1,
      krTotal: 4,
      krDueMissing: 2,
      krLegacy: 1,
    });
  });

  it('集計は表示の選択に影響されない（40部門・600施策は全件で数える）', () => {
    const depts = STAGE4_SCALE_FIXTURES['40部門・600施策']();
    const agg = aggregateExecution(depts);
    expect(agg.projects).toBe(600);
    expect(agg.byPlanStatus.承認済み + agg.byPlanStatus.確認中 + agg.byPlanStatus.下書き).toBe(600);
    expect(agg.krTotal).toBe(2400);
    for (const budget of [2400, 3000]) {
      const r = buildExecutionSummaryBlock(depts, '全社の状況を教えて', budget);
      expect(r.aggregate).toEqual(agg);
      expect(r.text).toContain('【全件集計】部門40件・施策600件');
    }
  });

  it('旧形式の okrs しかない施策は、表示と同じく keyResults を KR として数え、期限は未登録とする', () => {
    const agg = aggregateExecution([{ name: '営業部', projects: [{ title: 'D', okrs: [{ objective: '旧', keyResults: ['旧KR1', '旧KR2'] }] }] }]);
    expect(agg.krTotal).toBe(2);
    expect(agg.krDueMissing).toBe(0);
    expect(agg.krLegacy).toBe(2);
    expect(agg.projectsDueMissing).toBe(0);
  });

  it('okrsV2 と旧 okrs が両方ある施策は、okrsV2 だけを数える（二重計上しない）', () => {
    const agg = aggregateExecution([{ name: '営業部', projects: [{ title: 'E', okrs: [{ objective: '旧', keyResults: ['旧KR'] }], okrsV2: [{ label: 'k', target: 1, unit: '件', due: '2027-01' }] }] }]);
    expect(agg.krTotal).toBe(1);
    expect(agg.krDueMissing).toBe(0);
    expect(agg.krLegacy).toBe(0);
  });
});

describe('概要のみの施策は、詳細として数えず「詳細未確認」と示す', () => {
  const groupOf = (text: string) => {
    const lines = text.split('\n');
    const out: string[][] = [];
    let cur: string[] | null = null;
    for (const l of lines) {
      if (l.startsWith('■ 部門: ')) cur = null;
      if (l.startsWith('  概要のみ（詳細未確認）:')) { cur = []; out.push(cur); continue; }
      if (cur && l.startsWith('    ・')) cur.push(l);
      else if (l.startsWith('    ・')) throw new Error('概要の行が、詳細未確認の見出しの外にある');
    }
    return out;
  };

  it('4部門・20施策（丹青社相当）は、既定の2,400字で20施策すべての名称と計画状態を出す', () => {
    const r = buildExecutionSummaryBlock(makeFixtureDepts(4, 5, 3), '全社の状況を教えて');
    expect(r.projects.total).toBe(20);
    expect(r.projects.visible).toBe(20);
    expect(r.omitted).toBe(0);
    expect(r.projects.shown).toBeGreaterThanOrEqual(8);
    expect(r.text.length).toBeLessThanOrEqual(2400);
    const names = groupOf(r.text).flat();
    expect(names.length).toBe(20 - r.projects.shown);
    expect(names.every((l) => /（計画 (承認済み|確認中|下書き|未登録)）$/.test(l))).toBe(true);
  });

  it('4部門・20施策は、4,000字で従来の詳細件数（19件）から集計行の分を除き、1件以内の減少に収まる', () => {
    const r = buildExecutionSummaryBlock(makeFixtureDepts(4, 5, 3), '全社の状況を教えて', 4000);
    expect(r.projects.visible).toBe(20);
    expect(r.projects.shown).toBeGreaterThanOrEqual(18);
  });

  it('10部門・80施策は、3,000字で従来の詳細件数（13件）を下回らない', () => {
    const r = buildExecutionSummaryBlock(makeFixtureDepts(10, 8, 3), '全社の状況を教えて', 3000);
    expect(r.projects.shown).toBeGreaterThanOrEqual(13);
    expect(r.text.length).toBeLessThanOrEqual(3000);
  });

  it('全件が詳細で見えるときは、概要の見出しを出さない（小規模の対照）', () => {
    const r = buildExecutionSummaryBlock(makeFixtureDepts(2, 3, 2), '');
    expect(r.complete).toBe(true);
    expect(r.text).not.toContain('概要のみ（詳細未確認）');
  });

  it('概要の行は、直前の部門の見出しの下にだけ出る', () => {
    const r = buildExecutionSummaryBlock(makeFixtureDepts(4, 5, 3), '全社の状況を教えて');
    expect(() => groupOf(r.text)).not.toThrow();
  });
});

describe('4部門・20施策（未登録データ入り）の集計は、独立に数えた正解と一致する', () => {
  const withMissingValues = (depts: any[]) => {
    const d = JSON.parse(JSON.stringify(depts));
    delete d[0].projects[0].ownerName;
    d[2].projects[1].ownerName = '';
    d[1].projects[3].planStatus = 'pending_review';
    delete d[0].projects[0].okrsV2[1].due;
    d[3].projects[4].okrsV2[0].due = '';
    return d;
  };

  it('担当者または期限が未登録の施策は重複を除いて3件、両方に該当するのは1件', () => {
    const depts = withMissingValues(makeFixtureDepts(4, 5, 3));
    const agg = aggregateExecution(depts);
    const owner = new Set<unknown>();
    const due = new Set<unknown>();
    depts.forEach((d: any, di: number) => d.projects.forEach((p: any, pi: number) => {
      if (!p.ownerName || String(p.ownerName).trim() === '') owner.add(`${di}-${pi}`);
      (p.okrsV2 ?? []).forEach((k: any) => {
        if (!k.due || String(k.due).trim() === '') due.add(`${di}-${pi}`);
      });
    }));
    const either = new Set([...owner, ...due]);
    const both = [...owner].filter((x) => due.has(x));
    expect(agg.ownerMissing).toBe(owner.size);
    expect(agg.projectsDueMissing).toBe(due.size);
    expect(agg.projectsEither).toBe(either.size);
    expect(agg.projectsBoth).toBe(both.length);
    expect(agg.projectsEither).toBe(3);
    expect(agg.projectsBoth).toBe(1);
    expect(agg.ownerMissing).toBe(2);
    expect(agg.krDueMissing).toBe(2);
    expect(agg.krTotal).toBe(60);
    expect(agg.krLegacy).toBe(0);
  });

  it('集計行は施策単位とKR単位を分け、異なる単位の件数を足さない', () => {
    const text = buildExecutionSummaryBlock(withMissingValues(makeFixtureDepts(4, 5, 3)), '全社の状況を教えて').text;
    const line = text.split('\n').find((l) => l.startsWith('【全件集計'))!;
    expect(line).toContain('施策担当未入力2・期限未登録KRあり2・いずれか3（両方1）');
    expect(line).toContain('KR単位: 全60件・期限未登録2・旧形式0');
  });
});

describe('KRの表示規則と集計規則の一致（6ケース、架空データ）', () => {
  const one = (project: Record<string, unknown>) => [{ name: '営業部', projects: [{ title: 'P', ownerName: '担当A', ...project }] }];
  const countDisplayedKr = (text: string) =>
    text.split('\n').reduce((n, l) => {
      if (l.startsWith('    - KR: ')) return n + 1;
      const m = l.match(/^    - O: .*? \/ KR: (.+)$/);
      if (m) return n + m[1].split('、').filter(Boolean).length;
      return n;
    }, 0);
  const BIG = 6000;

  it('1. okrsV2だけ: 期限の値で数え、旧形式は数えない', () => {
    const depts = one({ okrsV2: [{ label: 'a', target: 1, unit: '件', due: '2027-01' }, { label: 'b', target: 2, unit: '件', due: '2027-02' }] });
    const agg = aggregateExecution(depts);
    expect(agg).toMatchObject({ krTotal: 2, krDueMissing: 0, krLegacy: 0, projectsDueMissing: 0 });
    expect(countDisplayedKr(buildExecutionSummaryBlock(depts, '', BIG).text)).toBe(agg.krTotal);
  });

  it('2. 旧okrsだけ: KRとして数えるが、期限は確認できないため未登録にはしない', () => {
    const depts = one({ okrs: [{ objective: '旧', keyResults: ['x', 'y'] }] });
    const agg = aggregateExecution(depts);
    expect(agg).toMatchObject({ krTotal: 2, krLegacy: 2, krDueMissing: 0, projectsDueMissing: 0 });
    expect(countDisplayedKr(buildExecutionSummaryBlock(depts, '', BIG).text)).toBe(agg.krTotal);
  });

  it('3. 両方ある: okrsV2だけを数える（旧形式は同じKRの写しなので加算しない）', () => {
    const depts = one({
      okrsV2: [{ label: 'a', target: 1, unit: '件', due: '2027-01' }],
      okrs: [{ objective: '旧', keyResults: ['a'] }],
    });
    const agg = aggregateExecution(depts);
    expect(agg).toMatchObject({ krTotal: 1, krLegacy: 0 });
    expect(countDisplayedKr(buildExecutionSummaryBlock(depts, '', BIG).text)).toBe(1);
  });

  it('4. KRが登録されていない施策: KR0件。担当者が無ければ施策単位で未登録に数える', () => {
    const agg = aggregateExecution([{ name: '営業部', projects: [{ title: 'P', okrsV2: [], okrs: [] }] }]);
    expect(agg).toMatchObject({ krTotal: 0, krDueMissing: 0, krLegacy: 0, ownerMissing: 1, projectsEither: 1, projectsBoth: 0 });
  });

  it('5. 担当者・期限の一方または両方が未登録: 施策単位で、いずれか・両方を重複なく数える', () => {
    const owner = { ownerName: '', okrsV2: [{ label: 'a', target: 1, unit: '件', due: '2027-01' }] };
    const due = { ownerName: '担当A', okrsV2: [{ label: 'b', target: 1, unit: '件' }] };
    const both = { ownerName: null, okrsV2: [{ label: 'c', target: 1, unit: '件', due: '' }, { label: 'd', target: 1, unit: '件' }] };
    const agg = aggregateExecution([{ name: '営業部', projects: [{ title: 'O', ...owner }, { title: 'D', ...due }, { title: 'B', ...both }] }]);
    expect(agg).toMatchObject({ ownerMissing: 2, projectsDueMissing: 2, projectsEither: 3, projectsBoth: 1, krTotal: 4, krDueMissing: 3 });
  });

  it('6. 旧形式のため期限を確認できない施策: 期限未登録として数えず、旧形式として別に数える', () => {
    const agg = aggregateExecution([{ name: '営業部', projects: [{ title: 'L', ownerName: '担当A', okrs: [{ objective: '旧', keyResults: ['x'] }] }] }]);
    expect(agg).toMatchObject({ krTotal: 1, krLegacy: 1, krDueMissing: 0, projectsDueMissing: 0, projectsEither: 0 });
    expect(agg.krLegacy).toBe(1);
  });
});

describe('質問の種類に応じた情報選択（Phase 2-B2）', () => {
  const BASE = '点検工程の標準化と当日提出の徹底、既存顧客の保守契約更新、見積もり回答の短縮、設備稼働率の改善、新製品の試作評価';
  const longText = (n: number) => BASE.slice(0, n).padEnd(n, '例');
  const longDepts = (nDept: number, nProj: number, nameLen: number, krLen: number, nKr: number) =>
    Array.from({ length: nDept }, (_, i) => ({
      name: `部門${i + 1}`,
      mission: '役割の説明',
      projects: Array.from({ length: nProj }, (_, j) => ({
        title: `${longText(nameLen)}${i}${j}`,
        ownerName: `担当${i}${j}`,
        planStatus: 'approved',
        okrsV2: Array.from({ length: nKr }, (_, k) => ({ label: `${longText(krLen)}${k}`, target: 50, unit: '件', due: '2027-01', owner: 'KR担当' })),
      })),
    }));
  const LIST_Q = '当社の20施策について、名称を把握している施策と、KRまで詳しく確認できている施策を分けて教えてください。詳細を確認できない施策については、内容を推測しないでください。';

  it('質問の種類を判定する（一覧・件数・特定部門・経営相談）', () => {
    const depts = makeDepts(2, 2, 2);
    expect(detectProjectionIntent('登録されている施策を一覧にしてください', depts)).toBe('list');
    expect(detectProjectionIntent('当社の20施策の名称をすべて教えてください', depts)).toBe('list');
    expect(detectProjectionIntent(LIST_Q, depts)).toBe('list');
    expect(detectProjectionIntent('何施策登録されていますか？', depts)).toBe('count');
    expect(detectProjectionIntent('担当者欄が未入力の施策はいくつありますか？', depts)).toBe('count');
    expect(detectProjectionIntent('部門01の施策について、KRを教えてください', depts)).toBe('targeted');
    expect(detectProjectionIntent('各部門の実行計画を踏まえて、全社戦略の実現に向けた最重要課題を考えてください', depts)).toBe('consult');
    expect(detectProjectionIntent('全社の実行計画の中で、特に重要な施策はどれですか？', depts)).toBe('consult');
  });

  it('丹青社相当（4部門・20施策、長い名称とKR）で、一覧質問は20施策すべての名称を出す', () => {
    const depts = longDepts(4, 5, 28, 20, 4);
    const r = buildExecutionSummaryBlock(depts, LIST_Q, 2400);
    expect(r.intent).toBe('list');
    expect(r.projects.visible).toBe(20);
    expect(r.omitted).toBe(0);
    expect(r.text.length).toBeLessThanOrEqual(2400);
    assertKrNeverOrphaned(r.text);
    expect(r.text).toContain('施策の詳細は一部のみ');
  });

  it('20施策を超える一覧質問は名称優先にせず、B1の配分で省略件数を明示する', () => {
    const r = buildExecutionSummaryBlock(longDepts(10, 8, 28, 20, 3), '登録されている施策を一覧にしてください', 2400);
    expect(r.intent).toBe('list');
    expect(r.projects.total).toBe(80);
    expect(r.projects.visible).toBeLessThan(80);
    expect(r.omitted).toBe(80 - r.projects.visible);
    expect(r.text).toContain(`名称も省略された施策${r.omitted}件`);
    expect(r.text.length).toBeLessThanOrEqual(2400);
    assertKrNeverOrphaned(r.text);
  });

  it('件数の質問は、経営相談と同じ情報配分で、件数は全件集計から出す', () => {
    const depts = longDepts(4, 5, 28, 20, 4);
    const count = buildExecutionSummaryBlock(depts, '何施策登録されていますか？', 2400);
    const consult = buildExecutionSummaryBlock(depts, '当社の経営課題は何ですか？', 2400);
    expect(count.intent).toBe('count');
    expect(count.text).toBe(consult.text);
    expect(count.aggregate.projects).toBe(20);
  });

  it('特定部門の質問は、その部門の施策のKRを削らずに出す', () => {
    const r = buildExecutionSummaryBlock(longDepts(4, 5, 28, 20, 4), '部門3の施策について、KRを教えてください', 2400);
    expect(r.intent).toBe('targeted');
    const lines = r.text.split('\n');
    const idx = lines.findIndex((l) => l.startsWith('■ 部門: 部門3'));
    expect(idx).toBeGreaterThan(-1);
    const first = lines.findIndex((l, i) => i > idx && l.startsWith('  - プロジェクト: '));
    expect(lines[first]).toMatch(/20｜担当/);
    expect(lines.slice(first + 1, first + 5).filter((l) => l.startsWith('    - KR: ')).length).toBe(4);
  });

  it('言い換えによる一覧の表現の違いで、情報配分は変わらない', () => {
    const depts = longDepts(4, 5, 28, 20, 4);
    const a = buildExecutionSummaryBlock(depts, '施策の名称を一覧で教えてください', 2400);
    const b = buildExecutionSummaryBlock(depts, '登録されている施策の名称をすべて教えてください', 2400);
    expect(a.text).toBe(b.text);
  });

  it('集計行は、施策のplanStatusと部門のSTAGE4状態の違い、担当欄(ownerName)を明示する', () => {
    const text = buildExecutionSummaryBlock(makeDepts(2, 2, 2), '', 2400).text;
    const line = text.split('\n').find((l) => l.startsWith('【全件集計】')) ?? '';
    expect(line).toContain('planStatus:');
    expect(line).toContain('施策担当未入力');
    expect(line).toContain('部門のSTAGE4状態とは別');
  });

  it('名称変更の相談は経営相談、一覧を求めない否定表現も経営相談、一覧の肯定表現は一覧', () => {
    const depts = makeDepts(2, 2, 2);
    expect(detectProjectionIntent('施策の名称を変更した方がよいでしょうか？', depts)).toBe('consult');
    expect(detectProjectionIntent('施策の名称変更について経営として相談したい', depts)).toBe('consult');
    expect(detectProjectionIntent('全施策を一覧にせず、重要課題を考えてください', depts)).toBe('consult');
    expect(detectProjectionIntent('全施策を一覧にして', depts)).toBe('list');
    expect(detectProjectionIntent('名称一覧を出してください', depts)).toBe('list');
  });

  it('チェーンストア事業の施策一覧は、該当部門を先頭に出す', () => {
    const depts = [
      { id: 'a', name: '営業部', mission: '営業', projects: [{ id: 'p1', title: '新規顧客開拓', planStatus: 'approved' }] },
      { id: 'b', name: 'チェーンストア事業', mission: 'チェーン', projects: [{ id: 'p2', title: '採算改善', planStatus: 'review' }] },
    ];
    const r = buildExecutionSummaryBlock(depts, 'チェーンストア事業の施策一覧を教えてください', 2400);
    expect(r.intent).toBe('list');
    const firstDept = r.text.split('\n').find((l) => l.startsWith('■ 部門: '));
    expect(firstDept).toContain('チェーンストア事業');
  });

  it('4部門・20施策（長い名称）の経営相談は、全20施策の名称を残し、詳細は1件以上残す', () => {
    const r = buildExecutionSummaryBlock(longDepts(4, 5, 28, 20, 4), '当社の経営課題は何ですか？', 2400);
    expect(r.intent).toBe('consult');
    expect(r.projects.visible).toBe(20);
    expect(r.projects.shown).toBeGreaterThanOrEqual(1);
    expect(r.text.length).toBeLessThanOrEqual(2400);
    assertKrNeverOrphaned(r.text);
  });
});

describe('KR目標の表示：明示的な0と単位未設定・目標未設定', () => {
  it('目標0は0として出し、単位がなければ単位未設定と書く（既定の単位は補わない）', () => {
    const { text } = buildExecutionSummaryBlock(
      [{ name: '営業部', projects: [{ title: 'P', okrsV2: [{ label: 'KR0', target: 0 }, { label: 'KR1', target: 75, unit: '%' }] }] }],
      ''
    );
    expect(lineOf(text, 'KR: KR0')).toContain('登録目標 0（単位未設定）（設定内容の確認を推奨）');
    expect(lineOf(text, 'KR: KR0')).not.toContain('目標 0%');
    expect(lineOf(text, 'KR: KR1')).toContain('目標 75%');
    expect(lineOf(text, 'KR: KR1')).not.toContain('登録目標');
  });

  it('0%・0件・0円は、登録された単位をそのまま維持して確認を促す', () => {
    const { text } = buildExecutionSummaryBlock(
      [{ name: '営業部', projects: [{ title: 'P', okrsV2: [
        { label: 'KRp', target: 0, unit: '%' },
        { label: 'KRn', target: 0, unit: '件' },
        { label: 'KRy', target: 0, unit: '円' },
      ] }] }],
      ''
    );
    expect(lineOf(text, 'KR: KRp')).toContain('登録目標 0%（設定内容の確認を推奨）');
    expect(lineOf(text, 'KR: KRn')).toContain('登録目標 0件（設定内容の確認を推奨）');
    expect(lineOf(text, 'KR: KRy')).toContain('登録目標 0円（設定内容の確認を推奨）');
  });

  it('単位がない0は、単位を補完せず確認を促す', () => {
    const { text } = buildExecutionSummaryBlock(
      [{ name: '営業部', projects: [{ title: 'P', okrsV2: [{ label: 'KRs', target: 0 }] }] }],
      ''
    );
    expect(lineOf(text, 'KR: KRs')).toContain('登録目標 0（単位未設定）');
  });

  it('目標が無いKRは目標未設定と書き、0と書かない', () => {
    const { text } = buildExecutionSummaryBlock(
      [{ name: '営業部', projects: [{ title: 'P', okrsV2: [{ label: 'KRX', unit: '件' }] }] }],
      ''
    );
    expect(lineOf(text, 'KR: KRX')).toContain('目標未設定');
    expect(lineOf(text, 'KR: KRX')).not.toContain('目標 0');
  });
});
