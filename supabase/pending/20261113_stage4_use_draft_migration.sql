-- ============================================================
-- 【移行SQL】本番（main の SQL が適用済み）→ 新STAGE4
--   差し替え専用関数 stage4_use_draft、不変性の判定（所有者以外は ai_draft を変えられない）、
--   履歴の種類 DRAFT_REPLACED の追加。
-- ブランチ supabase/pending/20261110_stage4_plan_documents.sql から、差分だけを抜き出したもの。
-- 表と既存データには触れない（関数の置き換え・トリガーの作り直し・履歴の制約の差し替えのみ）。
-- 1トランザクションで実行する。途中で失敗すれば全体が取り消され、適用前の状態のまま残る。
-- 適用前に、本番の現在の関数定義を保存しておくこと（戻し用）。
-- ============================================================
begin;

-- 1) 履歴の種類に DRAFT_REPLACED を追加する（既存の履歴の行は変わらない）
do $$
declare c record;
begin
  for c in select conname from pg_constraint
           where conrelid = 'public.stage4_plan_document_events'::regclass and contype = 'c'
             and pg_get_constraintdef(oid) like '%REGULATORY_RESET%' loop
    execute format('alter table public.stage4_plan_document_events drop constraint %I', c.conname);
  end loop;
end
$$;
alter table public.stage4_plan_document_events
  add constraint stage4_plan_document_events_action_check check (action in (
    'GENERATION_STARTED', 'GENERATED', 'GENERATION_FAILED', 'GENERATION_RETRIED',
    'SAVED', 'ADOPTED', 'ADOPTION_CANCELLED', 'ADOPTION_RESET',
    'REGULATORY_RECORDED', 'REGULATORY_RESET', 'STARTED', 'START_CANCELLED', 'START_RESET', 'DRAFT_REPLACED'));

-- 2) ガード・所有者の補助関数・不変性のトリガー
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
    if new.status = 'DRAFT' and new.ai_draft = '{}'::jsonb then
      raise exception 'stage4_plan_documents: a draft needs its AI content'
        using errcode = '23514';
    end if;
    new.version := 1;
    new.adopted := false;
    new.adoption := null;
    new.started := false;
    new.start_info := null;
    return new;
  end if;

  if new.company_id <> old.company_id
     or new.strategy_id <> old.strategy_id
     or new.project_id <> old.project_id
     or new.created_by <> old.created_by
     or new.created_at <> old.created_at then
    raise exception 'stage4_plan_documents: key and creator are immutable'
      using errcode = '42501';
  end if;

  if old.status = 'DRAFT' then
    if new.status <> 'DRAFT' then
      raise exception 'stage4_plan_documents: a draft cannot return to generation'
        using errcode = '42501';
    end if;
  elsif old.status = 'GENERATING' then
    if new.status not in ('DRAFT', 'GENERATION_FAILED') then
      raise exception 'stage4_plan_documents: invalid generation transition'
        using errcode = '42501';
    end if;
  elsif old.status = 'GENERATION_FAILED' then
    if new.status <> 'GENERATING' then
      raise exception 'stage4_plan_documents: a failed generation can only be retried'
        using errcode = '42501';
    end if;
  end if;

  if new.status is distinct from old.status then
    if new.version <> old.version then
      raise exception 'stage4_plan_documents: a status change keeps the version'
        using errcode = '40001';
    end if;
  elsif new.version <> old.version + 1 then
    raise exception 'stage4_plan_documents: version must advance by one'
      using errcode = '40001';
  end if;

  -- 利用者の修正が変わったら、採用・実行開始・規制の判断を解除する（修正版は改めて確認する）。解除前の記録は履歴に残る
  if new.status <> 'DRAFT' or new.user_edits is distinct from old.user_edits or (old.status = 'DRAFT' and new.ai_draft is distinct from old.ai_draft) then
    new.adopted := false;
    new.adoption := null;
    new.started := false;
    new.start_info := null;
    new.regulatory := '{}'::jsonb;
  end if;

  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists stage4_plan_documents_guard_trg on public.stage4_plan_documents;
create trigger stage4_plan_documents_guard_trg
  before insert or update on public.stage4_plan_documents
  for each row execute function public.stage4_plan_documents_guard();

-- 草案（DRAFT）の ai_draft は、テーブルの所有者（stage4_use_draft の実行者）以外は変えられない。
-- SECURITY INVOKER にするのは、呼び出し元の役割で判定するため（SECURITY DEFINER では所有者になり判定できない）。
-- 印（set_config）には頼らない。利用者は所有者の役割へ切り替えられず、設定値で役割は変わらないので、迂回できない。
-- テーブルの所有者の名前だけを返す（所有者の権限で読む。利用者はカタログを直接読めないため）
create or replace function public.stage4_plan_documents_owner()
returns name
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select pg_get_userbyid(c.relowner) from pg_class c where c.oid = 'public.stage4_plan_documents'::regclass
$$;

revoke all on function public.stage4_plan_documents_owner() from public;
grant execute on function public.stage4_plan_documents_owner() to authenticated;

