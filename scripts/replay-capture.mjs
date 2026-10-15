#!/usr/bin/env node
/**
 * Replay スクリプト
 *
 * 目的: Capture されたリクエストを gpt-6-luna で再実行し、gpt-5.6-luna（現行）と比較
 *
 * 使用方法:
 *   node scripts/replay-capture.mjs [options]
 *
 * オプション:
 *   --capture-file    入力ファイル（デフォルト: model-comparison/captures/draft-case-001.json）
 *   --model           Replay対象モデル（デフォルト: gpt-6-luna）
 *   --output          出力ファイル（デフォルト: model-comparison/replay-results.json）
 *   --dry-run         実際のAPIを呼ばず、パラメータのみ表示
 */

import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import OpenAI from 'openai';

// .env.local を手動で読み込む
try {
  const envContent = fsSync.readFileSync('.env.local', 'utf-8');
  envContent.split('\n').forEach(line => {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#')) {
      const [key, ...valueParts] = trimmed.split('=');
      if (key) {
        process.env[key.trim()] = valueParts.join('=').trim();
      }
    }
  });
} catch (e) {
  // .env.local が存在しない場合はスキップ
}

// パラメータ解析
const args = process.argv.slice(2);
const options = {
  captureFile: 'model-comparison/captures/draft-case-001.json',
  model: 'gpt-6-luna', // Replay対象モデル（現行: gpt-5.6-luna → 候補: gpt-6-luna）
  output: 'model-comparison/replay-results.json',
  dryRun: false,
};

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--capture-file') options.captureFile = args[++i];
  if (args[i] === '--model') options.model = args[++i];
  if (args[i] === '--output') options.output = args[++i];
  if (args[i] === '--dry-run') options.dryRun = true;
}

console.log('【Replay スクリプト】');
console.log('========================================');
console.log(`入力ファイル: ${options.captureFile}`);
console.log(`実行モデル: ${options.model}`);
console.log(`出力ファイル: ${options.output}`);
console.log(`ドライラン: ${options.dryRun ? 'はい' : 'いいえ'}`);
console.log('========================================\n');

