/* STAGE5 モーダルの設計案を、実ブラウザでスクリーンショットに残す（評価専用・架空データ・通信なし）。 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { pathToFileURL } = require('url');

const outDir = path.join(__dirname, '..', 'results-browser');

(async () => {
  fs.mkdirSync(path.join(outDir, 'shots'), { recursive: true });
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1000, height: 900 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route('**/*', (route) => (route.request().url().startsWith('file:') ? route.continue() : route.abort()));
  await page.goto(pathToFileURL(path.join(outDir, 'modal-preview.html')).href);
  await page.waitForTimeout(600);
  await page.screenshot({ path: path.join(outDir, 'shots', 'modal-preview-a.png'), fullPage: true });

  await page.getByRole('button', { name: 'AIと相談する' }).click();
  await page.getByRole('button', { name: '上司に相談する' }).click();
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(outDir, 'shots', 'modal-preview-b.png'), fullPage: true });

  await browser.close();
  console.log(errors.length ? 'ERRORS: ' + errors.join(' | ') : 'OK: preview rendered (2 screenshots)');
  process.exit(errors.length ? 1 : 0);
})();