create or replace function public.stage4_plan_documents_draft_guard()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if old.status = 'DRAFT'
     and new.ai_draft <> old.ai_draft
     and current_user <> public.stage4_plan_documents_owner() then
    raise exception 'stage4_plan_documents: AI draft is immutable'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists stage4_plan_documents_draft_guard_trg on public.stage4_plan_documents;
create trigger stage4_plan_documents_draft_guard_trg
  before update on public.stage4_plan_documents
  for each row execute function public.stage4_plan_documents_draft_guard();

-- 操作履歴（追記のみ）。利用者は読めるが、書き換え・削除はできない。書き込みはトリガーだけが行う。

-- 3) 監査（履歴）関数
create or replace function public.stage4_plan_documents_audit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := coalesce(auth.uid(), new.updated_by);
begin
  if tg_op = 'INSERT' then
    insert into public.stage4_plan_document_events
      (document_id, company_id, strategy_id, project_id, action, version, actor_user_id)
    values (new.id, new.company_id, new.strategy_id, new.project_id,
            case when new.status = 'GENERATING' then 'GENERATION_STARTED' else 'GENERATED' end,
            new.version, v_actor);
    return new;
  end if;

  if new.status is distinct from old.status then
    insert into public.stage4_plan_document_events
      (document_id, company_id, strategy_id, project_id, action, version, actor_user_id)
    values (new.id, new.company_id, new.strategy_id, new.project_id,
            case
              when old.status = 'GENERATING' and new.status = 'DRAFT' then 'GENERATED'
              when old.status = 'GENERATING' and new.status = 'GENERATION_FAILED' then 'GENERATION_FAILED'
              else 'GENERATION_RETRIED'
            end,
            new.version, v_actor);
  end if;

  -- 解除・取り消しの履歴には、解除前の記録（採用者・日時・版・採用時の内容、開始者・日時・版、規制の判断）を残す
  if new.user_edits is distinct from old.user_edits then
    insert into public.stage4_plan_document_events
      (document_id, company_id, strategy_id, project_id, action, version, actor_user_id, payload)
    values (new.id, new.company_id, new.strategy_id, new.project_id, 'SAVED', new.version, v_actor,
            jsonb_build_object('items', (select count(*) from jsonb_object_keys(new.user_edits))));
    if old.adopted then
      insert into public.stage4_plan_document_events
        (document_id, company_id, strategy_id, project_id, action, version, actor_user_id, payload)
      values (new.id, new.company_id, new.strategy_id, new.project_id, 'ADOPTION_RESET', new.version, v_actor,
              jsonb_build_object('reason', case when old.status = 'DRAFT' and new.ai_draft is distinct from old.ai_draft then 'DRAFT_REPLACED' else 'EDITED' end,'adoption', old.adoption));
    end if;
    if old.started then
      insert into public.stage4_plan_document_events
        (document_id, company_id, strategy_id, project_id, action, version, actor_user_id, payload)
      values (new.id, new.company_id, new.strategy_id, new.project_id, 'START_RESET', new.version, v_actor,
              jsonb_build_object('reason', case when old.status = 'DRAFT' and new.ai_draft is distinct from old.ai_draft then 'DRAFT_REPLACED' else 'EDITED' end,'start', old.start_info));
    end if;
    if old.regulatory <> '{}'::jsonb then
      insert into public.stage4_plan_document_events
        (document_id, company_id, strategy_id, project_id, action, version, actor_user_id, payload)
      values (new.id, new.company_id, new.strategy_id, new.project_id, 'REGULATORY_RESET', new.version, v_actor,
              jsonb_build_object('reason', case when old.status = 'DRAFT' and new.ai_draft is distinct from old.ai_draft then 'DRAFT_REPLACED' else 'EDITED' end,'regulatory', old.regulatory));
    end if;
  else
    if old.adopted and not new.adopted then
      insert into public.stage4_plan_document_events
        (document_id, company_id, strategy_id, project_id, action, version, actor_user_id, payload)
      values (new.id, new.company_id, new.strategy_id, new.project_id, 'ADOPTION_CANCELLED', new.version, v_actor,
              jsonb_build_object('adoption', old.adoption));
    end if;
    if old.started and not new.started then
      insert into public.stage4_plan_document_events
        (document_id, company_id, strategy_id, project_id, action, version, actor_user_id, payload)
      values (new.id, new.company_id, new.strategy_id, new.project_id, 'START_CANCELLED', new.version, v_actor,
              jsonb_build_object('start', old.start_info));
    end if;
    if old.regulatory is distinct from new.regulatory and new.regulatory <> '{}'::jsonb then
      insert into public.stage4_plan_document_events
        (document_id, company_id, strategy_id, project_id, action, version, actor_user_id, payload)
      values (new.id, new.company_id, new.strategy_id, new.project_id, 'REGULATORY_RECORDED', new.version, v_actor,
              jsonb_build_object('regulatory', new.regulatory));
    end if;
  end if;

  -- 草案の差し替え（stage4_use_draft だけが行う）。差し替え前の原案・修正・落とした修正・採用と開始の記録を残す
  if old.status = 'DRAFT' and new.ai_draft is distinct from old.ai_draft then
    insert into public.stage4_plan_document_events
      (document_id, company_id, strategy_id, project_id, action, version, actor_user_id, payload)
    values (new.id, new.company_id, new.strategy_id, new.project_id, 'DRAFT_REPLACED', new.version, v_actor,
            jsonb_build_object(
              'previousVersion', old.version,
              'previousDraft', old.ai_draft,
              'previousUserEdits', old.user_edits,
              'keptUserEdits', new.user_edits,
              'droppedUserEdits', (select coalesce(jsonb_object_agg(e.key, e.value), '{}'::jsonb)
                                   from jsonb_each(old.user_edits) e
                                   where not (new.user_edits ? e.key)),
              'previousAdoption', old.adoption,
              'previousStart', old.start_info,
              'previousRegulatory', old.regulatory));
  end if;

  if not old.adopted and new.adopted then
    insert into public.stage4_plan_document_events
      (document_id, company_id, strategy_id, project_id, action, version, actor_user_id, payload)
    values (new.id, new.company_id, new.strategy_id, new.project_id, 'ADOPTED', new.version, v_actor,
            jsonb_build_object('adoptedVersion', new.adoption -> 'version', 'by', new.adoption -> 'by',
                               'at', new.adoption -> 'at', 'edits', new.adoption -> 'edits'));
  end if;

  if not old.started and new.started then
    insert into public.stage4_plan_document_events
      (document_id, company_id, strategy_id, project_id, action, version, actor_user_id, payload)
    values (new.id, new.company_id, new.strategy_id, new.project_id, 'STARTED', new.version, v_actor,
            jsonb_build_object('startedVersion', new.start_info -> 'version', 'by', new.start_info -> 'by',
                               'at', new.start_info -> 'at'));
  end if;

  return new;
