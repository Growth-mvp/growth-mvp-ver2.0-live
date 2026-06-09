-- /supabase/migrations/20260610140000_add_related_case_count_to_shared_topics.sql
-- Add related_case_count column to org_alignment_shared_topics

alter table public.org_alignment_shared_topics
add column if not exists related_case_count integer not null default 0;

-- Create index for querying by case count
create index if not exists idx_org_alignment_shared_topics_related_case_count
  on public.org_alignment_shared_topics(related_case_count desc);
