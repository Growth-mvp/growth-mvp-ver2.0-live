# 07. API リファレンス

`app/api/` 配下の Route Handler 一覧（計 59 本）。HTTP メソッドは `export` されたハンドラから抽出。
書き込み系は原則 `lib/server/rbacGuard.ts`（Bearer + membership + capability + スコープ）で防御する（[03-auth-rbac.md](./03-auth-rbac.md)）。

> `generate-story-draft-v2` は v1（`generate-story-draft`）の `POST` を再エクスポートする薄いラッパ（`export { POST } from '@/app/api/generate-story-draft/route'`）。

## 0. 認証・認可の要否（分類）

各エンドポイントの request/response 契約までは記載しないが、**「誰が呼べるか」**は分類しておく（詳細な権限は [03-auth-rbac.md](./03-auth-rbac.md)、現状の課題は [08] F-2）。

| 区分 | 意味 | 該当エンドポイント |
|---|---|---|
| 🔴 **無認証・生成系（[08] F-2）** | 認証なしで OpenAI 生成等を呼べる（8 本）＋外部中継 | `generate-question`・`generate-insight`・`generate-department-summary`・`okr-from-exec`・`recommend-top-patterns`・`recommend-exec-patterns`・`stage5/assist-execution`・`knowledge`（以上 8 本）／（参考）`market/pbr`（外部 API 中継） |
| 🔴 **無認証・セッション系（[08] F-6）** | 認証なしで Cookie を設定できる（2 本） | `_session/set-cookie`・`_session/set-company` |
| 🔑 **要 admin** | 管理者ロール必須 | `admin/*`・`members`(DELETE/更新)・`members/role`・`invites/create`・`org-alignment/admin/*` |
| ✅ **要ログイン（会社所属）** | Bearer + membership 必須（`rbacGuard`） | 上記以外の生成系・`ask-ceo-agent`・`org-alignment/*`(非 admin)・`stage*/generate-*` ほか |
| 🟡 **要ログイン（所属前許可）** | Bearer は必須だが membership は未要求（所属作成/受諾前に使うため） | `companies/provision`（初回会社作成・membership 作成前）・`invites/accept`（招待受諾前なので所属不要。`requireMembership` を呼ばない） |

> 注: 現状 42/59 が `rbacGuard` 等で保護、`members/*` は個別実装で admin 強制（[08] F-5）。**無認証区分（🔴）は PoC 前に対策必須** — 生成系は要ログイン化（[08] A-2）、セッション系は認証必須化＋Cookie 名許可リスト（[08] B-3）。

## セッション・会社・診断

| メソッド | パス | 用途 |
|---|---|---|
| POST | `/api/_session/set-company` | 現在会社の選択（Cookie） |
| POST | `/api/_session/set-cookie` | セッション Cookie 設定 |
| POST | `/api/companies/provision` | サインアップ後の会社・profile・初期 membership 用意 |
| GET | `/api/diag/whoami` | 認証/所属の自己診断 |

## 認証・招待・メンバー管理

| メソッド | パス | 用途 |
|---|---|---|
| POST | `/api/auth/link-invited-user` | 招待ユーザーと auth アカウントの紐付け |
| POST | `/api/invites/create` | 招待トークン発行（admin） |
| POST | `/api/invites/accept` | 招待受諾 |
| POST | `/api/admin/invite` | 管理画面からの招待 |
| POST | `/api/admin/members/invite` | メンバー招待 |
| GET | `/api/admin/members` | メンバー一覧 |
| GET/POST/DELETE | `/api/members` | メンバー取得/追加/削除 |
| PATCH | `/api/members/role` | ロール変更（admin: `members:updateRole`） |

## Stage 1（企業価値分析）

| メソッド | パス | 用途 |
|---|---|---|
| GET/POST | `/api/stage1/import` | ドキュメント取込（PDF/CSV → 財務抽出） |
| GET | `/api/market/pbr` | 上場企業の PBR 取得 |
| GET/POST | `/api/knowledge` | ナレッジ取得/登録 |

## Stage 2（全社戦略）

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

## Stage 3（部門カスケード）

| メソッド | パス | 用途 |
|---|---|---|
| POST | `/api/generate-cascade` | 全社戦略 → カスケード構造生成 |
| POST | `/api/generate-department-draft` | 部門たたき台 |
| GET/POST | `/api/generate-department-summary` | 部門サマリ |
| POST | `/api/generate-department-question` | 部門掘り下げ質問 |
| POST | `/api/stage3/generate-strategy-bridge` | 戦略ブリッジ生成 |
| POST | `/api/cascade/cleanup-deleted-projects` | 削除済みプロジェクトのクリーンアップ |

## Stage 4（実行計画）

| メソッド | パス | 用途 |
|---|---|---|
| POST | `/api/stage4/generate-execution-draft` | 実行ドラフト生成 |
| POST | `/api/okr-from-exec` | 実行パターンから OKR 生成 |
| POST | `/api/recommend-exec-patterns` | 実行パターン推薦 |

## Stage 5（実行支援）

| メソッド | パス | 用途 |
|---|---|---|
| POST | `/api/stage5/assist-execution` | 進捗支援（要約/リスク/次アクション/整合） |
| GET | `/api/stage5/execution-summary` | 実行サマリ |

## エージェント・汎用生成

| メソッド | パス | 用途 |
|---|---|---|
| POST | `/api/ask-ceo-agent` | CEOChat（intent ルーティング + RAG + facilitator） |
| POST | `/api/generate-insight` | インサイト生成 |
| POST | `/api/generate-ot` | OT 生成 |
| GET/POST | `/api/generate` | 汎用生成 |

## 組織変革（Org Alignment）

### 個人ルーム
| メソッド | パス | 用途 |
|---|---|---|
| POST | `/api/org-alignment/intake` | インテイク（違和感入力） |
| POST | `/api/org-alignment/generate` | ケース生成 |
| POST | `/api/org-alignment/cases/[id]/request-alignment` | すり合わせ依頼 |

### 全社共有ルーム
| メソッド | パス | 用途 |
|---|---|---|
| GET | `/api/org-alignment/shared/topics` | 共有トピック一覧 |
| PATCH | `/api/org-alignment/shared/topics/[id]` | 共有トピック更新 |
| GET | `/api/org-alignment/shared/summary` | 集計サマリ |
| GET/PATCH | `/api/org-alignment/shared/reflection-candidates` | 反映候補 取得/更新 |
| POST | `/api/org-alignment/shared/topics/[id]/reflection-candidates` | トピックの反映候補作成 |
| PATCH | `/api/org-alignment/shared/topics/reset-reflection` | 反映リセット |

### 管理者
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

## 共通実装メモ

- ランタイム: 生成系は `export const runtime = 'nodejs'`、多くで `dynamic = 'force-dynamic'`。
- 入力パース: `app/api/_shared/utils.ts` の安全 JSON パーサ／`toTextStory` を多用。
- 認可: 書き込み API は Bearer 必須。`getSupabaseAdmin()`（Service Role）で RLS をバイパスしつつ、`rbacGuard` で会社/部門スコープを強制する設計。
