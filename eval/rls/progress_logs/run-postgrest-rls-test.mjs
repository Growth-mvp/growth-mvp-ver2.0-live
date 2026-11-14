// progress_logs の RLS を、本番と同じ系統（PostgreSQL 17 ＋ PostgREST v12）で、HTTP API 経由に検証する（評価専用）。
// 本番には接続しない。JWT は検証用の秘密鍵で署名し、anon・authenticated・service_role をAPIから切り替えて使う。
// 必要な環境変数:
//   PG_ADMIN_URL  例: postgres://postgres@localhost:54330/postgres（検証用の空のクラスタ）
//   PGRST_BIN     PostgREST v12 の実行ファイル（例: postgrest.exe）
//   PG_MODULE     pg パッケージの場所（例: C:/.../node_modules/pg）。省略時は 'pg'
//   PG_BIN_DIR    libpq.dll を含む PostgreSQL の bin フォルダ（PostgREST の起動に必要）
// 実行: node eval/rls/progress_logs/run-postgrest-rls-test.mjs
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '..', '..', '..');
const PG_ADMIN_URL = process.env.PG_ADMIN_URL;
const PGRST_BIN = process.env.PGRST_BIN;
if (!PG_ADMIN_URL || !PGRST_BIN) {
  console.error('PG_ADMIN_URL と PGRST_BIN を設定してください（ファイル冒頭のコメント参照）。');
  process.exit(2);
}
const pgModule = await import(process.env.PG_MODULE ? pathToFileURL(process.env.PG_MODULE).href : 'pg');
const { Client } = pgModule.default ?? pgModule;

const FIX = path.join(here, 'fixtures');
const BASE = fs.readFileSync(path.join(FIX, 'base-schema.sql'), 'utf8');
const SHIM = fs.readFileSync(path.join(FIX, 'supabase-shim.sql'), 'utf8');
const LEGACY = path.join(FIX, 'legacy-permissive-policy.sql');
const MIGRATION = path.join(repo, 'supabase', 'pending', '20261114_progress_logs_rls_authorization.sql');
const ROLLBACK = path.join(repo, 'supabase', 'pending', '20261114_progress_logs_rls_authorization_rollback.sql');
const JWT_SECRET = 'postgrest-rls-test-secret-0123456789abcdef';
const AUTHENTICATOR_PW = 'authenticator-test-only';

const CO_X = '11111111-1111-4111-8111-111111111111';
const CO_Y = '22222222-2222-4222-8222-222222222222';
const ADM = '00000000-0000-4000-8000-0000000000a1';
const MGR = '00000000-0000-4000-8000-0000000000a2';
const A = '00000000-0000-4000-8000-0000000000a3';
const B = '00000000-0000-4000-8000-0000000000a4';
const YU = '00000000-0000-4000-8000-0000000000a5';
const OKR_X = '00000000-0000-4000-8000-0000000000b1';
const OKR_Y = '00000000-0000-4000-8000-0000000000b2';
const ROW_A = '00000000-0000-4000-8000-0000000000c1';
const ROW_B = '00000000-0000-4000-8000-0000000000c2';
const ROW_ADM_FB = '00000000-0000-4000-8000-0000000000c3';
const ROW_Y = '00000000-0000-4000-8000-0000000000c4';
const META = '__META__:{"companyId":"X","okrId":"b1"}';

const SEED = `
insert into auth.users(id) values ('${ADM}'),('${MGR}'),('${A}'),('${B}'),('${YU}');
insert into public.companies(id, name, created_by) values ('${CO_X}','X社','${ADM}'),('${CO_Y}','Y社','${YU}');
insert into public.company_members(company_id, user_id, role) values
  ('${CO_X}','${ADM}','admin'),('${CO_X}','${MGR}','manager'),('${CO_X}','${A}','member'),('${CO_X}','${B}','member'),('${CO_Y}','${YU}','member');
insert into public.okrs(id, company_id, project_id, objective) values
  ('${OKR_X}','${CO_X}','proj-x','既存顧客の保守契約更新'),('${OKR_Y}','${CO_Y}','proj-y','別社の案件');
insert into public.progress_logs(id, user_id, company_id, okr_id, content, created_at) values
  ('${ROW_A}','${A}','${CO_X}','${OKR_X}','Aの共有投稿', now() - interval '3 hours'),
  ('${ROW_B}','${B}','${CO_X}','${OKR_X}','Bの共有投稿', now() - interval '2 hours'),
  ('${ROW_ADM_FB}','${ADM}','${CO_X}','${OKR_X}','${META}
[FB]
Aさんへの見直し案', now() - interval '1 hour'),
  ('${ROW_Y}','${YU}','${CO_Y}','${OKR_Y}','Y社の共有投稿', now() - interval '30 minutes');
`;

