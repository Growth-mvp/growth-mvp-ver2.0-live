/* STAGE5 の実レイアウトで、旧モーダル型の前面表示と、右側のAI経営コンサルタントの同時操作を確認する（評価専用）。
 * 1440px・1280px（AIドック表示）と、1100px（AIはドロワー）で、重なり・可読性・閉じる操作を見る。 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { pathToFileURL } = require('url');

const outDir = path.join(__dirname, '..', 'results-browser');
const PROJECT = '既存顧客の保守契約更新';
const results = [];
const external = [];
const errors = [];

const check = async (name, fn) => {
  try {
    results.push({ name, status: 'PASS', detail: (await fn()) ?? '' });
  } catch (e) {
    results.push({ name, status: 'FAIL', detail: String(e.message || e).split('\n')[0] });
  }
};

const aiInput = (page) =>
  page.locator('textarea[placeholder*="質問"], textarea[placeholder*="読み込み"], textarea[placeholder*="相談"], textarea[placeholder*="入力"]').last();

async function runAt(browser, width, height, withDockedAi) {
  const tag = `${width}`;
  const page = await browser.newPage({ viewport: { width, height } });
  await page.route('**/*', (route) => {
    const u = route.request().url();
    if (u.startsWith('file:')) return route.continue();
    external.push(u.slice(0, 120));
    return route.abort();
  });
  page.on('pageerror', (e) => errors.push(`[${tag}] PAGEERROR ` + e.message.slice(0, 200)));
  await page.goto(pathToFileURL(path.join(outDir, 'shell-stage5.html')).href);
  await page.waitForTimeout(2000);

  await check(`[${tag}] 通常時：ピラミッドが全幅で表示され、実行支援パネルは出ていない`, async () => {
    const panel = await page.locator('section[aria-label="実行支援"]').count();
    const card = await page.getByText(PROJECT, { exact: true }).filter({ visible: true }).count();
    if (panel) throw new Error('通常時にパネルが出ている');
    if (!card) throw new Error('ピラミッドが見えない');
    return 'ピラミッドを表示';
  });

  await page.getByText(PROJECT, { exact: true }).filter({ visible: true }).first().click();
  await page.waitForTimeout(700);

  await check(`[${tag}] プロジェクトを選ぶと、中央に実行支援パネルが前面表示される`, async () => {
    const panel = page.locator('section[aria-label="実行支援"]').first();
    await panel.waitFor({ state: 'visible', timeout: 5000 });
    const pb = await panel.boundingBox();
    if (!pb || pb.width < 480) throw new Error(`パネルが狭すぎる: ${pb && Math.round(pb.width)}px`);
    return `パネル幅 ${Math.round(pb.width)}px`;
  });

  await check(`[${tag}] プロジェクト名・実施事項の文字が読みやすい（見出し18px以上、実施事項16px以上）`, async () => {
    const h = await page.locator('section[aria-label="実行支援"] h2').first().evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
    if (h < 18) throw new Error(`見出しが小さい: ${h}px`);
    const actionTitle = page.locator('section[aria-label="実行支援"] summary span.text-base').first();
    const ac = await actionTitle.count();
    if (ac) {
      const a = await actionTitle.evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
      if (a < 16) throw new Error(`実施事項が小さい: ${a}px`);
    }
    return `見出し ${h}px`;
  });

  await check(`[${tag}] パネルは作業領域に収まり、横に溢れない`, async () => {
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    if (overflow) throw new Error('横方向にはみ出している');
    return '横の溢れなし';
  });

  if (withDockedAi) {
    await check(`[${tag}] パネルは右側のAIと重ならない`, async () => {
      const pb = await page.locator('section[aria-label="実行支援"]').first().boundingBox();
      const ai = await page.getByText('AI経営コンサルタント', { exact: false }).filter({ visible: true }).first().boundingBox();
      if (!pb || !ai) throw new Error('位置が取れない');
      if (pb.x + pb.width > ai.x) throw new Error(`重なっている（パネル右端 ${Math.round(pb.x + pb.width)} > AI ${Math.round(ai.x)}）`);
      return `パネル右端 ${Math.round(pb.x + pb.width)}px ≤ AI ${Math.round(ai.x)}px`;
    });

    await check(`[${tag}] 中央パネルと右側AIを同時に操作できる（右側AIの入力欄が覆われない）`, async () => {
      const ai = aiInput(page);
      await ai.waitFor({ state: 'visible', timeout: 5000 });
      const box = await ai.boundingBox();
      const hit = await page.evaluate(({ x, y }) => {
        const el = document.elementFromPoint(x, y);
        return el ? el.closest('textarea') !== null : false;
      }, { x: box.x + box.width / 2, y: box.y + box.height / 2 });
      if (!hit) throw new Error('右側AIの入力欄が覆われている');
      return '右側AIを操作できる';
    });

    await check(`[${tag}] 「今、困っていること」を右側AIへつなげる`, async () => {
      const problem = page.locator('section[aria-label="実行支援"] section', { hasText: '今、困っていること' }).first().locator('textarea').first();
      await problem.fill('継続率が伸びない理由をAIと一緒に考えたい');
      await page.getByRole('button', { name: 'AI経営コンサルタントに相談する' }).first().click();
      await page.waitForTimeout(400);
      const aiText = await aiInput(page).inputValue();
      if (aiText !== '継続率が伸びない理由をAIと一緒に考えたい') throw new Error('右側AIへ内容が渡らない: ' + aiText);
      return '右側AIへ渡した';
    });
  }

  await page.screenshot({ path: path.join(outDir, 'shots', `stage5-layout-open-${tag}.png`), fullPage: false });

  await check(`[${tag}] 閉じる操作で、従来のピラミッドに戻る`, async () => {
    await page.getByRole('button', { name: '実行支援パネルを閉じる' }).first().click();
    await page.waitForTimeout(400);
    const panel = await page.locator('section[aria-label="実行支援"]').count();
    const card = await page.getByText(PROJECT, { exact: true }).filter({ visible: true }).count();
    if (panel) throw new Error('閉じたのにパネルが残っている');
    if (!card) throw new Error('閉じた後にピラミッドが見えない');
    return 'ピラミッドに戻った';
  });

  await page.screenshot({ path: path.join(outDir, 'shots', `stage5-layout-closed-${tag}.png`), fullPage: false });
  await page.close();
}

(async () => {
  fs.mkdirSync(path.join(outDir, 'shots'), { recursive: true });
  const browser = await chromium.launch();
  await runAt(browser, 1440, 900, true);
  await runAt(browser, 1280, 800, true);
  await runAt(browser, 1100, 800, false);

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
