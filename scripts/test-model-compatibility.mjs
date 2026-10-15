#!/usr/bin/env node
/**
 * OpenAI API 互換性検証スクリプト
 *
 * gpt-6-luna と gpt-4o-mini のパラメータ対応状況を実際の API で検証
 */

import OpenAI from 'openai';

const apiKey = process.env.OPENAI_API_KEY;
if (!apiKey) {
  console.error('❌ OPENAI_API_KEY が設定されていません');
  process.exit(1);
}

const openai = new OpenAI({ apiKey });

// ========================================
// テストケース定義
// ========================================

const TEST_MODELS = {
  'gpt-6-luna': { exists: null, error: null },
  'gpt-5.6-luna': { exists: null, error: null },
  'gpt-4o-mini': { exists: null, error: null },
};

const TEST_PARAMETERS = [
  { name: 'temperature', value: 0.5, description: 'Float パラメータ' },
  { name: 'max_tokens', value: 100, description: 'Token limit (legacy)' },
  { name: 'max_completion_tokens', value: 100, description: 'Token limit (Luna)' },
  { name: 'response_format', value: { type: 'json_object' }, description: 'JSON mode' },
  { name: 'reasoning_effort', value: 'low', description: 'Luna専用推論' },
  { name: 'presence_penalty', value: 0.2, description: 'Penalty' },
  { name: 'frequency_penalty', value: 0.2, description: 'Penalty' },
];

// ========================================
// テスト実行
// ========================================

async function testModelAvailability() {
  console.log('\n📋 【テスト1】モデル可用性確認\n');

  for (const model of Object.keys(TEST_MODELS)) {
    try {
      const response = await openai.chat.completions.create({
        model,
        max_completion_tokens: 10,
        messages: [{ role: 'user', content: 'test' }],
      });
      TEST_MODELS[model].exists = true;
      console.log(`✅ ${model}: 利用可能`);
    } catch (error) {
      TEST_MODELS[model].exists = false;
      TEST_MODELS[model].error = error.message;
      const status = error.status || 'Unknown';
      console.log(`❌ ${model}: 利用不可 (${status})`);
      console.log(`   詳細: ${error.message.slice(0, 100)}`);
    }
  }
}

async function testParameterCompatibility() {
  console.log('\n📋 【テスト2】パラメータ互換性確認（詳細）\n');

  const testModels = ['gpt-6-luna', 'gpt-5.6-luna', 'gpt-4o-mini'].filter(
    m => TEST_MODELS[m].exists
  );

  if (testModels.length === 0) {
    console.log('❌ テスト可能なモデルがありません');
    return;
  }

  // gpt-6-luna のみ詳細テスト
  for (const model of testModels) {
    if (model !== 'gpt-6-luna') continue;

    console.log(`\n🔸 ${model} - 詳細パラメータテスト:\n`);

    // 1. max_tokens テスト
    try {
      await openai.chat.completions.create({
        model,
        max_tokens: 100,  // 明示的に max_tokens を指定
        messages: [{ role: 'user', content: 'test' }],
      });
      console.log('✅ max_tokens: 正常動作');
    } catch (error) {
      const msg = error.message || '';
      console.log(`❌ max_tokens: APIエラー - ${msg.slice(0, 80)}`);
    }

    // 2. max_completion_tokens テスト
    try {
      await openai.chat.completions.create({
        model,
        max_completion_tokens: 100,
        messages: [{ role: 'user', content: 'test' }],
      });
      console.log('✅ max_completion_tokens: 正常動作');
    } catch (error) {
      const msg = error.message || '';
      console.log(`❌ max_completion_tokens: APIエラー - ${msg.slice(0, 80)}`);
    }

    // 3. temperature テスト
    try {
      await openai.chat.completions.create({
        model,
        max_completion_tokens: 100,
        temperature: 0.5,
        messages: [{ role: 'user', content: 'test' }],
      });
      console.log('✅ temperature: 正常動作');
    } catch (error) {
      const msg = error.message || '';
      if (msg.includes('Unsupported')) {
        console.log(`⚠️  temperature: 無視される（またはAPIエラー） - ${msg.slice(0, 80)}`);
      } else {
        console.log(`❌ temperature: APIエラー - ${msg.slice(0, 80)}`);
      }
    }

    // 4. response_format テスト
    try {
      await openai.chat.completions.create({
        model,
        max_completion_tokens: 100,
        response_format: { type: 'json_object' },
        messages: [{ role: 'user', content: 'Return valid JSON format' }],
      });
      console.log('✅ response_format: 正常動作');
    } catch (error) {
      const msg = error.message || '';
      if (msg.includes('must contain')) {
        console.log(`⚠️  response_format: 条件付き（メッセージに 'json' 必須） - ${msg.slice(0, 80)}`);
      } else {
        console.log(`❌ response_format: APIエラー - ${msg.slice(0, 80)}`);
      }
    }

    // 5. reasoning_effort テスト
    try {
      await openai.chat.completions.create({
        model,
        max_completion_tokens: 100,
        reasoning_effort: 'low',
        messages: [{ role: 'user', content: 'test' }],
      });
      console.log('✅ reasoning_effort: 正常動作');
    } catch (error) {
      const msg = error.message || '';
      console.log(`❌ reasoning_effort: APIエラー - ${msg.slice(0, 80)}`);
    }

    // 6. presence_penalty テスト
    try {
      await openai.chat.completions.create({
        model,
        max_completion_tokens: 100,
        presence_penalty: 0.2,
        messages: [{ role: 'user', content: 'test' }],
      });
      console.log('✅ presence_penalty: 正常動作');
    } catch (error) {
      const msg = error.message || '';
      console.log(`⚠️  presence_penalty: 非対応 - ${msg.slice(0, 80)}`);
    }

    // 7. frequency_penalty テスト
    try {
      await openai.chat.completions.create({
        model,
        max_completion_tokens: 100,
        frequency_penalty: 0.2,
        messages: [{ role: 'user', content: 'test' }],
      });
      console.log('✅ frequency_penalty: 正常動作');
    } catch (error) {
      const msg = error.message || '';
      console.log(`⚠️  frequency_penalty: 非対応 - ${msg.slice(0, 80)}`);
    }
  }
}

