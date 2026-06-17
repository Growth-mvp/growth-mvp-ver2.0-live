-- Create org_alignment_stage_reflection_candidates table
-- 組織変革ルームからの STAGE3/4 反映候補を管理するテーブル

CREATE TABLE IF NOT EXISTS org_alignment_stage_reflection_candidates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  shared_topic_id uuid NOT NULL REFERENCES org_alignment_shared_topics(id) ON DELETE CASCADE,
  target_stage text NOT NULL CHECK (target_stage IN ('stage3', 'stage4')),
  target_department text,
  candidate_type text NOT NULL CHECK (candidate_type IN ('project', 'okr')),
  title text NOT NULL,
  summary text,
  objective text,
  key_results jsonb DEFAULT '[]'::jsonb,
  owner text,
  due_date text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'rejected')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  accepted_at timestamptz
);

-- インデックスの作成
CREATE INDEX idx_stage_reflection_candidates_company_id
ON org_alignment_stage_reflection_candidates(company_id);

CREATE INDEX idx_stage_reflection_candidates_shared_topic_id
ON org_alignment_stage_reflection_candidates(shared_topic_id);

CREATE INDEX idx_stage_reflection_candidates_target_stage
ON org_alignment_stage_reflection_candidates(target_stage, status);

CREATE INDEX idx_stage_reflection_candidates_company_target
ON org_alignment_stage_reflection_candidates(company_id, target_stage, status);

-- RLS ポリシーの設定
ALTER TABLE org_alignment_stage_reflection_candidates ENABLE ROW LEVEL SECURITY;

-- メンバーは自社のデータのみアクセス可能
CREATE POLICY org_alignment_stage_reflection_candidates_select
  ON org_alignment_stage_reflection_candidates FOR SELECT
  USING (company_id IN (SELECT company_id FROM members WHERE user_id = auth.uid()));

CREATE POLICY org_alignment_stage_reflection_candidates_insert
  ON org_alignment_stage_reflection_candidates FOR INSERT
  WITH CHECK (company_id IN (SELECT company_id FROM members WHERE user_id = auth.uid()));

CREATE POLICY org_alignment_stage_reflection_candidates_update
  ON org_alignment_stage_reflection_candidates FOR UPDATE
  USING (company_id IN (SELECT company_id FROM members WHERE user_id = auth.uid()))
  WITH CHECK (company_id IN (SELECT company_id FROM members WHERE user_id = auth.uid()));

CREATE POLICY org_alignment_stage_reflection_candidates_delete
  ON org_alignment_stage_reflection_candidates FOR DELETE
  USING (company_id IN (SELECT company_id FROM members WHERE user_id = auth.uid()));
