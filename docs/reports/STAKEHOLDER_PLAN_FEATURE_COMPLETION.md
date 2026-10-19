# 経営計画書（ステークホルダー別）機能 開発完了記録

**日付**: 2026-10-19
**状態**: 実装完了。本番デプロイは未実施。ステージングでの実物検証は未実施
**統合元**: 2026-10-19 の整理で、旧資料の未完了事項を下記の新規資料へ移し、元の資料は `docs/archive/stakeholder-plan-dev-2026-10/` へ移動するか、内容を移したうえで削除した（§6）

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
| 計画書の DB 設計（ローカル PGlite） | 16 件 PASS。2 回連続適用に成功。故意に壊したマイグレーション 2 種で検証が失敗することを確認（検証が空振りしないことの確認） | 本番とは別環境。ステージングで再実行が必要 |
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
8-1. 既知の制限: 生成 API にレート制限とキャッシュがない（PHASE2_VERIFICATION L265-271）。コスト上の懸念があり、対応は未決定。
9. 既存処理の未解決（`INVESTIGATION_REPORT_PLAN_GENERATION.md` の調査時点の記録。現行コードでは一部が解消）:
   - 北極星の施策効果（`projectTargetImpacts`）が未取得（`app/api/plans/[audience]/generate/route.ts` にも `buildPlanData.ts` にも無い）
   - STAGE4 の施策（`projectImpacts`）で、担当者・根拠・計画状態・OKR・KPI が計画書に渡らない（`buildPlanData.ts` の抽出部分）
   - `projectImpacts.slice(0, 20)` による件数の上限（`buildPlanData.ts:261`）
   - 営業利益率と ROIC（`valueAnalysis`）が、どの経路からも渡されていない（`buildPlanData.ts:360-367` は読むが、route には供給がない）
   - `financeBS` の取り込みが未確認
10. 数値の表示と単位（既知の問題）:
   - 施策効果の単純合計は、重複計上が未検証（`buildPlanData.ts` の施策効果の合計部分。表示ラベルも「重複未検証」）
   - 目標の表示は、基準値と単位をそのまま連結する（`buildPlanData.ts:190`。単位の表記が「万円・億円・M」で不統一）
   - 「売上」の部分一致（`buildPlanData.ts:404`）は「売上総利益」にも当たる
   - 過去の財務実績の単位は「未確認」として表示する方針。画面のプレビュー（ストア経由。換算あり）と生成本文（DB の生の値。`route.ts:449`）で、100 万未満の値が一致しない可能性がある
11. 財務単位の既知の問題（§5-4 の詳細）:
   - 入力時の換算: `store/strategyStore.ts:2627-2637` の `setFinancePL` は、100 万未満の値を×100 万して保存する
   - 読み込み時の換算: `utils/supabase/strategy.ts:805-821` は、revenue に加えて cogs・sga・grossProfit・operatingIncome にも同じ換算をする
   - 取り込み（Excel・CSV）は単位を判定せず、値をそのまま `setFinancePL` へ渡す
   - 本件の結論は [docs/investigation/](../investigation/) ではなく、本節で管理する。修正は既存データの影響を確認してから判断する
12. 単体テスト: `buildPlanData.test.ts` の実行結果は、正式な記録にない（PHASE1_VERIFICATION の「未実行」は古い記述）。
13. 移行先: 旧資料の未完了事項（テスト・導線・PDF・障害記録・設計の構想）は、次の新規資料にある。
   - 未実施テスト: [docs/testing/STAKEHOLDER_PLAN_TEST_CHECKLIST.md](../testing/STAKEHOLDER_PLAN_TEST_CHECKLIST.md)
   - 障害の原因と修正: [docs/incidents/STAKEHOLDER_PLAN_PREVIEW_INCIDENTS_2026-10.md](../incidents/STAKEHOLDER_PLAN_PREVIEW_INCIDENTS_2026-10.md)
   - Phase 3（PDF）の構想（未実施）: [docs/design/STAKEHOLDER_PLAN_PHASE3_PLAN.md](../design/STAKEHOLDER_PLAN_PHASE3_PLAN.md)
   - 詳細設計の要点（章構成・検証ルール・リスク、未実装）: [docs/design/STAKEHOLDER_PLAN_DETAILED_DESIGN.md](../design/STAKEHOLDER_PLAN_DETAILED_DESIGN.md)

