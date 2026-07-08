# 06. AI・エージェント仕様

本書は、CEOChat エージェント（`ask-ceo-agent`）の処理パイプライン・intent ルーティング・軽量 RAG・ファシリテータプロトコル・各生成 API の内部実装を記述する。

- **関連**: 生成 API の一覧と認証・認可分類は [07]、AI/LLM の監査項目は [08] F カテゴリを参照。

## 1. OpenAI クライアント

- `lib/openai.ts` … `export const openai`（`OPENAI_API_KEY` 必須、未設定なら起動時 throw）。
- `lib/openaiClient.ts` … `generateCascadeFromStrategy(strategy)` など個別生成関数。モデルは主に `gpt-4o` / `gpt-4o-mini` 系を使用。
- AI 呼び出しは一部で `agent_logs`（`lib/supabase/agentLogs.ts` `insertAgentLog`）に記録。会話ログはクライアントからの insert 経路を含むため、保持方針・偽造耐性・読み取り分離は監査対象（[08] D-09・K-05）。
- API ルートは原則 `runtime = 'nodejs'`、生成系は `dynamic = 'force-dynamic'`。

## 2. CEOChat / ask-ceo-agent（`POST /api/ask-ceo-agent`）

戦略コンテキストを読み込み、経営者向けに応答する中核エージェント。UI は `components/CEOChatPanel.tsx`、状態は `store/useAgentStore.ts`。capability は `agent:use`（全ロール可）。

### 2.1 処理パイプライン（`app/api/ask-ceo-agent/route.ts`）

1. **戦略コンテキスト取得**: `getFullStrategyDataByCompany` → `normalizeStrategyData`。OKR サマリ（`buildOKRSummary`）・進捗サマリ（`buildProgressSummary`）・Stage1 インサイト（`buildStage1Insight`）を構築。
2. **モード判定**: `lib/autoModeRouter.ts` `detectAutoMode()` → `'help'`（使い方）/ `'advisor'`（戦略助言）。help 時は `lib/helpPrompt.ts` `buildHelpSystemPrompt()`。
3. **intent ルーティング**: `lib/intentRouter.ts`。
   - `classifyHeuristic()`（キーワード: `MANUAL_HINTS` / `STRATEGY_HINTS`）と `classifyLLM()`（`response_format: json_object`）を `chooseBetter()` で統合。
   - `Stage = 'strategy' | 'manual' | 'generic' | 'hybrid'`、`toWeights()` で知識ソースの重み付け（例: strategy → {strategy:0.75, manual:0.15, generic:0.10}）。
4. **RAG（軽量）**: `lib/rag/`。`getGrowthRagIndex()` でドキュメントをインデックス化（`clearRagCache` でキャッシュ無効化）、`retrieveGrowthKnowledge()` で関連チャンク取得、`buildRagContextBlock()` でプロンプト挿入。型は `RagDoc` / `RagChunk` / `RagHit` / `RagIndex`。固定知識は `lib/growthKnowledge.ts` `pickRelevantKnowledge()`。
5. **ファシリテータプロトコル**: `lib/facilitatorProtocol.ts` `buildFacilitatorBlock()` ＋ `lib/facilitatorSchema.ts`（`buildJSONOutputInstruction` / `safeParseFacilitatorJSON`）。advisor が単なる回答でなく「問いを返して深掘りする」モードを担う。
6. **生成 → 応答**: `openai` で生成。`insertAgentLog` でログ保存。`requestId` を付与。

### 2.2 関連ライブラリ
- `lib/agentPrompt.ts`（システムプロンプト）、`lib/agent/context.ts`（コンテキスト構築）。

## 3. ステージ別の生成 API（intent と独立した個別生成）

| 用途 | API |
|---|---|
| 質問生成（12 問・章ステップ） | `/api/generate-question`（`helpers.ts`: `TEMPLATE12`）, `/api/generate-department-question` |
| ヒント・例示・助言 | `/api/generate-hint`, `/api/generate-example`, `/api/generate-advice` |
| 戦略ストーリー | `/api/generate-story-draft`, `/api/generate-story-draft-v2`, `/api/generate-final-story`, `/api/generate-strategy` |
| 勝ち筋パターン推薦 | `/api/recommend-top-patterns`, `/api/recommend-exec-patterns` |
| カスケード生成 | `/api/generate-cascade`, `/api/generate-department-draft` |
| OT/OKR | `/api/generate-ot`, `/api/okr-from-exec` |
| Stage 別パイプライン | `/api/stage2/generate-draft`, `/api/stage2/generate-final`, `/api/stage3/generate-strategy-bridge`, `/api/stage4/generate-execution-draft`, `/api/stage5/assist-execution`, `/api/stage5/execution-summary` |
| インサイト/組織変革 | `/api/generate-insight`, `/api/org-alignment/generate`, `/api/org-alignment/admin/insights/generate` |
| 汎用 | `/api/generate` |

> Deprecated: `/api/generate-department-summary` と `/api/knowledge` は後方互換用に route が残るが、現行実装では GET/POST とも 410 Gone を返す。

## 4. 共有ユーティリティ（`app/api/_shared/utils.ts`）

- `toTextStory(story)` … 多様な形式（string / `ChapterStory[]` / `{text}` / `{chapters}` / ネスト `finalStory`）を再帰的にプレーンテキスト化。プロンプト投入時の正規化に使用。
- 安全 JSON 抽出（コードフェンス `` ```json `` 対応の堅牢パーサ）。

## 5. 戦略ナレッジ・パターン資産（`lib/`）

- `strategyPatterns.catalog.ts` / `.top.ts` / `.exec.ts` / `.map.ts` … 勝ち筋・実行パターンのカタログとマッピング。
- `winPatterns.ts` / `questionSeeds.ts` / `growthKnowledge.ts` … 勝ち筋定義・質問シード・固定ナレッジ。
- `patternLinker.ts` … パターン間リンク。
- `okrTemplates.exec.ts` … 実行 OKR テンプレート。

## 6. 注意点

- intent / mode 判定はヒューリスティック + LLM の二段で、LLM パース失敗時は `generic`（信頼度 0.4）にフォールバックする（沈黙失敗を避けるためログを残す）。
- RAG はあくまで **保存済み戦略データ + docs の知識**を入力に使う設計で、「自動学習で精度向上」する仕組みではない（`docs/_md_dump/stage5.md` の但し書きと整合）。

---

## 変更履歴

| 日付 | 変更内容 | 変更者 |
|---|---|---|
| 2026-06-22 | 初版（基準コミット `f7b9c03`） | 仕様書作成（Claude Code） |
| 2026-07-06 | 表記統一（目的宣言・関連文書・監査参照の [08] 項目 ID 化・変更履歴の追加） | ドキュメント整備（Claude Code） |
