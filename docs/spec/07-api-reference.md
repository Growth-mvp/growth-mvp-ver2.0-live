# 07. API リファレンス

本書は、`app/api/` 配下の全 Route Handler の一覧（§2）と認証・認可の分類（§1）である。計 61 本（2026-07 時点。監査時は `find app/api -name route.ts | wc -l` で再算出する）。HTTP メソッドは `export` されたハンドラから抽出。

- **関連**: 書き込み系は原則 `lib/server/rbacGuard.ts`（Bearer + membership + capability + スコープ）で防御する（[03] §4）。監査項目は [08] A・C・E カテゴリ。

> `generate-story-draft-v2` は v1（`generate-story-draft`）の `POST` を再エクスポートする薄いラッパ（`export { POST } from '@/app/api/generate-story-draft/route'`）。

## 1. 認証・認可の要否（分類）

各エンドポイントの request/response 契約までは記載しないが、**「誰が呼べるか」**は分類しておく（詳細な権限は [03]、監査項目は [08]）。

| 区分 | 意味 | 該当エンドポイント |
|---|---|---|
| 🔑 **要 admin** | 管理者ロール必須 | `admin/*`・`members`(POST/DELETE)・`members/role`・`invites/create`・`org-alignment/admin/*` |
| ✅ **要ログイン（会社所属）** | Bearer + membership 必須（`rbacGuard` 等） | 稼働中の生成系・`ask-ceo-agent`・`org-alignment/*`(非 admin)・`stage*/generate-*`・`_session/set-company`・`_session/set-cookie` ほか |
| 🟡 **所属前/特殊フロー** | membership 前に使う、または公開情報/診断用途 | `companies/provision`（初回会社作成）・`invites/info`・`invites/complete`・`auth/link-invited-user`・`diag/whoami` |
| ⚪ **外部/公開系** | 認証ガード無し。機微データは扱わない前提 | `market/pbr`（外部 PBR 中継） |
| 💤 **deprecated** | 後方互換 route。現行実装は 410 Gone | `knowledge`・`generate-department-summary`・`invites/accept` |

> 注: 第 1 回レビュー（`docs/security-log/review-01/`）で指摘された無認証生成系とセッション系はコード上は認証化または 410 Gone 化済み。ただし実機 401/403/410（[08] A-02）、理由付き許可リスト（[08] C-10）、レート制限（[08] E-03）、RLS 越境拒否（[08] D-03/D-04）は監査対象。

## 2. エンドポイント一覧

### 2.1 セッション・会社・診断

| メソッド | パス | 用途 |
|---|---|---|
| POST | `/api/_session/set-company` | 現在会社の選択（Cookie） |
| POST | `/api/_session/set-cookie` | セッション Cookie 設定 |
| POST | `/api/companies/provision` | サインアップ後の会社・profile・初期 membership 用意 |
| GET | `/api/diag/whoami` | 認証/所属の自己診断 |

### 2.2 認証・招待・メンバー管理

| メソッド | パス | 用途 |
|---|---|---|
| POST | `/api/auth/link-invited-user` | 招待ユーザーと auth アカウントの紐付け |
| POST | `/api/invites/create` | 招待トークン発行（admin） |
| GET | `/api/invites/info` | 招待トークン情報取得 |
| POST | `/api/invites/complete` | 招待受諾完了 |
| POST | `/api/invites/accept` | 旧招待受諾 API（410 Gone） |
| POST | `/api/admin/invite` | 管理画面からの招待 |
| POST | `/api/admin/members/invite` | メンバー招待 |
| GET/DELETE | `/api/admin/members` | メンバー一覧/削除 |
| GET/POST/DELETE | `/api/members` | メンバー取得/追加/削除 |
| PATCH | `/api/members/role` | ロール変更（admin: `members:updateRole`） |

### 2.3 Stage 1（企業価値分析）

| メソッド | パス | 用途 |
|---|---|---|
| GET/POST | `/api/stage1/import` | ドキュメント取込（PDF/CSV → 財務抽出） |
| GET | `/api/market/pbr` | 上場企業の PBR 取得 |
| GET/POST | `/api/knowledge` | deprecated（410 Gone）。ナレッジは `lib/growthKnowledge.ts` / `lib/rag/` |

### 2.4 Stage 2（全社戦略）

| メソッド | パス | 用途 |
|---|---|---|
| POST | `/api/generate-question` | 12 問・章ステップ質問生成 |
| POST | `/api/generate-hint` | ヒント生成 |
| POST | `/api/generate-example` | 記入例生成 |
| POST | `/api/generate-advice` | 助言生成 |
| POST | `/api/generate-story-draft` | 戦略ストーリーたたき台 |
| POST | `/api/generate-story-draft-v2` | たたき台 v2（v1 の POST を再エクスポート） |
| POST | `/api/generate-final-story` | 最終ストーリー生成 |
| POST | `/api/generate-strategy` | 戦略生成 |
| POST | `/api/recommend-top-patterns` | 全社勝ち筋パターン推薦 |
| POST | `/api/stage2/generate-draft` | Stage2 ドラフト |
| POST | `/api/stage2/generate-final` | Stage2 最終 |

