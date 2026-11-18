-- ============================================================
-- 【未適用・本番には適用しない】施策の除外・中止と、計画の採用・開始の競合を、DBで直列化する
--
-- 対象の変更:
--   (1) strategy_data.departments の更新で、施策が「計画から外す(EXCLUDED)」または「中止(STOPPED)」に
--       新たに変わるとき、その施策の計画（stage4_plan_documents）を確認する。
--       除外: 承認済み・採用済み・実行開始済みなら拒否。中止: 実行開始済みでなければ拒否。
--   (2) stage4_plan_documents の採用・開始（adopted/started が false→true）のとき、
--       施策が除外・中止済みなら拒否する。
--
-- 直列化の仕組み:
--   (1) は戦略の行を FOR UPDATE で取ってから計画を読む。
--   (2) は同じ戦略の行を FOR SHARE で取ってから施策の状態を読む。
--   同じ行のロックで両者が並ぶため、先に終わった側の結果を、後から来た側が必ず読む。
--   計画の行はどちらも読むだけで、ロックの取り合いによる循環待ちは起きない。
--
-- 影響範囲:
--   既存の行・列・既存の状態は変えない（関数とトリガーの追加のみ）。
--   状態が「新たに」除外・中止へ変わるときと、採用・開始のときだけ確認する。
--   既に除外・中止の施策を、その状態のまま保存する操作は拒否しない。
--
-- 拒否時のエラー: message に 'stage4_lifecycle_conflict:<理由>' を含む（P0001）。
--   app/lib/server/stage3DepartmentWrite.ts が 409 の <理由の小文字> に変換する。
-- 切り戻し: 20261118_stage4_lifecycle_adoption_lock_rollback.sql
-- 適用前に、本番の関数・トリガーの有無を確認すること（同名のものがある場合は作り直す前に内容を保存する）。
-- ============================================================
begin;

-- 1) 除外・中止の確認（strategy_data.departments の更新時）
create or replace function public.stage4_guard_project_lifecycle()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row record;
  v_adopted boolean;
  v_started boolean;
  v_locked boolean := false;
begin
  if jsonb_typeof(new.departments) is distinct from 'array' then
    return new;
  end if;

  for v_row in
    with old_states as (
      select p.value ->> 'id' as pid, p.value -> 'lifecycle' ->> 'status' as status
      from jsonb_array_elements(case when jsonb_typeof(old.departments) = 'array' then old.departments else '[]'::jsonb end) as d(value)
      cross join lateral jsonb_array_elements(
        case when jsonb_typeof(d.value -> 'projects') = 'array' then d.value -> 'projects' else '[]'::jsonb end
      ) as p(value)
    ), new_states as (
      select p.value ->> 'id' as pid,
             p.value -> 'lifecycle' ->> 'status' as status,
             (p.value ->> 'planStatus') = 'approved' as approved
      from jsonb_array_elements(new.departments) as d(value)
      cross join lateral jsonb_array_elements(
        case when jsonb_typeof(d.value -> 'projects') = 'array' then d.value -> 'projects' else '[]'::jsonb end
      ) as p(value)
      where p.value -> 'lifecycle' ->> 'status' in ('EXCLUDED', 'STOPPED')
    )
    select n.pid, n.status, n.approved
    from new_states n
    where not exists (
      select 1 from old_states o
      where o.pid is not distinct from n.pid and o.status is not distinct from n.status
    )
  loop
    if not v_locked then
      perform 1 from public.strategy_data s where s.id = new.id for update;
      v_locked := true;
    end if;

    select bool_or(pd.adopted), bool_or(pd.started)
      into v_adopted, v_started
    from public.stage4_plan_documents pd
    where pd.company_id = new.company_id
      and pd.strategy_id = new.id
      and pd.project_id = v_row.pid;
    v_adopted := coalesce(v_adopted, false);
    v_started := coalesce(v_started, false);

    if v_row.status = 'EXCLUDED' then
      if v_row.approved then
        raise exception 'stage4_lifecycle_conflict:APPROVED' using errcode = 'P0001';
      end if;
      if v_adopted or v_started then
        raise exception 'stage4_lifecycle_conflict:EXECUTING' using errcode = 'P0001';
      end if;
    elsif v_row.status = 'STOPPED' then
      if not v_started then
        raise exception 'stage4_lifecycle_conflict:NOT_STARTED' using errcode = 'P0001';
      end if;
    end if;
  end loop;

  return new;
end;
$$;

revoke all on function public.stage4_guard_project_lifecycle() from public;

drop trigger if exists trg_strategy_data_stage4_lifecycle_guard on public.strategy_data;
create trigger trg_strategy_data_stage4_lifecycle_guard
  before update of departments on public.strategy_data
  for each row execute function public.stage4_guard_project_lifecycle();

-- 2) 採用・開始の確認（stage4_plan_documents の採用・開始の時だけ）
-- 名前の順で、既存の stage4_plan_documents_guard_trg の後に動く（解除後の値を見る）
create or replace function public.stage4_guard_plan_adoption_lifecycle()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_departments jsonb;
  v_excluded boolean;
  v_stopped boolean;
begin
  if not ((new.adopted and not old.adopted) or (new.started and not old.started)) then
    return new;
  end if;

  select s.departments into v_departments
  from public.strategy_data s
  where s.id = new.strategy_id
    and s.company_id = new.company_id
  for share;
  if not found then
    raise exception 'stage4_plan_documents: strategy not found' using errcode = '42501';
  end if;
  if jsonb_typeof(v_departments) is distinct from 'array' then
    return new;
  end if;

  select bool_or(p.value -> 'lifecycle' ->> 'status' = 'EXCLUDED'),
         bool_or(p.value -> 'lifecycle' ->> 'status' = 'STOPPED')
    into v_excluded, v_stopped
  from jsonb_array_elements(v_departments) as d(value)
  cross join lateral jsonb_array_elements(
    case when jsonb_typeof(d.value -> 'projects') = 'array' then d.value -> 'projects' else '[]'::jsonb end
  ) as p(value)
  where p.value ->> 'id' = new.project_id;

  if coalesce(v_excluded, false) or coalesce(v_stopped, false) then
    raise exception 'stage4_lifecycle_conflict:OUT_OF_PLAN' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

revoke all on function public.stage4_guard_plan_adoption_lifecycle() from public;

drop trigger if exists stage4_plan_documents_lifecycle_trg on public.stage4_plan_documents;
create trigger stage4_plan_documents_lifecycle_trg
  before update on public.stage4_plan_documents
  for each row execute function public.stage4_guard_plan_adoption_lifecycle();

commit;
