import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { BASE, PROFILE_DIR, RUN_DIR } from './common.mjs';

const dir = path.join(RUN_DIR, 'stage5');
fs.mkdirSync(dir, { recursive: true });
const results = [];
const check = (id, ok, detail = '') => {
  results.push({ id, ok, detail });
  console.log(`CHECK ${ok ? 'PASS' : 'FAIL'} ${id} ${detail}`);
};

const MEMO = '1件目の受託条件案を作成済み。判定項目の欠損は2件。';
const STATUS = 'IN_PROGRESS';
const ACTUAL = { ym: '2027-01', sales: '500000', cost: '100000', kpi: '1200', kpiDate: '2027-01-31' };

const ctx = await chromium.launchPersistentContext(PROFILE_DIR, { headless: true, viewport: { width: 1400, height: 900 } });
const page = ctx.pages()[0] ?? (await ctx.newPage());
let crashed = false;
page.on('crash', () => { crashed = true; });
const writes = [];
const isWrite = (r) => r.request().method() !== 'GET' && (r.url().includes('/api/') || r.url().includes('supabase.co'));
page.on('response', (r) => { if (isWrite(r)) writes.push(`${r.request().method()} ${r.status()} ${new URL(r.url()).pathname}`); });

const openProject = async () => {
  await page.goto(`${BASE}/execution`, { waitUntil: 'networkidle', timeout: 120000 });
  await page.locator('div', { hasText: 'クリックで詳細表示' }).filter({ hasText: '新聞配達の時間・品質を守る案件別採算判定の運用化' }).last().click({ force: true });
  await page.locator('select[aria-label="1. の進捗"]').first().waitFor({ state: 'attached', timeout: 60000 });
};

const openAction1 = async () => {
  await page.locator('li', { has: page.locator('select[aria-label="1. の進捗"]') }).first().locator('summary').first().click({ force: true });
  await page.locator('textarea[aria-label="1. の進捗メモ"]').first().waitFor({ state: 'attached', timeout: 30000 });
};

const openActualRegistration = async () => {
  await page.getByText('補助情報（必要な時だけ開く）').first().click({ force: true });
  await page.getByText('実績の登録（財務・KPI・KR）').first().click({ force: true });
  await page.locator('section[aria-label="実績の登録"] input[aria-label="対象年月"]').waitFor({ state: 'attached', timeout: 30000 });
};

await openProject();
await openAction1();
await page.locator('select[aria-label="1. の進捗"]').first().selectOption(STATUS);
await page.locator('textarea[aria-label="1. の進捗メモ"]').first().fill(MEMO);
const progressBtn = page.locator('button', { hasText: /^進捗を保存$/ }).first();
await progressBtn.waitFor({ state: 'visible', timeout: 30000 });
const [pRes] = await Promise.all([
  page.waitForResponse((r) => isWrite(r), { timeout: 120000 }).catch(() => null),
  progressBtn.click({ force: true }),
]);
check('S5-1 進捗の保存（状態・メモ）', !!pRes && pRes.status() < 300, pRes ? `status=${pRes.status()} ${new URL(pRes.url()).pathname}` : 'no write response');

await openActualRegistration();
const section = page.locator('section[aria-label="実績の登録"]');
await section.locator('input[aria-label="対象年月"]').fill(ACTUAL.ym);
await section.locator('input[aria-label="売上増加の実績金額"]').fill(ACTUAL.sales);
await section.locator('input[aria-label="費用削減の実績金額"]').fill(ACTUAL.cost);
check('S5-2 財務実績の入力', (await section.locator('input[aria-label="売上増加の実績金額"]').inputValue()) === ACTUAL.sales);
const kpiValueInput = section.locator('input[aria-label*="の実績値"]').first();
const kpiAria = (await kpiValueInput.count()) > 0 ? await kpiValueInput.getAttribute('aria-label') : null;
const kpiLabel = kpiAria ? kpiAria.replace(/の実績値.*$/, '') : null;
if (kpiLabel) {
  await kpiValueInput.fill(ACTUAL.kpi);
  await section.locator(`input[aria-label="${kpiLabel}の基準日"]`).fill(ACTUAL.kpiDate);
}
check('S5-2b KPI・KR実績の入力欄', !!kpiLabel && (await kpiValueInput.inputValue()) === ACTUAL.kpi, `kpi=${kpiLabel}`);

const actualBtn = section.getByRole('button', { name: '実績を保存' });
const [aRes] = await Promise.all([
  page.waitForResponse((r) => isWrite(r), { timeout: 120000 }).catch(() => null),
  actualBtn.click({ force: true }),
]);
check('S5-3 実績の保存', !!aRes && aRes.status() < 300, aRes ? `status=${aRes.status()} ${new URL(aRes.url()).pathname}` : 'no write response');

await openProject();
await openAction1();
const memoAfter = await page.locator('textarea[aria-label="1. の進捗メモ"]').first().inputValue();
const statusAfter = await page.locator('select[aria-label="1. の進捗"]').first().inputValue();
check('S5-4 リロード後の進捗メモ・状態', memoAfter === MEMO && statusAfter === STATUS, `memo=${memoAfter} status=${statusAfter}`);

await openActualRegistration();
await page.locator('section[aria-label="実績の登録"] input[aria-label="対象年月"]').fill(ACTUAL.ym);
await page.waitForFunction((v) => {
  const el = document.querySelector('section[aria-label="実績の登録"] input[aria-label="売上増加の実績金額"]');
  return !!el && el.value === v;
}, ACTUAL.sales, { timeout: 30000 }).catch(() => null);
const salesAfter = await page.locator('section[aria-label="実績の登録"] input[aria-label="売上増加の実績金額"]').inputValue();
check('S5-5 リロード後の財務実績', salesAfter === ACTUAL.sales, `sales=${salesAfter}`);
const kpiAfter = kpiLabel ? await page.locator(`section[aria-label="実績の登録"] input[aria-label="${kpiLabel}の実績値"]`).first().inputValue().catch(() => null) : null;
const kpiAfterAll = await page.locator('section[aria-label="実績の登録"] input[aria-label*="の実績値"]').first().inputValue().catch(() => null);
check('S5-6 リロード後のKPI・KR実績', kpiLabel !== null && kpiAfterAll === ACTUAL.kpi, `kpi=${kpiAfterAll} label=${kpiLabel}`);
check('S5-E 通信とクラッシュ', !crashed, `crashed=${crashed} ${writes.join(' | ')}`);
fs.writeFileSync(path.join(dir, 'stage5-result.json'), JSON.stringify({ at: new Date().toISOString(), results, writes }, null, 2));
await ctx.close();
