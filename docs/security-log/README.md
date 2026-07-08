# セキュリティログ（security-log）

セキュリティに関する**実施済みの記録**（レビュー・是正計画・実装検証・監査結果）を時系列で保管するディレクトリ。
「現在どうあるべきか」は [`docs/spec/`](../spec/README.md)（特に監査マスタ [08-security-audit-checklist.md](../spec/08-security-audit-checklist.md)）が担い、本ディレクトリは**過去に何をやったかの証跡**のみを持つ。

## ディレクトリ構成

```
security-log/
├── review-01/   第 1 回セキュリティレビュー一式（2026-06-22〜07-03: レビュー本体・是正計画・実装検証ログ）
└── audits/      チェックリスト監査の実施結果（YYYY-MM-DD_audit-NN.md）
```

- **review-NN/** … 外部レビュー・診断など「ひとまとまりの取り組み」の関連文書一式を回ごとに格納する（第三者ペネトレーションテストを行う場合は `pentest-01/` 等、同じ要領で掘る）。
- **audits/** … チェックリスト形式の監査結果のみ。ここの**最新ファイルが「現在の是正状態」の正**となる。

## 運用ルール

- **追記のみ**。過去ファイルは書き換えない（明白なリンク切れ修正・凍結バナーの追加を除く）。
- ファイル名は `YYYY-MM-DD_<内容>.md`。旧 `docs/spec/` から移設した番号付き文書は、文中の相互参照（`[08]` `[11]`〜`[20]` 等）を保つため**旧番号を名前に残している**（`YYYY-MM-DD_<旧番号>-<旧スラッグ>.md`）。
- チェックリスト監査の実施結果は `audits/YYYY-MM-DD_audit-NN.md`（NN は通番）。マスタは [docs/spec/08-security-audit-checklist.md](../spec/08-security-audit-checklist.md)、記入ルールは同 §1.4。
- ログ内の相互参照は**移設前の旧番号のまま**書かれている。下の索引で読み替える。

## 索引（時系列）

| 日付 | ファイル | 旧番号 | 内容 |
|---|---|---|---|
| 2026-06-22 | [2026-06-22_08-security-review.md](./review-01/2026-06-22_08-security-review.md) | 08 | **第 1 回セキュリティレビュー**（発見 F-1〜F-11・良好 G-1〜G-7・IPA 11 分類対応・改善優先度・PoC までのステップ A〜E） |
| 2026-06-25 | [2026-06-25_10-remediation-plan.md](./review-01/2026-06-25_10-remediation-plan.md) | 10 | 是正計画（A-1〜A-7 / B / C / D タスク、優先度・工数・確認方法） |
| 2026-06-25 | [2026-06-25_11-implementation-pre-check-A1-A2.md](./review-01/2026-06-25_11-implementation-pre-check-A1-A2.md) | 11 | A-1/A-2 実装前調査 |
| 2026-06-25 | [2026-06-25_12-implementation-complete-A1-A2.md](./review-01/2026-06-25_12-implementation-complete-A1-A2.md) | 12 | A-1/A-2 実装完了報告 |
| 2026-06-25 | [2026-06-25_13-pre-deploy-verification.md](./review-01/2026-06-25_13-pre-deploy-verification.md) | 13 | デプロイ前最終確認（diff・ビルド） |
| 2026-06-28 | [2026-06-28_14-RLS-inventory-current-state.md](./review-01/2026-06-28_14-RLS-inventory-current-state.md) | 14 | RLS 現状棚卸し（全テーブル） |
| 2026-06-28 | [2026-06-28_15-RLS-and-RBAC-alignment-analysis.md](./review-01/2026-06-28_15-RLS-and-RBAC-alignment-analysis.md) | 15 | RLS × RBAC 整合性分析 |
| 2026-06-28 | [2026-06-28_16-strategy_data_rls_fix_details.md](./review-01/2026-06-28_16-strategy_data_rls_fix_details.md) | 16 | `strategy_data` RLS 修正案（migration 設計） |
| 2026-06-28 | [2026-06-28_17-strategy_data_rls_migration_verification.md](./review-01/2026-06-28_17-strategy_data_rls_migration_verification.md) | 17 | migration 案の精査 |
| 2026-06-28 | [2026-06-28_18-stage4-rls-impact-critical.md](./review-01/2026-06-28_18-stage4-rls-impact-critical.md) | 18 | STAGE4 保存 × role 制限 RLS の矛盾発見 |
| 2026-06-28 | [2026-06-28_19-RLS-POC-strategy-final-decision.md](./review-01/2026-06-28_19-RLS-POC-strategy-final-decision.md) | 19 | **意思決定記録**: ロール別書込 RLS（A-5b）の PoC 前適用見送り（リスク受容。※テナント分離確認 A-5a は対象外） |
| 2026-06-28 | [2026-06-28_20-PoC-pre-security-audit.md](./review-01/2026-06-28_20-PoC-pre-security-audit.md) | 20 | STAGE1-3 権限監査 → 新規-1（`assertMinRole` 漏れ 2 本）発見・修正 |
| 2026-07-03 | [2026-07-03_audit-01.md](./audits/2026-07-03_audit-01.md) | 08b 相当 | **第 1 回監査結果（ベースライン）**。旧状態台帳 08b をチェックリスト v1.0（108 項目）へ写像して置き換えたもの。判定: ❌ No-Go（✅10・⚠️21・❌17・N/A2・⬜58） |

## 第 1 回レビューからの引き継ぎ（オープン項目）

第 1 回レビュー終了時点（2026-07-03 @fe7ba8b）で未完了だった主な項目の早見表。全項目の判定・証跡・優先度順のアクションキューは [2026-07-03_audit-01.md](./audits/2026-07-03_audit-01.md) を正とする。**次回（第 2 回）監査の初期状態に必ず含めること**。

| 旧タスク | 内容 | チェックリスト対応 |
|---|---|---|
| A-5a / D-2 | テナント越境防止テスト（会社 A→B の select/update/delete 全拒否の実測）が未実施 | D-03・D-04 |
| A-5b | member の `strategy_data` 書込制御 RLS を PoC 後送り（**リスク受容の合意署名と本運用前の適用条件の明文化が未了**） | D-05（⚠️ 条件付として管理） |
| A-6 | 依存脆弱性（critical 2 / high 23）未解消 | L-01 |
| A-3 | 認可被覆 CI 未実装（未ガード 4 本は理由つき許可リスト化の方針） | C-10 |
| A-4 / D-3 | レート制限が環境未設定で fail-open・実機 429 未確認 | E-03 |
| A-7 | `audit_logs` の DB 適用・網羅・読取制限の検証未了 | K-01・K-02 |
| A-1（残） | Vercel から `NEXT_PUBLIC_OPENAI_API_KEY` 除去の環境確認 | G-01・G-02・G-04 |
| 新規-2 | CSP `connect-src` の `api.openai.com` 除去 | E-08 |
| B-1 / B-4 / C-1〜C-3 / D-1 | ビルド健全化・ログ制御・テナント運用・E2E ほか推奨項目 | L-07・K-04・M-09 ほか |

## 旧レビュー発見 ID → チェックリスト項目の対応

第 1 回レビュー（[旧08](./review-01/2026-06-22_08-security-review.md)）の発見 ID と、現行チェックリスト（[docs/spec/08-security-audit-checklist.md](../spec/08-security-audit-checklist.md)）の項目対応。
発見の詳細分析・コード根拠（file:line）は旧08 を参照する。

| 旧08 発見 | 概要 | チェックリスト対応項目 |
|---|---|---|
| F-1 | OpenAI キーのクライアント露出リスク | G-01・G-02 |
| F-2 | 無認証の生成系 API 8 本 | A-02 |
| F-3 | レート制限の不在 | E-03 |
| F-4 | ビルド設定(型/Lint 無視)・セキュリティヘッダ未設定 | E-08・L-07 |
| F-5 | 認可ロジックの二重化(適用漏れリスク) | C-08・C-10 |
| F-6 | 無認証の Cookie 設定エンドポイント | B-01・B-02 |
| F-7 | 本番ログの機微情報 | K-04・G-06 |
| F-8 | テナント分離が RLS 依存・未確認(最重要) | D-01〜D-05・D-07・D-08・D-11 |
| F-9 | 監査ログの欠如・`agent_logs` の問題 | K-01・K-02・K-05 |
| F-10 | 依存パッケージの既知脆弱性 | L-01・L-02・I-02 |
| F-11 | AI/LLM 固有の対策未整理 | F-01〜F-14 |
| G-1〜G-7 | 良好実装(維持確認) | A-10(G-1)・B-03(G-2)・C-09(G-3)・G-03(G-4)・C-08(G-5)・F-01(G-6)・J-01/J-02(G-7) |
| 新規-1 | `assertMinRole` 漏れ 2 本 | C-08・C-10 |
| 新規-2 | CSP の許可先が方針と不整合 | E-08 |
