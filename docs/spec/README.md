# GROWTH 実装仕様書（Implementation Specification）

> 本ディレクトリは **現在のコードベース（`growth-mvp` v0.2.0）の実装をベースに**記述した仕様書です。
> ユーザー向けの操作ガイド（`docs/_md_dump/` の `overview.md` / `stageN.md` など）が「使い方」を説明するのに対し、
> こちらは **「何がどう実装されているか」** を、ソースコードの構造・データモデル・API・権限制御に即して記述します。
>
> 作成日: 2026-06-22 ／ 対象ブランチ: `main` ／ 仕様が参照したコードの基準コミット: `f7b9c03`（作成時点の `main` HEAD）
>
> ※ 以後コードが変わった場合は、本仕様の根拠コミットと差分を確認すること。

---

## このプロダクトは何か

**GROWTH** は、経営者・経営企画が「企業価値分析 → 全社戦略 → 部門カスケード → 実行計画 → 実行支援 → 業績シミュレーション」の
6 ステージを一気通貫で回すための、AI 支援つき戦略経営プラットフォームです。
加えて、現場の違和感を吸い上げて全社のすり合わせにつなげる「組織変革ルーム（Org Alignment）」を備えます。

- フレームワーク: **Next.js 15（App Router）/ React 18 / TypeScript**
- 状態管理: **Zustand**（`persist` でローカル永続化）
- バックエンド/認証/DB: **Supabase（Postgres + Auth + RLS）**
- AI: **OpenAI（`gpt-4o` 系）** ＋ 自前の軽量 RAG・ファシリテータプロトコル
- マルチテナント: **会社（company）単位**でデータ分離、**RBAC（admin / manager / member）**

---

## ドキュメント構成

| ファイル | 内容 |
|---|---|
| [00-overview.md](./00-overview.md) | プロダクト全体像・6 ステージ＋組織変革ルームの俯瞰・主要ドメイン概念 |
| [01-architecture.md](./01-architecture.md) | 技術スタック・ディレクトリ構成・データフロー（保存/復元）・主要な実装方針 |
| [02-data-model.md](./02-data-model.md) | ドメイン型（`types/`）・Supabase テーブル・`strategy_data` JSONB ブロブ・OKR 正本化 |
| [03-auth-rbac.md](./03-auth-rbac.md) | 認証フロー・会社スコープ・RBAC 権限マトリクス・招待（invite）・API ガード |
| [04-stages.md](./04-stages.md) | Stage 1〜6 の機能仕様（画面・入力・出力・関連 API・データの流れ） |
| [05-org-alignment.md](./05-org-alignment.md) | 組織変革ルーム（個人ルーム / 全社すり合わせルーム）の仕様 |
| [06-ai-and-agent.md](./06-ai-and-agent.md) | CEOChat エージェント・intent ルーティング・ファシリテータ・RAG・各種生成 API |
| [07-api-reference.md](./07-api-reference.md) | `app/api/` 全エンドポイント一覧と分類 |
| [08-security-review.md](./08-security-review.md) | セキュリティレビュー（発見・IPA「安全なウェブサイトの作り方」対応・監査ログ・改善点・外部クライアント PoC までのステップ） |
| [09-non-functional-requirements.md](./09-non-functional-requirements.md) | 非機能要件（IPA「非機能要求グレード」6 大項目に沿った現状評価・PoC 目標水準・ギャップ） |

---

## 凡例・読み方の注意

- **【実装済み】** … 現コードで動作している機能。
- **【互換/レガシー】** … 旧版互換のために残置されているコード・ルート。新規導線では使わない。
- **【推定】** … コードからの参照のみ確認でき、定義 SQL がリポジトリ内に無い等で実体を直接確認できていない箇所（特に DB スキーマの一部）。
- ルート名と「ステージ番号」は **一致しない**ものがある（例: Stage 3 = `/cascade`、Stage 4 = `/okr`）。各章で都度明記する。
- UI 上の正式名称・ボタン名は実装/リリースで変動しうるため、機能単位で記述する。
