/* STAGE4→STAGE6 の一連の検証用のバンドルを作る（評価専用）。
 * 実際の STAGE4（Stage4DocumentScreen）と STAGE6（FinancePlanSection）の画面を使い、
 * 保存先だけを localStorage の stubs/e2eFlowStore.ts に差し替える。通信・認証には接続しない。 */
const fs = require('fs');
const path = require('path');
const esbuild = require('esbuild');

const root = path.join(__dirname, '..', '..', '..');
const outDir = path.join(__dirname, '..', 'results-browser');
const S = (f) => path.join(__dirname, 'stubs', f);

const STUB_MAP = {
  '@/store/strategyStore': S('e2eFlowStore.ts'),
  '@/utils/access': S('access.ts'),
  '@/store/userStore': S('misc-flow.ts'),
  '@/app/StrategyGuard': S('misc-flow.ts'),
  '@/hooks/useCapabilities': S('misc-flow.ts'),
  '@/utils/resetAll': S('misc-flow.ts'),
  '@/utils/loader': S('misc-flow.ts'),
  '@/utils/debug': S('misc-flow.ts'),
  '@/utils/supabase/client': S('misc-plan.ts'),
  '@/hooks/useAutoSave': S('misc-flow.ts'),
  '@/hooks/useStage4PdfExport': S('misc.ts'),
  '@/services/okrService': S('okrServiceFlow.ts'),
  '@/utils/supabase/strategy': S('supabaseStrategyFlow.ts'),
  '@/utils/supabase/strategyPartial': S('strategyPartialFlow.ts'),
  '@/components/okr/execution-plan/planStores': S('planStoresFlow.ts'),
  '@/lib/stage4/plan/documentScreenFlag': S('documentScreenFlagFlow.ts'),
  '@/lib/plans/export/downloadPlanPdf': S('downloadPlanPdfFlow.ts'),
  'next/navigation': S('misc.ts'),
};

function planStorePlugin(target) {
  return {
    name: 'stub-plan-stores-relative',
    setup(build) {
      build.onResolve({ filter: new RegExp('(^|/)planStores$') }, () => ({ path: target }));
    },
  };
}

function stubPlugin(map) {
  const keys = Object.keys(map).map((k) => k.replace(/[/.*+?^${}()|[\]\\]/g, '\\$&'));
  const filter = new RegExp('^(' + keys.join('|') + ')$');
  return {
    name: 'stub-external-modules',
    setup(build) {
      build.onResolve({ filter }, (args) => ({ path: map[args.path] }));
    },
  };
}

function html(title, bundleName) {
  return (
    '<!doctype html><html lang="ja"><head><meta charset="utf-8"><title>' + title + '</title><link rel="stylesheet" href="app.css">' +
    '<style>body{font-family:sans-serif;padding:16px;font-size:14px}section{border:1px solid #ddd;margin:12px 0;padding:8px}</style>' +
    '</head><body><div id="root"></div><script src="' + bundleName + '"></script></body></html>'
  );
}

const COMMON = {
  bundle: true,
  tsconfig: path.join(root, 'tsconfig.json'),
  jsx: 'automatic',
  format: 'iife',
  platform: 'browser',
  target: 'es2020',
  define: { 'process.env': '{"NODE_ENV":"development"}', 'process.env.NODE_ENV': '"development"' },
  plugins: [stubPlugin(STUB_MAP)],
  logLevel: 'warning',
};

(async () => {
  fs.mkdirSync(outDir, { recursive: true });
  await esbuild.build({ ...COMMON, entryPoints: [path.join(__dirname, 'e2e-stage4-entry.tsx')], outfile: path.join(outDir, 'e2e-stage4-bundle.js'), plugins: [planStorePlugin(S('stage4PlanStores.ts')), stubPlugin(STUB_MAP)] });
  fs.writeFileSync(path.join(outDir, 'e2e-stage4.html'), html('E2E STAGE4 財務効果の入力', 'e2e-stage4-bundle.js'));
  await esbuild.build({ ...COMMON, entryPoints: [path.join(__dirname, 'finance-stage6-entry.tsx')], outfile: path.join(outDir, 'e2e-stage6-bundle.js'), plugins: [planStorePlugin(S('stage6PlanOps.ts')), stubPlugin(STUB_MAP)] });
  fs.writeFileSync(path.join(outDir, 'e2e-stage6.html'), html('E2E STAGE6 財務計画', 'e2e-stage6-bundle.js'));
  console.log('built e2e-stage4.html and e2e-stage6.html');
})().catch((e) => {
  console.error('build failed:', e);
  process.exit(2);
});
