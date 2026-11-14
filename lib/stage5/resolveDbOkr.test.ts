import { resolveExistingDbOkrId, type DbOkrRow, type OkrReadDeps, type ResolveDbOkrInput } from './resolveDbOkr';

const UUID_A = '11111111-1111-4111-8111-111111111111';
const UUID_B = '22222222-2222-4222-8222-222222222222';

const baseInput: ResolveDbOkrInput = {
  objective: '売上を伸ばす',
  projectId: 'p1',
  companyId: 'c1',
  strategyId: 's1',
};

function readDeps(overrides: Partial<OkrReadDeps> = {}) {
  return {
    findOkrById: jest.fn(async (_id: string): Promise<string | null> => null),
    listProjectOkrs: jest.fn(async (_scope: { companyId: string; strategyId: string; projectId: string }): Promise<DbOkrRow[] | null> => []),
    ...overrides,
  };
}

const emptyCache = { dbOkrMap: {}, cachedRows: [] };

describe('resolveExistingDbOkrId', () => {
  it('returns a direct dbOkrId without any database read', async () => {
    const deps = readDeps();
    const result = await resolveExistingDbOkrId({ ...baseInput, dbOkrId: UUID_A }, emptyCache, deps);

    expect(result).toEqual({ id: UUID_A, direct: true });
    expect(deps.findOkrById).not.toHaveBeenCalled();
    expect(deps.listProjectOkrs).not.toHaveBeenCalled();
  });

  it('uses the in-memory map before reading the database', async () => {
    const deps = readDeps();
    const cache = {
      dbOkrMap: { 'c1::s1::p1::売上を伸ばす': UUID_B },
      cachedRows: [],
    };
    const result = await resolveExistingDbOkrId(baseInput, cache, deps);

    expect(result).toEqual({ id: UUID_B, direct: false });
    expect(deps.listProjectOkrs).not.toHaveBeenCalled();
  });

  it('matches a single cached row for the same project and objective', async () => {
    const deps = readDeps();
    const cache = {
      dbOkrMap: {},
      cachedRows: [{ id: UUID_A, objective: '  売上を伸ばす  ', project_id: 'p1' }],
    };
    const result = await resolveExistingDbOkrId(baseInput, cache, deps);

    expect(result?.id).toBe(UUID_A);
    expect(deps.listProjectOkrs).not.toHaveBeenCalled();
  });

  it('looks up UUID candidates by id and skips values that are not UUIDs', async () => {
    const deps = readDeps({
      findOkrById: jest.fn(async (id: string) => (id === UUID_B ? UUID_B : null)),
    });
    const result = await resolveExistingDbOkrId(
      { ...baseInput, progressOkrId: 'not-a-uuid', okrId: UUID_A, displayOkrId: UUID_B },
      emptyCache,
      deps,
    );

    expect(result).toEqual({ id: UUID_B, direct: false });
    expect(deps.findOkrById).toHaveBeenCalledWith(UUID_A);
    expect(deps.findOkrById).toHaveBeenCalledWith(UUID_B);
    expect(deps.findOkrById).not.toHaveBeenCalledWith('not-a-uuid');
  });

  it('resolves a unique project-scoped match ignoring surrounding whitespace', async () => {
    const deps = readDeps({
      listProjectOkrs: jest.fn(async () => [{ id: UUID_A, objective: '  売上を伸ばす  ', project_id: 'p1' }]),
    });
    const result = await resolveExistingDbOkrId(baseInput, emptyCache, deps);

    expect(result).toEqual({ id: UUID_A, direct: false });
    expect(deps.listProjectOkrs).toHaveBeenCalledWith({ companyId: 'c1', strategyId: 's1', projectId: 'p1' });
  });

  it('uses the only active OKR of the project when the objective text differs (structured KR selections)', async () => {
    const deps = readDeps({
      listProjectOkrs: jest.fn(async () => [{ id: UUID_A, objective: 'OKRの実際の目的文', project_id: 'p1' }]),
    });
    const result = await resolveExistingDbOkrId(baseInput, emptyCache, deps);

    expect(result).toEqual({ id: UUID_A, direct: false });
    expect(deps.listProjectOkrs).toHaveBeenCalledTimes(1);
  });

  it('returns null when the project has several OKRs and none matches the objective', async () => {
    const deps = readDeps({
      listProjectOkrs: jest.fn(async () => [
        { id: UUID_A, objective: '目的A' },
        { id: UUID_B, objective: '目的B' },
      ]),
    });

    expect(await resolveExistingDbOkrId(baseInput, emptyCache, deps)).toBeNull();
  });

  it('returns null when several project OKRs share the objective', async () => {
    const deps = readDeps({
      listProjectOkrs: jest.fn(async () => [
        { id: UUID_A, objective: '売上を伸ばす' },
        { id: UUID_B, objective: '売上を伸ばす' },
      ]),
    });

    expect(await resolveExistingDbOkrId(baseInput, emptyCache, deps)).toBeNull();
  });

  it('returns null when the project lookup fails', async () => {
    const deps = readDeps({ listProjectOkrs: jest.fn(async () => null) });

    expect(await resolveExistingDbOkrId(baseInput, emptyCache, deps)).toBeNull();
  });

  it('skips the project lookup when the scope is incomplete', async () => {
    const deps = readDeps();
    const result = await resolveExistingDbOkrId({ ...baseInput, companyId: '' }, emptyCache, deps);

    expect(result).toBeNull();
    expect(deps.listProjectOkrs).not.toHaveBeenCalled();
  });
});
