/* ハーネスをバンドルして results-browser/ に出力する（評価専用。DB・外部APIには接続しない）。
 * 実DB・認証・通信に繋がるモジュールだけを、架空データのスタブに差し替える。 */
const fs = require('fs');
const path = require('path');
const esbuild = require('esbuild');
const { execSync } = require('child_process');

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

/* STAGE5 実行画面だけ、保存関数の参照を差し替える（OKR画面は実際の投影関数を使うため差し替えない） */
const EXEC_STUB_MAP = { ...STUB_MAP, '@/utils/supabase/strategy': S('supabaseStrategy.ts') };

function stubPlugin(map = STUB_MAP) {
  const keys = Object.keys(map).map((k) => k.replace(/[/.*+?^${}()|[\]\\]/g, '\\$&'));
  const filter = new RegExp('^(' + keys.join('|') + ')$');
  return {
    name: 'stub-external-modules',
    setup(build) {
      build.onResolve({ filter }, (args) => ({ path: map[args.path] }));
    },
  };
}

const COMMON = {
  bundle: true,
  tsconfig: path.join(root, 'tsconfig.json'),
  jsx: 'automatic',
  format: 'iife',
  platform: 'browser',
  target: 'es2020',
  define: { 'process.env': '{"NODE_ENV":"development"}', 'process.env.NODE_ENV': '"development"' },
  plugins: [stubPlugin()],
  logLevel: 'warning',
};

/* アプリと同じ Tailwind 設定・globals.css から、ハーネス用の CSS を生成する（結果フォルダに出力） */
function buildTailwindCss() {
  const out = path.join(outDir, 'app.css');
  const outRel = path.relative(root, out).split(path.sep).join('/');
  execSync('npx tailwindcss -c tailwind.config.js -i app/globals.css -o "' + outRel + '"', { cwd: root, stdio: 'ignore' });
  return out;
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
  buildTailwindCss();
  await esbuild.build({
    ...COMMON,
    entryPoints: [path.join(__dirname, 'entry.tsx')],
    outfile: path.join(outDir, 'bundle.js'),
  });
  fs.writeFileSync(path.join(outDir, 'index.html'), html('STAGE4・6 ローカル確認', 'bundle.js'));
  await esbuild.build({
    ...COMMON,
    entryPoints: [path.join(__dirname, 'okr-entry.tsx')],
    outfile: path.join(outDir, 'okr-bundle.js'),
  });
  fs.writeFileSync(path.join(outDir, 'okr.html'), html('STAGE4 OKR ローカル確認', 'okr-bundle.js'));
  await esbuild.build({
    ...COMMON,
    entryPoints: [path.join(__dirname, 'stage5-entry.tsx')],
    outfile: path.join(outDir, 'stage5-bundle.js'),
  });
  fs.writeFileSync(path.join(outDir, 'stage5.html'), html('STAGE5 KR実績 ローカル確認', 'stage5-bundle.js'));
  await esbuild.build({
    ...COMMON,
    entryPoints: [path.join(__dirname, 'exec-entry.tsx')],
    outfile: path.join(outDir, 'exec-bundle.js'),
    plugins: [stubPlugin(EXEC_STUB_MAP)],
  });
  fs.writeFileSync(path.join(outDir, 'exec.html'), html('STAGE5 実行画面 ローカル確認', 'exec-bundle.js'));
  await esbuild.build({
    ...COMMON,
    entryPoints: [path.join(__dirname, 'stage46-entry.tsx')],
    outfile: path.join(outDir, 'stage46-bundle.js'),
  });
  fs.writeFileSync(path.join(outDir, 'stage46.html'), html('STAGE4→6 条件付き試算 ローカル確認', 'stage46-bundle.js'));
  console.log('built', path.join(outDir, 'index.html'), path.join(outDir, 'okr.html'), path.join(outDir, 'stage5.html'));
})().catch((e) => {
  console.error('build failed:', e.message);
  process.exit(1);
});
