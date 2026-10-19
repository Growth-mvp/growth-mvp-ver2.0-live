# 経営計画書（ステークホルダー別）機能 開発完了記録

**日付**: 2026-10-19
**状態**: 実装完了。本番デプロイは未実施。ステージングでの実物検証は未実施
**統合元**: `PHASE1_*`、`PHASE2_*`、`design-docs/phase1-completion-report.md`、`design-docs/phase2-completion-report.md`、`design-docs/3-stakeholder-plan-detailed-design.md`（いずれも統合後の削除候補。§6）

---

## 1. 機能の範囲

- 対象: 銀行向け・株主向け・社員向けの経営計画書
- 生成: STAGE1〜6 のデータから AI が本文を生成し、生成直後に保存する（admin・manager）
- 閲覧: 保存済みの計画書を全ロールが閲覧する。生成日時を表示する
- 失敗時: 1 回の安全なリトライ、未保存表示、コピー、Markdown ダウンロード、離脱確認
- 仕様: [docs/spec/10-stakeholder-plans.md](../spec/10-stakeholder-plans.md)

## 2. 実装の要点

| 区分 | 内容 |
|---|---|
| API | `POST /api/plans/{audience}/generate`、`POST /api/plans/{audience}/saved` |
| DB | `generated_plans` 新設（既存テーブルは変更しない）。書き込みは service_role のみ |
| 会社移動 | 計画書は移動しない。読み取り時に会社・戦略の一致を照合する |
| 権限 | 生成は admin・manager（API で検証、UI でボタンを非表示）。閲覧は全ロール |
| モデル | `config/models.json` の `planGenerate` |

## 3. 併せて行った安全性対策

会社切替と保存の安全性（経営計画書の機能とは独立に、既存機能の不具合を防ぐ対策）。

| 対策 | 対象 |
|---|---|
| 保存応答の照合（会社・戦略の世代番号） | `store/strategyStore.ts`、`lib/strategy/saveScope.ts` |
| 直接保存の照合 | `Step2SWOT.tsx`、`Step2Portfolio.tsx`、`Step3FinanceUpload.tsx`、`app/stage2/page.tsx` |
| OKR 書き込みの所属確認 | `app/okr/page.tsx`、`lib/strategy/okrWriteScope.ts` |
| 財務入力状態の会社別リセット | `store/strategyStore.ts`、`Step3FinanceUpload.tsx`（再マウント） |
| 再読み込みの直列化 | `lib/strategy/refetchCoordinator.ts` |
| Jest の探索範囲（worktree の除外） | `jest.config.js` |

## 4. 検証結果

| 項目 | 結果 | 備考 |
|---|---|---|
| 計画書の DB 設計（ローカル PGlite） | 16 件 PASS。2 回連続適用に成功 | 本番とは別環境。ステージングで再実行が必要 |
| 会社切替・保存安全性の単体テスト | 関連テスト 31 件合格（直近の実行） | 直近のテスト実行の結果。今回の docs 整理では再実行していない |
| 経営計画書の生成・取得 API などの関連テスト | 8 スイート・68 件合格（会社切替の検証時の実行） | 実行時点の記録。今回は再実行していない |
| `npm run build` | 成功（直近の実行） | 型エラーは `next.config` で無視される設定のため、型の確認は `tsc` で行う |
| `tsc --noEmit` | 既存の型エラー 59 件。変更ファイルに関するエラーは無し（直近の実行） | 既存エラーは本機能の範囲外 |
| 本番 DB | `generated_plans` の作成は申告済み。`strategy_delete` の変更は申告済み | 詳細は [docs/deployment/DB_CHANGE_HISTORY.md](../deployment/DB_CHANGE_HISTORY.md) |

## 5. 未完了事項

