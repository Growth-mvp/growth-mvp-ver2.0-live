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
page.on('response', (r) => { if (r.url().includes('/api/') && r.request().method() !== 'GET') calls.push(`${r.request().method()} ${r.status()} ${new URL(r.url()).pathname}`); });
await page.goto(`${BASE}/okr`, { waitUntil: 'networkidle', timeout: 120000 });
await page.waitForTimeout(4000);
await page.getByRole('button', { name: /新聞配達の時間・品質を守る/ }).first().click({ force: true });
await page.waitForTimeout(4000);
const startBtn = page.getByRole('button', { name: '実行を開始する' }).first();
const [res] = await Promise.all([
  page.waitForResponse((r) => r.url().includes('/api/stage4/') && r.request().method() !== 'GET', { timeout: 120000 }).catch(() => null),
  startBtn.click({ force: true }),
]);
await page.waitForTimeout(4000);
check('S4-S1 実行開始の保存API', !!res && [200, 201].includes(res.status()), res ? `status=${res.status()} ${new URL(res.url()).pathname}` : 'no response');
await page.reload({ waitUntil: 'networkidle', timeout: 120000 });
await page.waitForTimeout(3000);
await page.getByRole('button', { name: /新聞配達の時間・品質を守る/ }).first().click({ force: true });
await page.waitForTimeout(4000);
const t = await page.evaluate(() => document.body.innerText.replace(/\s+/g, ' '));
const started = /実行中|実行開始済み|実行を開始しました|開始済み/.test(t);
check('S4-S2 リロード後も実行開始の状態が保持', started, (t.match(/実行中|実行開始済み|開始済み|実行を開始しました/) || ['none'])[0]);
check('S4-E 通信とクラッシュ', !crashed, `crashed=${crashed} ${calls.join(' | ')}`);
fs.writeFileSync(path.join(dir, 'start-result.json'), JSON.stringify({ at: new Date().toISOString(), results, calls }, null, 2));
await ctx.close();
