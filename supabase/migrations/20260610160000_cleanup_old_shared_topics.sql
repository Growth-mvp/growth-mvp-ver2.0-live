-- DEVELOPMENT CLEANUP: Remove old shared topics from previous insight batches
-- This migration is DEVELOPMENT ONLY and should NOT be run in production
-- In production, use archived flags or status management instead of deletion

-- Get the latest insight ID for each company and delete shared_topics from older insights
delete from public.org_alignment_shared_topics
where source_alignment_insight_id is not null
  and source_alignment_insight_id != (
    -- For each company, get the latest insight ID
    select id from public.org_alignment_insights oi_latest
    where oi_latest.company_id = org_alignment_shared_topics.company_id
    order by oi_latest.generated_at desc
    limit 1
  );

-- For shared_topics without source_alignment_insight_id set yet (legacy),
-- delete all except the latest created per company
delete from public.org_alignment_shared_topics
where source_alignment_insight_id is null
  and id not in (
    select max(id) as id
    from public.org_alignment_shared_topics
    where source_alignment_insight_id is null
    group by company_id
  );
