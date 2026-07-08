# P0 脆弱性修正計画：RLS ポリシー追加

**作成日**: 2026-07-08  
**対象**: org_alignment 系テーブル（3件）と agent_logs テーブル（1件）  
**目的**: テナント分離を DB 側でも担保、外部監査に対応可能な状態を実現  
**ステータス**: 本番未適用（修正案作成段階）

---

## 現状リスク

### P0 脆弱性：RLS ポリシー未実装

| # | テーブル | RLS有効 | ポリシー | リスク | 影響範囲 |
|---|---------|--------|---------|--------|---------|
| 1 | org_alignment_insights | ✅ | ❌ なし | 全ユーザーが全会社のインサイトを読取可能 | 中 |
| 2 | org_alignment_stage_reflection_candidates | ✅ | ❌ なし | 全ユーザーが全会社の反映候補を読取可能 | 中 |
| 3 | org_alignment_insight_sources | ✅ | ❌ なし | 全ユーザーが全洞察の関連ケースを読取可能 | 低（FK で間接制御） |
| 4 | agent_logs | ✅ | ❌ なし | 全ユーザーが全会社の AI ログを読取可能 | 高（機密情報含む） |

### 具体的な攻撃シナリオ

**シナリオ 1: 競合他社データの盗聴**
1. A 社ユーザーが authentic token を取得
2. SELECT * FROM org_alignment_insights（会社制限なし）
3. B 社の戦略洞察が読み取られる

**シナリオ 2: AI ログの情報漏洩**
1. A 社ユーザーが agent_logs をクエリ
2. B 社の CEO 相談内容が読み取られる
3. 経営戦略・個人情報・機密情報が漏洩

**シナリオ 3: 権限昇格（現在は API レベルでブロック）**
1. B 社の admin が API チェックを迂回すると
2. A 社のテーブルを直接修正可能

---

## 提案する RLS 方針

### 1. org_alignment_insights
```
- SELECT: company 内メンバーは OK、admin は all OK
- INSERT/UPDATE/DELETE: admin のみ
- 理由: 集約洞察は管理者が生成・管理、メンバーは参照のみ
```

### 2. org_alignment_stage_reflection_candidates
```
- SELECT: company 内メンバーは OK（反映予定の候補を共有）
- INSERT: admin のみ
- UPDATE/DELETE: admin のみ
- 理由: STAGE 反映候補は管理者が管理
```

### 3. org_alignment_insight_sources
```
- SELECT: case_id の FK を経由して、case の company_id で制御
- INSERT/UPDATE/DELETE: case への permissions に従う
- 理由: N-to-N junction - case と insight が同じ company
```

### 4. agent_logs
```
- SELECT: company の admin のみ（セッション logs は機密）
- INSERT: service_role のみ（backend ロギング）
- UPDATE/DELETE: 禁止（audit trail）
- 理由: AI 相談内容は最高機密、append-only で監査可能に
```

---

## 作成した修正ファイル

### 1. Migration SQL

**ファイル**: `supabase/migrations/20260708_add_rls_org_alignment_agent_logs.sql`

**内容**:
- DROP POLICY IF EXISTS で既存ポリシーをクリーンアップ
- org_alignment_insights: 2 ポリシー（admin CRUD + member read）
- org_alignment_stage_reflection_candidates: 4 ポリシー（member read + admin write）
- org_alignment_insight_sources: 1 ポリシー（FK ベース）
- agent_logs: 2 ポリシー（admin read + service_role insert）

**注**: 本番 DB には **未適用**

### 2. テスト計画

**ファイル**: `docs/security-log/rls_org_alignment_agent_logs_test_plan_20260708.md`

**内容**:
- 5 シナリオ（テナント分離、権限分離、跨社境防止、agent_logs、FK ベース）
- 各シナリオの SQL クエリ例
- 期待結果の詳細
- ローカル実行手順
- cleanup 手順
- チェックリスト

### 3. このレポート

**ファイル**: `docs/security-log/rls_p0_fix_plan_20260708.md`

---

## 適用前に必要な確認

### 1. 既存 API との互換性確認

| API | 対象テーブル | 影響 | 対応 |
|-----|-----------|------|------|
| `/api/org-alignment/admin/insights` | org_alignment_insights | 管理者のみアクセス | ✅ 問題なし |
| `/api/org-alignment/admin/insights/generate` | insights + sources | admin check 済み | ✅ 問題なし |
| `/api/org-alignment/admin/requests` | requests | admin check 済み | ✅ 問題なし |
| `/api/org-alignment/shared/topics` | shared_topics | member アクセス OK | ✅ 問題なし |
| `/api/org-alignment/generate` | cases | member create OK | ✅ 問題なし |
| `/api/ask-ceo-agent` | agent_logs | service_role insert | ✅ 問題なし |

