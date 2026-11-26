import { chromium } from 'playwright';
import { BASE, PROFILE_DIR } from './common.mjs';
const ctx = await chromium.launchPersistentContext(PROFILE_DIR, { headless: true, viewport: { width: 1400, height: 900 } });
const page = ctx.pages()[0] ?? (await ctx.newPage());
let crashed = false;
page.on('crash', () => { crashed = true; });
const errs = [];
page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 160)); });
await page.goto(`${BASE}/cascade`, { waitUntil: 'networkidle', timeout: 120000 });
await page.waitForTimeout(2500);
for (const d of ['新聞販売・配達事業', '宅配事業']) {
  await page.getByRole('button', { name: d, exact: true }).first().click().catch(() => {});
  await page.waitForTimeout(2500);
  await page.getByRole('button', { name: /STEP1 たたき台/ }).first().click({ force: true }).catch(() => {});
  await page.waitForTimeout(4000);
  console.log('STEP1_VIEW', d, 'crashed=', crashed);
}
console.log('ERRS', JSON.stringify(errs.slice(-5)));
await ctx.close();
