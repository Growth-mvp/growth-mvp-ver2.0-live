import { readFileSync } from 'fs';
import { join } from 'path';

/* 入力案の作成に使う経路が、組織変革ルームの保護されたデータを読まないことを確認する。 */
const ROOT = join(__dirname, '..', '..');
const SOURCES = [
  'lib/stage5/consultDraft.ts',
  'lib/stage5/consultDraftPrompt.ts',
  'app/api/stage5/consult-draft/route.ts',
  'lib/ceoChat/executionScope.ts',
  'components/CEOChatStage5Reflect.tsx',
];

describe('入力案の作成は、組織変革ルームの保護情報を参照しない', () => {
  it.each(SOURCES)('%s は org_alignment のテーブル・APIを参照しない', (file) => {
    const src = readFileSync(join(ROOT, file), 'utf8');
    expect(src).not.toMatch(/org_alignment|org-alignment/);
  });

  it('入力案の作成が読むテーブルは、案件の登録情報・計画・実行の記録に限られる', () => {
    const src = readFileSync(join(ROOT, 'lib/ceoChat/executionScope.ts'), 'utf8');
    const tables = [...src.matchAll(/\.from\('([a-z0-9_]+)'\)/g)].map((m) => m[1]);
    expect([...new Set(tables)].sort()).toEqual(['okrs', 'progress_logs', 'stage4_plan_documents', 'strategy_data']);
  });
});
