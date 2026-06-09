-- /supabase/migrations/20260610120000_create_org_alignment_shared_topics.sql
-- Create org_alignment_shared_topics table for public sharing of admin insights

create table if not exists public.org_alignment_shared_topics (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  source_insight_id text,
  title text not null,
  summary text,
  status text not null default 'draft', -- draft, published, in_alignment, action_planned, reflected_to_strategy, closed
  priority_score integer,
  importance text, -- 高, 中, 低
  urgency text, -- 高, 中, 低
  impact_scope text,
  affected_departments jsonb, -- array of department names
  recognition_gap jsonb, -- {fieldView, companyView, gapEssence}
  company_axis text,
  session_type text,
  next_actions jsonb, -- array of {title, owner, dueDate, status}
  strategy_reflection jsonb, -- {stage3Status, stage4Status, relatedDepartments, generatedProjects, generatedOkrs}
  visibility text not null default 'company', -- company (all members see), draft (admin only)
  published_by uuid,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint fk_company foreign key (company_id) references public.companies(id),
  constraint valid_status check (status in ('draft', 'published', 'in_alignment', 'action_planned', 'reflected_to_strategy', 'closed')),
  constraint valid_visibility check (visibility in ('company', 'draft'))
);

-- Create indexes for performance
create index idx_org_alignment_shared_topics_company_id on public.org_alignment_shared_topics(company_id);
create index idx_org_alignment_shared_topics_status on public.org_alignment_shared_topics(status);
create index idx_org_alignment_shared_topics_visibility on public.org_alignment_shared_topics(visibility);
create index idx_org_alignment_shared_topics_published_at on public.org_alignment_shared_topics(published_at desc nulls last);

-- Enable RLS
alter table public.org_alignment_shared_topics enable row level security;

-- RLS Policy: Admin can see all (draft and published)
create policy "Admin can see all shared topics"
  on public.org_alignment_shared_topics
  for select
  using (
    exists (
      select 1
      from public.memberships m
      where m.company_id = org_alignment_shared_topics.company_id
        and m.user_id = auth.uid()
        and m.role = 'admin'
    )
  );

-- RLS Policy: Members can see published topics
create policy "Members can see published shared topics"
  on public.org_alignment_shared_topics
  for select
  using (
    status = 'published'
    and visibility = 'company'
    and exists (
      select 1
      from public.memberships m
      where m.company_id = org_alignment_shared_topics.company_id
        and m.user_id = auth.uid()
    )
  );

-- RLS Policy: Only admins can insert
create policy "Only admins can insert shared topics"
  on public.org_alignment_shared_topics
  for insert
  with check (
    exists (
      select 1
      from public.memberships m
      where m.company_id = org_alignment_shared_topics.company_id
        and m.user_id = auth.uid()
        and m.role = 'admin'
    )
  );

-- RLS Policy: Only admins can update
create policy "Only admins can update shared topics"
  on public.org_alignment_shared_topics
  for update
  using (
    exists (
      select 1
      from public.memberships m
      where m.company_id = org_alignment_shared_topics.company_id
        and m.user_id = auth.uid()
        and m.role = 'admin'
    )
  )
  with check (
    exists (
      select 1
      from public.memberships m
      where m.company_id = org_alignment_shared_topics.company_id
        and m.user_id = auth.uid()
        and m.role = 'admin'
    )
  );
