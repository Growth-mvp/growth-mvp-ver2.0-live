/* STAGE5 最終設計案の3状態（初期表示・AI相談・協力依頼の全社共有）を、実ブラウザで撮影する（評価専用・架空データ・通信なし）。 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { pathToFileURL } = require('url');

const outDir = path.join(__dirname, '..', 'results-browser');

(async () => {
  fs.mkdirSync(path.join(outDir, 'shots'), { recursive: true });
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1320, height: 900 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route('**/*', (route) => (route.request().url().startsWith('file:') ? route.continue() : route.abort()));
  await page.goto(pathToFileURL(path.join(outDir, 'stage5-design-preview.html')).href);
  await page.waitForTimeout(500);

  const states = [
    { tab: '1 初期表示', file: 'stage5-design-1-start.png' },
    { tab: '2 AI相談時', file: 'stage5-design-2-consult.png' },
    { tab: '3 協力依頼の全社共有', file: 'stage5-design-3-share.png' },
  ];
  for (const s of states) {
    await page.getByRole('button', { name: s.tab, exact: true }).click();
    await page.waitForTimeout(200);
    await page.screenshot({ path: path.join(outDir, 'shots', s.file), fullPage: true });
  }

  /* 3 の操作：同意なしでは共有できないこと、同意後に共有の結果（トップの表示）が出ること */
  const shareBtn = page.getByRole('button', { name: '社内に共有する', exact: true });
  const disabledBefore = await shareBtn.isDisabled();
  await page.getByRole('checkbox', { name: /同意します/ }).check();
  const enabledAfter = !(await shareBtn.isDisabled());
  await shareBtn.click();
  const topPreview = await page.getByText('トップ画面での表示（プレビュー）').isVisible();
  await page.screenshot({ path: path.join(outDir, 'shots', 'stage5-design-3-shared.png'), fullPage: true });

  await browser.close();
  const checks = {
    shareBlockedBeforeConsent: disabledBefore,
    shareEnabledAfterConsent: enabledAfter,
    topPreviewShownAfterShare: topPreview,
    errors: errors.length,
  };
  fs.writeFileSync(path.join(outDir, 'stage5-design-preview-checks.json'), JSON.stringify(checks, null, 2));
  console.log(JSON.stringify(checks));
  process.exit(checks.shareBlockedBeforeConsent && checks.shareEnabledAfterConsent && checks.topPreviewShownAfterShare && errors.length === 0 ? 0 : 1);
})();
