import { chromium } from 'playwright';
import { BASE, PROFILE_DIR } from './common.mjs';
const ctx = await chromium.launchPersistentContext(PROFILE_DIR, { headless: true, viewport: { width: 1400, height: 900 } });
const page = ctx.pages()[0] ?? (await ctx.newPage());
const state = () => page.evaluate(() => ({
  textarea: [...document.querySelectorAll('textarea')].filter((t) => t.getBoundingClientRect().width > 0 && t.placeholder === '質問を入力してください').length,
  micPressed: [...document.querySelectorAll('button[aria-pressed]')].map((b) => `${b.getAttribute('aria-label') || b.innerText.trim()}=${b.getAttribute('aria-pressed')}`),
  listening: /話しています|聞き取|録音中|音声を認識/.test(document.body.innerText),
}));
await page.goto(`${BASE}/stage1`, { waitUntil: 'networkidle', timeout: 120000 });
await page.waitForTimeout(4000);
console.log('LOAD', JSON.stringify(await state()));
await page.reload({ waitUntil: 'networkidle', timeout: 120000 });
await page.waitForTimeout(4000);
console.log('RELOAD', JSON.stringify(await state()));
await ctx.close();
