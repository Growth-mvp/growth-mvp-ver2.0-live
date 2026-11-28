import { createHash } from 'crypto';
import { readFileSync } from 'fs';
import path from 'path';

// 外部検索の追加では lib/agentPrompt.ts を変更しない。意図して変更する場合のみ、この値を更新する
const APPROVED_SHA256 = '9207c397e5d2f6e9800dcfcaa089c2aeff951906b0af0f8b7be1b9c84304ef0c';

it('lib/agentPrompt.ts は外部検索の追加で変更されていない', () => {
  const file = path.resolve(__dirname, '..', '..', 'agentPrompt.ts');
  const normalized = readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
  const hash = createHash('sha256').update(normalized).digest('hex');
  expect(hash).toBe(APPROVED_SHA256);
});
