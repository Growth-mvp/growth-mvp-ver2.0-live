-- TASK 1: Create company_invites table for app-based invitation system
-- This replaces Supabase Auth invites with app-controlled token-based invitations

-- Create company_invites table
create table if not exists public.company_invites (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  email text not null,
  role text not null default 'member' check (role in ('admin', 'manager', 'member')),
  token_hash text not null unique,
  expires_at timestamptz not null,
  accepted_at timestamptz null,
  accepted_by uuid null references auth.users(id) on delete set null,
  created_by uuid not null references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),

  -- Composite unique to prevent duplicate invites (one active invite per email per company)
  constraint one_active_invite_per_email unique (company_id, email) where accepted_at is null
);

-- Indexes for common queries
create index idx_company_invites_company_id on public.company_invites(company_id);
create index idx_company_invites_token_hash on public.company_invites(token_hash);
create index idx_company_invites_email on public.company_invites(email);
create index idx_company_invites_created_by on public.company_invites(created_by);
create index idx_company_invites_accepted_by on public.company_invites(accepted_by);

-- RLS: Enable row level security
alter table public.company_invites enable row level security;

-- RLS Policies: Only admin users of the company can manage invites
-- 1. Admin can SELECT their company's invites
create policy "admin_select_company_invites"
  on public.company_invites
  for select
  using (
    exists (
      select 1 from public.company_members cm
      where cm.company_id = company_invites.company_id
        and cm.user_id = auth.uid()
        and cm.role = 'admin'
    )
  );

-- 2. Admin can INSERT new invites to their company
create policy "admin_insert_company_invites"
  on public.company_invites
  for insert
  with check (
    exists (
      select 1 from public.company_members cm
      where cm.company_id = company_id
        and cm.user_id = auth.uid()
        and cm.role = 'admin'
    )
  );

-- 3. Admin can UPDATE invites (to cancel, etc)
create policy "admin_update_company_invites"
  on public.company_invites
  for update
  using (
    exists (
      select 1 from public.company_members cm
      where cm.company_id = company_invites.company_id
        and cm.user_id = auth.uid()
        and cm.role = 'admin'
    )
  )
  with check (
    exists (
      select 1 from public.company_members cm
      where cm.company_id = company_invites.company_id
        and cm.user_id = auth.uid()
        and cm.role = 'admin'
    )
  );

-- 4. Admin can DELETE invites
create policy "admin_delete_company_invites"
  on public.company_invites
  for delete
  using (
    exists (
      select 1 from public.company_members cm
      where cm.company_id = company_invites.company_id
        and cm.user_id = auth.uid()
        and cm.role = 'admin'
    )
  );

-- Note: API layer (not client) will handle token verification without RLS
-- The accept API will use Service Role to:
-- 1. Hash and verify the token
-- 2. Check expiry, email match, acceptance status
-- 3. Upsert company_members
-- 4. Update accepted_at and accepted_by
