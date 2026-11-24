import { acceptPendingInvite } from './pendingInvite';

const COMPANY = '56fa94c7-cb5e-4f1c-bd79-0ec8e167c6e3';

function fetchReturning(status: number, body: unknown) {
  return jest.fn().mockResolvedValue({
    status,
    ok: status >= 200 && status < 300,
    json: async () => body,
  }) as unknown as typeof fetch;
}

describe('acceptPendingInvite', () => {
  it('posts with the bearer token and accepts when the server returns a company', async () => {
    const f = fetchReturning(200, { ok: true, companyId: COMPANY, role: 'admin' });
    const result = await acceptPendingInvite('tok', f);
    expect(result).toEqual({ status: 'accepted', companyId: COMPANY, role: 'admin' });
    const [url, init] = (f as unknown as jest.Mock).mock.calls[0];
    expect(url).toBe('/api/invites/complete');
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe('Bearer tok');
  });

  it('returns none when there is no invite cookie (404)', async () => {
    const f = fetchReturning(404, { error: 'invite_not_found' });
    expect(await acceptPendingInvite('tok', f)).toEqual({ status: 'none' });
  });

  it('returns review for other failures so the invite page can explain them', async () => {
    expect(await acceptPendingInvite('tok', fetchReturning(403, { error: 'email_mismatch' }))).toEqual({ status: 'review' });
    expect(await acceptPendingInvite('tok', fetchReturning(401, { error: 'unauthorized' }))).toEqual({ status: 'review' });
  });

  it('returns review when a success response has no valid company id', async () => {
    expect(await acceptPendingInvite('tok', fetchReturning(200, { ok: true, companyId: 'x' }))).toEqual({ status: 'review' });
  });

  it('returns review on network failure', async () => {
    const f = jest.fn().mockRejectedValue(new TypeError('network')) as unknown as typeof fetch;
    expect(await acceptPendingInvite('tok', f)).toEqual({ status: 'review' });
  });
});
