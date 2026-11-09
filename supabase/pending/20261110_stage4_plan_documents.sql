-- ============================================================
-- 【未適用】新STAGE4の実行計画書（草案）を、プロジェクト単位で保存するテーブル。
-- このファイルは supabase/migrations の外に置いてある。レビューの後、テスト用DBで検証してから適用する。
-- 本番DBへの適用、マイグレーションへの登録は、別の承認の後に行う。
--
-- 目的: 社員が作成・修正した草案を、会社・戦略・プロジェクト（安定ID）で一意に保存する。
-- 理由: generated_plans は会社・戦略・読者層（audience）単位の銀行向け計画書で、プロジェクト単位にできない。
--       strategy_data は STAGE1〜3 のデータで、社員ごとの草案を置くと RLS（manager/admin 制御）と衝突する。
--       execution_plans は STAGE5 の実行計画の既存の名前なので使わない。
-- 競合制御: version（版番号）。更新は「読んだ版番号と同じ時だけ」行い、違えば 0 件になる（競合）。
-- ============================================================

create table if not exists public.stage4_plan_documents (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  strategy_id uuid not null references public.strategy_data(id) on delete cascade,
  project_id text not null check (length(btrim(project_id)) > 0),
  version integer not null default 1 check (version >= 1),
  ai_draft jsonb not null,
  user_edits jsonb not null default '{}'::jsonb,
  adopted boolean not null default false,
  created_by uuid not null,
  updated_by uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint stage4_plan_documents_project_key unique (company_id, strategy_id, project_id)
);

create index if not exists stage4_plan_documents_company_idx
  on public.stage4_plan_documents (company_id, strategy_id);

-- 戦略が会社のものであること、プロジェクトがその戦略の中にあることを、書き込みのたびに確かめる。
-- AI草案（ai_draft）と作成者は、作った後に変えられないようにする。版番号は 1 ずつだけ増やす。
create or replace function public.stage4_plan_documents_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    if not exists (
      select 1
      from public.strategy_data s,
           jsonb_array_elements(coalesce(s.departments, '[]'::jsonb)) d,
           jsonb_array_elements(coalesce(d -> 'projects', '[]'::jsonb)) p
      where s.id = new.strategy_id
        and s.company_id = new.company_id
        and p ->> 'id' = new.project_id
    ) then
      raise exception 'stage4_plan_documents: project is not in the strategy of the company'
        using errcode = '42501';
    end if;
    new.version := 1;
    return new;
  end if;

  if new.company_id <> old.company_id
     or new.strategy_id <> old.strategy_id
     or new.project_id <> old.project_id
     or new.ai_draft <> old.ai_draft
     or new.created_by <> old.created_by
     or new.created_at <> old.created_at then
    raise exception 'stage4_plan_documents: key, AI draft and creator are immutable'
      using errcode = '42501';
  end if;
  if new.version <> old.version + 1 then
    raise exception 'stage4_plan_documents: version must advance by one'
      using errcode = '40001';
  end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists stage4_plan_documents_guard_trg on public.stage4_plan_documents;
create trigger stage4_plan_documents_guard_trg
  before insert or update on public.stage4_plan_documents
  for each row execute function public.stage4_plan_documents_guard();

alter table public.stage4_plan_documents enable row level security;

-- 同じ会社の所属者（member / manager / admin）は、閲覧・作成・修正ができる（草案の共同編集）。
-- 削除は manager / admin だけ。他社の行は、どの操作でも見えない・書けない。
create policy "stage4_plan_documents_select"
  on public.stage4_plan_documents for select
  using (
    exists (
      select 1 from public.company_members cm
      where cm.company_id = stage4_plan_documents.company_id
        and cm.user_id = auth.uid()
    )
  );

create policy "stage4_plan_documents_insert"
  on public.stage4_plan_documents for insert
  with check (
    created_by = auth.uid()
    and updated_by = auth.uid()
    and exists (
      select 1 from public.company_members cm
      where cm.company_id = stage4_plan_documents.company_id
        and cm.user_id = auth.uid()
        and cm.role in ('admin', 'manager', 'member')
    )
  );

create policy "stage4_plan_documents_update"
  on public.stage4_plan_documents for update
  using (
    exists (
      select 1 from public.company_members cm
      where cm.company_id = stage4_plan_documents.company_id
        and cm.user_id = auth.uid()
        and cm.role in ('admin', 'manager', 'member')
    )
  )
  with check (
    updated_by = auth.uid()
    and exists (
      select 1 from public.company_members cm
      where cm.company_id = stage4_plan_documents.company_id
        and cm.user_id = auth.uid()
        and cm.role in ('admin', 'manager', 'member')
    )
  );

create policy "stage4_plan_documents_delete"
  on public.stage4_plan_documents for delete
  using (
    exists (
      select 1 from public.company_members cm
      where cm.company_id = stage4_plan_documents.company_id
        and cm.user_id = auth.uid()
        and cm.role in ('admin', 'manager')
    )
  );

-- ロールバック（適用後に戻す場合）
-- drop table if exists public.stage4_plan_documents;
-- drop function if exists public.stage4_plan_documents_guard();
