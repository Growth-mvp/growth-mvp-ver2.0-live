import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { BASE, PROFILE_DIR, RUN_DIR } from './common.mjs';
const dir = path.join(RUN_DIR, 'stage4'); fs.mkdirSync(dir, { recursive: true });
const results = [];
const check = (id, ok, detail = '') => { results.push({ id, ok, detail }); console.log(`CHECK ${ok ? 'PASS' : 'FAIL'} ${id} ${detail}`); };
const ctx = await chromium.launchPersistentContext(PROFILE_DIR, { headless: true, viewport: { width: 1400, height: 900 } });
const page = ctx.pages()[0] ?? (await ctx.newPage());
let crashed = false;
page.on('crash', () => { crashed = true; });
const calls = [];
page.on('response', (r) => { if (r.url().includes('/api/') && r.request().method() === 'POST') calls.push(`${r.status()} ${new URL(r.url()).pathname}`); });
await page.goto(`${BASE}/okr`, { waitUntil: 'networkidle', timeout: 120000 });
await page.waitForTimeout(5000);
await page.getByRole('button', { name: /新聞配達の時間・品質を守る/ }).first().click({ force: true });
await page.waitForTimeout(4000);
const gen = page.getByRole('button', { name: /AIで実行計画書を作成|もう一度作る/ }).first();
check('S4-1 実行計画書の生成ボタン', (await gen.count()) > 0);
const [res] = await Promise.all([
  page.waitForResponse((r) => r.url().includes('/api/stage4/') && r.request().method() === 'POST', { timeout: 300000 }).catch(() => null),
  gen.click({ force: true }),
]);
check('S4-2 実行計画書の生成API', !!res && [200,201].includes(res.status()), res ? `status=${res.status()} ${new URL(res.url()).pathname}` : 'no response');
await page.waitForTimeout(10000);
const txt = await page.evaluate(() => document.body.innerText.replace(/\s+/g, ' '));
const i = txt.indexOf('実行計画書');
check('S4-3 実行計画書が画面に表示', txt.includes('実行計画書') && !/まだ作成されていません/.test(txt.slice(i, i + 200)), txt.slice(i, i + 160));
await page.screenshot({ path: path.join(dir, '01-plan-generated.png'), fullPage: true });
console.log('CALLS', JSON.stringify(calls), 'crashed', crashed);
fs.writeFileSync(path.join(dir, 'plan-result.json'), JSON.stringify({ at: new Date().toISOString(), results, calls, crashed }, null, 2));
await ctx.close();
