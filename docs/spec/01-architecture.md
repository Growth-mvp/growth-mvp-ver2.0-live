# 01. アーキテクチャ

本書は、技術スタック・ディレクトリ構成・レイヤ責務・状態管理（`strategyStore`）・データフロー（保存/復元）・同時利用時の整合性を記述する。

- **関連**: データモデルの詳細は [02]、認証・RBAC は [03]、非機能面（同時編集の恒久対応等）は [09] を参照。

## 1. 技術スタック（`package.json` より）

| 領域 | 採用技術 |
|---|---|
| フレームワーク | Next.js `^15.3.6`（App Router）、React `^18.2.0` |
| 言語 | TypeScript `^5.4.5` |
| 状態管理 | Zustand `^5.0.6`（`persist` / `createJSONStorage`） |
| 認証/DB | Supabase（`@supabase/ssr` `^0.6.1`、`@supabase/supabase-js` `^2.55.0`、`@supabase/auth-helpers-nextjs`） |
| AI | OpenAI SDK `^5.8.2`、Vercel AI SDK `ai` `^4.3.16` |
| 可視化 | recharts `^3.2.1`、reactflow `^11.11.4`（+ `react-flow-renderer` 互換）、framer-motion |
| 帳票/出力 | jspdf、html2pdf.js、html2canvas、xlsx、papaparse、pdf-parse |
| UI | Tailwind CSS `^3.4.17`、Radix UI（dialog/tabs）、lucide-react |
| デプロイ | Vercel |

### スクリプト

- `dev` / `dev:3000` / `dev:3001` / `dev:3002` / `dev:lan` … 開発サーバ
- `build` / `start` … 本番ビルド/起動
- `lint` / `type-check` … ESLint / `tsc --noEmit`
- `stage3:smoke` … `scripts/stage3.smoke.mjs`（カスケードのスモークテスト）
- `rbac:check` / `rbac:e2e:min` … RBAC 検証スクリプト

## 2. ディレクトリ構成

```
app/                 App Router。ページ（各ステージ）と API（app/api/）
  api/               Route Handler 61 本（2026-07 時点。AI 生成・管理・認証・組織変革 など。一覧は [07]）
  stage1/ stage2/    Stage 1/2 ページ
  cascade/           Stage 3（部門カスケード）本体
  okr/               Stage 4（実行計画）本体
  execution/         Stage 5（実行支援）
  stage6/            Stage 6（業績シミュレーション）
  org-transformation/  組織変革ルーム（個人 / shared）
  admin/             管理者画面
  auth/ login/ signup/ invite/ onboarding/  認証・招待・オンボーディング
  report/            レポート出力
components/          画面別コンポーネント（stage1〜6, export, org-alignment, ui, ...）
store/               Zustand ストア（strategyStore, userStore, questionStore, ...）
lib/                 ドメインロジック・AI（rbac, openai, intentRouter, rag/, strategyPatterns.*, ...）
  server/            server-only ガード（rbacGuard）
  rag/               軽量 RAG（indexer / retriever / prompt / types）
services/            ビジネスロジック層（okrService）
types/               ドメイン型（strategy, okrs, portfolio, financeSummary, org-alignment）
utils/               永続化・正規化・計算（supabase/, persist/, valueAnalysis ほか）
hooks/               React フック（useAutoSave, useAuthGuard, useCapabilities, PDF export 系）
context/             CompanyContext
supabase/            DB マイグレーション（supabase/migrations/）
```

## 3. レイヤ構成と責務

```
[ページ/コンポーネント]  app/**, components/**
        │  読み書き
[ストア]                store/strategyStore.ts（Zustand, 会社状態のミラー＋保存導線）
        │  委譲
[サービス]              services/okrService.ts（OKR の resolve/merge）
        │
[永続化(リポジトリ)]     utils/supabase/*（strategy 保存・okrsRepository・normalize）
        │
[DB]                    Supabase（Postgres + RLS）
```

- **API 層**（`app/api/**`）は、AI 生成・管理操作・サーバ専用処理を担う。書き込み API は `lib/server/rbacGuard.ts` の Bearer 検証・membership・capability・スコープ検証を通す（[03-auth-rbac.md](./03-auth-rbac.md)）。
- **`lib/rbac.ts`** が権限マトリクスの単一ソース（UI/API 共用）。

## 4. 状態管理：`strategyStore`（Zustand）

`store/strategyStore.ts`（約 4,500 行）が中核。会社の `strategy_data` をクライアント側にミラーする巨大ストア。

主な責務:
- Stage1〜6 の全状態を 1 ストアに保持（会社プロフィール・財務 PL/BS・セグメント・ValueAnalysis・SWOT/MVV・story/finalStory・departments/projects/OKR・companyTargets・stage4Plans・projectTargetImpacts・simulationResult 等）。
- `buildSavePayload()` で保存ペイロード（`StrategyData` 相当）を組み立て、`saveStrategyData()` でサーバ保存。
- `refetchFromServer()` でサーバから復元、`hydrateFromFullState()` でストアへ反映。

### 4.1 保存の直列化

```ts
let __saveChain: Promise<void> = Promise.resolve();
function enqueueSave<T>(fn) { /* __saveChain に連結し、保存を直列実行 */ }
```

全保存はチェーンで直列化され、並行保存による競合を防ぐ。

### 4.2 楽観ロックと競合回復

- `revision`（サーバ楽観ロック）、`version`（ローカル更新カウンタ、dirty 検出）を保持。
- 競合検出時のために `lastConflictInfo` / `conflictCooldownUntil` / `pendingConflictRecovery` を持ち、競合回復フローを実装。
- `lastServerSnapshot`（ハッシュ）・`__lastSavedHash` で無駄保存を抑止（`isEffectivelyEmpty` で空ペイロード保存を回避）。

