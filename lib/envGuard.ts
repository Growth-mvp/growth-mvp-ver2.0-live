/**
 * 接続先チェック。開発・ステージング環境から本番 Supabase への誤接続を防ぐ。
 * - サーバー（SUPABASE_URL）とブラウザ（NEXT_PUBLIC_SUPABASE_URL）の URL が同じプロジェクトを指すこと。
 * - APP_ENV と EXPECTED_SUPABASE_REF、PRODUCTION_SUPABASE_REF の関係が正しいこと。
 * - service role キーが公開用の変数に入っていないこと。
 * 注意: ユーザーの JWT の ref クレームは使わない（プロジェクトの ref を含まない署名方式があるため）。
 * 例外・ログには変数名と理由だけを出し、URL・キー・JWT の値は出さない。
 */

export const APP_ENVS = ['development', 'staging', 'production'] as const;
export type AppEnv = (typeof APP_ENVS)[number];

export const REQUIRED_ENV_NAMES = [
  'APP_ENV',
  'EXPECTED_SUPABASE_REF',
  'PRODUCTION_SUPABASE_REF',
  'NEXT_PUBLIC_SUPABASE_URL',
  'SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
] as const;

export type NamedUrl = { name: string; value: string | undefined };

export type SupabaseTargetInput = {
  appEnv: string | undefined;
  urls: NamedUrl[];
  expectedRef: string | undefined;
  productionRef: string | undefined;
};

export type SupabaseTargetReason =
  | 'invalid_app_env'
  | 'missing_url'
  | 'invalid_url'
  | 'url_mismatch'
  | 'missing_expected_ref'
  | 'missing_production_ref'
  | 'ref_mismatch'
  | 'production_ref_in_non_production'
  | 'not_production_ref';

export type SupabaseTargetResult =
  | { ok: true; ref: string }
  | { ok: false; reason: SupabaseTargetReason; detail?: string };

export type EnvCheckReason =
  | SupabaseTargetReason
  | 'missing_env'
  | 'service_key_exposed'
  | 'vercel_env_mismatch';

export type EnvCheckResult =
  | { ok: true; ref: string }
  | { ok: false; reason: EnvCheckReason; detail?: string };

