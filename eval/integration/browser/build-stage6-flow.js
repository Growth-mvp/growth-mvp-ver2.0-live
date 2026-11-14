/* STAGE6 財務計画の実ブラウザ検証用のバンドルを作る（評価専用）。
 * 実DB・認証・外部API に繋がるモジュールは、架空データのスタブに差し替える。出力は results-browser/（Git 管理外）。 */
const fs = require('fs');
const path = require('path');
const esbuild = require('esbuild');

const root = path.join(__dirname, '..', '..', '..');
const outDir = path.join(__dirname, '..', 'results-browser');
const S = (f) => path.join(__dirname, 'stubs', f);

const STUB_MAP = {
  '@/store/strategyStore': S('stage6FlowStore.ts'),
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
  '@/components/okr/execution-plan/planStores': S('stage6PlanOps.ts'),
  'next/navigation': S('misc.ts'),
};

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

(async () => {
  fs.mkdirSync(outDir, { recursive: true });
  await esbuild.build({
    bundle: true,
    tsconfig: path.join(root, 'tsconfig.json'),
    jsx: 'automatic',
    format: 'iife',
    platform: 'browser',
    target: 'es2020',
    define: { 'process.env': '{"NODE_ENV":"development"}', 'process.env.NODE_ENV': '"development"' },
    plugins: [stubPlugin(STUB_MAP)],
    logLevel: 'warning',
    entryPoints: [path.join(__dirname, 'finance-stage6-entry.tsx')],
    outfile: path.join(outDir, 'stage6-flow-bundle.js'),
  });
  fs.writeFileSync(path.join(outDir, 'stage6-flow.html'), html('STAGE6 財務計画 実ブラウザ検証', 'stage6-flow-bundle.js'));
  await esbuild.build({
    bundle: true,
    tsconfig: path.join(root, 'tsconfig.json'),
    jsx: 'automatic',
    format: 'iife',
    platform: 'browser',
    target: 'es2020',
    define: { 'process.env': '{"NODE_ENV":"development"}', 'process.env.NODE_ENV': '"development"' },
    plugins: [stubPlugin(STUB_MAP)],
    logLevel: 'warning',
    entryPoints: [path.join(__dirname, 'finance-effect-entry.tsx')],
    outfile: path.join(outDir, 'finance-effect-bundle.js'),
  });
  fs.writeFileSync(path.join(outDir, 'finance-effect.html'), html('旧 /okr 財務効果入力 検証', 'finance-effect-bundle.js'));
  console.log('built stage6-flow.html and finance-effect.html');
})().catch((e) => {
  console.error('build failed:', e);
  process.exit(2);
});
