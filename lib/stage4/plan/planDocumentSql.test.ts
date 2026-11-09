import fs from 'fs';
import path from 'path';

const root = path.join(__dirname, '..', '..', '..');
const sqlPath = path.join(root, 'supabase', 'pending', '20261110_stage4_plan_documents.sql');
const sql = fs.readFileSync(sqlPath, 'utf8');
const active = sql
  .split('\n')
  .filter((line) => !line.trim().startsWith('--'))
  .join('\n')
  .toLowerCase();

describe('実行計画書の保存テーブル（未適用のSQL）', () => {
  it('マイグレーションの場所には置かず、未適用の置き場に置く', () => {
    expect(fs.existsSync(path.join(root, 'supabase', 'migrations', path.basename(sqlPath)))).toBe(false);
    expect(sqlPath).toContain(path.join('supabase', 'pending'));
  });

  it('プロジェクト単位の一意キー（会社・戦略・安定ID）と版番号を持つ', () => {
    expect(active).toContain('create table if not exists public.stage4_plan_documents');
    expect(active).toContain('unique (company_id, strategy_id, project_id)');
    expect(active).toContain('version integer not null default 1 check (version >= 1)');
  });

  it('AI草案は jsonb で保存し、利用者の修正と採用の状態を別の列に持つ', () => {
    expect(active).toContain('ai_draft jsonb not null');
    expect(active).toContain("user_edits jsonb not null default '{}'::jsonb");
    expect(active).toContain('adopted boolean not null default false');
  });

  it('行レベルセキュリティを有効にし、閲覧・作成・修正・削除の4つの方針を持つ', () => {
    expect(active).toContain('enable row level security');
    for (const name of ['select', 'insert', 'update', 'delete']) {
      expect(active).toContain(`create policy "stage4_plan_documents_${name}"`);
    }
    expect(active).toContain('cm.user_id = auth.uid()');
  });

  it('削除は manager / admin だけに限る', () => {
    const start = active.indexOf('create policy "stage4_plan_documents_delete"');
    const deletePolicy = active.slice(start, active.indexOf(';', start));
    expect(deletePolicy).toContain("cm.role in ('admin', 'manager')");
    expect(deletePolicy).not.toContain("'member'");
  });

  it('書き込みのたびに、戦略が会社のもので、プロジェクトがその中にあることを確かめる', () => {
    expect(active).toContain('create or replace function public.stage4_plan_documents_guard()');
    expect(active).toContain('s.company_id = new.company_id');
    expect(active).toContain("p ->> 'id' = new.project_id");
    expect(active).toContain('before insert or update on public.stage4_plan_documents');
  });

  it('版番号は1ずつしか進まず、AI草案・キー・作成者は変えられない', () => {
    expect(active).toContain('version must advance by one');
    expect(active).toContain('key and creator are immutable');
    expect(active).toContain('ai draft is immutable');
    expect(active).toContain('new.ai_draft <> old.ai_draft');
  });

  it('既存の表（strategy_data・generated_plans・execution_plans）を変更・削除しない', () => {
    expect(active).not.toMatch(/\b(alter|drop)\s+table\s+(if exists\s+)?public\.(strategy_data|generated_plans|execution_plans|companies|company_members)\b/);
    expect(active).not.toContain('execution_plans');
    expect(active).not.toContain('generated_plans');
  });
});