/** https://<ref>.supabase.co から ref を取り出す。取り出せなければ null。 */
export function supabaseRefFromUrl(url: string | undefined): string | null {
  if (!url) return null;
  try {
    const host = new URL(url).hostname;
    const match = /^([a-z0-9]{20})\.supabase\.co$/.exec(host);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

export function checkSupabaseTarget(input: SupabaseTargetInput): SupabaseTargetResult {
  if (!input.appEnv || !(APP_ENVS as readonly string[]).includes(input.appEnv)) {
    return { ok: false, reason: 'invalid_app_env' };
  }

  const refs: { name: string; ref: string }[] = [];
  for (const u of input.urls) {
    if (!u.value) return { ok: false, reason: 'missing_url', detail: u.name };
    const ref = supabaseRefFromUrl(u.value);
    if (!ref) return { ok: false, reason: 'invalid_url', detail: u.name };
    refs.push({ name: u.name, ref });
  }
  if (refs.length === 0) return { ok: false, reason: 'missing_url' };

  const ref = refs[0].ref;
  const mismatch = refs.find((r) => r.ref !== ref);
  if (mismatch) return { ok: false, reason: 'url_mismatch', detail: mismatch.name };

  if (!input.productionRef) return { ok: false, reason: 'missing_production_ref' };
  if (!input.expectedRef) return { ok: false, reason: 'missing_expected_ref' };

  if (input.appEnv === 'production') {
    if (ref !== input.productionRef) return { ok: false, reason: 'not_production_ref' };
    if (ref !== input.expectedRef) return { ok: false, reason: 'ref_mismatch' };
    return { ok: true, ref };
  }

  if (ref === input.productionRef) return { ok: false, reason: 'production_ref_in_non_production' };
  if (ref !== input.expectedRef) return { ok: false, reason: 'ref_mismatch' };
  return { ok: true, ref };
}

type Env = Record<string, string | undefined>;

/** 起動時に読む環境変数の全体を検証する（同期。通信はしない） */
export function checkSupabaseEnv(env: Env): EnvCheckResult {
  for (const name of REQUIRED_ENV_NAMES) {
    if (!env[name]) return { ok: false, reason: 'missing_env', detail: name };
  }

  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY as string;
  for (const [name, value] of Object.entries(env)) {
    if (!name.startsWith('NEXT_PUBLIC_') || !value) continue;
    if (name.includes('SERVICE_ROLE') || value === serviceKey) {
      return { ok: false, reason: 'service_key_exposed', detail: name };
    }
  }

  const target = checkSupabaseTarget({
    appEnv: env.APP_ENV,
    urls: [
      { name: 'NEXT_PUBLIC_SUPABASE_URL', value: env.NEXT_PUBLIC_SUPABASE_URL },
      { name: 'SUPABASE_URL', value: env.SUPABASE_URL },
    ],
    expectedRef: env.EXPECTED_SUPABASE_REF,
    productionRef: env.PRODUCTION_SUPABASE_REF,
  });
  if (!target.ok) return target;

  // VERCEL_ENV は Vercel が自動で設定する。未設定（ローカル等）では判定しない。
  const vercelEnv = env.VERCEL_ENV;
  if (vercelEnv) {
    const productionDeployment = vercelEnv === 'production';
    const productionTarget = env.APP_ENV === 'production';
    if (productionDeployment !== productionTarget) {
      return { ok: false, reason: 'vercel_env_mismatch', detail: 'VERCEL_ENV' };
    }
  }

  return { ok: true, ref: target.ref };
}

/** 検証に失敗したら、変数名と理由だけを含む例外を投げる（値は含めない） */
export function assertSupabaseEnv(env: Env): { ref: string } {
  const result = checkSupabaseEnv(env);
  if (!result.ok) {
    const detail = result.detail ? ` (${result.detail})` : '';
    throw new Error(`envGuard: ${result.reason}${detail}`);
  }
  return { ref: result.ref };
}

export type KeyCheckResult = { ok: true } | { ok: false; reason: 'key_rejected' | 'key_check_unavailable'; detail: string };

/**
 * 公開キーと service role キーが、この URL のプロジェクトで有効かを確認する。
 * 非本番（development / staging）でだけ使う。キーの値は返さない・ログに出さない。
 * 注意: エンドポイントの挙動はステージングで確認すること（要確認）。
 */
export async function verifySupabaseKeys(params: {
  url: string;
  publishableKey: string;
  serviceRoleKey: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}): Promise<KeyCheckResult> {
  const fetchImpl = params.fetchImpl ?? fetch;
  const base = params.url.replace(/\/+$/, '');
  const timeout = params.timeoutMs ?? 5000;

  const probe = async (path: string, headers: Record<string, string>) => {
    try {
      const res = await fetchImpl(`${base}${path}`, {
        method: 'GET',
        headers,
        signal: AbortSignal.timeout(timeout),
        cache: 'no-store',
      });
      return res.ok ? 'ok' : 'rejected';
    } catch {
      return 'unavailable';
    }
  };

  const anon = await probe('/auth/v1/settings', { apikey: params.publishableKey });
  if (anon === 'unavailable') return { ok: false, reason: 'key_check_unavailable', detail: 'publishable' };
  if (anon === 'rejected') return { ok: false, reason: 'key_rejected', detail: 'publishable' };

  const service = await probe('/auth/v1/admin/users?per_page=1', {
    apikey: params.serviceRoleKey,
    Authorization: `Bearer ${params.serviceRoleKey}`,
  });
  if (service === 'unavailable') return { ok: false, reason: 'key_check_unavailable', detail: 'service_role' };
  if (service === 'rejected') return { ok: false, reason: 'key_rejected', detail: 'service_role' };

  return { ok: true };
}
