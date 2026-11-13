// 評価用の画面とサーバーをビルドする（出力は eval/integration/e2e/.build。Git管理外）。
import { mkdirSync, writeFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import * as esbuild from 'esbuild';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..', '..', '..');
const outDir = path.join(here, '.build');
mkdirSync(outDir, { recursive: true });

const S = (f) => path.join(here, 'stubs', f);
const STUB_MAP = {
  '@/store/strategyStore': S('strategyStore.ts'),
  '@/store/userStore': S('userStore.ts'),
  '@/utils/supabase/client': S('supabaseClient.ts'),
  'next/navigation': S('navigation.ts'),
};
const stubPlugin = {
  name: 'stub-external-modules',
  setup(build) {
    const keys = Object.keys(STUB_MAP).map((k) => k.replace(/[/.*+?^${}()|[\]\\]/g, '\\$&'));
    const filter = new RegExp('^(' + keys.join('|') + ')$');
    build.onResolve({ filter }, (args) => ({ path: STUB_MAP[args.path] }));
  },
};

await esbuild.build({
  entryPoints: [path.join(here, 'entry.tsx')],
  outfile: path.join(outDir, 'bundle.js'),
  bundle: true,
  tsconfig: path.join(root, 'tsconfig.json'),
  jsx: 'automatic',
  format: 'iife',
  platform: 'browser',
  target: 'es2020',
  define: {
    'process.env': '{"NODE_ENV":"development"}',
    'process.env.NODE_ENV': '"development"',
    'process.env.NEXT_PUBLIC_STAGE4_DOCUMENT_SCREEN': '"true"',
  },
  plugins: [stubPlugin],
  logLevel: 'warning',
});

writeFileSync(
  path.join(outDir, 'index.html'),
  '<!doctype html><html lang="ja"><head><meta charset="utf-8"><title>STAGE4 実行計画書（評価）</title>' +
    '<style>body{font-family:sans-serif;padding:16px;font-size:14px;max-width:1100px}</style></head>' +
    '<body><div id="root"></div><script src="bundle.js"></script></body></html>'
);

await esbuild.build({
  entryPoints: [path.join(here, 'server.ts')],
  outfile: path.join(outDir, 'server.mjs'),
  bundle: true,
  tsconfig: path.join(root, 'tsconfig.json'),
  platform: 'node',
  format: 'esm',
  target: 'node22',
  packages: 'external',
  logLevel: 'warning',
});
console.log('built', outDir);
