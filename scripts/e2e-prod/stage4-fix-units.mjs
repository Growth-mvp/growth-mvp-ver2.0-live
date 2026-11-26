import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { BASE, PROFILE_DIR, RUN_DIR } from './common.mjs';

const PROJECT = /新聞配達の時間・品質を守る/;
const dir = path.join(RUN_DIR, 'stage4');
fs.mkdirSync(dir, { recursive: true });
const results = [];
const check = (id, ok, detail = '') => {
  results.push({ id, ok, detail });
  console.log(`CHECK ${ok ? 'PASS' : 'FAIL'} ${id} ${detail}`);
};

const READ_LABELS = [
  '売上増加の売上の金額',
  '売上増加の粗利率',
  '売上増加の追加販売管理費等',
  '削減効果（年間削減額）の年間削減額',
];
const FIX = {
  '売上増加の売上の金額': '6',
  '売上増加の追加販売管理費等': '0.5',
  '削減効果（年間削減額）の年間削減額': '1.2',
};

const ctx = await chromium.launchPersistentContext(PROFILE_DIR, { headless: true, viewport: { width: 1400, height: 900 } });
const page = ctx.pages()[0] ?? (await ctx.newPage());
let crashed = false;
page.on('crash', () => { crashed = true; });
const writes = [];
page.on('response', (r) => {
  if (r.request().method() !== 'GET' && (r.url().includes('/api/') || r.url().includes('supabase.co'))) writes.push(`${r.request().method()} ${r.status()} ${new URL(r.url()).pathname}`);
});

const openEffects = async () => {
  await page.goto(`${BASE}/okr`, { waitUntil: 'networkidle', timeout: 120000 });
  await page.getByRole('button', { name: PROJECT }).first().click();
  await page.getByText('財務効果を設定する').first().click();
  await page.locator('input[aria-label="売上増加の売上の金額"]').first().waitFor({ state: 'attached', timeout: 60000 });
};

const readAll = () =>
  page.evaluate((labels) => Object.fromEntries(labels.map((l) => {
    const el = document.querySelector(`input[aria-label="${l}"]`);
    return [l, el ? el.value : null];
  })), READ_LABELS);

await openEffects();
const before = await readAll();
console.log('BEFORE', JSON.stringify(before));

for (const [label, value] of Object.entries(FIX)) {
  const el = page.locator(`input[aria-label="${label}"]`).first();
  await el.fill(value);
  await el.press('Tab');
}
const after = await readAll();
check('U-1 修正値が画面に反映（百万円単位）', Object.entries(FIX).every(([k, v]) => after[k] === v), JSON.stringify(after));

const [saveRes] = await Promise.all([
  page.waitForResponse((r) => r.request().method() !== 'GET' && (r.url().includes('/api/stage4/') || r.url().includes('supabase.co')), { timeout: 120000 }).catch(() => null),
  page.getByRole('button', { name: '計画を保存' }).first().click(),
]);
check('U-2 計画の保存', !!saveRes && saveRes.status() < 300, saveRes ? `status=${saveRes.status()}` : 'no response');
await page.waitForTimeout(3000);

await openEffects();
const reloaded = await readAll();
check('U-3 リロード後の修正値（百万円）', Object.entries(FIX).every(([k, v]) => reloaded[k] === v), JSON.stringify(reloaded));
check('U-E 通信とクラッシュ', !crashed, `crashed=${crashed} ${writes.join(' | ')}`);
fs.writeFileSync(path.join(dir, 'fix-units-result.json'), JSON.stringify({ at: new Date().toISOString(), before, after, reloaded, results, writes }, null, 2));
await ctx.close();