async function testJSONMode() {
  console.log('\n📋 【テスト3】JSON出力の互換性\n');

  const testModels = ['gpt-6-luna', 'gpt-5.6-luna', 'gpt-4o-mini'].filter(
    m => TEST_MODELS[m].exists
  );

  const testPrompt = 'JSON形式で以下を返してください: {"status": "ok", "value": 42}';

  for (const model of testModels) {
    console.log(`\n🔸 ${model}:`);

    // Test 1: response_format なし
    try {
      const response = await openai.chat.completions.create({
        model,
        max_completion_tokens: 100,
        messages: [{ role: 'user', content: testPrompt }],
      });
      const content = response.choices[0]?.message?.content || '';
      try {
        JSON.parse(content);
        console.log(`  ✅ JSON出力（format なし）: 解析成功`);
      } catch {
        console.log(`  ⚠️  JSON出力（format なし）: 出力はテキスト（JSON.parse失敗）`);
      }
    } catch (error) {
      console.log(`  ❌ JSON出力（format なし）: ${error.message.slice(0, 60)}`);
    }

    // Test 2: response_format = json_object
    try {
      const response = await openai.chat.completions.create({
        model,
        max_completion_tokens: 100,
        response_format: { type: 'json_object' },
        messages: [{ role: 'user', content: testPrompt }],
      });
      const content = response.choices[0]?.message?.content || '';
      try {
        JSON.parse(content);
        console.log(`  ✅ JSON出力（format=json_object）: 解析成功`);
      } catch {
        console.log(`  ❌ JSON出力（format=json_object）: 解析失敗`);
      }
    } catch (error) {
      const msg = error.message || '';
      if (msg.includes('not supported')) {
        console.log(`  ⚠️  JSON出力（format=json_object）: 非対応（エラー）`);
      } else {
        console.log(`  ❌ JSON出力（format=json_object）: ${msg.slice(0, 60)}`);
      }
    }
  }
}

