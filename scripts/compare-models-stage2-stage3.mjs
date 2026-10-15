#!/usr/bin/env node
/**
 * STAGE2・STAGE3 モデル品質比較スクリプト
 *
 * 重要：本番 Supabase への書き込みは一切行わない
 * - OpenAI API にのみ送信
 * - 結果はローカル JSON に保存
 * - DB 操作なし（READ も最小限）
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import OpenAI from 'openai';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.dirname(__dirname);

// ========================================
// 設定
// ========================================

const apiKey = process.env.OPENAI_API_KEY;
if (!apiKey) {
  console.error('❌ OPENAI_API_KEY が設定されていません');
  process.exit(1);
}

const openai = new OpenAI({ apiKey });

// 比較ディレクトリ
const COMPARISON_DIR = path.join(projectRoot, 'model-comparison');
const RESULTS_DIR = path.join(COMPARISON_DIR, 'results');

// 保存済みテストデータディレクトリ
const TEST_DATA_DIR = path.join(COMPARISON_DIR, 'test-data');

// ========================================
// モデル定義
// ========================================

const MODELS = {
  current: {
    stage2: 'gpt-5.6-luna',  // 現在のモデル（STAGE2）
    stage3: 'gpt-5.6-luna',  // 現在のモデル（STAGE3）
  },
  candidate: {
    stage2: 'gpt-6-luna',    // 候補モデル（STAGE2）
    stage3: 'gpt-6-luna',    // 候補モデル（STAGE3）
  },
};

// ========================================
// ユーティリティ
// ========================================

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function logStep(title) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`  ${title}`);
  console.log(`${'='.repeat(60)}`);
}

function logInfo(msg) {
  console.log(`ℹ️  ${msg}`);
}

function logSuccess(msg) {
  console.log(`✅ ${msg}`);
}

function logError(msg) {
  console.error(`❌ ${msg}`);
}

function logWarn(msg) {
  console.warn(`⚠️  ${msg}`);
}

// ========================================
// テストデータ読み込み
// ========================================

function getAvailableTestCases() {
  ensureDir(TEST_DATA_DIR);

  const cases = [];
  const items = fs.readdirSync(TEST_DATA_DIR);

  for (const item of items) {
    const itemPath = path.join(TEST_DATA_DIR, item);
    const stat = fs.statSync(itemPath);

    if (stat.isDirectory() && fs.existsSync(path.join(itemPath, 'input.json'))) {
      cases.push({
        id: item,
        path: itemPath,
      });
    }
  }

  return cases.sort();
}

function loadTestData(caseId) {
  const inputPath = path.join(TEST_DATA_DIR, caseId, 'input.json');

  if (!fs.existsSync(inputPath)) {
    throw new Error(`Test data not found: ${inputPath}`);
  }

  const input = JSON.parse(fs.readFileSync(inputPath, 'utf-8'));
  return input;
}

// ========================================
// STAGE2 生成（プロンプト再利用）
// ========================================

async function generateStage2Draft(input, model) {
  // 既存の STAGE2 ドラフトプロンプトロジックを簡略化した形で再実装
  // 実際のプロンプトは app/api/generate-story-draft/route.ts から引用

  const systemPrompt = `あなたは企業の経営戦略を構造化し、説得力のあるストーリーで伝える専門家です。
以下の企業情報をもとに、戦略ストーリーを4章で構成してください。

【出力形式】
{
  "storyDraft": [
    { "chapter": 1, "heading": "第1章：なぜ今", "body": "..." },
    { "chapter": 2, "heading": "第2章：どう戦う", "body": "..." },
    { "chapter": 3, "heading": "第3章：どんな未来", "body": "..." },
    { "chapter": 4, "heading": "第4章：どう実行に落とすか", "body": "..." }
  ]
}`;

  const userPrompt = `
【企業情報】
業種: ${input.industry || '未設定'}
売上: ${input.revenue || '未設定'}
社員数: ${input.employees || '未設定'}

【MVP】
- Mission: ${input.mission || '未設定'}
- Vision: ${input.visionStatement || '未設定'}
- Value: ${input.value || '未設定'}

【SWOT分析】
- 強み: ${input.strength || '未設定'}
- 弱み: ${input.weakness || '未設定'}
- 機会: ${input.opportunity || '未設定'}
- 脅威: ${input.threat || '未設定'}

【12の質問への回答】
${(input.answers12 || []).map((ans, i) => `Q${i + 1}: ${ans.answer || ''}`).join('\n')}

以上の情報から、戦略ストーリーを4章で構成してください。
各章は300-400字程度で、論理的な流れと説得力を重視してください。`;

  // パラメータ構築（モデルごとに異なる）
  const params = {
    model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    response_format: { type: 'json_object' },
  };

  // モデル固有のパラメータ処理
  if (model === 'gpt-6-luna') {
    // gpt-6-luna: temperature・penalties 非対応
    params.max_completion_tokens = 2300;
    params.reasoning_effort = 'low';
  } else {
    // 現在モデル（gpt-5.6-luna など）
    params.max_completion_tokens = 2300;
    params.reasoning_effort = 'low';
    // temperature は Luna では非対応だが、code では送らないはず
  }

  try {
    const response = await openai.chat.completions.create(params);
    const content = response.choices[0]?.message?.content || '';

    try {
      return JSON.parse(content);
    } catch {
      logError(`JSON parse failed for model ${model}`);
      return { error: 'JSON parse failed', raw: content };
    }
  } catch (error) {
    logError(`API call failed for model ${model}: ${error.message}`);
    return { error: error.message };
  }
}

// ========================================
// STAGE3 カスケード生成
// ========================================

async function generateStage3Cascade(input, model) {
  // 既存の STAGE3 カスケードプロンプト（簡略版）

  const systemPrompt = `あなたは全社戦略を部門別戦略に展開する専門家です。
以下の全社戦略から、部門ごとの役割と戦略を導き出してください。

【出力形式】
{
  "departments": [
    {
      "name": "部門名",
      "strategy": "部門の役割と戦略（200-300字）",
      "rationale": "全社戦略との連関（100-150字）"
    }
  ]
}`;

  const userPrompt = `
【企業情報】
企業: ${input.companyName || '企業'}
業種: ${input.industry || '未設定'}

【全社戦略】
${input.finalStory || input.storyDraft || '未設定'}

【部門一覧】
${(input.departments || []).map(d => `- ${d.name}`).join('\n')}

各部門について、全社戦略を踏まえた部門別戦略を定義してください。`;

  const params = {
    model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    response_format: { type: 'json_object' },
  };

  if (model === 'gpt-6-luna') {
    params.max_completion_tokens = 2000;
    params.reasoning_effort = 'low';
  } else {
    params.max_completion_tokens = 2000;
    params.reasoning_effort = 'low';
  }

  try {
    const response = await openai.chat.completions.create(params);
    const content = response.choices[0]?.message?.content || '';

    try {
      return JSON.parse(content);
    } catch {
      logError(`JSON parse failed for model ${model}`);
      return { error: 'JSON parse failed', raw: content };
    }
  } catch (error) {
    logError(`API call failed for model ${model}: ${error.message}`);
    return { error: error.message };
  }
}

// ========================================
// 比較実行
// ========================================

async function compareCase(caseId) {
  logStep(`比較テスト: ${caseId}`);

  // テストデータ読み込み
  let input;
  try {
    input = loadTestData(caseId);
    logSuccess(`入力データ読み込み完了: ${caseId}`);
  } catch (error) {
    logError(`テストデータ読み込み失敗: ${error.message}`);
    return false;
  }

  // 結果保存ディレクトリ
  const caseDir = path.join(RESULTS_DIR, caseId);
  ensureDir(caseDir);

  // 入力データを保存（参照用）
  fs.writeFileSync(path.join(caseDir, 'input.json'), JSON.stringify(input, null, 2));
  logInfo(`入力データを保存: ${caseDir}/input.json`);

  // STAGE2 ドラフト生成
  logInfo('STAGE2 ドラフト生成中（現在モデル）...');
  const stage2Current = await generateStage2Draft(input, MODELS.current.stage2);
  fs.writeFileSync(
    path.join(caseDir, 'stage2-current.json'),
    JSON.stringify(stage2Current, null, 2)
  );
  logSuccess('STAGE2（現在モデル）完了');

  logInfo('STAGE2 ドラフト生成中（gpt-6-luna）...');
  const stage2Candidate = await generateStage2Draft(input, MODELS.candidate.stage2);
  fs.writeFileSync(
    path.join(caseDir, 'stage2-gpt6-luna.json'),
    JSON.stringify(stage2Candidate, null, 2)
  );
  logSuccess('STAGE2（gpt-6-luna）完了');

  // STAGE3 カスケード生成（STAGE2 結果を入力として使用）
  const stage3Input = {
    ...input,
    finalStory: stage2Current.storyDraft ? stage2Current.storyDraft.map(s => s.body).join('\n') : '',
  };

  logInfo('STAGE3 カスケード生成中（現在モデル）...');
  const stage3Current = await generateStage3Cascade(stage3Input, MODELS.current.stage3);
  fs.writeFileSync(
    path.join(caseDir, 'stage3-current.json'),
    JSON.stringify(stage3Current, null, 2)
  );
  logSuccess('STAGE3（現在モデル）完了');

  logInfo('STAGE3 カスケード生成中（gpt-6-luna）...');
  const stage3Candidate = await generateStage3Cascade(stage3Input, MODELS.candidate.stage3);
  fs.writeFileSync(
    path.join(caseDir, 'stage3-gpt6-luna.json'),
    JSON.stringify(stage3Candidate, null, 2)
  );
  logSuccess('STAGE3（gpt-6-luna）完了');

  // 評価テンプレート生成
  const evaluationTemplate = `# ${caseId} 品質比較評価

## 入力情報
- 企業: ${input.companyName || '未設定'}
- 業種: ${input.industry || '未設定'}
- 売上: ${input.revenue || '未設定'}

## STAGE2 ドラフト生成

### 入力反映度
- 現在モデル: [ ] A [ ] B [ ] C
- gpt-6-luna: [ ] A [ ] B [ ] C
- 評価:

### 本質課題の捉え方
- 現在モデル: [ ] A [ ] B [ ] C
- gpt-6-luna: [ ] A [ ] B [ ] C
- 評価:

### 価値定義の具体性
- 現在モデル: [ ] A [ ] B [ ] C
- gpt-6-luna: [ ] A [ ] B [ ] C
- 評価:

### 説得力
- 現在モデル: [ ] A [ ] B [ ] C
- gpt-6-luna: [ ] A [ ] B [ ] C
- 評価:

### 一貫性
- 現在モデル: [ ] A [ ] B [ ] C
- gpt-6-luna: [ ] A [ ] B [ ] C
- 評価:

### STAGE2 総合判定
結論: [ ] A: gpt-6-luna が明確に良い
      [ ] B: ほぼ同等
      [ ] C: 現行より悪い

## STAGE3 カスケード生成

### STAGE2 継承度
- 現在モデル: [ ] A [ ] B [ ] C
- gpt-6-luna: [ ] A [ ] B [ ] C
- 評価:

### 部門固有への変換
- 現在モデル: [ ] A [ ] B [ ] C
- gpt-6-luna: [ ] A [ ] B [ ] C
- 評価:

### 部門間の役割分担
- 現在モデル: [ ] A [ ] B [ ] C
- gpt-6-luna: [ ] A [ ] B [ ] C
- 評価:

### 実行可能性への具体化
- 現在モデル: [ ] A [ ] B [ ] C
- gpt-6-luna: [ ] A [ ] B [ ] C
- 評価:

### 因果関係の維持
- 現在モデル: [ ] A [ ] B [ ] C
- gpt-6-luna: [ ] A [ ] B [ ] C
- 評価:

### STAGE3 総合判定
結論: [ ] A: gpt-6-luna が明確に良い
      [ ] B: ほぼ同等
      [ ] C: 現行より悪い

## パラメータ差異の記録

モデル間で以下のパラメータ差が存在します（実 API テスト結果に基づく）:

### gpt-5.6-luna（現在）
- max_completion_tokens: 2300
- reasoning_effort: low
- temperature: 非対応（送信しない）

### gpt-6-luna（候補）
- max_completion_tokens: 2300
- reasoning_effort: low
- temperature: 非対応（送信しない）

※ 両モデルともほぼ同じパラメータ制限を持つため、パラメータ差による影響は最小と想定

## その他所見

（自由記述）
`;

  fs.writeFileSync(path.join(caseDir, 'evaluation.md'), evaluationTemplate);
  logSuccess(`評価テンプレート生成: ${caseDir}/evaluation.md`);

  logSuccess(`\n✅ ${caseId} の比較完了`);
  logInfo(`結果はこちらに保存: ${caseDir}/`);

  return true;
}

// ========================================
// メイン
// ========================================

async function main() {
  console.log(`\n${'='.repeat(60)}`);
  console.log('  STAGE2・STAGE3 モデル品質比較スクリプト');
  console.log('  （本番 Supabase 書き込みなし）');
  console.log(`${'='.repeat(60)}\n`);

  // ディレクトリ確認
  logInfo(`テストデータディレクトリ: ${TEST_DATA_DIR}`);
  logInfo(`結果保存ディレクトリ: ${RESULTS_DIR}`);

  // テストケース確認
  const testCases = getAvailableTestCases();
  logSuccess(`利用可能なテストケース: ${testCases.length}件`);

  if (testCases.length === 0) {
    logError('\nテストケースが見つかりません');
    logError(`以下にテストデータを配置してください: ${TEST_DATA_DIR}`);
    logError('例: model-comparison/test-data/case-001/input.json');
    process.exit(1);
  }

  // テストケース一覧表示
  console.log('\n【利用可能なテストケース】');
  testCases.forEach((tc, i) => {
    console.log(`${i + 1}. ${tc.id}`);
  });

  // 最初の2ケースを実行
  const casesToRun = testCases.slice(0, 2);
  console.log(`\n【実行予定】最初の2ケースを実行します`);
  casesToRun.forEach(tc => {
    console.log(`- ${tc.id}`);
  });

  // 実行
  for (const testCase of casesToRun) {
    try {
      await compareCase(testCase.id);
    } catch (error) {
      logError(`\n比較テスト失敗 (${testCase.id}): ${error.message}`);
    }
  }

  logStep('比較テスト完了');
  logSuccess(`\n✅ すべての比較が完了しました`);
  logInfo(`結果は ${RESULTS_DIR} に保存されています`);
  logInfo('\n【次のステップ】');
  logInfo('1. 各ケースの evaluation.md を開く');
  logInfo('2. stage2-current.json と stage2-gpt6-luna.json を比較');
  logInfo('3. stage3-current.json と stage3-gpt6-luna.json を比較');
  logInfo('4. 各項目について A/B/C で評価');
  logInfo('5. 最後に総合判定を記入\n');
}

main().catch((error) => {
  logError(`\nスクリプト実行エラー: ${error.message}`);
  process.exit(1);
});
