-- Migration: Add final_story_conclusion column for AI-generated strategy conclusion
-- Phase 1: Store AI-generated Conclusion independently from final_story_draft
-- Date: 2026-10-08

-- Add final_story_conclusion JSONB column to strategy_data table
ALTER TABLE strategy_data
ADD COLUMN final_story_conclusion JSONB NULL;

-- Create index for faster queries
CREATE INDEX idx_strategy_data_final_story_conclusion
ON strategy_data USING GIN (final_story_conclusion);

-- Add column comment for clarity
COMMENT ON COLUMN strategy_data.final_story_conclusion IS
'AI-generated strategic story conclusion (Phase 1). JSON structure: { "conclusion": string, "generated_at": timestamp, "source": "ai" | "system" }';

-- RLS policy: Users can only read/write their own company data
ALTER TABLE strategy_data ENABLE ROW LEVEL SECURITY;

CREATE POLICY "strategy_data_conclusion_select" ON strategy_data
  FOR SELECT
  USING (
    auth.uid()::uuid IN (
      SELECT user_id FROM company_members WHERE company_id = strategy_data.company_id
    )
  );

CREATE POLICY "strategy_data_conclusion_update" ON strategy_data
  FOR UPDATE
  USING (
    auth.uid()::uuid IN (
      SELECT user_id FROM company_members WHERE company_id = strategy_data.company_id
    )
  )
  WITH CHECK (
    auth.uid()::uuid IN (
      SELECT user_id FROM company_members WHERE company_id = strategy_data.company_id
    )
  );
