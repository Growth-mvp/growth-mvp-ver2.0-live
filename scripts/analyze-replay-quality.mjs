#!/usr/bin/env node
/**
 * Replay 結果の品質分析スクリプト
 *
 * gpt-5.6-luna（Capture 基準）と gpt-6-luna（Replay）の応答を客観的に比較
 */

import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';

// .env.local を読み込む
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

async function analyzeReplayQuality() {
  console.log('【Replay 品質分析】');
  console.log('========================================\n');

  // Step 1: Replay 結果を読み込む
  console.log('【ステップ 1】Replay 結果を読み込み...');
  let replayResults;
  try {
    const replayContent = await fs.readFile('model-comparison/replay-results.json', 'utf-8');
    replayResults = JSON.parse(replayContent);
    console.log(`✓ ${replayResults.replayedRecords.length} レコードを読み込み\n`);
  } catch (e) {
    console.error('✗ Replay 結果の読み込みに失敗:', e.message);
    process.exit(1);
  }

  // Step 2: Capture JSON を読み込む（元の messages を参照）
  console.log('【ステップ 2】Capture JSON を読み込み...');
  let caseData;
  try {
    const captureContent = await fs.readFile('model-comparison/captures/draft-case-001.json', 'utf-8');
    caseData = JSON.parse(captureContent);
    console.log(`✓ Capture JSON を読み込み\n`);
  } catch (e) {
    console.error('✗ Capture JSON の読み込みに失敗:', e.message);
    process.exit(1);
  }

  // Step 3: 各レコードの比較分析
  console.log('【ステップ 3】レコード別分析\n');
  console.log('========================================\n');

  const analysisResults = {
    timestamp: new Date().toISOString(),
    records: [],
  };

  for (let i = 0; i < replayResults.replayedRecords.length; i++) {
    const replayRecord = replayResults.replayedRecords[i];
    const captureRecord = caseData.records[i];

    const analysis = {
      sequenceNumber: replayRecord.sequenceNumber,
      analysis: {},
    };

    console.log(`【Record ${i + 1}】sequenceNumber: ${replayRecord.sequenceNumber}`);
    console.log(`元のモデル: ${replayRecord.originalModel}`);
    console.log(`Replay モデル: ${replayRecord.replayModel}\n`);

    // 元の messages を表示（プロンプトの参照用）
    console.log('【入力データの確認】');
    const originalMessages = replayRecord.originalMessages || [];
    let inputDataText = '';
    originalMessages.forEach((msg, idx) => {
      if (msg.role === 'user') {
        inputDataText = msg.content;
        console.log(`User Message（先頭 500 文字）:\n${inputDataText.substring(0, 500)}...\n`);
      }
    });

    // gpt-5.6-luna の応答を抽出
    const originalResponse = captureRecord.response?.choices?.[0]?.message?.content || '';
    console.log('【gpt-5.6-luna の応答（Capture 基準）】');
    console.log(`応答長: ${originalResponse.length} 文字`);

    // gpt-5.6-luna の応答から JSON を抽出して解析
    let originalJson = null;
    try {
      const jsonMatch = originalResponse.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        originalJson = JSON.parse(jsonMatch[0]);
        console.log('✓ JSON 構造を確認');
        console.log(`  - storyDraft: ${originalJson.storyDraft ? '○' : '✗'}`);
        console.log(`  - winPatternsCandidate: ${originalJson.winPatternsCandidate ? '○' : '✗'}`);
      }
    } catch (e) {
      console.log('✗ JSON 解析に失敗');
    }

    // gpt-6-luna の応答を抽出
    const replayResponse = replayRecord.replayResponse?.choices?.[0]?.message?.content || '';
    console.log('\n【gpt-6-luna の応答（Replay）】');
    console.log(`応答長: ${replayResponse.length} 文字`);

    // gpt-6-luna の応答から JSON を抽出して解析
    let replayJson = null;
    try {
      const jsonMatch = replayResponse.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        replayJson = JSON.parse(jsonMatch[0]);
        console.log('✓ JSON 構造を確認');
        console.log(`  - storyDraft: ${replayJson.storyDraft ? '○' : '✗'}`);
        console.log(`  - winPatternsCandidate: ${replayJson.winPatternsCandidate ? '○' : '✗'}`);
      }
    } catch (e) {
      console.log('✗ JSON 解析に失敗');
    }

    // hallucination チェック（特定の数値を検索）
    console.log('\n【Hallucination チェック】');
    const suspiciousNumbers = ['営業利益率13.0%', '業界中央値5.00倍'];
    const checkHallucination = (text, numbers) => {
      const findings = [];
      numbers.forEach(num => {
        if (text.includes(num)) {
          findings.push({
            number: num,
            found: true,
            inOriginal: inputDataText.includes(num),
          });
        }
      });
      return findings;
    };

    const originalHallucinations = checkHallucination(originalResponse, suspiciousNumbers);
    const replayHallucinations = checkHallucination(replayResponse, suspiciousNumbers);

    if (originalHallucinations.length > 0) {
      console.log('gpt-5.6-luna の疑わしい数値:');
      originalHallucinations.forEach(h => {
        console.log(`  - "${h.number}": ${h.inOriginal ? '✓ 入力データに存在' : '✗ 入力データに不存在（HALLUCINATION）'}`);
      });
    }

    if (replayHallucinations.length > 0) {
      console.log('gpt-6-luna の疑わしい数値:');
      replayHallucinations.forEach(h => {
        console.log(`  - "${h.number}": ${h.inOriginal ? '✓ 入力データに存在' : '✗ 入力データに不存在（HALLUCINATION）'}`);
      });
    }

    if (originalHallucinations.length === 0 && replayHallucinations.length === 0) {
      console.log('✓ 疑わしい数値は検出されませんでした');
    }

    analysis.originalResponse = {
      length: originalResponse.length,
      hallucinations: originalHallucinations,
    };
    analysis.replayResponse = {
      length: replayResponse.length,
      hallucinations: replayHallucinations,
    };

    console.log('\n========================================\n');
    analysisResults.records.push(analysis);
  }

  // Step 4: 比較表を作成
  console.log('【比較表：gpt-5.6-luna vs gpt-6-luna】');
  console.log('========================================\n');

  const comparisonTable = {
    '正確性': {
      description: '数値・事実の正確性、hallucination の有無',
      'gpt-5.6-luna': '',
      'gpt-6-luna': '',
    },
    '指示遵守': {
      description: 'JSON 形式、必須フィールドの完備',
      'gpt-5.6-luna': '',
      'gpt-6-luna': '',
    },
    '戦略の具体性': {
      description: '4 章構成、各章の内容の具体性・説得力',
      'gpt-5.6-luna': '',
      'gpt-6-luna': '',
    },
    '経営判断への有用性': {
      description: 'CEO が参考にできる具体的な内容',
      'gpt-5.6-luna': '',
      'gpt-6-luna': '',
    },
    'hallucination': {
      description: '根拠のない数値・事実の生成',
      'gpt-5.6-luna': '',
      'gpt-6-luna': '',
    },
    'repair 後の完成度': {
      description: 'draft → repair での改善度合い',
      'gpt-5.6-luna': '',
      'gpt-6-luna': '',
    },
  };

  console.log('| 評価項目 | 内容 | gpt-5.6-luna | gpt-6-luna |');
  console.log('|---------|------|--------------|-----------|');

  Object.entries(comparisonTable).forEach(([item, details]) => {
    console.log(
      `| ${item} | ${details.description} | [要手動評価] | [要手動評価] |`
    );
  });

  console.log('\n【評価方法】');
  console.log('- 正確性: ○ 正確 / △ 若干の誤り / ✗ 誤り多数/hallucination あり');
  console.log('- 指示遵守: ○ 完全 / △ 軽微な不備 / ✗ 大きな不備');
  console.log('- 戦略の具体性: ○ 具体的・説得力あり / △ 中程度 / ✗ 抽象的');
  console.log('- 経営判断への有用性: ○ 高い / △ 中程度 / ✗ 低い');
  console.log('- hallucination: ○ なし / △ 軽微 / ✗ あり');
  console.log('- repair 後の完成度: ○ 大幅改善 / △ 若干改善 / ✗ ほぼ変わらず\n');

  // Step 5: 分析結果を保存
  console.log('【ステップ 5】分析結果を保存...\n');
  try {
    const analysisDir = 'model-comparison';
    await fs.mkdir(analysisDir, { recursive: true });
    await fs.writeFile(
      path.join(analysisDir, 'quality-analysis.json'),
      JSON.stringify(analysisResults, null, 2),
      'utf-8'
    );
    console.log(`✓ 分析結果を保存: model-comparison/quality-analysis.json\n`);
  } catch (e) {
    console.error('✗ 分析結果保存に失敗:', e.message);
  }

  console.log('========================================');
  console.log('分析完了。手動評価をお願いします。');
  console.log('========================================\n');
}

analyzeReplayQuality().catch(err => {
  console.error('分析スクリプト失敗:', err);
  process.exit(1);
});
