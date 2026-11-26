import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { BASE, PROFILE_DIR, RUN_DIR } from './common.mjs';

const dir = path.join(RUN_DIR, 'stage2');
fs.mkdirSync(dir, { recursive: true });
const results = [];
const check = (id, ok, detail = '') => {
  results.push({ id, ok, detail });
  console.log(`CHECK ${ok ? 'PASS' : 'FAIL'} ${id} ${detail}`);
};

const ctx = await chromium.launchPersistentContext(PROFILE_DIR, { headless: true, viewport: { width: 1400, height: 900 } });
const page = ctx.pages()[0] ?? (await ctx.newPage());
const apiErrors = [];
const consoleErrors = [];
const calls = [];
let crashed = false;
page.on('crash', () => { crashed = true; });
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 200)); });
page.on('response', (r) => {
  const u = r.url();
  if (u.includes('/api/') && r.status() >= 400) apiErrors.push(`${r.status()} ${new URL(u).pathname}`);
  if ((u.includes('/api/stage2/') || u.includes('/rest/v1/strategy_data')) && r.request().method() !== 'GET') calls.push(`${r.request().method()} ${r.status()} ${new URL(u).pathname}`);
});

await page.goto(`${BASE}/stage2`, { waitUntil: 'networkidle', timeout: 120000 });
await page.waitForTimeout(2500);
await page.getByRole('button', { name: /最終確定/ }).first().click({ force: true });
await page.waitForTimeout(2500);

const sample = '当社は、新聞販売・配達を基盤として地';
const shown = await page.evaluate((s) => document.body.innerText.replace(/\s+/g, ' ').includes(s), sample);
check('S2-6a 最終確定タブに生成済みの本文が表示（リロード後）', shown);

const commitBtn = page.getByRole('button', { name: /全社戦略を確定し、STAGE3へ引き渡す/ }).first();
check('S2-6b 確定ボタンがある', (await commitBtn.count()) > 0);

await commitBtn.click({ force: true });
await page.waitForTimeout(90000);
check('S2-6c-0 確定処理中にページがクラッシュしない', !crashed, `crashed=${crashed}`);
console.log('CALLS', JSON.stringify(calls.slice(0, 20)));
console.log('CONSOLE_ERR', JSON.stringify(consoleErrors.slice(-8)));
const landed = page.isClosed() ? 'closed' : new URL(page.url()).pathname;
check('S2-6c 確定後にSTAGE3（/cascade）へ遷移', landed === '/cascade', landed);

const stageErrorText = await page.evaluate(() => document.body.innerText.replace(/\s+/g, ' ').match(/(失敗|できませんでした|エラー)[^。]{0,40}/)?.[0] ?? null);
check('S2-6d 確定処理でエラー表示なし', !stageErrorText, stageErrorText ?? '');
check('S2-6e 確定・生成APIにエラーなし', apiErrors.length === 0, apiErrors.join(','));

await page.screenshot({ path: path.join(dir, '06-stage3-after-commit.png'), fullPage: false });
fs.writeFileSync(path.join(dir, 'commit-result.json'), JSON.stringify({ at: new Date().toISOString(), results, apiErrors }, null, 2));
await ctx.close();