const b64url = (buf) => Buffer.from(buf).toString('base64url');
function sign(claims) {
  const h = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const p = b64url(JSON.stringify({ ...claims, exp: Math.floor(Date.now() / 1000) + 3600 }));
  const s = crypto.createHmac('sha256', JWT_SECRET).update(`${h}.${p}`).digest('base64url');
  return `${h}.${p}.${s}`;
}

const urlFor = (db, user = 'postgres', pw = '') => {
  const u = new URL(PG_ADMIN_URL);
  u.pathname = `/${db}`;
  if (user !== 'postgres') { u.username = user; u.password = pw; }
  return u.toString();
};

async function adminExec(sql) {
  const c = new Client({ connectionString: PG_ADMIN_URL });
  await c.connect();
  try { return await c.query(sql); } finally { await c.end(); }
}

async function applyFiles(dbName, files) {
  const c = new Client({ connectionString: urlFor(dbName) });
  await c.connect();
  try {
    await c.query(BASE);
    await c.query(SHIM);
    await c.query(SEED);
    for (const f of files) await c.query(fs.readFileSync(f, 'utf8'));
  } finally { await c.end(); }
}

async function snapshotPolicies(dbName) {
  const c = new Client({ connectionString: urlFor(dbName) });
  await c.connect();
  try {
    const p = await c.query(`select policyname, cmd, roles, permissive, qual, with_check from pg_policies where tablename='progress_logs' order by policyname`);
    const s = await c.query(`select count(*)::int as n from pg_namespace where nspname='rls_private'`);
    return { policies: JSON.stringify(p.rows), privateSchema: s.rows[0].n };
  } finally { await c.end(); }
}

async function startPostgrest(dbName, port) {
  const conf = path.join(here, `_pgrst_${port}.conf`);
  fs.writeFileSync(conf, [
    `db-uri = "${urlFor(dbName, 'authenticator', AUTHENTICATOR_PW)}"`,
    'db-schemas = "public"',
    'db-anon-role = "anon"',
    `jwt-secret = "${JWT_SECRET}"`,
    `server-port = ${port}`,
    'log-level = "error"',
  ].join('\n'));
  const env = { ...process.env };
  if (process.env.PG_BIN_DIR) env.PATH = `${process.env.PG_BIN_DIR};${process.env.PATH}`;
  const child = spawn(PGRST_BIN, [conf], { stdio: ['ignore', 'pipe', 'pipe'], env });
  let stderr = '';
  child.stderr.on('data', (d) => { stderr += d.toString(); });
  const base = `http://localhost:${port}`;
  for (let i = 0; i < 150; i++) {
    try {
      const r = await fetch(base + '/progress_logs?select=id&limit=1', { headers: { Authorization: `Bearer ${sign({ role: 'service_role' })}` } });
      if (r.status === 200) break;
    } catch { /* 起動中 */ }
    if (i === 149) throw new Error('PostgREST が準備できません: ' + stderr.slice(0, 300));
    await new Promise((r) => setTimeout(r, 200));
  }
  return { child, base, conf, stderr: () => stderr };
}

async function stopPostgrest(p) {
  await new Promise((resolve) => {
    p.child.once('exit', resolve);
    setTimeout(resolve, 3000);
    p.child.kill();
  });
  try { fs.unlinkSync(p.conf); } catch { /* ignore */ }
}

