/* DB層の保存関数で、企業スコープの不一致は書き込まずに失敗として返すことを確認する。Supabase 通信はすべてモック。 */

export {};

const dbCalls: string[] = [];
const recordingClient: any = new Proxy(
  {},
  {
    get(_t, prop) {
      dbCalls.push(String(prop));
      return recordingClient;
    },
    apply() {
      dbCalls.push('(call)');
      return recordingClient;
    },
  },
);

jest.mock('@/utils/supabase/client', () => ({
  supabase: recordingClient,
  getCompanyIdFromCookie: () => null,
  setCompanyIdCookie: () => {},
}));

jest.mock('@/utils/supabase/membership', () => ({
  getMembership: async () => null,
}));

/* eslint-disable @typescript-eslint/no-require-imports */
const { saveStrategyData } = require('@/utils/supabase/strategy');
/* eslint-enable @typescript-eslint/no-require-imports */

const USER = '11111111-1111-4111-8111-111111111111';
const COMPANY_A = 'a1000000-0000-4000-8000-000000000001';
const COMPANY_B = 'b1000000-0000-4000-8000-000000000002';

describe('DB層の保存：企業スコープの不一致', () => {
  beforeEach(() => {
    dbCalls.length = 0;
  });

  it('payloadの企業IDが保存先の企業と違うときは、書き込まず失敗として返す（成功として返さない）', async () => {
    const result: any = await saveStrategyData({ company_id: COMPANY_A, id: 'S-1', departments: [] }, USER, COMPANY_B, 3);

    expect(result.error).toBeTruthy();
    expect(result.error.code).toBe('SAVE_SCOPE_MISMATCH');
    expect(result.data ?? null).toBeNull();
    expect(dbCalls).toEqual([]);
  });
});
