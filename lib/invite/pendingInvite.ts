export type InviteRole = 'admin' | 'manager' | 'member';

export type PendingInvite =
  | { status: 'accepted'; companyId: string; role: InviteRole }
  | { status: 'none' }
  | { status: 'review' };

function isUuid(v: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
}

/**
 * 招待Cookieが残っていれば受諾する。本人確認・メール一致・メール認証の検査は /api/invites/complete が行う。
 * 招待情報が無い（404）のときだけ none、それ以外の失敗は review として受諾画面で詳細を示す。
 */
export async function acceptPendingInvite(
  accessToken: string,
  fetchImpl: typeof fetch = fetch,
): Promise<PendingInvite> {
  try {
    const res = await fetchImpl('/api/invites/complete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({}),
    });
    if (res.status === 404) return { status: 'none' };
    const data = await res.json().catch(() => ({}));
    if (res.ok && isUuid(String(data?.companyId ?? ''))) {
      return { status: 'accepted', companyId: data.companyId, role: (data.role as InviteRole) ?? 'member' };
    }
    return { status: 'review' };
  } catch {
    return { status: 'review' };
  }
}