### 4.3 hydrate / restore ガード

- `boot: { isHydrating, isHydrated, isSaving, isRestoring }`、`restoreReady` / `isRestoring` でリロード時のデータ消失（autosave との競合）を防止。
- `ensureParentExists()` で `strategy_data` 親レコードの存在を保証してから子データを保存する。

### 4.4 自動保存

- `hooks/useAutoSave.ts` が編集をトリガに保存導線を呼ぶ。
- `utils/persist/saveWithAudit.ts` 経由で監査ログ付き保存を行う。永続監査ログは `audit_logs` テーブルと `lib/server/auditLog.ts` も併用されるが、対象操作の網羅と本番 DB 適用状況は監査対象。
- 保存状態は `SaveStatusIndicator` / `GlobalSidebarSaveStatus` で可視化。

### 4.5 複数ユーザーの同時利用とコンテキスト共有

全社員が同一会社のデータを扱う前提のため、コンテキストの共有/分離を整理する。

- **AI 会話コンテキストはユーザー間で共有されない（私的）**:
  - `store/useAgentStore.ts` は **in-memory のみ**（`persist` なし）→ CEOChat の会話はブラウザタブ単位で、リロードで消える。
  - `ask-ceo-agent` はコンテキストを**毎回リクエストの `messages` ＋会社の `strategy_data`/進捗から構築**し、`agent_logs` は**書込専用**（アプリ内に `select` 箇所なし）。→ 他ユーザーのチャットが混ざる/見える経路はない。
  - 共有されるのは「下敷きの会社 `strategy_data`」のみ（設計どおり。会社単位スコープ）。
- **編集できるロールは限定される（設計意図）**: `strategy:edit` は **admin / manager のみ**（member は不可）、`department:edit` は **manager は自部門のみ**（[03] §3.2）。→ 同時編集"者"の人数は役割で絞られる。
  - ただしこの制限は **UI 判定 + RLS の二段のみで、サーバ API では強制されない**（書込はクライアント直書きのため。[02] §1.1 ★、監査項目は [08] D-05）。member の編集不可は RLS のロール条件に依存する。リポジトリには `20260628_fix_strategy_data_rls_role_control.sql` が存在するが、Stage4 との整合理由で PoC 適用はリスク受容扱いになっており、実環境での適用有無は監査で確認する。
- **共有ドキュメント `strategy_data` の同時編集**:
  - 1 会社 1 行。保存は**常に全状態（全文書）を書込**（`buildSavePayload`）。
  - 競合制御は **同一ブラウザ内 = `enqueueSave` 直列化／ユーザー間 = `revision` 楽観ロック＋競合回復（`refetchFromServer`）**。
  - **部門スコープでも衝突は防げない**: manager が「自部門だけ」を編集しても保存は会社の文書を丸ごと上書きするため、**別部門を編集する manager 同士でも後勝ち（lost update）**が起こりうる。役割/部門分担は編集者の人数・担当範囲を分けるが、**全文書保存ゆえ技術的な衝突は残る**。
  - **例外（衝突しにくい部分）**: OKR の中身は `okrs` テーブルに**行単位**で保存されるため文書衝突の対象外。一方、部門ミッション・プロジェクト構成・Stage1/2（財務・MVV・ストーリー）・Stage4 計画は**ブロブ側＝全文書衝突**の対象。
  - **限界**: フィールド単位マージ・編集ロック・presence・リアルタイム購読は**未実装**。競合は検出されるが回復は refetch ベースで、**未保存のローカル編集が失われる可能性**がある。
  - 運用緩和: 編集担当の分担・こまめな保存（ただし上記のとおり部門分担だけでは不十分）。恒久対応は [09] のバックログ（presence 表示／フィールド単位保存／リアルタイム同期）。

## 5. データフロー（典型）

### 読込（ページマウント時）
```
ページ → loadAndHydrate(utils/loader) → getFullStrategyDataByCompany(supabase)
      → normalizeStrategyData → store.hydrateFromFullState() → 画面描画
OKR は別途 okrService.resolveProjectsWithOkrs() で okrs テーブル優先マージ
```

### 保存（編集時）
```
編集 → store の setter（dirty=true, version++）
     → useAutoSave / 明示保存 → store.saveStrategyData()
     → enqueueSave → buildSavePayload() → saveStrategyDataApi()（楽観ロック revision 付き）
     → 成功: revision/updatedAt 反映 / 競合: 回復フロー
```

## 6. その他の実装方針

- **デバッグフラグ**: `NEXT_PUBLIC_DEBUG_HYDRATE`, `NEXT_PUBLIC_DEBUG_CASCADE` 等の env で詳細ログを切り替え。
- **後方互換**: 型追加は optional 基本、`ExtensibleString` で列挙の拡張を許容、`pruneUndefinedDeep` で保存前に空値を除去。
- **ID 補完**: department/project の `id` 欠落時に `dept_${idx}` / `proj_${i}_${j}` を暫定付与（Stage5 保存失敗の緊急対策）。

---

## 変更履歴

| 日付 | 変更内容 | 変更者 |
|---|---|---|
| 2026-06-22 | 初版（基準コミット `f7b9c03`。以後 §4.5 同時利用の整理等を追記） | 仕様書作成（Claude Code） |
| 2026-07-06 | 表記統一（目的宣言・関連文書・時点付き数値・旧08 参照の [08] 項目 ID への更新・変更履歴の追加） | ドキュメント整備（Claude Code） |
