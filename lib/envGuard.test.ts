import {
  assertSupabaseEnv,
  checkSupabaseEnv,
  checkSupabaseTarget,
  supabaseRefFromUrl,
  verifySupabaseKeys,
} from './envGuard';

const PROD = 'aaaaaaaaaaaaaaaaaaaa';
const STAGING = 'bbbbbbbbbbbbbbbbbbbb';
const OTHER = 'cccccccccccccccccccc';
const prodUrl = `https://${PROD}.supabase.co`;
const stagingUrl = `https://${STAGING}.supabase.co`;
const PUB = 'publishable-key-value-AAA';
const SRV = 'service-role-key-value-BBB';

const stagingEnv = (over: Record<string, string | undefined> = {}): Record<string, string | undefined> => ({
  APP_ENV: 'staging',
  EXPECTED_SUPABASE_REF: STAGING,
  PRODUCTION_SUPABASE_REF: PROD,
  NEXT_PUBLIC_SUPABASE_URL: stagingUrl,
  SUPABASE_URL: stagingUrl,
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: PUB,
  SUPABASE_SERVICE_ROLE_KEY: SRV,
  ...over,
});

const both = (serverUrl: string | undefined, publicUrl: string | undefined) => [
  { name: 'NEXT_PUBLIC_SUPABASE_URL', value: publicUrl },
  { name: 'SUPABASE_URL', value: serverUrl },
];

const targetInput = (urls = both(stagingUrl, stagingUrl)) => ({
  appEnv: 'staging',
  urls,
  expectedRef: STAGING,
  productionRef: PROD,
});

describe('supabaseRefFromUrl', () => {
  it('Supabase の URL から ref を取り出す', () => {
    expect(supabaseRefFromUrl(prodUrl)).toBe(PROD);
  });

  it('形式が違う URL からは取り出さない', () => {
    expect(supabaseRefFromUrl(undefined)).toBeNull();
    expect(supabaseRefFromUrl('http://localhost:54321')).toBeNull();
    expect(supabaseRefFromUrl('https://example.com')).toBeNull();
    expect(supabaseRefFromUrl('not a url')).toBeNull();
  });
});

describe('checkSupabaseTarget（URL と ref の関係）', () => {
  it('サーバーとブラウザの URL が同じ期待するプロジェクトなら通す', () => {
    expect(checkSupabaseTarget(targetInput())).toEqual({ ok: true, ref: STAGING });
  });

  it('サーバーとブラウザの URL が違うプロジェクトなら拒否する（url_mismatch）', () => {
    expect(checkSupabaseTarget(targetInput(both(prodUrl, stagingUrl)))).toEqual({
      ok: false,
      reason: 'url_mismatch',
      detail: 'SUPABASE_URL',
    });
  });

  it('片方の URL が未設定なら拒否する（missing_url）', () => {
    expect(checkSupabaseTarget(targetInput(both(undefined, stagingUrl)))).toEqual({
      ok: false,
      reason: 'missing_url',
      detail: 'SUPABASE_URL',
    });
  });

  it('URL の形式が不正なら拒否する（invalid_url）', () => {
    expect(checkSupabaseTarget(targetInput(both('https://example.com', stagingUrl)))).toEqual({
      ok: false,
      reason: 'invalid_url',
      detail: 'SUPABASE_URL',
    });
  });

  it('期待するプロジェクトと違う接続先は拒否する（ref_mismatch）', () => {
    expect(checkSupabaseTarget({ ...targetInput(), expectedRef: OTHER })).toEqual({ ok: false, reason: 'ref_mismatch' });
  });

  it('非本番から本番の ref への接続は、期待値の設定に関係なく拒否する', () => {
    const urls = both(prodUrl, prodUrl);
    expect(checkSupabaseTarget({ ...targetInput(urls), expectedRef: PROD })).toEqual({
      ok: false,
      reason: 'production_ref_in_non_production',
    });
  });

  it('本番の ref が未設定なら拒否する', () => {
    expect(checkSupabaseTarget({ ...targetInput(), productionRef: undefined })).toEqual({
      ok: false,
      reason: 'missing_production_ref',
    });
  });

  it('期待する ref が未設定なら、本番でも拒否する', () => {
    expect(
      checkSupabaseTarget({ appEnv: 'production', urls: both(prodUrl, prodUrl), expectedRef: undefined, productionRef: PROD })
    ).toEqual({ ok: false, reason: 'missing_expected_ref' });
  });

  it('本番は本番の ref に一致する場合だけ通す', () => {
    expect(
      checkSupabaseTarget({ appEnv: 'production', urls: both(prodUrl, prodUrl), expectedRef: PROD, productionRef: PROD })
    ).toEqual({ ok: true, ref: PROD });
  });

  it('本番のアプリが別の ref を指していれば拒否する', () => {
    expect(
      checkSupabaseTarget({ appEnv: 'production', urls: both(stagingUrl, stagingUrl), expectedRef: STAGING, productionRef: PROD })
    ).toEqual({ ok: false, reason: 'not_production_ref' });
  });

  it('APP_ENV が不明・未設定なら拒否する', () => {
    expect(checkSupabaseTarget({ ...targetInput(), appEnv: undefined })).toEqual({ ok: false, reason: 'invalid_app_env' });
    expect(checkSupabaseTarget({ ...targetInput(), appEnv: 'prod' })).toEqual({ ok: false, reason: 'invalid_app_env' });
  });
});

