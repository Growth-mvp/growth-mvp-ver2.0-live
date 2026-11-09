-- 検証用の土台（ローカルのPostgreSQL＝PGlite上でのみ使う）。本番のスキーマではない。
-- 本番の定義のうち、今回の検証に必要な部分だけを写している（列の型・制約・更新トリガー・行単位の権限）。
-- 写していないもの：本番の他の表・他の方針。本番での確認は、適用前に別途必要（報告に記載）。

create role authenticated nologin;
create role anon nologin;

create schema if not exists auth;
create or replace function auth.uid() returns uuid
language sql stable
as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
grant usage on schema auth to authenticated;
grant execute on function auth.uid() to authenticated;

grant usage on schema public to authenticated;
-- Supabase と同じく、public の表は既定で authenticated に権限を与える（行の制限は行単位の権限で行う）
alter default privileges in schema public grant select, insert, update, delete on tables to authenticated;

create table companies (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

create table company_members (
  company_id uuid not null references companies(id) on delete cascade,
  user_id uuid not null,
  role text not null default 'member',
  created_at timestamptz not null default now(),
  primary key (company_id, user_id),
  constraint company_members_role_check check (role in ('admin', 'manager', 'member'))
);

create table strategy_data (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  departments jsonb not null default '[]'::jsonb,
  revision integer not null default 0
);

-- 本番と同じ：戦略が更新されるたびに revision を 1 増やす（scripts/sql/release/revision-trigger/02_add_trigger.sql の写し）
create or replace function public.bump_strategy_data_revision() returns trigger
language plpgsql
set search_path to 'public'
as $$
begin
  new.revision := coalesce(old.revision, 0) + 1;
  return new;
end;
$$;

create trigger trg_strategy_data_bump_revision
  before update on public.strategy_data
  for each row execute function public.bump_strategy_data_revision();

alter table company_members enable row level security;
create policy company_members_select_own on company_members for select to authenticated
  using (user_id = auth.uid());

alter table strategy_data enable row level security;
create policy strategy_select on strategy_data for select to authenticated
  using (exists (select 1 from company_members cm where cm.company_id = strategy_data.company_id and cm.user_id = auth.uid()));
-- 戦略の一般の更新は manager / admin だけ（20260628 の方針の写し。member は戦略を直接書き換えられない）
create policy strategy_update on strategy_data for update to authenticated
  using (exists (select 1 from company_members cm where cm.company_id = strategy_data.company_id and cm.user_id = auth.uid() and cm.role in ('admin', 'manager')))
  with check (exists (select 1 from company_members cm where cm.company_id = strategy_data.company_id and cm.user_id = auth.uid() and cm.role in ('admin', 'manager')));
