import { chromium } from 'playwright';
import { BASE, PROFILE_DIR } from './common.mjs';
const ctx = await chromium.launchPersistentContext(PROFILE_DIR, { headless: true, viewport: { width: 1400, height: 900 } });
const page = ctx.pages()[0] ?? (await ctx.newPage());
let row = null;
page.on('response', async (r) => {
  if (r.url().includes('/rest/v1/strategy_data') && r.request().method() === 'GET' && !row) {
    try { const j = await r.json(); row = Array.isArray(j) ? j[0] : null; } catch {}
  }
});
await page.goto(`${BASE}/cascade`, { waitUntil: 'networkidle', timeout: 120000 });
await page.waitForTimeout(3000);
const len = (v) => (Array.isArray(v) ? v.length : v && typeof v === 'object' ? Object.keys(v).length : v ? 1 : 0);
console.log('DB', JSON.stringify({
  finalStoryDraft: len(row?.final_story_draft), finalStoryEdited: len(row?.final_story_edited), finalStoryFinal: len(row?.final_story_final),
  bridge: row?.stage3_strategy_bridge ? Object.keys(row.stage3_strategy_bridge).slice(0, 6) : null,
  revision: row?.revision,
}));
const t = await page.evaluate(() => document.body.innerText.replace(/\s+/g, ' ').slice(0, 400));
console.log('CASCADE_TEXT', t.slice(0, 300));
await ctx.close();
