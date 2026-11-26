import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { BASE, PROFILE_DIR, RUN_DIR } from './common.mjs';

const dir = path.join(RUN_DIR, 'consultant');
fs.mkdirSync(dir, { recursive: true });
const results = [];
const check = (id, ok, detail = '') => {
  results.push({ id, ok, detail });
  console.log(`CHECK ${ok ? 'PASS' : 'FAIL'} ${id} ${detail}`);
};

const ctx = await chromium.launchPersistentContext(PROFILE_DIR, { headless: true, viewport: { width: 1400, height: 900 } });
const page = ctx.pages()[0] ?? (await ctx.newPage());
const apiErrors = [];
page.on('response', (r) => { if (r.url().includes('/api/') && r.status() >= 400) apiErrors.push(`${r.status()} ${new URL(r.url()).pathname}`); });

await page.goto(`${BASE}/stage1`, { waitUntil: 'networkidle', timeout: 120000 });
await page.waitForTimeout(1500);

async function chip(label, file) {
  await page.getByRole('button', { name: '会話を始める' }).first().click({ timeout: 3000 }).catch(() => {});
  await page.waitForTimeout(800);
  const [res] = await Promise.all([
    page.waitForResponse((r) => r.url().includes('/api/ask-ceo-agent') && r.request().method() === 'POST', { timeout: 180000 }).catch(() => null),
    page.getByRole('button', { name: label }).first().click(),
  ]);
  await page.waitForTimeout(4000);
  const body = res ? await res.text().catch(() => '') : '';
  let answer = '';
  try {
    const j = JSON.parse(body);
    answer = j.answer ?? j.reply ?? j.message ?? j.text ?? j.content ?? JSON.stringify(j).slice(0, 400);
  } catch {
    answer = body;
  }
  await page.screenshot({ path: path.join(dir, `${file}.png`), fullPage: false });
  return { status: res?.status() ?? null, answer: String(answer) };
}

const r1 = await chip('今、何から取り組めばいい？', 'q1-next-step');
check('C-1 AI経営コンサルタントが応答（自社情報参照）', r1.status === 200, `status=${r1.status}`);
const usesOwnFinance = /1\.5百万円|160百万円|0\.9%|営業利益[^。]{0,20}1\.5|売上[^。]{0,20}160/.test(r1.answer);
const asksToRegister = /財務データを登録|まず.*登録/.test(r1.answer);
check('C-2 登録済みの2025年財務値を回答に含む（登録済みなのに登録を促さない）', usesOwnFinance && !asksToRegister, r1.answer.slice(0, 200).replace(/\s+/g, ' '));

await page.goto(`${BASE}/stage1`, { waitUntil: 'networkidle', timeout: 120000 });
await page.waitForTimeout(1500);
const r2 = await chip('この画面の使い方', 'q2-operation-guide');
check('C-3 操作案内の応答', r2.status === 200 && r2.answer.length > 20, r2.answer.slice(0, 200).replace(/\s+/g, ' '));

check('C-4 チャットAPIのエラーなし', apiErrors.length === 0, apiErrors.join(','));

fs.writeFileSync(path.join(dir, 'result.json'), JSON.stringify({ at: new Date().toISOString(), results, apiErrors, samples: { q1: r1.answer.slice(0, 600), q2: r2.answer.slice(0, 600) } }, null, 2));
await ctx.close();
