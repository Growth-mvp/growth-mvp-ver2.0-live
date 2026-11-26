import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { BASE, PROFILE_DIR, RUN_DIR } from './common.mjs';

const dir = path.join(RUN_DIR, 'stage2');
fs.mkdirSync(dir, { recursive: true });
const results = [];
const check = (id, ok, detail = '') => { results.push({ id, ok, detail }); console.log(`CHECK ${ok ? 'PASS' : 'FAIL'} ${id} ${detail}`); };
const TARGETS = [
  { label: '売上', unit: '百万円', value: '175', year: '2030', rationale: '2030年度の全社目標（検証用）。2025年度実績は売上高160百万円。' },
  { label: '営業利益', unit: '百万円', value: '8', year: '2030', rationale: '2030年度の全社目標（検証用）。2025年度実績は営業利益1.5百万円。' },
];

const ctx = await chromium.launchPersistentContext(PROFILE_DIR, { headless: true, viewport: { width: 1400, height: 900 } });
const page = ctx.pages()[0] ?? (await ctx.newPage());
let crashed = false;
page.on('crash', () => { crashed = true; });
const writes = [];
const isWrite = (r) => r.request().method() !== 'GET' && (r.url().includes('/api/') || r.url().includes('supabase.co'));
page.on('response', (r) => { if (isWrite(r)) writes.push(`${r.request().method()} ${r.status()} ${new URL(r.url()).pathname}`); });

await page.goto(`${BASE}/stage2`, { waitUntil: 'networkidle', timeout: 120000 });
const targetSection = page.locator('div', { has: page.getByRole('heading', { name: /業績目標/ }) }).last();

for (const t of TARGETS) {
  await page.getByRole('button', { name: '+ 新規メトリクスを追加' }).first().click({ force: true });
  const form = page.locator('select').filter({ has: page.locator(`option[value="${t.label}"]`) }).first();
  await form.waitFor({ state: 'attached', timeout: 30000 });
  await form.selectOption(t.label);
  await page.locator('select').filter({ has: page.locator('option[value="百万円"]') }).first().selectOption(t.unit);
  await page.locator('input[type="number"]').filter({ has: page.locator('xpath=..') }).nth(0).fill(t.value).catch(() => null);
  const numberInputs = page.locator('input[type="number"]:visible');
  await numberInputs.nth(0).fill(t.value);
  await numberInputs.nth(1).fill(t.year);
  await page.locator('textarea:visible').filter({ hasText: '' }).nth(0).fill(t.rationale).catch(() => null);
  const addBtn = page.getByRole('button', { name: '追加', exact: true }).first();
  await addBtn.click({ force: true });
  await page.waitForTimeout(1000);
  const shown = await page.evaluate((l) => document.body.innerText.includes(l), t.label);
  check(`S2-T ${t.label}の業績目標を追加（画面反映）`, shown, `target=${t.value} year=${t.year}`);
}

const [sRes] = await Promise.all([
  page.waitForResponse((r) => isWrite(r), { timeout: 120000 }).catch(() => null),
  page.getByRole('button', { name: '全体保存' }).first().click({ force: true }),
]);
check('S2-T 全体保存', !!sRes && sRes.status() < 300, sRes ? `status=${sRes.status()}` : 'no write response');

await page.reload({ waitUntil: 'networkidle', timeout: 120000 });
await page.waitForTimeout(3000);
const after = await page.evaluate(() => document.body.innerText.replace(/\s+/g, ' '));
check('S2-T リロード後も業績目標が保持', after.includes('175') && after.includes('8') && after.includes('2030'), after.match(/売上[^。]{0,40}175[^。]{0,20}/)?.[0] ?? 'none');
check('S2-E 通信とクラッシュ', !crashed, `crashed=${crashed} ${writes.join(' | ')}`);
fs.writeFileSync(path.join(dir, 'targets-result.json'), JSON.stringify({ at: new Date().toISOString(), results, writes }, null, 2));
await ctx.close();