1. ステージングでの検証: ロック待ち、同時保存（後発の競合）、保存失敗の画面（設計書 §8）。
2. 本番の適用版の照合: `generated_plans` の適用版と `MIGRATION_GENERATED_PLANS.sql` の一致確認。
3. `strategy_delete` のロール別 DELETE テスト（admin 可、それ以外は拒否）。
4. 単位の推定（既存の復元処理が「百万円」を推定して換算する）。計画書の「単位未確認」の方針と矛盾する（設計書 §9）。
5. 章構成: 設計書（7・6・5 章）と実装（3 種とも 5 章）の不一致。実装を正とし、設計書を見直す。
6. 画面の重複（静的 3 画面と動的 1 画面）の整理。
7. 権限の残件（P1）: STAGE1〜3 の member の UPDATE、管理画面のロール変更の経路、`company_members` の参加フロー、`resolveCompanyId` の Cookie 書き換え、story-process と Step5 の保存（詳細は [docs/security-log/2026-10-19_company-isolation-and-rbac-record.md](../security-log/2026-10-19_company-isolation-and-rbac-record.md) §5）。
8. 参照対象外の旧計画書の保持期間と削除方法。

## 6. 統合と削除候補（今回は削除しない）

今回の docs 整理で統合した内容は、次の新規ファイルに反映済み。統合元は、削除の承認後に削除する候補とする。

| 統合元 | 統合先 |
|---|---|
| `DESIGN_PLAN_STORAGE.md`、`FINAL_DESIGN_REVIEW.md` | `docs/design/STAKEHOLDER_PLAN_DESIGN.md` |
| `design-docs/3-stakeholder-plan-detailed-design.md` | `docs/design/`（要点）と `docs/spec/10-stakeholder-plans.md` |
| `SECURITY_FUNCTIONAL_TEST.md`、`test-security.md` | `docs/security-log/2026-10-19_company-isolation-and-rbac-record.md` §1・§6 |
| `PHASE1_*.md`、`PHASE2_*.md`、`design-docs/phase1-completion-report.md`、`design-docs/phase2-completion-report.md` | 本書（結論と残件のみ） |
| `DB` 変更（SQL v6、`strategy_delete`） | `docs/deployment/DB_CHANGE_HISTORY.md` |

上記の統合元は、内容の重複、または本書と上記の記録に置き換えられたもの。詳細な経緯は各統合元に残っている。

### 6-1. 統合元に残っている未完了事項（移行先）

統合元を削除する前に、未完了事項をここへ移す。「再確認」の項目は、調査時点の記録であり、現行コードでの確認が必要。

| 出典 | 未完了事項 | 状態 |
|---|---|---|
| `PHASE2_DATA_EXTRACTION_CHECK.md` | AI プロンプトに含める数値の範囲 | 未決定（要判定） |
| `PHASE2_DATA_EXTRACTION_CHECK.md` | STAGE5・6 データの抽出 | 部分実装（改善推奨） |
| `PHASE2_FINAL_GATE_REPORT.md`、`PHASE2_VERIFICATION_REPORT.md` | 3 種類の audience の AI 本文生成テスト、401/403 応答の確認、日本語の品質確認、企業間データ分離の動作確認 | 未チェック 18 件（ローカル・ステージングで実施） |
| `ROUTING_FIX_REPORT.md` | 導線の画面操作確認（サイドバー → `/report` → 生成ボタン → 計画書の画面） | 未チェック 9 件（ブラウザで確認） |
| `INVESTIGATION_REPORT_PLAN_GENERATION.md` §B | データマッピング表の「実装未確認」（`financeBS`、`valueAnalysis`）と、「そもそも未取得」と記録された項目（`financePL`、`segmentPL`、`csvFinanceData`、`companyTargets`、`midtermStrategy` など）の、現行の `buildPlanData` への反映 | 再確認が必要（調査時点の記録） |
| `IMPLEMENTATION_CHECKLIST.md` | 実装チェックリストの未チェック項目（認証・権限、データ整合性、RLS・セキュリティ、UI/UX、エラーハンドリング） | 未チェック 23 件（計画書機能の範囲で完了判定が必要） |
| `PHASE1_VERIFICATION_REPORT.md`、`PHASE1_IMPLEMENTATION_REPORT.md` | 既存の復元処理の単位推定と「単位未確認」の矛盾 | 未解決（§9 の設計書に記載） |

`ZUSTAND_INFINITE_LOOP_FIX_REPORT.md` は、修正が完了しており未完了事項はない（移行不要）。