describe('checkSupabaseEnv（起動時の環境変数の全体）', () => {
  it('ステージングの変数が揃い、一致していれば通す', () => {
    expect(checkSupabaseEnv(stagingEnv())).toEqual({ ok: true, ref: STAGING });
  });

  it.each([
    'APP_ENV',
    'EXPECTED_SUPABASE_REF',
    'PRODUCTION_SUPABASE_REF',
    'NEXT_PUBLIC_SUPABASE_URL',
    'SUPABASE_URL',
    'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
    'SUPABASE_SERVICE_ROLE_KEY',
  ])('必要な変数 %s が無ければ停止する（missing_env）', (name) => {
    expect(checkSupabaseEnv(stagingEnv({ [name]: undefined }))).toEqual({ ok: false, reason: 'missing_env', detail: name });
    expect(checkSupabaseEnv(stagingEnv({ [name]: '' }))).toEqual({ ok: false, reason: 'missing_env', detail: name });
  });

  it('service role キーの値が公開用の変数に入っていれば拒否する', () => {
    expect(checkSupabaseEnv(stagingEnv({ NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: SRV }))).toEqual({
      ok: false,
      reason: 'service_key_exposed',
      detail: 'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
    });
  });

  it('NEXT_PUBLIC_ に service role を含む名前の変数があれば拒否する', () => {
    expect(checkSupabaseEnv(stagingEnv({ NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY: 'x' }))).toEqual({
      ok: false,
      reason: 'service_key_exposed',
      detail: 'NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY',
    });
  });

  it('サーバー側の変数（非公開）に service role がある場合は問題にしない', () => {
    expect(checkSupabaseEnv(stagingEnv()).ok).toBe(true);
  });

  it('サーバーの URL が本番を指していれば拒否する（誤接続の検出）', () => {
    expect(checkSupabaseEnv(stagingEnv({ SUPABASE_URL: prodUrl }))).toEqual({
      ok: false,
      reason: 'url_mismatch',
      detail: 'SUPABASE_URL',
    });
  });
});

