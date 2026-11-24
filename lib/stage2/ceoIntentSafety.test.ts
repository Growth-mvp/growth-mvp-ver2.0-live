import { readFileSync } from 'fs';
import { join } from 'path';

/* 経営者の思いの入力支援が、組織変革ルームの保護されたデータを読まないことを確認する。 */
const ROOT = join(__dirname, '..', '..');
const SOURCES = [
  'lib/stage2/ceoIntent.ts',
  'lib/stage2/intentReflectStore.ts',
  'app/api/stage2/consult-intent/route.ts',
  'components/CEOChatStage2Reflect.tsx',
];

describe('経営者の思いの入力支援は、組織変革ルームの保護情報を参照しない', () => {
  it.each(SOURCES)('%s は org_alignment のテーブル・APIを参照しない', (file) => {
    const src = readFileSync(join(ROOT, file), 'utf8');
    expect(src).not.toMatch(/org_alignment|org-alignment/);
  });

  it('入力支援の route は、データベースを直接読まず、所属と戦略の照合だけを使う', () => {
    const src = readFileSync(join(ROOT, 'app/api/stage2/consult-intent/route.ts'), 'utf8');
    expect(src).not.toMatch(/\.from\(/);
    expect(src).toContain('assertCompanyScopeByStrategyId');
    expect(src).toContain("assertMinRole(membership, 'admin')");
  });
});
