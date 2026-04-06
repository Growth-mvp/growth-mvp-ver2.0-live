# progress_logs テーブル分析レポート

## 実行日時
2026-04-05

## タスク概要
1. ファイルシステムで progress_logs テーブルの CREATE TABLE 定義を探す
2. 見つからない場合、実際のコード使用箇所からカラム定義を推測
3. 不整合を特定する

---

## 1. CREATE TABLE 定義の探索結果

### 検索対象
- `/supabase/migrations/*.sql` - ❌ progress_logs の定義なし
- `/supabase/sql/*.sql` - ❌ 該当ディレクトリ存在なし
- `/docs/phase2a/PHASE_2A_SUPABASE_MIGRATION.sql` - ⚠️ 部分的な定義のみ
- その他の seed.sql - ❌ 見つからず

### 見つかった内容
`/docs/phase2a/PHASE_2A_SUPABASE_MIGRATION.sql` の行 146-148:
```sql
-- progress_logs に okr_id カラムを追加（段階的に mandatory 化）
ALTER TABLE progress_logs
ADD COLUMN IF NOT EXISTS okr_id UUID REFERENCES okrs(id) ON DELETE SET NULL;
```

**結論**: progress_logs テーブルは既に Supabase に存在し、ALTER で okr_id が追加されている。
初期定義は見つからない（Supabase Dashboard で作成された可能性、または移行前の別システムから導入）。

---

## 2. コードから推定される progress_logs テーブルスキーマ

### INSERT 時に使用されるカラム
**ファイル**: `/utils/supabase/ancillary.ts` 行 150-184
**関数**: `saveProgressLog()`

```typescript
const rows = [{
  user_id: userId,                          // ← UUID
  okr_id: okrId,                            // ← UUID（ただし nullable）
  company_id: companyId,                    // ← UUID（必須）
  progress_text: log.progressText ?? '',    // ← TEXT
  rating: typeof log.rating === 'number' ? log.rating : null,  // ← NUMERIC (nullable)
  rating_comment: log.ratingComment ?? '',  // ← TEXT
  advice: log.advice ?? '',                 // ← TEXT
  help_request: log.helpRequest ?? '',      // ← TEXT
  department: log.department ?? '',         // ← TEXT
  created_at: now,                          // ← TIMESTAMP WITH TIME ZONE
}];
```

**ProgressLogInput 型定義** (`ancillary.ts` 行 140-147):
```typescript
type ProgressLogInput = {
  progressText?: string;
  rating?: number;
  ratingComment?: string;
  advice?: string;
  helpRequest?: string;
  department?: string;
};
```

### SELECT 時に使用されるカラム
**ファイル**: `/app/api/stage5/execution-summary/route.ts` 行 163-168

```typescript
const { data: progressLogs, error: logsError } = await admin
  .from('progress_logs')
  .select('okr_id, content, score, status, created_at')
  .eq('company_id', companyId)
  .gte('created_at', sevenDaysAgo)
  .order('created_at', { ascending: false });
```

---

## 3. 推定される実テーブルスキーマ

統合された情報から推定:

```sql
CREATE TABLE progress_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),     -- 多くのテーブルで一般的
  
  -- Foreign Keys
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  okr_id UUID REFERENCES okrs(id) ON DELETE SET NULL,  -- Phase 2A で追加
  
  -- Content: INSERT 時に使用
  progress_text TEXT,                   -- progressText
  rating NUMERIC,                       -- rating (例: 0-5, -1-10など)
  rating_comment TEXT,                  -- ratingComment
  advice TEXT,                          -- advice
  help_request TEXT,                    -- helpRequest
  department TEXT,                      -- department
  
  -- Content: SELECT 時に期待される（INSERT では使用されない）
  content TEXT,                         -- 本来のログ内容（__META__ 埋め込み対応）
  score NUMERIC,                        -- 実行度スコア？（rating との関連不明）
  status TEXT,                          -- ステータス（'pending', 'completed' など？）
  
  -- Audit
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  
  -- Indexes
  INDEX idx_progress_logs_company_id (company_id),
  INDEX idx_progress_logs_okr_id (okr_id) WHERE okr_id IS NOT NULL,
  INDEX idx_progress_logs_user_id (user_id),
  INDEX idx_progress_logs_created_at (created_at)
);
```

---

## 4. 不整合の特定

### 🔴 重大な不整合

#### **【問題1】INSERT と SELECT で使用されるカラムの乖離**

| カラム | INSERT使用 | SELECT期待 | 状態 |
|--------|-----------|-----------|------|
| user_id | ✅ | ❓ | INSERT では指定、SELECT では選択されない |
| okr_id | ✅ | ✅ | 一致 ✓ |
| company_id | ✅ | ✅ | 一致（WHERE句） ✓ |
| progress_text | ✅ | ❌ | INSERT でのみ、SELECT では content を期待 |
| rating | ✅ | ❌ | INSERT でのみ、SELECT では score を期待 |
| rating_comment | ✅ | ❌ | INSERT でのみ、SELECT では期待なし |
| advice | ✅ | ❌ | INSERT でのみ |
| help_request | ✅ | ❌ | INSERT でのみ |
| department | ✅ | ❌ | INSERT でのみ |
| content | ❌ | ✅ | SELECT でのみ期待（メタデータ埋め込み対応） |
| score | ❌ | ✅ | SELECT でのみ期待 |
| status | ❌ | ✅ | SELECT でのみ期待 |

