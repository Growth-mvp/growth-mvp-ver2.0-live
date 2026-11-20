import { createHash } from 'crypto';
import { readFileSync } from 'fs';
import path from 'path';

// 外部検索の追加では lib/agentPrompt.ts を変更しない。意図して変更する場合のみ、この値を更新する
const APPROVED_SHA256 = '392ed42d460417c6106930fa28e510340c5eb43de8f38fba8104dd0d9477c352';

it('lib/agentPrompt.ts は外部検索の追加で変更されていない', () => {
  const file = path.resolve(__dirname, '..', '..', 'agentPrompt.ts');
  const normalized = readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
  const hash = createHash('sha256').update(normalized).digest('hex');
  expect(hash).toBe(APPROVED_SHA256);
});
