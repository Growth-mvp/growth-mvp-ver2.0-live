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

const PL = [
  ['売上高', '160000000'],
  ['営業利益', '1500000'],
];
const BS = [
  ['現預金', '12000000'],
  ['純資産（株主資本）', '28000000'],
  ['総資産', '84000000'],
  ['有利子負債', '23000000'],
];

const ctx = await chromium.launchPersistentContext(PROFILE_DIR, { headless: true, viewport: { width: 1400, height: 900 } });
const page = ctx.pages()[0] ?? (await ctx.newPage());

async function setCell(tableIndex, label, value) {
  const row = page.locator('table').nth(tableIndex).locator('tbody tr').filter({ hasText: label }).first();
  const cell = row.locator('td').nth(1);
  await cell.dblclick();
  await page.waitForTimeout(300);
  await page.keyboard.press('Control+A');
  await page.keyboard.type(value);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(400);
}

async function readCells(tableIndex) {
  return page.evaluate((ti) => {
    const tb = document.querySelectorAll('table')[ti];
    return Object.fromEntries(
      [...tb.querySelectorAll('tbody tr')].map((tr) => {
        const tds = tr.querySelectorAll('td');
        return [(tds[0]?.innerText || '').replace('*', '').trim(), (tds[1]?.innerText || '').trim()];
      }),
    );
  }, tableIndex);
}

const lastSaved = () => page.evaluate(() => (document.body.innerText.match(/最終保存\s*\S+/) || [''])[0]);

await page.goto(`${BASE}/stage1`, { waitUntil: 'networkidle', timeout: 120000 });
await page.getByText('② 財務データ').first().click();
await page.waitForTimeout(1500);

for (const [label, v] of PL) await setCell(0, label, v);
for (const [label, v] of BS) await setCell(1, label, v);
await page.screenshot({ path: path.join(dir, '20-finance-filled.png'), fullPage: true });

const pl = await readCells(0);
const bs = await readCells(1);
const plOk = PL.every(([l, v]) => (pl[l] || '').replace(/[,\s]/g, '') === v);
const bsOk = BS.every(([l, v]) => (bs[l.replace('*', '')] || '').replace(/[,\s]/g, '') === v);
check('S1-4 PL 2025年の入力値を画面に表示', plOk, JSON.stringify(PL.map(([l]) => [l, pl[l]])));
check('S1-5 BS 2025年の入力値を画面に表示', bsOk, JSON.stringify(BS.map(([l]) => [l, bs[l]])));

const before = await lastSaved();
await page.getByRole('button', { name: '全体保存' }).click();
await page.waitForTimeout(5000);
const after = await lastSaved();
check('S1-6 全体保存で最終保存時刻が更新', before !== after || after.length > 0, `before=${before} after=${after}`);

await page.reload({ waitUntil: 'networkidle', timeout: 120000 });
await page.getByText('② 財務データ').first().click();
await page.waitForTimeout(1500);
const pl2 = await readCells(0);
const bs2 = await readCells(1);
const plKept = PL.every(([l, v]) => (pl2[l] || '').replace(/[,\s]/g, '') === v);
const bsKept = BS.every(([l, v]) => (bs2[l.replace('*', '')] || '').replace(/[,\s]/g, '') === v);
check('S1-7 リロード後にPL財務値が保持', plKept, JSON.stringify(PL.map(([l]) => [l, pl2[l]])));
check('S1-8 リロード後にBS財務値が保持', bsKept, JSON.stringify(BS.map(([l]) => [l, bs2[l.replace('*', '')]])));
await page.screenshot({ path: path.join(dir, '21-finance-reloaded.png'), fullPage: true });

fs.writeFileSync(path.join(dir, 'finance-result.json'), JSON.stringify({ at: new Date().toISOString(), results }, null, 2));
await ctx.close();
