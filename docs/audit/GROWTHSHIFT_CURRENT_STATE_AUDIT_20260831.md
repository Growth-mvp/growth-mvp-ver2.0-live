# GROWTH SHIFT 現状実態監査報告書

**実施日:** 2026-08-31  
**対象:** GROWTH SHIFT プロジェクト全体  
**監査方針:** コード実装・DB スキーマ・middleware・API エンドポイントの根拠ベース調査

---

## Executive Summary

GROWTH SHIFT は PoC 開始前の段階にありながら、**複数の重大セキュリティリスク**と**実装の不完全性**が存在します。

### 即対応必須（P0）
- **3件の CRITICAL API セキュリティ脆弱性** - company ID 検証漏れ、query parameter 検証なし
- **npm 脆弱性残存（High）** - xlsx, tar, undici の根本対策なし
- **利用規約・プライバシーポリシー未実装** - 法的リスク

### PoC 開始前に対応推奨（P1）
- 招待フロー・token ブルートフォース対策不足
- console.log で機密情報出力（52件）
- Rate limit matcher 漏れ（修正済み）
- Incident Response Plan 要記入箇所（17件）

### 実装進捗確認（P2）
- STAGE2～6 は 50～80% 実装だが動作検証不足
- 組織変革/すり合わせルーム は 20% 実装（ほぼ UI のみ）
- 全 STAGE 横断のデータ整合性未検証

---

## 1. Middleware & Rate Limit 調査

### 1-1. 修正内容（2026-08-31 実施）

**Issue:** `/api/stage5/assist-execution` が middleware regex には定義されているが、config.matcher から漏れていた

**修正内容:**
```diff
export const config = {
  matcher: [
    '/api/generate-:path*',
    '/api/stage:path*/generate-:path*',
+   '/api/stage5/assist-execution',  // ← 追加
    '/api/recommend-:path*',
    '/api/okr-from-exec',
    '/api/ask-ceo-agent',
    '/api/org-alignment/:path*/generate:path*',
    '/api/invites/:path*',
    '/api/members/:path*',
    '/api/companies/provision',
  ],
};
```

**結果:** 
- ✅ Build: 成功
- ✅ TypeScript: エラーなし
- ⏳ 実機動作確認: 未検証（本番環境での middleware 到達を確認していない）

### 1-2. TypeScript エラー修正（2026-08-31 実施）

**Error 1:** Line 40 - `Argument of type 'string' is not assignable to parameter of type 'Duration'`
```diff
- const createRateLimiter = (name: string, limit: number, window: string) =>
+ const createRateLimiter = (name: string, limit: number, window: Duration) =>
```
- 修正: @upstash/ratelimit から Duration 型をインポート
- 結果: ✅ 解決

**Error 2:** Line 106 - `Property 'ip' does not exist on type 'NextRequest'`
```diff
const getClientIP = (req: NextRequest): string => {
  return (
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    req.headers.get('x-real-ip') ||
    req.headers.get('cf-connecting-ip') ||
-   req.ip ||
    '0.0.0.0'
  );
};
```
- 修正: NextRequest に ip プロパティが存在しないため削除
- 結果: ✅ 解決

### 1-3. Rate Limit 実装状況

| 対象 | 実装 | Status |
|-----|------|--------|
| AI生成系 (10/min, 50/day) | ✅ 実装 | 正常 |
| 管理系 (10-20/hour) | ✅ 実装 | 正常 |
| 未認証時 (30/min IP単位) | ✅ 実装 | 正常 |
| 429 レスポンス | ✅ 実装 | RateLimit-Remaining ヘッダー付き |
| Fail-open 動作 | ✅ 実装 | Redis/Upstash エラー時も通す |
| Stage5/assist-execution matcher | ✅ 実装 | 修正済み |
| **実機 429 確認** | ⏳ | 未検証 |

---

## 2. API セキュリティ監査

### 2-1. 重大脆弱性（CRITICAL）

#### ① `/api/admin/data-management/delete-all` - Company ID 検証なし
**リスク:** 複数会社に所属する Admin がどの会社を削除対象にするか不確定
```typescript
const { data: membershipData } = await admin
  .from('company_members')
  .select('company_id, role')
  .eq('user_id', authUserId)
  .eq('role', 'admin')
  .order('created_at', { ascending: false })
  .limit(1);  // ← 複数所属時に最初の1件のみ
const companyId = membershipData.company_id;  // 不確定
```
**影響:** 他社データの全削除が可能
**対応:** 未実施（修正候補のみ提示）

