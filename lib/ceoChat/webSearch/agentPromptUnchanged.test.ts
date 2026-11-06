import { createHash } from 'crypto';
import { readFileSync } from 'fs';
import path from 'path';

// 外部検索の追加では lib/agentPrompt.ts を変更しない。意図して変更する場合のみ、この値を更新する
const APPROVED_SHA256 = '4648d1e19d28f4a9a40a9188786ef39c07830411980eae7c8a672e6da29e5706';

it('lib/agentPrompt.ts は外部検索の追加で変更されていない', () => {
  const file = path.resolve(__dirname, '..', '..', 'agentPrompt.ts');
  const hash = createHash('sha256').update(readFileSync(file)).digest('hex');
  expect(hash).toBe(APPROVED_SHA256);
});
