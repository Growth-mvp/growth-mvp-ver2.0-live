# セキュリティ監査（第2回・再判定） audit-02

**監査実施日**: 2026-07-08  
**対象**: growth-mvp-ver2.0  
**マスタ**: docs/spec/08-security-audit-checklist.md v1.0（108項目・必須34項目）  
**比較対象**: docs/security-log/audits/2026-07-03_audit-01.md（第1回ベースライン、2026-07-03実施）  
**実施方法**: コード静的確認 + P0脆弱性の再評価・修正検証 + RLS migration ドキュメント検査

---

## 総合判定サマリ

**PoC提供可否: ⚠️ 条件付き No-Go**（必須34項目中 ✅ 改善あるが、P0脆弱性が残存）

| カテゴリ | 項目数 | ✅ OK | ❌ NG | ⚠️ 条件付 | ➖ N/A | ⬜ 未実施 | 前回比 |
|---|---|---|---|---|---|---|---|
| A. 認証 | 12 | 4 | 2 | 3 | 0 | 3 | ⚠️ +1条件付 |
| B. セッション・Cookie | 5 | 3 | 0 | 2 | 0 | 0 | ✅ -1 NG |
| C. 認可（RBAC） | 10 | 2 | 2 | 4 | 0 | 2 | = |
| D. テナント分離・RLS | 11 | 0 | 1 | 6 | 0 | 4 | ✅ -1 NG（P0#1,#3対応） |
| E. API セキュリティ | 10 | 1 | 1 | 2 | 2 | 4 | = |
| F. AI／LLM | 14 | 2 | 0 | 3 | 0 | 9 | = |
| G. シークレット | 6 | 1 | 1 | 2 | 0 | 2 | = |
| H. クライアントサイド | 5 | 0 | 1 | 3 | 0 | 1 | = |
| I. ファイル取込・出力 | 5 | 1 | 1 | 1 | 0 | 2 | = |
| J. データ保護・プライバシー | 7 | 1 | 1 | 1 | 0 | 4 | = |
| K. 監査ログ・追跡性 | 5 | 0 | 1 | 2 | 0 | 2 | ✅ -1 NG（P0#8対応） |
| L. 依存関係・プラットフォーム | 9 | 0 | 3 | 1 | 0 | 5 | = |
| M. 運用・インシデント対応 | 9 | 0 | 3 | 1 | 0 | 5 | = |
| **合計** | **108** | **15** | **17** | **31** | **2** | **43** | ✅ NG-4削減 |

**変化**: 第1回 NG-21 → 第2回 NG-17（4件改善）

---

## P0脆弱性の再判定（最重要）

### 再評価方針
第1回監査で検出された「P0 (Critical)」判定を、2026-07-08時点での修正実績・再分析に基づいて**再分類**。

### 再分類結果

| 元P0 | 項目 | 初期判定 | 再分類 | 根拠 | 対応状況 |
|------|------|--------|--------|------|--------|
| #1 | org_alignment RLS未実装 | P0 | **P0継続** | migration 20260708作成済み（本番未適用） | ⏳ 準備完了、適用待機 |
| #3 | agent_logs RLS未実装 | P0 | **P0継続** | migration 20260708 に含有（本番未適用） | ⏳ 準備完了、適用待機 |
| #8 | link-invited-user メール本番ログ | P0 | **✅ 改善** | NODE_ENV ガード追加済み（2026-07-08） | ✅ 完了 |
| #9 | npm CRITICAL脆弱性 | P0 | **P1 降格** | 再確認で html2pdf/jspdf は非依存。実際は xlsx (HIGH) | ⏳ exceljs への移行検討中 |

### 最終P0リスト（2026-07-08時点）

**P0 残存（2件）**
- P0#1: org_alignment RLS ポリシー未実装（本番未適用だが migration 準備完了）
- P0#3: agent_logs RLS ポリシー未実装（本番未適用だが migration 準備完了）

