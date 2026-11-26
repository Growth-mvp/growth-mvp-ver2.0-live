import { chromium } from 'playwright';
import { BASE, PROFILE_DIR } from './common.mjs';
const FIELDS = [
  ['実行責任者の名前', 'text', '案件採算判定担当'],
  ['売上増加の売上の金額', 'number', '6000000'],
  ['売上増加の粗利率', 'number', '30'],
  ['売上増加の開始年月', 'month', '2027-01'],
  ['削減効果（年間削減額）の年間削減額', 'number', '1200000'],
  ['削減効果（年間削減額）の開始年月', 'month', '2027-02'],
];
const ctx = await chromium.launchPersistentContext(PROFILE_DIR, { headless: true, viewport: { width: 1400, height: 900 } });
const page = ctx.pages()[0] ?? (await ctx.newPage());
const log = [];
const t0 = Date.now(); const ts = () => `${Math.round((Date.now() - t0) / 1000)}s`;
let crashed = false;
page.on('crash', () => { crashed = true; log.push(`${ts()} CRASH`); });
page.on('pageerror', (e) => log.push(`${ts()} PAGEERROR ${String(e.message).slice(0, 120)}`));
page.on('console', (m) => { if (m.type() === 'error') log.push(`${ts()} CONSOLE ${m.text().slice(0, 120)}`); });
const heap = () => page.evaluate(() => Math.round(performance.memory.usedJSHeapSize / 1048576)).catch(() => -1);
await page.goto(`${BASE}/okr`, { waitUntil: 'networkidle', timeout: 120000 });
await page.waitForTimeout(4000);
await page.getByRole('button', { name: /新聞配達の時間・品質を守る/ }).first().click({ force: true });
await page.waitForTimeout(4000);
await page.getByText('財務効果を設定する').first().click({ force: true }).catch((e) => log.push('EXPAND_ERR ' + e.message.slice(0, 80)));
await page.waitForTimeout(2000);
log.push(`${ts()} HEAP_OPEN ${await heap()} visible_sales=${await page.locator('[aria-label="売上増加の売上の金額"]').first().isVisible().catch(() => 'n/a')}`);
for (const [label, type, value] of FIELDS) {
  if (crashed) break;
  const el = page.locator(`[aria-label="${label}"]`).first();
  log.push(`${ts()} FIELD ${label} count=${await el.count()}`);
  if ((await el.count()) === 0) continue;
  await el.fill(value).catch((e) => log.push(`${ts()} FILL_ERR ${e.message.slice(0, 80)}`));
  log.push(`${ts()} FILLED ${label} heap=${await heap()} crashed=${crashed}`);
  await page.waitForTimeout(1500);
  log.push(`${ts()} AFTER_WAIT heap=${await heap()} crashed=${crashed}`);
}
console.log(log.join('\n'));
await ctx.close().catch(() => null);
