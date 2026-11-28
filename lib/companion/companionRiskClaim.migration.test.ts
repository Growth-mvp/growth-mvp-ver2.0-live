import fs from 'fs';
import path from 'path';

type PGliteType = import('@electric-sql/pglite').PGlite;

const SQL = fs.readFileSync(path.join(process.cwd(), 'supabase/migrations/20261128_create_companion_risk_claims.sql'), 'utf8');
const COMPANY_A = '11111111-1111-4111-8111-111111111111';
const COMPANY_B = '22222222-2222-4222-8222-222222222222';
const STRATEGY = '33333333-3333-4333-8333-333333333333';

async function expectFail(promise: Promise<unknown>, code?: string) {
  let error: any = null;
  try {
    await promise;
  } catch (e) {
    error = e;
  }
  expect(error).not.toBeNull();
  if (code) expect(error.code).toBe(code);
}

/* PGlite は動的 import を使うため、NODE_OPTIONS=--experimental-vm-modules と DB_MIGRATION_TEST=1 の時だけ実行する */
const describeDb = process.env.DB_MIGRATION_TEST === '1' ? describe : describe.skip;

describeDb('companion_risk_claims のマイグレーション（PostgreSQL互換エンジンで検証）', () => {
  let db: PGliteType;

  beforeAll(async () => {
    const { PGlite } = await import('@electric-sql/pglite');
    db = new PGlite();
    await db.exec(`
      create role anon nologin;
      create role authenticated nologin;
      create table public.companies (id uuid primary key);
      insert into public.companies values ('${COMPANY_A}'), ('${COMPANY_B}');
    `);
    await db.exec(SQL);
  }, 120_000);

  afterAll(async () => {
    await db.close();
  });

  const insert = (companyId: string, day: string, fingerprint = 'fp-1') =>
    db.query(
      `insert into public.companion_risk_claims (company_id, claim_date, strategy_id, facts_fingerprint)
       values ($1, $2, $3, $4)`,
      [companyId, day, STRATEGY, fingerprint],
    );

  it('一意制約：同じ企業・同じ日付の2件目は挿入できない（23505）', async () => {
    await insert(COMPANY_A, '2027-06-15');
    await expectFail(insert(COMPANY_A, '2027-06-15', 'fp-2'), '23505');
  });

  it('同じ日付でも企業が違えば別の枠、同じ企業でも日付が違えば別の枠', async () => {
    await insert(COMPANY_B, '2027-06-15');
    await insert(COMPANY_A, '2027-06-16');
    const { rows } = await db.query<{ n: number }>(
      `select count(*)::int as n from public.companion_risk_claims where company_id in ($1, $2)`,
      [COMPANY_A, COMPANY_B],
    );
    expect(rows[0].n).toBe(3);
  });

  it('並行に10件挿入しても、成功は1件だけ', async () => {
    const results = await Promise.allSettled(
      Array.from({ length: 10 }, (_, i) =>
        db.query(
          `insert into public.companion_risk_claims (company_id, claim_date, strategy_id, facts_fingerprint) values ($1, $2, $3, $4)`,
          [COMPANY_B, '2027-07-01', STRATEGY, `fp-${i}`],
        ),
      ),
    );
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  });

  it('値の範囲：状態・アクセス範囲・指紋・所見の長さを制限する', async () => {
    await expectFail(
      db.query(
        `insert into public.companion_risk_claims (company_id, claim_date, strategy_id, facts_fingerprint, status)
         values ($1, '2027-08-01', $2, 'x', 'UNKNOWN')`,
        [COMPANY_A, STRATEGY],
      ),
      '23514',
    );
    await expectFail(
      db.query(
        `insert into public.companion_risk_claims (company_id, claim_date, strategy_id, facts_fingerprint, access_scope)
         values ($1, '2027-08-02', $2, 'x', 'ALL_USERS')`,
        [COMPANY_A, STRATEGY],
      ),
      '23514',
    );
    await expectFail(
      db.query(
        `insert into public.companion_risk_claims (company_id, claim_date, strategy_id, facts_fingerprint, ai_finding)
         values ($1, '2027-08-03', $2, 'x', $3)`,
        [COMPANY_A, STRATEGY, 'あ'.repeat(4001)],
      ),
      '23514',
    );
  });

  it('列は必要最小限だけで、利用者の個人情報や相談履歴の列を持たない', async () => {
    const { rows } = await db.query<{ column_name: string }>(
      `select column_name from information_schema.columns where table_schema = 'public' and table_name = 'companion_risk_claims' order by ordinal_position`,
    );
    expect(rows.map((r) => r.column_name)).toEqual([
      'company_id',
      'claim_date',
      'strategy_id',
      'access_scope',
      'facts_fingerprint',
      'status',
      'ai_finding',
      'created_at',
      'updated_at',
    ]);
  });

  it('RLSが有効で、一般クライアント（anon・authenticated）は直接読み書きできない', async () => {
    const { rows } = await db.query<{ relrowsecurity: boolean }>(
      `select relrowsecurity from pg_class where relname = 'companion_risk_claims'`,
    );
    expect(rows[0].relrowsecurity).toBe(true);

    for (const role of ['anon', 'authenticated']) {
      await db.exec(`set role ${role}`);
      await expectFail(db.query(`select * from public.companion_risk_claims`), '42501');
      await expectFail(
        db.query(
          `insert into public.companion_risk_claims (company_id, claim_date, strategy_id, facts_fingerprint) values ($1, '2027-09-01', $2, 'x')`,
          [COMPANY_A, STRATEGY],
        ),
        '42501',
      );
      await db.exec('reset role');
    }
  });

  it('保存期間：30日より古い日付の行は purge で削除し、新しい行は残す', async () => {
    await insert(COMPANY_A, '2020-01-01', 'old');
    await insert(COMPANY_A, '2099-01-01', 'new');
    const { rows } = await db.query<{ n: number }>(`select public.purge_companion_risk_claims(30) as n`);
    expect(rows[0].n).toBeGreaterThanOrEqual(1);
    const remaining = await db.query<{ claim_date: string }>(
      `select claim_date::text as claim_date from public.companion_risk_claims where claim_date in ('2020-01-01', '2099-01-01')`,
    );
    expect(remaining.rows.map((r) => r.claim_date)).toEqual(['2099-01-01']);
  });
});