#### ② `/api/org-alignment/admin/requests` - Query parameter 検証なし
**リスク:** Admin がクエリパラメータで任意の会社 ID を指定可能
```typescript
const companyId = searchParams.get('companyId');  // ← ユーザー入力
const membership = await admin
  .from('company_members')
  .select('role')
  .eq('company_id', companyId)
  .eq('user_id', userId);
```
**影響:** 他社のすり合わせ依頼データへのアクセス
**対応:** 未実施（修正候補のみ提示）

#### ③ Multi-Company Admin - Company 推定不確定
**リスク:** 複数会社所属時の requireMembership() 第3引数なし呼び出しで会社が不確定
**影響:** 意図しない会社へのデータ変更
**対応:** 未実施

### 2-2. 高リスク問題（HIGH）

| # | API | 問題 | 優先度 |
|---|------|------|--------|
| 1 | `/api/invites/complete`, `/api/invites/info` | Bearer Token 認証なし（Token hash のみ） | P1 |
| 2 | `/api/ask-ceo-agent` | Rate limit なし（AI 呼び出しコスト増加懸念） | P1 |
| 3 | `/api/companies/provision` | 新規会社作成時の所有権モデル不明確 | P1 |
| 4 | `/api/cascade/cleanup-deleted-projects` | 複数会社 Admin 対応で会社選別曖昧 | P1 |

### 2-3. セキュアな API（27個）

✅ 以下 API は認証・Membership・Role チェックを正しく実装：
- STAGE1～5 の generate 系 API
- `/api/org-alignment/generate`, `/api/org-alignment/intake`
- `/api/members`, `/api/members/role`
- 管理系 API（invite, members, companies）

### 2-4. API セキュリティ評価

**総体的リスク:** 中～高  
**セキュリティモデル:** 概ね堅牢だが、複数会社 Admin 対応で脆弱性露呈

---

## 3. npm 脆弱性と依存パッケージ

### 3-1. 重大脆弱性（CRITICAL/HIGH）

| パッケージ | バージョン | 脆弱性 | 影響 | 判定 |
|----------|----------|--------|------|------|
| **xlsx** | 0.18.5 | Prototype Pollution / ReDoS | Excel インポートで GROWTH コード実行可能 | 残存(High) |
| **tar** | 7.5.7（Build-time） | Symlink/Hardlink traversal | Vercel CLI deployment 時のみ | 残存(High) |
| **undici** | 5/6/7混在 | Response Desync, CRLF, Cookie injection | HTTP 通信全般（fetch, OpenAI, Supabase） | 残存(High) |
| **postcss** | 8.5.x | XSS, SourceMap traversal | Dev/Build-time のみ | 解消済 |
| **sharp** | 0.34.3 | libvips CVE | Next.js 内部の画像最適化 | 条件付き |

### 3-2. 根本対策不可能

**xlsx:** No fix available（フォークバージョン使用か代替検討が必要）  
**tar:** Vercel@59.10.0+ で解消（minor バージョンアップ推奨）  
**undici:** 3 バージョン混在で攻撃面拡大（バージョン統一必要）

### 3-3. 入力バリデーション現状

| 対策 | 実装 | 詳細 |
|------|------|------|
| セル値長制限 | ❌ | 未実装 |
| セル数制限 | ❌ | 未実装 |
| HTTP Response Timeout | ❌ | 未実装 |
| Connection: close ヘッダ | ❌ | 未実装 |

### 3-4. 判定

**npm audit 脆弱性:** 46件（Production Runtime: Critical 3件、High 29件、Moderate 10件、Low 4件）  
**セキュリティ態勢:** ⚠️ 高リスク - 根本対策不可能な脆弱性が存在

---

## 4. DB セキュリティ & RLS

### 4-1. RLS 有効化

