-- ============================================================
-- 【切り戻しSQL】移行SQL（20261113_stage4_use_draft_migration.sql）を適用後に、関数とトリガーを main の版へ戻す。
-- 既存の計画書・履歴は削除しない。履歴の種類の制約（DRAFT_REPLACED を含む）は、上位互換のため戻さない
-- （戻すと、差し替えで書かれた履歴の行が制約違反になるため）。
-- 1トランザクションで実行する。途中で失敗すれば全体が取り消される。
-- ============================================================
begin;
drop function if exists public.stage4_use_draft(uuid, uuid, text, integer, jsonb, jsonb);
drop trigger if exists stage4_plan_documents_draft_guard_trg on public.stage4_plan_documents;
drop function if exists public.stage4_plan_documents_draft_guard();
drop function if exists public.stage4_plan_documents_owner();

-- ガード（main の版：AI原案の不変性を定義関数で判定）
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
    if new.ai_draft <> old.ai_draft then
      raise exception 'stage4_plan_documents: AI draft is immutable'
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
  if new.status <> 'DRAFT' or new.user_edits is distinct from old.user_edits then
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

-- 操作履歴（追記のみ）。利用者は読めるが、書き換え・削除はできない。書き込みはトリガーだけが行う。

-- 監査（main の版）
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
              jsonb_build_object('reason', 'EDITED', 'adoption', old.adoption));
    end if;
    if old.started then
      insert into public.stage4_plan_document_events
        (document_id, company_id, strategy_id, project_id, action, version, actor_user_id, payload)
      values (new.id, new.company_id, new.strategy_id, new.project_id, 'START_RESET', new.version, v_actor,
              jsonb_build_object('reason', 'EDITED', 'start', old.start_info));
    end if;
    if old.regulatory <> '{}'::jsonb then
      insert into public.stage4_plan_document_events
        (document_id, company_id, strategy_id, project_id, action, version, actor_user_id, payload)
      values (new.id, new.company_id, new.strategy_id, new.project_id, 'REGULATORY_RESET', new.version, v_actor,
              jsonb_build_object('reason', 'EDITED', 'regulatory', old.regulatory));
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

commit;
