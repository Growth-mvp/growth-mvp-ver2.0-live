import { chromium } from 'playwright';
import { BASE, PROFILE_DIR } from './common.mjs';
const ctx = await chromium.launchPersistentContext(PROFILE_DIR, { headless: true, viewport: { width: 1400, height: 900 } });
const page = ctx.pages()[0] ?? (await ctx.newPage());
await page.goto(`${BASE}/stage6`, { waitUntil: 'networkidle', timeout: 120000 });
await page.waitForTimeout(5000);
const sec = await page.evaluate(() => {
  const t = document.body.innerText.replace(/\s+/g, ' ');
  const cut = (a, b) => { const i = t.indexOf(a); if (i < 0) return null; const j = b ? t.indexOf(b, i + a.length) : -1; return t.slice(i, j > 0 ? j : i + 900); };
  return {
    s1: cut('① 現場はどれだけ成果を上げているか', '② 経営目標'),
    s2: cut('② 経営目標は実現できそうか', '③ 資金は足りるか'),
    s3: cut('③ 資金は足りるか', null),
  };
});
console.log(JSON.stringify(sec, null, 1).slice(0, 4500));
await ctx.close();