## 6. 統合と削除（2026-10-19 の整理）

旧資料の内容は、上記の新規資料と本書（§5・§6-1）、セキュリティ記録（§6）、設計書（§11）へ移した。元の資料は次のとおり扱う。

| 元の資料 | 扱い |
|---|---|
| `DESIGN_PLAN_STORAGE.md`、`FINAL_DESIGN_REVIEW.md`、`PHASE2_VERIFICATION_REPORT.md`、`ROUTING_FIX_REPORT.md`、`ZUSTAND_INFINITE_LOOP_FIX_REPORT.md` | 内容を移したうえで、ルートから削除 |
| `INVESTIGATION_REPORT_PLAN_GENERATION.md` | `docs/investigation/` へ移動 |
| `IMPLEMENTATION_CHECKLIST.md`、`IMPLEMENTATION_TEMPLATE.md`、`PHASE1_FINAL_REPORT.md`、`PHASE1_IMPLEMENTATION_REPORT.md`、`PHASE1_VERIFICATION_REPORT.md`、`PHASE2_DATA_EXTRACTION_CHECK.md`、`PHASE2_FINAL_GATE_REPORT.md`、`SECURITY_FUNCTIONAL_TEST.md`、`test-security.md`、`design-docs/` の 5 件 | 詳細な記録として `docs/archive/stakeholder-plan-dev-2026-10/` へ移動 |

保留（変更なし）: `MIGRATION_GENERATED_PLANS.sql`、`scripts/sql/generated_plans_verify.sql`。

### 6-1. 未完了事項の移行先

| 出典 | 未完了事項 | 状態 | 移行先 |
|---|---|---|---|
| `PHASE2_DATA_EXTRACTION_CHECK.md` | AI プロンプトに含める数値の範囲 | 未決定（要判定） | §5-10、§5-11 |
| `PHASE2_DATA_EXTRACTION_CHECK.md` | STAGE5・6 データの抽出 | 部分実装（改善推奨） | §5-9、Phase 3 構想 |
| `PHASE2_FINAL_GATE_REPORT.md`、`PHASE2_VERIFICATION_REPORT.md` | 3 種類の生成、401/403、日本語の品質、企業間分離 | 未実施 | テスト一覧 §1・§2・§4 |
| `ROUTING_FIX_REPORT.md` | 導線の画面操作確認 | 未実施 | テスト一覧 §3 |
| `INVESTIGATION_REPORT_PLAN_GENERATION.md` §B | データマッピングの「実装未確認」と「未取得」 | 一部は解消。残りは §5-9 | §5-9 |
| `IMPLEMENTATION_CHECKLIST.md` | 未チェック 23 件 | 未実施 | テスト一覧 §1・§2・§6 |
| `PHASE1_VERIFICATION_REPORT.md`、`PHASE1_IMPLEMENTATION_REPORT.md` | 既存の復元処理の単位推定と「単位未確認」の矛盾 | 未解決 | §5-4、§5-11 |
| `ZUSTAND_INFINITE_LOOP_FIX_REPORT.md` | 修正は完了 | 解消済み | 障害記録 §2 |
| `ROUTING_FIX_REPORT.md` | 導線の修正（静的ルート） | 解消済み（動的ルートの削除は未実施） | 障害記録 §1 |

### 6-2. 解消済み（未解決と混同しないこと）

- 北極星と施策効果の分離、STAGE2 優先・STAGE4 は参考値（`buildPlanData.ts:266-270`）
- 施策効果の合計を「重複未検証」と表示する（§5-10 の未解決事項とは別に、表示は実装済み）
- `financeSummary` の `{rows}` 形式の受理（`route.ts:484-491`）
- 「承認済み」の表記を「登録」へ統一
- 他社 strategyId の 403（`route.ts:139-140`）
- 404 と無限ループ（障害記録）

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
