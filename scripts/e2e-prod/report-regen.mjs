import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { BASE, PROFILE_DIR, RUN_DIR } from './common.mjs';
const dir = path.join(RUN_DIR, 'report');
fs.mkdirSync(dir, { recursive: true });
const ctx = await chromium.launchPersistentContext(PROFILE_DIR, { headless: true, viewport: { width: 1400, height: 900 } });
const page = ctx.pages()[0] ?? (await ctx.newPage());
let crashed = false;
page.on('crash', () => { crashed = true; });
await page.goto(`${BASE}/report/bank-plan`, { waitUntil: 'networkidle', timeout: 120000 });
const regen = page.getByRole('button', { name: /AIで再生成|AI本文を生成/ }).first();
await regen.waitFor({ state: 'visible', timeout: 120000 });
const [gRes] = await Promise.all([
  page.waitForResponse((r) => r.url().includes('/api/plans/') && r.request().method() !== 'GET', { timeout: 300000 }),
  regen.click({ force: true }),
]);
console.log('REGEN', gRes.status(), new URL(gRes.url()).pathname);
const pdfBtn = page.getByRole('button', { name: 'PDFダウンロード' }).first();
await pdfBtn.waitFor({ state: 'visible', timeout: 120000 });
await page.waitForTimeout(3000);
const [download] = await Promise.all([page.waitForEvent('download', { timeout: 240000 }), pdfBtn.click({ force: true })]);
const file = path.join(dir, `bank-plan-fixed-${Date.now()}.pdf`);
await download.saveAs(file);
console.log('PDF', file, fs.statSync(file).size, 'crashed', crashed);
await ctx.close();
