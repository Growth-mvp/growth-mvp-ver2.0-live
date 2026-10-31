jest.mock('@/utils/supabase/client', () => {
  throw new Error('browser supabase client must not be loaded on the server');
});

const mockInsert = jest.fn();
const mockFrom = jest.fn((_table: string) => ({ insert: mockInsert }));
jest.mock('@/lib/supabaseAdmin', () => ({
  getSupabaseAdmin: () => ({ from: (table: string) => mockFrom(table) }),
}));

import { insertAgentLog } from './agentLogs';

const base = { userId: 'user-1', strategyId: 'strategy-1', step: 0, role: 'assistant' as const };

beforeEach(() => {
  jest.clearAllMocks();
});

describe('insertAgentLog', () => {
  it('サーバー用 admin クライアントで agent_logs に保存する', async () => {
    mockInsert.mockResolvedValueOnce({ error: null });

    await insertAgentLog({ ...base, content: 'requestId=r1 chars=10' });

    expect(mockFrom).toHaveBeenCalledWith('agent_logs');
    expect(mockInsert).toHaveBeenCalledWith([
      {
        user_id: 'user-1',
        strategy_id: 'strategy-1',
        step: 0,
        role: 'assistant',
        content: 'requestId=r1 chars=10',
      },
    ]);
  });

  it('保存に失敗したら例外を投げる（呼び出し側で握りつぶす）', async () => {
    jest.spyOn(console, 'error').mockImplementationOnce(() => undefined);
    mockInsert.mockResolvedValueOnce({ error: { message: 'insert failed' } });

    await expect(insertAgentLog({ ...base, content: 'x' })).rejects.toThrow('ログ保存に失敗しました');
  });
});
