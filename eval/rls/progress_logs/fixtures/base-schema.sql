-- 隔離検証用の基準スキーマ（評価専用。本番DBには適用しない）。
-- progress_logs / company_members の列・制約は supabase/schema_remote_20260708.sql に合わせている。
-- okrs は RLS 判定に使う列だけに縮約し、progress_logs の RLS は本番と同じ4本のポリシーを再現する。

create schema if not exists auth;
create table auth.users (id uuid primary key);
create or replace function auth.uid() returns uuid
  language sql stable
as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;

do $$ begin create role anon nologin; exception when duplicate_object then null; end $$;
do $$ begin create role authenticated nologin; exception when duplicate_object then null; end $$;
do $$ begin create role service_role nologin bypassrls; exception when duplicate_object then null; end $$;
grant usage on schema public, auth to anon, authenticated, service_role;

create table public.companies (
  id uuid primary key default gen_random_uuid(),
  name text,
  created_by uuid
);

create table public.company_members (
  company_id uuid not null references public.companies(id),
  user_id uuid not null references auth.users(id),
  role text not null default 'member',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  department_id uuid,
  constraint company_members_role_check check (role = any (array['admin'::text, 'manager'::text, 'member'::text])),
  primary key (company_id, user_id)
);

create table public.okrs (
  id uuid primary key,
  company_id uuid not null references public.companies(id),
  strategy_id uuid,
  department_id text not null default '',
  project_id text not null default '',
  objective text not null default '',
  is_deleted boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.progress_logs (
  id uuid not null default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  progress_text text,
  created_at timestamptz default now(),
  department text,
  rating integer,
  rating_comment text,
  advice text,
  help_request text,
  company_id uuid not null references public.companies(id) on delete restrict,
  updated_at timestamptz not null default now(),
  content text,
  score numeric,
  status text,
  okr_id uuid references public.okrs(id) on delete set null,
  constraint progress_logs_pkey primary key (id)
);

create or replace function public.set_updated_at() returns trigger
  language plpgsql
as $$ begin new.updated_at = now(); return new; end $$;
create trigger trg_progress_logs_updated_at before update on public.progress_logs
  for each row execute function public.set_updated_at();

alter table public.progress_logs enable row level security;

-- 本番（schema_remote_20260708.sql L1900-1922）と同じ現行ポリシー
create policy progress_logs_delete on public.progress_logs for delete to authenticated
  using (exists (select 1 from public.company_members m where m.user_id = auth.uid() and m.company_id = progress_logs.company_id));
create policy progress_logs_insert on public.progress_logs for insert to authenticated
  with check (exists (select 1 from public.company_members m where m.user_id = auth.uid() and m.company_id = progress_logs.company_id));
create policy progress_logs_select on public.progress_logs for select to authenticated
  using (exists (select 1 from public.company_members m where m.user_id = auth.uid() and m.company_id = progress_logs.company_id));
create policy progress_logs_update on public.progress_logs for update to authenticated
  using (exists (select 1 from public.company_members m where m.user_id = auth.uid() and m.company_id = progress_logs.company_id))
  with check (exists (select 1 from public.company_members m where m.user_id = auth.uid() and m.company_id = progress_logs.company_id));

grant select, insert, update, delete on public.progress_logs to authenticated;
grant all on public.progress_logs to service_role;
grant select on public.company_members to authenticated;
grant all on public.company_members, public.companies, public.okrs to service_role;
grant select on public.okrs to authenticated;

-- 監査テーブル（supabase/migrations/20260628_create_audit_logs_table.sql と同じ列・ポリシー）
create table public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid null references public.companies(id) on delete cascade,
  actor_user_id uuid null references auth.users(id) on delete set null,
  action text not null,
  target_type text null,
  target_id text null,
  before jsonb null,
  after jsonb null,
  metadata jsonb null,
  ip text null,
  user_agent text null,
  created_at timestamptz not null default now()
);
alter table public.audit_logs enable row level security;
create policy "service_role_insert" on public.audit_logs for insert to authenticated with check (false);
create policy "admin_select" on public.audit_logs for select
  using (company_id is not null and exists (select 1 from public.company_members where company_id = audit_logs.company_id and user_id = auth.uid() and role = 'admin'));
create policy "no_update" on public.audit_logs for update using (false);
create policy "no_delete" on public.audit_logs for delete using (false);
grant select on public.audit_logs to authenticated;
grant all on public.audit_logs to service_role;