| テーブル | RLS | Policy | 状態 |
|---------|------|--------|------|
| org_alignment_cases | ✅ | 3個実装 | 完成 |
| org_alignment_requests | ✅ | 実装済み | 完成 |
| org_alignment_stage_reflection_candidates | ✅ | 実装済み | 完成 |
| org_alignment_insights | ✅ | 未定義（pending） | ⏳ migration 適用待ち |
| org_alignment_insight_sources | ✅ | FK 依存 | FK 分離確認 |
| org_alignment_shared_topics | ✅ | 実装済み | 完成 |
| agent_logs | ✅ | 未適用（migration 存在） | ⏳ migration 適用待ち |

### 4-2. Migration 適用状況

**適用済み:** org_alignment_cases ポリシー、全テーブル RLS ENABLE  
**適用保留:**
- `20260708_add_rls_org_alignment_agent_logs.sql` - PoC 前非適用指示
- `20260628_fix_strategy_data_rls_role_control.sql` - STAGE4 分離前なので保留

### 4-3. API 層と RLS の二重防御

✅ 実装済み：membership + role チェック + RLS ポリシー（多層防御）  
⚠️ 問題点：org_alignment_insights ポリシー未定義で認証ユーザーが全データアクセス可能

### 4-4. Company 単位分離

**確認:** company_id ベースの分離が API 層で確実に実装  
**懸念:** FK 依存の分離（insight_sources, agent_logs）で company 遡行確認が必要

---

## 5. 招待フロー & アカウント管理

### 5-1. 招待フロー実装状況

| 項目 | 実装 | 詳細 |
|------|------|------|
| Token 乱数性 | ✅ | 256-bit randomBytes（十分） |
| 有効期限 | ✅ | 7日間（expires_at で管理） |
| 再利用防止 | ✅ | accepted_at is null チェック（并行対応） |
| Company/Role 改ざん耐性 | ✅ | 管理者の DB 記録から取得 |
| Email 一致確認 | ✅ | Supabase auth.users と正規化比較 |
| Email 必須化 | ✅ | POST 時に必須 |
| Trial 回数制限 | ⚠️ | IP + User キー、token 単位なし |
| Admin 権限確認 | ✅ | Role チェック実装 |

### 5-2. 重大欠陥

**❌ Token ブルートフォース対策:** 招待系は 1 時間 10 回制限だが、異なる token で繰り返し試行可能  
**❌ /api/invites/info 認証なし:** Token のみで招待情報（email, company, role, expires）を取得可能

### 5-3. 判定

招待フロー基本実装は堅牢だが、token ブルートフォース対策が不足

---

## 6. Console ログ & Server ログ出力

### 6-1. 出力集計

| 分類 | 件数 | リスク |
|------|------|--------|
| **A. 本番で出してはいけない** | 52件 | 🔴 CRITICAL |
| **B. マスキング推奨** | 187件 | 🟡 HIGH |
| **C. 本番でも必要** | 773件 | 🟢 LOW |
| **合計** | 1012件 | - |

### 6-2. CRITICAL 出力（52件）

**代表例：**
- `app/api/stage2/generate-draft/route.ts:1205` - ★PAYLOAD SUMMARY★（ビジネス情報本文）
- `app/api/generate-cascade/route.ts:3185` - [STAGE3_INPUT_DATA]（戦略入力本文）
- `app/api/stage2/generate-final/route.ts:2321` - ★FINAL STORY BEFORE RESPONSE★（最終ストーリー）

**内訳：**
- AI 生成結果・プロンプト本文: 24件
- 財務・KPI・戦略内容本文: 18件
- ストーリー・提案本文: 10件

### 6-3. 最もリスクの高いファイル Top 5

1. `app/api/stage2/generate-draft/route.ts` - ペイロード・プロンプト本体
2. `app/api/generate-cascade/route.ts` - AI 生成結果完全レスポンス
3. `app/api/stage2/generate-final/route.ts` - 最終ストーリー・プロンプト
4. `app/stage2/page.tsx` - 生成データサマリー
5. `app/cascade/page.tsx` - 戦略データ詳細

### 6-4. 判定

**52件の CRITICAL 出力** を本番リリース前に削除またはマスク化が必須

---

## 7. 利用規約・プライバシーポリシー

### 7-1. 実装状況

