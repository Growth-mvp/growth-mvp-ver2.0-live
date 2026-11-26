import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { BASE, PROFILE_DIR, RUN_DIR } from './common.mjs';

const dir = path.join(RUN_DIR, 'report');
fs.mkdirSync(dir, { recursive: true });
const results = [];
const check = (id, ok, detail = '') => { results.push({ id, ok, detail }); console.log(`CHECK ${ok ? 'PASS' : 'FAIL'} ${id} ${detail}`); };

const ctx = await chromium.launchPersistentContext(PROFILE_DIR, { headless: true, viewport: { width: 1400, height: 900 } });
const page = ctx.pages()[0] ?? (await ctx.newPage());
let crashed = false;
page.on('crash', () => { crashed = true; });

await page.goto(`${BASE}/report/bank-plan`, { waitUntil: 'networkidle', timeout: 120000 });
const genBtn = page.getByRole('button', { name: 'AI本文を生成' }).first();
if ((await genBtn.count()) > 0) {
  const [gRes] = await Promise.all([
    page.waitForResponse((r) => r.url().includes('/api/plans/') && r.request().method() !== 'GET', { timeout: 300000 }).catch(() => null),
    genBtn.click(),
  ]);
  check('R-0 計画書本文の生成API', !!gRes && gRes.status() < 300, gRes ? 'status=' + gRes.status() + ' ' + new URL(gRes.url()).pathname : 'no response');
}
const pdfBtn = page.getByRole('button', { name: 'PDFダウンロード' }).first();
await pdfBtn.waitFor({ state: 'visible', timeout: 120000 });
check('R-1 PDFダウンロードボタンが操作可能', await pdfBtn.isEnabled());
const [download] = await Promise.all([
  page.waitForEvent('download', { timeout: 240000 }).catch(() => null),
  pdfBtn.click(),
]);
if (download) {
  const file = path.join(dir, `bank-plan-${Date.now()}.pdf`);
  await download.saveAs(file);
  const buf = fs.readFileSync(file);
  check('R-2 PDFを出力（ファイル形式とサイズ）', buf.slice(0, 4).toString() === '%PDF' && buf.length > 5000, `bytes=${buf.length} name=${download.suggestedFilename()}`);
} else {
  check('R-2 PDFを出力（ファイル形式とサイズ）', false, 'no download event');
}
const shown = await page.evaluate(() => document.body.innerText.replace(/\s+/g, ' '));
check('R-3 プレビューに計画書の本文', shown.includes('経営計画書') || shown.includes('銀行'), shown.slice(0, 120));
check('R-E クラッシュ', !crashed, `crashed=${crashed}`);
fs.writeFileSync(path.join(dir, 'pdf-result.json'), JSON.stringify({ at: new Date().toISOString(), results }, null, 2));
await ctx.close();
