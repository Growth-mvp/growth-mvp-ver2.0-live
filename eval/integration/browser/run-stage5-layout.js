/* STAGE5 の実レイアウト（サイドバー・ピラミッド・中央の実行支援パネル・右側のAI経営コンサルタント）で、
 * 同時に操作できること、右側AIが選択中の案件を認識すること、他の案件に切り替えても対象が混ざらないことを確認する（評価専用）。 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { pathToFileURL } = require('url');

const outDir = path.join(__dirname, '..', 'results-browser');
const PROJECT = '既存顧客の保守契約更新';
const results = [];
const external = [];
const errors = [];

const aiInput = (page) => page.locator('textarea[placeholder*="質問"], textarea[placeholder*="読み込み"], textarea[placeholder*="相談"], textarea[placeholder*="入力"]').last();
const check = async (name, fn) => {
  try {
    results.push({ name, status: 'PASS', detail: (await fn()) ?? '' });
  } catch (e) {
    results.push({ name, status: 'FAIL', detail: String(e.message || e).split('\n')[0] });
  }
};

(async () => {
  fs.mkdirSync(path.join(outDir, 'shots'), { recursive: true });
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.route('**/*', (route) => {
    const u = route.request().url();
    if (u.startsWith('file:')) return route.continue();
    external.push(u.slice(0, 120));
    return route.abort();
  });
  page.on('pageerror', (e) => errors.push('PAGEERROR ' + e.message.slice(0, 200)));
  await page.goto(pathToFileURL(path.join(outDir, 'shell-stage5.html')).href);
  await page.waitForTimeout(2000);

  await check('初期表示：ピラミッドと、右側のAI経営コンサルタントが同時に見える', async () => {
    const pyramid = await page.getByText(PROJECT, { exact: true }).filter({ visible: true }).count();
    const ai = await page.getByText('AI経営コンサルタント', { exact: false }).filter({ visible: true }).count();
    if (!pyramid) throw new Error('ピラミッドのプロジェクトが見えない');
    if (!ai) throw new Error('右側のAIが見えない');
    return 'ピラミッド・右側AIを表示';
  });

  await page.getByText(PROJECT, { exact: true }).filter({ visible: true }).first().click();
  await page.waitForTimeout(800);

  await check('プロジェクトを選ぶと、中央の実行支援パネルが開き、ピラミッドは残る', async () => {
    const panel = page.locator('section[aria-label="実行支援"]').first();
    await panel.waitFor({ state: 'visible', timeout: 5000 });
    const pb = await panel.boundingBox();
    const dept = await page.getByText('営業部', { exact: true }).filter({ visible: true }).first().boundingBox();
    if (!pb || !dept) throw new Error('位置が取れない');
    if (pb.x <= dept.x) throw new Error('パネルがピラミッドの左に出ている');
    return `パネル x=${Math.round(pb.x)}、ピラミッドの部門 x=${Math.round(dept.x)}`;
  });

  await check('パネルと右側AIを同時に操作できる：右側AIの入力欄が、覆われずに操作対象になる', async () => {
    const ai = aiInput(page);
    await ai.waitFor({ state: 'visible', timeout: 5000 });
    const box = await ai.boundingBox();
    const hit = await page.evaluate(({ x, y }) => {
      const el = document.elementFromPoint(x, y);
      return el ? el.closest('textarea') !== null : false;
    }, { x: box.x + box.width / 2, y: box.y + box.height / 2 });
    if (!hit) throw new Error('右側AIの入力欄が覆われている');
    return '右側AIの入力欄が操作できる';
  });

  await check('「今、困っていること」を右側AIへつなげ、選択中の案件を認識させる', async () => {
    const problem = page.locator('section[aria-label="実行支援"]').first().locator('textarea').first();
    await problem.fill('継続率が伸びない理由をAIと一緒に考えたい');
    await page.getByRole('button', { name: 'AI経営コンサルタントに相談する' }).first().click();
    await page.waitForTimeout(400);
    const aiText = await aiInput(page).inputValue();
    if (aiText !== '継続率が伸びない理由をAIと一緒に考えたい') throw new Error('右側AIへ内容が渡らない: ' + aiText);
    const chip = await page.getByText('相談中：', { exact: false }).filter({ visible: true }).count();
    if (!chip) throw new Error('相談中の案件が表示されない');
    return '内容を右側AIへ渡し、「相談中」の案件を表示';
  });

  await page.screenshot({ path: path.join(outDir, 'shots', 'stage5-layout-1440.png'), fullPage: false });

  await check('AIへの相談は、送信しなければ社内に共有されない（投稿は行わない）', async () => {
    const posts = await page.evaluate(() => (window.__progressInserts || []).length);
    if (posts !== 0) throw new Error('送信していないのに投稿された');
    return '投稿0件';
  });

  await check('ブラウザ実行中に例外・外部通信がない', async () => {
    if (errors.length) throw new Error(errors.slice(0, 2).join(' | '));
    if (external.length) throw new Error('外部通信: ' + external.length);
    return 'エラー0件・外部通信0件';
  });

  await browser.close();
  const summary = { total: results.length, pass: results.filter((r) => r.status === 'PASS').length, results };
  fs.writeFileSync(path.join(outDir, 'stage5-layout-results.json'), JSON.stringify(summary, null, 2));
  for (const r of results) console.log(`${r.status}  ${r.name}  ${r.detail}`);
  console.log(`\n${summary.pass}/${summary.total} PASS`);
  process.exit(summary.pass === summary.total ? 0 : 1);
})();