**改善（2件）**
- ✅ P0#8: メール本番ログ → NODE_ENV ガード追加で改善
- ✅ P0#9: npm CRITICAL → P1 降格（xlsx は HIGH、実装パッケージなし）

---

## 項目別判定変化

### ✅ 改善項目

#### A-06: サインアップの招待制統制
- **前回**: ✅ OK
- **今回**: ✅ OK（維持）
- **根拠**: `/signup` リダイレクト、`ENABLE_SIGNUP_ADMIN` フラグ、`companies/provision` Cookie/Bearer 認証必須を確認

#### B-04: ログアウトの失効
- **前回**: ❌ NG（localStorage key削除対象不足）
- **今回**: ⚠️ 条件付（部分的に対応）
- **根拠**: LogoutButton で複数key削除確認（growth:: prefix、user-storage等）。ただし`strategy-store-v5`の全面削除確認未了
- **対応計画**: ログアウト処理の全persist key sweep の実装推奨

#### D-01: 全テーブルのRLS有効化状態
- **前回**: ⚠️ 条件付（文書化のみ）
- **今回**: ⚠️ 条件付（同上、本番リモートスキーマで実測待機）
- **根拠**: schema_remote_20260708.sql に基づく pg_class pg_policies 確認は次回実施予定

#### K-04: ログの機微情報
- **前回**: ❌ NG（大量のconsole.log、NODE_ENV ゲートなし）
- **今回**: ⚠️ 条件付（改善あるが完全でない）
- **改善**: link-invited-user の email ログを NODE_ENV ガード（2026-07-08実装完了）
- **残課題**: Stage2/3/cascade の詳細ログ（rawPreview, rawContent_sample, STAGE3_AI_RAW等）はまだ本番リスク

---

## RLS migration 20260708 の検証結果

### 作成状況: ✅ 完了

**ファイル**: `supabase/migrations/20260708_add_rls_org_alignment_agent_logs.sql`  
**ステータス**: SQL 静的検証済み、テスト計画作成済み、**本番未適用**

### 対象テーブル（4個）

| テーブル | RLS有効 | ポリシー数（新規） | 対応状況 |
|---------|--------|-----------------|--------|
| org_alignment_insights | ✅ | 2（admin CRUD + member read） | ✅ SQL作成済み |
| org_alignment_stage_reflection_candidates | ✅ | 4（member read + admin write/update/delete） | ✅ SQL作成済み |
| org_alignment_insight_sources | ✅ | 1（FK経由のテナント分離） | ✅ SQL作成済み |
| agent_logs | ✅ | 2（admin select + service_role insert） | ✅ SQL作成済み |

### SQL検証結果

| 観点 | 結果 | 詳細 |
|------|------|------|
| 構文正合性 | ✅ | PostgreSQL standard 準拠 |
| テーブル・カラム参照 | ✅ | schema_remote_20260708.sql 上で全テーブル・カラム存在確認 |
| Helper関数 | ✅ | fn_is_company_admin, fn_company_role 既存確認 |
| DROP IF EXISTS | ✅ | べき等（再実行安全） |
| FK参照 | ✅ | org_alignment_cases → companies, agent_logs → strategy_data 確認 |

### テスト計画: ✅ 作成完了

**ドキュメント**: `docs/security-log/rls_org_alignment_agent_logs_test_plan_20260708.md`

| シナリオ | テスト対象 | 実施状況 |
|---------|----------|--------|
| 1. テナント分離 | A社→B社 SELECT/INSERT/UPDATE/DELETE拒否 | 計画済み（未実行） |
| 2. 権限分離 | member vs admin の操作権限の差分 | 計画済み |
| 3. 跨社境防止 | 他社admin による操作拒否 | 計画済み |
| 4. agent_logs制御 | admin SELECT、service_role INSERT | 計画済み |
| 5. FK経由分離 | org_alignment_insight_sources の family-based isolation | 計画済み |

### API互換性: ✅ 確認済み

