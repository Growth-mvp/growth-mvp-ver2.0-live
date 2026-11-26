import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { BASE, PROFILE_DIR, RUN_DIR } from './common.mjs';
const dir = path.join(RUN_DIR, 'stage3');
const results = [];
const check = (id, ok, detail = '') => { results.push({ id, ok, detail }); console.log(`CHECK ${ok ? 'PASS' : 'FAIL'} ${id} ${detail}`); };
const ctx = await chromium.launchPersistentContext(PROFILE_DIR, { headless: true, viewport: { width: 1400, height: 900 } });
const page = ctx.pages()[0] ?? (await ctx.newPage());
const calls = [];
page.on('response', (r) => { const u = r.url(); if (u.includes('/api/') && r.request().method() === 'POST') calls.push(`${r.status()} ${new URL(u).pathname}`); });
let row = null;
page.on('response', async (r) => { if (r.url().includes('/rest/v1/strategy_data') && r.request().method() === 'GET' && !row) { try { const j = await r.json(); row = Array.isArray(j) ? j[0] : null; } catch {} } });

await page.goto(`${BASE}/cascade`, { waitUntil: 'networkidle', timeout: 120000 });
await page.waitForTimeout(2500);
await page.getByRole('button', { name: '部門間調整' }).first().click({ force: true });
await page.waitForTimeout(3000);

const pending = () => page.evaluate(() => (document.body.innerText.replace(/\s+/g, ' ').match(/調整の判断が(\d+)件残っています/) || [null, 'none'])[1]);
const before = await pending();
for (let i = 0; i < 12; i++) {
  const btn = page.getByRole('button', { name: '採用する', exact: true }).first();
  if ((await btn.count()) === 0) break;
  await btn.click({ force: true }).catch(() => null);
  await page.waitForTimeout(1500);
}
await page.waitForTimeout(2000);
const after = await pending();
check('S3-A1 部門間調整の判断を採用（残件 0）', after === 'none' || after === '0', `before=${before} after=${after}`);

await page.getByRole('button', { name: '調整後の戦略を確認する' }).first().click({ force: true }).catch(() => null);
await page.waitForTimeout(8000);

const [cres] = await Promise.all([
  page.waitForResponse((r) => r.url().includes('/api/stage3/strategy-book/confirm') && r.request().method() === 'POST', { timeout: 300000 }).catch(() => null),
  page.getByRole('button', { name: '戦略書を確定する' }).first().click({ force: true }).catch(() => null),
]);
check('S3-C1 戦略書の確定APIが成功', !!cres && cres.status() < 300, cres ? `status=${cres.status()}` : 'no response');
await page.waitForTimeout(6000);

await page.reload({ waitUntil: 'networkidle', timeout: 120000 });
await page.waitForTimeout(3000);
await page.getByRole('button', { name: '部門間調整' }).first().click({ force: true }).catch(() => null);
await page.waitForTimeout(2500);
const afterReload = await pending();
check('S3-C2 リロード後も採用判断が保持（残件 0）', afterReload === 'none' || afterReload === '0', `afterReload=${afterReload}`);

const sd = await page.evaluate(async () => null);
void sd;
const dup = (arr) => arr.filter((v, i, a) => v && a.indexOf(v) !== i);
const deptIds = (row?.departments ?? []).map((d) => d.id);
const projIds = (row?.departments ?? []).flatMap((d) => (d.projects ?? []).map((p) => p.id));
check('S3-I1 部門IDの重複なし', dup(deptIds).length === 0, JSON.stringify({ n: deptIds.length, dup: dup(deptIds) }));
check('S3-I2 プロジェクトIDの重複なし', dup(projIds).length === 0, JSON.stringify({ n: projIds.length, dup: dup(projIds) }));
check('S3-E calls', true, calls.join(' | '));
fs.writeFileSync(path.join(dir, 'adjust-confirm-result.json'), JSON.stringify({ at: new Date().toISOString(), results }, null, 2));
await ctx.close();
