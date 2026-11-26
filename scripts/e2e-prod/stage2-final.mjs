import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { BASE, PROFILE_DIR, RUN_DIR } from './common.mjs';

const dir = path.join(RUN_DIR, 'stage2');
fs.mkdirSync(dir, { recursive: true });
const results = [];
const check = (id, ok, detail = '') => {
  results.push({ id, ok, detail });
  console.log(`CHECK ${ok ? 'PASS' : 'FAIL'} ${id} ${detail}`);
};

const ctx = await chromium.launchPersistentContext(PROFILE_DIR, { headless: true, viewport: { width: 1400, height: 900 } });
const page = ctx.pages()[0] ?? (await ctx.newPage());
const consoleErrors = [];
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 160)); });
const apiErrors = [];
const finalWrites = [];
page.on('response', (r) => {
  const u = r.url();
  if (u.includes('/api/') && r.status() >= 400) apiErrors.push(`${r.status()} ${new URL(u).pathname}`);
  if (u.includes('/rest/v1/final_stories') && r.request().method() !== 'GET') finalWrites.push({ method: r.request().method(), status: r.status() });
});

const storeLens = () =>
  page.evaluate(() => {
    const st = JSON.parse(localStorage.getItem('strategy-store-v5') || '{}');
    const x = st.state ?? st;
    const len = (v) => (typeof v === 'string' ? v.trim().length : v == null ? 0 : JSON.stringify(v).length);
    return { storyDraft: len(x.storyDraft), finalStory: len(x.finalStory) };
  });

const firstFinalLine = (chapters) => {
  const c = Array.isArray(chapters) ? chapters[0] : null;
  const body = c?.body ?? c?.text ?? c?.content ?? '';
  return String(body).replace(/\s+/g, ' ').slice(0, 18);
};

const bodyShowsFinal = (sample) =>
  page.evaluate((s) => (s ? document.body.innerText.replace(/\s+/g, ' ').includes(s) : false), sample);

const showsInFinalTab = async (sample) => {
  await page.getByRole('button', { name: /最終確定/ }).first().click({ force: true });
  await page.waitForTimeout(2500);
  return bodyShowsFinal(sample);
};

await page.goto(`${BASE}/stage2`, { waitUntil: 'networkidle', timeout: 120000 });
await page.waitForTimeout(2000);
const before = await storeLens();
check('S2-3 たたき台（storyDraft）が生成済み', before.storyDraft > 0, JSON.stringify(before));

await page.getByRole('button', { name: /戦略議論/ }).first().click();
await page.waitForTimeout(1500);
const genBtn = page.getByRole('button', { name: /^経営戦略を生成/ }).first();
check('S2-4a 戦略議論タブに「経営戦略を生成」がある', (await genBtn.count()) > 0);

const [finalRes] = await Promise.all([
  page.waitForResponse((r) => r.url().includes('/api/stage2/generate-final'), { timeout: 420000 }).catch(() => null),
  genBtn.click(),
]);
let generated = null;
if (finalRes && finalRes.status() === 200) {
  try { generated = JSON.parse(await finalRes.text()); } catch {}
}
check('S2-4b 経営戦略の生成APIが200', !!finalRes && finalRes.status() === 200, finalRes ? `status=${finalRes.status()}` : 'no response');
await page.waitForTimeout(8000);

const sample = firstFinalLine(generated?.finalStory ?? generated?.sections);
const afterGen = await storeLens();
const savedOk = finalWrites.some((w) => w.status >= 200 && w.status < 300);
check('S2-4d 経営戦略の保存通信（final_stories）が成功', savedOk, JSON.stringify(finalWrites));
check('S2-4e 生成した本文が「最終確定」タブに表示', sample.length > 0 && (await showsInFinalTab(sample)), `sample="${sample}"`);
await page.screenshot({ path: path.join(dir, '04-final-generated.png'), fullPage: true });

await page.reload({ waitUntil: 'networkidle', timeout: 120000 });
await page.waitForTimeout(3000);
const afterReload = await storeLens();
check('S2-5a リロード後も経営戦略が保持（ローカル）', afterReload.finalStory > 0 && afterReload.finalStory === afterGen.finalStory, `gen=${afterGen.finalStory} reload=${afterReload.finalStory}`);
check('S2-5b リロード後も「最終確定」タブに本文が表示', sample.length > 0 && (await showsInFinalTab(sample)), `sample="${sample}"`);

fs.writeFileSync(
  path.join(dir, 'final-result.json'),
  JSON.stringify({ at: new Date().toISOString(), results, apiErrors, finalWrites, consoleErrors: consoleErrors.slice(0, 10) }, null, 2),
);
await ctx.close();
