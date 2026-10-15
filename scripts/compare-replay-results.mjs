#!/usr/bin/env node
/**
 * Compare Replay Results Script
 *
 * Capture、gpt-4o Replay、gpt-6-luna Replay の結果を比較してレポート生成
 *
 * 使用方法:
 *   node scripts/compare-replay-results.mjs \
 *     --capture-file model-comparison/captures/draft-*.json \
 *     --gpt4o-file model-comparison/results/replay-gpt4o-draft.json \
 *     --gpt6luna-file model-comparison/results/replay-gpt6luna-draft.json \
 *     --output model-comparison/results/comparison-draft.md \
 *     --stage stage2 \
 *     --pass draft
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

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
 * Token 使用量を抽出
 */
function extractTokens(results) {
  const tokens = results
    .filter(r => r.success)
    .map(r => ({
      seq: r.sequenceNumber,
      prompt: r.response.usage?.prompt_tokens || 0,
      completion: r.response.usage?.completion_tokens || 0,
      total: (r.response.usage?.prompt_tokens || 0) + (r.response.usage?.completion_tokens || 0),
    }));

  return tokens;
}

/**
 * メイン処理
 */
async function main() {
  const opts = parseArgs();

  const captureFile = opts['capture-file'];
  const gpt4oFile = opts['gpt4o-file'];
  const gpt6lunaFile = opts['gpt6luna-file'];
  const outputFile = opts['output'];
  const stage = opts['stage'] || 'stage2';
  const pass = opts['pass'] || 'draft';

  if (!captureFile || !gpt4oFile || !gpt6lunaFile || !outputFile) {
    console.error('Usage: node compare-replay-results.mjs --capture-file <path> --gpt4o-file <path> --gpt6luna-file <path> --output <path> [--stage stage2] [--pass draft]');
    process.exit(1);
  }

  console.log(`\n📊 Compare Replay Results`);
  console.log(`  Capture: ${captureFile}`);
  console.log(`  GPT-4o: ${gpt4oFile}`);
  console.log(`  GPT-6-Luna: ${gpt6lunaFile}`);
  console.log(`  Output: ${outputFile}`);
  console.log('');

  try {
    // ファイルを読み込み
    console.log('📖 Loading files...');
    const captureContent = await fs.readFile(captureFile, 'utf-8');
    const capture = JSON.parse(captureContent);

    const gpt4oContent = await fs.readFile(gpt4oFile, 'utf-8');
    const gpt4o = JSON.parse(gpt4oContent);

    const gpt6lunaContent = await fs.readFile(gpt6lunaFile, 'utf-8');
    const gpt6luna = JSON.parse(gpt6lunaContent);

    console.log('  ✅ All files loaded');
    console.log('');

    // Token 情報を抽出
    const captureTokens = extractTokens(capture.records);
    const gpt4oTokens = extractTokens(gpt4o.results);
    const gpt6lunaTokens = extractTokens(gpt6luna.results);

    // レポート生成
    const report = `# ${stage.toUpperCase()} ${pass.charAt(0).toUpperCase() + pass.slice(1)} 生成の比較レポート

**生成日**: ${new Date().toISOString()}

---

## 📋 実行環境

| 項目 | Capture | GPT-4o Replay | GPT-6-Luna Replay |
|------|---------|---------------|-------------------|
| **モデル** | ${capture.records[0]?.params?.model || 'N/A'} | ${gpt4o.replayModel} | ${gpt6luna.replayModel} |
| **Stage** | ${capture.stage} | ${gpt4o.stage} | ${gpt6luna.stage} |
| **Pass** | ${capture.generationPass} | ${gpt4o.generationPass} | ${gpt6luna.generationPass} |
| **実行時刻** | ${capture.records[0]?.timestamp || 'N/A'} | ${gpt4o.executedAt} | ${gpt6luna.executedAt} |

---

## 📊 トークン使用量の比較

### Capture（オリジナル）
\`\`\`
${captureTokens.map(t => `Seq ${t.seq}: Prompt=${t.prompt}, Completion=${t.completion}, Total=${t.total}`).join('\n')}
\`\`\`

**合計**:
- Prompt Tokens: ${captureTokens.reduce((s, t) => s + t.prompt, 0)}
- Completion Tokens: ${captureTokens.reduce((s, t) => s + t.completion, 0)}
- Total: ${captureTokens.reduce((s, t) => s + t.total, 0)}

### GPT-4o Replay
\`\`\`
${gpt4oTokens.map(t => \`Seq \${t.seq}: Prompt=\${t.prompt}, Completion=\${t.completion}, Total=\${t.total}\`).join('\n')}
\`\`\`

**合計**:
- Prompt Tokens: ${gpt4oTokens.reduce((s, t) => s + t.prompt, 0)}
- Completion Tokens: ${gpt4oTokens.reduce((s, t) => s + t.completion, 0)}
- Total: ${gpt4oTokens.reduce((s, t) => s + t.total, 0)}

### GPT-6-Luna Replay
\`\`\`
${gpt6lunaTokens.map(t => \`Seq \${t.seq}: Prompt=\${t.prompt}, Completion=\${t.completion}, Total=\${t.total}\`).join('\n')}
\`\`\`

**合計**:
- Prompt Tokens: ${gpt6lunaTokens.reduce((s, t) => s + t.prompt, 0)}
- Completion Tokens: ${gpt6lunaTokens.reduce((s, t) => s + t.completion, 0)}
- Total: ${gpt6lunaTokens.reduce((s, t) => s + t.total, 0)}

---

## 📈 差異分析

### Token 効率性
\`\`\`
GPT-4o Replay vs Capture:
  Token 差分: ${gpt4oTokens.reduce((s, t) => s + t.total, 0) - captureTokens.reduce((s, t) => s + t.total, 0)}

GPT-6-Luna Replay vs Capture:
  Token 差分: ${gpt6lunaTokens.reduce((s, t) => s + t.total, 0) - captureTokens.reduce((s, t) => s + t.total, 0)}
\`\`\`

### 実行ステータス
\`\`\`
Capture:
  成功: ${gpt4o.successCount} / ${gpt4o.results.length}
  失敗: ${gpt4o.failureCount}

GPT-4o Replay:
  成功: ${gpt4o.successCount} / ${gpt4o.results.length}
  失敗: ${gpt4o.failureCount}

GPT-6-Luna Replay:
  成功: ${gpt6luna.successCount} / ${gpt6luna.results.length}
  失敗: ${gpt6luna.failureCount}
\`\`\`

---

## 📝 出力品質の詳細比較

### Capture データ
- **Case ID**: ${capture.caseId}
- **Records**: ${capture.records.length}個
- **詳細**: model-comparison/captures/ ディレクトリを参照

### GPT-4o Replay 出力
- **詳細**: model-comparison/results/replay-gpt4o-${pass}.json を参照

### GPT-6-Luna Replay 出力
- **詳細**: model-comparison/results/replay-gpt6luna-${pass}.json を参照

---

## 🔍 結果確認チェック

このレポートは、以下の検査用に生成されました：

□ Token 使用量の比較
□ 実行ステータスの確認
□ Capture と Replay の一貫性確認

**詳細な品質比較は、生成結果の全文を手動で確認してください。**

---

**生成日**: ${new Date().toISOString()}
`;

    // ファイルに保存
    console.log('💾 Generating report...');
    const outputDir = path.dirname(outputFile);
    await fs.mkdir(outputDir, { recursive: true });

    await fs.writeFile(outputFile, report, 'utf-8');

    console.log(`  ✅ Report saved to: ${outputFile}`);
    console.log('');

    // コンソールにも出力
    console.log(report);

  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

main();
