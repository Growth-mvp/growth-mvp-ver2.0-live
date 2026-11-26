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

const ROWS = [
  {
    name: '配送案件管理システムの導入',
    category: 'CAPEX',
    amount: '3000000',
    form: 'ONE_TIME',
    dates: { 支出年月: '2026-12' },
  },
  {
    name: '判定運用の外部委託費',
    category: 'OPEX',
    amount: '300000',
    form: 'RECURRING',
    dates: { 開始年月: '2027-01', 終了年月: '2027-03' },
  },
];

const ctx = await chromium.launchPersistentContext(PROFILE_DIR, { headless: true, viewport: { width: 1400, height: 900 } });
const page = ctx.pages()[0] ?? (await ctx.newPage());
let crashed = false;
page.on('crash', () => { crashed = true; });
const calls = [];
page.on('response', (r) => {
  if (r.url().includes('/api/') && r.request().method() !== 'GET') calls.push(`${r.request().method()} ${r.status()} ${new URL(r.url()).pathname}`);
});

const openSection = async () => {
  await page.goto(`${BASE}/okr`, { waitUntil: 'networkidle', timeout: 120000 });
  await page.getByRole('button', { name: PROJECT }).first().click();
  await page.getByText('財務効果を設定する').first().click();
  const section = page.locator('section[aria-labelledby="stage4-investment-input"]');
  await section.waitFor({ state: 'visible', timeout: 60000 });
  return section;
};

const section = await openSection();
const addBtn = section.getByRole('button', { name: '+ 投資・追加費用を追加' });

for (let i = 0; i < ROWS.length; i++) {
  const row = ROWS[i];
  await addBtn.click();
  const rowEl = section.locator('.plan-param').nth(i);
  await rowEl.waitFor({ state: 'visible', timeout: 30000 });
  await rowEl.locator('input[aria-label="投資・追加費用の項目名"]').fill(row.name);
  await rowEl.locator('select[aria-label="投資・追加費用の支出区分"]').selectOption(row.category);
  await rowEl.locator('input[aria-label="投資・追加費用の金額"]').fill(row.amount);
  await rowEl.locator('select[aria-label="投資・追加費用の支出形態"]').selectOption(row.form);
  for (const [label, value] of Object.entries(row.dates)) {
    const input = rowEl.locator(`input[aria-label="投資・追加費用の${label}"]`);
    await input.waitFor({ state: 'visible', timeout: 15000 });
    await input.fill(value);
  }
  const basisSel = rowEl.locator('select[aria-label="投資・追加費用の金額基準"]');
  if ((await basisSel.count()) > 0) {
    const opts = await basisSel.locator('option').evaluateAll((os) => os.map((o) => o.value).filter(Boolean));
    if (opts.length) await basisSel.selectOption(opts[0]);
  }
  const relSel = rowEl.locator('select[aria-label="投資・追加費用の営業利益との関係"]');
  if ((await relSel.count()) > 0) {
    const opts = await relSel.locator('option').evaluateAll((os) => os.map((o) => o.value).filter(Boolean));
    if (opts.length) await relSel.selectOption(opts[0]);
  }
  check(`S4-I${i + 1} 投資・追加費用（${row.category}）を入力`, (await rowEl.locator('input[aria-label="投資・追加費用の金額"]').inputValue()) === row.amount);
}

const [saveRes] = await Promise.all([
  page.waitForResponse((r) => r.url().includes('/api/stage4/') && r.request().method() !== 'GET', { timeout: 120000 }).catch(() => null),
  page.getByRole('button', { name: '計画を保存' }).first().click(),
]);
await page.waitForTimeout(2500);
const notices = await page.evaluate(() => (document.body.innerText.replace(/\s+/g, ' ').match(/[^。]*投資・追加費用[^。]*。?/g) || []).slice(0, 6));
console.log('NOTICES', JSON.stringify(notices));
check('S4-I3 計画の保存API', !!saveRes && [200, 201].includes(saveRes.status()), saveRes ? `status=${saveRes.status()}` : 'no response');

const section2 = await openSection();
const shownRows = await section2.locator('ul[aria-label="保存済みの投資・追加費用"] li').count();
const names = await section2.evaluate((s) => s.innerText.replace(/\s+/g, ' '));
check('S4-I4 リロード後も投資・追加費用が保持', ROWS.every((r) => names.includes(r.name)) || shownRows >= ROWS.length, `rows=${shownRows} ${names.slice(0, 160)}`);
check('S4-E 通信とクラッシュ', !crashed, `crashed=${crashed} ${calls.join(' | ')}`);
fs.writeFileSync(path.join(dir, 'invest-result.json'), JSON.stringify({ at: new Date().toISOString(), results, calls }, null, 2));
await ctx.close();
