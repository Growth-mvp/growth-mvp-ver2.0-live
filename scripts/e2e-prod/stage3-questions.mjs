import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { BASE, PROFILE_DIR, RUN_DIR } from './common.mjs';

const DEPTS = ['新聞販売・配達事業', '宅配事業'];
const ANSWERS = [
  '新聞の安定配達を守りつつ、地域の顧客接点を使って配送の受託を広げる役割を担う。',
  '購読者の減少で既存の配達収入が下がり続けており、このままでは2030年の目標に届かない。',
  '配達ルートの密度、地域の販売店との信頼関係、宅配網を共通資源として使えること。',
  '配送の受託単価と配達人員の稼働率を、案件ごとに採算で管理する仕組みを作る。',
  '新聞配達の品質を落とさないため、宅配の受注は配達稼働に余裕がある時間帯に限る。',
  '部門の利益率が低い案件を見直し、採算の取れる地域配送に人員を集中させる。',
];

const dir = path.join(RUN_DIR, 'stage3');
fs.mkdirSync(dir, { recursive: true });
const results = [];
const check = (id, ok, detail = '') => {
  results.push({ id, ok, detail });
  console.log(`CHECK ${ok ? 'PASS' : 'FAIL'} ${id} ${detail}`);
};

const ctx = await chromium.launchPersistentContext(PROFILE_DIR, { headless: true, viewport: { width: 1400, height: 900 } });
const page = ctx.pages()[0] ?? (await ctx.newPage());
let crashed = false;
page.on('crash', () => { crashed = true; });
const apiErrors = [];
page.on('response', (r) => {
  const u = r.url();
  if (u.includes('/api/') && r.status() >= 400) apiErrors.push(`${r.status()} ${new URL(u).pathname}`);
});

const qStatuses = () => page.evaluate(() => [...new Set([...document.querySelectorAll('button')].map((x) => x.innerText.replace(/\s+/g, ' ').trim()).filter((t) => /^Q\d /.test(t)))].map((t) => t.slice(-6)));

await page.goto(`${BASE}/cascade`, { waitUntil: 'networkidle', timeout: 120000 });
await page.waitForTimeout(2500);

for (const dept of DEPTS) {
  await page.getByRole('button', { name: dept, exact: true }).first().click();
  await page.waitForTimeout(2000);
  await page.getByRole('button', { name: /STEP2 6つの問い/ }).first().click({ force: true });
  await page.waitForTimeout(2500);

  for (let n = 1; n <= 6; n++) {
    const status = (await qStatuses())[n - 1] ?? '';
    if (status.includes('回答済み')) continue;
    await page.getByRole('button', { name: new RegExp(`^Q${n} `) }).first().click({ force: true });
    await page.waitForTimeout(1200);
    const gen = page.getByRole('button', { name: 'このテーマを生成' }).first();
    if ((await gen.count()) > 0) {
      const [res] = await Promise.all([
        page.waitForResponse((r) => r.url().includes('/api/') && r.request().method() === 'POST', { timeout: 240000 }).catch(() => null),
        gen.click({ force: true }),
      ]);
      check(`S3-Q${n} ${dept}: 問いの生成`, !!res && res.status() < 300, res ? `status=${res.status()} ${new URL(res.url()).pathname}` : 'no response');
      await page.waitForTimeout(2000);
    }
    const box = page.locator('textarea:visible').last();
    if ((await box.count()) === 0) {
      check(`S3-Q${n} ${dept}: 回答欄あり`, false, 'textarea not visible');
      continue;
    }
    await box.fill(ANSWERS[n - 1]);
    await page.waitForTimeout(1500);
  }

  const after = await qStatuses();
  const answered = after.filter((s) => s.includes('回答済み')).length;
  check(`S3-Q ${dept}: 6問が回答済み`, answered === 6, `answered=${answered} ${JSON.stringify(after)}`);
  if (answered < 6) break;

  await page.getByRole('button', { name: '6問を反映して戦略書を再生成' }).first().click({ force: true }).catch(() => null);
  await page.waitForTimeout(90000);
  const notice = await page.evaluate(() => document.body.innerText.replace(/\s+/g, ' ').match(/(保存しました|作れませんでした|失敗|エラー|できませんでした)[^。]{0,60}/)?.[0] ?? '');
  check(`S3-R ${dept}: 6問を反映して再生成`, /保存しました|再生成/.test(notice) && !/作れませんでした|失敗|エラー/.test(notice), notice || 'no notice');
  check(`S3-R ${dept}: 再生成でページが落ちない`, !crashed, `crashed=${crashed}`);
  if (crashed) break;
}

check('S3-E APIエラーなし', apiErrors.length === 0, apiErrors.join(','));
fs.writeFileSync(path.join(dir, 'questions-result.json'), JSON.stringify({ at: new Date().toISOString(), results, crashed, apiErrors }, null, 2));
await ctx.close();
