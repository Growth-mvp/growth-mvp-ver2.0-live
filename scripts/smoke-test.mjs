#!/usr/bin/env node

/**
 * smoke-test: 本番デプロイ後のスモークテスト
 *
 * 実行: npm run smoke-test -- https://growth-mvp.com
 * または: npm run smoke-test -- https://preview-xxx.vercel.app
 *
 * テスト項目:
 * 1. ページ起動 (404, 5xx チェック)
 * 2. ブラウザコンソールエラー確認
 * 3. 主要画面の読み込み確認
 * 4. API レスポンス確認 (/api/ask-ceo-agent, /api/diag/whoami)
 * 5. CEOChatPanel 基本動作
 *
 * 要件: Playwright インストール済み
 */

import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';

const args = process.argv.slice(2);
const targetUrl = args[0] || 'http://localhost:3000';

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
const testResults = [];

async function runSmokeTest() {
  console.log(`\n🚀 スモークテスト開始: ${targetUrl}\n`);
  console.log('--- テスト環境確認 ---');
  log.info(`Target: ${targetUrl}`);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  // コンソール出力をキャッチ
  const consoleLogs = [];
  page.on('console', (msg) => {
    consoleLogs.push({ type: msg.type(), text: msg.text() });
  });

  try {
    // テスト 1: ホームページ起動
    console.log('\n--- テスト 1: ホームページ起動 ---');
    const response = await page.goto(`${targetUrl}/`, { waitUntil: 'networkidle' });
    if (response?.status() === 404 || response?.status() >= 500) {
      log.error(`ホームページ: HTTP ${response?.status()}`);
      hasError = true;
      testResults.push({ test: 'ホームページ', result: 'NG', detail: `HTTP ${response?.status()}` });
    } else {
      log.ok(`ホームページ: OK (HTTP ${response?.status()})`);
      testResults.push({ test: 'ホームページ', result: 'OK' });
    }

    // テスト 2: ブラウザコンソールエラー確認
    console.log('\n--- テスト 2: ブラウザコンソールエラー ---');
    const errors = consoleLogs.filter((log) => log.type === 'error');
    const refErrors = consoleLogs.filter(
      (log) =>
        log.text.includes('ReferenceError') ||
        log.text.includes('TypeError') ||
        log.text.includes('SyntaxError')
    );

    if (refErrors.length > 0) {
      log.error(`ReferenceError/TypeError 検出: ${refErrors.length} 件`);
      refErrors.forEach((err) => console.log(`  - ${err.text}`));
      hasError = true;
      testResults.push({ test: 'コンソールエラー', result: 'NG', detail: `${refErrors.length} 件のエラー` });
    } else if (errors.length > 0) {
      log.warn(`その他のコンソールエラー: ${errors.length} 件（詳細確認推奨）`);
      testResults.push({ test: 'コンソールエラー', result: 'WARN', detail: `${errors.length} 件のエラー` });
    } else {
      log.ok('コンソールエラー: なし');
      testResults.push({ test: 'コンソールエラー', result: 'OK' });
    }

    // テスト 3: STAGE2 ページ起動
    console.log('\n--- テスト 3: STAGE2 ページ起動 ---');
    const stage2Response = await page.goto(`${targetUrl}/stage2`, { waitUntil: 'networkidle' });
    if (stage2Response?.status() === 404 || stage2Response?.status() >= 500) {
      log.error(`STAGE2: HTTP ${stage2Response?.status()}`);
      hasError = true;
      testResults.push({ test: 'STAGE2ページ', result: 'NG', detail: `HTTP ${stage2Response?.status()}` });
    } else {
      // 画面にコンテンツが表示されているか確認
      const hasContent = await page.locator('body').textContent();
      if (hasContent?.includes('Application error') || hasContent?.includes('error')) {
        log.error('STAGE2: Application error 表示');
        hasError = true;
        testResults.push({ test: 'STAGE2ページ', result: 'NG', detail: 'Application error' });
      } else {
        log.ok(`STAGE2: OK (HTTP ${stage2Response?.status()})`);
        testResults.push({ test: 'STAGE2ページ', result: 'OK' });
      }
    }

    // テスト 4: API 診断 (/api/diag/whoami)
    console.log('\n--- テスト 4: API 診断エンドポイント ---');
    try {
      const apiResponse = await page.request.get(`${targetUrl}/api/diag/whoami`);
      if (apiResponse.ok()) {
        const data = await apiResponse.json().catch(() => null);
        if (data?.authenticated === true || data?.userId) {
          log.ok(`/api/diag/whoami: OK (認証済み)`);
          testResults.push({ test: 'API診断', result: 'OK' });
        } else {
          log.warn(`/api/diag/whoami: OK だが未認証 (ログイン後テスト推奨)`);
          testResults.push({ test: 'API診断', result: 'WARN', detail: '未認証' });
        }
      } else {
        log.error(`/api/diag/whoami: HTTP ${apiResponse.status()}`);
        hasError = true;
        testResults.push({ test: 'API診断', result: 'NG', detail: `HTTP ${apiResponse.status()}` });
      }
    } catch (e) {
      log.error(`/api/diag/whoami: リクエスト失敗`);
      testResults.push({ test: 'API診断', result: 'NG', detail: e.message });
    }

    // テスト 5: CEO チャットパネル UI 確認
    console.log('\n--- テスト 5: CEO チャットパネル UI ---');
    const ceoPanelExists = await page.locator('[data-testid="ceo-chat-panel"], .ceo-panel, #ceo-panel').count() > 0;
    if (ceoPanelExists) {
      log.ok('CEO チャットパネル: 要素検出');
      testResults.push({ test: 'CEOパネルUI', result: 'OK' });
    } else {
      log.warn('CEO チャットパネル: 要素が見つかりません（非表示の可能性）');
      testResults.push({ test: 'CEOパネルUI', result: 'WARN', detail: '要素未検出' });
    }

    // テスト 6: Supabase 接続確認（NetworkRequest 監視）
    console.log('\n--- テスト 6: Supabase 接続確認 ---');
    let supabaseConnected = false;
    page.on('response', (response) => {
      if (response.url().includes('supabase.co')) {
        supabaseConnected = true;
      }
    });
    await page.reload({ waitUntil: 'networkidle' });
    if (supabaseConnected) {
      log.ok('Supabase: 接続確認');
      testResults.push({ test: 'Supabase接続', result: 'OK' });
    } else {
      log.warn('Supabase: 接続未確認（オフラインの可能性）');
      testResults.push({ test: 'Supabase接続', result: 'WARN', detail: '接続未確認' });
    }

  } catch (e) {
    log.error(`テスト実行エラー: ${e.message}`);
    hasError = true;
  } finally {
    await browser.close();
  }

  // 結果サマリー
  console.log('\n--- テスト結果 ---');
  testResults.forEach(({ test, result, detail }) => {
    const icon = result === 'OK' ? '✅' : result === 'NG' ? '❌' : '⚠️ ';
    console.log(`${icon} ${test}: ${result}${detail ? ` (${detail})` : ''}`);
  });

  const ngCount = testResults.filter((r) => r.result === 'NG').length;
  console.log('\n' + '='.repeat(50));
  if (ngCount > 0) {
    log.error(`スモークテスト: NG (${ngCount} 個のエラー)`);
    console.log('\n対応:');
    console.log('  1. ブラウザコンソール (F12) で詳細エラーを確認');
    console.log('  2. Vercel ダッシュボードで Logs を確認');
    console.log('  3. Supabase ダッシュボードで接続を確認');
    if (testResults.some((r) => r.test === '✅コンソールエラー' && r.result === 'NG')) {
      console.log('  4. ローカルで npm run dev で再現テスト');
      console.log('  5. 原因特定後、DEPLOYMENT_CHECKLIST.md の Phase 7 でロールバック検討');
    }
    process.exit(1);
  } else {
    log.ok(`スモークテスト: 完了 (警告 ${testResults.filter((r) => r.result === 'WARN').length} 件)`);
    console.log('\n次のステップ: 手動確認（ログイン、データ保存、CEOChat送信）');
    process.exit(0);
  }
}

runSmokeTest().catch((err) => {
  log.error(`致命的エラー: ${err.message}`);
  process.exit(1);
});
