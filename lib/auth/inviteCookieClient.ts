/**
 * 招待の一時Cookieを消す（ログアウト時に呼ぶ）。
 * 失敗しても続行する。Cookie は30分で失効し、招待メールと一致しない限り所属は作られない。
 */
export async function clearInviteCookie(fetchImpl: typeof fetch = fetch): Promise<void> {
  try {
    await fetchImpl('/api/invites/clear', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
      keepalive: true,
    });
  } catch {
    // 消去に失敗しても、ログアウト処理は止めない
  }
}