describe('checkSupabaseEnv（VERCEL_ENV との整合）', () => {
  const productionEnv = (over: Record<string, string | undefined> = {}) =>
    stagingEnv({
      APP_ENV: 'production',
      EXPECTED_SUPABASE_REF: PROD,
      NEXT_PUBLIC_SUPABASE_URL: prodUrl,
      SUPABASE_URL: prodUrl,
      ...over,
    });

  it('本番のデプロイが本番のプロジェクトを指していれば通す', () => {
    expect(checkSupabaseEnv(productionEnv({ VERCEL_ENV: 'production' }))).toEqual({ ok: true, ref: PROD });
  });

  it('Preview のデプロイが本番のプロジェクトを指していれば拒否する', () => {
    expect(checkSupabaseEnv(productionEnv({ VERCEL_ENV: 'preview' }))).toEqual({
      ok: false,
      reason: 'vercel_env_mismatch',
      detail: 'VERCEL_ENV',
    });
  });

  it('本番のデプロイがステージングのプロジェクトを指していれば拒否する', () => {
    expect(checkSupabaseEnv(stagingEnv({ VERCEL_ENV: 'production' }))).toEqual({
      ok: false,
      reason: 'vercel_env_mismatch',
      detail: 'VERCEL_ENV',
    });
  });

  it('Preview のデプロイがステージングを指すのは通す', () => {
    expect(checkSupabaseEnv(stagingEnv({ VERCEL_ENV: 'preview' }))).toEqual({ ok: true, ref: STAGING });
  });

  it('VERCEL_ENV が無い（ローカル等）場合はこの規則を判定しない', () => {
    expect(checkSupabaseEnv(productionEnv())).toEqual({ ok: true, ref: PROD });
  });
});

describe('assertSupabaseEnv（停止のための例外）', () => {
  it('問題が無ければ例外を投げない', () => {
    expect(assertSupabaseEnv(stagingEnv())).toEqual({ ref: STAGING });
  });

  it('問題があれば、変数名と理由だけを含む例外を投げ、値（URL・キー）を含めない', () => {
    const env = stagingEnv({ SUPABASE_URL: prodUrl });
    let message = '';
    try {
      assertSupabaseEnv(env);
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).toContain('url_mismatch');
    expect(message).toContain('SUPABASE_URL');
    expect(message).not.toContain(PROD);
    expect(message).not.toContain(SRV);
    expect(message).not.toContain(PUB);
  });
});

describe('verifySupabaseKeys（キーが、この URL のプロジェクトで有効か）', () => {
  const okFetch = (async () => new Response('{}', { status: 200 })) as unknown as typeof fetch;

  it('両方のキーが有効なら ok', async () => {
    const res = await verifySupabaseKeys({ url: stagingUrl, publishableKey: PUB, serviceRoleKey: SRV, fetchImpl: okFetch });
    expect(res).toEqual({ ok: true });
  });

  it('公開キーが拒否されたら key_rejected（キーの値は返さない）', async () => {
    const fetchImpl = (async (_u: unknown, init: any) =>
      init.headers.apikey === PUB ? new Response('', { status: 401 }) : new Response('{}', { status: 200 })) as unknown as typeof fetch;
    const res = await verifySupabaseKeys({ url: stagingUrl, publishableKey: PUB, serviceRoleKey: SRV, fetchImpl });
    expect(res).toEqual({ ok: false, reason: 'key_rejected', detail: 'publishable' });
    expect(JSON.stringify(res)).not.toContain(PUB);
  });

  it('service role キーが拒否されたら key_rejected', async () => {
    const fetchImpl = (async (url: string) =>
      url.includes('/admin/') ? new Response('', { status: 403 }) : new Response('{}', { status: 200 })) as unknown as typeof fetch;
    const res = await verifySupabaseKeys({ url: stagingUrl, publishableKey: PUB, serviceRoleKey: SRV, fetchImpl });
    expect(res).toEqual({ ok: false, reason: 'key_rejected', detail: 'service_role' });
  });

  it('通信できなければ key_check_unavailable（安全側で停止する）', async () => {
    const fetchImpl = (async () => {
      throw new Error('offline');
    }) as unknown as typeof fetch;
    const res = await verifySupabaseKeys({ url: stagingUrl, publishableKey: PUB, serviceRoleKey: SRV, fetchImpl });
    expect(res).toEqual({ ok: false, reason: 'key_check_unavailable', detail: 'publishable' });
  });

  it('確認の通信先は、指定された URL のプロジェクトだけ', async () => {
    const calls: string[] = [];
    const fetchImpl = (async (url: string) => {
      calls.push(url);
      return new Response('{}', { status: 200 });
    }) as unknown as typeof fetch;
    await verifySupabaseKeys({ url: `${stagingUrl}/`, publishableKey: PUB, serviceRoleKey: SRV, fetchImpl });
    expect(calls.every((u) => u.startsWith(`${stagingUrl}/auth/v1/`))).toBe(true);
  });
});
