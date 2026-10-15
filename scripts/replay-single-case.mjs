#!/usr/bin/env node
/**
 * Replay Single Case Script
 *
 * Capture したデータを使用して、指定されたモデルで Replay 実行
 * 【重要】ファイル名・内部データを匿名化
 *
 * 使用方法:
 *   node scripts/replay-single-case.mjs \
 *     --capture-file model-comparison/captures/draft-case-001.json \
 *     --model gpt-4o \
 *     --output model-comparison/results/replay-gpt4o-draft.json \
 *     --case-id case-001
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import OpenAI from 'openai';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * コマンドラインオプションをパース
 */
function parseArgs() {
  const args = process.argv.slice(2);
  const opts = {};

  for (let i = 0; i < args.length; i += 2) {
    const key = args[i].replace(/^--/, '');
    const value = args[i + 1];
    opts[key] = value;
  }

  return opts;
}

/**
 * 【重要】Capture JSON から機密情報を削除
 * userId, companyId, strategy ID などを含まないように
 */
function sanitizeCaptureData(captureCase) {
  const sanitized = JSON.parse(JSON.stringify(captureCase));

  // caseId を匿名化
  sanitized.caseId = sanitized.caseId?.replace(/draft-[a-z0-9-]+/, 'draft-case-001') ||
                      sanitized.caseId?.replace(/final-[a-z0-9-]+/, 'final-case-001') ||
                      sanitized.caseId?.replace(/cascade-[a-z0-9-]+/, 'cascade-case-001') ||
                      'case-001';

  return sanitized;
}

/**
 * 【重要】gpt-6-luna用にパラメータを調整
 * gpt-6-luna は temperature, presence_penalty, frequency_penalty をサポートしない
 */
function adjustParamsForModel(params, targetModel) {
  const adjusted = { ...params };

  if (targetModel.includes('luna') || targetModel.includes('gpt-6')) {
    // 削除が必要なパラメータ
    delete adjusted.temperature;
    delete adjusted.presence_penalty;
    delete adjusted.frequency_penalty;
    delete adjusted.top_p;

    // max_tokens → max_completion_tokens へ変換
    if (adjusted.max_tokens && !adjusted.max_completion_tokens) {
      adjusted.max_completion_tokens = adjusted.max_tokens;
      delete adjusted.max_tokens;
    }
  }

  adjusted.model = targetModel;
  return adjusted;
}

/**
 * 単一のリクエストを実行
 */
async function executeRequest(openai, params, sequenceNumber) {
  try {
    console.log(`  [Seq ${sequenceNumber}] Executing with model: ${params.model}...`);

    const response = await openai.chat.completions.create(params);

    return {
      sequenceNumber,
      success: true,
      params: {
        model: params.model,
        temperature: params.temperature,
        max_completion_tokens: params.max_completion_tokens || params.max_tokens,
        presence_penalty: params.presence_penalty,
        frequency_penalty: params.frequency_penalty,
        response_format: params.response_format?.type,
        reasoning_effort: params.reasoning_effort,
      },
      response: {
        id: response.id,
        model: response.model,
        choices: response.choices?.map(c => ({
          index: c.index,
          finish_reason: c.finish_reason,
          message: {
            role: c.message.role,
            content: c.message.content?.substring(0, 500) + '...' // 先頭500文字のみ
          }
        })),
        usage: response.usage,
      },
      fullResponse: response, // 後で full comparison に使用
    };
  } catch (error) {
    return {
      sequenceNumber,
      success: false,
      error: {
        message: error.message,
        code: error.code,
        status: error.status,
      },
    };
  }
}

/**
 * メイン処理
 */
async function main() {
  const opts = parseArgs();

  const captureFile = opts['capture-file'];
  const targetModel = opts['model'];
  const outputFile = opts['output'];

  if (!captureFile || !targetModel || !outputFile) {
    console.error('Usage: node replay-single-case.mjs --capture-file <path> --model <model> --output <path>');
    process.exit(1);
  }

  console.log(`\n📹 Replay Single Case`);
  console.log(`  Capture File: ${captureFile}`);
  console.log(`  Target Model: ${targetModel}`);
  console.log(`  Output File: ${outputFile}`);
  console.log('');

  try {
    // 1. Capture ファイルを読み込み
    console.log('📖 Loading capture file...');
    const captureContent = await fs.readFile(captureFile, 'utf-8');
    const captureCase = JSON.parse(captureContent);

    console.log(`  Case ID: ${captureCase.caseId}`);
    console.log(`  Stage: ${captureCase.stage}`);
    console.log(`  Pass: ${captureCase.generationPass}`);
    console.log(`  Records: ${captureCase.records.length}`);
    console.log('');

    // 2. OpenAI クライアント初期化
    const openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });

    if (!process.env.OPENAI_API_KEY) {
      throw new Error('❌ OPENAI_API_KEY が設定されていません');
    }

    // 3. 各リクエストを実行
    console.log('🚀 Executing requests...');
    const results = [];

    for (const record of captureCase.records) {
      // パラメータを調整
      const adjustedParams = adjustParamsForModel(record.params, targetModel);

      const result = await executeRequest(openai, adjustedParams, record.sequenceNumber);
      results.push(result);

      // 出力結果確認
      if (result.success) {
        console.log(`    ✅ Success (tokens: ${result.response.usage?.total_tokens})`);
      } else {
        console.log(`    ❌ Error: ${result.error.message}`);
      }
    }

    console.log('');

    // 4. 結果を JSON に保存
    console.log('💾 Saving results...');
    const outputDir = path.dirname(outputFile);
    await fs.mkdir(outputDir, { recursive: true });

    const replayResult = {
      caseId: captureCase.caseId,
      originalModel: captureCase.records[0]?.params?.model || 'unknown',
      replayModel: targetModel,
      stage: captureCase.stage,
      generationPass: captureCase.generationPass,
      executedAt: new Date().toISOString(),
      successCount: results.filter(r => r.success).length,
      failureCount: results.filter(r => !r.success).length,
      results,
    };

    await fs.writeFile(outputFile, JSON.stringify(replayResult, null, 2), 'utf-8');

    console.log(`  ✅ Saved to: ${outputFile}`);
    console.log('');

    // 5. サマリー表示
    console.log('📊 Summary');
    console.log(`  Original Model: ${captureCase.records[0]?.params?.model}`);
    console.log(`  Replay Model: ${targetModel}`);
    console.log(`  Success: ${results.filter(r => r.success).length}/${results.length}`);

    if (results.some(r => r.success)) {
      const totalPromptTokens = results
        .filter(r => r.success)
        .reduce((sum, r) => sum + (r.response.usage?.prompt_tokens || 0), 0);
      const totalCompletionTokens = results
        .filter(r => r.success)
        .reduce((sum, r) => sum + (r.response.usage?.completion_tokens || 0), 0);

      console.log(`  Total Tokens: ${totalPromptTokens + totalCompletionTokens} (prompt: ${totalPromptTokens}, completion: ${totalCompletionTokens})`);
    }

    console.log('');
    console.log('✅ Replay complete');

  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

main();
