#!/usr/bin/env node

/**
 * predeploy-check: デプロイ前の自動チェック
 *
 * 実行: npm run predeploy-check
 *
 * チェック項目:
 * 1. npm run build
 * 2. npm run type-check
 * 3. npm lint
 * 4. npm audit (high/critical)
 * 5. .env.local 必須キー確認
 * 6. console.log デバッグ行検出（警告）
 */

import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

// カラー出力
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  blue: '\x1b[34m',
};

const log = {
  ok: (msg) => console.log(`${colors.green}✅ ${msg}${colors.reset}`),
  warn: (msg) => console.log(`${colors.yellow}⚠️  ${msg}${colors.reset}`),
  error: (msg) => console.log(`${colors.red}❌ ${msg}${colors.reset}`),
  info: (msg) => console.log(`${colors.blue}ℹ️  ${msg}${colors.reset}`),
};

let hasError = false;
let hasWarning = false;

// ユーティリティ: コマンド実行
function runCommand(cmd, description) {
  try {
    log.info(`実行中: ${description}`);
    execSync(cmd, { cwd: rootDir, stdio: 'pipe' });
    log.ok(`${description} - OK`);
    return true;
  } catch (e) {
    log.error(`${description} - NG`);
    if (e.stderr) console.error(e.stderr.toString());
    hasError = true;
    return false;
  }
}

// チェック 1: Build
console.log('\n--- チェック 1: ビルド ---');
runCommand('npm run build', 'npm run build');

// チェック 2: Type Check
console.log('\n--- チェック 2: 型チェック ---');
runCommand('npm run type-check', 'npm run type-check');

// チェック 3: ESLint
console.log('\n--- チェック 3: ESLint ---');
runCommand('npm lint', 'npm lint');

// チェック 4: npm audit (high/critical のみ)
console.log('\n--- チェック 4: セキュリティチェック ---');
try {
  log.info('実行中: npm audit (high/critical)');
  execSync('npm audit --audit-level=high', { cwd: rootDir, stdio: 'pipe' });
  log.ok('npm audit - high/critical なし');
} catch (e) {
  const output = e.stderr?.toString() || e.stdout?.toString() || '';
  if (output.includes('vulnerabilities')) {
    log.warn('npm audit - 脆弱性検出（詳細: npm audit で確認）');
    hasWarning = true;
  } else {
    log.error('npm audit - エラー');
    hasError = true;
  }
}

// チェック 5: .env.local 必須キー
console.log('\n--- チェック 5: 環境変数 ---');
const envPath = path.join(rootDir, '.env.local');
const requiredKeys = [
  'OPENAI_API_KEY',
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  'DATABASE_URL',
];

if (!fs.existsSync(envPath)) {
  log.error(`.env.local が見つかりません: ${envPath}`);
  hasError = true;
} else {
  const envContent = fs.readFileSync(envPath, 'utf-8');
  const missingKeys = requiredKeys.filter((key) => !envContent.includes(`${key}=`));

  if (missingKeys.length === 0) {
    log.ok('環境変数: すべての必須キーが存在');
  } else {
    log.error(`環境変数: 以下のキーが見つかりません: ${missingKeys.join(', ')}`);
    hasError = true;
  }
}

// チェック 6: console.log デバッグ行検出
console.log('\n--- チェック 6: デバッグログ検出 ---');
const srcDir = path.join(rootDir, 'app');
const consoleLogPattern = /console\.(log|warn|error|debug)\s*\(/g;
const filesToCheck = [
  'app/layoutClient.tsx',
  'app/stage2/page.tsx',
  'components/CEOChatPanel.tsx',
  'store/strategyStore.ts',
];

let debugLogCount = 0;
let filesWithDebugLogs = [];

filesToCheck.forEach((filePath) => {
  const fullPath = path.join(rootDir, filePath);
  if (fs.existsSync(fullPath)) {
    const content = fs.readFileSync(fullPath, 'utf-8');
    const matches = content.match(consoleLogPattern) || [];

    // diagnostic ログ [DIAG], [DEBUG], [TRACE] 等は許可（本番前に削除予定）
    const diagnosticPattern = /\[DIAG\]|\[DEBUG\]|\[TRACE\]|\[ERROR_BOUNDARY\]/;
    const nonDiagnosticMatches = matches.filter(
      (m) => !diagnosticPattern.test(m)
    );

    if (nonDiagnosticMatches.length > 0) {
      debugLogCount += nonDiagnosticMatches.length;
      filesWithDebugLogs.push({ file: filePath, count: nonDiagnosticMatches.length });
    }
  }
});

if (debugLogCount === 0) {
  log.ok('デバッグログ: なし');
} else {
  log.warn(`デバッグログ: ${debugLogCount} 行検出`);
  filesWithDebugLogs.forEach(({ file, count }) => {
    console.log(`  - ${file}: ${count} 行`);
  });
  hasWarning = true;
}

// チェック 7: 本番用診断ログ確認（必要に応じて削除予定）
console.log('\n--- チェック 7: 診断ログ状態 ---');
let diagnosticLogCount = 0;
filesToCheck.forEach((filePath) => {
  const fullPath = path.join(rootDir, filePath);
  if (fs.existsSync(fullPath)) {
    const content = fs.readFileSync(fullPath, 'utf-8');
    const matches = content.match(/\[DIAG\]|\[DEBUG\]|\[TRACE\]|\[REFRESH_/g) || [];
    if (matches.length > 0) {
      diagnosticLogCount += matches.length;
    }
  }
});

if (diagnosticLogCount === 0) {
  log.ok('診断ログ: なし（本番リリース対応済み）');
} else {
  log.warn(
    `診断ログ: ${diagnosticLogCount} 行検出（本番前に削除を推奨）`
  );
  hasWarning = true;
}

// 最終結果
console.log('\n--- 結果 ---');
if (hasError) {
  log.error('デプロイ準備: NG - 上記のエラーを修正して再実行してください');
  process.exit(1);
} else if (hasWarning) {
  log.warn('デプロイ準備: 警告あり - 上記の項目を確認してから進めてください');
  log.info('デプロイ可能ですが、Warning を確認してください');
  process.exit(0);
} else {
  log.ok('デプロイ準備: OK - すべてのチェックを通過しました');
  console.log('\n次のステップ:');
  console.log('  1. GitHub PR を作成 / 既存 PR に push');
  console.log('  2. Vercel Preview で DEPLOYMENT_CHECKLIST.md の Phase 3-4 を実施');
  console.log('  3. PR を Approve & Merge');
  console.log('  4. Vercel Production デプロイ待機');
  console.log('  5. 本番スモークテスト実施（npm run smoke-test）');
  process.exit(0);
}