| 項目 | 実装 | 詳細 |
|------|------|------|
| `/terms` 正式版 | ❌ | プレースホルダーのみ |
| `/privacy` 正式版 | ❌ | プレースホルダーのみ |
| Version 管理 | ❌ | なし |
| DB 管理 | ❌ | `user_agreements` テーブルなし |
| 初回登録時の同意 | ❌ | チェックなし |
| 同意日時記録 | ❌ | agreed_at カラムなし |
| プライバシー別同意 | ❌ | Terms と Privacy 分離なし |

### 7-2. 重大な法的リスク

**❌ 利用規約・プライバシーが未実装:** 正式版が存在せず、サービス提供中に法的証拠がない  
**❌ 同意の法的証拠がない:** ユーザーが規約に同意したことを記録していない  
**❌ 法的要件不備:** 日本のサービスの場合、利用規約・プライバシーポリシー明示と同意は法的必須要件

### 7-3. 判定

**未実装（法的リスク - P0）**

---

## 8. Incident Response Plan

### 8-1. 文書状況

| 項目 | 状態 | 詳細 |
|------|------|------|
| 文書存在 | ✅ | `docs/PoC_INCIDENT_RESPONSE_PLAN_20260731.md` |
| フロー定義 | ✅ | 検知→初期対応→調査→復旧→再発防止 |
| 外部サービス障害対応 | ✅ | Supabase, Vercel, OpenAI, Upstash Redis |
| 情報漏えい対応 | ✅ | P0 インシデント時プロトコル記載 |

### 8-2. 要記入箇所（17箇所）

**未記入内容：**
- 当社連絡窓口：PoC 担当責任者名・電話・メール
- PoC 提供先企業窓口：企業名・担当者×3、代替連絡先×3
- 初期対応時間：P0/P1/P2/P3 の復旧予定時刻
- インシデント対応記録表：各項目「要記入」（8項目）
- ログ保持期間：audit_logs, agent_logs の確認状況「要確認」

### 8-3. 判定

**構造完備だが運用体制未決定**
- PoC 限定：「本文書は PoC 期間中のみ有効」と明記
- 実運用不可能：窓口・SLA・判断権限が未記入

---

## 9. STAGE2（戦略生成）実装状態

### 9-1. Final Strategy 評価ループ

**実装:** 有（2 パス生成 + 修正ロジック）

| 要素 | 実装 | 詳細 |
|------|------|------|
| Evaluator | ✅ | `computeCoverageIssues` で CEO 意図・MVV・SWOT 章別カバレッジ確認 |
| Score/Criteria | ✅ | 10 項目の不足要件をスコアリング |
| Regeneration 条件 | ✅ | missing[] 長でスコア判定 |
| Max 試行回数 | ✅ | 1 回（2nd pass で修正失敗しても出力） |
| 部分再生成 | ❌ | 全章毎回再生成 |
| Repair | ✅ | `buildRepairSystemPrompt` で実装 |
| Fallback | ✅ | gpt-4o-mini へ自動フォールバック |

### 9-2. モデル・パラメータ構成

| 処理 | モデル | reasoning_effort | max_tokens | JSON Mode | Repair |
|------|--------|-----------------|-----------|-----------|--------|
| Draft | gpt-5.6-luna | N/A | 8000 | ✅ | ✅ |
| Final | gpt-5.6-luna | N/A | 8000 | ✅ | ✅ |
| Midterm | gpt-5.6-luna | N/A | 6000 | ✅ | ❌ |

### 9-3. 判定

**実装進捗:** 80% - 生成・修正・repair は完成。evaluator loop は簡易版

---

## 10. STAGE3（戦略展開）実装状態

### 10-1. 保存・復元の問題

