import { clearInviteCookie } from './inviteCookieClient';

describe('clearInviteCookie（ログアウト時の招待Cookie消去）', () => {
  it('同一オリジンの JSON 要求として /api/invites/clear を呼ぶ', async () => {
    const fetchMock = jest.fn(async () => new Response(null, { status: 200 }));

    await clearInviteCookie(fetchMock as unknown as typeof fetch);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/invites/clear');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json');
  });

  it('通信に失敗しても例外を投げず、ログアウトを止めない', async () => {
    const fetchMock = jest.fn(async () => {
      throw new Error('offline');
    });

    await expect(clearInviteCookie(fetchMock as unknown as typeof fetch)).resolves.toBeUndefined();
  });
});
