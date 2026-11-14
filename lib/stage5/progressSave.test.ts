import {
  createPendingInsert,
  createSingleFlight,
  insertProgressRowOnce,
  isDuplicateKeyError,
  toAssistProgress,
  type ProgressSubmission,
  type ProgressWriteResult,
  type SavedProgressRow,
} from './progressSave';

const SUBMISSION: ProgressSubmission = {
  userId: 'user-1',
  companyId: 'company-1',
  okrId: '11111111-1111-4111-8111-111111111111',
  content: '__META__:{}\n今週の進捗',
  score: 3,
};

function fakeProgressTable(opts: { loseResponseOnFirstInsert?: boolean; rejectNextInsert?: boolean } = {}) {
  const rows = new Map<string, SavedProgressRow>();
  let insertCalls = 0;
  let loseResponse = Boolean(opts.loseResponseOnFirstInsert);
  let rejectNext = Boolean(opts.rejectNextInsert);

  const deps = {
    insert: async (id: string, s: ProgressSubmission): Promise<ProgressWriteResult> => {
      insertCalls++;
      if (rejectNext) {
        rejectNext = false;
        return { data: null, error: { code: '42501', message: 'permission denied' } };
      }
      if (rows.has(id)) return { data: null, error: { code: '23505', message: 'duplicate key value' } };
      const row: SavedProgressRow = {
        id,
        user_id: s.userId,
        company_id: s.companyId,
        okr_id: s.okrId,
        content: s.content,
        score: s.score,
        created_at: '2026-11-14T00:00:00Z',
        status: null,
      };
      rows.set(id, row);
      if (loseResponse) {
        loseResponse = false;
        return { data: null, error: { code: '', message: 'network error after commit' } };
      }
      return { data: row, error: null };
    },
    fetchById: async (id: string): Promise<ProgressWriteResult> => {
      const row = rows.get(id);
      return row ? { data: row, error: null } : { data: null, error: { code: 'PGRST116', message: 'not found' } };
    },
  };

  return {
    deps,
    rows,
    get insertCalls() {
      return insertCalls;
    },
  };
}

describe('insertProgressRowOnce', () => {
  it('returns the saved row after a single insert', async () => {
    const table = fakeProgressTable();
    const outcome = await insertProgressRowOnce('row-1', SUBMISSION, table.deps);

    expect(outcome.ok).toBe(true);
    expect(table.rows.size).toBe(1);
    expect(table.insertCalls).toBe(1);
  });

  it('does not create a second row when the first response was lost and the same submission is retried', async () => {
    const table = fakeProgressTable({ loseResponseOnFirstInsert: true });

    expect((await insertProgressRowOnce('row-1', SUBMISSION, table.deps)).ok).toBe(false);
    expect((await insertProgressRowOnce('row-1', SUBMISSION, table.deps)).ok).toBe(true);
    expect(table.rows.size).toBe(1);
  });

  it('reports success on duplicate key only when the existing row matches the submission', async () => {
    const table = fakeProgressTable();
    await insertProgressRowOnce('row-1', SUBMISSION, table.deps);

    const again = await insertProgressRowOnce('row-1', SUBMISSION, table.deps);
    expect(again.ok).toBe(true);
    expect(table.rows.size).toBe(1);
  });

  it.each([
    ['content', { content: '別の本文' }],
    ['score', { score: 5 }],
    ['okr', { okrId: '22222222-2222-4222-8222-222222222222' }],
    ['company', { companyId: 'company-2' }],
    ['user', { userId: 'user-2' }],
  ])('does not treat a duplicate key as success when the %s differs', async (_label, change) => {
    const table = fakeProgressTable();
    await insertProgressRowOnce('row-1', SUBMISSION, table.deps);

    const outcome = await insertProgressRowOnce('row-1', { ...SUBMISSION, ...change }, table.deps);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect((outcome.error as { code?: string }).code).toBe('ID_CONFLICT');
    expect(table.rows.size).toBe(1);
  });

  it('fails closed when the submission has no company to compare against', async () => {
    const table = fakeProgressTable();
    await insertProgressRowOnce('row-1', SUBMISSION, table.deps);

    const outcome = await insertProgressRowOnce('row-1', { ...SUBMISSION, companyId: '' }, table.deps);
    expect(outcome.ok).toBe(false);
  });

  it('surfaces a non-duplicate error without retrying the insert', async () => {
    const table = fakeProgressTable({ rejectNextInsert: true });

    const outcome = await insertProgressRowOnce('row-1', SUBMISSION, table.deps);
    expect(outcome.ok).toBe(false);
    expect(table.insertCalls).toBe(1);
    expect(table.rows.size).toBe(0);
  });

  it('reports failure when a duplicate key cannot be confirmed by reading the row', async () => {
    const table = fakeProgressTable();
    await insertProgressRowOnce('row-1', SUBMISSION, table.deps);

    const outcome = await insertProgressRowOnce('row-1', SUBMISSION, {
      insert: table.deps.insert,
      fetchById: async () => ({ data: null, error: null }),
    });
    expect(outcome.ok).toBe(false);
  });
});

