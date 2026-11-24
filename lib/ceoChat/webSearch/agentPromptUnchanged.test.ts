import { createHash } from 'crypto';
import { readFileSync } from 'fs';
import path from 'path';

// 外部検索の追加では lib/agentPrompt.ts を変更しない。意図して変更する場合のみ、この値を更新する
const APPROVED_SHA256 = '5aef2320708e811091e155591252d0b355210361eb8205e9162fd6634da4ff1e';

it('lib/agentPrompt.ts は外部検索の追加で変更されていない', () => {
  const file = path.resolve(__dirname, '..', '..', 'agentPrompt.ts');
  const normalized = readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
  const hash = createHash('sha256').update(normalized).digest('hex');
  expect(hash).toBe(APPROVED_SHA256);
});
