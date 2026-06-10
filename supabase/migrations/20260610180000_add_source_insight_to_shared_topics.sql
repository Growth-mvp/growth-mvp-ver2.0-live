-- Add source_insight_id and source_insight_key to org_alignment_shared_topics
-- これにより、どの insight から作成された shared topic かを追跡できる

ALTER TABLE org_alignment_shared_topics
ADD COLUMN source_insight_id uuid,
ADD COLUMN source_insight_key text;

-- インデックスを作成（共有トピックの検索を高速化）
CREATE INDEX idx_shared_topics_source_insight
ON org_alignment_shared_topics(source_insight_id, source_insight_key);

-- 外部キー制約（オプション：破損したデータを防ぐため）
-- ALTER TABLE org_alignment_shared_topics
-- ADD CONSTRAINT fk_source_insight
-- FOREIGN KEY (source_insight_id) REFERENCES org_alignment_insights(id) ON DELETE SET NULL;
