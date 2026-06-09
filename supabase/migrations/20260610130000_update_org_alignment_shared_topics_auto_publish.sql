-- /supabase/migrations/20260610130000_update_org_alignment_shared_topics_auto_publish.sql
-- Update org_alignment_shared_topics to support auto-publish philosophy

-- Add published_at if not exists (may already exist from previous migration)
alter table public.org_alignment_shared_topics
alter column status set default 'published';

-- Drop old visibility column if it exists
alter table public.org_alignment_shared_topics
drop column if exists visibility;

-- Add columns for edit tracking if they don't exist
alter table public.org_alignment_shared_topics
add column if not exists edited_at timestamptz,
add column if not exists edited_by uuid;

-- Update constraint to include new statuses
alter table public.org_alignment_shared_topics
drop constraint if exists valid_status;

alter table public.org_alignment_shared_topics
add constraint valid_status check (status in ('published', 'in_alignment', 'action_planned', 'reflected', 'closed', 'on_hold', 'hidden'));

-- Update RLS policies for new approach
drop policy if exists "Members can see published shared topics" on public.org_alignment_shared_topics;

-- New policy: Members can see public topics (published, in_alignment, action_planned, reflected, closed)
create policy "Members can see public shared topics"
  on public.org_alignment_shared_topics
  for select
  using (
    status in ('published', 'in_alignment', 'action_planned', 'reflected', 'closed')
    and exists (
      select 1
      from public.memberships m
      where m.company_id = org_alignment_shared_topics.company_id
        and m.user_id = auth.uid()
    )
  );

-- Ensure index on status for performance
create index if not exists idx_org_alignment_shared_topics_status_public
  on public.org_alignment_shared_topics(status)
  where status in ('published', 'in_alignment', 'action_planned', 'reflected', 'closed');
