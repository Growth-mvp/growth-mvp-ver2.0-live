-- Create org_alignment_insight_sources table for many-to-many relationships
-- between insights and cases
CREATE TABLE org_alignment_insight_sources (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,

  -- 論点の識別
  insight_id uuid NOT NULL REFERENCES org_alignment_insights(id) ON DELETE CASCADE,
  insight_key text NOT NULL,  -- 各論点に付与する安定キー（例: "dept-cooperation-001"）

  -- 元投稿
  case_id uuid NOT NULL REFERENCES org_alignment_cases(id) ON DELETE CASCADE,

  -- メタデータ
  created_at timestamptz DEFAULT now(),

  UNIQUE(insight_id, insight_key, case_id)
);

CREATE INDEX idx_insight_sources_insight ON org_alignment_insight_sources(insight_id, insight_key);
CREATE INDEX idx_insight_sources_case ON org_alignment_insight_sources(case_id);

-- Add announcement columns to org_alignment_shared_topics table
ALTER TABLE org_alignment_shared_topics
ADD COLUMN announcement_text text,
ADD COLUMN announcement_updated_at timestamptz,
ADD COLUMN announcement_updated_by uuid REFERENCES auth.users(id);

-- Create index for announcements query
CREATE INDEX idx_shared_topics_announcement_updated_at ON org_alignment_shared_topics(announcement_updated_at) WHERE announcement_text IS NOT NULL;
