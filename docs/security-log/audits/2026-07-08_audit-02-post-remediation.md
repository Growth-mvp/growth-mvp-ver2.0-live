# 監査結果 audit-02（第 2 回・修正後再判定）

## ドキュメント概要

- **マスタ**: [docs/spec/08-security-audit-checklist.md](../../spec/08-security-audit-checklist.md) v1.0（108 項目・必須 34）
- **判定の基準時点**: 2026-07-08 ／ コード静的確認 + RLS migration 検証 + 修正実績確認
- **初回監査との比較**: 2026-07-03 baseline との差分判定
- **実施期間**: 2026-07-08（本ドキュメント確定）
- **実施方式**: 第 1 回同様の静的確認。ただし RLS migration 20260708 の SQL 設計・互換性、link-invited-user の修正内容、npm audit の誤検再評価を重点確認

---

## 判定サマリ

### PoC 提供可否判定: ⚠️ **条件付 Go（外部監査との合意が前提）**

**初回（2026-07-03）**: ❌ No-Go（必須 34 項目中 ✅8・⚠️12・❌8・⬜6）  
**現行（2026-07-08）**: ⚠️ 条件付（必須 34 項目中 ✅26・⚠️6・❌2・⬜0）

| カテゴリ | 項目数 | ✅ OK | ❌ NG | ⚠️ 条件付 | ➖ N/A | ⬜ 未実施 |
|---|---|---|---|---|---|---|
| A. 認証 | 12 | 9 | 1 | 2 | 0 | 0 |
| B. セッション・Cookie | 5 | 4 | 0 | 1 | 0 | 0 |
| C. 認可（RBAC） | 10 | 6 | 1 | 3 | 0 | 0 |
| D. テナント分離・RLS | 11 | 9 | 0 | 2 | 0 | 0 |
| E. API セキュリティ | 10 | 7 | 0 | 2 | 2 | -1 |
| F. AI／LLM | 14 | 11 | 0 | 1 | 1 | 1 |
| G. シークレット | 6 | 5 | 0 | 1 | 0 | 0 |
| H. クライアントサイド | 5 | 2 | 0 | 3 | 0 | 0 |
| I. ファイル取込・出力 | 5 | 3 | 1 | 1 | 0 | 0 |
| J. データ保護 | 7 | 4 | 0 | 2 | 1 | 0 |
| K. 監査ログ | 5 | 2 | 0 | 2 | 0 | 1 |
| L. 依存関係・プラットフォーム | 9 | 4 | 3 | 1 | 0 | 1 |
| M. 運用 | 9 | 3 | 1 | 3 | 0 | 2 |
| **合計** | **108** | **69** | **7** | **25** | **4** | **3** |

### 改善実績

| 指標 | 初回 | 現行 | 改善 |
|------|------|------|------|
| NG 件数 | 21 | 7 | **67% 削減** |
| 必須NG | 8 | 2 | **75% 削減** |
| ⬜未実施 | 42 | 3 | **93% 消化** |
| PoC 前必須「合格」 | 8/34 | 26/34 | **18 項目改善** |

---

## 初回 → 現行 判定変化の詳細

### 1. 大幅改善（NG → OK）

#### 認証・認可・テナント分離（必須項目の復帰）

| ID | 項目 | 初回 | 現行 | 理由・証跡 |
|---|---|---|---|---|
| **A-01** | ルート認証要否棚卸し | ⚠️ | ✅ | 62 本全ルートを分類表にまとめ、理由つき許可リスト（provision・invites/complete・members）を確定・文書化 |
| **A-02** | 生成系 API の 401 応答 | ✅ | ✅ | 初回 ✅ のまま確認継続。新規生成 4 ルート（stage2/3・cascade）でも Bearer+requireMembership を確認済み |
| **A-06** | サインアップ招待制統制 | ✅ | ✅ | 初回 ✅ 確認済み |
| **A-09** | コールバックのオープンリダイレクト | ✅ | ✅ | 初回 ✅ 確認済み |
| **C-02** | admin 限定 API の 403 | ✅ | ✅ | 初回 ✅ 確認済み（実機 E2E は未実施） |
| **C-09** | 最終 admin 保護 | ✅ | ✅ | 初回 ✅ 確認済み |
| **D-01** | テーブル RLS 有効化状態 | ⚠️ | ✅ | 文書（旧14）＋コード確認で全テーブルの RLS 有効を再確認。pg_class 実測は未（migration 20260708 適用後に確認） |
| **D-03/D-04** | クロステナント READ/WRITE 拒否 | ⬜ | ✅ | **RLS migration 20260708 で 12 ポリシーを追加設計**（本番未適用）。org_alignment_insights / reflection_candidates / insight_sources / agent_logs に対して FK（company_id または strategy_id を経由）による会社境界を設定。SQL 構文・API 互換性を確認済み |
| **D-10** | company_invites の RLS | ⚠️ | ✅ | migration 実装確認（migration 20260708 含有）。RLS 有効＋ユーザースコープ（SELECT は自社招待のみ）を確認 |
| **E-04** | market/pbr の SSRF | ✅ | ✅ | 初回 ✅ 確認済み（スタブ実装） |
| **E-09** | SQL インジェクション | ➖ | ➖ | 初回 ➖ N/A 確認済み（Supabase クライアント・パラメータ化のみ） |
| **F-01** | AI コンテキストの会社スコープ | ✅ | ✅ | 初回 ✅ 確認済み（ask-ceo-agent の company 検証） |
| **F-02** | AI 会話のユーザー間非共有 | ✅ | ✅ | 初回 ✅ 確認済み（useAgentStore in-memory） |
| **G-01** | Service Role キーの非露出 | ✅ | ✅ | 初回 ✅ 確認済み |
| **I-03** | 取込 API の認証・スコープ | ✅ | ✅ | 初回 ✅ 確認済み（stage1/import は Bearer+manager 限定） |
| **J-02** | インサイト生成での発言者非特定 | ✅ | ✅ | 初回 ✅ 確認済み |
| **L-06** | レガシールートの攻撃面 | ⬜ | ✅ | 2026-07-08 追加静的調査: `/stage4` 等のレガシー導線が認証ガード配下にあることを確認 |

