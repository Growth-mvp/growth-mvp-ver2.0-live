-- ============================================================
-- 【未適用】新STAGE4の実行計画書（草案）を、プロジェクト単位で保存する表と、その操作履歴。
-- このファイルは supabase/migrations の外に置いてある。レビューの後、テスト用DBで検証してから適用する。
-- 本番DBへの適用、マイグレーションへの登録は、別の承認の後に行う。
--
-- 目的: 生成した草案・利用者の修正・採用・実行開始を、会社・戦略・プロジェクト（安定ID）で一意に保存する。
-- 理由: generated_plans は会社・戦略・読者層（audience）単位の銀行向け計画書で、プロジェクト単位にできない。
--       strategy_data は STAGE1〜3 のデータで、社員ごとの草案を置くと RLS（manager/admin 制御）と衝突する。
--       execution_plans は STAGE5 の実行計画の既存の名前なので使わない。
-- 状態: GENERATING（生成中）→ DRAFT（草案あり）。生成に失敗したら GENERATION_FAILED（再試行できる）。
--       草案（DRAFT）は、作った後に ai_draft を変えられない。草案からは GENERATING 以外へ戻らない。
--       例外：「この案を使う」の専用関数 stage4_use_draft（所有者として実行）だけが ai_draft を差し替える。
--       差し替え前の原案と修正は、操作履歴（DRAFT_REPLACED）に残る。
-- 競合制御: version（版番号）。更新は「読んだ版番号と同じ時だけ」行い、違えば 0 件になる（競合）。
-- 採用・開始: 利用者の修正内容が変わったら、採用・開始・規制の判断は自動で解除される（トリガー）。修正版は改めて確認する。
-- 操作履歴: stage4_plan_document_events に、トリガーが追記する（利用者からは書き換え・削除できない）。
--       解除・取り消しの履歴には、解除前の採用・開始・規制の記録（採用者・日時・版・採用時の内容）をそのまま残す。
-- ============================================================

create table if not exists public.stage4_plan_documents (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  strategy_id uuid not null references public.strategy_data(id) on delete cascade,
  project_id text not null check (length(btrim(project_id)) > 0),
  status text not null default 'DRAFT' check (status in ('GENERATING', 'DRAFT', 'GENERATION_FAILED')),
  version integer not null default 1 check (version >= 1),
  ai_draft jsonb not null default '{}'::jsonb,
  user_edits jsonb not null default '{}'::jsonb,
  adopted boolean not null default false,
  adoption jsonb,
  regulatory jsonb not null default '{}'::jsonb,
  started boolean not null default false,
  start_info jsonb,
  created_by uuid not null,
  updated_by uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint stage4_plan_documents_project_key unique (company_id, strategy_id, project_id),
  constraint stage4_plan_documents_adoption_chk check (adopted = (adoption is not null)),
  constraint stage4_plan_documents_start_chk check (started = (start_info is not null) and (not started or adopted))
);

create index if not exists stage4_plan_documents_company_idx
  on public.stage4_plan_documents (company_id, strategy_id);