describe('createPendingInsert', () => {
  it('reuses the id and the first submission for the same key until settled', () => {
    let counter = 0;
    const pending = createPendingInsert(() => `id-${++counter}`);
    const build = jest.fn(() => SUBMISSION);

    const first = pending.attempt('checkin|same', build);
    const second = pending.attempt('checkin|same', () => ({ ...SUBMISSION, content: '時刻が変わった本文' }));

    expect(second.id).toBe(first.id);
    expect(second.submission).toBe(first.submission);
    expect(build).toHaveBeenCalledTimes(1);
  });

  it('issues a new id for a different key', () => {
    let counter = 0;
    const pending = createPendingInsert(() => `id-${++counter}`);

    expect(pending.attempt('checkin|a', () => SUBMISSION).id).toBe('id-1');
    expect(pending.attempt('checkin|b', () => SUBMISSION).id).toBe('id-2');
  });

  it('issues a new id after settle so a later identical memo is a new record', () => {
    let counter = 0;
    const pending = createPendingInsert(() => `id-${++counter}`);

    const first = pending.attempt('checkin|same', () => SUBMISSION).id;
    pending.settle();
    expect(pending.attempt('checkin|same', () => SUBMISSION).id).not.toBe(first);
  });

  it('keeps one row when the same submission is repeated after a lost response', async () => {
    let counter = 0;
    const pending = createPendingInsert(() => `id-${++counter}`);
    const table = fakeProgressTable({ loseResponseOnFirstInsert: true });

    const attempt = async () => {
      const { id, submission } = pending.attempt('checkin|same', () => SUBMISSION);
      const outcome = await insertProgressRowOnce(id, submission, table.deps);
      if (outcome.ok) pending.settle();
      return outcome;
    };

    expect((await attempt()).ok).toBe(false);
    expect((await attempt()).ok).toBe(true);
    expect(table.rows.size).toBe(1);
  });
});

describe('createSingleFlight', () => {
  it('runs a task only once while a previous run is still pending', async () => {
    const run = createSingleFlight();
    let calls = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const task = async () => {
      calls++;
      await gate;
    };

    const first = run(task);
    const second = run(task);
    release();
    await Promise.all([first, second]);
    expect(calls).toBe(1);

    await run(task);
    expect(calls).toBe(2);
  });
});

describe('isDuplicateKeyError', () => {
  it('matches only the unique violation code', () => {
    expect(isDuplicateKeyError({ code: '23505' })).toBe(true);
    expect(isDuplicateKeyError({ code: '42501' })).toBe(false);
    expect(isDuplicateKeyError(null)).toBe(false);
    expect(isDuplicateKeyError('23505')).toBe(false);
  });
});

describe('toAssistProgress', () => {
  it('converts a work progress percentage into the 0-1 ratio the assist API expects', () => {
    expect(toAssistProgress(80)).toBe(0.8);
    expect(toAssistProgress(0)).toBe(0);
    expect(toAssistProgress(150)).toBe(1);
    expect(toAssistProgress(-5)).toBe(0);
  });

  it('omits progress when the project has no work progress value', () => {
    expect(toAssistProgress(undefined)).toBeUndefined();
    expect(toAssistProgress(null)).toBeUndefined();
    expect(toAssistProgress(Number.NaN)).toBeUndefined();
  });
});
