import {
  applyKrActualToDepartments,
  applyWorkProgressToDepartments,
  patchStrategyDepartments,
  type StoredRow,
  type StrategyIo,
} from './partialStrategyWrite';

const ACTUAL = { value: 92, asOf: '2026-10', recordedAt: '2026-11-14T00:00:00Z' };

function sampleDepartments(): unknown[] {
  return [
    {
      id: 'dept-1',
      name: '営業部',
      projects: [
        {
          id: 'proj-a',
          title: '新規開拓',
          workProgressPct: 20,
          okrsV2: [
            { id: 'kr-1', label: '商談数', target: 120, unit: '件' },
            { id: 'kr-2', label: '継続率', target: 95, unit: '%', actual: { value: 90, asOf: '2026-09', recordedAt: 'x' } },
          ],
          kpis: ['STAGE4で編集したKPI'],
        },
        { id: 'proj-b', title: '別案件', workProgressPct: 50, okrsV2: [{ id: 'kr-9', label: '別KR', target: 1, unit: '件' }] },
      ],
    },
  ];
}

function fakeIo(initial: StoredRow, conflictsBeforeWrite = 0) {
  let row: StoredRow = { ...initial };
  let conflicts = conflictsBeforeWrite;
  const reads: string[] = [];
  const writes: Array<{ companyId: string; rowId: string; expectedRevision: number; actorId: string }> = [];
  const io: StrategyIo = {
    read: async (companyId) => {
      reads.push(companyId);
      return { row: companyId === 'company-1' ? { ...row } : null, error: null };
    },
    write: async ({ companyId, rowId, expectedRevision, departments, actorId }) => {
      writes.push({ companyId, rowId, expectedRevision, actorId });
      if (conflicts > 0) {
        conflicts--;
        row = { ...row, revision: row.revision + 1, departments: [...row.departments] };
        return { row: null, error: null };
      }
      if (companyId !== 'company-1') return { row: null, error: null };
      if (rowId !== row.id || expectedRevision !== row.revision) return { row: null, error: null };
      row = { ...row, revision: row.revision + 1, departments };
      return { row: { ...row }, error: null };
    },
  };
  return { io, reads, writes, current: () => row, setRow: (next: StoredRow) => (row = next) };
}

