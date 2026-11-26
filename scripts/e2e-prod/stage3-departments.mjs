import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { BASE, PROFILE_DIR, RUN_DIR } from './common.mjs';

const DEPTS = ['新聞販売・配達事業', '宅配事業'];
const dir = path.join(RUN_DIR, 'stage3');
fs.mkdirSync(dir, { recursive: true });
const results = [];
const check = (id, ok, detail = '') => {
  results.push({ id, ok, detail });
  console.log(`CHECK ${ok ? 'PASS' : 'FAIL'} ${id} ${detail}`);
};

const ctx = await chromium.launchPersistentContext(PROFILE_DIR, { headless: true, viewport: { width: 1400, height: 900 } });
const page = ctx.pages()[0] ?? (await ctx.newPage());

const openManage = async () => {
  await page.getByRole('button', { name: '事業・部門の追加・管理' }).first().click();
  await page.waitForTimeout(1500);
};
const nameInput = () => page.locator('input[placeholder^="例：研究開発部"]').first();
const deptNamesOnPage = () => page.evaluate((names) => names.map((n) => ({ n, shown: document.body.innerText.includes(n) })), DEPTS);

await page.goto(`${BASE}/cascade`, { waitUntil: 'networkidle', timeout: 120000 });
await page.waitForTimeout(2500);
await openManage();

const before = await deptNamesOnPage();
const alreadyThere = before.every((d) => d.shown);
if (!alreadyThere) {
  for (const name of DEPTS) {
    await nameInput().fill(name);
    await page.getByRole('button', { name: '部門を追加' }).first().click();
    await page.waitForTimeout(1200);
  }
}
const afterAdd = await deptNamesOnPage();
check('S3-1 部門を2件登録（画面に表示）', afterAdd.every((d) => d.shown), JSON.stringify(afterAdd));

await page.getByRole('button', { name: '全体保存' }).click();
await page.waitForTimeout(4000);
await page.reload({ waitUntil: 'networkidle', timeout: 120000 });
await page.waitForTimeout(2500);
await openManage();
const afterReload = await deptNamesOnPage();
check('S3-2 リロード後も部門が保持', afterReload.every((d) => d.shown), JSON.stringify(afterReload));

await page.screenshot({ path: path.join(dir, '01-departments.png'), fullPage: true });
fs.writeFileSync(path.join(dir, 'departments-result.json'), JSON.stringify({ at: new Date().toISOString(), results }, null, 2));
await ctx.close();
