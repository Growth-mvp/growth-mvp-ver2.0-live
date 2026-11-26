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
const apiErrors = [];
page.on('response', (r) => { if (r.url().includes('/api/') && r.status() >= 400) apiErrors.push(`${r.status()} ${new URL(r.url()).pathname}`); });

await page.goto(`${BASE}/cascade`, { waitUntil: 'networkidle', timeout: 120000 });
await page.waitForTimeout(2500);

for (const dept of DEPTS) {
  await page.getByRole('button', { name: dept, exact: true }).first().click();
  await page.waitForTimeout(1500);
  const step2Enabled = async () => !(await page.getByRole('button', { name: /STEP2 6つの問い/ }).first().isDisabled().catch(() => true));
  if (await step2Enabled()) {
    check(`S3-3 ${dept}: たたき台は生成済み`, true, 'STEP2が有効');
    continue;
  }
  const genBtn = page.getByRole('button', { name: /AIで戦略書のたたき台を作成/ }).first();
  const [res] = await Promise.all([
    page.waitForResponse((r) => r.url().includes('/api/generate-department-draft') && r.request().method() === 'POST', { timeout: 300000 }).catch(() => null),
    genBtn.click({ force: true }),
  ]);
  check(`S3-3a ${dept}: 戦略書たたき台の生成APIが200`, !!res && res.status() === 200, res ? `status=${res.status()}` : 'no response');
  await page.waitForTimeout(5000);
  check(`S3-3b ${dept}: 生成後にSTEP2が有効`, await step2Enabled());
}
await page.screenshot({ path: path.join(dir, '02-drafts.png'), fullPage: true });

await page.reload({ waitUntil: 'networkidle', timeout: 120000 });
await page.waitForTimeout(2500);
for (const dept of DEPTS) {
  await page.getByRole('button', { name: dept, exact: true }).first().click();
  await page.waitForTimeout(1500);
  const enabled = !(await page.getByRole('button', { name: /STEP2 6つの問い/ }).first().isDisabled().catch(() => true));
  check(`S3-4 ${dept}: リロード後もたたき台が保持（STEP2有効）`, enabled);
}
check('S3-5 APIエラーなし', apiErrors.length === 0, apiErrors.join(','));

fs.writeFileSync(path.join(dir, 'draft-result.json'), JSON.stringify({ at: new Date().toISOString(), results }, null, 2));
await ctx.close();
