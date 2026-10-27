/**
 * MFA（TOTP）の操作。Supabase の auth.mfa と同じ形の最小インターフェースに依存する（テスト可能にするため）。
 * QR コード・secret・認証コードはログに出さない。戻り値として画面に渡すだけ。
 */

export type MfaErrorCode =
  | 'invalid_format'
  | 'invalid_code'
  | 'rate_limited'
  | 'already_enrolled'
  | 'needs_aal2'
  | 'unknown';

export type MfaResult<T> = { ok: true; data: T } | { ok: false; code: MfaErrorCode };

type SupabaseLikeResponse = { data: any; error: any };

export interface MfaClient {
  enroll(params: { factorType: 'totp'; friendlyName?: string }): Promise<SupabaseLikeResponse>;
  listFactors(): Promise<SupabaseLikeResponse>;
  challenge(params: { factorId: string }): Promise<SupabaseLikeResponse>;
  verify(params: { factorId: string; challengeId: string; code: string }): Promise<SupabaseLikeResponse>;
  challengeAndVerify(params: { factorId: string; code: string }): Promise<SupabaseLikeResponse>;
  unenroll(params: { factorId: string }): Promise<SupabaseLikeResponse>;
}

export type EnrollmentStatus =
  | { kind: 'enrolled'; factorId: string }
  | { kind: 'pending'; factorId: string }
  | { kind: 'none' };

const CODE_PATTERN = /^\d{6}$/;
const FRIENDLY_NAME = 'GROWTH SHIFT';

export function isValidCode(code: string): boolean {
  return CODE_PATTERN.test(code);
}

function isRateLimited(error: any): boolean {
  const status = typeof error?.status === 'number' ? error.status : undefined;
  const code = typeof error?.code === 'string' ? error.code : '';
  return status === 429 || code.includes('rate');
}

function mapVerifyError(error: any): MfaErrorCode {
  return isRateLimited(error) ? 'rate_limited' : 'invalid_code';
}

function mapGeneralError(): MfaErrorCode {
  return 'unknown';
}

export async function getEnrollmentStatus(client: MfaClient): Promise<MfaResult<EnrollmentStatus>> {
  const res = await client.listFactors();
  if (res.error) return { ok: false, code: mapGeneralError() };

  const totp: any[] = Array.isArray(res.data?.totp) ? res.data.totp : [];
  const verified = totp.find((f) => f?.status === 'verified');
  if (verified) return { ok: true, data: { kind: 'enrolled', factorId: verified.id } };

  const all: any[] = Array.isArray(res.data?.all) ? res.data.all : [];
  const pending = all.find((f) => f?.factor_type === 'totp' && f?.status !== 'verified');
  if (pending) return { ok: true, data: { kind: 'pending', factorId: pending.id } };

  return { ok: true, data: { kind: 'none' } };
}

/** 途中で止まった未検証の登録を破棄する（新しく登録し直す前に呼ぶ） */
export async function discardPendingEnrollment(client: MfaClient): Promise<MfaResult<void>> {
  const status = await getEnrollmentStatus(client);
  if (!status.ok) return status;
  if (status.data.kind !== 'pending') return { ok: true, data: undefined };

  const res = await client.unenroll({ factorId: status.data.factorId });
  if (res.error) return { ok: false, code: mapGeneralError() };
  return { ok: true, data: undefined };
}

export type EnrollmentStart = { factorId: string; qrCode: string; secret: string };

export async function startEnrollment(client: MfaClient): Promise<MfaResult<EnrollmentStart>> {
  const status = await getEnrollmentStatus(client);
  if (!status.ok) return status;
  if (status.data.kind === 'enrolled') return { ok: false, code: 'already_enrolled' };

  const discarded = await discardPendingEnrollment(client);
  if (!discarded.ok) return discarded;

  const res = await client.enroll({ factorType: 'totp', friendlyName: FRIENDLY_NAME });
  if (res.error || !res.data?.id || !res.data?.totp) return { ok: false, code: mapGeneralError() };

  return {
    ok: true,
    data: {
      factorId: res.data.id,
      qrCode: res.data.totp.qr_code,
      secret: res.data.totp.secret,
    },
  };
}

/** 登録の確定：challenge → verify。成功すると、セッションは aal2 になる。 */
export async function confirmEnrollment(client: MfaClient, factorId: string, code: string): Promise<MfaResult<void>> {
  if (!isValidCode(code)) return { ok: false, code: 'invalid_format' };

  const challenge = await client.challenge({ factorId });
  if (challenge.error || !challenge.data?.id) return { ok: false, code: mapGeneralError() };

  const verified = await client.verify({ factorId, challengeId: challenge.data.id, code });
  if (verified.error) return { ok: false, code: mapVerifyError(verified.error) };

  return { ok: true, data: undefined };
}

/** 検証済みの要素での追加認証：challengeAndVerify。成功すると、セッションは aal2 になる。 */
export async function verifyChallenge(client: MfaClient, factorId: string, code: string): Promise<MfaResult<void>> {
  if (!isValidCode(code)) return { ok: false, code: 'invalid_format' };

  const res = await client.challengeAndVerify({ factorId, code });
  if (res.error) return { ok: false, code: mapVerifyError(res.error) };

  return { ok: true, data: undefined };
}

/** 検証済みの要素の解除。Supabase の仕様で、解除には aal2（追加認証済み）が必要。 */
export async function unenrollFactor(client: MfaClient, factorId: string): Promise<MfaResult<void>> {
  const res = await client.unenroll({ factorId });
  if (!res.error) return { ok: true, data: undefined };

  const status = typeof res.error?.status === 'number' ? res.error.status : undefined;
  const code = typeof res.error?.code === 'string' ? res.error.code : '';
  if (status === 401 || status === 403 || code.includes('aal')) return { ok: false, code: 'needs_aal2' };
  return { ok: false, code: 'unknown' };
}

/** 追加認証で使う、検証済みの要素の ID */
export async function getVerifiedFactorId(client: MfaClient): Promise<MfaResult<string | null>> {
  const status = await getEnrollmentStatus(client);
  if (!status.ok) return status;
  return { ok: true, data: status.data.kind === 'enrolled' ? status.data.factorId : null };
}
