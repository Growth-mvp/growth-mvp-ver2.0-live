#!/usr/bin/env node
/**
 * 旧モデル（gpt-4o / gpt-4o-mini）の使用箇所を監査
 */

import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

// 検索対象のモデル
const LEGACY_MODELS = ['gpt-4o', 'gpt-4o-mini', 'gpt-4.1', 'gpt-4.1-mini'];

// 検索対象ディレクトリ
const SEARCH_DIRS = ['app', 'lib', 'config', 'scripts'];
const EXCLUDE_PATTERNS = ['node_modules', '.next', '.git', 'dist'];

console.log('【旧モデル監査】');
console.log('========================================\n');

// 検索対象ファイルを取得
function getFilesRecursive(dir, fileList = []) {
  const files = fs.readdirSync(dir);
  files.forEach(file => {
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);

    if (EXCLUDE_PATTERNS.some(pattern => filePath.includes(pattern))) {
      return;
    }

    if (stat.isDirectory()) {
      getFilesRecursive(filePath, fileList);
    } else if (/\.(ts|tsx|js|mjs|json)$/.test(file)) {
      fileList.push(filePath);
    }
  });
  return fileList;
}

console.log('【ステップ 1】旧モデル参照を検索...\n');

const findings = [];

SEARCH_DIRS.forEach(dir => {
  if (!fs.existsSync(dir)) return;

  const files = getFilesRecursive(dir);

  files.forEach(file => {
    const content = fs.readFileSync(file, 'utf-8');
    const lines = content.split('\n');

    lines.forEach((line, lineIdx) => {
      LEGACY_MODELS.forEach(model => {
        if (line.includes(model)) {
          // 無視するパターン（コメント等）
          if (line.trim().startsWith('//') || line.trim().startsWith('*')) {
            return;
          }

          findings.push({
            file,
            line: lineIdx + 1,
            model,
            content: line.trim(),
            context: {
              before: lines[Math.max(0, lineIdx - 1)]?.trim(),
              after: lines[Math.min(lines.length - 1, lineIdx + 1)]?.trim(),
            },
          });
        }
      });
    });
  });
});

console.log(`✓ ${findings.length} 件の旧モデル参照を検出\n`);

// グループ化
const grouped = {};
findings.forEach(f => {
  if (!grouped[f.model]) {
    grouped[f.model] = [];
  }
  grouped[f.model].push(f);
});

// 各モデル別に表示
Object.entries(grouped).forEach(([model, items]) => {
  console.log(`\n【${model}】${items.length} 件\n`);

  // ファイル別にグループ化
  const byFile = {};
  items.forEach(item => {
    if (!byFile[item.file]) {
      byFile[item.file] = [];
    }
    byFile[item.file].push(item);
  });

  Object.entries(byFile).forEach(([file, fileItems]) => {
    console.log(`📄 ${file}`);
    fileItems.forEach((item, idx) => {
      console.log(`  ${idx + 1}. Line ${item.line}:`);
      console.log(`     ${item.content.substring(0, 100)}`);
      if (item.content.length > 100) {
        console.log(`     ...`);
      }
    });
    console.log('');
  });
});

// Summary
console.log('\n【サマリー】');
console.log('========================================\n');

const summary = Object.entries(grouped).map(([model, items]) => {
  const uniqueFiles = new Set(items.map(i => i.file)).size;
  return {
    model,
    count: items.length,
    files: uniqueFiles,
    items,
  };
});

console.log('| モデル | 参照数 | ファイル数 |');
console.log('|--------|--------|-----------|');
summary.forEach(s => {
  console.log(`| ${s.model} | ${s.count} | ${s.files} |`);
});

console.log('\n【ファイル一覧】');
console.log('========================================\n');

const uniqueFiles = [...new Set(findings.map(f => f.file))];
uniqueFiles.sort().forEach(file => {
  const fileFindings = findings.filter(f => f.file === file);
  const models = [...new Set(fileFindings.map(f => f.model))];
  console.log(`${file}`);
  console.log(`  モデル: ${models.join(', ')}`);
  console.log(`  参照数: ${fileFindings.length}\n`);
});

// 詳細な分析結果をJSONで保存
const output = {
  timestamp: new Date().toISOString(),
  summary,
  findings,
  uniqueFiles,
};

fs.writeFileSync(
  'model-comparison/legacy-models-audit.json',
  JSON.stringify(output, null, 2)
);

console.log(`\n✓ 詳細結果を保存: model-comparison/legacy-models-audit.json`);
