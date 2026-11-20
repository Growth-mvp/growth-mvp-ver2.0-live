import { createHash } from 'crypto';
import { readFileSync } from 'fs';
import path from 'path';

// 外部検索の追加では lib/agentPrompt.ts を変更しない。意図して変更する場合のみ、この値を更新する
const APPROVED_SHA256 = 'e931230792971f8f50d0505e1baef6188340cb0a1ad3b425d3c24735865ff829';

it('lib/agentPrompt.ts は外部検索の追加で変更されていない', () => {
  const file = path.resolve(__dirname, '..', '..', 'agentPrompt.ts');
  const normalized = readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
  const hash = createHash('sha256').update(normalized).digest('hex');
  expect(hash).toBe(APPROVED_SHA256);
});
