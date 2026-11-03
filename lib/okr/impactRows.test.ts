import { chartEffectiveDelta, resolveManualImpacts, rowsAfterProjectTargetWrite, stage6ProjectKeyOf } from './impactRows';
import { mjpyToUnit, unitToYen, yenPerUnit } from './impactUnits';

const targets = [
  { id: 'rev', label: '売上', unit: '百万円' },
  { id: 'op', label: '営業利益', unit: '百万円' },
];

const project = (title: string, extra: Record<string, unknown> = {}) => ({ title, role: 'REVENUE', ...extra });
const dept = (name: string, projects: any[]) => ({ id: `d-${name}`, name, projects });

describe('施策の一意IDによる行の紐づけ（並べ替え・改名・削除）', () => {
  const idA = 'uid-A';
  const idB = 'uid-B';

  it('並べ替えても、一意IDの行は同じ施策に残る', () => {
    const depts = [dept('営業部', [project('A', { projectUid: idA }), project('B', { projectUid: idB })])];
    const rows = [{ projectId: idA, targetId: 'rev', delta: 10, source: 'manual', locked: true }];
    const reordered = [dept('営業部', [project('B', { projectUid: idB }), project('A', { projectUid: idA })])];
    const res = resolveManualImpacts({ rows, departments: reordered, companyTargets: targets });
    expect(res.excluded).toEqual([]);
    expect(res.rows).toEqual([expect.objectContaining({ projectId: '営業部::A::1', delta: 10 })]);
    expect(resolveManualImpacts({ rows, departments: depts, companyTargets: targets }).rows[0].projectId).toBe('営業部::A::0');
  });

  it('改名しても、一意IDの行は同じ施策に残る', () => {
    const rows = [{ projectId: idA, targetId: 'rev', delta: 10, source: 'manual', locked: true }];
    const renamed = [dept('営業部', [project('A改', { projectUid: idA })])];
    const res = resolveManualImpacts({ rows, departments: renamed, companyTargets: targets });
    expect(res.rows[0].projectId).toBe('営業部::A改::0');
    expect(res.excluded).toEqual([]);
  });

  it('同名の施策が2件あっても、一意IDの行はそれぞれの施策に付く', () => {
    const depts = [dept('営業部', [project('新規開拓', { projectUid: idA }), project('新規開拓', { projectUid: idB })])];
    const rows = [{ projectId: idB, targetId: 'rev', delta: 7, source: 'manual', locked: true }];
    const res = resolveManualImpacts({ rows, departments: depts, companyTargets: targets });
    expect(res.rows[0].projectId).toBe('営業部::新規開拓::1');
    expect(res.rows[0].delta).toBe(7);
  });

  it('削除された施策の一意IDの行は、集計から外れ、理由つきで一覧に出る（行は消さない）', () => {
    const rows = [{ projectId: idA, targetId: 'rev', delta: 10, source: 'manual', locked: true }];
    const res = resolveManualImpacts({ rows, departments: [dept('営業部', [project('B', { projectUid: idB })])], companyTargets: targets });
    expect(res.rows).toEqual([]);
    expect(res.excluded).toEqual([
      expect.objectContaining({ projectId: idA, targetId: 'rev', valueMJPY: 10, reason: expect.stringContaining('見つからない') }),
    ]);
    expect(rows).toHaveLength(1);
  });
});

describe('旧形式の行（部門名::施策名::添字）の扱い', () => {
  it('名前が一意に特定できる旧行は、並べ替え後も集計に残る', () => {
    const rows = [{ projectId: '営業部::A::0', targetId: 'rev', delta: 10, source: 'manual', locked: true }];
    const reordered = [dept('営業部', [project('B'), project('A')])];
    const res = resolveManualImpacts({ rows, departments: reordered, companyTargets: targets });
    expect(res.rows).toEqual([expect.objectContaining({ projectId: '営業部::A::1', delta: 10 })]);
  });

  it('部門名・施策名の前後の空白を無視して一意に特定する', () => {
    const rows = [{ projectId: '営業部::A::0', targetId: 'rev', delta: 10, source: 'manual', locked: true }];
    const res = resolveManualImpacts({ rows, departments: [dept(' 営業部 ', [project(' A ')])], companyTargets: targets });
    expect(res.rows).toEqual([expect.objectContaining({ projectId: stage6ProjectKeyOf(dept(' 営業部 ', []), project(' A '), 0) })]);
  });

  it('同名の施策が複数ある旧行は、どれか特定できないので集計から外す（別の施策へは移さない）', () => {
    const rows = [{ projectId: '営業部::新規開拓::1', targetId: 'rev', delta: 10, source: 'manual', locked: true }];
    const res = resolveManualImpacts({
      rows,
      departments: [dept('営業部', [project('新規開拓'), project('新規開拓')])],
      companyTargets: targets,
    });
    expect(res.rows).toEqual([]);
    expect(res.excluded[0].reason).toContain('複数');
  });

  it('同じ施策に新しい形式の行があれば、旧行は集計から外す（二重計上しない）', () => {
    const rows = [
      { projectId: '営業部::A::0', targetId: 'rev', delta: 10, source: 'manual', locked: true },
      { projectId: 'uid-A', targetId: 'rev', delta: 15, source: 'manual', locked: true },
    ];
    const res = resolveManualImpacts({
      rows,
      departments: [dept('営業部', [project('A', { projectUid: 'uid-A' })])],
      companyTargets: targets,
    });
    expect(res.rows.map((r) => r.delta)).toEqual([15]);
    expect(res.excluded.map((e) => e.reason).join()).toContain('新しい行');
  });
});

