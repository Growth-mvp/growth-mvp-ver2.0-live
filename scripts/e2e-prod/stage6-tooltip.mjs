import { chromium } from 'playwright';
import { BASE, PROFILE_DIR } from './common.mjs';
const ctx = await chromium.launchPersistentContext(PROFILE_DIR, { headless: true, viewport: { width: 1400, height: 900 } });
const page = ctx.pages()[0] ?? (await ctx.newPage());
await page.goto(`${BASE}/stage6`, { waitUntil: 'networkidle', timeout: 120000 });
await page.waitForTimeout(5000);
const surfaces = page.locator('.recharts-wrapper');
const n = await surfaces.count();
console.log('CHARTS', n);
for (let c = 0; c < Math.min(n, 2); c++) {
  const w = surfaces.nth(c);
  const box = await w.boundingBox();
  const title = await w.evaluate((el) => (el.closest('section,div')?.innerText || '').replace(/\s+/g, ' ').slice(0, 40));
  const xs = await w.locator('.recharts-xAxis .recharts-cartesian-axis-tick-value').allInnerTexts();
  const ys = await w.locator('.recharts-yAxis .recharts-cartesian-axis-tick-value').allInnerTexts();
  console.log('CHART', c, title, 'X', JSON.stringify(xs), 'Y', JSON.stringify(ys));
  const dots = await w.locator('.recharts-line-dot, .recharts-dot').count();
  for (let i = 0; i < Math.min(dots, 12); i++) {
    const d = w.locator('.recharts-line-dot, .recharts-dot').nth(i);
    await d.hover({ force: true }).catch(() => null);
    await page.waitForTimeout(150);
    const tip = await w.locator('.recharts-tooltip-wrapper').first().innerText().catch(() => '');
    if (tip) console.log('TIP', c, i, tip.replace(/\s+/g, ' ').slice(0, 160));
  }
  void box;
}
await ctx.close();
