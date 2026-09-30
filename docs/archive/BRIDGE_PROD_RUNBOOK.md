# BRIDGE 本番導入 Runbook

**対象**: STAGE5→STAGE6 Bridge Stabilization 本番環境への導入
**目的**: F-5 回帰テスト完了後、段階的・安全に本番導入するための運用手順
**実施者**: DevOps/SRE チーム + アプリケーション開発チーム
**所要時間**: 約 2-3 時間（計画～確認完了まで）

---

## 目次

1. [導入前チェック](#導入前チェック)
2. [導入前準備](#導入前準備)
3. [導入手順](#導入手順)
4. [導入後の確認](#導入後の確認)
5. [障害時の切り戻し](#障害時の切り戻し)
6. [監視とロギング](#監視とロギング)
7. [FAQ & トラブルシューティング](#faq--トラブルシューティング)

---

## 導入前チェック

### C-1. 環境・インフラストラクチャの確認

#### C-1-1. データベース確認

- [ ] **progress_logs テーブルの確認**
  ```sql
  -- 実行: 本番DBへ接続後
  SELECT table_name, column_name, data_type, is_nullable
  FROM information_schema.columns
  WHERE table_name = 'progress_logs'
  ORDER BY ordinal_position;
  ```

  期待結果（必須列）:
  - `id` (uuid, NOT NULL)
  - `company_id` (text, NOT NULL)
  - `okr_id` (text, nullable)
  - `project_id` (text, nullable)
  - `content` (text, NOT NULL) ← __META__ 埋め込み対応
  - `score` (numeric, nullable)
  - `status` (text, nullable)
  - `created_at` (timestamp, NOT NULL)
  - `updated_at` (timestamp, nullable)
  - `user_id` (text, NOT NULL)

- [ ] **インデックスの確認・作成**
  ```sql
  -- インデックス確認
  SELECT indexname, indexdef
  FROM pg_indexes
  WHERE tablename = 'progress_logs'
  ORDER BY indexname;
  ```

  推奨インデックス（存在確認、なければ CREATE):
  ```sql
  -- 90日フィルタを効率化
  CREATE INDEX IF NOT EXISTS idx_progress_logs_company_created
  ON progress_logs (company_id, created_at DESC);

  -- okr_id での検索を効率化
  CREATE INDEX IF NOT EXISTS idx_progress_logs_company_okr_created
  ON progress_logs (company_id, okr_id, created_at DESC);
  ```

- [ ] **テーブルサイズ確認**
  ```sql
  SELECT
    schemaname,
    tablename,
    pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) AS size
  FROM pg_tables
  WHERE tablename = 'progress_logs'
  AND schemaname NOT IN ('pg_catalog', 'information_schema');
  ```

  期待結果: < 500MB（過去3年程度のデータを想定）

- [ ] **接続プール設定確認**
  - Supabase コネクションプール: デフォルト設定（プール数: 15）が適用されているか確認
  - タイムアウト: 30秒以上推奨

#### C-1-2. アプリケーション環境確認

- [ ] **環境変数設定（本番環境）**
  ```bash
  # 以下が設定されていることを確認
  NEXT_PUBLIC_DEBUG_BRIDGE=0  # 本番は '0' または未設定（デバッグログを出さない）
  # または、環境変数が未設定（デフォルト=非表示）
  ```

  確認コマンド:
  ```bash
  # 本番サーバにSSH接続後
  env | grep NEXT_PUBLIC_DEBUG_BRIDGE  # 出力なし、または = 0 が正常
  ```

- [ ] **デプロイ環境の確認**
  - Node.js バージョン: >= 18.0.0
  - Next.js バージョン: 確認済み（package.json から）
  - npm / yarn: 依存管理ツール動作確認

### C-1-3. アプリケーションコード確認

- [ ] **F-5 回帰テスト が本番環境で PASS した状態**
  - テスト実行日と実施者を記録
  - 全 7 項目（B-2-1 ～ B-2-7）で PASS または既知の課題のみ

  確認ファイル:
  ```
  docs/BRIDGE_F5_REGRESSION_TEST.md セクション B-4 のテスト結果
  ```

- [ ] **npm run type-check が通っている**
  ```bash
  npm run type-check
  # 期待結果: No errors, 0 issues found
  ```

- [ ] **npm run build が通っている**
  ```bash
  npm run build
  # 期待結果: ✓ Compiled successfully
  # .next/ フォルダが生成される
  ```

- [ ] **ビルドサイズ確認（最適化版）**
  ```bash
  npm run build -- --analyze  # または同等ツール
  # Bundle size が過度に増加していないか確認（増加量 < 10%）
  ```

### C-1-4. リリースノート確認

- [ ] **変更内容サマリー**
  ```
  - STAGE5→STAGE6 Bridge の安定化完了
  - OKR ID 永続化
  - __META__ 埋め込みによる execution メタデータ追跡
  - progress_logs の 90日集計ロジック
  - STAGE6 Tab1 寄与度表示
  ```

- [ ] **既知の制限事項**
  ```
  - 90日を超えるログは寄与度計算に含まれない（仕様）
  - okr_id なしの古いログは project_id フォールバックで集計（優先度低）
  ```

---

## 導入前準備

### C-2. バックアップとロールバック計画

#### C-2-1. データベースバックアップ

```bash
# 本番 DB の完全バックアップを取得（Supabase コンソールまたは CLI）
supabase backup create --project-ref <project-id> --db-url $DATABASE_URL
# または Supabase コンソール → Backups → Create backup

# バックアップ ID を記録: backup_<timestamp>
BACKUP_ID="backup_$(date +%Y%m%d_%H%M%S)"
echo "Backup ID: $BACKUP_ID" >> DEPLOYMENT_LOG.txt
```

期待結果:
- Supabase コンソールで Backup Status = "Completed"
- バックアップ日時が現在時刻と一致

#### C-2-2. 本番環境のスナップショット取得

```bash
# Git commit を記録（現在の本番環境コード）
git tag -a "prod-before-bridge-F5-$(date +%Y%m%d_%H%M%S)" -m "Before BRIDGE F-5 deployment"
git push origin --tags

# 環境変数スナップショット（機密情報を除く）
env | grep -E 'NEXT_PUBLIC_|NODE_ENV' > deployment_env_snapshot.txt
```

#### C-2-3. ロールバック計画書

以下を DEPLOYMENT_RUNBOOK.md に記載（実装予定、導入時に詳細化）:

```markdown
## ロールバック手順（Emergency）

### シナリオ 1: STAGE6 表示エラー（寄与度が計算されない、落ちる）
- 切り戻し時間目安: 10 分
- 手順:
  1. Previous version への git revert
  2. Next.js 再ビルド・デプロイ
  3. ブラウザキャッシュクリア（ユーザへ通知）
  4. STAGE6 Tab1 動作確認

### シナリオ 2: progress_logs クエリが遅い（LCP > 5s）
- 切り戻し時間目安: 15 分
- 手順:
  1. 90日フィルタの効きを確認（実行計画チェック）
  2. インデックス REINDEX
  3. キャッシュクリア（Redis / CDN）
  4. パフォーマンス再測定

### シナリオ 3: __META__ 欠損でログが混乱している
- 切り戻し時間目安: 30 分～ (DB修復が必要)
- 手順:
  1. ロールバック前にバックアップから復元点を判定
  2. DB を復元（Supabase Backup Restore）
  3. Application code を Previous version へ revert
  4. 手動検証: progress_logs の __META__ 確認
```

---

## 導入手順

### C-3. デプロイ実行

#### C-3-1. 導入前チェック最終確認（T - 30分）

```bash
#!/bin/bash
set -e

echo "=== BRIDGE F-5 本番導入 最終チェック ==="

# 1. コード確認
echo "[1] git status 確認"
git status  # clean であること

echo "[2] npm run type-check 実行"
npm run type-check  # エラーなし

echo "[3] npm run build 実行"
npm run build  # Compiled successfully

# 2. DB 接続確認
echo "[4] DB 接続確認"
# Supabase CLI または同等で接続テスト
supabase projects list | grep prod  # prod プロジェクトが見える

# 3. バックアップ確認
echo "[5] バックアップ確認"
supabase backup list --project-ref <prod-project-id> | head -5
# 最新のバックアップが「Completed」であることを確認

echo "=== 最終チェック完了。導入準備 OK ==="
```

#### C-3-2. 段階的デプロイ（フルコース）

**推奨: フルコース（全テスト項目を実行）**

```bash
#!/bin/bash
set -e

DEPLOY_ENV="production"
DEPLOY_TIME="$(date +'%Y-%m-%d %H:%M:%S')"

echo "=========================================="
echo "  BRIDGE F-5 本番導入 開始"
echo "  時刻: $DEPLOY_TIME"
echo "=========================================="

# Step 1: コードのデプロイ
echo ""
echo "[STEP 1] アプリケーションコード デプロイ"
echo "  → Vercel / GitLab CI / GitHub Actions に push"
echo ""

# 本番デプロイトリガー（例：Vercel）
git push origin main
# または CI/CD パイプラインを手動トリガー
# 画面表示: "Deployment in progress..." を待機（5～10分）

# Step 2: デプロイ確認（簡易版）
echo ""
echo "[STEP 2] デプロイ確認 (簡易)"
echo "  → 本番環境の /api/health または同等エンドポイントで確認"
echo ""

curl -s https://production.example.com/api/health | jq .
# 期待: { "status": "ok", "bridge_version": "F-5-stable" }

echo ""
echo "[STEP 3] 本番DBへのマイグレーション実行（必要に応じて）"
echo "  → このタイミングでは通常スキップ（インデックスは導入前に作成済み）"
echo ""

echo "=========================================="
echo "  デプロイ完了"
echo "=========================================="
```

**短時間コース（最小テストのみ）**

```bash
# 緊急時: 最小限の確認で進める（T - 15分）
echo "[Minimal] STAGE6 Tab1 表示確認のみ"
# ブラウザで本番 STAGE6 を開く → Tab1 で⭐数値が表示される確認
```

#### C-3-3. F-5 回帰テスト の本番環境での再実行（推奨）

デプロイ直後、本番環境で以下を確認（最短 30 分）:

```bash
# テスト #1: OKR ID 安定性 (5分)
echo "Test #1: OKR ID stability"
# → STAGE5 で OKR 編集 → okr_id が変わらないことを確認

# テスト #2: __META__ 埋め込み (5分)
echo "Test #2: __META__ embed"
# → STAGE5 Execution で新規ログ投入 → Network で __META__ 確認

# テスト #3: weight 計算 (5分)
echo "Test #3: Weight calculation"
# → progress_log 投入 → STAGE6 Tab1 をリロード → ⭐数値が変化確認

# テスト #4: STAGE6 表示確認 (5分)
echo "Test #4: STAGE6 display"
# → STAGE6 Impact Tab を開く → プロジェクト寄与度が表示されていることを確認

# テスト #5: 90日フィルタ (5分)
echo "Test #5: 90-day filter performance"
# → Network DevTools で loadProgressLogs レスポンスサイズ確認（< 10KB期待）

echo ""
echo "本番環境テスト完了。全て PASS ならば導入成功。"
```

---

## 導入後の確認

### C-4. 本番環境での動作確認

#### C-4-1. ユーザー向け動作確認

| 確認項目 | 操作 | 期待結果 | 実施日時 |
|---|---|---|---|
| **STAGE5 OKR 表示** | STAGE5 を開く | OKR が表示される | |
| **STAGE5 execution ログ投入** | 進捗ログを追加 | ログが保存される | |
| **STAGE6 Tab1 表示** | STAGE6 Impact Tab を開く | 寄与度（⭐）が表示される | |
| **weight 反映** | 別窓で progress_log 追加 → STAGE6 リロード | ⭐数値が変化 | |
| **複数プロジェクト独立性** | 複数OKRの寄与度 | 各OKRの⭐が独立している | |
| **再ログイン後も保持** | ログアウト → 再ログイン → STAGE6 開く | ⭐数値が同じ | |

実施者: ___________
確認日: ___________
承認者: ___________

#### C-4-2. パフォーマンスモニタリング

```bash
# 本番環境での Synthetic Monitoring（初回実施）

# LCP (Largest Contentful Paint) 確認
echo "STAGE6 Impact Tab Load Time:"
# 目安: < 3.5s （90日内のログ数に依存）

# Network bandwidth 確認
echo "loadProgressLogs API response size:"
# 目安: 1 log あたり 200-300 bytes
# 90日内 50 logs = 10-15 KB 程度

# DB クエリ実行時間
echo "Database query performance:"
# 目安: < 100ms (90日フィルタ + インデックス効果）
```

#### C-4-3. エラーログモニタリング

```bash
# 本番ログから以下エラーパターンを監視（24時間）

# パターン 1: __META__ 欠損
grep -i "metadata not found\|parseMetadata error" /var/log/application/*.log

# パターン 2: weight 異常値
grep -i "weight.*NaN\|weight.*Infinity\|weight.*invalid" /var/log/application/*.log

# パターン 3: progress_logs 取得エラー
grep -i "loadProgressLogs.*error\|loadProgressLogs.*timeout" /var/log/application/*.log

# パターン 4: STAGE6 レンダリング失敗
grep -i "stage6.*error\|impact.*tab.*error" /var/log/application/*.log

# 期待: 上記のエラーが出現しない（ゼロ件）
```

---

## 障害時の切り戻し

### C-5. 障害検知と対応

#### C-5-1. 障害パターン判定

| 障害パターン | 検知方法 | 優先度 | 対応時間 |
|---|---|---|---|
| **STAGE6 が落ちる** | ユーザー報告 / エラーログ | P1 CRITICAL | 10分以内 |
| **weight が NaN/Infinity** | ユーザー報告 / モニタリング | P2 MAJOR | 30分以内 |
| **progress_logs 取得が遅い** | パフォーマンスモニタリング | P2 MAJOR | 30分以内 |
| **__META__ が埋め込まれていない** | ログ監視 | P3 MINOR | 1時間以内 |

#### C-5-2. ロールバック手順（P1 CRITICAL 時）

```bash
#!/bin/bash
set -e

echo "=========================================="
echo "  緊急 ロールバック 実行"
echo "=========================================="

# Step 1: 現在のコミットを記録
FAILED_COMMIT=$(git rev-parse --short HEAD)
echo "Failed commit: $FAILED_COMMIT"

# Step 2: Previous Stable Version へ戻す
echo "Reverting to previous version..."
git revert --no-edit HEAD
# または
git reset --hard <previous-stable-tag>  # 例: git reset --hard prod-before-bridge-F5-20250215_100000

# Step 3: 本番デプロイ
echo "Redeploying..."
git push origin main --force-with-lease  # ⚠️ 慎重に使用

# Step 4: デプロイ確認
sleep 30
curl -s https://production.example.com/api/health | jq .

# Step 5: STAGE6 表示確認
echo "Check STAGE6 manually in browser..."

echo "=========================================="
echo "  ロールバック完了"
echo "=========================================="

# Step 6: インシデント記録
echo "Incident Report:"
echo "  Failed commit: $FAILED_COMMIT"
echo "  Rollback time: $(date +'%Y-%m-%d %H:%M:%S')"
echo "  Issue: [詳細を記入]"
echo "  Notification sent to: [チーム通知先]"
```

#### C-5-3. 部分的な無効化（フェーズの設定）

Feature flag を使用している場合の暫定対応:

```typescript
// utils/stage6/bridge-feature-flag.ts（例）

export const BRIDGE_F5_FEATURES = {
  // 各機能を個別に無効化可能
  enabled_weight_calculation: true,      // false にすると weight = 1.0 に固定
  enabled_metadata_parsing: true,        // false にするとメタデータ解析スキップ
  enabled_90day_filter: true,            // false にすると全ログ取得（パフォーマンス低下）
};

// 本番で問題時、.env.production に以下を追加してデプロイ
// NEXT_PUBLIC_BRIDGE_F5_WEIGHT_CALC=false
```

実装がない場合の暫定対応:

```typescript
// utils/stage6/execution.ts 内に以下を追加

// 暫定パス：weight を常に 1.0 に固定（寄与度計算を無効化）
const BRIDGE_MAINTENANCE_MODE = process.env.NEXT_PUBLIC_BRIDGE_MAINTENANCE === '1';

export const getExecutionWeight = (...) => {
  if (BRIDGE_MAINTENANCE_MODE) {
    console.log('[bridge] MAINTENANCE MODE: weight = 1.0 (weight calculation disabled)');
    return 1.0;  // ニュートラル係数に固定
  }
  // 通常の weight 計算...
};
```

---

## 監視とロギング

### C-6. ロギング設定

#### C-6-1. デバッグログの有効化・無効化

```bash
# 本番環境：デバッグログ無効（本来は未設定 or '0'）
echo "NEXT_PUBLIC_DEBUG_BRIDGE=0" >> .env.production
# または未設定（デフォルトで非表示）

# ステージング / 開発環境：デバッグログ有効
echo "NEXT_PUBLIC_DEBUG_BRIDGE=1" >> .env.staging
echo "NEXT_PUBLIC_DEBUG_BRIDGE=1" >> .env.local
```

#### C-6-2. ログ出力例（本番で監視対象）

```javascript
// エラー系ログ（本番でも出力）
console.error('[bridge][F-5] critical:', { okrId, error });

// 警告系ログ（本番では出力が少なく、監視対象）
console.warn('[bridge][F-5] warning:', { component, issue });

// デバッグログ（本番では非表示）
if (process.env.NEXT_PUBLIC_DEBUG_BRIDGE === '1') {
  console.log('[bridge][F-5] debug:', { detail });
}
```

#### C-6-3. ログ監視アラート設定（推奨）

Sentry / DataDog / CloudWatch など のログ集約サービスに以下のアラート を設定:

```yaml
Alert Rules:
  - name: "BRIDGE weight calculation error"
    condition: "log contains 'weight.*NaN' OR 'weight.*Infinity'"
    severity: CRITICAL
    action: "Page on-call, create Slack alert"

  - name: "BRIDGE metadata missing"
    condition: "log contains 'metadata not found' AND count > 10 in 1h"
    severity: MAJOR
    action: "Slack alert"

  - name: "BRIDGE STAGE6 error"
    condition: "log contains 'stage6.*error' AND count > 5 in 1h"
    severity: CRITICAL
    action: "Page on-call"
```

---

## FAQ & トラブルシューティング

### C-7. よくある質問と対応

#### Q1: デプロイ後に STAGE6 Tab1 が真っ白（表示されない）

**原因候補**:
1. progress_logs の読み込みエラー（クエリタイムアウト）
2. weight 計算で例外発生（NaN/Infinity）
3. ブラウザキャッシュが古い

**対応手順**:
```bash
# Step 1: ブラウザキャッシュクリア
# F12 → Application → Clear All

# Step 2: ネットワークエラー確認
# F12 → Network → STAGE6 ロード時のエラーを確認
# loadProgressLogs API が 404 / 500 エラーなら、DB接続確認

# Step 3: コンソールエラー確認
# F12 → Console で JavaScript エラーを確認
# "Cannot read property 'weight' of undefined" などなら weight 計算エラー

# Step 4: サーバーログ確認
tail -f /var/log/application/nextjs.log | grep stage6

# Step 5: DB クエリ確認
# Supabase コンソール → SQL Editor で手動実行
SELECT COUNT(*) FROM progress_logs
WHERE company_id = 'test-company-001'
AND created_at >= now() - interval '90 days';
```

**復旧方法**:
- キャッシュクリア + ページリロードで復旧する場合が多い
- 仍然表示されない場合は、上述の ロールバック手順 を実行

---

#### Q2: weight が常に 1.0（変化しない）

**原因候補**:
1. progress_logs が投入されていない（新規環境）
2. progress_logs の okr_id が NULL（フォールバック動作）
3. getExecutionWeight 関数に問題

**対応手順**:
```bash
# Step 1: progress_logs の件数確認
SELECT COUNT(*) FROM progress_logs
WHERE company_id = 'test-company-001'
AND okr_id = 'test-okr-001'
AND created_at >= now() - interval '90 days';

# 期待: > 0 (最低1件)
# 結果が 0 なら、ログ投入処理を確認

# Step 2: コンソールログで weight 計算の詳細を確認
# NEXT_PUBLIC_DEBUG_BRIDGE=1 に設定してリロード
# "[bridge][F-5] weight calc: logsMatched=0" なら、okr_id マッチングの問題

# Step 3: weight 計算ロジックの確認
# ブラウザコンソール:
const { getExecutionWeight } = await import('/utils/stage6/execution.ts');
const weight = await getExecutionWeight('Project X', [/*progress_logs*/], {});
console.log('Weight:', weight);
```

---

#### Q3: progress_logs 取得が遅い（LCP > 5s）

**原因候補**:
1. インデックスが作成されていない
2. 90日フィルタが効いていない（全件取得）
3. progress_logs テーブルサイズが大きすぎる

**対応手順**:
```bash
# Step 1: インデックス確認・作成
SELECT indexname FROM pg_indexes
WHERE tablename = 'progress_logs' AND indexname LIKE '%company%created%';

# なければ作成:
CREATE INDEX idx_progress_logs_company_created
ON progress_logs (company_id, created_at DESC);

# Step 2: クエリ実行計画を確認
EXPLAIN ANALYZE SELECT * FROM progress_logs
WHERE company_id = 'test-company-001'
AND created_at >= now() - interval '90 days';

# 期待: "Index Scan" または "Bitmap Index Scan"（Seq Scan は NG）

# Step 3: テーブルの VACUUM
VACUUM ANALYZE progress_logs;

# Step 4: 90日フィルタが機能しているか確認
# Network DevTools で loadProgressLogs API の fromDate パラメータを確認
# fromDate パラメータが含まれていない場合は、コード修正が必要
```

**復旧方法**:
- インデックス作成直後は REINDEX が推奨
  ```bash
  REINDEX TABLE progress_logs;
  ```

---

#### Q4: __META__ に okrId が含まれていない

**原因候補**:
1. execution ログ保存時に okrId が渡されていない
2. embedMetadata() 関数のバグ
3. 古いログ形式（__META__ なし）が残っている

**対応手順**:
```bash
# Step 1: 新規ログを投入してメタデータ確認
# STAGE5 Execution → 新しいログを追加 → Network で request body 確認

# Step 2: DB で直接確認
SELECT substring(content, 1, 300) as meta_snippet
FROM progress_logs
WHERE company_id = 'test-company-001'
ORDER BY created_at DESC
LIMIT 5;

# 期待: 先頭に __META__:{...okrId...}

# Step 3: parseMetadata() で解析テスト
-- ブラウザコンソール:
const logContent = `__META__:{"okrId":"test-okr-001","companyId":"test-company-001"}\nLog body`;
const { parseMetadata } = await import('/utils/execution/metadata.ts');
const meta = parseMetadata(logContent);
console.log('Parsed meta:', meta); // okrId が含まれているか確認
```

---

#### Q5: 本番から staging に戻す場合は？

**プロセス**:
1. 本番 DB バックアップを取得（既に done）
2. Staging DB を Staging 用 DB に切り替え（staging.env で確認）
3. staging 環境で F-5 回帰テスト を実行
4. 問題なければ、段階的に本番に上げ直し

---

### C-8. チェックリスト（導入完了時）

本番導入を完了するには、以下が全て完了していることを確認:

- [ ] F-5 回帰テスト全項目 PASS （本番環境実施）
- [ ] npm run type-check 成功
- [ ] npm run build 成功
- [ ] DB バックアップ取得済み
- [ ] インデックス作成・確認済み
- [ ] 環境変数設定確認（NEXT_PUBLIC_DEBUG_BRIDGE = 0 or 未設定）
- [ ] パフォーマンスモニタリング設定済み
- [ ] ロギングアラート設定済み
- [ ] ロールバック手順を関連者で確認・合意
- [ ] ユーザー向け通知文を作成・準備
- [ ] インシデント対応連絡先（on-call）を確認

**導入責任者署名**: ________________ （日時: ____________）
**運用責任者署名**: ________________ （日時: ____________）

---

## 附録: 緊急連絡先

| 役割 | 名前 | メール | 電話 |
|---|---|---|---|
| 導入PM | | | |
| DevOps Lead | | | |
| DB Admin | | | |
| Application Lead | | | |
| On-Call Engineer | | | |

---

## 附録: 関連ドキュメント

- `docs/BRIDGE_F5_REGRESSION_TEST.md` ← テスト手順（導入前に実施）
- `docs/BRIDGE_PROD_RUNBOOK.md` ← 本ファイル（導入手順と障害対応）
- `CODE_CHANGES.md` （修正が発生した場合）← コード変更の概要
