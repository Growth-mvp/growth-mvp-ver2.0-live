/* 本番相当（NODE_ENV=production）で /okr をバンドルし、開発用の実行計画書の試作が含まれず、
 * 画面にも入口が出ないことを確かめる（評価専用。外部通信は遮断）。 */
const fs = require('fs');
const path = require('path');
const esbuild = require('esbuild');
const { chromium } = require('playwright');
const { pathToFileURL } = require('url');

const root = path.join(__dirname, '..', '..', '..');
const outDir = path.join(__dirname, '..', 'results-browser');
const S = (f) => path.join(__dirname, 'stubs', f);

const STUB_MAP = {
  '@/store/strategyStore': S('strategyStore.ts'),
  '@/utils/access': S('access.ts'),
  '@/store/userStore': S('misc.ts'),
  '@/app/StrategyGuard': S('misc.ts'),
  '@/hooks/useCapabilities': S('misc.ts'),
  '@/utils/resetAll': S('misc.ts'),
  '@/utils/loader': S('misc.ts'),
  '@/utils/debug': S('misc.ts'),
  '@/utils/supabase/client': S('misc.ts'),
  '@/hooks/useAutoSave': S('misc.ts'),
  '@/hooks/useStage4PdfExport': S('misc.ts'),
  '@/services/okrService': S('misc.ts'),
  'next/navigation': S('misc.ts'),
};

const keys = Object.keys(STUB_MAP).map((k) => k.replace(/[/.*+?^${}()|[\]\\]/g, '\\$&'));
const filter = new RegExp('^(' + keys.join('|') + ')$');
const stubPlugin = {
  name: 'stub-external-modules',
  setup(build) {
    build.onResolve({ filter }, (args) => ({ path: STUB_MAP[args.path] }));
  },
};

const bundleName = 'okr-prod-bundle.js';
const markers = ['DevPlanDocument', 'PLAN_DOC_CSS', '開発用の表示です。架空企業の保存済みデータ', '開発用：新しい実行計画書を表示（架空サンプル）'];

(async () => {
  const common = {
    entryPoints: [path.join(__dirname, 'okr-entry.tsx')],
    bundle: true,
    tsconfig: path.join(root, 'tsconfig.json'),
    jsx: 'automatic',
    format: 'iife',
    platform: 'browser',
    target: 'es2020',
    charset: 'utf8',
    plugins: [stubPlugin],
    logLevel: 'warning',
  };
  // 陽性の対照：開発版（NODE_ENV=development）には、同じ文字列が含まれること
  await esbuild.build({
    ...common,
    outfile: path.join(outDir, 'okr-dev-utf8-bundle.js'),
    define: { 'process.env': '{"NODE_ENV":"development"}', 'process.env.NODE_ENV': '"development"' },
  });
  const devCode = fs.readFileSync(path.join(outDir, 'okr-dev-utf8-bundle.js'), 'utf8');
  const positiveControl = markers.map((m) => ({ marker: m, found: devCode.includes(m) }));
  await esbuild.build({
    ...common,
    outfile: path.join(outDir, bundleName),
    bundle: true,
    tsconfig: path.join(root, 'tsconfig.json'),
    jsx: 'automatic',
    format: 'iife',
    platform: 'browser',
    target: 'es2020',
    define: { 'process.env': '{"NODE_ENV":"production"}', 'process.env.NODE_ENV': '"production"' },
    minify: true,
  });
  const html =
    '<!doctype html><html lang="ja"><head><meta charset="utf-8"><title>本番相当 /okr</title><link rel="stylesheet" href="app.css"></head>' +
    '<body><div id="root"></div><script src="' + bundleName + '"></script></body></html>';
  fs.writeFileSync(path.join(outDir, 'okr-prod.html'), html);

  const code = fs.readFileSync(path.join(outDir, bundleName), 'utf8');
  const bundleHits = markers.map((m) => ({ marker: m, found: code.includes(m) }));

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const external = [];
  await page.route('**/*', (route) => {
    const url = route.request().url();
    if (url.startsWith('file:')) return route.continue();
    external.push(url);
    return route.abort();
  });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(pathToFileURL(path.join(outDir, 'okr-prod.html')).href);
  await page.waitForTimeout(800);
  await page.locator('aside button', { hasText: '既存顧客の保守契約更新' }).first().click();
  await page.waitForTimeout(500);
  const entryCount = await page.getByRole('button', { name: /開発用/ }).count();
  const bodyText = await page.locator('body').innerText();
  await browser.close();

  const result = {
    bundle: bundleName,
    positiveControlInDevBundle: positiveControl,
    markers: bundleHits,
    entryButtonsOnPage: entryCount,
    devNoteOnPage: bodyText.includes('開発用の試作'),
    externalRequests: external.length,
    pageErrors: errors,
    pass:
      positiveControl.every((h) => h.found) && bundleHits.every((h) => !h.found) && entryCount === 0 && !bodyText.includes('開発用の試作') && external.length === 0 && errors.length === 0,
  };
  fs.writeFileSync(path.join(outDir, 'build-prod-gate.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
  process.exitCode = result.pass ? 0 : 1;
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
