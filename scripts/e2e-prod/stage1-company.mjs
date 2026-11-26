import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { BASE, PROFILE_DIR, RUN_DIR } from './common.mjs';

const dir = path.join(RUN_DIR, 'stage1');
fs.mkdirSync(dir, { recursive: true });
const results = [];
const check = (id, ok, detail = '') => {
  results.push({ id, ok, detail });
  console.log(`CHECK ${ok ? 'PASS' : 'FAIL'} ${id} ${detail}`);
};

const ctx = await chromium.launchPersistentContext(PROFILE_DIR, { headless: true, viewport: { width: 1400, height: 900 } });
const page = ctx.pages()[0] ?? (await ctx.newPage());

const readCompany = () =>
  page.evaluate(() => {
    const sels = [...document.querySelectorAll('select')];
    const texts = [...document.querySelectorAll('input[type=text]')];
    return {
      industry: sels[0]?.value ?? null,
      location: sels[1]?.value ?? null,
      employees: sels[2]?.value ?? null,
      fiscalYearEnd: sels[3]?.value ?? null,
      companyName: texts.find((e) => e.placeholder.startsWith('例：株式会社'))?.value ?? null,
    };
  });

await page.goto(`${BASE}/stage1`, { waitUntil: 'networkidle', timeout: 120000 });
await page.getByText('① 企業情報・事業内容').first().click();
await page.waitForTimeout(1200);

const sels = page.locator('select');
await sels.nth(0).selectOption('logistics');
await sels.nth(1).selectOption('東京都');
await sels.nth(2).selectOption('100〜299');
await sels.nth(3).selectOption('3');
await page.waitForTimeout(800);
await page.screenshot({ path: path.join(dir, '10-company-filled.png'), fullPage: true });

const before = await readCompany();
check('S1-1 企業情報を入力', before.industry === 'logistics' && before.fiscalYearEnd === '3', JSON.stringify(before));

await page.getByRole('button', { name: '全体保存' }).click();
await page.waitForTimeout(4000);
const saved = await page.getByText('保存済み').first().isVisible().catch(() => false);
check('S1-2 全体保存後に保存済み表示', saved);

await page.reload({ waitUntil: 'networkidle', timeout: 120000 });
await page.getByText('① 企業情報・事業内容').first().click();
await page.waitForTimeout(1500);
const after = await readCompany();
check(
  'S1-3 リロード後に企業情報が保持',
  after.industry === 'logistics' && after.location === '東京都' && after.employees === '100〜299' && after.fiscalYearEnd === '3',
  JSON.stringify(after),
);
await page.screenshot({ path: path.join(dir, '11-company-reloaded.png'), fullPage: true });

fs.writeFileSync(path.join(dir, 'company-result.json'), JSON.stringify({ at: new Date().toISOString(), results }, null, 2));
await ctx.close();
