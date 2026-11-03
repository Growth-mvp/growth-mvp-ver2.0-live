// 盲検の比較資料を作る。条件A・Bの順番を質問ごとに無作為にし、対応表は採点者の資料と別の場所に保存する。
// 使い方: node eval/quality/blind-compare.mjs <結果フォルダ>
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { randomInt } from 'crypto';
import path from 'path';

const resultsDir = path.resolve(process.argv[2] ?? 'eval/quality/results-live');
const blindDir = path.join(resultsDir, 'blind');
const keyDir = path.join(resultsDir, 'key-private');
mkdirSync(blindDir, { recursive: true });
mkdirSync(keyDir, { recursive: true });

const key = {};
for (let id = 1; id <= 7; id++) {
  const a = JSON.parse(readFileSync(path.join(resultsDir, `q${id}-A.json`), 'utf8'));
  const b = JSON.parse(readFileSync(path.join(resultsDir, `q${id}-B.json`), 'utf8'));
  const swap = randomInt(2) === 1;
  const first = swap ? b : a;
  const second = swap ? a : b;
  key[id] = { 回答1: swap ? 'B' : 'A', 回答2: swap ? 'A' : 'B' };

  const md = [
    `# 質問 ${id}`,
    '',
    `**質問**: ${a.question}`,
    '',
    '## 回答1',
    '',
    first.answer,
    '',
    '## 回答2',
    '',
    second.answer,
    '',
    '---',
    '採点欄（人が記入する。空欄のまま保持する）:',
    '',
    '| 観点 | 回答1 | 回答2 | 採点者 | メモ |',
    '|---|---|---|---|---|',
    '| 自社固有の理解 | | | | |',
    '| 経営課題の洞察 | | | | |',
    '| 判断の根拠 | | | | |',
    '| 実行可能な提案 | | | | |',
    '| GROWTH SHIFTの基本思想との整合 | | | | |',
    '| 一般論との違い（どちらが自社の状況に踏み込んでいるか） | | | | |',
    '| 情報不足時の断定回避 | | | | |',
    '',
  ].join('\n');
  writeFileSync(path.join(blindDir, `q${id}.md`), md, 'utf8');
}

writeFileSync(path.join(keyDir, 'key.json'), JSON.stringify(key, null, 2), 'utf8');
console.log('blind materials written to', blindDir);
console.log('key written to', keyDir, '(採点者には渡さない)');
