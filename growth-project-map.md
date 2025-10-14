# GROWTH Project Map（作成日: 2025-10-12）

> このドキュメントは、ChatGPTへのキャッチアップ用 “単一の参照点” です。  
> 新規/更新ファイルや進行タスクをここに集約します。

---

## 0. ルート構成（役割メモ）

- **app/** … Next.js App Router（ページ/ルート/API）
- **components/** … 再利用UI（画面断片）
- **hooks/** … React hooks
- **lib/** … 副作用のないドメインロジック（AI/計算/採点/シミュレーション）
- **store/** … Zustand等のグローバル状態
- **types/** … 型定義（**単一の真実**）
- **utils/** … 外部I/Oや環境依存（Supabase/Fetch等）
- **public/** … 静的アセット
- **archive/** … 旧実装/保留（参照のみ）

---

## 1. app/ 配下（ページ & API）

### 1.1 ページディレクトリ
- `app/admin/*` … 管理画面（招待/メンバー）
- `app/auth/*` … 認証導線（welcome等）
- `app/cascade/*` … 部門戦略の連鎖（Cascade）
- `app/execution/*` … 実行/進捗（OKR編集・ログ）
- `app/login/*`, `app/signup/*`, `app/signup-admin/*` … ログイン/サインアップ
- `app/okr/*` … 目標/成果表示（OKR UI）
- `app/onboarding/*` … 初期導線（STAGE1ステップUI）
- `app/review/*` … 出力レビュー（AI講評）
- `app/story-process/*` … 戦略ストーリー生成フロー
- `app/strategy/*` … 戦略ダッシュボード

> **運用方針**：ページは極力“薄く”、ビジネスロジックは **lib/** と **utils/** に寄せる。

### 1.2 APIルート（現状）
- `app/api/_shared/*` … 共通ユーティリティ
- 生成系：  
  `generate`, `generate-advice`, `generate-cascade`,  
  `generate-department-draft`, `generate-department-question`,  
  `generate-department-summary`, `generate-final-story`,  
  `generate-ot`, `generate-projects-only`, `generate-question`,  
  `generate-story-draft`, `generate-story-draft-v2`, `generate-strategy`
- 推奨/推薦系：`recommend-exec-patterns`, `recommend-top-patterns`
- 連携系：`ask-ceo-agent`, `knowledge`
- OKR連携：`okr-from-exec`
- 組織/権限：`admin/*`, `members/*`, `companies/*`（例：`companies/provision`）

> **TODO（整理方針）**  
> - 生成系APIを `app/api/generate/*` に**集約**（URL互換は維持）  
> - 後方互換のため、旧エンドポイントはしばらく**リダイレクト**対応

---

## 2. components/（UI断片）

- `components/execution/*` … 実行・OKR関連UI
- `components/guide/*` … ガイド/ステッパー（質問ドリル）
- `components/home/*` … トップ/ホーム断片
- `components/inputs/*` … 入力系部品（スライダー/テキスト等）
- `components/steps/*` … ステップ型UI（STAGE1～）
- `components/story/*` … ストーリー表示
- `components/ui/*` … 汎用UI（Button/Card等）

> **命名ルール**：  
> - ドメイン固有 = `components/{feature}/`  
> - 汎用 = `components/ui/`（shadcn互換）

---

## 3. lib/（副作用なしロジック）

- `lib/agent/*` … エージェント系（プロンプト/整合ロジックの一部）
- `lib/supabase/*` … Supabase関連ロジック（※将来的に utils/supabase へ寄せ）
- **（追加予定）**  
  - `lib/simulation/threeYear.ts` … 3年シミュレーション（決定論）  
  - `lib/simulation/impactModel.ts` … 施策→財務 影響モデル  
  - `lib/scoring/consistencyScorer.ts` … 戦略の一貫性スコア  
  - `lib/scoring/alignmentLocal.ts` … 目標/成果の戦略適合ローカル採点

> **境界**：lib は**純粋ロジック**（I/O禁止）。外部アクセスは utils へ。

---

## 4. utils/（環境依存/外部I/O）

- `utils/supabase/*` … クライアント・保存・RLS・エラー処理

> **設計**：  
> - `utils/supabase/client.ts`（単一クライアント）  
> - `utils/supabase/strategy.ts`（戦略データ入出力）  
> - `utils/supabase/errors.ts`（エラーフォーマット） などへ整理予定

---

## 5. store/（状態管理）

- `store/*` … Zustandストア  
  - 例：`strategyStore.ts`（`financeExt`, `krStructs`, `businessPortfolio` などを搭載予定）

---

## 6. types/（型の単一ソース）

- `types/*`  
  - **必須型（追加/確認）**：  
    - `types/finance.ts`（FinanceExt）  
    - `types/okr.ts`（KRStruct：baseline/target/unit/period…）  
    - `types/portfolio.ts`（BusinessPortfolio：成長×利益マトリクス）  
    - `types/company.ts`（CompanyProfile/MVV/SWOTなど）

> **原則**：UI/ロジック内に**独自型を定義しない**。必要になったら types/ に昇格。

---

## 7. hooks/
- 共通React hooks。副作用のあるものは utils に寄せ、UI密結合は components 内ローカルへ。

---

## 8. archive/
- `archive/2025-08-10_unused/*` … 旧実装の退避  
- `archive/utils/*` … 旧ユーティリティ  
> 参照専用。**復活時は新ディレクトリ規約に合わせて移植**。

---

## 9. STAGE別の合流点（現/今後）

- **STAGE1（経営情報入力）**  
  - ページ：`app/onboarding/*` or `app/story-process/*`  
  - UI：`components/steps/*`, `components/inputs/*`  
  - 型：`types/company.ts`, `types/portfolio.ts`, `types/finance.ts`  
  - 保存：`utils/supabase/strategy.ts`

- **STAGE2（戦略ストーリー生成）**  
  - ページ：`app/story-process/*`  
  - API：`app/api/generate/*` に集約  
  - ロジック：`lib/agent/*`, `lib/scoring/consistencyScorer.ts`

- **STAGE3（部門戦略・目標/成果）**  
  - ページ：`app/execution/*`, `app/okr/*`  
  - UI：`components/execution/*`（OKRModal）  
  - 型：`types/okr.ts`（KRStruct）  
  - 適合：`lib/scoring/alignmentLocal.ts`

- **STAGE4（シミュレーション）**  
  - API：`app/api/simulate/route.ts`（新設）  
  - ロジック：`lib/simulation/threeYear.ts`, `lib/simulation/impactModel.ts`  
  - 表示：`components/charts/*`（後日）

---

## 10. 直近の改修タスク（抜粋）

1. **API集約**：生成系を `app/api/generate/*` に寄せる  
2. **types 追加**：`finance.ts` / `okr.ts` / `portfolio.ts` / `company.ts`  
3. **lib 追加**：`simulation/threeYear.ts` / `scoring/alignmentLocal.ts`  
4. **store 拡張**：`strategyStore.ts` に `financeExt`, `krStructs`, `businessPortfolio`  
5. **STAGE1 UI**：事業ポートフォリオ（成長×利益）マトリクスを追加  
6. **OKR表記**：UIラベルを「目標／成果」に置換（表示層のみ）  
7. **適合チェッカー**：OKRModalにリアルタイムスコア＋保存ガード

---

## 11. アクティブファイル（編集対象）

> ★このリストを“唯一の真実”として毎回更新してください。

- `types/portfolio.ts` … 新規
- `types/finance.ts` … 新規
- `types/okr.ts` … 追記（KRStruct）
- `store/strategyStore.ts` … 追記
- `lib/simulation/threeYear.ts` … 新規
- `lib/scoring/alignmentLocal.ts` … 新規
- `app/api/simulate/route.ts` … 新規
- `components/execution/OKRModal.tsx` … 表示ラベル＆適合カード
- `app/onboarding/*` or `app/story-process/*` … STAGE1 ステップUI

---

## 12. 運用ルール（ChatGPTと並走するために）

- 依頼は先頭行に **「// 修正対象: ファイルパス」** を記載  
- 新規/更新後は **この `growth-project-map.md` と `/devlog/YYYY-MM-DD.md` を更新**  
- 大改修の前に **このファイルを最新化してから** チャットに貼る

---

## 13. 取得したフォルダ一覧（抜粋ログ）

（※ 原文は 3 万行超のため省略。`node_modules/.next/.git/.vercel` は除外済み）
