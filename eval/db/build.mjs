// 検証用のDB（PGlite）の実行ファイルを作る（評価専用）。出力は eval/db/.build（Git管理外）。
import { mkdirSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import * as esbuild from 'esbuild';

const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(here, '.build');
mkdirSync(outDir, { recursive: true });

await esbuild.build({
  entryPoints: [path.join(here, 'run-plan-db-check.ts'), path.join(here, 'testEnv.ts')],
  outdir: outDir,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  outExtension: { '.js': '.mjs' },
  packages: 'external',
  logLevel: 'warning',
});
console.log('built', path.join(outDir, 'run-plan-db-check.mjs'));
