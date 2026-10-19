# 経営計画書（ステークホルダー別）機能 未実施テスト・確認項目

**状態**: 特記がない限り、すべて未実施。
**実施場所**: ローカルまたはステージング。本番では既存企業のデータを書き換えるテストを行わない。
**出典**: 元の資料は [docs/archive/stakeholder-plan-dev-2026-10/](../archive/stakeholder-plan-dev-2026-10/) に保存している。行番号は元の資料のもの。

## 1. 生成・保存・再表示

- [ ] 3 種類（銀行・株主・社員）の AI 本文が生成される（PHASE2_FINAL_GATE L151、PHASE2_VERIFICATION L240）
- [ ] 生成後に保存され、再読み込みで「保存済み」と生成日時が表示される（設計書 §4-3）
- [ ] 保存失敗時も本文は表示されたまま。未保存表示、コピー、Markdown ダウンロード、再保存ができる（IMPLEMENTATION_CHECKLIST L359-360、L368。設計書 §4-2）
- [ ] 未生成（404）は「未生成」として扱い、エラーとして表示しない（IMPLEMENTATION_CHECKLIST L361）
- [ ] 復元中はローディングを表示する（IMPLEMENTATION_CHECKLIST L369）
- [ ] 初回は「AI本文を生成」、生成済みは「AIで再生成」と生成日時を表示する（IMPLEMENTATION_CHECKLIST L366-367）
- [ ] 生成本文が空でない。`generated_at` が有効な ISO 形式である（IMPLEMENTATION_CHECKLIST L354-355）
- [ ] audience の値は bank・shareholder・employee のみ受け付ける（IMPLEMENTATION_CHECKLIST L353）
- [ ] 日本語テキストの品質を確認する（PHASE2_FINAL_GATE L153、PHASE2_VERIFICATION L242）
- [ ] 同じ（会社・戦略・audience）への同時生成で、後発が競合（未保存）になる（設計書 §8 の 5）
- [ ] 保存失敗の模擬（DB を一時的に止める、または権限を外す）で、未保存の応答と画面を確認する。AI の自動再実行がないことも確認する（設計書 §8 の 6）

## 2. 認証・権限・会社間分離

- [ ] 未認証は 401（SECURITY_FUNCTIONAL_TEST Test 1）
- [ ] 不正トークンは 401（同 Test 2）。`test-security.md` の手順は「400」を期待しているが誤り。認証は先に行われ、401 が返る（`app/api/plans/[audience]/generate/route.ts:62-64`）
- [ ] 不正な audience は 400（同 Test 3）
- [ ] スキーマ違反は 400（同 Test 4）
- [ ] 他社の companyId は 403（同 Test 5。PHASE2_VERIFICATION L223、L241。PHASE2_FINAL_GATE L152、L154）
- [ ] 他社の strategyId の期待値を修正してから実施する。戦略が存在しない場合は 404（`route.ts:118-119`）、会社と戦略の不一致は 403（`route.ts:139-140`）。Test 6 の期待値「403」は、404 のケースを含めて修正する
- [ ] member は生成が 403 になり、閲覧はできる（実機での確認は未実施。単体テストは `generate/route.test.ts` にある）
- [ ] AI に渡すデータが対象会社の範囲に限られる（SECURITY_FUNCTIONAL_TEST Test 8）。未検証: `buildPlanData` の audience フィルタ、プロンプトに含まれる入力の範囲
- [ ] 注意: AI プロンプトには会社名が含まれる（`route.ts:629`）。`test-security.md` の「実会社名を送らない」という前提は成り立たないため、そのルールは使わない
- [ ] 書き込みは生成側の保存（service_role）だけであることを確認する（SECURITY_FUNCTIONAL_TEST Test 9、未チェック項目 L106-109）。`/saved` は読み取りのみ（コード確認済み）
- [ ] `/saved` の API に対する動作テストは未実施（単体テストは `saved/route.test.ts`）
- [ ] テスト用のトークンは git にコミットしない（PHASE2_VERIFICATION L275-285）
- [ ] 本番の既存企業のデータに対して、他社の ID を使った書き込みテストを行わない（テストはステージングで行う）

## 3. 導線・画面（ローカル）

