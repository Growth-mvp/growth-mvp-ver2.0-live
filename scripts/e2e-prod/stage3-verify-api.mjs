import { chromium } from 'playwright';
import { BASE, PROFILE_DIR } from './common.mjs';
const COMPANY = '832d5bf2-ceb8-4aa9-8524-af33a557dc3a';
const STRATEGY = '12904f72-207e-4047-b0c0-5ce866ec617c';
const ctx = await chromium.launchPersistentContext(PROFILE_DIR, { headless: true, viewport: { width: 1400, height: 900 } });
const page = ctx.pages()[0] ?? (await ctx.newPage());
await page.goto(`${BASE}/cascade`, { waitUntil: 'networkidle', timeout: 120000 });
const out = await page.evaluate(async ({ company, strategy }) => {
  let token = null;
  for (const k of Object.keys(localStorage)) { if (!/^sb-.*-auth-token$/.test(k)) continue; try { const v = JSON.parse(localStorage.getItem(k)); token = v.access_token || v.currentSession?.access_token; } catch {} if (token) break; }
  const r = await fetch('/api/stage3/adjustment/verify', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ companyId: company, strategyId: strategy }) });
  return { status: r.status, body: (await r.text()).slice(0, 300) };
}, { company: COMPANY, strategy: STRATEGY });
console.log('VERIFY', JSON.stringify(out));
await ctx.close();
