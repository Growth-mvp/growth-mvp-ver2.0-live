# 00. プロダクト全体像

本書は、GROWTH プロダクトの全体像（6 ステージ＋並行機能・中核データ概念・ロール・AI の関与・設計上の重要前提）を俯瞰する導入ドキュメントである。各論は [01]〜[07] に委譲する。

- **関連**: [01-architecture](./01-architecture.md) / [02-data-model](./02-data-model.md) / [03-auth-rbac](./03-auth-rbac.md) / [04-stages](./04-stages.md) / [05-org-alignment](./05-org-alignment.md) / [06-ai-and-agent](./06-ai-and-agent.md) / [07-api-reference](./07-api-reference.md)

## 1. 目的

GROWTH は、企業価値の把握・向上を「分析 → 戦略 → 実行 → 検証」の一連のサイクルとして運用するための統合プラットフォームである。
経営者・経営企画が、財務分析から戦略策定、部門への展開、実行支援、業績シミュレーションまでを 1 つのデータモデル上で連動させる。

## 2. 全体フロー（6 ステージ）

```
Stage 1 企業価値分析    /stage1     財務データ → 5指標(ROIC/WACC/PBR/成長率/利益率) と論点抽出
   ↓
Stage 2 全社戦略策定    /stage2     MVV/SWOT → 勝ち筋 → 12問仮説検証 → 統合戦略ストーリー & North Star
   ↓
Stage 3 部門カスケード  /cascade    全社戦略 → 部門ミッション → プロジェクト → OKR
   ↓
Stage 4 実行計画策定    /okr        OKR を実行計画（役割/財務インパクト/承認ステータス/ベースライン）へ
   ↓
Stage 5 実行支援        /execution  進捗ログ・チェックイン・AI 支援
   ↓
Stage 6 業績シミュレーション /stage6  プロジェクト/OKR の業績(PL/ROIC)への寄与をシナリオ試算
```

加えて、ステージ群と並行して動く機能として:

```
組織変革・違和感ルーム    /org-transformation         個人が違和感(ケース)を AI 対話で言語化・分類
組織変革・全社すり合わせ  /org-transformation/shared  会社全体の集計・インサイト・共有トピック・すり合わせ依頼
レポート                  /report                     各ステージの成果を PDF 等で出力
管理者                    /admin/*                    メンバー・招待・データ管理・組織インサイト
```

> **ルート名の注意**: ナビゲーション（`components/Sidebar.tsx`）上、Stage 3 は `/cascade`、Stage 4 は `/okr` を指す。
> `/stage3` は `/cascade` への互換リダイレクト、`/stage4` は旧実装が残置されている（[04-stages.md](./04-stages.md) 参照）。

## 3. 中核となるデータ概念

| 概念 | 説明 | 主な格納先 |
|---|---|---|
| Company（会社） | マルチテナントの単位。全データの分離境界 | `companies` |
| Membership（所属） | ユーザー × 会社 × ロール × 担当部門 | `company_members` |
| StrategyData（戦略データ） | 1 会社 1 レコードの巨大 JSONB ブロブ。Stage1〜6 の入力/成果の大半を保持 | `strategy_data` |
| Department（部門） | 部門ミッション・所属プロジェクト | `strategy_data.departments`（JSONB） |
| Project（プロジェクト） | 部門配下の実行単位。財務インパクト・承認ステータスを持つ | `strategy_data.departments[].projects`（JSONB） |
| OKR | Objective + Key Results。**正本は `okrs` テーブル**、`strategy_data` 内はスナップショット | `okrs`（正本） / JSONB（fallback） |
| ProgressLog（進捗ログ） | Stage 5 のチェックイン履歴 | `progress_logs` |
| Org Alignment Case | 組織の違和感ケース（個人ルームの成果） | `org_alignment_cases` 系 |

詳細は [02-data-model.md](./02-data-model.md)。

## 4. ユーザーとロール

3 つのロールがある（詳細は [03-auth-rbac.md](./03-auth-rbac.md)）。

- **admin（管理者）**: 会社全体の戦略・メンバー・設定を管理。全ステージ編集可。
- **manager（マネージャー）**: 戦略編集・自部門の編集が可能。メンバー管理・部門削除は不可。
- **member（メンバー）**: 閲覧と Stage 5 進捗入力、AI コンサルタント利用が中心。戦略編集不可。

## 5. AI の関与

各ステージで OpenAI による生成・診断を行う（[06-ai-and-agent.md](./06-ai-and-agent.md)）。

- **CEOChat / ask-ceo-agent**: 戦略コンテキスト（`strategy_data` + 進捗 + OKR）を読み込み、advisor / facilitator として応答。intent ルーティング・軽量 RAG・ファシリテータプロトコルを備える。
- **各ステージの生成 API**: 質問生成・たたき台生成・戦略ブリッジ・実行ドラフト・要約・インサイト集計など。API Route Handler は 61 本（2026-07 時点。最新の本数と一覧は [07] 参照）。

## 6. 設計上の重要な前提

1. **会社単位の単一 `strategy_data` 集約** … Stage1〜6 の状態の大半は 1 レコードの JSONB に集約され、`strategyStore`（Zustand）がそのミラーとなる。
2. **保存の直列化と楽観ロック** … 保存は `enqueueSave` で直列化、`revision` で楽観ロックし競合回復フローを持つ（[01-architecture.md](./01-architecture.md)）。
3. **OKR の二重ソース** … 正本は `okrs` テーブル、`strategy_data` 内 OKR はスナップショット。読込時に DB 優先でマージする（`services/okrService.ts`）。
4. **後方互換最優先** … 型は基本 optional 追加、JSONB 互換を壊さない方針（`types/strategy.ts` 冒頭コメント参照）。

---

## 変更履歴

| 日付 | 変更内容 | 変更者 |
|---|---|---|
| 2026-06-22 | 初版（基準コミット `f7b9c03`） | 仕様書作成（Claude Code） |
| 2026-07-06 | 表記統一（目的宣言・関連文書・時点付き数値・変更履歴の追加） | ドキュメント整備（Claude Code） |