-- 戦略が会社のものであること、プロジェクトがその戦略の中にあることを、書き込みのたびに確かめる。
-- 状態の順序（生成中 → 草案 / 失敗）、版番号、草案の不変、採用と開始の解除を、データベースの側で強制する。
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
create table if not exists public.stage4_plan_document_events (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.stage4_plan_documents(id) on delete cascade,
  company_id uuid not null,
  strategy_id uuid not null,
  project_id text not null,
  action text not null check (action in (
    'GENERATION_STARTED', 'GENERATED', 'GENERATION_FAILED', 'GENERATION_RETRIED',
    'SAVED', 'ADOPTED', 'ADOPTION_CANCELLED', 'ADOPTION_RESET',
    'REGULATORY_RECORDED', 'REGULATORY_RESET', 'STARTED', 'START_CANCELLED', 'START_RESET', 'DRAFT_REPLACED')),
  version integer not null,
  actor_user_id uuid,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists stage4_plan_document_events_doc_idx
  on public.stage4_plan_document_events (document_id, created_at);

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

alter table public.stage4_plan_documents enable row level security;
alter table public.stage4_plan_document_events enable row level security;

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

-- 操作履歴は、同じ会社の所属者だけが読める。書き込みの方針は作らない（トリガーだけが書く）。
create policy "stage4_plan_document_events_select"
  on public.stage4_plan_document_events for select
  using (
    exists (
      select 1 from public.company_members cm
      where cm.company_id = stage4_plan_document_events.company_id
        and cm.user_id = auth.uid()
    )
  );

-- ============================================================
-- プロジェクトIDの付与（IDのないプロジェクトに、計画書の保存時に一度だけ付ける）。
-- strategy_data の一般の更新権限は広げない。この関数が行うのは、対象プロジェクトの id の1項目の書き換えだけ。
-- 版番号（revision）が読んだ時と同じ時だけ書き換える。行をロックして直列化し、他の社員の同時変更は REVISION_CHANGED で拒否する。
-- 既にIDがあれば、書き換えずにそのIDを返す（再読み込み後も同じIDを使う）。
-- ============================================================
create or replace function public.stage4_assign_project_identity(
  p_company_id uuid,
  p_strategy_id uuid,
  p_department_index integer,
  p_project_index integer,
  p_expected_title text,
  p_expected_revision integer,
  p_new_id text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_row public.strategy_data%rowtype;
  v_depts jsonb;
  v_project jsonb;
  v_existing text;
  v_new_revision integer;
begin
  if v_uid is null then
    return jsonb_build_object('status', 'FORBIDDEN');
  end if;
  if not exists (
    select 1 from public.company_members cm
    where cm.company_id = p_company_id
      and cm.user_id = v_uid
      and cm.role in ('admin', 'manager', 'member')
  ) then
    return jsonb_build_object('status', 'FORBIDDEN');
  end if;

  select * into v_row
  from public.strategy_data s
  where s.id = p_strategy_id and s.company_id = p_company_id
  for update;
  if not found then
    return jsonb_build_object('status', 'NOT_FOUND');
  end if;
  if v_row.revision <> p_expected_revision then
    return jsonb_build_object('status', 'REVISION_CHANGED', 'revision', v_row.revision);
  end if;

  v_depts := coalesce(v_row.departments, '[]'::jsonb);
  if jsonb_typeof(v_depts) <> 'array'
     or p_department_index < 0 or p_department_index >= jsonb_array_length(v_depts) then
    return jsonb_build_object('status', 'NOT_FOUND');
  end if;
  if jsonb_typeof(v_depts -> p_department_index -> 'projects') <> 'array'
     or p_project_index < 0
     or p_project_index >= jsonb_array_length(v_depts -> p_department_index -> 'projects') then
    return jsonb_build_object('status', 'NOT_FOUND');
  end if;
  v_project := v_depts -> p_department_index -> 'projects' -> p_project_index;

  if btrim(coalesce(v_project ->> 'title', '')) <> btrim(coalesce(p_expected_title, '')) then
    return jsonb_build_object('status', 'TITLE_CHANGED');
  end if;

  v_existing := nullif(btrim(coalesce(v_project ->> 'id', '')), '');
  if v_existing is not null then
    return jsonb_build_object('status', 'ASSIGNED', 'projectId', v_existing,
                              'revision', v_row.revision, 'alreadyAssigned', true);
  end if;

  if p_new_id is null or btrim(p_new_id) = '' then
    return jsonb_build_object('status', 'INVALID');
  end if;
  if exists (
    select 1
    from jsonb_array_elements(v_depts) d,
         jsonb_array_elements(coalesce(d -> 'projects', '[]'::jsonb)) p
    where p ->> 'id' = p_new_id
  ) then
    return jsonb_build_object('status', 'ID_IN_USE');
  end if;

  update public.strategy_data
  set departments = jsonb_set(
        v_depts,
        array[p_department_index::text, 'projects', p_project_index::text, 'id'],
        to_jsonb(p_new_id),
        true)
  where id = p_strategy_id and company_id = p_company_id;

  select revision into v_new_revision from public.strategy_data where id = p_strategy_id;
  return jsonb_build_object('status', 'ASSIGNED', 'projectId', p_new_id,
                            'revision', v_new_revision, 'alreadyAssigned', false);
end;
$$;

revoke all on function public.stage4_assign_project_identity(uuid, uuid, integer, integer, text, integer, text) from public;
grant execute on function public.stage4_assign_project_identity(uuid, uuid, integer, integer, text, integer, text) to authenticated;

-- ============================================================
-- 「この案を使う」：再生成の案（サーバーで作られ、署名された案）で、草案のAI原案を差し替える専用の操作。
-- 通常の更新では AI原案を変えられない（草案の不変トリガー）。この関数は所有者として実行されるため、差し替えられる。
-- 権限（同じ会社の admin / manager / member）、戦略・プロジェクトの整合、版番号、状態を、保存先の中で確かめる。
-- 開始済みの計画は止める（STAGE5の進捗に関わるため）。採用は解除する。
-- 利用者の修正は、新しい案にある項目（p_user_edits）だけを残す。元の修正に無い値は入れない。
-- 落とした修正・前の原案・採用と開始の記録は、操作履歴（DRAFT_REPLACED）に残る。
-- ============================================================
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

-- ロールバック（適用後に戻す場合）
-- drop function if exists public.stage4_use_draft(uuid, uuid, text, integer, jsonb, jsonb);
-- drop function if exists public.stage4_assign_project_identity(uuid, uuid, integer, integer, text, integer, text);
-- drop table if exists public.stage4_plan_document_events;
-- drop table if exists public.stage4_plan_documents;
-- drop function if exists public.stage4_plan_documents_guard();
-- drop function if exists public.stage4_plan_documents_audit();