async function replayCaptureRequests() {
  // Step 1: Capture JSON を読み込む
  console.log('【ステップ 1】Capture JSON を読み込み...');
  let caseData;
  try {
    const captureContent = await fs.readFile(options.captureFile, 'utf-8');
    caseData = JSON.parse(captureContent);
    console.log(`✓ ${caseData.records.length} レコードを読み込み\n`);
  } catch (e) {
    console.error('✗ Capture JSON の読み込みに失敗:', e.message);
    process.exit(1);
  }

  // Step 2: OpenAI クライアントを初期化
  console.log('【ステップ 2】OpenAI クライアントを初期化...');
  let openai = null;
  if (!options.dryRun) {
    if (!process.env.OPENAI_API_KEY) {
      console.error('✗ OPENAI_API_KEY が設定されていません');
      console.error('  → .env.local に OPENAI_API_KEY を設定してください');
      process.exit(1);
    }
    openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    console.log('✓ OPENAI_API_KEY が設定されました');
  } else {
    // ドライラン時も .env.local の読み込みを確認
    if (process.env.OPENAI_API_KEY) {
      console.log('✓ OPENAI_API_KEY が設定されました（ドライラン時はAPIは呼び出されません）');
    } else {
      console.log('ℹ OPENAI_API_KEY は設定されていませんが、ドライランのため続行します');
    }
  }
  console.log('');

  // Step 3: 各レコードを Replay
  console.log('【ステップ 3】Replay を実行...');
  const replayResults = {
    captureFile: options.captureFile,
    replayModel: options.model,
    replayTimestamp: new Date().toISOString(),
    originalCaseData: {
      caseId: caseData.caseId,
      sequenceCount: caseData.sequenceCount,
    },
    replayedRecords: [],
  };

  for (let i = 0; i < caseData.records.length; i++) {
    const record = caseData.records[i];
    const replayRecord = {
      sequenceNumber: record.sequenceNumber,
      originalModel: record.model,
      replayModel: options.model,
      originalMessages: record.messages,
      originalResponse: record.response, // Capture時の元レスポンスを保持
      replayParams: null,
      replayResponse: null,
      replayError: null,
      executedAt: null,
      parametersDifference: null, // 削除されたパラメータを記録
    };

    console.log(`\n  Record ${i + 1}/${caseData.records.length} (sequenceNumber: ${record.sequenceNumber})`);
    console.log(`  元のモデル: ${record.model} → Replay モデル: ${options.model}`);

    // パラメータを構築（元の params から抽出、モデルのみ変更）
    const originalParams = record.params || {};
    const replayParams = {
      ...originalParams,
      model: options.model, // モデルをオーバーライド
    };

    // gpt-6-luna で非対応のパラメータを削除して記録
    const removedParams = [];
    if (options.model === 'gpt-6-luna') {
      // gpt-6-luna は temperature, presence_penalty, frequency_penalty をサポートしない
      if ('temperature' in replayParams) {
        removedParams.push('temperature');
        delete replayParams.temperature;
      }
      if ('presence_penalty' in replayParams) {
        removedParams.push('presence_penalty');
        delete replayParams.presence_penalty;
      }
      if ('frequency_penalty' in replayParams) {
        removedParams.push('frequency_penalty');
        delete replayParams.frequency_penalty;
      }
    }

    replayRecord.replayParams = replayParams;
    if (removedParams.length > 0) {
      replayRecord.parametersDifference = {
        message: `${options.model} で非対応のため削除されたパラメータ`,
        removed: removedParams,
      };
    }

    // ドライラン時は実際の API 呼び出しをスキップ
    if (options.dryRun) {
      console.log(`  ✓ ドライラン: パラメータを表示`);
      console.log(`    messages数: ${replayParams.messages?.length || 0}`);
      console.log(`    max_completion_tokens: ${replayParams.max_completion_tokens}`);
      console.log(`    temperature: ${replayParams.temperature}`);
    } else {
      try {
        console.log(`  実行中...`);
        const response = await openai.chat.completions.create(replayParams);
        replayRecord.replayResponse = response;
        replayRecord.executedAt = new Date().toISOString();
        console.log(`  ✓ Replay 成功`);
        console.log(`    応答トークン数: ${response.usage?.completion_tokens || 'N/A'}`);
        console.log(`    finish_reason: ${response.choices?.[0]?.finish_reason || 'N/A'}`);
      } catch (error) {
        replayRecord.replayError = {
          message: error.message,
          code: error.code,
          status: error.status,
        };
        console.error(`  ✗ Replay 失敗: ${error.message}`);
      }
    }

    replayResults.replayedRecords.push(replayRecord);
  }

  // Step 4: 結果を保存
  console.log(`\n【ステップ 4】結果を保存...\n`);
  try {
    const outputDir = path.dirname(options.output);
    await fs.mkdir(outputDir, { recursive: true });
    await fs.writeFile(options.output, JSON.stringify(replayResults, null, 2), 'utf-8');
    console.log(`✓ 結果を保存: ${options.output}`);
  } catch (e) {
    console.error(`✗ 結果保存に失敗: ${e.message}`);
    process.exit(1);
  }

  // Step 5: サマリーを表示
  console.log('\n【Replay 結果サマリー】');
  console.log('========================================');
  console.log(`処理済みレコード: ${replayResults.replayedRecords.length}`);
  const successCount = replayResults.replayedRecords.filter(r => r.replayResponse).length;
  const errorCount = replayResults.replayedRecords.filter(r => r.replayError).length;
  console.log(`成功: ${successCount}, 失敗: ${errorCount}`);
  console.log(`出力ファイル: ${options.output}`);
  console.log('========================================\n');

  if (!options.dryRun && successCount > 0) {
    console.log('【モデル間応答比較】');
    console.log('========================================\n');

    // Capture JSON から元のレスポンスを抽出
    replayResults.replayedRecords.forEach((record, idx) => {
      const captureRecord = caseData.records[idx];
      const originalResponse = captureRecord.response?.choices?.[0]?.message?.content || '';
      const replayResponse = record.replayResponse?.choices?.[0]?.message?.content || '';

      console.log(`【Record ${idx + 1}】(sequenceNumber: ${record.sequenceNumber})`);
      console.log(`元のモデル: ${captureRecord.model}`);
      console.log(`Replay モデル: ${record.replayModel}`);
      console.log('');

      console.log(`【${captureRecord.model} の応答（Capture 基準）】`);
      console.log('---');
      console.log(originalResponse.substring(0, 500) + (originalResponse.length > 500 ? '\n...' : ''));
      console.log('');

      console.log(`【${record.replayModel} の応答（Replay）】`);
      console.log('---');
      console.log(replayResponse.substring(0, 500) + (replayResponse.length > 500 ? '\n...' : ''));
      console.log('');

      console.log(`【メタデータ】`);
      console.log(`元の応答: ${originalResponse.length} 文字`);
      console.log(`Replay応答: ${replayResponse.length} 文字`);
      console.log(`トークン差: ${Math.abs((captureRecord.response?.usage?.completion_tokens || 0) - (record.replayResponse?.usage?.completion_tokens || 0))}`);
      console.log('========================================\n');
    });
  }
}

replayCaptureRequests().catch(err => {
  console.error('Replay スクリプト失敗:', err);
  process.exit(1);
});