- [ ] 3 つのボタン（銀行・株主・社員）が表示される（ROUTING_FIX_REPORT L135、PHASE1_COMPLETION L113、PHASE2_COMPLETION L151）
- [ ] 各ボタンから対応する `/report/*-plan` に移動する（ROUTING L136、PHASE1_COMPLETION L114）
- [ ] 各ページでプレビューが表示される（ROUTING L137、PHASE1_COMPLETION L115-117、PHASE2_COMPLETION L152）
- [ ] 「AI本文を生成」でAPIが実行される（ROUTING L138、PHASE2_COMPLETION L153）
- [ ] 3 種類の URL にアクセスできる（ROUTING L179）
- [ ] 既存のレポート機能に影響がない（ROUTING L180）
- [ ] API にエラーが出ない（ROUTING L181）
- [ ] ブラウザでのルーティング確認（ROUTING L205）。API の動作確認（ROUTING L206）
- [ ] 未ログイン時に StrategyGuard がリダイレクトする（PHASE1_COMPLETION L118）
- [ ] 既存の PDF（ブラウザの印刷）が動作する（min-proto L272）
- [ ] 既存の STAGE1〜6 のページと `strategyStore` が、この機能の作業で意図せず変わっていないことを差分で確認する（min-proto L271、L273）。注意: `strategyStore` は会社切替の安全性対策で変更済み
- [ ] 型チェックとビルドを再実行する（min-proto L276-277。直近の実行は成功）

## 4. 生成内容の数値（ローカル）

- [ ] STAGE4 と STAGE6 の値が異なる場合の表示を確認する（PHASE2_VERIFICATION L119-121）
- [ ] 数値の合計で重複計上がないことを確認する（PHASE2_VERIFICATION L119-121。PHASE2_DATA_EXTRACTION L10-22 の重複計上の懸念）
- [ ] 数値の根拠・基準が明確である（PHASE2_VERIFICATION L119-121）
- [ ] 実企業による手動評価（自動テストでは検証できない）（PHASE2_VERIFICATION L40-41）
- [ ] 生成データの匿名化（テスト用の入力に実企業のデータを使わない）（PHASE2_FINAL_GATE L195-197、PHASE2_VERIFICATION L275-285）
- [ ] 推奨の手動確認（PHASE2_VERIFICATION L293-309）: 開発サーバーでの 5 手順、401・400・スキーマ 400 の応答、日本語の表示（文字化けなし、見出しの分割）
- [ ] Temperature の記載（0.7）と `planGenerate` の設定の不一致を確認する（PHASE2_VERIFICATION L53-57、L67。要確認）

## 5. 完了記録の残り

- [ ] ローカルでの動作確認（PHASE1_COMPLETION L187。「実施予定」と記載）
- [ ] ローカルでの手動テスト（推奨）（PHASE2_COMPLETION L248）
- [ ] セキュリティ検証（企業間分離など）（PHASE2_COMPLETION L249）
- [ ] 実際の STAGE1 データで `financePL` が正しく抽出されるか（PHASE1_FINAL_REPORT L344）
- [ ] 複数企業での動作確認（PHASE1_FINAL_REPORT L345）
- [ ] 銀行向け計画書の最終出力の確認（PHASE1_FINAL_REPORT L346）
- [ ] 実企業データを使用しない開発環境を確認する（PHASE2_DATA_EXTRACTION L266-268）
- [ ] 本番の計画書で数値が 0 件になる・誤るケースの確認（PHASE2_DATA_EXTRACTION L261-263 の 401・403・他社 strategyId の確認を含む）
- [ ] `buildPlanData.test.ts` の実行と結果の記録。PHASE1_VERIFICATION の「未実行」は古い記述。現在は Jest の設定があり、テスト件数も記録と一致しない（記録は 10 件、ファイルは `it(` 13 件）

## 6. 廃止した実装チェックリストの残り

- [ ] 保存・生成 API のテストスタブ（saved API 3 件、save API 4 件。IMPLEMENTATION_CHECKLIST L387-396）が、既存の単体テストで代替されているか確認する
- [ ] manager ロール（IMPLEMENTATION_CHECKLIST L103、L109）。CLAUDE.md の RBAC 定義（ADMIN・MEMBER・VIEWER）との整合は未確認
- [ ] 元のチェックリストは GET 方式とクライアント送信の本文を前提としている。現在の設計（POST・生成 API が保存）に読み替えて使う（[docs/archive/stakeholder-plan-dev-2026-10/IMPLEMENTATION_CHECKLIST.md](../archive/stakeholder-plan-dev-2026-10/IMPLEMENTATION_CHECKLIST.md)）

## 7. デプロイ・ロールバック（未実施）

- [ ] デプロイ手順の確認（IMPLEMENTATION_CHECKLIST L413-418）
- [ ] ロールバック手順の確認（IMPLEMENTATION_CHECKLIST L422-431）
- 本番での実施は別途承認が必要

## 8. Phase 3・後続（未実施）

- PDF 出力の確認項目（表紙、ページ番号、章見出し、改ページ、日本語、文字切れ、UI との一致など）は [STAKEHOLDER_PLAN_PHASE3_PLAN.md](../design/STAKEHOLDER_PLAN_PHASE3_PLAN.md) §6 を参照
- リリース前チェック（全種類の生成、セキュリティテスト、性能テスト、トレーニング、不具合報告体制、ロールバック計画）は [STAKEHOLDER_PLAN_DETAILED_DESIGN.md](../design/STAKEHOLDER_PLAN_DETAILED_DESIGN.md) §7 を参照
