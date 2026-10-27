/* eslint-disable @typescript-eslint/no-explicit-any -- Supabase クライアントのモックは意図的に緩く定義している */
jest.mock('server-only', () => ({}));

const resend = jest.fn();
jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(() => ({ auth: { resend } })),
}));

import { resendSignupConfirmation } from './signupConfirmation';
import { createClient } from '@supabase/supabase-js';

const REDIRECT = 'https://app.example/auth/callback?next=%2Finvite%2Faccept';

describe('resendSignupConfirmation（Supabase 標準の確認メール再送）', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://aaaaaaaaaaaaaaaaaaaa.supabase.co';
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = 'publishable-test-key';
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('成功したら sent を返し、確認のリダイレクト先を指定する（セッションは保持しない）', async () => {
    resend.mockResolvedValue({ error: null });

    const result = await resendSignupConfirmation('invitee@example.com', REDIRECT);

    expect(result).toBe('sent');
    expect(resend).toHaveBeenCalledWith({
      type: 'signup',
      email: 'invitee@example.com',
      options: { emailRedirectTo: REDIRECT },
    });
    expect(createClient).toHaveBeenCalledWith(
      expect.any(String),
      'publishable-test-key',
      expect.objectContaining({ auth: expect.objectContaining({ persistSession: false }) })
    );
  });

  it('Supabase の送信上限は rate_limited（応答は呼び出し側で同一にする）', async () => {
    resend.mockResolvedValue({ error: { code: 'over_email_send_rate_limit', status: 429 } });
    expect(await resendSignupConfirmation('invitee@example.com', REDIRECT)).toBe('rate_limited');
  });

  it('その他の失敗は failed', async () => {
    resend.mockResolvedValue({ error: { code: 'unexpected_failure', status: 500 } });
    expect(await resendSignupConfirmation('invitee@example.com', REDIRECT)).toBe('failed');
  });

  it('例外は failed（外に投げない）', async () => {
    resend.mockRejectedValue(new Error('network down'));
    expect(await resendSignupConfirmation('invitee@example.com', REDIRECT)).toBe('failed');
  });

  it('設定が無ければ送らず failed', async () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    expect(await resendSignupConfirmation('invitee@example.com', REDIRECT)).toBe('failed');
    expect(resend).not.toHaveBeenCalled();
  });
});