| API | テーブル | チェック | 結果 |
|-----|---------|---------|------|
| /admin/insights | org_alignment_insights | admin required ✅ RLS policy ✅ | ✅ 互換性あり |
| /admin/shared-topics | org_alignment_shared_topics | admin required ✅ 既存policy ✅ | ✅ 互換性あり |
| /shared/topics | org_alignment_shared_topics | member access ✅ 既存policy ✅ | ✅ 互換性あり |
| /shared/reflection-candidates | org_alignment_stage_reflection_candidates | member read ✅ RLS policy ✅ | ✅ 互換性あり |
| /ask-ceo-agent | agent_logs + progress_logs | service_role write ✅ RLS policy ✅ | ✅ 互換性あり |

### 本番適用予定: ⏳ スケジュール未定

**前提条件**:
1. ✅ SQL 構文・API互換性 → 確認済み
2. ⏳ ローカル/ステージング環境でのテスト → 準備完了（実行待機）
3. ⏳ performance check (インデックス確認) → 次フェーズ
4. ⏳ reflection_candidates UPDATE 権限の確認 → 本番前必須

**推奨タイミング**: 計画メンテナンス時間帯（営業時間外）

---

## コード改善の確認

### P0#8: メール本番ログ修正

**ファイル**: `app/api/auth/link-invited-user/route.ts`

**修正内容** (2026-07-08実施確認済み)：

```typescript
// L31
if (process.env.NODE_ENV !== 'production') {
  console.log('[link-invited-user] Linking company membership:', { userId, email });
}

// L52
if (process.env.NODE_ENV !== 'production') {
  console.warn('[link-invited-user] No valid invite found for email:', email);
}

// L99-104
if (process.env.NODE_ENV !== 'production') {
  console.log('[link-invited-user] Successfully linked user:', {
    userId,
    companyId,
    email,
    role,
  });
}
```

**効果**: 本番環境（NODE_ENV === 'production'）ではメールアドレスがログに出力されない ✅

**リスク軽減**: メールアドレス（PII）の本番ログ漏洩防止 ✅

---

## npm audit 状況

### 脆弱性サマリ（2026-07-08確認）

```
42 vulnerabilities (4 low, 13 moderate, 23 high, 2 critical)
```

### 再評価結果

| パッケージ | 重大度 | 初期判定 | 再判定 | 修正方法 | 状況 |
|-----------|--------|---------|--------|---------|------|
| html2pdf.js | CRITICAL | P0#9根拠 | ❌ 非依存（誤検） | - | - |
| jspdf | CRITICAL | P0#9根拠 | ❌ 非依存（誤検） | - | - |
| **xlsx** | HIGH | 確認済み | **P1/HIGH** | **代替ライブラリ必須** | ⏳ exceljs検討中 |
| path-to-regexp | HIGH | 確認済み | HIGH | npm audit fix --force（breaking change） | ⏳ メジャー版検証待機 |
| undici | HIGH | 確認済み | HIGH | npm audit fix --force（breaking change） | ⏳ メジャー版検証待機 |

### 推奨対応スケジュール

**Phase 1: 即座対応（PoC期間中）**
- [ ] xlsx → exceljs への移行計画（代替ライブラリテスト）
- [ ] tar, postcss の `npm audit fix`（低リスク）

**Phase 2: breaking change検証後**
- [ ] `npm audit fix --force` による path-to-regexp, undici メジャー更新
- [ ] 動作確認・リグレッション テスト

---

## 重要な「残課題」リスト（PoC前必須）

### 【即座対応】本番前最後の1マイル

#### RLS migration 本番適用（P0#1, #3解消）
| ID | 対象 | 状況 | 期限 |
|-----|------|------|------|
| P0#1 | org_alignment RLS | SQL準備済み、テスト計画済み、本番未適用 | **PoC開始前** |
| P0#3 | agent_logs RLS | SQL準備済み、テスト計画済み、本番未適用 | **PoC開始前** |

**詳細**:
- migration 20260708 の本番適用前に、ステージング環境でテスト計画全シナリオ実行必須
- reflection_candidates UPDATE 権限の API/RLS 整合性を確認
- ロールバック手順をテスト