### 2.5 Stage 3（部門カスケード）

| メソッド | パス | 用途 |
|---|---|---|
| POST | `/api/generate-cascade` | 全社戦略 → カスケード構造生成 |
| POST | `/api/generate-department-draft` | 部門たたき台 |
| GET/POST | `/api/generate-department-summary` | deprecated（410 Gone、`generate-cascade` へ統合） |
| POST | `/api/generate-department-question` | 部門掘り下げ質問 |
| POST | `/api/stage3/generate-strategy-bridge` | 戦略ブリッジ生成 |
| POST | `/api/cascade/cleanup-deleted-projects` | 削除済みプロジェクトのクリーンアップ |

### 2.6 Stage 4（実行計画）

| メソッド | パス | 用途 |
|---|---|---|
| POST | `/api/stage4/generate-execution-draft` | 実行ドラフト生成 |
| POST | `/api/okr-from-exec` | 実行パターンから OKR 生成 |
| POST | `/api/recommend-exec-patterns` | 実行パターン推薦 |

### 2.7 Stage 5（実行支援）

| メソッド | パス | 用途 |
|---|---|---|
| POST | `/api/stage5/assist-execution` | 進捗支援（要約/リスク/次アクション/整合） |
| GET | `/api/stage5/execution-summary` | 実行サマリ |

### 2.8 エージェント・汎用生成

| メソッド | パス | 用途 |
|---|---|---|
| POST | `/api/ask-ceo-agent` | CEOChat（intent ルーティング + RAG + facilitator） |
| POST | `/api/generate-insight` | インサイト生成 |
| POST | `/api/generate-ot` | OT 生成 |
| GET/POST | `/api/generate` | 汎用生成 |

### 2.9 組織変革（Org Alignment）

#### 個人ルーム
| メソッド | パス | 用途 |
|---|---|---|
| POST | `/api/org-alignment/intake` | インテイク（違和感入力） |
| POST | `/api/org-alignment/generate` | ケース生成 |
| POST | `/api/org-alignment/cases/[id]/request-alignment` | すり合わせ依頼 |

#### 全社共有ルーム
| メソッド | パス | 用途 |
|---|---|---|
| GET | `/api/org-alignment/shared/topics` | 共有トピック一覧 |
| PATCH | `/api/org-alignment/shared/topics/[id]` | 共有トピック更新 |
| GET | `/api/org-alignment/shared/summary` | 集計サマリ |
| GET/PATCH | `/api/org-alignment/shared/reflection-candidates` | 反映候補 取得/更新 |
| POST | `/api/org-alignment/shared/topics/[id]/reflection-candidates` | トピックの反映候補作成 |
| PATCH | `/api/org-alignment/shared/topics/reset-reflection` | 反映リセット |

#### 管理者
| メソッド | パス | 用途 |
|---|---|---|
| POST | `/api/org-alignment/admin/insights/generate` | インサイト生成 |
| GET | `/api/org-alignment/admin/insights` | インサイト一覧 |
| PATCH | `/api/org-alignment/admin/insights/[id]/actions` | 次アクション更新 |
| GET | `/api/org-alignment/admin/requests` | すり合わせ依頼一覧 |
| PATCH | `/api/org-alignment/admin/requests/[id]` | 依頼の対応状態更新 |
| POST | `/api/org-alignment/admin/shared-topics` | 共有トピック作成（公開） |
| PATCH | `/api/org-alignment/admin/shared-topics/[id]` | 共有トピック更新 |
| PATCH | `/api/org-alignment/admin/shared-topics/[id]/announcement` | トピック告知更新 |
| PATCH | `/api/org-alignment/admin/shared-topics/announcement` | 告知一括更新 |

---

## 3. 共通実装メモ

- ランタイム: 生成系は `export const runtime = 'nodejs'`、多くで `dynamic = 'force-dynamic'`。
- 入力パース: `app/api/_shared/utils.ts` の安全 JSON パーサ／`toTextStory` を多用。
- 認可: 書き込み API は原則 Bearer 必須。`getSupabaseAdmin()`（Service Role）で RLS をバイパスする route では、`rbacGuard` 等で会社/部門スコープを強制する設計（検証漏れの監査は [08] D-07）。`members/*` など一部は個別実装、招待受諾・provision は理由付きの特殊フロー（[08] C-10 の許可リスト管理）。

---

## 変更履歴

| 日付 | 変更内容 | 変更者 |
|---|---|---|
| 2026-06-22 | 初版（基準コミット `f7b9c03`。以後認証分類 §1 の追加あり） | 仕様書作成（Claude Code） |
| 2026-07-06 | 表記統一（目的宣言・節番号の統一・時点付き数値と再算出コマンド・監査参照の [08] 項目 ID 化・変更履歴の追加） | ドキュメント整備（Claude Code） |
