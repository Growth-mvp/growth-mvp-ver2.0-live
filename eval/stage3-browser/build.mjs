/* 新STAGE3のブラウザ検証用のバンドルを作る（評価専用）。外部への接続はスタブに差し替える。出力は out/（Git管理外）。 */
import { mkdirSync } from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import * as esbuild from 'esbuild';

const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(here, 'out');
const stub = (name) => path.join(here, 'stubs', name);
const escape = (s) => s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');

const replaceModules = (map) => ({
  name: 'replace-modules',
  setup(build) {
    for (const [name, target] of Object.entries(map)) {
      build.onResolve({ filter: new RegExp(`^${escape(name)}$`) }, () => ({ path: target }));
    }
  },
});

const SERVER_STUBS = {
  'server-only': stub('server-only.ts'),
  'next/server': stub('next-server.ts'),
  '@/lib/supabaseAdmin': stub('supabaseAdmin.ts'),
  '@/lib/server/rbacGuard': stub('rbacGuard.ts'),
  '@/lib/server/auditLog': stub('auditLog.ts'),
  '@/lib/openai': stub('openai.ts'),
};

export async function build() {
  mkdirSync(outDir, { recursive: true });
  await esbuild.build({
    entryPoints: [path.join(here, 'client', 'entry.tsx')],
    outfile: path.join(outDir, 'client.js'),
    bundle: true,
    format: 'iife',
    platform: 'browser',
    jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"development"' },
    plugins: [replaceModules({ '@/utils/authFetch': stub('authFetch.ts'), '@/utils/access': stub('access.ts') })],
    logLevel: 'warning',
  });
  await esbuild.build({
    entryPoints: [path.join(here, 'server.ts')],
    outfile: path.join(outDir, 'server.mjs'),
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: 'node22',
    jsx: 'automatic',
    plugins: [replaceModules(SERVER_STUBS)],
    logLevel: 'warning',
  });
  return outDir;
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  await build();
  console.log('built', outDir);
}
