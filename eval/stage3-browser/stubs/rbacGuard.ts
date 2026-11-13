/* 検証用の認証：Authorization: Bearer test:<利用者ID> をそのまま利用者として扱う（本番の認証は使わない） */
export async function getAuthUserIdFromBearer(_admin: unknown, req: Request): Promise<string | null> {
  const m = /^Bearer test:([0-9a-f-]{36})$/i.exec(req.headers.get('authorization') ?? '');
  return m ? m[1] : null;
}
