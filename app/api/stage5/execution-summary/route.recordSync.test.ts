/* eslint-disable @typescript-eslint/no-explicit-any -- DB モックの型は意図的に緩く定義している */
jest.mock('server-only', () => ({}));
jest.mock('next/headers', () => ({
  headers: async () => {
    const h = new Headers();
    h.set('authorization', 'Bearer test-token');
    return h;
  },
}));
jest.mock('@supabase/supabase-js', () => ({ createClient: jest.fn() }));

import { NextRequest } from 'next/server';
import { GET } from './route';
import { createClient } from '@supabase/supabase-js';

const USER = '99999999-9999-4999-8999-999999999999';
const COMPANY = '11111111-1111-4111-8111-111111111111';
const OKR = '44444444-4444-4444-8444-444444444444';
const DEPT = 'dept-sales';
const PROJ = 'proj-renewal';
const META = `__META__:${JSON.stringify({ companyId: COMPANY, deptId: '営業部', projectId: '既存顧客の保守契約更新', okrId: OKR })}`;

const hoursAgo = (h: number) => new Date(Date.now() - h * 60 * 60 * 1000).toISOString();

function makeDb() {
  const db: Record<string, any[]> = {
    company_members: [{ user_id: USER, company_id: COMPANY }],
    okrs: [
      {
        id: OKR,
        company_id: COMPANY,
        department_id: DEPT,
        project_id: PROJ,
        objective: '既存顧客の保守契約更新',
        is_deleted: false,
      },
    ],
    progress_logs: [],
    strategy_data: [
      {
        company_id: COMPANY,
        departments: [{ id: DEPT, name: '営業部', projects: [{ id: PROJ, title: '既存顧客の保守契約更新' }] }],
      },
    ],
  };

  const from = (table: string) => {
    const filters: Array<(r: any) => boolean> = [];
    let sort: { col: string; ascending: boolean } | null = null;
    const rows = () => {
      const hit = (db[table] ?? []).filter((r) => filters.every((f) => f(r)));
      if (!sort) return hit;
      const { col, ascending } = sort;
      return [...hit].sort((a, b) => (String(a[col]) < String(b[col]) ? -1 : String(a[col]) > String(b[col]) ? 1 : 0) * (ascending ? 1 : -1));
    };
    const q: any = {
      select: () => q,
      eq: (col: string, val: unknown) => {
        filters.push((r) => r[col] === val);
        return q;
      },
      gte: (col: string, val: string) => {
        filters.push((r) => String(r[col]) >= val);
        return q;
      },
      order: (col: string, opts?: { ascending?: boolean }) => {
        sort = { col, ascending: opts?.ascending !== false };
        return q;
      },
      maybeSingle: async () => ({ data: rows()[0] ?? null, error: null }),
      single: async () => ({ data: rows()[0] ?? null, error: null }),
      then: (resolve: (v: unknown) => void, reject: (e: unknown) => void) =>
        Promise.resolve({ data: rows(), error: null, count: rows().length }).then(resolve, reject),
    };
    return q;
  };

  return { db, admin: { auth: { getUser: async () => ({ data: { user: { id: USER } }, error: null }) }, from } };
}

async function topSummaries(admin: unknown) {
  (createClient as jest.Mock).mockReturnValue(admin);
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://localhost:54321';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key';
  const res = await GET(new NextRequest(`http://localhost/api/stage5/execution-summary?companyId=${COMPANY}`));
  const json = await res.json();
  expect(json.ok).toBe(true);
  return (json.data.recentProjectUpdates as Array<{ projectId: string; latestSummary: string | null }>).map((u) => ({
    projectId: u.projectId,
    latestSummary: u.latestSummary,
  }));
}

describe('トップの「最近動きのあったプロジェクト」は、DBの現在の投稿を表示する', () => {
  it('投稿を保存すると、最新の本文を表示する', async () => {
    const { db, admin } = makeDb();
    db.progress_logs.push(
      { id: 'log-old', company_id: COMPANY, okr_id: OKR, user_id: USER, created_at: hoursAgo(2), content: `${META}\n旧の投稿`, score: null, status: null },
      { id: 'log-new', company_id: COMPANY, okr_id: OKR, user_id: USER, created_at: hoursAgo(1), content: `${META}\n新しい投稿`, score: null, status: null },
    );
    expect(await topSummaries(admin)).toEqual([{ projectId: PROJ, latestSummary: '新しい投稿' }]);
  });

  it('投稿を編集すると、トップも編集後の本文になり、古い本文は残らない', async () => {
    const { db, admin } = makeDb();
    db.progress_logs.push({ id: 'log-new', company_id: COMPANY, okr_id: OKR, user_id: USER, created_at: hoursAgo(1), content: `${META}\n新しい投稿`, score: null, status: null });
    expect((await topSummaries(admin))[0].latestSummary).toBe('新しい投稿');

    db.progress_logs[0].content = `${META}\n編集後の投稿`;
    const after = (await topSummaries(admin))[0].latestSummary;
    expect(after).toBe('編集後の投稿');
    expect(after).not.toContain('新しい投稿');
  });

  it('最新の投稿を削除すると、直前の投稿に戻り、削除した本文は出ない', async () => {
    const { db, admin } = makeDb();
    db.progress_logs.push(
      { id: 'log-old', company_id: COMPANY, okr_id: OKR, user_id: USER, created_at: hoursAgo(2), content: `${META}\n旧の投稿`, score: null, status: null },
      { id: 'log-new', company_id: COMPANY, okr_id: OKR, user_id: USER, created_at: hoursAgo(1), content: `${META}\n新しい投稿`, score: null, status: null },
    );
    db.progress_logs = db.progress_logs.filter((r) => r.id !== 'log-new');
    const after = await topSummaries(admin);
    expect(after).toEqual([{ projectId: PROJ, latestSummary: '旧の投稿' }]);
  });

  it('すべての投稿を削除すると、そのプロジェクトは最近の更新に出ない', async () => {
    const { db, admin } = makeDb();
    db.progress_logs.push({ id: 'log-only', company_id: COMPANY, okr_id: OKR, user_id: USER, created_at: hoursAgo(1), content: `${META}\n唯一の投稿`, score: null, status: null });
    db.progress_logs = [];
    expect(await topSummaries(admin)).toEqual([]);
  });
});
