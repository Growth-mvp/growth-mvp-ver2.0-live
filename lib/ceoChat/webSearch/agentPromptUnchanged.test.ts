import { createHash } from 'crypto';
import { readFileSync } from 'fs';
import path from 'path';

// 外部検索の追加では lib/agentPrompt.ts を変更しない。意図して変更する場合のみ、この値を更新する
const APPROVED_SHA256 = '7fee209981a84755486cbcccdf69abadceb44a18cf2e6ef45e06cc3478e93613';

it('lib/agentPrompt.ts は外部検索の追加で変更されていない', () => {
  const file = path.resolve(__dirname, '..', '..', 'agentPrompt.ts');
  const hash = createHash('sha256').update(readFileSync(file)).digest('hex');
  expect(hash).toBe(APPROVED_SHA256);
});