**結論**: すべての API で RLS 対応が可能

### 2. 依存関係の確認

**Helper 関数の確認**:
- `fn_is_company_admin(c_id)` - 既存あり（L74-92）
- `fn_company_role(c_id)` - 既存あり（L59-68）

**Foreign Key の確認**:
- org_alignment_insight_sources → org_alignment_cases（OK）
- org_alignment_cases → companies（OK）
- agent_logs → strategy_data（OK）

### 3. パフォーマンス影響

**考慮点**:
- RLS ポリシーに EXISTS サブクエリを使用（company_members JOIN）
- インサイト数が多い場合、クエリが重くなる可能性
- **対策**: クエリの EXPLAIN ANALYZE で監視

**推奨**:
- 本番適用前に負荷テスト実施
- インサイト数 1000+のシナリオで性能測定
- 必要に応じて INDEX 追加（company_id, user_id）

---

## 想定される副作用

### 1. 既存データへのアクセス制限

- RLS ポリシー追加後、権限のないユーザーは既存データにアクセス不可
- **対策**: API が既に company_id フィルタ済み（影響なし）

### 2. Service role の権限変化

- agent_logs への service_role INSERT は引き続き可能
- **対策**: バックエンド API は変わらず（影響なし）

### 3. テストデータの制限

- テスト時にも RLS が有効
- **対策**: テストユーザーを company_members に登録

---

## 本番適用手順案

### Step 1: テスト環境での検証（推奨 1-2 週間）

1. ローカル Supabase で migration 実行
2. テスト計画に基づいて検証
3. API 互換性確認
4. パフォーマンステスト

### Step 2: ステージング環境への適用（推奨 1 週間）

1. migration ファイルをステージング環境へコピー
2. `supabase migration up --linked` で適用
3. 本番データの一部でテスト
4. 本番 API を使用した動作確認

### Step 3: 本番への適用

1. migration ファイルをプロダクション環境へ
2. 計画メンテナンス時間帯に実行
3. ロールバック計画の確認
4. `supabase migration up --linked` で適用
5. 全 API の疎通確認

### Step 4: 監視・ロールバック準備

- エラーログの監視
- API レスポンス時間の監視
- RLS ポリシー生成エラーの監視

---

## ロールバック案

### シナリオ 1: migration 実行直後の問題発見

**ロールバック方法**:
```bash
supabase migration down --linked
# または
supabase db reset --linked  # テスト環境のみ
```

**時間目安**: 数秒（ポリシー削除）

### シナリオ 2: API 互換性問題

**対応**:
1. API を修正
2. migration の drop policy を確認
3. 再度 up を実行

---

## 監査対応

このRLS実装により、外部監査に以下を説明可能：

1. ✅ **テナント分離**: DB レベルでの company_id ベース分離
2. ✅ **権限分離**: RLS ポリシーによる admin/member 分離
3. ✅ **監査証跡**: agent_logs は append-only、UPDATE/DELETE 禁止
4. ✅ **データ保護**: 外国データ読取制限、SQL Injection リスク低減

---

## 推奨スケジュール

| フェーズ | 期間 | 主要タスク |
|---------|------|---------|
| **テスト** | 1-2 週間 | ローカル検証、テスト計画実行 |
| **ステージング** | 1 週間 | 本番データシミュレーション、パフォーマンステスト |
| **本番準備** | 2-3 日 | ドキュメント整備、ロールバック準備 |
| **本番適用** | 計画メンテナンス時 | migration up、疎通確認 |
| **監視** | 1 週間 | ログ監視、API 監視 |

---

## 注意事項

### DO（推奨）
- ✅ ローカル環境で十分にテストしてから本番適用
- ✅ ステージング環境で本番同等の検証を実施
- ✅ ロールバック計画を事前に作成
- ✅ 計画メンテナンス時間帯に適用
- ✅ 適用後、全 API の疎通確認

### DON'T（禁止）
- ❌ 本番 DB へ直接 SQL 実行（migration 使用）
- ❌ テストなしでの本番適用
- ❌ 既存 policy を無視して new policy を追加（DROP IF EXISTS で対応）
- ❌ service role 権限の制限（backend logging のため必須）

---

## 関連ファイル

- **migration SQL**: `supabase/migrations/20260708_add_rls_org_alignment_agent_logs.sql`
- **テスト計画**: `docs/security-log/rls_org_alignment_agent_logs_test_plan_20260708.md`
- **P0 根拠**: `docs/security-log/security-audit-p0-triage-20260708.md`
- **初期監査**: `docs/security-log/security-audit-report-20260708.md`

---

**作成日**: 2026-07-08  
**ステータス**: 本番未適用（修正案）  
**次のアクション**: 外部監査との協議、テスト実施計画の立案
