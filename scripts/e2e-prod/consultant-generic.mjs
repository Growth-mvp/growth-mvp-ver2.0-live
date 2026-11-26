import { chromium } from 'playwright';
import { BASE, PROFILE_DIR } from './common.mjs';
const COMPANY = '832d5bf2-ceb8-4aa9-8524-af33a557dc3a';
const STRATEGY = '12904f72-207e-4047-b0c0-5ce866ec617c';
const QUESTION = process.argv[2] ?? '今、何から取り組めばいい？';
const ctx = await chromium.launchPersistentContext(PROFILE_DIR, { headless: true, viewport: { width: 1400, height: 900 } });
const page = ctx.pages()[0] ?? (await ctx.newPage());
await page.goto(`${BASE}/stage1`, { waitUntil: 'networkidle', timeout: 120000 });
await page.waitForTimeout(1500);
const out = await page.evaluate(async ({ company, strategy, question }) => {
  let token = null, userId = null;
  for (const k of Object.keys(localStorage)) {
    if (!/^sb-.*-auth-token$/.test(k)) continue;
    try { const v = JSON.parse(localStorage.getItem(k)); token = v.access_token || v.currentSession?.access_token; userId = v.user?.id || v.currentSession?.user?.id; } catch {}
    if (token) break;
  }
  const r = await fetch('/api/ask-ceo-agent', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ userId, strategyId: strategy, companyId: company, screen: '/stage1', consult: null, messages: [{ role: 'user', content: question }] }) });
  const j = await r.json().catch(() => ({}));
  return { status: r.status, content: j.content ?? j.error ?? '' };
}, { company: COMPANY, strategy: STRATEGY, question: QUESTION });
console.log('STATUS', out.status);
console.log('ANSWER', String(out.content).replace(/\s+/g, ' ').slice(0, 400));
console.log('HAS_REGISTER_PROMPT', /財務データを登録|まず.*登録/.test(out.content));
console.log('HAS_NUMBER', /1\.5百万|160百万|0\.9|営業利益/.test(out.content));
await ctx.close();