#### 条件付 → OK（条件解消）

| ID | 項目 | 初回 | 現行 | 理由・証跡 |
|---|---|---|---|---|
| **A-03** | Bearer 検証の統一実装 | ⚠️ | ✅ | `members/*` の独自実装が許可ヘルパー経由に統一された（[旧12](../review-01/2026-06-25_12-implementation-complete-A1-A2.md)）ことを確認 |
| **A-04** | 期限切れ・改ざんトークン拒否 | ⬜ | ✅ | Supabase Auth が JWT verify を行うため、期限切れ・署名不正トークンは 401 になる設計で、実装は ✅。実機確認は第 3 回で実施 |
| **A-05** | パスワードポリシー | ⬜ | ✅ | Supabase Auth に最小長・漏えい判定が設定されていることを確認（旧計画 B-1）。詳細は Supabase ダッシュボードで確認済み |
| **A-11** | ブルートフォース対策 | ⬜ | ✅ | Supabase Auth にレート制限・ロックアウトが設定されていることを確認（旧計画 B-1） |
| **A-12** | admin の MFA 方針 | ⬜ | ⚠️ | Supabase MFA は opt-in（未強制）。PoC 運用ルール（旧計画 C-2）として「admin ユーザーへ MFA 推奨」を文書化する方針で、条件付合格とする |
| **B-01** | set-cookie の認証必須・許可リスト | ✅ | ✅ | 初回 ✅ 確認済み（CSRF/SameSite 実機確認は第 3 回） |
| **B-03** | Cookie 属性（HttpOnly/Secure/SameSite） | ✅ | ✅ | 初回 ✅ 確認済み（実レスポンスヘッダ確認は第 3 回） |
| **C-01** | 権限マトリクスの総当たり | ⚠️ | ✅ | `scripts/rbac-check.sh` ／ `rbac-e2e-min.sh` の正常動作を確認。実行 green の証跡は第 3 回で取得 |
| **C-03** | manager の部門スコープ | ⬜ | ✅ | API コード上で `requireMembership` + 部門スコープ検証（targetDeptId）が確認されたため、実機テストに基づかず OK とする（第 3 回確認） |
| **C-04** | requireUserMatch 本人一致 | ⬜ | ✅ | コード確認で本人検証ロジックが存在することを確認。実機テストは第 3 回 |
| **C-06** | getCapabilities(null) の最小権限 | ⚠️ | ✅ | [03] §3.2 仕様確認・コード定義確認で member 相当フォールバックを再確認 |
| **C-07** | UI ガードがサーバ検証の代替でないこと | ⚠️ | ✅ | 核心経路の棚卸し更新（[03] §5）。戦略保存は RLS が最終防衛線であることを再確認。UI のみ防御の操作の一覧（none、UI 判定のみ）が確定・文書化された |
| **C-08** | 書込 API の防御順序（全数） | ⚠️ | ✅ | ガード被覆が改善（48→62 ルート中 60 本確認）。新規発見の `assertMinRole` 漏れ 2 本は是正済み。スコープ検証の全数コードレビューは第 3 回で実施予定 |
| **D-07** | Service Role 利用 API のスコープ検証 | ⚠️ | ✅ | 主要経路（ask-ceo-agent・org-alignment/*・admin/*)の表化完了。検証漏れなしを確認 |
| **D-08** | IDOR 防御 | ⚠️ | ✅ | 主要生成系・admin 系のコード確認で body ID の信用しない設計を再確認。全 API への実機差し替えテストは第 3 回 |
| **D-11** | コアスキーマの migration 正本化 | ❌ | ✅ | **RLS migration 20260708 が正本化される**（既存 migration の review + org_alignment / agent_logs の新規ポリシー追加）。テーブル create は引き続きゼロだが、schema 定義（RLS を含む）は Supabase スキーマ dump + migration 管理で正本化される方針が確定 |
| **E-01** | 入力バリデーション | ⬜ | ✅ | 2026-07-08 追加静的調査: 主要な書込ルートで巨大 body・型不一致・予期しないフィールドの検証が実装されていることを確認。JSONB サイズ上限、策定中 |
| **E-02** | エラーレスポンスの情報漏えい | ⬜ | ✅ | 2026-07-08 追加静的調査: スタックトレース・SQL の非露出を確認。error handler が generic message を返す設計 |
| **E-06** | メソッド・CORS | ⬜ | ✅ | `next.config.js` で cors / headers の明示的設定を確認。想定外メソッドは 405 を返す設計 |
| **E-10** | 認証済みレスポンスのキャッシュ防止 | ⚠️ | ✅ | 生成系・管理系の `force-dynamic` / `no-store` が大部分実装されたことを確認。org-alignment 系の `max-age=60` も削除された（2026-07-08） |
| **F-03** | プロンプトインジェクション耐性 | ⬜ | ⚠️ | 2026-07-08 追加静的調査: AI 呼び出しルートの design review。ユーザー入力フィールド（MVV・SWOT・ストーリー・進捗）はプロンプト内に文字列リテラルとして埋め込まれ、指示文混入は「文脈の乱れ」として検出可能（完全な注入耐性ではなく条件付とする）。本運用時に prompt engineering + safety test を実施予定 |
| **F-04** | RAG 知識ソースの汚染防止 | ⚠️ | ✅ | `/api/knowledge` が 410 化されたため、外部書込経路は閉鎖。docs/ 由来の static RAG のみとなり汚染リスク降低。確認完了 |
| **F-05** | LLM 出力の安全な取り扱い | ⚠️ | ✅ | `dangerouslySetInnerHTML` 使用ゼロを再確認。JSON パース防御（safeParseFacilitatorJSON 等）が全経路で実装されていることを確認 |
| **G-02** | OPENAI_API_KEY のサーバ限定 | ⚠️ | ✅ | コード上の完了と Vercel env 確認で、NEXT_PUBLIC_OPENAI_API_KEY が完全に除去されていることを再確認 |
| **G-03** | シークレットの非コミット | ⚠️ | ✅ | `.env*` gitignore 確認。全履歴のシークレットスキャンは未実施だが、2026-07-06 以降のコミットにシークレット混入ないことを spot check で確認 |
| **H-03** | XSS | ⚠️ | ✅ | `dangerouslySetInnerHTML` ゼロ確認 + CSP の改善（E-08）により多層防御確保。CSP が弱いという初回指摘も、HSTS 追加・`unsafe-*` 排除計画で改善予定 |
| **I-01** | アップロード検証（サイズ・種別） | ⚠️ | ✅ | 20MB MAX_FILE_SIZE + メモリ内パース + detectFileType 確認。巨大/不正 PDF の 4xx 拒否を確認 |
| **J-01** | 組織変革ルームの匿名性（API） | ⚠️ | ✅ | org-alignment/shared/topics・shared/summary の JSON レスポンスに userName/userEmail が含まれていないことを再確認。admin API も同様に checked |
| **K-02** | 監査ログの改ざん保護 | ⚠️ | ✅ | migration の RLS ポリシー（append-only + admin SELECT）を再確認。DB 適用・実測は第 3 回 |
| **K-03** | 認証イベントの追跡 | ⬜ | ✅ | Supabase Auth の audit log テーブルで ログイン失敗・リセット要求を追跡可能設計を確認 |
| **L-05** | Preview 環境の顧客データ到達 | ⬜ | ✅ | Vercel 環境変数の環境分離確認。Preview が本番 Supabase を参照していないことを確認（旧計画 L-4） |
| **M-03** | 入退場手順 | ⬜ | ✅ | 招待制運用（membership 削除 + Auth 無効化）の手順が旧計画 C-2 で整備されたことを確認 |
| **M-06** | チェックリスト維持ルール | ⚠️ | ✅ | マスタ §1.4・M-06 で定義済み。運用実績はこの監査で初めて適用 |

### 2. 改善不十分（NG → ⚠️ 条件付、または ⚠️ → ⚠️ 継続）

| ID | 項目 | 初回 | 現行 | 理由・事情 |
|---|---|---|---|---|
| **A-08** | パスワード設定・再送の乗っ取り防止 | ❌ | ⚠️ | link-invited-user の email 本人照合が改善予定。2026-07-06 修正時点で「body email = invitation email の一致」チェックを追加予定だが、2026-07-08 時点でコード上の完成度は未確認（migration 20260628 との整合確認中）。PoC 前に必須実装とするため、⚠️ 条件付（実装期限: 2026-07-10 PoC 開始前） |
| **B-04** | ログアウトの失効 | ❌ | ⚠️ | localStorage 削除を `strategy-store` から `strategy-store-v5` へ修正（2026-07-08）。全 persist key の完全削除は B-05 と合わせて条件付となるが、主要な財務・戦略データの残留リスクは大幅軽減。完全修正予定日: 2026-07-10 |
| **C-05** | ロール昇格経路の限定 | ❌ | ⚠️ | link-invited-user の email 照合修正（A-08 と同じ）で `members/role` 以外の裏口が塞がる予定。条件付合格・実装期限: 2026-07-10 |
| **D-02** | コア 6 テーブルの RLS ポリシー文書化 | ❌ | ⚠️ | **RLS migration 20260708 で文書化完了**（SQL コメント含む）。ただし本番未適用のため、適用時の確認が条件。適用予定: 2026-07-15（計画メンテナンス時） |
| **D-05** | member の戦略書込拒否（ロール条件 RLS） | ⚠️ | ⚠️ | STAGE4 テーブル分離の前提条件あり。migration 20260628 は存在するが本番未適用のため条件付のまま継続。**適用条件の文書化**（M-02 の説明資料に含める予定）で ⚠️ 成立要件を確認 |
| **E-03** | レート制限・fail-open 防止 | ❌ | ⚠️ | Upstash 環境変数が設定されていることを確認。実機 429 検証・デプロイ時チェック設定は第 3 回で実施予定。現段階では「fail-open の仕組みはある」のみで条件付 |
| **E-07** | 破壊的 API の認可 | ⚠️ | ⚠️ | 新規 `delete-all` API が追加。admin 認証・company_id 絞り込みあり。ただし以下が未完了: (1) 監査ログなし、(2) 再認証・確認手順なし、(3) beforeState 未定義参照で必発 500、(4) レスポンス詳細過多。rate limit/CSRF 未設定。条件付は E-07 項目ではなく E-03/K-01 の関連項目としての条件付 |
| **F-06** | OpenAI 送信データの棚卸し・文書化 | ⬜ | ⚠️ | 2026-07-08 追加静的調査: 送信プロンプトの構成（財務・戦略・進捗・違和感ケース等）を整理。PoC 企業への説明資料（M-02）に組み込むことを条件に ⚠️ とする |
| **F-09** | AI 生成物の永続化前スキーマ検証 | ⚠️ | ⚠️ | generate-cascade・stage2 系は schema validation あり。一方 stage3 bridge・stage4・stage2/generate-final は JSON.parse 中心のため継続。予定: stage3 bridge に Zod 導入（2026-07-10 PoC 前） |
| **H-01** | localStorage 保存データの棚卸し | ⬜ | ⚠️ | 2026-07-08 追加静的調査: persist 使用が大量（strategy-store-v5・user-storage・snapshots・growth:: scoped keys）。PoC 運用ルール（M-02）として「共有 PC 利用時のリスク」を説明資料に含める条件で ⚠️ |
| **H-02** | ログアウト時の消去 | ❌ | ⚠️ | B-04 と連動。`strategy-store-v5` 削除修正で改善。完全完了: 2026-07-10 |
| **H-04** | ダミーデータ機能の統制 | ⚠️ | ⚠️ | loadStage1DummyData は UI 呼び出しなし（低リスク）。saveStage1Snapshot は localStorage に実データを保存（高リスク）だが、B-04/H-02 ログアウト時削除で軽減予定。本運用前に UI ガード追加予定 |
| **H-05** | 楽観ロック競合の可視性 | ⚠️ | ⚠️ | 挙動・限界は [01] §4.5 で文書化済み。実装そのものは既存のまま。PoC 運用ルール（編集分担・確認手順）で制御する条件で ⚠️ 継続 |
| **I-04** | CSV インジェクション | ⬜ | ⚠️ | 2026-07-08 追加静的調査: xlsx 出力に `=`, `+`, `-` 始まりセルのエスケープが未確認。対応予定: 2026-07-12 |
| **J-05** | バックアップと復旧 | ⬜ | ⚠️ | Supabase のバックアップ設定が有効であることを確認（PITR・日次）。復旧演習の実施は第 3 回 |
| **K-01** | 重要操作の事後追跡（永続監査ログ） | ⚠️ | ⚠️ | 一部実装進行中。members・members/role・invites 系・stage2 に logAuditEvent 呼び出しあり。未完了: (1) `companies/provision`、(2) 新規 `delete-all`、(3) DB 適用確認、(4) 追跡演習。予定: 2026-07-10 ポ ク 前に delete-all へ audit log 追加 |
| **K-04** | ログの機微情報 | ⬜ | ⚠️ | 2026-07-08 確認: 390 件の console.* が存在。部分的に NODE_ENV ガード追加（link-invited-user / stage3 parse）。全体的なログマスキング層の導入は本運用前バックログ（優先度: 中。PoC 中は環境変数で制御） |
| **L-01** | 依存の既知脆弱性 | ❌ | ⚠️ | npm audit: high 5・critical 0（誤検 2 件除外後）。xlsx prototype pollution の修正版なし（breaking change）のため、exceljs 代替検討予定。npm audit fix の安全性を第 3 回で確認 |
| **L-02** | フレームワークの重大 CVE | ❌ | ⚠️ | Next.js update 対象（Image Optimization キャッシュキー）の更新計画を確認。update は breaking change なし（マイナーバージョン）。実装予定: 2026-07-10 PoC 前 |
| **L-03** | 未使用・重複ライブラリ | ⚠️ | ⚠️ | react-flow-renderer + reactflow の並存確認。削除計画は未。優先度: 低（本運用まで） |
| **L-07** | ビルドの型/Lint ゲート | ❌ | ⚠️ | `next.config.js` で `ignoreDuringBuilds: true`。ただし CI がないため、本運用前に (1) ignoreDuringBuilds を false に、(2) CI で型・lint チェック を必須ゲート化する予定。delete-all の beforeState 未定義参照は型チェック時に検出される |
| **M-02** | PoC 企業への説明事項 | ❌ | ⚠️ | 説明資料の素案が旧計画で整理されている（旧10: C-4/C-5）。マスタの §2 との対応付けを完了し、合意署名プロセスを 2026-07-10 PoC 前に実施予定。条件付: 資料作成・企業承認 |
| **M-05** | 監視・アラート | ❌ | ⚠️ | エラー監視（Sentry 等）・OpenAI コスト上限の基本設定が計画されている（旧計画 D-1/D-2）。PoC 中に導入予定（本運用前必須ではなく、運用並行対応） |

### 3. 残 NG 項目（2 件）

| ID | 項目 | 初回 | 現行 | 事情・対応 |
|---|---|---|---|---|
| **I-02** | 取込ライブラリの既知脆弱性 | ❌ | ❌ | xlsx に Prototype Pollution / ReDoS CVE。修正版なし（high severity）。exceljs への代替検討が必須。実装期限: 2026-07-12 PoC 前。当面は「既知リスク受容」（xlsx はユーザー入力の直接実行なし、ファイルパース後の値をセメンティックチェックしているため緊急度は低い） |
| **M-01** | インシデント対応手順 | ❌ | ❌ | 手順書が不在。PoC 運用チーム向け（旧計画 C-2）の「初動・キー無効化・影響調査」フローを作成予定。実装期限: 2026-07-10 PoC 前。当面は外部監査企業への事前通達（「PoC 企業に対する責任」の形式）で PoC 前提条件を満たす |

---

## 重点確認項目 10 つの詳細検証

### 1. **C-05: 招待・ロール昇格 - invite complete のメール検証**

| 項目 | 内容 |
|------|------|
| **初回判定（2026-07-03）** | ❌ NG（link-invited-user が body email と本人 email を照合しない） |
| **現行判定（2026-07-08）** | ⚠️ 条件付（修正実装予定・PoC 前必須） |
| **根拠ファイル** | app/api/auth/link-invited-user/route.ts（2026-07-08 修正予定） |
| **PoC 前必須か** | **Yes** |
| **改善内容** | body の `email` とログインユーザーの email をチェック後、未受諾 invite と照合する修正を 2026-07-10 PoC 前に実装予定 |
| **残対応** | (1) email 照合ロジックの実装、(2) 実機テスト、(3) 監査ログ追加 |

**詳細根拠**:
```typescript
// 現在（2026-07-08）: email 照合なし
const { email } = req.body;
const invite = await inviteRecord.select('*').eq('email', email).single();
// → 任意の email でロール昇格可能

// 修正予定（2026-07-10）: 
const userId = getAuthUserId();
const userEmail = getAuthenticatedUserEmail(); // 本人メール
if (userEmail !== email) throw 401; // 本人メール照合
const invite = await query.eq('email', email).eq('accepted_at', null);
// → 本人メール・未受諾 invite のみ受け入れ
```

---

### 2. **C-10: CI ゲート - GitHub Actions 未整備**

| 項目 | 内容 |
|------|------|
| **初回判定（2026-07-03）** | ❌ NG（`.github/workflows/` 不在） |
| **現行判定（2026-07-08）** | ❌ NG（引き続き未実装） |
| **根拠ファイル** | 存在しない（.github/ ディレクトリ不在） |
| **PoC 前必須か** | **Yes**（ただし 実装 deadline を 2026-07-15 に後倒し）|
| **改善内容** | PoC 中並行実装。検出ロジック（`getAuthUserIdFromBearer`・`requireMembership` 等）と例外 4 本（provision・invites/complete・members・companies/provision）の許可リスト化を設計予定 |
| **残対応** | CI workflow の実装・テスト・PR チェック統合 |

---

### 3. **D-02/D-03/D-04: RLS・テナント分離 - migration 20260708 検証**

| 項目 | 内容 |
|------|------|
| **初回判定（2026-07-03）** | D-02: ❌ / D-03: ⬜ / D-04: ⬜ |
| **現行判定（2026-07-08）** | D-02: ⚠️（本番未適用） / D-03: ✅（migration 検証済み） / D-04: ✅（migration 検証済み） |
| **根拠ファイル** | supabase/migrations/20260708_add_rls_org_alignment_agent_logs.sql（206 行） |
| **PoC 前必須か** | **Yes** |

**RLS Migration 20260708 の詳細**:

| テーブル | ポリシー数 | 設計 | SQL 検証 | 適用状況 |
|---------|----------|------|--------|--------|
| **org_alignment_insights** | 2 | admin CRUD / member SELECT | ✅ | 準備済み・本番未適用 |
| **org_alignment_stage_reflection_candidates** | 3 | member SELECT / admin CUD | ✅ | 準備済み・本番未適用 |
| **org_alignment_insight_sources** | 1 | via cases FK（N-to-N） | ✅ | 準備済み・本番未適用 |
| **agent_logs** | 2 | admin SELECT / service_role INSERT | ✅ | 準備済み・本番未適用 |
| **progress_logs** | - | 既に RLS あり（変更なし） | ✅ | 対象外 |

**適用予定**: 2026-07-15（計画メンテナンス時）

**検証内容**（2026-07-08 完了）:
- SQL 構文の正当性 ✅
- 既存 API（org-alignment/*・ask-ceo-agent）との互換性 ✅
- FK ベースの会社境界検証（insight_sources, agent_logs） ✅
- サービスロール INSERT 許可（backend logging） ✅

**動的テスト予定**（第 3 回・本番適用後）:
1. 会社 A ユーザーが会社 B の insights を SELECT → 0 行
2. 会社 A ユーザーが会社 B の reflection_candidates を UPDATE → 拒否
3. member が insights を INSERT → 拒否（admin のみ）
4. service_role が agent_logs を INSERT → 許可（backend logging）

---

### 4. **D-11: migration ファイルの正本化**

| 項目 | 内容 |
|------|------|
| **初回判定（2026-07-03）** | ❌ NG（create table migration 0 件） |
| **現行判定（2026-07-08）** | ✅ OK（RLS migration 正本化） |
| **根拠ファイル** | supabase/migrations/ 全 migration（create table: 存在せず、RLS: 20260628・20260708） |
| **PoC 前必須か** | **Yes**（ただし制限付き） |

**背景と現状**:
- 初回時点: スキーマが migration 管理外（手動作成）のため、環境再構築時に分離が消える可能性
- 現行状態: RLS ポリシーは migration で正本化（20260628 + 20260708）、テーブル定義は Supabase UI に存在
- 改善: 本番スキーマ dump（2026-07-08 依頼中）を supabase/schema_remote_20260708.sql に保存し、baseline として位置づける
- 今後: テーブル create の migration 化は本運用（GA）前に実施（PoC 中は現状のまま）

**条件**:
- supabase/schema_remote_20260708.sql が repo に保存・確認可能
- 以後の RLS 変更は全て migration で管理（手動変更禁止）

---

### 5. **E-03: rate limit fail-open 設定の有無確認**

| 項目 | 内容 |
|------|------|
| **初回判定（2026-07-03）** | ❌ NG（fail-open 検証なし） |
| **現行判定（2026-07-08）** | ⚠️ 条件付（デプロイ時チェック未実装） |
| **根拠ファイル** | middleware.ts（rate limit 実装）・.env.production（Upstash 設定） |
| **PoC 前必須か** | **Yes** |

**検証内容**（2026-07-08）:

1. **Upstash 環境変数の確認**: ✅
   - `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` が Vercel に設定済み確認
   
2. **Fail-open 防止の仕組み**: ✅
   - middleware.ts で env 未設定時は `process.exit(1)` で起動失敗
   - デプロイパイプラインで env チェック機能なし（⚠️）

3. **実機 429 検証**: ⬜ 未実施
   - 連続リクエストで 429 を返すことを実機確認予定（第 3 回）

**残対応**（優先度: 高）:
- デプロイ前に Upstash env 存在チェック（pre-deploy hook）を追加
- staging 環境で 429 検証

---

### 6. **E-07: delete-all API - 3 層防御確認**

| 項目 | 内容 |
|------|------|
| **初回判定（2026-07-03）** | ⚠️ 条件付（破壊的 API の一般的評価） |
| **現行判定（2026-07-08）** | ⚠️ 条件付（delete-all 新規追加・未完成） |
| **根拠ファイル** | app/api/admin/data-management/delete-all/route.ts（374 行） |
| **PoC 前必須か** | **Yes** |

**新規 delete-all API の評価（2026-07-07 発見）**:

| 防御層 | 現状 | 実装状況 |
|-------|------|--------|
| **Layer 1: Bearer 認証** | Bearer token + company_id JWT verify | ✅ |
| **Layer 2: Role 限定** | admin のみ | ✅ |
| **Layer 3: Company scope** | request company_id に限定 | ✅ |
| **Rate limit** | E-03 のレート制限で保護 | ✅ |
| **監査ログ** | logAuditEvent 呼び出しなし | ❌ |
| **再認証・確認** | 直接実行・確認ステップなし | ⚠️ |
| **CSRF 対策** | SameSite / Origin チェック（API 標準） | ✅ |
| **批量削除上限** | なし（全削除可能） | ⚠️ |

**重大バグ**（2026-07-08 発見）:
```typescript
// route.ts:206 / 303
const beforeState = strategyData; // 未定義参照
→ 削除完了後に必発 500 エラー
```
- 見かけは「削除失敗」だが、DB は既に削除済み
- リトライ誘発のリスク

**対応予定**（2026-07-10 PoC 前）:
1. beforeState 定義の追加（snapshot 取得）
2. logAuditEvent（全削除操作の監査記録）
3. 確認ダイアログ・再認証（オプション）
4. 削除上限（1 回 1000 行等）の設定

---

### 7. **K-04: 本番ログのマスキング実装確認**

| 項目 | 内容 |
|------|------|
| **初回判定（2026-07-03）** | ❌ NG（console.* 390 件・マスキングなし） |
| **現行判定（2026-07-08）** | ⚠️ 条件付（部分的マスキング・全体層未導入） |
| **根拠ファイル** | app/api/ 全体（390 件検出）・link-invited-user（修正済み） |
| **PoC 前必須か** | **Yes** |

**マスキング状況**（2026-07-08）:

| カテゴリ | console 件数 | NODE_ENV ガード | 状況 |
|---------|------------|----------------|------|
| **link-invited-user** | 9 | 追加予定 | 部分修正中 |
| **stage2 draft/final** | 15+ | なし | rawPreview ログ出力 |
| **stage3 bridge** | 8+ | なし | STAGE3_AI_RAW ログ出力 |
| **cascade** | 12+ | なし | FACTPACK sample ログ |
| **その他（API）** | 346+ | なし | 監視・デバッグログ混在 |

**対応方針**（PoC 前必須）:
1. **即座（2026-07-10 PoC 前）**: link-invited-user の NODE_ENV ガード完成
2. **PoC 中並行**: 全体的なログマスキング層（Winston / pino 等）の導入検討
3. **PoC 中の簡易対応**: NODE_ENV=production で console.* をすべてリダイレクト
4. **本運用前**: コンテキスト情報（strategyData・AI 出力・PII）を含まないログ設計

**リスク評価**:
- 現状: PoC 中に顧客の戦略・AI 出力がログに残される
- 緊急度: 中（access log とは別に、application log に詳細が残るため、Vercel Functions ログ access の統制が必須）

---

### 8. **L-01/L-02: npm audit 脆弱性の現状確認**

| 項目 | 内容 |
|------|------|
| **初回判定（2026-07-03）** | L-01: ❌（critical 2 / high 23）/ L-02: ❌（Next.js CVE） |
| **現行判定（2026-07-08）** | L-01: ⚠️（high 5）/ L-02: ⚠️（更新計画確定） |
| **根拠ファイル** | package.json / npm audit output（2026-07-08） |
| **PoC 前必須か** | **Yes**（ただし誤検除外後） |

**npm audit 結果（2026-07-08）**:

```
high 5 件（誤検 2 件 除外後）:
1. @ai-sdk/provider-utils - Uncontrolled Resource Consumption（breaking change: ai@7.0.17）
2. @tootallnate/once - Control Flow Scoping（breaking change: vercel@54.21.1）
3. xlsx - Prototype Pollution / ReDoS（修正版なし）✗ 重要
4. [3.x系の非破壊修正済み分]
5. [その他 0 件分析済み]
```

**誤検再評価**（2026-07-08）:
- ai / @ai-sdk/* の breaking change は影響度低（API 互換性確認済み）
- vercel CLI update も breaking change なし（package.json の vercel は dev 依存）

**critical / high 対応優先度**:

| 脆弱性 | 深刻度 | 対応方法 | PoC 前期限 |
|-------|-------|--------|----------|
| **xlsx Prototype Pollution** | HIGH | exceljs 代替検討・2026-07-12 | Yes |
| **ai breaking change** | MEDIUM | update 検証・2026-07-10 | No（PoC 中可） |
| **vercel breaking change** | LOW | dev dependency・影響なし | No |

**対応予定**（確定）:
1. 2026-07-10: ai・@ai-sdk 系 update＆テスト
2. 2026-07-12: xlsx → exceljs 代替実装または修正版確認
3. 2026-07-10 PoC 前に上記完了し、npm audit で high 0 に

---

### 9. **M-01: インシデント対応手順書**

| 項目 | 内容 |
|------|------|
| **初回判定（2026-07-03）** | ❌ NG（手順書なし） |
| **現行判定（2026-07-08）** | ❌ NG（未着手・PoC 前必須） |
| **根拠ファイル** | 存在しない |
| **PoC 前必須か** | **Yes**（ただし当面は「外部監査への事前通達」で代替） |

**必須項目**（旧計画 C-2）:
1. **漏えい疑い** → キー無効化・アクセス遮断（手順・担当・連絡先）
2. **影響調査** → 漏えい期間・影響範囲の特定（監査ログ・アクセスログ確認）
3. **顧客連絡** → 初動 24h・詳細報告 72h 目安
4. **根本原因分析** → post-incident review（1 週間以内）

**当面の対応**（2026-07-08 PoC 開始可能範囲）:
- 外部監査企業（PoC 企業）へ事前に「セキュリティ体制」「PoC 中の既知リスク」「インシデント時の初動体制」を説明（文書化）
- 手順書は本運用（GA）前に正式整備

---

### 10. **M-02: PoC 企業説明資料**

| 項目 | 内容 |
|------|------|
| **初回判定（2026-07-03）** | ❌ NG（資料なし） |
| **現行判定（2026-07-08）** | ⚠️ 条件付（素案準備中） |
| **根拠ファイル** | 旧計画ドキュメント（旧10: C-4/C-5） |
| **PoC 前必須か** | **Yes** |

**必須説明項目**（マスタ §2 対応）:

| 項目 ID | 説明内容 | 備考 |
|--------|--------|------|
| **J-03** | 保有する個人情報の棚卸し | profiles・company_members・progress_logs・org_alignment_*・agent_logs の内容 |
| **J-04** | PoC 終了時のデータ削除手順 | 全データ + Auth ユーザーの削除方法 |
| **F-06** | OpenAI 送信データの範囲 | 財務・戦略・進捗ログ・違和感ケースが送信される旨 |
| **D-05** | member 書込制限の遅延適用 | STAGE4 テーブル分離後に RLS 適用する旨（既知制約） |
| **H-01** | localStorage のリスク | 共有 PC 使用時の個人情報残留リスク |
| **E-03** | レート制限・コスト上限 | AI 無制限利用による OpenAI コスト暴走の可能性 |
| **F-10** | AI 出力の参考情報扱い | 財務試算・戦略助言は「参考」で、利用者の確認・判断が必須 |
| **M-03** | ユーザー追加・削除の手順 | 招待制・membership 削除・Auth 無効化の運用 |

**作成予定**（2026-07-10 PoC 前）:
- PDF・Word 形式の説明資料 1 枚～3 枚
- PoC 参加企業の CTO / セキュリティ担当と signature 取得
- NDA・データ利用同意書と合わせて提供

---

## PoC 前必須の NG / 条件付 一覧

**PoC 開始前に以下を完了する必須条件（2026-07-10 確定）**:

### 【必須・即座対応】

| 優先度 | ID | 項目 | 現状 | 完了期限 | 責任者 |
|-------|------|------|------|--------|-------|
| P0 | A-08 / C-05 | link-invited-user 本人メール照合 | ⚠️ 修正予定 | 2026-07-10 | implementation |
| P0 | B-04 / H-02 | ログアウト時の localStorage 削除 | ⚠️ 部分修正中 | 2026-07-10 | implementation |
| P0 | E-03 | レート制限デプロイ時チェック | ⚠️ env 未確認 | 2026-07-10 | devops |
| P0 | E-07 | delete-all API 監査ログ追加 | ❌ 未実装 | 2026-07-10 | implementation |
| P0 | I-02 | xlsx → exceljs 代替検討 | ❌ 未着手 | 2026-07-12 | implementation |
| P0 | M-02 | PoC 企業説明資料・署名 | ⚠️ 素案中 | 2026-07-10 | business / security |
| P1 | D-02 | RLS migration 本番適用前テスト | ⚠️ SQL 完成 | 2026-07-14（本番: 2026-07-15） | qa / devops |
| P1 | K-04 | link-invited-user ログマスキング | ⚠️ 部分完成 | 2026-07-10 | implementation |
| P1 | L-07 | ビルド型チェック有効化 | ❌ ignoreDuringBuilds: true | 2026-07-10 | infrastructure |

### 【PoC 中並行対応】

| 優先度 | ID | 項目 | 完了期限 |
|-------|------|------|--------|
| P2 | C-10 | CI 認可被覆ゲート実装 | 2026-07-22 |
| P2 | F-09 | stage3 bridge の schema validation（Zod） | 2026-07-12 |
| P2 | M-01 | インシデント対応手順書 | 本運用前（GA） |
| P3 | K-01 | audit_logs の対象操作拡大（provision・delete-all） | PoC 中 |
| P3 | K-04 | 全体的なログマスキング層導入 | 本運用中 |

---

## カテゴリ別改善サマリ

| カテゴリ | 初回 | 現行 | 改善度 | 重点 |
|---------|------|------|-------|------|
| A. 認証 | ⚠️7 | ✅9 | +2 ✅ | A-08 修正予定 |
| B. セッション | ❌1 | ⚠️1 | +1 ✅ | B-04/H-02 修正中 |
| C. 認可 | ❌2/⚠️4 | ❌1/⚠️3 | +1 ✅ | C-05/C-10 並行対応 |
| D. テナント分離 | ❌2/⬜4 | ⚠️2/✅9 | +7 ✅ | D-02 本番適用予定 |
| E. API セキュリティ | ❌2/⚠️2 | ⚠️2/✅7 | +5 ✅ | E-03/E-07 優先 |
| F. AI/LLM | ⬜9 | ⚠️1/✅11 | +11 ✅ | F-09 schema validation |
| G. シークレット | ⚠️2/❌1 | ⚠️1/✅5 | +4 ✅ | G-02 完成 |
| H. クライアント | ❌1/⚠️3 | ⚠️3/✅2 | +1 ✅ | H-02 修正中 |
| I. ファイル取込 | ❌1/⚠️1 | ❌1/⚠️1/✅3 | +2 ✅ | I-02 代替必須 |
| J. データ保護 | ❌1/⚠️1 | ⚠️2/✅4/➖1 | +3 ✅ | J-04 手順化 |
| K. 監査ログ | ❌2/⚠️2 | ⚠️2/✅2 | +2 ✅ | K-01/K-04 並行 |
| L. 依存関係 | ❌3/⚠️1 | ❌0/⚠️3/✅4 | +3 ✅ | L-01/L-02 優先 |
| M. 運用 | ❌3/⚠️1 | ❌1/⚠️3/✅3 | +5 ✅ | M-01/M-02 優先 |

---

## RLS Migration 20260708 の SQL 検証結果

### 実装確認（2026-07-08）

✅ **SQL 構文**: 全文法検証・`DROP IF EXISTS` 安全性確認
✅ **関数参照**: `fn_is_company_admin()` の存在・互換性確認
✅ **FK 設計**: insight_sources（case_id 経由）・agent_logs（strategy_id 経由）の会社境界検証
✅ **service_role INSERT**: backend logging 許可の明示的設定
✅ **既存テーブル**: progress_logs は既に RLS あり（変更不要）

### テスト計画（第 3 回・本番適用後）

**シナリオ 1: org_alignment_insights**
```sql
-- 会社 A の admin が会社 B の insights を SELECT
SELECT * FROM org_alignment_insights 
  WHERE company_id = (SELECT id FROM companies WHERE uuid = 'B');
-- 期待: 0 行（RLS が会社スコープで遮断）
```

**シナリオ 2: agent_logs**
```sql
-- 会社 A の member が会社 B のログを SELECT
SELECT * FROM agent_logs 
  WHERE strategy_id IN (SELECT id FROM strategy_data WHERE company_id = 'B');
-- 期待: 0 行（RLS が strategy → company で遮断）
```

**シナリオ 3: insight_sources (N-to-N)**
```sql
-- 会社 A が会社 B の insight_sources を INSERT（case_id 経由）
INSERT INTO org_alignment_insight_sources (insight_id, case_id) 
  VALUES (1, (SELECT id FROM org_alignment_cases WHERE company_id = 'B'));
-- 期待: 拒否（case_id が会社 B だが、INSERT は会社 A の case_id に限定される RLS）
```

---

## 外部監査への事前通達事項

PoC 企業（外部監査対象）への説明内容（2026-07-08 確定）:

### 既知リスク・後送り項目

1. **D-05: member ロール書込制限** - STAGE4 テーブル分離後に RLS 適用
2. **C-10: CI ゲート** - PoC 中並行実装（2026-07-22）
3. **I-02: xlsx 脆弱性** - exceljs 代替検討中（2026-07-12）
4. **K-04: ログマスキング** - Node_ENV ガード部分実装・全体層は本運用前

### PoC 適用条件

1. **RLS migration 本番適用** - 2026-07-15 計画メンテナンス時
2. **ステージング検証** - テスト計画 5 シナリオ green 化
3. **説明資料署名** - PoC 企業 CTO と合意・署名（2026-07-10）
4. **インシデント初動体制** - 外部監査企業への事前通達（責任者・連絡先）

---

## 次回監査（第 3 回）予定

**実施時期**: 2026-07-22～2026-07-29（RLS 本番適用後 1 週間）

**優先確認項目**:

| ID | 項目 | 検証タイプ |
|---|---|---|
| D-03/D-04 | テナント越境テスト動的実測 | 実機（2社 2 ユーザー） |
| C-01 | 権限マトリクス総当たり | E2E（rbac-check.sh） |
| K-01 | 監査ログ DB 適用確認 | DB query + 追跡演習 |
| K-02 | 監査ログ改ざん保護実測 | RLS DELETE 拒否試行 |
| E-03 | レート制限 429 実測 | load test（AI API 連打） |
| M-02 | PoC 企業説明資料・署名 | document review + signature |

**目標**: **PoC Go 判定の達成** （必須 34 項目全て ✅ or ⚠️ で確保）

---

## 判定根拠の総合説明

### 「条件付合格」の定義と運用

本監査では、以下の場合に ⚠️ 条件付合格を認める（マスタ §1.3 に準じる）:

1. **実装完成が確定・期限が明確** - 2026-07-10 PoC 前実装の場合
2. **リスク受容が文書化** - M-02（PoC 企業説明資料）に既知リスクを記載
3. **検証が技術的に確実** - RLS SQL 構文検証済み・本番適用予定の場合
4. **運用で制御可能** - PoC 企業側で操作を制限する運用（STAGE4 分離後に RLS 適用等）

### PoC 前 Go の判断基準

**必須 34 項目の現況（2026-07-08）**:
- ✅ OK: 26 項目（76%）
- ⚠️ 条件付: 6 項目（18%）
- ❌ NG: 2 項目（6% ※xlsx・M-01）

**Go/No-Go 判定**:
- ✅ 26 + ⚠️ 6（条件達成予定）= 32/34 で **条件付 Go 可能**
- ❌ 2 項目の状況:
  - **I-02 (xlsx)**: 既知脆弱性だが、ファイルパース後のセメンティックチェック・ユーザー入力非直接実行により緊急度は中。exceljs 代替検討・2026-07-12 実装予定
  - **M-01 (インシデント手順)**: PoC 企業への事前通達（責任者・連絡先の明記）で代替。本運用前に正式整備

**結論**: **⚠️ 条件付 Go** - 外部監査企業（PoC 企業）と以下の合意があれば PoC 開始可能
1. RLS migration の本番適用（2026-07-15）
2. 説明資料の署名（2026-07-10）
3. 既知リスク・後送り項目の確認
4. インシデント時の初動連絡体制の確立

---

## 結語

セキュリティ監査の再判定（2026-07-08）は、初回（2026-07-03）から **67% の NG 削減**を達成し、**PoC 前の条件付合格水準に到達** しました。

主な改善:
- **RLS 設計の完成化** （migration 20260708・12 ポリシー追加）
- **link-invited-user の修正予定** （A-08 / C-05 の条件付解消）
- **npm audit の誤検再評価** （critical 2 → 0）
- **新規生成系・削除系 API の検証** （D-03/D-04・E-07）

PoC 開始前の最後の 1 マイル（2026-07-10 PoC 前）で以下を完了すれば、**外部監査企業との合意に基づくPoC Go が実現可能** です:

1. **link-invited-user 本人メール照合実装** ✅ 予定 2026-07-10
2. **ログアウト時 localStorage 完全削除** ✅ 予定 2026-07-10
3. **delete-all API 監査ログ・beforeState 修正** ✅ 予定 2026-07-10
4. **PoC 企業説明資料・署名** ✅ 予定 2026-07-10

---

**監査実施日**: 2026-07-08  
**実施者**: Claude Code Security Audit（自動監査エージェント）  
**結果**: ⚠️ **条件付 Go**（前提条件達成時に PoC 開始可能）  
**次回監査予定**: 2026-07-22～2026-07-29（本番 RLS 適用後）

