import { adjustmentPlanUnits, activePlanDepartments } from './projectLifecycle';

const departments = [
  {
    id: 'd-a',
    name: '営業部',
    projects: [
      { id: 'p1', title: '有効な施策' },
      { id: 'p2', title: '計画から外した施策', lifecycle: { status: 'EXCLUDED', changedAt: '2026-11-01T00:00:00.000Z', changedBy: null } },
    ],
  },
  {
    id: 'd-b',
    name: '製造部',
    projects: [{ id: 'p3', title: '中止した施策', lifecycle: { status: 'STOPPED', changedAt: '2026-11-01T00:00:00.000Z', changedBy: null, stoppedAt: '2026-11-01T00:00:00.000Z' } }],
  },
];

describe('AIの部門間調整に渡す行動計画は、計画から外した・中止した施策を含まない', () => {
  it('有効な施策だけを、部門ごとに残す', () => {
    const units = adjustmentPlanUnits(departments);
    expect(units.map((u) => u.projectId)).toEqual(['id:p1']);
  });

  it('入力の部門データは変えない', () => {
    const before = JSON.stringify(departments);
    activePlanDepartments(departments);
    expect(JSON.stringify(departments)).toBe(before);
  });

  it('部門データが配列でなければ、空になる', () => {
    expect(adjustmentPlanUnits(null)).toEqual([]);
  });
});
