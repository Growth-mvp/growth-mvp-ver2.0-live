import { chromium } from 'playwright';
import { BASE, PROFILE_DIR } from './common.mjs';
const ctx = await chromium.launchPersistentContext(PROFILE_DIR, { headless: true, viewport: { width: 1400, height: 900 } });
const page = ctx.pages()[0] ?? (await ctx.newPage());
let crashed = false;
page.on('crash', () => { crashed = true; });
let sd = null;
page.on('response', async (r) => {
  if (r.url().includes('/rest/v1/strategy_data') && r.request().method() === 'GET' && !sd) {
    try { const j = await r.json(); const x = Array.isArray(j) ? j[0] : null; sd = x ? { deptCount: Array.isArray(x.departments) ? x.departments.length : null, deptSummary: Array.isArray(x.departments) ? x.departments.map((d) => ({ id: d.id, name: d.name, hasDraft: !!(d.strategyDraft || d.draft || d.answers2?.length), keys: Object.keys(d).slice(0, 12) })) : null } : null; } catch {}
  }
});
await page.goto(`${BASE}/cascade`, { waitUntil: 'networkidle', timeout: 120000 });
await page.waitForTimeout(3000);
console.log('CRASHED', crashed);
console.log('ROW', JSON.stringify(sd));
await ctx.close();