async function testGrowthShiftJSON() {
  console.log('\n📋 【テスト4】GROWTH SHIFT実際のJSON形式\n');

  const storyJsonPrompt = `以下のJSONスキーマで戦略ストーリーを生成してください：
{
  "storyDraft": [
    {"chapter": 1, "heading": "第1章：なぜ今", "body": "現状の危機..."},
    {"chapter": 2, "heading": "第2章：どう戦う", "body": "選択と集中..."}
  ]
}`;

  const testModels = ['gpt-6-luna', 'gpt-5.6-luna'].filter(
    m => TEST_MODELS[m].exists
  );

  for (const model of testModels) {
    console.log(`\n🔸 ${model}:`);
    try {
      const response = await openai.chat.completions.create({
        model,
        max_completion_tokens: 300,
        response_format: { type: 'json_object' },
        messages: [{ role: 'user', content: storyJsonPrompt }],
      });
      const content = response.choices[0]?.message?.content || '';
      try {
        const parsed = JSON.parse(content);
        console.log(`  ✅ GROWTH SHIFT JSON生成: 成功（構造検証）`);
        console.log(`     - storyDraft 存在: ${parsed.storyDraft ? '✓' : '✗'}`);
        console.log(`     - 配列長: ${Array.isArray(parsed.storyDraft) ? parsed.storyDraft.length : 'N/A'}`);
      } catch (e) {
        console.log(`  ❌ GROWTH SHIFT JSON生成: JSON解析失敗`);
        console.log(`     レスポンス先頭: ${content.slice(0, 100)}`);
      }
    } catch (error) {
      console.log(`  ❌ GROWTH SHIFT JSON生成: API呼び出しエラー`);
      console.log(`     ${error.message.slice(0, 80)}`);
    }
  }
}

async function testResponsesAPI() {
  console.log('\n📋 【テスト5】Responses API + web_search\n');

  try {
    const response = await openai.responses.create({
      model: 'gpt-6-luna',
      tools: [{ type: 'web_search' }],
      input: 'OpenAI gpt-6-luna release date',
    });
    console.log(`✅ gpt-6-luna + Responses API: 利用可能`);
    console.log(`   Status: ${response.status}`);
  } catch (error) {
    console.log(`❌ gpt-6-luna + Responses API: ${error.message.slice(0, 100)}`);
  }
}

async function compareGenerationQuality() {
  console.log('\n📋 【テスト6】生成品質比較（サンプル）\n');

  const testCases = [
    {
      name: 'STAGE2ドラフト生成',
      prompt: `以下の企業情報から、戦略ストーリーの第1章（なぜ今）を100字以内で生成してください。
      MVV: ミッション「顧客成功」、ビジョン「業界トップシェア」
      SWOT: 強み「技術力」、弱み「営業力」、機会「AI需要」、脅威「大手競争」`,
      jsonMode: false,
    },
    {
      name: 'JSON構造出力',
      prompt: `以下をJSON形式で返してください：{"analysis": {"key_insight": "技術力が最大の強み", "action": "営業組織強化に投資"}}`,
      jsonMode: true,
    },
  ];

  const testModels = ['gpt-6-luna', 'gpt-5.6-luna'].filter(
    m => TEST_MODELS[m].exists
  );

  for (const testCase of testCases) {
    console.log(`\n🔸 ${testCase.name}:`);

    for (const model of testModels) {
      try {
        const params = {
          model,
          max_completion_tokens: 200,
          temperature: 0.5,
          messages: [{ role: 'user', content: testCase.prompt }],
        };

        if (testCase.jsonMode) {
          params.response_format = { type: 'json_object' };
        }

        const response = await openai.chat.completions.create(params);
        const content = response.choices[0]?.message?.content || '';
        const length = content.length;

        if (testCase.jsonMode) {
          try {
            JSON.parse(content);
            console.log(`  ✅ ${model}: JSON出力成功（${length}字）`);
          } catch {
            console.log(`  ⚠️  ${model}: JSON形式エラー（${length}字）`);
          }
        } else {
          console.log(`  ✅ ${model}: テキスト出力成功（${length}字）`);
        }
      } catch (error) {
        console.log(`  ❌ ${model}: エラー - ${error.message.slice(0, 50)}`);
      }
    }
  }
}

// ========================================
// メイン実行
// ========================================

async function main() {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('🔬 OpenAI API モデル互換性検証スクリプト');
  console.log('═══════════════════════════════════════════════════════════');
  console.log(`実行日時: ${new Date().toISOString()}`);

  try {
    await testModelAvailability();
    await testParameterCompatibility();
    await testJSONMode();
    await testGrowthShiftJSON();
    await testResponsesAPI();
    await compareGenerationQuality();
  } catch (error) {
    console.error('❌ スクリプト実行エラー:', error);
  }

  // ========================================
  // 結果サマリー
  // ========================================
  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('📊 モデル可用性サマリー');
  console.log('═══════════════════════════════════════════════════════════');

  for (const [model, status] of Object.entries(TEST_MODELS)) {
    const icon = status.exists ? '✅' : '❌';
    console.log(`${icon} ${model}: ${status.exists ? '利用可能' : `利用不可 (${status.error?.slice(0, 50)}...)`}`);
  }

  console.log('\n✅ テスト完了\n');
}

main().catch(console.error);
