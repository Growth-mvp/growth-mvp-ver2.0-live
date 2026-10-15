#!/usr/bin/env node
/**
 * 数値根拠の詳細検証スクリプト
 *
 * 「営業利益率13.0%」と「業界中央値5.00倍」が、入力データのどこに存在するか
 * または計算可能か、または丸めか、を詳細に調査
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

async function verifyNumbers() {
  console.log('【数値根拠の詳細検証】');
  console.log('========================================\n');

  // Capture JSON を読み込む
  console.log('【ステップ 1】Capture JSON を読み込み...\n');
  let caseData;
  try {
    const captureContent = await fs.readFile('model-comparison/captures/draft-case-001.json', 'utf-8');
    caseData = JSON.parse(captureContent);
    console.log(`✓ ${caseData.records.length} レコードを読み込み\n`);
  } catch (e) {
    console.error('✗ Capture JSON の読み込みに失敗:', e.message);
    process.exit(1);
  }

  // Replay 結果を読み込む
  console.log('【ステップ 2】Replay 結果を読み込み...\n');
  let replayResults;
  try {
    const replayContent = await fs.readFile('model-comparison/replay-results.json', 'utf-8');
    replayResults = JSON.parse(replayContent);
    console.log(`✓ Replay 結果を読み込み\n`);
  } catch (e) {
    console.error('✗ Replay 結果の読み込みに失敗:', e.message);
    process.exit(1);
  }

  // 検索対象の数値
  const targetNumbers = [
    { exact: '営業利益率13.0%', variants: ['13.0%', '13.0', '13', '13%', '13.00%', '13.2%', '13.1%'] },
    { exact: '業界中央値5.00倍', variants: ['5.00倍', '5.00', '5倍', '5.0倍', '5.1倍', '4.9倍'] },
  ];

  // Record 1 の詳細確認
  console.log('【Record 1（stage2-draft）の詳細確認】');
  console.log('========================================\n');

  const record1 = caseData.records[0];
  const replay1 = replayResults.replayedRecords[0];

  console.log('【入力 Messages の全文確認】\n');

  // 全 message を検索
  let allInputText = '';
  record1.messages.forEach((msg, idx) => {
    console.log(`--- Message ${idx + 1} (role: ${msg.role}) ---`);
    console.log(`長さ: ${msg.content.length} 文字\n`);
    allInputText += msg.content + '\n';
  });

  console.log('\n【目標数値の検索】\n');

  // 数値ごとに詳細検索
  targetNumbers.forEach(target => {
    console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`対象: "${target.exact}"\n`);

    // 完全一致検索
    const exactMatch = allInputText.includes(target.exact);
    console.log(`1. 完全一致（"${target.exact}"）: ${exactMatch ? '✓ あり' : '✗ なし'}`);

    // バリアント検索
    console.log(`\n2. バリアント検索（表記差を考慮）:`);
    const foundVariants = [];
    target.variants.forEach(variant => {
      if (allInputText.includes(variant)) {
        foundVariants.push(variant);
      }
    });
    if (foundVariants.length > 0) {
      console.log(`✓ 以下が見つかりました:`);
      foundVariants.forEach(v => {
        const idx = allInputText.indexOf(v);
        const context = allInputText.substring(Math.max(0, idx - 100), Math.min(allInputText.length, idx + 100));
        console.log(`  - "${v}"\n    前後の文脈: ...${context}...`);
      });
    } else {
      console.log(`✗ バリアント表記も見つかりません`);
    }

    // 数値の部分抽出（例：13 を含む行）
    console.log(`\n3. 関連数値の検索（部分一致）:`);
    const numberPart = target.exact.match(/[\d.]+/)?.[0];
    if (numberPart) {
      const lines = allInputText.split('\n');
      const relevantLines = lines.filter(line => line.includes(numberPart));
      if (relevantLines.length > 0) {
        console.log(`✓ 数値「${numberPart}」を含む行:`);
        relevantLines.slice(0, 5).forEach((line, idx) => {
          console.log(`  ${idx + 1}. ${line.substring(0, 200)}...`);
        });
      }
    }
  });

  console.log('\n\n【Record 1 出力内容の確認】');
  console.log('========================================\n');

  const gpt6Output = replay1.replayResponse?.choices?.[0]?.message?.content || '';
  console.log(`gpt-6-luna の応答長: ${gpt6Output.length} 文字\n`);

  // JSON を抽出して解析
  try {
    const jsonMatch = gpt6Output.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const outputJson = JSON.parse(jsonMatch[0]);

      // storyDraft から対象数値を検索
      if (outputJson.storyDraft) {
        console.log('【storyDraft の内容確認】\n');
        const storyText = JSON.stringify(outputJson.storyDraft);

        targetNumbers.forEach(target => {
          const found = storyText.includes(target.exact);
          console.log(`"${target.exact}": ${found ? '✓ あり' : '✗ なし'}`);

          if (found) {
            const idx = storyText.indexOf(target.exact);
            const context = storyText.substring(Math.max(0, idx - 200), Math.min(storyText.length, idx + 200));
            console.log(`前後の文脈: ...${context}...\n`);
          }
        });
      }
    }
  } catch (e) {
    console.log('JSON 抽出失敗:', e.message);
  }

  console.log('\n\n【結論】');
  console.log('========================================\n');
  console.log('以上の検証結果から、入力データとの対応関係を判定してください。\n');
  console.log('判定基準：');
  console.log('  A: 入力に直接存在 → Hallucination ではない');
  console.log('  B: 入力から計算可能 → Hallucination ではない');
  console.log('  C: 入力値の丸め → Hallucination ではない');
  console.log('  D: 根拠なし → Hallucination\n');
}

verifyNumbers().catch(err => {
  console.error('検証スクリプト失敗:', err);
  process.exit(1);
});
