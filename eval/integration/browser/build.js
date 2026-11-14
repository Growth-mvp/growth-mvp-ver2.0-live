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
const EXEC_STUB_MAP = { ...STUB_MAP, '@/utils/supabase/strategy': S('supabaseStrategy.ts'), '@/utils/supabase/strategyPartial': S('strategyPartialMem.ts') };

/* 流れの検証用（KR編集→AI案→実績→保存失敗→会社切替）。store は localStorage に保存する flowStore、
 * 周辺は misc-flow（安全な session トークン・会社に追随するユーザー）に差し替える。既存の STUB_MAP は変えない。 */
const FLOW_STUB_MAP = Object.fromEntries(
  Object.entries(STUB_MAP).map(([k, v]) => [k, v === S('misc.ts') ? S('misc-flow.ts') : v]),
);
FLOW_STUB_MAP['@/store/strategyStore'] = S('flowStore.ts');
const FLOW_EXEC_STUB_MAP = { ...FLOW_STUB_MAP, '@/utils/supabase/strategy': S('supabaseStrategy.ts'), '@/utils/supabase/strategyPartial': S('strategyPartialMem.ts') };

/* 実行計画（STAGE4）と、STAGE5 のモーダル内の計画・実施事項・PDF の流れの検証用（評価専用。通信・認証はすべて stubs/ で遮断） */
const PLAN_FLOW_STUB_MAP = {
  ...FLOW_EXEC_STUB_MAP,
  '@/utils/supabase/strategy': S('supabaseStrategyFlow.ts'),
  '@/utils/supabase/strategyPartial': S('strategyPartialFlow.ts'),
  '@/services/okrService': S('okrServiceFlow.ts'),
  '@/components/okr/execution-plan/planStores': S('planStoresFlow.ts'),
  '@/lib/stage4/plan/documentScreenFlag': S('documentScreenFlagFlow.ts'),
  '@/utils/supabase/client': S('misc-plan.ts'),
  '@/lib/plans/export/downloadPlanPdf': S('downloadPlanPdfFlow.ts'),
};

/* 実アプリのレイアウトで描画する各STAGEのページ（route は app/ 配下のフォルダ名） */
const SHELL_PAGES = [
  { key: 'stage1', route: 'stage1' },
  { key: 'stage2', route: 'stage2' },
  { key: 'stage3', route: 'stage3' },
  { key: 'stage4', route: 'stage4' },
  { key: 'stage5', route: 'execution' },
  { key: 'okr', route: 'okr' },
  { key: 'report', route: 'report' },
  { key: 'cascade', route: 'cascade' },
  {
    key: 'stage6-mock-negative',
    route: 'stage6',
    setup:
      "useStrategyStore.setState({ financePL: (useStrategyStore.getState().financePL ?? []).map((r) => (r.year === 2025 ? { ...r, interest: 120000000 } : r)) });",
  },
  {
    /* 丹青社の既存データに相当する架空のモック（売上達成率 82.5%・営業利益達成率 71.4% になる目標値）。
     * 予測期間（2026〜2028年度）の内側に年度を置く。 */
    key: 'stage6-mock-target',
    route: 'stage6',
    setup:
      "useStrategyStore.setState({ companyTargets: [" +
      "{ id: 'rev', label: '売上', unit: '百万円', base: 1127, low: 1000, high: 1200, dueYear: 2028 }," +
      "{ id: 'op', label: '営業利益', unit: '百万円', base: 72.8, low: 60, high: 80, dueYear: 2028 }] });\n" +
      "useStrategyStore.setState({ financePL: (useStrategyStore.getState().financePL ?? []).map((r) => (r.year === 2025 ? { ...r, interest: 2000000 } : r)) });",
  },
  /* STAGE2 全社戦略書：旧データ（確定スナップショットなし）と初回確定前のドラフト */
  { key: 'stage2-report-legacy', route: 'report/stage2-strategy', seed: 'seedLegacyConfirmed' },
  { key: 'stage2-report-draft', route: 'report/stage2-strategy', seed: 'seedDraftOnly' },
  /* STAGE2 最終確定タブ：旧データ（確定済み）と、確定後に下書きを保存した状態 */
  { key: 'stage2-final-legacy', route: 'stage2', seed: 'seedLegacyConfirmed' },
  { key: 'stage2-final-unconfirmed', route: 'stage2', seed: 'seedAfterDraftSave' },
  { key: 'stage2-final-mismatch', route: 'stage2', seed: 'seedMismatch' },
  { key: 'stage2-report-no-midterm', route: 'report/stage2-strategy', seed: 'seedMidtermMissing' },
  { key: 'stage2-final-candidates', route: 'stage2', seed: 'seedCandidates' },
];

