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

const VALUES = {
  '売上増加の売上の金額': '6000000',
  '売上増加の粗利率': '30',
  '売上増加の追加販売管理費等': '500000',
  '売上増加の開始年月': '2027-01',
  '売上増加の終了年月': '2027-03',
  '削減効果（年間削減額）の年間削減額': '1200000',
  '削減効果（年間削減額）の開始年月': '2027-02',
  '削減効果（年間削減額）の終了年月': '2027-03',
  '追加費用の開始年月': '2026-12',
  '追加費用の終了年月': '2027-03',
};
const NAME_FIELD = '実行責任者の名前';
const NAME_VALUE = '案件採算判定担当';

const ctx = await chromium.launchPersistentContext(PROFILE_DIR, { headless: true, viewport: { width: 1400, height: 900 } });
const page = ctx.pages()[0] ?? (await ctx.newPage());
let crashed = false;
page.on('crash', () => { crashed = true; });
const calls = [];
page.on('response', (r) => {
  if (r.url().includes('/api/') && r.request().method() !== 'GET') calls.push(`${r.request().method()} ${r.status()} ${new URL(r.url()).pathname}`);
});

const openPlan = async () => {
  await page.goto(`${BASE}/okr`, { waitUntil: 'networkidle', timeout: 120000 });
  await page.waitForTimeout(4000);
  await page.getByRole('button', { name: PROJECT }).first().click({ force: true });
  await page.waitForTimeout(4000);
  await page.getByText('財務効果を設定する').first().click({ force: true }).catch(() => null);
  await page.waitForTimeout(2000);
};

const readField = (label) =>
  page.evaluate((l) => {
    const el = document.querySelector(`[aria-label="${l}"], [placeholder="${l}"]`);
    return el ? el.value : null;
  }, label);

await openPlan();
for (const [label, value] of Object.entries(VALUES)) {
  const el = page.locator(`[aria-label="${label}"]`).first();
  if ((await el.count()) === 0) { check(`S4-F ${label}: 入力欄あり`, false, 'not found'); continue; }
  await el.fill(value);
  await el.press('Tab');
  await page.waitForTimeout(300);
}
const nameRow = page.locator('tr', { hasText: '実行責任者' }).first();
const nameEditBtn = nameRow.locator('button.plan-edit-target').first();
if ((await nameEditBtn.count()) > 0) {
  await nameEditBtn.click({ force: true });
  await page.waitForTimeout(800);
  const nameInput = nameRow.locator('input:visible').first();
  await nameInput.fill(NAME_VALUE);
  await nameInput.press('Enter').catch(() => null);
  await page.waitForTimeout(800);
}
await page.waitForTimeout(1000);

const freqSel = page.locator('select[aria-label="追加費用の発生頻度"]').first();
if ((await freqSel.count()) > 0) {
  const opts = await freqSel.locator('option').evaluateAll((os) => os.map((o) => ({ v: o.value, t: o.textContent })).filter((o) => o.v));
  const yearly = opts.find((o) => /年額/.test(o.t)) ?? opts[0];
  if (yearly) await freqSel.selectOption(yearly.v);
}
const opexRow = page.locator('.plan-param', { hasText: '追加費用：' }).first();
const opexBtn = opexRow.locator('button, [role="button"], .plan-edit-target').first();
if ((await opexBtn.count()) > 0) {
  await opexBtn.click({ force: true }).catch(() => null);
  await page.waitForTimeout(800);
  const amountInput = opexRow.locator('input[type="number"]:visible, input[type="text"]:visible').first();
  if ((await amountInput.count()) > 0) {
    await amountInput.fill('300000');
    await amountInput.press('Enter').catch(() => null);
    await page.waitForTimeout(800);
  }
}
check('S4-F5 追加費用（OPEX）の入力欄を操作', (await opexRow.count()) > 0, `opexRow=${await opexRow.count()}`);
await page.waitForTimeout(1000);

const normalize = (v) => (v ?? '').toString().replace(/,/g, '');
const beforeVals = Object.fromEntries(await Promise.all(Object.keys(VALUES).map(async (k) => [k, await readField(k)])));
const beforeOk = Object.entries(VALUES).every(([k, v]) => normalize(beforeVals[k]) === v);
check('S4-F1 財務効果の入力が画面に反映', beforeOk, JSON.stringify(beforeVals).slice(0, 240));

const [saveRes] = await Promise.all([
  page.waitForResponse((r) => r.url().includes('/api/stage4/') && r.request().method() !== 'GET', { timeout: 120000 }).catch(() => null),
  page.getByRole('button', { name: '計画を保存' }).first().click({ force: true }),
]);
check('S4-F2 計画の保存API', !!saveRes && [200, 201].includes(saveRes.status()), saveRes ? `status=${saveRes.status()} ${new URL(saveRes.url()).pathname}` : 'no response');
await page.waitForTimeout(3000);

await openPlan();
const afterVals = Object.fromEntries(await Promise.all(Object.keys(VALUES).map(async (k) => [k, await readField(k)])));
const keptOk = Object.entries(VALUES).every(([k, v]) => normalize(afterVals[k]) === v);
check('S4-F3 リロード後も財務効果が保持', keptOk, JSON.stringify(afterVals).slice(0, 240));
const nameShown = await page.evaluate((v) => document.body.innerText.replace(/\s+/g, ' ').includes(`実行責任者 ${v}`), NAME_VALUE);
check('S4-F4 実行責任者がリロード後も表示', nameShown, `name=${NAME_VALUE}`);
const opexText = await page.evaluate(() => (document.body.innerText.replace(/\s+/g, ' ').match(/追加費用：[^ ]+ [^ ]+/) || [''])[0]);
check('S4-F6 追加費用（OPEX）が保存後に未入力表示でない', opexText.length > 0 && !/未入力/.test(opexText), opexText);
check('S4-E 通信とクラッシュ', !crashed && calls.every((c) => / 20[01] /.test(c)), `crashed=${crashed} ${calls.join(' | ')}`);
fs.writeFileSync(path.join(dir, 'finance-result.json'), JSON.stringify({ at: new Date().toISOString(), results, calls }, null, 2));
await ctx.close();
