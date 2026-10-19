# 経営計画書 Phase 3 開発構想（PDF 出力）

**状態**: 未実施。構想と未決定事項を保存するための資料。着手は承認後。
**出典**: 元の資料（`design-docs/phase3-plan.md`、`design-docs/phase2-completion-report.md`、`design-docs/minimum-prototype-plan.md`、`PHASE2_FINAL_GATE_REPORT.md`）は [docs/archive/stakeholder-plan-dev-2026-10/](../archive/stakeholder-plan-dev-2026-10/) に保存している。

## 1. 目的と範囲

- 銀行・株主・社員向けの経営計画書を PDF でダウンロードできるようにする（phase3-plan L3）
- 範囲は PDF 出力。元の資料は「Supabase への保存は含まない」としていたが、保存は実装済み（`generated_plans`）。この記述は現行と矛盾するため、旧記載として扱う

## 2. 現状

- 計画書の PDF 出力は未実装。銀行向けページの「PDF ダウンロード」ボタンはブラウザの印刷（`window.print()`）を呼ぶ（`app/report/bank-plan/page.tsx:77-82`）
- `components/export/PlanPreview*` に PDF の処理はない

## 3. 未決定の事項

| 項目 | 候補 | 出典 |
|---|---|---|
| 出力方式 | (a) html2canvas + jsPDF（`usePlanPdfExport` と `PlanPdfTemplate` を新設） / (b) 印刷用 CSS | phase3-plan L50、L58-59、L66-124 / phase2-completion-report L211-213 |
| ファイル名 | `{companyName}_{audience}.pdf` / `GROWTH_{audience}_{companyName}_{YYYYMMDD}.pdf` | phase3-plan L80、L191 / minimum-prototype-plan L161 |
| 検証警告を PDF に出すか | 未決定 | phase3-plan L197 |
| フォント | MS Gothic などを使う。設定方法は必要に応じて決める | phase3-plan L181、L235 |
| 100 ページ超の扱い | html2canvas の制限があるため、扱いを決める | design-docs（詳細設計）L593、L660、L695 |

## 4. 要件（案）

- 表紙（企業名、audience、生成日時）、ページ番号、章見出し、本文（AI 生成テキスト）、表（会社情報、STAGE 別データ）、改ページの制御（phase3-plan L19-24）
- 日本語の文字化けがない。改ページ・レイアウトが意図どおり。長い本文が切れない。画像がある場合は解像度を確認（L27-29、L181-184）
- PDF の本文が UI のプレビューと一致する（L196）

## 5. 作業量と着手条件

- 見積: 3〜4 日（phase3-plan L5）。内訳は、フック 1 日、テンプレート 1 日、統合と検証 1〜2 日（L204-218）
- 着手条件: Phase 2 の検証とセキュリティ検証が完了していること（L239-247）。元の資料では「テスト環境の準備」だけが未チェックだったが、セキュリティ検証にも未完了の項目がある（[テスト一覧 §2](../testing/STAKEHOLDER_PLAN_TEST_CHECKLIST.md)）。着手前に確認する

## 6. 成功条件と確認項目（案・未実施）

- 3 種類の PDF が出力され、日本語が正しく表示され、UI と内容が一致し、既存機能に回帰がない（phase3-plan L251-257）
- 確認項目: 表紙、ページ番号、章見出し、本文、表、改ページ、日本語フォント、文字切れ、ダウンロード後のボタン状態、ファイル名、日付と会社名（phase3-plan L174-198）
- 実装手順: `usePlanPdfExport.ts`、`PlanPdfTemplate.tsx`、CSS の印刷設定、`PlanPreview` への PDF ボタンの統合、3 種類の出力テスト（L205-218）
- 性能目標（未計測）: 50 ページ 10 秒以内、100 ページ 20 秒以内、100 ページ時のメモリ 500MB 以内（[詳細設計](STAKEHOLDER_PLAN_DETAILED_DESIGN.md) §5）

## 7. 後続フェーズ（構想のみ・未実施）

- Phase 5: NPV・IRR、返済計画のシミュレーション、複数シナリオ（詳細設計 L714-718）
- Phase 6: CFO 署名、承認、版管理（同 L720-723）
- Phase 7: Word・Excel 出力、Slack・メール共有、IR 資料の自動生成（同 L725-728）
- 非目的として挙げられた項目（minimum-prototype-plan L449-456）: 承認ワークフロー・CFO 署名、Word・Excel 出力、Slack 共有、個人別 OKR の生成、100 ページ超の最適化、DB 保存・版管理（※ DB 保存は実装済み。版管理は未実装）、返済計画のシミュレーション

## 8. 関連

- 未実施の確認項目: [docs/testing/STAKEHOLDER_PLAN_TEST_CHECKLIST.md](../testing/STAKEHOLDER_PLAN_TEST_CHECKLIST.md) §8
- 現行の仕様: [docs/spec/10-stakeholder-plans.md](../spec/10-stakeholder-plans.md)
