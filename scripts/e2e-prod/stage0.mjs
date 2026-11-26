import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { BASE, PROFILE_DIR, RUN_DIR } from './common.mjs';

const dir = path.join(RUN_DIR, 'stage0');
fs.mkdirSync(dir, { recursive: true });
const results = [];
const check = (id, ok, detail = '') => {
  results.push({ id, ok, detail });
  console.log(`CHECK ${ok ? 'PASS' : 'FAIL'} ${id} ${detail}`);
};

const ctx = await chromium.launchPersistentContext(PROFILE_DIR, { headless: true, viewport: { width: 1400, height: 900 } });
const page = ctx.pages()[0] ?? (await ctx.newPage());
const consoleErrors = [];
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 200)); });

await page.goto(`${BASE}/stage0`, { waitUntil: 'networkidle', timeout: 120000 });
await page.screenshot({ path: path.join(dir, '01-initial.png'), fullPage: true });
check('S0-1 ページ表示', page.url().endsWith('/stage0'), page.url());

const input = page.locator('input[placeholder^="下の名前"]');
for (const name of ['たろう', 'はなこ', 'じろう']) {
  await input.fill(name);
  await page.getByRole('button', { name: '追加', exact: true }).click();
}
const listed = await page.evaluate(() => document.body.innerText.includes('参加者 (3人)'));
check('S0-2 参加者3人を追加', listed);

await page.getByRole('button', { name: 'はじめる' }).click();
await page.waitForTimeout(1500);

let spins = 0;
for (let i = 0; i < 20; i++) {
  if (await page.getByText('準備が整いました').isVisible().catch(() => false)) break;
  const btn = page.locator('button', { hasText: /スピン|次の抽選へ|クロージングへ/ }).first();
  if (!(await btn.count())) break;
  const label = (await btn.innerText()).trim();
  if (label.includes('スピン')) spins += 1;
  await btn.click().catch(() => {});
  await page.waitForTimeout(3500);
}
await page.screenshot({ path: path.join(dir, '02-closing.png'), fullPage: true });
const closing = await page.getByText('準備が整いました').isVisible().catch(() => false);
check('S0-3 全員の抽選後にクロージング画面', closing, `spins=${spins}`);

const fatal = consoleErrors.filter((e) => !/favicon|Hydration|Warning/i.test(e));
check('S0-4 コンソールの重大エラーなし', fatal.length === 0, fatal.slice(0, 3).join(' | '));

fs.writeFileSync(path.join(dir, 'result.json'), JSON.stringify({ at: new Date().toISOString(), results }, null, 2));
await ctx.close();
