const COMPANY = '11111111-1111-4111-8111-111111111111';
const USER = '99999999-9999-4999-8999-999999999999';
const STRATEGY = '22222222-2222-4222-8222-222222222222';

const state: { strategyRow: { data: unknown; error: unknown }; writes: Array<{ table: string; op: string; payload: any }> } = {
  strategyRow: { data: null, error: null },
  writes: [],
};

jest.mock('./client', () => {
  const builder = (table: string) => {
    let op = 'select';
    const b: any = {
      select: () => b,
      eq: () => b,
      limit: () => b,
      insert: (payload: any) => {
        op = 'insert';
        state.writes.push({ table, op, payload });
        return b;
      },
      update: (payload: any) => {
        op = 'update';
        state.writes.push({ table, op, payload });
        return b;
      },
      maybeSingle: async () => {
        if (table === 'strategy_data' && op === 'select') return state.strategyRow;
        return { data: null, error: null };
      },
    };
    return b;
  };
  return {
    supabase: { from: (table: string) => builder(table) },
    getCompanyIdFromCookie: () => null,
    setCompanyIdCookie: () => undefined,
    isValidUUID: (v: unknown) => typeof v === 'string' && v.length === 36,
  };
});

import { saveFinalStory } from './strategy';

describe('saveFinalStory', () => {
  beforeEach(() => {
    state.writes = [];
    state.strategyRow = { data: null, error: null };
  });

  it('final_stories に strategy_data の戦略IDを渡して保存する', async () => {
    state.strategyRow = { data: { id: STRATEGY }, error: null };

    const res = await saveFinalStory(USER, [{ title: '1章', body: '本文' }], { companyId: COMPANY, writeCookie: false });

    expect(res.ok).toBe(true);
    const write = state.writes.find((w) => w.table === 'final_stories');
    expect(write?.payload).toMatchObject({ company_id: COMPANY, strategy_id: STRATEGY });
  });

  it('戦略行が無い企業では final_stories に書き込まずエラーを返す', async () => {
    state.strategyRow = { data: null, error: null };

    const res = await saveFinalStory(USER, [{ title: '1章', body: '本文' }], { companyId: COMPANY, writeCookie: false });

    expect(res.ok).toBe(false);
    expect(state.writes.some((w) => w.table === 'final_stories')).toBe(false);
  });
});