end;
$$;

drop trigger if exists stage4_plan_documents_audit_trg on public.stage4_plan_documents;
create trigger stage4_plan_documents_audit_trg
  after insert or update on public.stage4_plan_documents
  for each row execute function public.stage4_plan_documents_audit();

-- 4) 差し替えの専用関数
create or replace function public.stage4_use_draft(
  p_company_id uuid,
  p_strategy_id uuid,
  p_project_id text,
  p_expected_version integer,
  p_ai_draft jsonb,
  p_user_edits jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_row public.stage4_plan_documents%rowtype;
  v_updated public.stage4_plan_documents%rowtype;
begin
  if v_uid is null then
    return jsonb_build_object('status', 'DENIED');
  end if;
  if not exists (
    select 1 from public.company_members cm
    where cm.company_id = p_company_id
      and cm.user_id = v_uid
      and cm.role in ('admin', 'manager', 'member')
  ) then
    return jsonb_build_object('status', 'DENIED');
  end if;

  if p_ai_draft is null or jsonb_typeof(p_ai_draft) <> 'object' or p_ai_draft = '{}'::jsonb
     or p_user_edits is null or jsonb_typeof(p_user_edits) <> 'object' then
    return jsonb_build_object('status', 'INVALID');
  end if;

  if not exists (
    select 1
    from public.strategy_data s,
         jsonb_array_elements(coalesce(s.departments, '[]'::jsonb)) d,
         jsonb_array_elements(coalesce(d -> 'projects', '[]'::jsonb)) p
    where s.id = p_strategy_id
      and s.company_id = p_company_id
      and p ->> 'id' = p_project_id
  ) then
    return jsonb_build_object('status', 'NOT_FOUND');
  end if;

  select * into v_row
  from public.stage4_plan_documents d
  where d.company_id = p_company_id
    and d.strategy_id = p_strategy_id
    and d.project_id = p_project_id
  for update;
  if not found then
    return jsonb_build_object('status', 'NOT_FOUND');
  end if;
  if v_row.status <> 'DRAFT' or v_row.started then
    return jsonb_build_object('status', 'NOT_READY');
  end if;
  if v_row.version <> p_expected_version then
    return jsonb_build_object('status', 'CONFLICT', 'version', v_row.version);
  end if;

  if exists (
    select 1
    from jsonb_each(p_user_edits) n
    where not (v_row.user_edits ? n.key)
       or v_row.user_edits -> n.key <> n.value
  ) then
    return jsonb_build_object('status', 'INVALID');
  end if;

  update public.stage4_plan_documents d
  set ai_draft = p_ai_draft,
      user_edits = p_user_edits,
      version = d.version + 1,
      updated_by = v_uid
  where d.id = v_row.id
    and d.version = p_expected_version
  returning * into v_updated;
  if not found then
    return jsonb_build_object('status', 'CONFLICT');
  end if;
  return jsonb_build_object('status', 'REPLACED', 'row', to_jsonb(v_updated));
end;
$$;

revoke all on function public.stage4_use_draft(uuid, uuid, text, integer, jsonb, jsonb) from public;
grant execute on function public.stage4_use_draft(uuid, uuid, text, integer, jsonb, jsonb) to authenticated;

commit;
