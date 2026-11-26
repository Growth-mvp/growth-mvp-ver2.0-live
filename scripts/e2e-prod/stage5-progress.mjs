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

const PROGRESS_MEMO = '1件目の受託条件案を作成済み。判定項目の欠損は2件。';
const ACTUALS = { 対象年月: '2027-01', 売上増加の実績金額: '500000', 費用削減の実績金額: '100000' };

const ctx = await chromium.launchPersistentContext(PROFILE_DIR, { headless: true, viewport: { width: 1400, height: 900 } });
const page = ctx.pages()[0] ?? (await ctx.newPage());
let crashed = false;
page.on('crash', () => { crashed = true; });
const calls = [];
page.on('response', (r) => { if (r.url().includes('/api/') && r.request().method() !== 'GET') calls.push(`${r.request().method()} ${r.status()} ${new URL(r.url()).pathname}`); });

const openProject = async () => {
  await page.goto(`${BASE}/execution`, { waitUntil: 'networkidle', timeout: 120000 });
  await page.waitForTimeout(6000);
  const projectRow = page.locator('div', { hasText: 'クリックで詳細表示' }).filter({ hasText: '新聞配達の時間・品質を守る案件別採算判定の運用化' }).last();
  await projectRow.click({ force: true });
  await page.waitForTimeout(4000);
  return (await page.locator('select[aria-label="1. の進捗"]').count()) > 0;
};

await openProject();

const firstSel = page.locator('select[aria-label="1. の進捗"]').first();
const optCount = await firstSel.locator('option').count();
console.log('PROGRESS_OPTIONS', optCount, await firstSel.locator('option').evaluateAll((os) => os.map((o) => o.textContent.trim())));
await firstSel.selectOption({ index: 1 }, { force: true });
const firstMemo = page.locator('textarea[aria-label="1. の進捗メモ"]').first();
await firstMemo.click({ force: true }); await page.keyboard.insertText(PROGRESS_MEMO);
await page.waitForTimeout(500);
check('S5-1 進捗の入力（画面反映）', (await firstMemo.inputValue()) === PROGRESS_MEMO);

await page.getByText('実績の登録（財務・KPI・KR）').first().click({ force: true }).catch(() => null);
await page.waitForTimeout(1500);
const ym = page.locator('input[aria-label="対象年月"]').first();
if ((await ym.count()) > 0) await ym.fill(ACTUALS['対象年月']);
const sales = page.locator('input[aria-label="売上増加の実績金額"]').first();
if ((await sales.count()) > 0) await sales.fill(ACTUALS['売上増加の実績金額']);
const cost = page.locator('input[aria-label="費用削減の実績金額"]').first();
if ((await cost.count()) > 0) await cost.fill(ACTUALS['費用削減の実績金額']);
await page.waitForTimeout(800);
check('S5-2 実績（財務）の入力欄を操作', (await sales.count()) > 0 && (await cost.count()) > 0, `sales=${await sales.count()} cost=${await cost.count()}`);

const [saveRes] = await Promise.all([
  page.waitForResponse((r) => r.url().includes('/api/stage4/') || r.url().includes('/api/stage5/') || r.url().includes('/api/execution'), { timeout: 120000 }).catch(() => null),
  page.getByRole('button', { name: '進捗を保存' }).first().click({ force: true }),
]);
check('S5-3 進捗・実績の保存API', !!saveRes && [200, 201].includes(saveRes.status()), saveRes ? `status=${saveRes.status()} ${new URL(saveRes.url()).pathname}` : 'no response (保存はSupabase直接の可能性)');
await page.waitForTimeout(4000);

await openProject();
const memoAfter = await page.locator('textarea[aria-label="1. の進捗メモ"]').first().inputValue().catch(() => null);
check('S5-4 リロード後も進捗メモが保持', memoAfter === PROGRESS_MEMO, `memo=${memoAfter}`);
await page.getByText('実績の登録（財務・KPI・KR）').first().click({ force: true }).catch(() => null);
await page.waitForTimeout(1500);
const salesAfter = await page.locator('input[aria-label="売上増加の実績金額"]').first().inputValue().catch(() => null);
check('S5-5 リロード後も売上増加の実績が保持', salesAfter === ACTUALS['売上増加の実績金額'], `sales=${salesAfter}`);
check('S5-E 通信とクラッシュ', !crashed, `crashed=${crashed} ${calls.join(' | ')}`);
fs.writeFileSync(path.join(dir, 'progress-result.json'), JSON.stringify({ at: new Date().toISOString(), results, calls }, null, 2));
await ctx.close();
