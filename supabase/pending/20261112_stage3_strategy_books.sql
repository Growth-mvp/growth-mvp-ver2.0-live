-- ============================================================
-- 【未適用】新STAGE3の事業・部門戦略書の作業状態（草案・6問後の再生成案・調整候補・対話結果・選択）を、戦略ごとに1行で保存する表。
-- このファイルは supabase/migrations の外に置いてある。レビューの後、テスト用DBで検証してから適用する。
-- 本番DBへの適用、マイグレーションへの登録は、別の承認の後に行う。
--
-- 目的: 未確定の案を、STAGE4〜6が読む正式データ（strategy_data.departments）と分けて保存し、リロード後も復元する。
-- 理由: strategy_data に列を足すと、保存のたびに revision が上がり、既存の自動保存と衝突する。
--       departments に草案を入れると、未確定の案が STAGE4〜6 の正式データに混ざる。
--       stage4_plan_documents と同じく、草案は専用の表に置く。
-- 競合制御: version（版番号）。更新は「読んだ版番号と同じ時だけ」行い、違えば 0 件になる（競合）。
-- 権限: 読み取りは所属企業のメンバー（authenticated）のみ。書き込みは API（service role）だけが行う。
--       anon には与えない。Supabase の既定権限では新しい表に全権限が付くため、ここで明示的に絞る。
-- revision: 適用前に trg_strategy_data_bump_revision が存在することを確認する（無ければ何も作らずに止まる）。
--           トリガーはこのファイルで作成・変更しない。追加は別手順（scripts/sql/release/revision-trigger）で行う。
-- 適用は1つのトランザクション。途中で失敗すれば何も残らない。
-- ============================================================

begin;

do $$
begin
  if not exists (
    select 1
    from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname = 'strategy_data'
      and t.tgname = 'trg_strategy_data_bump_revision'
      and t.tgenabled <> 'D'
  ) then
    raise exception 'revision_trigger_missing: strategy_data の revision トリガーが無いため適用しません';
  end if;
end $$;

create table if not exists public.stage3_strategy_books (
  strategy_id uuid primary key references public.strategy_data(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  version integer not null default 1 check (version >= 1),
  state jsonb not null default '{}'::jsonb check (jsonb_typeof(state) = 'object'),
  updated_by uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists stage3_strategy_books_company_idx
  on public.stage3_strategy_books (company_id);

alter table public.stage3_strategy_books enable row level security;

drop policy if exists stage3_strategy_books_select on public.stage3_strategy_books;
create policy stage3_strategy_books_select on public.stage3_strategy_books
  for select
  to authenticated
  using (
    company_id in (
      select cm.company_id from public.company_members cm where cm.user_id = auth.uid()
    )
  );

-- 直接の書き込み（insert / update / delete）の許可は作らない。書き込みは API（service role）だけが行う。
revoke all on table public.stage3_strategy_books from anon, authenticated;
grant select on table public.stage3_strategy_books to authenticated;
grant all on table public.stage3_strategy_books to service_role;

-- 作業状態の会社と戦略の会社が一致することを、DB側でも確かめる（API の検証に加えた防御）。
create or replace function public.stage3_strategy_books_check_scope()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if not exists (
    select 1 from public.strategy_data s
    where s.id = new.strategy_id and s.company_id = new.company_id
  ) then
    raise exception 'strategy_mismatch' using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke all on function public.stage3_strategy_books_check_scope() from public, anon, authenticated;

drop trigger if exists stage3_strategy_books_check_scope on public.stage3_strategy_books;
create trigger stage3_strategy_books_check_scope
  before insert or update of strategy_id, company_id on public.stage3_strategy_books
  for each row execute function public.stage3_strategy_books_check_scope();

-- ============================================================
-- 確定を1つのトランザクションで行う関数。
-- 正式な部門データ（strategy_data.departments）と、作業状態の確定（stage3_strategy_books）を同時に更新する。
-- どちらかが失敗すると、関数全体が巻き戻る（途中まで書かれた状態は残らない）。
-- 安全のため：呼び出せるのは service_role だけ。会社・権限・revision・版は、関数の中で確かめる。
-- 中身（どの変更を入れるか）はサーバーが検証してから渡す。関数はその検証結果を書くだけにする。
-- ============================================================
create or replace function public.stage3_confirm_strategy_book(
  p_company_id uuid,
  p_strategy_id uuid,
  p_actor_user_id uuid,
  p_expected_revision integer,
  p_expected_version integer,
  p_departments jsonb,
  p_state jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_role text;
  v_revision integer;
  v_version integer;
  v_new_revision integer;
begin
  select cm.role into v_role
  from public.company_members cm
  where cm.company_id = p_company_id and cm.user_id = p_actor_user_id;
  if v_role is null or v_role not in ('admin', 'manager') then
    raise exception 'insufficient_role' using errcode = '42501';
  end if;

  if p_state ->> 'status' is distinct from 'confirmed' then
    raise exception 'invalid_state' using errcode = '22023';
  end if;
  if jsonb_typeof(p_departments) is distinct from 'array' then
    raise exception 'invalid_departments' using errcode = '22023';
  end if;

  select s.revision into v_revision
  from public.strategy_data s
  where s.id = p_strategy_id and s.company_id = p_company_id
  for update;
  if not found then
    raise exception 'strategy_mismatch' using errcode = '42501';
  end if;
  if v_revision <> p_expected_revision then
    raise exception 'revision_changed' using errcode = '40001';
  end if;

  select b.version into v_version
  from public.stage3_strategy_books b
  where b.strategy_id = p_strategy_id and b.company_id = p_company_id
  for update;
  if not found or v_version <> p_expected_version then
    raise exception 'version_conflict' using errcode = '40001';
  end if;

  -- trg_strategy_data_bump_revision が revision を上げる（適用前の確認で存在を保証）
  update public.strategy_data
  set departments = p_departments
  where id = p_strategy_id and company_id = p_company_id;

  select s.revision into v_new_revision
  from public.strategy_data s
  where s.id = p_strategy_id;

  update public.stage3_strategy_books
  set state = p_state,
      version = v_version + 1,
      updated_by = p_actor_user_id,
      updated_at = now()
  where strategy_id = p_strategy_id and company_id = p_company_id;

  return jsonb_build_object('revision', v_new_revision, 'version', v_version + 1);
end;
$$;

revoke all on function public.stage3_confirm_strategy_book(uuid, uuid, uuid, integer, integer, jsonb, jsonb)
  from public, anon, authenticated;
grant execute on function public.stage3_confirm_strategy_book(uuid, uuid, uuid, integer, integer, jsonb, jsonb)
  to service_role;

commit;
