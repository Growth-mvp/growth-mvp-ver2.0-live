-- Add source_alignment_insight_id column to org_alignment_shared_topics
-- This enables filtering to show only topics from the latest insight batch

alter table public.org_alignment_shared_topics
add column if not exists source_alignment_insight_id uuid,
add constraint fk_org_alignment_shared_topics_insight
  foreign key (source_alignment_insight_id)
  references public.org_alignment_insights(id) on delete cascade;

-- Create index for efficient filtering
create index if not exists idx_org_alignment_shared_topics_source_insight
  on public.org_alignment_shared_topics(source_alignment_insight_id);

-- Backfill source_alignment_insight_id where possible
-- For topics that have source_insight_id in format "uuid-index", extract the uuid
-- Note: This is a best-effort approach; manual review may be needed
update public.org_alignment_shared_topics
set source_alignment_insight_id = (
  select id from public.org_alignment_insights
  where org_alignment_insights.company_id = org_alignment_shared_topics.company_id
    and org_alignment_insights.id::text = split_part(source_insight_id, '-', 1)
  limit 1
)
where source_insight_id is not null
  and source_alignment_insight_id is null;