#### **【問題2】progress_text vs content**

- **INSERT**: `progress_text` に値が保存される
- **SELECT**: `content` を期待している
- **現象**: SELECT では content が NULL で、progress_text が読まれていない可能性
- **根拠**: `/utils/execution/metadata.ts` でメタデータが `content` フィールドに埋め込まれることを前提としている

#### **【問題3】rating vs score**

- **INSERT**: `rating` カラムに数値が保存される
- **SELECT**: `score` カラムを期待している
- **現象**: 実行度スコア計算時に score が NULL で失敗する可能性
- **根拠**: `/app/api/stage5/execution-summary/route.ts` の `isProgressLogCheckin()` 関数で `log.score` をチェック

#### **【問題4】status カラムの定義なし**

- **SELECT**: `status` フィールドを期待
- **INSERT**: status 値を設定していない
- **現象**: SELECT 結果で status が常に NULL

---

## 5. 推奨される対応方針

### 案A: テーブル構造を統一（推奨）
progress_logs テーブルを再設計し、以下の優先順位で統合:

```sql
CREATE TABLE progress_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  company_id UUID NOT NULL,
  okr_id UUID,
  
  -- 統一カラム（前方互換性維持）
  content TEXT,                    -- 統一された本体（__META__埋め込み対応）
  score NUMERIC,                   -- 実行度スコア（0-10など）
  status TEXT DEFAULT 'active',    -- ステータス
  
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  
  FOREIGN KEY (user_id) REFERENCES auth.users(id),
  FOREIGN KEY (company_id) REFERENCES companies(id),
  FOREIGN KEY (okr_id) REFERENCES okrs(id) ON DELETE SET NULL
);
```

アプリケーション側で、saveProgressLog() を以下のように変更:
```typescript
const rows = [{
  user_id: userId,
  okr_id: okrId,
  company_id: companyId,
  content: embedMetadata(metadata, log.progressText),  // メタデータ埋め込み
  score: log.rating ?? null,                            // rating → score にマッピング
  status: 'active',
  created_at: now,
}];
```

### 案B: カラム追加（移行期）
既存テーブルに新しいカラムを追加:
```sql
ALTER TABLE progress_logs ADD COLUMN content TEXT;
ALTER TABLE progress_logs ADD COLUMN score NUMERIC;
ALTER TABLE progress_logs ADD COLUMN status TEXT DEFAULT 'active';
```

既存の progress_text と rating から content/score にデータを移行:
```sql
UPDATE progress_logs SET
  content = progress_text,
  score = CAST(rating AS NUMERIC)
WHERE content IS NULL;
```

---

## 6. 追加リスク（監査レポートより）

**ファイル**: `/AUDIT_REPORT_20260324.md`

### A-7: OKR データ削除時の progress_logs orphan 問題

**リスク**: OKR 削除時に progress_logs.okr_id が orphaned (参照先存在なし)
- 現在は okr_id カラムに `ON DELETE SET NULL` があるため、OKR 削除時に okr_id = NULL になる
- しかし、progress_logs 読み込み時に orphan 検証がない
- STAGE6 で projectTargetImpacts 計算時に参照エラーの可能性

**推奨対応**:
1. progress_logs load 時に okr_id が存在することを validate
2. delete cascade 一貫性を DB レベルで確保
3. 読込時に orphan cleanup を追加

---

## 7. テーブル定義の最終推奨

実際のデータベーススキーマを Supabase SQL Editor で以下を実行して確認してください:

```sql
-- テーブル構造の確認
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_name = 'progress_logs'
ORDER BY ordinal_position;

-- インデックスの確認
SELECT indexname, indexdef
FROM pg_indexes
WHERE tablename = 'progress_logs';

-- 外部キーの確認
SELECT constraint_name, column_name, foreign_table_name, foreign_column_name
FROM information_schema.table_constraints tc
JOIN information_schema.key_column_usage kcu
  ON tc.constraint_name = kcu.constraint_name
WHERE tc.table_name = 'progress_logs' AND tc.constraint_type = 'FOREIGN KEY';
```

---

## 付録: 関連ファイル一覧

| ファイル | 用途 |
|---------|------|
| `/utils/supabase/ancillary.ts` | saveProgressLog() 実装 |
| `/app/api/stage5/execution-summary/route.ts` | progress_logs SELECT 実装 |
| `/utils/execution/metadata.ts` | メタデータ埋め込み/解析 |
| `/utils/stage6/execution.ts` | progress_logs マッチング |
| `/app/execution/page.tsx` | 実行ログ UI |
| `/docs/phase2a/PHASE_2A_SUPABASE_MIGRATION.sql` | OKR 関連 ALTER |

