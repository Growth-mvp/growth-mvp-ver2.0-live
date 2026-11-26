import { chromium } from 'playwright';
import { BASE, PROFILE_DIR } from './common.mjs';
const ctx = await chromium.launchPersistentContext(PROFILE_DIR, { headless: true, viewport: { width: 1400, height: 900 } });
const page = ctx.pages()[0] ?? (await ctx.newPage());
await page.goto(`${BASE}/cascade`, { waitUntil: 'networkidle', timeout: 120000 });
await page.waitForTimeout(2500);
await page.getByRole('button', { name: '部門間調整' }).first().click({ force: true });
await page.waitForTimeout(3000);
const cards = await page.evaluate(() => {
  const heads = [...document.querySelectorAll('*')].filter((e) => e.children.length === 0 && /^\d+\. /.test(e.textContent?.trim() ?? ''));
  return heads.map((h) => {
    let card = h;
    for (let i = 0; i < 8 && card; i++) { card = card.parentElement; if (card && card.querySelectorAll('button').length >= 2 && /採用しない/.test(card.innerText)) break; }
    const decision = (card?.innerText.match(/判断：(採用|採用しない|保留)|未判断|(採用済み|採用しない)/) || ['?'])[0];
    return { title: h.textContent.trim().slice(0, 30), decision, adoptBtns: card ? [...card.querySelectorAll('button')].filter((b) => b.innerText.trim() === '採用する').length : -1 };
  });
});
console.log(JSON.stringify(cards, null, 1));
console.log('PENDING', (await page.evaluate(() => document.body.innerText.match(/調整の判断が\d+件残っています/)?.[0])) ?? 'none');
await ctx.close();