/* 実アプリのレイアウト（layoutClient・Sidebar・CEOChatPanel・STAGE6ページ）を、認証・通信・ルーターだけ差し替えて描画する */
const SHELL_STUB_MAP = {
  ...STUB_MAP,
  '@/store/strategyStore': S('strategyStore.ts'),
  '@/utils/supabase/client': S('shell-supabase.ts'),
  '@/utils/supabase/strategy': S('shell-supabaseStrategy.ts'),
  '@/store/userStore': S('shell-userStore.ts'),
  'next/navigation': S('shell-navigation.ts'),
  'next/link': S('shell-navigation.ts'),
  '@/components/MfaGate': S('shell-passthrough.ts'),
  '@/context/CompanyContext': S('shell-passthrough.ts'),
};

/* 実レイアウトの STAGE5 だけ、計画の取得と文書の保存を検証用のスタブに置き換える（通信はしない） */
const SHELL_STAGE5_STUB_MAP = {
  ...SHELL_STUB_MAP,
  '@/components/okr/execution-plan/planStores': S('planStoresFlow.ts'),
  '@/lib/stage4/plan/documentScreenFlag': S('documentScreenFlagFlow.ts'),
  '@/lib/plans/export/downloadPlanPdf': S('downloadPlanPdfFlow.ts'),
};

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
  execSync('npx tailwindcss -c eval/integration/browser/tailwind.harness.config.js -i app/globals.css -o "' + outRel + '"', { cwd: root, stdio: 'ignore' });
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
  await esbuild.build({
    ...COMMON,
    entryPoints: [path.join(__dirname, 'flow-okr-entry.tsx')],
    outfile: path.join(outDir, 'flow-okr-bundle.js'),
    plugins: [stubPlugin(FLOW_STUB_MAP)],
  });
  fs.writeFileSync(path.join(outDir, 'flow-okr.html'), html('STAGE4 OKR 流れの検証', 'flow-okr-bundle.js'));
  await esbuild.build({
    ...COMMON,
    entryPoints: [path.join(__dirname, 'flow-exec-entry.tsx')],
    outfile: path.join(outDir, 'flow-exec-bundle.js'),
    plugins: [stubPlugin(FLOW_EXEC_STUB_MAP)],
  });
  fs.writeFileSync(path.join(outDir, 'flow-exec.html'), html('STAGE5 実行画面 流れの検証', 'flow-exec-bundle.js'));
  await esbuild.build({
    ...COMMON,
    entryPoints: [path.join(__dirname, 'plan-flow-entry.tsx')],
    outfile: path.join(outDir, 'plan-flow-bundle.js'),
    plugins: [stubPlugin(PLAN_FLOW_STUB_MAP)],
  });
  fs.writeFileSync(path.join(outDir, 'plan-flow.html'), html('STAGE5 実行計画の流れの検証', 'plan-flow-bundle.js'));
  await esbuild.build({
    ...COMMON,
    entryPoints: [path.join(__dirname, 'stage5-design-preview-entry.tsx')],
    outfile: path.join(outDir, 'stage5-design-preview-bundle.js'),
    plugins: [stubPlugin(EXEC_STUB_MAP)],
  });
  fs.writeFileSync(path.join(outDir, 'stage5-design-preview.html'), html('STAGE5 最終設計案の確認', 'stage5-design-preview-bundle.js'));
  await esbuild.build({
    ...COMMON,
    entryPoints: [path.join(__dirname, 'finance-flow-entry.tsx')],
    outfile: path.join(outDir, 'finance-flow-bundle.js'),
    plugins: [stubPlugin(FLOW_STUB_MAP)],
  });
  fs.writeFileSync(path.join(outDir, 'finance-flow.html'), html('STAGE4 第5章の財務効果 流れの検証', 'finance-flow-bundle.js'));
  await esbuild.build({
    ...COMMON,
    entryPoints: [path.join(__dirname, 'finance-stage6-entry.tsx')],
    outfile: path.join(outDir, 'finance-stage6-bundle.js'),
    plugins: [stubPlugin(FLOW_STUB_MAP)],
  });
  fs.writeFileSync(path.join(outDir, 'finance-stage6.html'), html('STAGE6 財務計画（経路B）の流れの検証', 'finance-stage6-bundle.js'));
  await esbuild.build({
    ...COMMON,
    entryPoints: [path.join(__dirname, 'shell-entry.tsx')],
    outfile: path.join(outDir, 'shell-bundle.js'),
    plugins: [stubPlugin(SHELL_STUB_MAP)],
  });
  fs.writeFileSync(path.join(outDir, 'shell.html'), html('実レイアウト（モック認証）', 'shell-bundle.js'));
  /* 実際の /okr 画面（app/okr/page.tsx）を、実レイアウトの中で描画する（開発用の文書型計画書を含む） */
  await esbuild.build({
    ...COMMON,
    entryPoints: [path.join(__dirname, 'okr-shell-entry.tsx')],
    outfile: path.join(outDir, 'okr-shell-bundle.js'),
    plugins: [stubPlugin(SHELL_STUB_MAP)],
  });
  fs.writeFileSync(path.join(outDir, 'okr-shell.html'), html('STAGE4 /okr（実レイアウト）', 'okr-shell-bundle.js'));
  fs.mkdirSync(path.join(outDir, 'shell-entries'), { recursive: true });
  const componentEntry = path.join(outDir, 'shell-entries', 'component-negative.tsx');
  fs.writeFileSync(
    componentEntry,
    "import React from 'react';\n" +
      "import { createRoot } from 'react-dom/client';\n" +
      "import { FinanceSummary } from '@/components/stage6/FinanceSummary';\n" +
      "const M = 1000000;\n" +
      "const metric = { status: 'READY', fiscalYear: 2028, targetYen: 100 * M, planYen: 60 * M, gapYen: 40 * M };\n" +
      "const cash = { unknownReason: null, points: [\n" +
      "  { fiscalYear: 2026, baselineYen: -12 * M, conditionalYen: -12 * M },\n" +
      "  { fiscalYear: 2027, baselineYen: 5 * M, conditionalYen: 5 * M },\n" +
      "  { fiscalYear: 2028, baselineYen: -3 * M, conditionalYen: -3 * M },\n" +
      "] };\n" +
      "const funding = { kind: 'JUDGED', label: '資金不足あり', detail: '該当年度：2026年', tone: 'warn' };\n" +
      "createRoot(document.getElementById('root')!).render(\n" +
      "  <div style={{ width: 620, padding: 8 }}><FinanceSummary target={{ revenue: metric as any, operatingIncome: { status: 'NO_TARGET' } as any }} cash={cash as any} funding={funding as any} requiredItem={null} onNavigate={() => {}} /></div>,\n" +
      ");\n",
  );
  await esbuild.build({
    ...COMMON,
    entryPoints: [componentEntry],
    outfile: path.join(outDir, 'component-negative-bundle.js'),
  });
  fs.writeFileSync(path.join(outDir, 'component-negative.html'), html('サマリー 負の値の確認', 'component-negative-bundle.js'));
  const compareEntry = path.join(outDir, 'shell-entries', 'component-compare.tsx');
  fs.writeFileSync(
    compareEntry,
    "import React from 'react';\n" +
      "import { createRoot } from 'react-dom/client';\n" +
      "import { FinanceSummary } from '@/components/stage6/FinanceSummary';\n" +
      "const M = 1000000;\n" +
      "const metric = { status: 'READY', fiscalYear: 2028, targetYen: 100 * M, planYen: 60 * M, gapYen: 40 * M };\n" +
      "const cash = { unknownReason: null, points: [\n" +
      "  { fiscalYear: 2026, baselineYen: 10 * M, conditionalYen: 12 * M },\n" +
      "  { fiscalYear: 2027, baselineYen: 5 * M, conditionalYen: -4 * M },\n" +
      "  { fiscalYear: 2028, baselineYen: 6 * M, conditionalYen: null },\n" +
      "] };\n" +
      "const funding = { kind: 'JUDGED', label: '評価保留', detail: '', tone: 'hold' };\n" +
      "createRoot(document.getElementById('root')!).render(\n" +
      "  <div style={{ width: 620, padding: 8 }}><FinanceSummary target={{ revenue: metric as any, operatingIncome: { status: 'NO_TARGET' } as any }} cash={cash as any} funding={funding as any} requiredItem={null} onNavigate={() => {}} /></div>,\n" +
      ");\n",
  );
  await esbuild.build({
    ...COMMON,
    entryPoints: [compareEntry],
    outfile: path.join(outDir, 'component-compare-bundle.js'),
  });
  fs.writeFileSync(path.join(outDir, 'component-compare.html'), html('サマリー 比較表示の確認', 'component-compare-bundle.js'));
  const entryDir = path.join(outDir, 'shell-entries');
  fs.mkdirSync(entryDir, { recursive: true });
  for (const p of SHELL_PAGES) {
    const entry = path.join(entryDir, `${p.key}.tsx`);
    fs.writeFileSync(
      entry,
      "import React from 'react';\n" +
        "import { createRoot } from 'react-dom/client';\n" +
        "import LayoutClient from '@/app/layoutClient';\n" +
        "import { setMockPathname } from 'next/navigation';\n" +
        `import Page from '@/app/${p.route}/page';\n` +
        `setMockPathname('/${p.route}');\n` +
        (p.setup ? "import { useStrategyStore } from '@/store/strategyStore';\n" + p.setup + '\n' : '') +
        (p.seed
          ? "import { useStrategyStore } from '@/store/strategyStore';\n" +
            `import { ${p.seed} } from ${JSON.stringify(path.join(__dirname, 'stage2-seed.ts'))};\n` +
            `${p.seed}(useStrategyStore);\n`
          : '') +
        "createRoot(document.getElementById('root')!).render(<LayoutClient><Page /></LayoutClient>);\n",
    );
    await esbuild.build({
      ...COMMON,
      entryPoints: [entry],
      outfile: path.join(outDir, `shell-${p.key}-bundle.js`),
      plugins: [stubPlugin(p.key === 'stage5' ? SHELL_STAGE5_STUB_MAP : SHELL_STUB_MAP)],
    });
    fs.writeFileSync(path.join(outDir, `shell-${p.key}.html`), html(`実レイアウト ${p.route}`, `shell-${p.key}-bundle.js`));
  }
  console.log('built', path.join(outDir, 'flow-okr.html'), path.join(outDir, 'flow-exec.html'));
  console.log('built', path.join(outDir, 'index.html'), path.join(outDir, 'okr.html'), path.join(outDir, 'stage5.html'));
})().catch((e) => {
  console.error('build failed:', e.message);
  process.exit(1);
});
