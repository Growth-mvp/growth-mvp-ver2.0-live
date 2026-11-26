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

const remaining = () =>
  page.evaluate(() => {
    const m = document.body.innerText.match(/残り(\d+)件まで追加できます/);
    return m ? Number(m[1]) : null;
  });

await page.goto(`${BASE}/stage1`, { waitUntil: 'networkidle', timeout: 120000 });
await page.getByRole('button', { name: '分析・論点' }).click();
await page.waitForTimeout(1200);
await page.getByText('② 論点整理').first().click();
await page.waitForTimeout(2500);

const before = await remaining();
const candidates = page.locator('input[type=checkbox]');
const cbCount = await candidates.count();
check('S1-9 論点候補が表示される', cbCount >= 2 && before !== null, `checkboxes=${cbCount} remainingBefore=${before}`);

const toAdd = Math.min(2, before ?? 0);
let checked = 0;
for (let i = 0; i < cbCount && checked < toAdd; i++) {
  const cb = candidates.nth(i);
  if (!(await cb.isChecked())) {
    await cb.check();
    checked += 1;
  }
}
await page.getByRole('button', { name: '選択した論点を追加' }).click();
await page.waitForTimeout(3000);
await page.screenshot({ path: path.join(dir, '40-issues-added.png'), fullPage: true });

const afterAdd = await remaining();
check('S1-10 選択した論点を追加（残り枠が減る）', before !== null && afterAdd === before - checked, `before=${before} added=${checked} after=${afterAdd}`);

await page.getByRole('button', { name: '全体保存' }).click();
await page.waitForTimeout(4000);

await page.reload({ waitUntil: 'networkidle', timeout: 120000 });
await page.getByRole('button', { name: '分析・論点' }).click();
await page.waitForTimeout(1200);
await page.getByText('② 論点整理').first().click();
await page.waitForTimeout(2500);
const afterReload = await remaining();
check('S1-11 リロード後も採用件数が保持', afterAdd !== null && afterReload === afterAdd, `afterAdd=${afterAdd} afterReload=${afterReload}`);
await page.screenshot({ path: path.join(dir, '41-issues-reloaded.png'), fullPage: true });

await page.getByRole('button', { name: /この分析をもとに、経営戦略を考える/ }).click().catch(() => {});
await page.waitForTimeout(4000);
const toStage2 = new URL(page.url()).pathname;
check('S1-12 STAGE2へ引き渡し', toStage2.startsWith('/stage2'), toStage2);

fs.writeFileSync(path.join(dir, 'issues-result.json'), JSON.stringify({ at: new Date().toISOString(), results }, null, 2));
await ctx.close();
