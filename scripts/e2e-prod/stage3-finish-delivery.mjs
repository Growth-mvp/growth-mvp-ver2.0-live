import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { BASE, PROFILE_DIR, RUN_DIR } from './common.mjs';
const ANSWER = '配達稼働に余裕がある時間帯に限り、採算が見込める宅配案件だけを受注する。';
const dir = path.join(RUN_DIR, 'stage3');
const results = [];
const check = (id, ok, detail = '') => { results.push({ id, ok, detail }); console.log(`CHECK ${ok ? 'PASS' : 'FAIL'} ${id} ${detail}`); };
const ctx = await chromium.launchPersistentContext(PROFILE_DIR, { headless: true, viewport: { width: 1400, height: 900 } });
const page = ctx.pages()[0] ?? (await ctx.newPage());
const calls = [];
page.on('response', (r) => { const u = r.url(); if (u.includes('/api/') && r.request().method() === 'POST') calls.push(`${r.status()} ${new URL(u).pathname}`); });
await page.goto(`${BASE}/cascade`, { waitUntil: 'networkidle', timeout: 120000 });
await page.waitForTimeout(2500);
await page.getByRole('button', { name: '宅配事業', exact: true }).first().click();
await page.waitForTimeout(2000);
await page.getByRole('button', { name: /STEP2 6つの問い/ }).first().click({ force: true });
await page.waitForTimeout(2500);
await page.getByRole('button', { name: /^Q4 未生成/ }).first().click({ force: true });
await page.waitForTimeout(1500);
const gen = page.getByRole('button', { name: 'このテーマを生成' }).first();
check('S3-Q4 生成ボタンが表示', (await gen.count()) > 0);
const [res] = await Promise.all([
  page.waitForResponse((r) => r.url().includes('/api/generate-department-question') && r.request().method() === 'POST', { timeout: 240000 }).catch(() => null),
  gen.click({ force: true }),
]);
check('S3-Q4 問いの生成（generate-department-question）', !!res && res.status() === 200, res ? `status=${res.status()}` : 'no response');
await page.waitForTimeout(2000);
const box = page.locator('textarea:visible').last();
await box.fill(ANSWER);
await page.waitForTimeout(2500);
const statuses = await page.evaluate(() => [...new Set([...document.querySelectorAll('button')].map((x) => x.innerText.replace(/\s+/g, ' ').trim()).filter((t) => /^Q\d /.test(t)))].map((t) => t.slice(-6)));
check('S3-Q 宅配事業: 6問が回答済み', statuses.length === 6 && statuses.every((s) => s.includes('回答済み')), JSON.stringify(statuses));
const regen = page.getByRole('button', { name: '6問を反映して戦略書を再生成' }).first();
const [rres] = await Promise.all([
  page.waitForResponse((r) => r.url().includes('/api/generate-cascade') || r.url().includes('/api/stage3/'), { timeout: 420000 }).catch(() => null),
  regen.click({ force: true }),
]);
check('S3-R 宅配事業: 再生成APIが成功', !!rres && rres.status() < 300, rres ? `status=${rres.status()} ${new URL(rres.url()).pathname}` : 'no response');
await page.waitForTimeout(90000);
const ver = await page.evaluate(() => (document.body.innerText.match(/版 \d+・[^\n。]{0,20}/g) || []).slice(0, 2));
check('S3-R 宅配事業: 再生成版が保存（版 3 以降）', ver.some((v) => /版 [3-9]/.test(v)), JSON.stringify(ver));
check('S3-E API calls', true, calls.join(' | '));
fs.writeFileSync(path.join(dir, 'finish-delivery-result.json'), JSON.stringify({ at: new Date().toISOString(), results }, null, 2));
await ctx.close();