describe('金額の単位（保存は百万円、表示・集計は目標の単位へ一度だけ換算）', () => {
  const row = { projectId: 'uid-A', targetId: 'rev', delta: 10, source: 'manual', locked: true };
  const depts = [dept('営業部', [project('A', { projectUid: 'uid-A' })])];

  it.each([
    ['百万円', 10],
    ['万円', 1000],
    ['円', 10_000_000],
    ['千円', 10_000],
  ])('目標の単位が%sのとき、10百万円は %s 建ての値になり、円へ戻すと1,000万円になる', (unit, expected) => {
    const res = resolveManualImpacts({ rows: [row], departments: depts, companyTargets: [{ id: 'rev', label: '売上', unit }] });
    expect(res.rows[0].delta).toBe(expected);
    expect(unitToYen(res.rows[0].delta, unit)).toBe(10_000_000);
  });

  it('目標の単位が特定できないときは換算せず、集計から外す', () => {
    const res = resolveManualImpacts({ rows: [row], departments: depts, companyTargets: [{ id: 'rev', label: '売上', unit: '%' }] });
    expect(res.rows).toEqual([]);
    expect(res.excluded[0].reason).toContain('単位が特定できない');
  });

  it('金額の単位が百万円でない行は、推測で換算せず集計から外す', () => {
    const res = resolveManualImpacts({
      rows: [{ ...row, deltaUnit: 'yen' }],
      departments: depts,
      companyTargets: targets,
    });
    expect(res.rows).toEqual([]);
    expect(res.excluded[0].reason).toContain('単位');
  });

  it('換算関数は、未知の単位で値を変えない（null を返す）', () => {
    expect(yenPerUnit('億円')).toBeNull();
    expect(mjpyToUnit(10, '億円')).toBeNull();
    expect(unitToYen(10, undefined)).toBeNull();
  });
});

describe('書き込みと集計の境界', () => {
  it('書き込みは、同じ施策・目標の行だけを置き換え、他の施策の行は残す', () => {
    const rows = [
      { projectId: 'uid-B', targetId: 'rev', delta: 7, source: 'manual', locked: true },
      { projectId: 'uid-A', targetId: 'rev', delta: 10, source: 'manual', locked: true },
    ];
    const out = rowsAfterProjectTargetWrite({
      rows,
      departments: [dept('営業部', [project('A', { projectUid: 'uid-A' }), project('B', { projectUid: 'uid-B' })])],
      companyTargets: targets,
      dIdx: 0,
      pIdx: 0,
      projectUid: 'uid-A',
      targetId: 'rev',
      valueMJPY: 20,
      notes: '[STAGE4] 売上寄与',
    });
    expect(out.map((r) => [r.projectId, r.delta])).toEqual([
      ['uid-B', 7],
      ['uid-A', 20],
    ]);
  });

  it('金額を消去すると、その施策の行だけが消える', () => {
    const rows = [{ projectId: 'uid-A', targetId: 'rev', delta: 10, source: 'manual', locked: true }];
    const out = rowsAfterProjectTargetWrite({
      rows,
      departments: [dept('営業部', [project('A', { projectUid: 'uid-A' })])],
      companyTargets: targets,
      dIdx: 0,
      pIdx: 0,
      projectUid: 'uid-A',
      targetId: 'rev',
      valueMJPY: undefined,
      notes: '',
    });
    expect(out).toEqual([]);
  });

  it('自動行は、実行重みを掛けずに集計される（配分時に掛け済み）。手動行は従来どおり1回掛ける', () => {
    expect(chartEffectiveDelta({ delta: 50, source: 'auto' }, 1.2)).toBe(50);
    expect(chartEffectiveDelta({ delta: 10, source: 'manual' }, 0.8)).toBeCloseTo(8, 10);
  });
});