| 問題 | 状態 | 根拠 |
|------|------|------|
| 削除した部門が復活 | ✅ 修正済み | is_deleted フラグで論理削除 |
| 削除した OKR が復活 | ✅ 修正済み | cascade cleanup で soft-delete |
| 旧 OKR と新 OKR 混在 | ✅ 修正済み | 再生成時の upsert + cleanup |
| duplicate React key | ⏳ 要確認 | .map((item, idx) → key={idx} の可能性 |
| autosave vs DB 一貫性 | ✅ 実装済み | restoreWithAudit で orphan cleanup |

### 10-2. Strategic Unit / 部門構造

**一貫性:** UI・DB・API・STAGE4 への引継ぎが company_id → department_id → project_id → okr_id で一貫

### 10-3. 横断論点・重複・整合性検知

**実装:** 未実装 - shared topics テーブル存在するが、自動検知機能なし

### 10-4. 判定

**実装進捗:** 60% - データ流通・cleanup は完成。横断論点検知未実装

---

## 11. STAGE4（OKR・実行計画）実装状態

### 11-1. データ引継ぎ

| 要素 | 引継ぎ | 実装 |
|------|--------|------|
| Objective | 部門戦略→プロジェクト→OKR | ✅ |
| Key Results | 戦略単位 deliverable→KR | ✅ |
| Project | STAGE3 projects | ✅ |
| Lead | 部門 owner→project owner | ✅ |
| Lag Indicators | company targets→KPI pool | ✅ |

### 11-2. 保存・再読込・削除

- **保存:** `useAutoSave` (debounce 1200ms) で自動保存
- **再読込:** `loadAndHydrate` で初期ロード（15秒 timeout）
- **削除:** OKR soft-delete → cascade cleanup

### 11-3. STAGE5 への引継ぎ

**実装:** OKR→Progress Log、Project→Execution Checkin の自動認識

### 11-4. 判定

**実装進捗:** 60% - Data inheritance と Save/Load 完成。STAGE5 引継ぎ部分的

---

## 12. STAGE5（実行・進捗管理）実装状態

### 12-1. 主要機能

| 機能 | 実装 | 詳細 |
|------|------|------|
| STAGE4 データ引継ぎ | ✅ | Project、KPI、Lead 情報を保持 |
| Check-in 保存 | ✅ | progress_logs テーブルに保存 |
| AI 相談 | ✅ | assist-execution API で LLM consultation |
| 権限チェック | ✅ | company member 確認 |
| Cleanup-deleted-projects | ✅ | soft-delete 実装 |

### 12-2. Rate Limit

**修正済み:** `/api/stage5/assist-execution` を middleware matcher に追加

### 12-3. 判定

**実装進捗:** 50% - Check-in save・AI consultation API 完成。UI 統合不確実

---

## 13. STAGE6（業績・インパクト管理）実装状態

### 13-1. 機能実装

| 機能 | 実装 | 詳細 |
|------|------|------|
| STAGE5 進捗との接続 | ✅ | progress_logs aggregation |
| Impact × Progress 計算 | ✅ | revenueContributionMJPY 計算 |
| Baseline/Improvement/Growth | ⚠️ 部分 | UI tabs で表示のみ |
| STAGE4 KPI 接続 | ✅ | North Star metrics で追跡 |
| Gap Detection | ✅ | ReviewCandidatesSection で表示 |

### 13-2. Feedback Loop（業績ギャップ→STAGE3/4 見直し）

**実装:** UI-based detection のみ（自動フィードバック無し）
- "STAGE3 で見直す" / "STAGE4 で見直す" ボタン = 画面遷移のみ
- データが STAGE3/4 へ自動反映される仕組みなし

### 13-3. 判定

**実装進捗:** 40% - Progress aggregation・Gap detection 完成。Auto feedback loop・反映 実装なし

---

## 14. 組織変革 / すり合わせルーム（重点監査）

**理想フロー:** 違和感入力→従業員認識推定→会社・組織認識推定→認識差・原因推定→論点化→すり合わせルーム→会議結論→STAGE3/4 反映→実際に反映

### 14-1. 15 工程の実装状況

| # | 工程 | 実装状態 | ファイル |
|---|------|----------|---------|
| 1 | 違和感入力 | ❌ | STAGE2-6 範囲外 |
| 2 | Visibility（匿名/管理者/実名） | UI Only | stage6/page.tsx |
| 3 | AI insight 生成 | API Only | /api/stage5/assist-execution |
| 4 | STAGE1~3 データ参照 | UI Only | リンク表示のみ |
| 5 | Company 認識推定 | Hardcoded | Static logic |
| 6 | 原因推定 | ❌ | 未実装 |
| 7 | Shared topic 化 | ❌ | 未実装 |
| 8 | Alignment room 自動反映 | ❌ | Manual trigger only |
| 9 | 管理者手動操作 | Hardcoded | Admin で直接編集推定 |
| 10 | 会議結論入力 | ❌ | UI フォーム未実装 |
| 11 | Reflection candidate 生成 | UI | Detection のみ |
| 12 | STAGE3 反映 | Mock | 遷移のみ |
| 13 | STAGE4 反映 | Mock | 遷移のみ |
| 14 | 反映済み Status | ❌ | 未実装 |
| 15 | 反映履歴 | ❌ | 未実装 |

### 14-2. データフロー

**現状:** STAGE3/4 への自動反映なし - ユーザーが手動で画面を開いて修正が必要

### 14-3. 判定

**実装進捗:** 20% - ほぼ UI ボタン・リンク表示のみ。実装は組織変革/すり合わせルーム全体で未実装に近い

---

## 15. PDF / Export

### 15-1. STAGE3 PDF

**含まれるべき内容:**
- ✅ 最終部門戦略
- ✅ 6 テーマへの回答
- ✅ 再考ポイント
- ⏳ 横断論点（実装不確実）
- ✅ STEP3/STEP4 で確定した内容
- ✅ KPI/project 情報

**状態:** 基本要素は実装。横断論点は未実装の可能性

### 15-2. STAGE4 PDF

**含まれるべき内容:**
- Objective、Key Results、Project、Owner、Due Date、KPI

**状態:** コード実装あり。実機テスト未実施

### 15-3. 判定

**実装済み・実機未確認** - PDF 生成コード存在するが、実際の出力内容・形式・欠落を確認していない

---

## 16. 全 STAGE 横断のデータ整合性

### 16-1. テスト可能な状態

**実施可能性:** テスト用ダミーデータで検証可能

### 16-2. 確認すべき項目

| 項目 | 状態 |
|------|------|
| ID が途中で変わらない | ⏳ 未検証 |
| Duplicate されない | ⏳ 未検証 |
| Deleted data が復活しない | ✅ 実装確認（soft-delete） |
| Company が混ざらない | ✅ API 層での company チェック確認 |
| UI state だけでなく DB に保存 | ✅ autosave + DB upsert 確認 |
| DB から復元される | ✅ loadAndHydrate 確認 |
| 古い local state が DB を上書きしない | ⏳ 未検証 |

### 16-3. 判定

**実装済み・実機未確認** - コード実装は根拠があるが、エンド・ツー・エンドの動作確認なし

---

## 17. 修正・未完了・判定サマリー

### 17-1. 修正済み

| 項目 | 修正内容 | 状態 |
|------|---------|------|
| `/api/stage5/assist-execution` matcher 漏れ | `/api/stage5/assist-execution` を config.matcher に追加 | ✅ |
| middleware Duration 型エラー | Duration 型をインポート・createRateLimiter の型変更 | ✅ |
| NextRequest.ip 型エラー | req.ip を削除 | ✅ |
| Build エラー | 解決 | ✅ |

### 17-2. P0 - 即座に対応必須

| # | 項目 | 理由 | 必要作業 |
|---|------|------|--------|
| 1 | API CRITICAL 3 件 | company ID 検証漏れ→他社データ削除・アクセス | `/api/admin/data-management/delete-all` 等の修正 |
| 2 | 利用規約・プライバシー未実装 | 法的リスク | /terms /privacy 正式版作成 + user_agreements 実装 |
| 3 | Console 出力 CRITICAL 52 件 | 機密情報漏洩リスク | 削除またはマスク化 |

### 17-3. P1 - PoC 開始前に推奨

| # | 項目 | 理由 | 必要作業 |
|---|------|------|--------|
| 1 | npm 脆弱性（根本対策不可） | xlsx/tar/undici に No fix available | セル値検証・Connection: close・バージョン統一 |
| 2 | 招待フロー token ブルートフォース | Token 試行回数制限なし | Token 単位の制限追加 |
| 3 | Incident Response Plan 要記入 | 運用体制未決定 | 17 箇所の記入・PoC 開始前に合意 |
| 4 | `/api/invites/info` 認証なし | Invitation 情報が無認証で取得可能 | Bearer Token 認証追加 |
| 5 | Rate Limit 実機テスト | 429 レスポンス・fail-open 動作確認なし | 本番相当環境でのテスト |

### 17-4. P2 - 品質改善

| # | 項目 | 理由 | 必要作業 |
|---|------|------|--------|
| 1 | 組織変革/すり合わせルーム 80% 未実装 | ほぼ UI のみ・STAGE3/4 反映なし | 反映フロー実装 |
| 2 | STAGE3 横断論点検知 | 未実装 | 自動検知機能追加 |
| 3 | STAGE6 自動フィードバック | Manual workflow のみ | Scheduled feedback analysis |
| 4 | PDF 実機テスト | 出力内容・形式未確認 | テストデータで PDF 生成確認 |
| 5 | 全 STAGE データ整合性エンド・ツー・エンドテスト | コード実装に基づくが動作確認なし | Smoke test 作成・実行 |

### 17-5. 実装済み・実機未確認

| 項目 | 実装 | 実機確認 | 状態 |
|------|------|----------|------|
| Rate Limit middleware 到達 | ✅ | ❌ | コード実装確認、本番環境での到達未確認 |
| 429 HTTP レスポンス | ✅ | ❌ | コード実装確認、実際の 429 受信未確認 |
| IP 検出（Vercel 本番） | ✅ | ❌ | ヘッダーベース実装、Vercel 環境での動作未確認 |
| PDF 生成 | ✅ | ❌ | コード実装確認、出力形式・内容未確認 |
| STAGE1~6 データ整合性 | ✅ | ❌ | API・DB 実装確認、エンド・ツー・エンドテスト未実施 |

### 17-6. 過去の問題だが現在解消済み

| 項目 | 過去の問題 | 現在の状態 |
|------|-----------|----------|
| npm 脆弱性（dev-time） | postcss/brace-expansion/js-yaml | Build-time/dev-time のみで runtime 無影響 |
| API 認証（STAGE 系） | 認証チェック疑い | 全 STAGE generate API で membership + role 確認実装済み |
| Cascade 削除 | 旧ロジック残存疑い | ソフトデリート + cleanup で完全実装 |

### 17-7. 判定不能

| 項目 | 理由 |
|------|------|
| RLS migration 実DB 適用状況 | Supabase 実DB アクセス不可のため確認不可 |
| Upstash 環境変数不足時の fail-open 動作 | 環境構築必要 |
| IP 取得が Vercel 本番で期待通り機能するか | 本番環境での実行確認必要 |

---

## 18. PoC 開始前の最小必須作業

1. **CRITICAL API 3 件の修正** - Company ID 検証漏れ対応
2. **利用規約・プライバシー正式版作成** - 法的要件満たし
3. **Console CRITICAL 52 件削除/マスク化** - 機密情報漏洩防止
4. **Incident Response Plan 完成** - PoC 提供先と合意

---

## 19. 推奨実装順（依存関係を考慮）

1. **API CRITICAL（1-2 日）** - company ID 検証、query parameter 検証
2. **利用規約・プライバシー・同意フロー（2-3 日）** - 法的対応
3. **Console log 削除/マスク化（1 日）** - 機密情報対応
4. **招待フロー token 制限（1 日）** - セキュリティ強化
5. **npm 脆弱性代替対策（3-5 日）** - セル値検証、Connection: close
6. **Incident Response Plan 完成（1 日）** - 運用体制確保
7. **Rate limit・IP 取得の本番検証（1 日）** - 実機確認
8. **STAGE データ整合性 smoke test（2 日）** - 機能動作確認

---

## 20. 最終結論

**現在の GROWTH SHIFT は PoC 開始を止めるべき重大セキュリティリスク（P0）が 3 件存在します。**

特に、API の company ID 検証漏れは他社データの削除・アクセスを許容し、利用規約・プライバシーポリシー未実装は法的要件を満たしていません。

**必須対応:**
- API CRITICAL 3 件の修正（即日）
- 利用規約・プライバシー実装（PoC 前）
- Console log CRITICAL 削除（PoC 前）

**これら対応後、実装進捗 50～80% の STAGE2～6 と組織変革/すり合わせルーム（20%）については、PoC 中の動作確認と段階的改善で対応可能と判断されます。**

---

**監査実施:** 2026-08-31  
**実施者:** AI Assistant  
**根拠:** コード実装・migration ファイル・API エンドポイント・npm audit の実調査に基づく
