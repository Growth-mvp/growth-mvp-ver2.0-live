-- Create audit_logs table for minimal audit trail
-- Purpose: Track critical operations (invites, members, roles) during PoC

create table if not exists public.audit_logs (
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

-- Enable RLS
alter table public.audit_logs enable row level security;

-- RLS Policies

-- 1. service_role can insert (append-only)
create policy "service_role_insert"
  on public.audit_logs
  for insert
  to authenticated
  with check (false); -- No authenticated user can directly insert

-- Note: service_role bypass is handled at application level
-- Raw SQL INSERT via admin client

-- 2. SELECT: only admin of the company can view
create policy "admin_select"
  on public.audit_logs
  for select
  using (
    company_id is not null
    and exists (
      select 1 from public.company_members
      where company_id = audit_logs.company_id
        and user_id = auth.uid()
        and role = 'admin'
    )
  );

-- 3. UPDATE/DELETE not allowed (append-only)
create policy "no_update"
  on public.audit_logs
  for update
  using (false);

create policy "no_delete"
  on public.audit_logs
  for delete
  using (false);

-- Indexes for performance
create index idx_audit_logs_company_id_created_at
  on public.audit_logs(company_id, created_at desc);

create index idx_audit_logs_actor_user_id_created_at
  on public.audit_logs(actor_user_id, created_at desc);

create index idx_audit_logs_action_created_at
  on public.audit_logs(action, created_at desc);

create index idx_audit_logs_target_type_target_id
  on public.audit_logs(target_type, target_id);
