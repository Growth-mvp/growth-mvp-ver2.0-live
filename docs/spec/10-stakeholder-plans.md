# 10. 経営計画書（ステークホルダー別）の機能仕様

> 本書は**現在の実装**を基準に記述する。設計の経緯と承認内容は [docs/design/STAKEHOLDER_PLAN_DESIGN.md](../design/STAKEHOLDER_PLAN_DESIGN.md)、権限と分離の検証記録は [docs/security-log/2026-10-19_company-isolation-and-rbac-record.md](../security-log/2026-10-19_company-isolation-and-rbac-record.md) を参照。

## 1. 概要

GROWTH の STAGE1〜6 のデータから、利害関係者（ステークホルダー）別の経営計画書を AI で生成し、保存・再表示する機能。

| 対象（audience） | 文書名 | 想定の読み手 |
|---|---|---|
| `bank` | 経営改善・事業計画書 | 金融機関 |
| `shareholder` | 中期経営計画書 | 株主・投資家 |
| `employee` | 経営方針・実行計画書 | 社員 |

## 2. 画面

| パス | 役割 |
|---|---|
| `/report` | レポート一覧。「ステークホルダー別経営計画書」への導線 |
| `/report/stakeholder-select` | 対象の選択（3 種類のカード）。生成 API は呼ばない |
| `/report/bank-plan` `/report/shareholder-plan` `/report/employee-plan` | 計画書の画面（各 audience の固定ページ） |
| `/report/[audience]-plan` | 計画書の画面（動的ルート）。固定ページと同じ構成 |

計画書の画面は次の状態を持つ。

- **元データの状態**（`usePlanSource`）: `loading`（準備中）、`missing`（会社名が未入力）、`error`（読み込み失敗）、`ready`（表示可能）。
- **保存済みの計画書**（`usePlanDocument`）: 画面を開くと保存済みを取得する。無ければ「未生成」。
- **生成**: admin・manager のみ「生成して保存」ボタンを表示する。member には表示しない。
- **未保存**: 生成結果の保存に失敗した場合、「未保存」バナーを表示し、「コピー」と「Markdown ダウンロード」を提供する。未保存の間は離脱（再読み込み・リンク遷移）で確認する。
- **印刷**: `window.print()`（印刷用スタイルは `app/globals.css` の `@media print`）。

## 3. データ

### 3-1. 入力（計画書データ）

`utils/export/buildPlanData.ts` が、ストアの STAGE1〜6 のデータから audience ごとの `PlanData` を作る。主な内容は次のとおり。

- 会社名、業種、経営課題（STAGE1）
- 過去の年度別財務実績（STAGE1）。**単位が不明な場合は「単位未確認」と表示し、推測で換算しない**
- ミッション・ビジョン、中計コンセプト、重点テーマ（STAGE2）
- 部門別の役割・施策（STAGE3）
- 施策の期待効果（STAGE4）
- 財務目標・予測の状態（STAGE5・6）。数値は「利用可能な場合のみ」使い、状態（complete / partial / incomplete）を併記する

### 3-2. 保存先（`generated_plans`）

| 列 | 内容 |
|---|---|
| `company_id` / `strategy_id` / `audience` | 一意キー（1 件が最新版） |
| `generated_text` | 生成本文（Markdown 相当） |
| `sections` | 章ごとの配列（生成本文を「第 X 章」または「【」で始まる行で分割） |
| `generated_at` | 生成日時（画面に表示する） |
| `version` / `updated_at` | 更新の度に +1 / 更新日時 |
| `created_by` / `updated_by` | 利用者 ID |

書き込みは API（service_role）のみ。RLS は所属者の SELECT のみを許可し、戦略の会社と一致する行だけを返す。トリガーが書き込み時の整合を検査する。詳細は設計書 §2・§3。

## 4. API

### 4-1. 生成: `POST /api/plans/{audience}/generate`

- 本文: `{ companyId, strategyId }`（UUID）。本文は受け取らない。
- 処理: 認証 → 入力の検証 → 所属確認 → ロール確認（admin / manager）→ 戦略の取得（会社と一致）→ 計画書の生成 → 保存。
- 応答（成功・保存済み）: `{ audience, companyId, strategyId, generatedText, sections, generatedAt, status: 'saved', version, saveReason: null }`
- 応答（保存失敗）: `status: 'unsaved'`、`saveReason: 'conflict' | 'error'`。本文は含めて返す（500 にしない）。

| 状態 | 条件 |
|---|---|
| 400 | 入力の不正（UUID でない、audience が 3 種以外）、会社名が無い戦略（`Strategy data incomplete`） |
| 401 | 認証なし |
| 403 | 所属なし、ロールが manager / admin 以外、戦略 ID が取得した戦略と一致しない |
| 404 | 戦略が見つからない（会社と戦略 ID の組が一致しない場合を含む） |
| 500 | 戦略の取得失敗、その他の内部エラー |
| 503 | 本文が生成されなかった、または短すぎる、または章が作れなかった（`Generation incomplete`） |

### 4-2. 取得: `POST /api/plans/{audience}/saved`

- 本文: `{ companyId, strategyId, audience }`。URL の audience と本文の audience が一致すること。
- 全ロールが利用できる。所属確認と、戦略が会社に属することの確認を行う。
- 応答: 保存済みの `generatedText`・`sections`・`generatedAt`・`version`・`updatedAt`。無ければ 404。

| 状態 | 条件 |
|---|---|
| 400 | 入力の不正、URL と本体の audience の不一致 |
| 401 | 認証なし |
| 403 | 所属なし、戦略が会社に属さない |
| 404 | 計画書が無い |
| 500 | 内部エラー |

## 5. 権限

| 操作 | admin | manager | member |
|---|---|---|---|
| 閲覧（saved） | 可 | 可 | 可 |
| 生成・再生成（generate） | 可 | 可 | 不可 |

権限は API で検証する（member の生成は 403）。UI は member に生成ボタンを表示しない。

## 6. 監査

- `PLAN_GENERATE`（生成成功）、`PLAN_GENERATE_FAILED`（失敗）、`PLAN_SAVE_FAILED`（保存失敗）を監査ログに記録する。
- 監査ログの失敗は応答を変えない（非致命）。

## 7. モデル設定

- `config/models.json` の `process_configs.planGenerate`: `modelRole: reasoning`、`maxCompletionTokens: 8000`、`jsonMode: false`。
- モデル名とトークン上限はコードに直書きしない（CLAUDE.md の方針）。

## 8. 制約・既知の挙動

- 計画書の鮮度（元データとの差分）は判定しない。画面には生成日時を表示する。
- 会社移動後の旧計画書は参照されない（保持はする）。戦略を元の会社へ戻すと旧計画書が再び見える。
- 戦略の 1 社 1 戦略の制約により、戦略の移動先は戦略を持たない会社に限られる（既存の挙動）。
- 章構成は生成プロンプトに従う（3 種とも 5 章）。設計書の章数とは一致しない。
- 金額の単位は、`buildPlanData` では「単位未確認」として表示する。ただし既存の復元処理には単位を推定する処理が残っている（設計書 §9）。

## 9. 関連コード

- API: `app/api/plans/[audience]/generate/route.ts`、`app/api/plans/[audience]/saved/route.ts`
- 保存: `utils/supabase/generated-plans.ts`
- 状態: `lib/plans/planDocumentState.ts`、`lib/plans/generationController.ts`
- 画面・フック: `app/report/**`、`components/export/Plan*.tsx`、`hooks/usePlanDocument.ts`、`hooks/usePlanSource.ts`
- データ構築: `utils/export/buildPlanData.ts`
