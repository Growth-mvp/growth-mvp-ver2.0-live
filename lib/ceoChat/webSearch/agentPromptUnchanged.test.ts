import { createHash } from 'crypto';
import { readFileSync } from 'fs';
import path from 'path';

// 外部検索の追加では lib/agentPrompt.ts を変更しない。意図して変更する場合のみ、この値を更新する
const APPROVED_SHA256 = '326e2df7be047225f042e1e84d1d8fb8c84a3bcadf052c1e5d4cc306de7e62b4';

it('lib/agentPrompt.ts は外部検索の追加で変更されていない', () => {
  const file = path.resolve(__dirname, '..', '..', 'agentPrompt.ts');
  const hash = createHash('sha256').update(readFileSync(file)).digest('hex');
  expect(hash).toBe(APPROVED_SHA256);
});
