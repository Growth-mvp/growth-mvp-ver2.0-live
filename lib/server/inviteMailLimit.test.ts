/* eslint-disable @typescript-eslint/no-explicit-any -- DB モックの型は意図的に緩く定義している */
jest.mock('server-only', () => ({}));
jest.mock('@/lib/server/auditLog', () => ({ logAuditEvent: jest.fn(async () => true) }));

import { isInviteMailAllowed, recordInviteMail, MAIL_LIMIT_MAX } from './inviteMailLimit';
import { logAuditEvent } from '@/lib/server/auditLog';

function adminWithCount(count: number | null, error: unknown = null) {
  const chain: any = {};
  chain.select = () => chain;
  chain.eq = () => chain;
  chain.gte = async () => ({ count, error });
  return { from: jest.fn(() => chain) } as any;
}

describe('isInviteMailAllowed（招待ごとの送信上限）', () => {
  it('上限未満なら送信できる', async () => {
    expect(await isInviteMailAllowed(adminWithCount(MAIL_LIMIT_MAX - 1), 'inv-1')).toBe(true);
  });

  it('上限に達していたら送信しない', async () => {
    expect(await isInviteMailAllowed(adminWithCount(MAIL_LIMIT_MAX), 'inv-1')).toBe(false);
  });

  it('集計に失敗したら送信しない（安全側）', async () => {
    expect(await isInviteMailAllowed(adminWithCount(null, { code: 'x' }), 'inv-1')).toBe(false);
  });
});

describe('recordInviteMail', () => {
  it('送信の種類だけを監査ログに残す（宛先や本文は残さない）', async () => {
    await recordInviteMail('inv-1', 'resend');
    expect(logAuditEvent).toHaveBeenCalledWith({
      action: 'invite_confirmation_mail',
      targetType: 'invite',
      targetId: 'inv-1',
      metadata: { kind: 'resend' },
    });
  });
});
