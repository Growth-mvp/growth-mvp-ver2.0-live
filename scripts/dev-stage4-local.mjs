// テスト用：ローカルSupabase（日本製罐の複製は含まない架空のテストデータ）に接続して、新STAGE4の開発サーバーを起動する（http://localhost:3001）。
// 通常の作業環境は `npm run dev`（http://localhost:3000、本番Supabase）。
// 接続先は .env.stage4-local（Gitに含めない）の127.0.0.1のURLだけ。本番URLは拒否する。
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawn } from 'node:child_process';

const root = resolve(import.meta.dirname, '..');
const envPath = resolve(root, '.env.stage4-local');

if (!existsSync(envPath)) {
  console.error(`${envPath} がありません。次の値を1行ずつ書いて作成してください: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, SUPABASE_SERVICE_ROLE_KEY, PRODUCTION_SUPABASE_REF`);
  process.exit(1);
}

const parsed = Object.fromEntries(
  readFileSync(envPath, 'utf8')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
    .map((line) => {
      const i = line.indexOf('=');
      return [line.slice(0, i).trim(), line.slice(i + 1).trim()];
    })
);

const required = ['NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'PRODUCTION_SUPABASE_REF'];
const missing = required.filter((k) => !parsed[k]);
if (missing.length) {
  console.error(`.env.stage4-local に不足があります: ${missing.join(', ')}`);
  process.exit(1);
}

const isLoopback = (value) => {
  try {
    const u = new URL(value);
    return u.protocol === 'http:' && (u.hostname === '127.0.0.1' || u.hostname === 'localhost');
  } catch {
    return false;
  }
};
if (!isLoopback(parsed.NEXT_PUBLIC_SUPABASE_URL) || parsed.NEXT_PUBLIC_SUPABASE_URL !== parsed.SUPABASE_URL) {
  console.error('接続先は、両方とも同じ127.0.0.1（localhost）のローカルSupabaseでなければなりません。');
  process.exit(1);
}

const env = {
  ...process.env,
  NEXT_PUBLIC_SUPABASE_URL: parsed.NEXT_PUBLIC_SUPABASE_URL,
  SUPABASE_URL: parsed.SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: parsed.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  SUPABASE_SERVICE_ROLE_KEY: parsed.SUPABASE_SERVICE_ROLE_KEY,
  PRODUCTION_SUPABASE_REF: parsed.PRODUCTION_SUPABASE_REF,
  APP_ENV: 'development',
  EXPECTED_SUPABASE_REF: 'local',
  STAGE4_PLAN_API_ENABLED: 'true',
  STAGE4_PLAN_MODEL_MOCK: 'true',
  OPENAI_API_KEY: 'local-mock-not-used',
  NEXT_PUBLIC_STAGE4_DOCUMENT_SCREEN: 'true',
  NEXT_PUBLIC_STAGE4_PLAN_STORE: 'remote',
  NEXT_DIST_DIR: '.next-stage4-local',
};

console.log('新STAGE4（テスト用・ローカルSupabase）を起動します: http://localhost:3001/okr');
console.log('STAGE5: http://localhost:3001/execution');

const child = spawn('npx', ['next', 'dev', '-p', '3001'], { cwd: root, env, stdio: 'inherit', shell: true });
child.on('exit', (code) => process.exit(code ?? 0));