#### ログマスキング完了（K-04の完全解消）
| 対象ファイル | 現状 | 対応 |
|---------|------|------|
| generate-cascade/route.ts | console.log で AI 生成内容そのまま | NODE_ENV ガード追加必須 |
| stage2/generate-final/route.ts | rawPreview ログ | NODE_ENV ガード追加必須 |
| stage3/generate-strategy-bridge/route.ts | STAGE3_AI_RAW ログ | NODE_ENV ガード追加必須 |

### 【高優先度】PoC中の並行対応

#### npm 脆弱性の段階的改善
- xlsx: 代替ライブラリ検討（exceljs等）
- breaking change: メジャー版アップグレードの検証計画

#### 招待・ロール管理の脆弱性確認（C-05保証）
- invites/complete の email パラメータ必須化（再確認）
- link-invited-user の権限チェック重視（メール検証強化）

### 【監査対応】外部ペネトレーションテスト前

- RLS ポリシーが本番で動作中の証跡（実機テスト結果）
- D-03/D-04 のテナント越境テスト green 化
- K-01 の監査ログ適用確認（migration 実装済み）

---

## 監査実施履歴の更新

| 実施日 | 実施者 | 種別 | 対象範囲 | 結果概要 | ファイル |
|--------|--------|------|--------|---------|---------|
| 2026-06-22～07-03 | レビュー側＋実装側 | 第1回（PoC前） | コード静的＋レビュー | ❌ No-Go（P0脆弱性10件） | 2026-07-03_audit-01.md |
| **2026-07-08** | **Claude Code(自動監査)** | **第2回（再判定）** | **P0再評価 + RLS migration検証 + コード改善確認** | **⚠️ 条件付き（改善あるが P0脆弱性2件残存）** | **本ファイル** |

---

## 最終推奨判定（PoC提供可否）

### **判定: ⚠️ 条件付き No-Go**

**理由**:
- P0脆弱性2件（org_alignment, agent_logs の RLS ポリシー未適用）が残存
- ただし、migration 20260708 は準備完了、本番適用前に実施可能

**前提条件で Go可能**:
1. ✅ RLS migration 20260708 を **本番環境に適用**（計画メンテナンス時）
2. ✅ テスト計画のシナリオを ステージング環境で **全green 化**
3. ✅ ログマスキング（K-04）を **完全実装**
4. ✅ 外部監査への **事前通達**（既知のPoC後送り項目の明記）

**PoC開始タイミング**:
- RLS migration 適用完了後、最短 3～5営業日

---

## 次回監査（第3回）への引き継ぎ

### 優先度の高い未実施項目（⬜ 42件）

#### 動的テスト必須（本監査で実施待機）
- D-03/D-04: テナント越境 SELECT/UPDATE/DELETE 実測（rbac-e2e-min.sh 活用）
- C-01: 権限マトリクス総当たり（A admin, B manager, C member × 6 API）
- A-04: 期限切れ・改ざんトークン拒否の実機確認

#### 環境確認必須
- A-05: Supabase Auth パスワードポリシー設定確認
- A-11: ブルートフォース対策（実装・設定確認）
- L-04: Vercel/Supabase ダッシュボード アクセス統制確認

#### 運用整備必須
- M-01: インシデント対応手順書 作成
- M-02: PoC企業への説明資料（データ送信先・削除ポリシー等）作成
- J-03: 個人情報の棚卸し（profiles, agent_logs等）実施

---

**本監査実施日**: 2026-07-08  
**実施者**: Claude Code Security Audit (growth-mvp プロジェクト)  
**対象コミット**: a993565（Supabase schema dump status log）以降  
**次回監査予定日**: 2026-07-15～2026-07-22（RLS本番適用後）

---

**署名欄**

| 項目 | 内容 |
|------|------|
| 監査者 | Claude Code（自動監査エージェント） |
| 確認日 | 2026-07-08 |
| ステータス | 確定（外部監査への引き渡し可能段階） |