async function api(base, method, p, { who = 'anon', body, prefer, profile } = {}) {
  const headers = {};
  if (who === 'service') headers.Authorization = `Bearer ${sign({ role: 'service_role' })}`;
  else if (who !== 'anon') headers.Authorization = `Bearer ${sign({ role: 'authenticated', sub: who })}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (prefer) headers.Prefer = prefer;
  if (profile) { headers['Accept-Profile'] = profile; headers['Content-Profile'] = profile; }
  const res = await fetch(base + p, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { json = null; }
  return { status: res.status, json, text };
}

const ok2xx = (r) => r.status >= 200 && r.status < 300;
const rows = (r) => (Array.isArray(r.json) ? r.json : []);
const wrote = (r) => ok2xx(r) && rows(r).length > 0;
const errText = (r) => (r.json?.message ?? r.text ?? '').slice(0, 140);

function scenariosFor(q) {
  const dbRow = async (id) => (await q(`select id, user_id, company_id, okr_id, content, created_at from public.progress_logs where id = $1`, [id])).rows[0] ?? null;
  const patch = (base, who, id, body) => api(base, 'PATCH', `/progress_logs?id=eq.${id}`, { who, body, prefer: 'return=representation' });
  const del = (base, who, id) => api(base, 'DELETE', `/progress_logs?id=eq.${id}`, { who, prefer: 'return=representation' });
  const post = (base, who, body) => api(base, 'POST', '/progress_logs', { who, body, prefer: 'return=representation' });
  return [
    ['A-1', '社員A: 自分の記録を作成できる', 'allow', async (base, s) => {
      const r = await post(base, A, { user_id: A, company_id: CO_X, okr_id: OKR_X, content: 'Aの新規投稿' });
      s.newA = rows(r)[0]?.id;
      return { granted: wrote(r), detail: errText(r) };
    }],
    ['A-2', '社員A: 自分の記録を編集できる', 'allow', async (base, s) => {
      const r = await patch(base, A, s.newA, { content: 'Aの編集後' });
      return { granted: wrote(r), detail: errText(r) };
    }],
    ['A-3', '社員A: 自分の記録を削除できる', 'allow', async (base, s) => {
      const r = await del(base, A, s.newA);
      return { granted: wrote(r), detail: errText(r) };
    }],
    ['A-4', '社員A: 同じ会社の社員Bの記録を閲覧できる', 'allow', async (base) => {
      const r = await api(base, 'GET', `/progress_logs?id=eq.${ROW_B}&select=id`, { who: A });
      return { granted: rows(r).length === 1, detail: errText(r) };
    }],
    ['A-5', '社員A: 社員Bの記録を編集できない', 'deny', async (base) => {
      const r = await patch(base, A, ROW_B, { content: 'Aが書換' });
      return { granted: wrote(r) || (await dbRow(ROW_B))?.content === 'Aが書換', detail: errText(r) || `更新行数 ${rows(r).length}` };
    }],
    ['A-6', '社員A: 社員Bの記録を削除できない', 'deny', async (base) => {
      const r = await del(base, A, ROW_B);
      return { granted: wrote(r) || !(await dbRow(ROW_B)), detail: errText(r) || `削除行数 ${rows(r).length}` };
    }],
    ['A-7', '社員A: 社員Bのuser_idを指定して投稿できない', 'deny', async (base) => {
      const r = await post(base, A, { user_id: B, company_id: CO_X, okr_id: OKR_X, content: 'なりすまし' });
      return { granted: wrote(r), detail: errText(r) };
    }],
    ['A-8', '社員A: 自分の記録の投稿者を社員Bに付け替えられない', 'deny', async (base) => {
      const r = await patch(base, A, ROW_A, { user_id: B });
      return { granted: wrote(r) || (await dbRow(ROW_A))?.user_id === B, detail: errText(r) || `更新行数 ${rows(r).length}` };
    }],
    ['F-1', '管理者: 自分のフィードバックを作成できる', 'allow', async (base, s) => {
      const r = await post(base, ADM, { user_id: ADM, company_id: CO_X, okr_id: OKR_X, content: `${META}\n[FB]\n来週は対象を3件に絞りましょう` });
      s.fb = rows(r)[0]?.id;
      return { granted: wrote(r), detail: errText(r) };
    }],
    ['F-2', '管理者: 自分のフィードバックを編集できる', 'allow', async (base, s) => {
      const r = await patch(base, ADM, s.fb, { content: '[FB]\nさらに修正' });
      return { granted: wrote(r), detail: errText(r) };
    }],
    ['F-3', '管理者: 自分のフィードバックを削除できる', 'allow', async (base, s) => {
      const r = await del(base, ADM, s.fb);
      return { granted: wrote(r), detail: errText(r) };
    }],
    ['F-4', 'マネージャー: フィードバックを作成できない', 'deny', async (base) => {
      const r = await post(base, MGR, { user_id: MGR, company_id: CO_X, okr_id: OKR_X, content: '[FB]\nマネージャーの指摘' });
      return { granted: wrote(r), detail: errText(r) };
    }],
    ['F-5', '社員A: フィードバックを作成できない（メタ情報付きでも）', 'deny', async (base) => {
      const r = await post(base, A, { user_id: A, company_id: CO_X, okr_id: OKR_X, content: `${META}\n[FB]\n自作のフィードバック` });
      return { granted: wrote(r), detail: errText(r) };
    }],
    ['F-6', '社員A: 自分の共有記録をフィードバックに書き換えられない', 'deny', async (base) => {
      const r = await patch(base, A, ROW_A, { content: '[FB]\n書換' });
      return { granted: wrote(r), detail: errText(r) };
    }],
    ['F-7', '管理者: 社員Bの記録を編集できない', 'deny', async (base) => {
      const r = await patch(base, ADM, ROW_B, { content: '管理者が書換' });
      return { granted: wrote(r), detail: errText(r) || `更新行数 ${rows(r).length}` };
    }],
    ['F-8', 'マネージャー: 管理者のフィードバックを編集・削除できない', 'deny', async (base) => {
      const u = await patch(base, MGR, ROW_ADM_FB, { content: 'マネージャーが書換' });
      const d = await del(base, MGR, ROW_ADM_FB);
      return { granted: wrote(u) || wrote(d), detail: errText(u) || errText(d) || `更新 ${rows(u).length} / 削除 ${rows(d).length}` };
    }],
    ['F-9', '社員A: 管理者のフィードバックを削除できない', 'deny', async (base) => {
      const r = await del(base, A, ROW_ADM_FB);
      return { granted: wrote(r) || !(await dbRow(ROW_ADM_FB)), detail: errText(r) || `削除行数 ${rows(r).length}` };
    }],
    ['R-1', '社員A: 同じ会社の共有記録（全社共有の一覧）を読める', 'allow', async (base) => {
      const r = await api(base, 'GET', `/progress_logs?select=id,content,user_id&company_id=eq.${CO_X}&okr_id=eq.${OKR_X}&order=created_at.desc&limit=20`, { who: A });
      const ids = rows(r).map((x) => x.id);
      return { granted: ok2xx(r) && ids.includes(ROW_B) && ids.includes(ROW_ADM_FB), detail: errText(r) || `${ids.length}件` };
    }],
    ['R-2', 'Y社の社員: X社の記録を閲覧できない', 'deny', async (base) => {
      const r = await api(base, 'GET', `/progress_logs?select=id&company_id=eq.${CO_X}`, { who: YU });
      return { granted: rows(r).length > 0, detail: errText(r) || `${rows(r).length}件` };
    }],
    ['R-3', 'Y社の社員: X社の記録を編集・削除できない', 'deny', async (base) => {
      const u = await patch(base, YU, ROW_A, { content: 'Y社が書換' });
      const d = await del(base, YU, ROW_A);
      return { granted: wrote(u) || wrote(d), detail: errText(u) || errText(d) || `更新 ${rows(u).length} / 削除 ${rows(d).length}` };
    }],
    ['R-4', 'X社の社員: Y社の会社IDで記録を作成できない', 'deny', async (base) => {
      const r = await post(base, A, { user_id: A, company_id: CO_Y, okr_id: OKR_Y, content: '他社への投稿' });
      return { granted: wrote(r), detail: errText(r) };
    }],
    ['R-5', 'X社の社員: X社の記録に他社のOKRを紐づけて作成できない', 'deny', async (base) => {
      const r = await post(base, A, { user_id: A, company_id: CO_X, okr_id: OKR_Y, content: '他社OKRへの投稿' });
      return { granted: wrote(r), detail: errText(r) };
    }],
    ['R-6', 'X社の社員: 自分の記録を他社に移せない', 'deny', async (base) => {
      const r = await patch(base, A, ROW_A, { company_id: CO_Y });
      return { granted: wrote(r) || (await dbRow(ROW_A))?.company_id === CO_Y, detail: errText(r) || `更新行数 ${rows(r).length}` };
    }],
    ['R-7', '社員A: 紐づくOKRのない記録を作成できない', 'deny', async (base) => {
      const r = await post(base, A, { user_id: A, company_id: CO_X, okr_id: null, content: 'OKRなし' });
      return { granted: wrote(r), detail: errText(r) };
    }],
    ['R-8', '社員A: 記録の作成日時を書き換えられない', 'deny', async (base) => {
      const r = await patch(base, A, ROW_A, { created_at: '2000-01-01T00:00:00Z' });
      return { granted: wrote(r) || String((await dbRow(ROW_A))?.created_at).startsWith('2000'), detail: errText(r) || `更新行数 ${rows(r).length}` };
    }],
    ['R-9', '社員A: 他社の記録と同じIDで作成して上書きできない', 'deny', async (base) => {
      const r = await post(base, A, { id: ROW_Y, user_id: A, company_id: CO_X, okr_id: OKR_X, content: '上書き' });
      return { granted: wrote(r) || (await dbRow(ROW_Y))?.content === '上書き', detail: errText(r) };
    }],
    ['P-1', 'anon（未ログイン）: 進捗記録を読めない', 'deny', async (base) => {
      const r = await api(base, 'GET', `/progress_logs?select=id&limit=5`, { who: 'anon' });
      return { granted: rows(r).length > 0, detail: errText(r) || `${rows(r).length}件` };
    }],
    ['P-2', '社員A: 非公開スキーマ（rls_private）の関数を API から呼べない', 'deny', async (base) => {
      const r = await api(base, 'POST', '/rpc/is_member', { who: A, body: { p_company_id: CO_X }, profile: 'rls_private' });
      return { granted: ok2xx(r), detail: errText(r) || `HTTP ${r.status}` };
    }],
    ['P-3', 'anon（未ログイン）: 既存の判定関数（public の SECURITY DEFINER）を呼べない', 'deny', async (base) => {
      const r = await api(base, 'POST', '/rpc/is_company_member', { who: 'anon', body: { p_company_id: CO_X } });
      return { granted: ok2xx(r), detail: errText(r) || `HTTP ${r.status}` };
    }],
    ['P-4', '社員A: 既存の判定関数を正規に使える（authenticated）', 'allow', async (base) => {
      const r = await api(base, 'POST', '/rpc/is_company_member', { who: A, body: { p_company_id: CO_X } });
      return { granted: ok2xx(r) && r.json === true, detail: errText(r) || `結果 ${r.json}` };
    }],
    ['S-1', 'サービス経路（トップ画面の集計・AI相談）: 会社の記録を集計できる', 'allow', async (base) => {
      const r = await api(base, 'GET', `/progress_logs?select=id&company_id=eq.${CO_X}`, { who: 'service' });
      return { granted: ok2xx(r) && rows(r).length >= 3, detail: errText(r) || `${rows(r).length}件` };
    }],
    ['S-2', '権限を失った管理者は、過去のフィードバックを編集できない', 'deny', async (base) => {
      await api(base, 'PATCH', `/company_members?company_id=eq.${CO_X}&user_id=eq.${ADM}`, { who: 'service', body: { role: 'member' }, prefer: 'return=representation' });
      const r = await patch(base, ADM, ROW_ADM_FB, { content: '権限喪失後の書換' });
      return { granted: wrote(r), detail: errText(r) || `更新行数 ${rows(r).length}` };
    }],
    ['S-3', 'サービス経路（delete-all 等の管理処理）: 会社の記録を削除できる', 'allow', async (base) => {
      const r = await del(base, 'service', ROW_Y);
      return { granted: wrote(r), detail: errText(r) || `削除行数 ${rows(r).length}` };
    }],
  ];
}

async function aclChecks(c, applicable) {
  if (!applicable) return [];
  const r = await c.query(`select p.proname, coalesce(p.proacl::text, '') as acl from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'rls_private' order by 1`);
  const helpers = ['is_member', 'is_admin', 'okr_in_company', 'is_feedback'];
  const publicOrAnon = (acl) => /[{,]=X\//.test(acl) || /[{,]anon=X\//.test(acl);
  const bad = r.rows.filter((x) => publicOrAnon(x.acl)
    || (helpers.includes(x.proname) ? !/[{,]authenticated=X\//.test(x.acl) : /[{,]authenticated=X\//.test(x.acl)));
  const ok = r.rows.length === 5 && bad.length === 0;
  return [{ id: 'ACL-1', name: 'rls_private: 判定関数は authenticated だけが実行でき、トリガー関数は利用者に実行させない（PUBLIC・anon は不可）', expect: 'allow', granted: ok, pass: ok, detail: JSON.stringify(r.rows.map((x) => [x.proname, x.acl])) }];
}

async function runScenarios(base, q) {
  const s = {};
  const out = [];
  for (const [id, name, expect, fn] of scenariosFor(q)) {
    let res;
    try { res = await fn(base, s); } catch (e) { res = { granted: false, detail: `例外: ${e.message}` }; }
    out.push({ id, name, expect, granted: res.granted, pass: expect === 'allow' ? res.granted : !res.granted, detail: res.detail ?? '' });
  }
  return out;
}

function printTable(title, rs) {
  console.log(`\n== ${title}`);
  for (const r of rs) {
    const verdict = r.pass ? 'OK  ' : 'NG  ';
    const want = r.expect === 'allow' ? '許可' : '拒否';
    const got = r.granted ? '実行された' : '拒否された';
    const note = !r.pass || /^(P-|ACL|S-3)/.test(r.id) ? `｜${r.detail}` : '';
    console.log(`${verdict} ${r.id.padEnd(4)} ${r.name}｜期待: ${want}／結果: ${got}${note}`);
  }
  const ng = rs.filter((r) => !r.pass).length;
  console.log(`-- ${rs.length - ng}/${rs.length} 一致${ng ? `（不一致 ${ng}件）` : ''}`);
  return ng;
}

const phases = [
  { id: 'p1', title: 'フェーズ1: 現行ポリシー（修正前。本番と同じ経路で脆弱性を再現）', files: [], strict: false, port: 3311 },
  { id: 'p2', title: 'フェーズ2: 修正案（API 経由）', files: [MIGRATION], strict: true, port: 3312 },
  { id: 'p2b', title: 'フェーズ2b: 修正案＋残存していた全件許可の旧ポリシー（API 経由）', files: [LEGACY, MIGRATION], strict: true, port: 3313 },
];

let failed = 0;
const snapshots = {};
const stamp = Date.now();
for (const ph of phases) {
  const dbName = `rls_${ph.id}_${stamp}`;
  await adminExec(`create database ${dbName}`);
  await applyFiles(dbName, ph.files);
  snapshots[ph.id] = await snapshotPolicies(dbName);
  const pgrst = await startPostgrest(dbName, ph.port);
  try {
    const c = new Client({ connectionString: urlFor(dbName) });
    await c.connect();
    const q = (sql, params) => c.query(sql, params);
    const rs = await runScenarios(pgrst.base, q);
    rs.push(...(await aclChecks(c, ph.strict)));
    await c.end();
    const ng = printTable(ph.title, rs);
    if (ph.strict) failed += ng;
  } finally {
    await stopPostgrest(pgrst);
    await adminExec(`drop database if exists ${dbName} with (force)`);
  }
}

// 切り戻し：適用後に切り戻すと、ポリシーと非公開スキーマが適用前の状態に戻ること
{
  const dbName = `rls_rb_${stamp}`;
  await adminExec(`create database ${dbName}`);
  await applyFiles(dbName, [MIGRATION, ROLLBACK]);
  const after = await snapshotPolicies(dbName);
  await adminExec(`drop database if exists ${dbName} with (force)`);
  const same = after.policies === snapshots.p1.policies;
  const schemaGone = after.privateSchema === 0;
  console.log('\n== 切り戻し（修正案 → 切り戻し）');
  console.log(`${same && schemaGone ? 'OK  ' : 'NG  '} RB-1 ポリシーが適用前と一致する: ${same}／rls_private が消えている: ${schemaGone}`);
  if (!(same && schemaGone)) failed += 1;
}

// 参考: 旧ポリシーが残っていた環境で切り戻すと、修正案が削除した旧ポリシーは戻らない（切り戻しの範囲の限界）
{
  const pre = `rls_rb2pre_${stamp}`;
  const post = `rls_rb2_${stamp}`;
  await adminExec(`create database ${pre}`);
  await adminExec(`create database ${post}`);
  await applyFiles(pre, [LEGACY]);
  await applyFiles(post, [LEGACY, MIGRATION, ROLLBACK]);
  const beforeLegacy = await snapshotPolicies(pre);
  const afterLegacy = await snapshotPolicies(post);
  await adminExec(`drop database if exists ${pre} with (force)`);
  await adminExec(`drop database if exists ${post} with (force)`);
  console.log('\n== 参考（判定には含めない）');
  console.log(`情報 RB-2 旧ポリシーがあった環境では、切り戻しで旧ポリシーは戻らない（事前に定義を保存する必要がある）: ${beforeLegacy.policies !== afterLegacy.policies}`);
}

console.log(failed === 0 ? '\n修正案のフェーズ・切り戻しはすべて期待どおりです。' : `\n修正案のフェーズ・切り戻しで不一致 ${failed}件。`);
process.exit(failed === 0 ? 0 : 1);
