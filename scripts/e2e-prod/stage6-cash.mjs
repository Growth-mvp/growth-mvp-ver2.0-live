import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { BASE, PROFILE_DIR, RUN_DIR } from './common.mjs';

const dir = path.join(RUN_DIR, 'stage6');
fs.mkdirSync(dir, { recursive: true });
const results = [];
const check = (id, ok, detail = '') => { results.push({ id, ok, detail }); console.log(`CHECK ${ok ? 'PASS' : 'FAIL'} ${id} ${detail}`); };
const MIN_CASH = '10';

const ctx = await chromium.launchPersistentContext(PROFILE_DIR, { headless: true, viewport: { width: 1400, height: 900 } });
const page = ctx.pages()[0] ?? (await ctx.newPage());
let crashed = false;
page.on('crash', () => { crashed = true; });
const writes = [];
const isWrite = (r) => r.request().method() !== 'GET' && (r.url().includes('/api/') || r.url().includes('supabase.co'));
page.on('response', (r) => { if (isWrite(r)) writes.push(`${r.request().method()} ${r.status()} ${new URL(r.url()).pathname}`); });

const open = async () => {
  await page.goto(`${BASE}/stage6`, { waitUntil: 'networkidle', timeout: 120000 });
  await page.locator('summary,button,[role=button]', { hasText: '財務計画の詳細・設定' }).first().click({ force: true });
  await page.locator('summary,button,[role=button],h3,h4', { hasText: 'お金は足りるか' }).first().click({ force: true });
  await page.locator('input[aria-label="手元に残しておきたいお金"]').first().waitFor({ state: 'attached', timeout: 60000 }).catch(() => null);
};

await open();
const cashInput = page.locator('input[aria-label="手元に残しておきたいお金"]').first();
check('S6-1 最低必要現預金の入力欄', (await cashInput.count()) > 0);
await cashInput.fill(MIN_CASH);
await cashInput.press('Tab');
const saveBtn = page.getByRole('button', { name: '財務計画を保存' }).first();
const [sRes] = await Promise.all([
  page.waitForResponse((r) => isWrite(r), { timeout: 120000 }).catch(() => null),
  saveBtn.click({ force: true }),
]);
check('S6-2 財務計画の保存', !!sRes && sRes.status() < 300, sRes ? `status=${sRes.status()} ${new URL(sRes.url()).pathname}` : 'no write response');

await open();
const kept = await page.locator('input[aria-label="手元に残しておきたいお金"]').first().inputValue();
check('S6-3 リロード後の最低必要現預金', kept === MIN_CASH, `value=${kept}`);
const text = await page.evaluate(() => document.body.innerText.replace(/\s+/g, ' '));
check('S6-4 資金判定が結論を示す（資金不足はありません）', /資金不足はありません/.test(text), (text.match(/資金[^。]{0,40}(保留|足りる|不足)[^。]{0,30}/) || ['none'])[0]);
check('S6-E 通信とクラッシュ', !crashed, `crashed=${crashed} ${writes.join(' | ')}`);
fs.writeFileSync(path.join(dir, 'cash-result.json'), JSON.stringify({ at: new Date().toISOString(), results, writes }, null, 2));
await ctx.close();