describe('applyKrActualToDepartments', () => {
  it('changes only the target KR and keeps every other project and KR as-is', () => {
    const before = sampleDepartments();
    const result = applyKrActualToDepartments(before, { projectId: 'proj-a', krId: 'kr-1', actual: ACTUAL });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const next = result.departments as any[];
    const projA = next[0].projects[0];
    expect(projA.okrsV2[0].actual).toEqual(ACTUAL);
    expect(projA.okrsV2[1]).toEqual((before[0] as any).projects[0].okrsV2[1]);
    expect(projA.kpis).toEqual(['STAGE4で編集したKPI']);
    expect(next[0].projects[1]).toEqual((before[0] as any).projects[1]);
    expect(next[0].name).toBe('営業部');
  });

  it('keeps the previous actual in actualHistory when it is overwritten', () => {
    const result = applyKrActualToDepartments(sampleDepartments(), {
      projectId: 'proj-a',
      krId: 'kr-2',
      actual: ACTUAL,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const kr = (result.departments as any[])[0].projects[0].okrsV2[1];
    expect(kr.actual).toEqual(ACTUAL);
    expect(kr.actualHistory).toEqual([{ value: 90, asOf: '2026-09', recordedAt: 'x' }]);
  });

  it('does not write when the project or KR cannot be identified uniquely', () => {
    const departments = sampleDepartments();
    expect(applyKrActualToDepartments(departments, { projectId: 'missing', krId: 'kr-1', actual: ACTUAL })).toEqual({
      ok: false,
      reason: 'project-not-found',
    });
    expect(applyKrActualToDepartments(departments, { projectId: 'proj-a', krId: 'kr-x', actual: ACTUAL })).toEqual({
      ok: false,
      reason: 'not-found',
    });
    expect(applyKrActualToDepartments(departments, { projectId: '', krId: 'kr-1', actual: ACTUAL })).toEqual({
      ok: false,
      reason: 'project-missing-id',
    });
  });

  it('refuses an ambiguous project id instead of guessing', () => {
    const departments = [
      { projects: [{ id: 'dup', okrsV2: [{ id: 'kr-1' }] }] },
      { projects: [{ id: 'dup', okrsV2: [{ id: 'kr-1' }] }] },
    ];
    expect(applyKrActualToDepartments(departments, { projectId: 'dup', krId: 'kr-1', actual: ACTUAL })).toEqual({
      ok: false,
      reason: 'project-ambiguous',
    });
  });
});

describe('applyWorkProgressToDepartments', () => {
  it('sets the work progress of the target project only', () => {
    const before = sampleDepartments();
    const result = applyWorkProgressToDepartments(before, { projectId: 'proj-a', pct: 70 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const next = result.departments as any[];
    expect(next[0].projects[0].workProgressPct).toBe(70);
    expect(next[0].projects[0].okrsV2).toEqual((before[0] as any).projects[0].okrsV2);
    expect(next[0].projects[1].workProgressPct).toBe(50);
  });

  it('clears the value when the input is emptied and rejects out-of-range values', () => {
    const cleared = applyWorkProgressToDepartments(sampleDepartments(), { projectId: 'proj-a', pct: undefined });
    expect(cleared.ok).toBe(true);
    if (cleared.ok) expect('workProgressPct' in (cleared.departments as any[])[0].projects[0]).toBe(false);

    expect(applyWorkProgressToDepartments(sampleDepartments(), { projectId: 'proj-a', pct: 101 })).toEqual({
      ok: false,
      reason: 'invalid-value',
    });
  });
});

describe('patchStrategyDepartments', () => {
  const base: StoredRow = { id: 'row-1', revision: 4, departments: sampleDepartments() };

  it('writes against the revision it read and returns the new revision', async () => {
    const table = fakeIo(base);
    const outcome = await patchStrategyDepartments(table.io, {
      companyId: 'company-1',
      actorId: 'user-1',
      apply: (d) => applyKrActualToDepartments(d, { projectId: 'proj-a', krId: 'kr-1', actual: ACTUAL }),
    });

    expect(outcome).toMatchObject({ ok: true, revision: 5 });
    expect(table.writes).toEqual([{ companyId: 'company-1', rowId: 'row-1', expectedRevision: 4, actorId: 'user-1' }]);
  });

  it('re-reads and re-applies on a revision conflict, so another change is not overwritten', async () => {
    const table = fakeIo(base, 1);
    const seen: unknown[][] = [];
    const outcome = await patchStrategyDepartments(table.io, {
      companyId: 'company-1',
      actorId: 'user-1',
      apply: (d) => {
        seen.push(d);
        return applyWorkProgressToDepartments(d, { projectId: 'proj-a', pct: 60 });
      },
    });

    expect(outcome.ok).toBe(true);
    expect(table.reads).toHaveLength(2);
    expect(seen).toHaveLength(2);
    expect(table.writes.map((w) => w.expectedRevision)).toEqual([4, 5]);
  });

  it('gives up after repeated conflicts without writing a stale snapshot', async () => {
    const table = fakeIo(base, 10);
    const outcome = await patchStrategyDepartments(table.io, {
      companyId: 'company-1',
      actorId: 'user-1',
      apply: (d) => applyWorkProgressToDepartments(d, { projectId: 'proj-a', pct: 60 }),
      maxAttempts: 2,
    });
    expect(outcome).toEqual({ ok: false, reason: 'revision_conflict' });
    expect(table.writes).toHaveLength(2);
  });

  it('does not write when the apply step refuses the change', async () => {
    const table = fakeIo(base);
    const outcome = await patchStrategyDepartments(table.io, {
      companyId: 'company-1',
      actorId: 'user-1',
      apply: (d) => applyKrActualToDepartments(d, { projectId: 'proj-a', krId: 'kr-x', actual: ACTUAL }),
    });
    expect(outcome).toEqual({ ok: false, reason: 'not-found' });
    expect(table.writes).toHaveLength(0);
  });

  it('reads and writes only the requested company', async () => {
    const table = fakeIo(base);
    const outcome = await patchStrategyDepartments(table.io, {
      companyId: 'company-2',
      actorId: 'user-1',
      apply: (d) => ({ ok: true, departments: d }),
    });
    expect(outcome).toEqual({ ok: false, reason: 'row_not_found' });
    expect(table.writes).toHaveLength(0);
  });

  it('refuses to run without a company or actor', async () => {
    const table = fakeIo(base);
    const outcome = await patchStrategyDepartments(table.io, {
      companyId: '',
      actorId: 'user-1',
      apply: (d) => ({ ok: true, departments: d }),
    });
    expect(outcome).toEqual({ ok: false, reason: 'missing_scope' });
    expect(table.reads).toHaveLength(0);
  });

  it('reports read and write errors without claiming success', async () => {
    const readFails: StrategyIo = {
      read: async () => ({ row: null, error: { message: 'boom' } }),
      write: async () => ({ row: null, error: null }),
    };
    expect(
      await patchStrategyDepartments(readFails, { companyId: 'c', actorId: 'u', apply: (d) => ({ ok: true, departments: d }) }),
    ).toEqual({ ok: false, reason: 'read_failed' });

    const writeFails: StrategyIo = {
      read: async () => ({ row: base, error: null }),
      write: async () => ({ row: null, error: { message: 'denied' } }),
    };
    expect(
      await patchStrategyDepartments(writeFails, { companyId: 'c', actorId: 'u', apply: (d) => ({ ok: true, departments: d }) }),
    ).toEqual({ ok: false, reason: 'write_failed' });
  });
});
