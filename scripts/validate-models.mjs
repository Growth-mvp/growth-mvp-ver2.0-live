#!/usr/bin/env node
// scripts/validate-models.mjs
// Build時に実行: config/models.json が正しい仕様で設定されていることを検証

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = dirname(__dirname);

try {
  // 1. config/models.json を読み込み
  const modelSpecPath = join(projectRoot, 'config/models.json');
  const modelSpec = JSON.parse(readFileSync(modelSpecPath, 'utf-8'));

  const errors = [];

  // 2. JSON の構造検証
  if (!modelSpec.ai_models || !modelSpec.process_configs) {
    throw new Error('Invalid config/models.json structure');
  }

  // 3. ai_models の検証
  if (modelSpec.ai_models.reasoning !== 'gpt-5.6-luna') {
    errors.push(
      `❌ ai_models.reasoning must be 'gpt-5.6-luna', got: '${modelSpec.ai_models.reasoning}'`
    );
  }
  if (modelSpec.ai_models.lightweight !== 'gpt-4o-mini') {
    errors.push(
      `❌ ai_models.lightweight must be 'gpt-4o-mini', got: '${modelSpec.ai_models.lightweight}'`
    );
  }

  // 4. 必須プロセスの確認
  const requiredProcesses = [
    'stage2Draft',
    'stage2DraftRepair',
    'stage2Final',
    'stage2FinalRepair',
    'stage2Midterm',
    'stage2Emotion',
    'stage3Bridge',
    'orgAlignmentGenerate',
  ];

  for (const processKey of requiredProcesses) {
    if (!modelSpec.process_configs.hasOwnProperty(processKey)) {
      errors.push(`❌ process_configs missing: ${processKey}`);
      continue;
    }

    const config = modelSpec.process_configs[processKey];
    if (!config.modelRole || config.maxCompletionTokens === undefined || config.jsonMode === undefined) {
      errors.push(`❌ ${processKey} has incomplete config`);
    }

    // modelRole の値チェック
    if (!['reasoning', 'lightweight'].includes(config.modelRole)) {
      errors.push(`❌ ${processKey} has invalid modelRole: ${config.modelRole}`);
    }

    // maxCompletionTokens は正の数
    if (typeof config.maxCompletionTokens !== 'number' || config.maxCompletionTokens <= 0) {
      errors.push(`❌ ${processKey} maxCompletionTokens must be positive number`);
    }

    // jsonMode はboolean
    if (typeof config.jsonMode !== 'boolean') {
      errors.push(`❌ ${processKey} jsonMode must be boolean`);
    }
  }

  // 5. 各プロセスの modelRole チェック
  const reasoningProcesses = [
    'stage2Draft',
    'stage2DraftRepair',
    'stage2Final',
    'stage2FinalRepair',
    'stage2Midterm',
    'stage3Bridge',
    'orgAlignmentGenerate',
  ];

  for (const processKey of reasoningProcesses) {
    const config = modelSpec.process_configs[processKey];
    if (config && config.modelRole !== 'reasoning') {
      errors.push(`❌ ${processKey} should use reasoning model, got: ${config.modelRole}`);
    }
  }

  if (modelSpec.process_configs.stage2Emotion && modelSpec.process_configs.stage2Emotion.modelRole !== 'lightweight') {
    errors.push(`❌ stage2Emotion should use lightweight model`);
  }

  // 6. 結果判定
  if (errors.length > 0) {
    console.error('❌ Model Configuration Validation Failed:\n');
    errors.forEach((e) => console.error(e));
    process.exit(1);
  }

  console.log('✅ Model Configuration Validation Passed');
  console.log(`  ✓ ai_models.reasoning = ${modelSpec.ai_models.reasoning}`);
  console.log(`  ✓ ai_models.lightweight = ${modelSpec.ai_models.lightweight}`);
  console.log(`  ✓ 8 required processes configured with valid schemas`);
  console.log('');
  process.exit(0);
} catch (error) {
  console.error('❌ Model validation error:', error.message);
  process.exit(1);
}
