# 10. 外部企業 PoC 前 セキュリティ修正計画書

> 対象: `growth-mvp` v0.2.0 ｜ 基準日: 2026-06-25  
> セキュリティレビュー（[08-security-review.md](./08-security-review.md)）に基づく、PoC ブロッカー解消・修正優先度付きロードマップ。  
> **状態**: 計画段階（実装前・確認用）

---

## 概要

本書は [08-security-review.md](./08-security-review.md) の指摘（F-1 ～ F-11）を踏まえ、**外部企業 PoC 出発前に必須・推奨で対応すべき 17 項目**を、優先度・工数・リスク・確認方法とともに整理する。

**PoC Go/No-Go の最小条件**:
- ✅ フェーズ A（A-1 ～ A-7）全項目完了（🔴 Critical / 🟠 High ブロッカー）
- ✅ **D-2 テナント越境テスト green**（「他社データに触れない」実証必須）
- ✅ IPA「安全なウェブサイトの作り方」11 分類で 🔴 ゼロ

---

## 1. 優先度別タスク一覧

### 🔴 フェーズ A: ブロッカー解消（必須・PoC 出発点）

#### A-1. OpenAI API キーのクライアント露出 [F-1: Critical]

| 項目 | 内容 |
|------|------|
| **指摘内容** | `utils/ai.ts` が `NEXT_PUBLIC_OPENAI_API_KEY` で OpenAI クライアント生成、`dangerouslyAllowBrowser: true` に設定。環境変数名の `NEXT_PUBLIC_` 接頭辞によりブラウザバンドルに埋め込まれ、API キーが第三者に窃取される可能性 |
| **リスク** | 🔴 **Critical** ｜ OpenAI キーの無制限利用・課金・キー悪用、モデル回帰 |
| **対象** | `utils/ai.ts:1-6`, Vercel 環境変数（`NEXT_PUBLIC_OPENAI_API_KEY`） |
| **修正方針** | 1. `utils/ai.ts` を削除；2. Vercel から `NEXT_PUBLIC_OPENAI_API_KEY` を完全削除（`OPENAI_API_KEY` サーバ専用のみ）；3. CI ゲート追加：`NEXT_PUBLIC_*` に `KEY`/`SECRET`/`TOKEN` 禁止 |
| **確認方法** | `grep -r "NEXT_PUBLIC_OPENAI\|dangerouslyAllowBrowser" app lib utils` で 0 件確認 |

---

#### A-2. 無認証で OpenAI を呼べる API 8 本 [F-2: High]

| 項目 | 内容 |
|------|------|
| **指摘内容** | 以下 8 本のエンドポイントが Bearer 認証・membership 検証を持たず、匿名ユーザーが OpenAI 生成を実行可能：`/api/generate-question`, `/api/generate-insight`, `/api/generate-department-summary`, `/api/okr-from-exec`, `/api/recommend-top-patterns`, `/api/recommend-exec-patterns`, `/api/stage5/assist-execution`, `/api/knowledge` |
| **リスク** | 🟠 **High** ｜ 匿名ユーザーが OpenAI クォータを焼き切る、任意プロンプト生成、コスト DoS、`/api/knowledge` の無認証読み書き |
| **対象** | `app/api/generate-**/route.ts`, `app/api/okr-from-exec/route.ts`, `app/api/knowledge/route.ts` (計 8 本) |
| **修正方針** | 全 8 本に `lib/server/rbacGuard.ts` の `getAuthUserIdFromBearer()` + `requireMembership()` を適用。最低でも「ログイン済み・会社所属」を要求；`agent:use` capability も付与してロール制御 |
| **確認方法** | 各ルートで Bearer トークン未設定→401 確認、membership なし→403 確認、member ロール→200 確認 |

---

#### A-3. 全 API の認可被覆を CI 化 [F-5: Medium]

| 項目 | 内容 |
|------|------|
| **指摘内容** | 書き込み API の認可ロジックが `lib/server/rbacGuard.ts` と各ルート個別実装で二重化。`members/role/route.ts` など一部ルートが `rbacGuard` を使わず独自実装。認可被覆ツールが無く、新規 API で ガード漏れが起きやすい |
| **リスク** | 🟡 **Medium** ｜ 認可判定の修正漏れ・差異、権限昇格、将来の退行 |
| **対象** | `app/api/**/route.ts`（全書き込みルート）｜ 現状 42/59 が `rbacGuard` 保護、17 本が未被覆またはインライン実装 |
| **修正方針** | 1. すべての書き込み API を `rbacGuard` に統一；2. `scripts/rbac-*.sh` を拡張し、「ガード無し書き込みルート＝ビルド失敗」の自動チェック CI を実装 |
| **確認方法** | `grep -l "export.*POST\|PUT\|DELETE" app/api/**/route.ts | while read f; do grep -q "rbacGuard\|getAuthUserIdFromBearer" "$f" || echo "FAIL: $f"; done` で 0 件 |

---

#### A-4. レート制限の導入 [F-3: High]

| 項目 | 内容 |
|------|------|
| **指摘内容** | `app/api/**` のどのルートにもレート制限がない。OpenAI 生成系で DoS、招待受諾トークン総当たり、大量メンバー作成が可能 |
| **リスク** | 🟠 **High** ｜ OpenAI コスト DoS、認証系ブルートフォース、リソース枯渇 |
| **対象** | `app/api/**` (全ルート)、特に：生成系 11 本・認証系（`invites/accept`, `auth/link-invited-user`）・プロビジョニング (`companies/provision`, `/members`) |
| **修正方針** | 1. **Vercel WAF または `@upstash/ratelimit` + Redis** で IP/ユーザー単位の制限（例：15 req/min per user）；2. **生成系に日次上限**（例：100 req/day per user）；3. 設定値を環境変数化 |
| **確認方法** | curl で短時間に N 回リクエスト → 429 Too Many Requests 確認、生成系を日 100+ 実行 → 403 Quota Exceeded 確認 |

---

#### A-5. 全テーブルの RLS 確認・整備 [F-8: Critical ★最重要]

| 項目 | 内容 |
|------|------|
| **指摘内容** | 本アプリはブラウザ(anon キー)から **ほぼ全テーブルに直接アクセス** (`company_members` 41 回、`progress_logs` 9 回、`company_invites` 9 回、`strategy_data` 7 回、`okrs` 7 回、`profiles` 7 回、`org_alignment_*` 14 回、`companies` 1 回)。テナント分離の **唯一の防壁は RLS** だが、コアテーブル (`companies`/`company_members`/`strategy_data`/`okrs`/`progress_logs`/`profiles`) の RLS 定義が **リポジトリ外で未確認**。RLS 欠落/不備なら、ログイン済みユーザーが他社の戦略・財務・進捗・メンバー・招待を閲覧/改ざん/削除可能 |
| **リスク** | 🔴 **Critical** ｜ テナント越境・データ漏えい・改ざん・削除、RBAC 書込権限の破れ（member が管理者でなくても戦略編集可能） |
| **対象** | Supabase テーブル：`companies`, `company_members`, `company_invites`, `strategy_data`, `okrs`, `progress_logs`, `profiles`, `org_alignment_*` |
| **修正方針** | 1. **Supabase 管理画面で全テーブルの RLS 有効状態確認**（`select relrowsecurity from pg_class where relname = 'テーブル名'` を各テーブルで実行）；2. **全テーブルで「`company_id = auth.uid() の会社」RLS ポリシー有無確認**；3. **書込系（insert/update/delete）で「ロール条件」も確認**（例：`strategy_data` の編集は `(role = 'admin' OR role = 'manager')` ）；4. **欠落/不備なら新規 migration を作成し、RLS ポリシーをリポジトリ化** |
| **確認方法** | **実テスト（必須）**：会社 A のユーザーで会社 B のデータに対し `SELECT/UPDATE/DELETE` → 全件拒否（0 件）確認；member が自社 `strategy_data` を UPDATE → 拒否確認 |

---

#### A-6. 依存パッケージの既知脆弱性解消 [F-10: High]

| 項目 | 内容 |
|------|------|
| **指摘内容** | `npm audit`（2026-06-24）で **51 件**（critical 2 / high 30 / moderate 15 / low 4）。`next` 本体 high、`xlsx`（修正版なし）高危険度 |
| **リスク** | 🟠 **High** ｜ 既知脆弱性の実装・RCE・DoS・データ漏えい |
| **対象** | `package.json`, `package-lock.json` |
| **修正方針** | 1. `npm audit fix`（非破壊）を実行 → 15 件が解消可；2. `next` を最新安全版へ更新；3. `xlsx`（修正版なし）は「信頼できない外部ファイルをパースしない」運用とするか、メンテされた代替（例：`exceljs`）への置換を検討 |
| **確認方法** | `npm audit` で high/critical が 0 に削減 |

---

#### A-7. 改ざん耐性のある監査ログ新設 [F-9: High]

| 項目 | 内容 |
|------|------|
| **指摘内容** | `saveWithAudit` は console.log のみで DB 記録なし；`agent_logs` はクライアント書込・機密全文保存。権限変更・削除・招待の **永続監査ログが実質不在**。「誰が・いつ・何を変更/削除したか」を事後追跡できない |
| **リスク** | 🟠 **High** ｜ 不正検知不能・事後追跡不能・インシデント対応・説明責任が成立しない |
| **対象** | DB 層（新テーブル `audit_logs` を作成）、API：`/api/members/role`, `/api/members` (DELETE), `/api/invites/*`, `/api/admin/*` |
| **修正方針** | 1. **新テーブル `audit_logs` 作成**（append-only、`actor_user_id` / `company_id` / `action` / `target` / `before` / `after` / `ip` / `ua` / `created_at`）；2. **記録対象**：認証（ログイン/失敗）、ロール変更、招待発行・受諾、メンバー追加/削除、戦略/部門削除、データエクスポート、管理操作；3. **サーバ側からのみ書込**（Service Role で、RLS は禁止・admin のみ読取）；4. migration ファイル化 |
| **確認方法** | ロール変更実施 → `audit_logs` に record 記録確認、admin 以外のユーザーで SELECT → 拒否確認 |

---

### 🟠 フェーズ B: ビルド健全化・多層防御（PoC 前に強く推奨）

#### B-1. ビルド設定・CI ゲート化 [F-4: Medium]

| 項目 | 内容 |
|------|------|
| **指摘内容** | `next.config.js` が `ignoreBuildErrors: true`, `ignoreDuringBuilds: true` で型/Lint エラーを握りつぶしており、未検出の脆弱性が本番化するリスク |
| **リスク** | 🟡 **Medium** ｜ 型エラー・未初期化・セキュリティバグが本番に混入 |
| **対象** | `next.config.js:75-77`, CI 設定（`.github/workflows` 新設） |
| **修正方針** | 1. `ignoreBuildErrors` / `ignoreDuringBuilds` を **false** に戻す；2. CI パイプライン構築：`tsc --noEmit` → `next lint` → smoke テスト；3. 型チェック通す |
| **確認方法** | `next build` が型エラーで失敗 → 修正 → 成功確認 |

---

#### B-2. セキュリティヘッダ追加 [F-4: Medium]

| 項目 | 内容 |
|------|------|
| **指摘内容** | セキュリティ HTTP ヘッダが未設定（CSP / HSTS / X-Frame-Options ほか）。クリックジャッキング・XSS・MIME スニッフィング対策なし |
| **リスク** | 🟡 **Medium** ｜ XSS 実行、クリックジャッキング |
| **対象** | `next.config.js`（`async headers()` 追加） |
| **修正方針** | `next.config.js` の `headers()` で以下を追加：`Strict-Transport-Security: max-age=63072000; includeSubDomains; preload`, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Content-Security-Policy: (Next/Supabase/OpenAI ドメインのみ許可)`, `Permissions-Policy` (不要な API 無効化) |
| **確認方法** | `curl -i https://<domain>` でヘッダ確認 |

---

#### B-3. Cookie 設定口の認証必須化・許可リスト化 [F-6: Medium]

| 項目 | 内容 |
|------|------|
| **指摘内容** | `app/api/_session/set-cookie`, `set-company` が **認証チェック 0** で、任意の名前/値の Cookie を匿名で設定可能 |
| **リスク** | 🟡 **Medium** ｜ セッション固定、CSRF の足場 |
| **対象** | `app/api/_session/set-cookie/route.ts`, `app/api/_session/set-company/route.ts` |
| **修正方針** | 1. **ログイン済みユーザー限定**（Bearer + `requireMembership()` 追加）；2. **設定可能な Cookie 名を許可リスト化**（`[COMPANY_ID_COOKIE, ...]` のみ許可、任意名禁止）；3. 会社切替は専用 API で会社所属検証付き |
| **確認方法** | 認証なし → 401 確認、メンバー → 200 + Cookie 設定確認、許可リスト外の名前 → 400 確認 |

---

#### B-4. ログレベル制御・機微マスキング [F-7: Medium]

| 項目 | 内容 |
|------|------|
| **指摘内容** | 本番でも大量の `console.log`（`strategyStore.ts` 158、`app/api/**` 437、`execution/page.tsx` 69）で戦略データ・部門・財務などの事業機密がブラウザログ/サーバログに流出 |
| **リスク** | 🟡 **Medium** ｜ 事業機密・PII 流出、監視人員によるデータ盗聴 |
| **対象** | `store/strategyStore.ts`, `app/api/**`, `app/execution/**` |
| **修正方針** | 1. ロガー層を導入（例：カスタムロガー or Winston）；2. 本番で無条件 `console.log` を抑止（`level: 'warn'` 以上のみ）；3. デバッグログは全て env フラグ配下へ；4. 機微フィールド（`strategy_data`, 財務値）はマスキング関数を通す |
| **確認方法** | `NODE_ENV=production` で実行 → 機微データが console に出ない確認 |

---

### 🟡 フェーズ C: テナント運用・データ保護

#### C-1. PoC クライアント専用テナント分離

| 項目 | 内容 |
|------|------|
| **指摘内容** | PoC 中に他テナント・本運用データとの混在を防ぐ |
| **リスク** | 🟡 **Medium** ｜ PoC データが本運用データに混入、本運用データが PoC に露出 |
| **対象** | Supabase 環境（PoC 用 DB） |
| **修正方針** | PoC クライアント専用の **会社（テナント）を分離**して払い出し、アカウント・データの独立性を確保 |
| **確認方法** | 本運用テナント ≠ PoC テナント の company_id で分離確認 |

---

#### C-2. 招待フロー E2E 確認

| 項目 | 内容 |
|------|------|
| **指摘内容** | 招待機構（有効期限・単一招待・受諾後失効）の実装確認 |
| **リスク** | 🟡 **Medium** ｜ 招待の再利用、期限なし招待が残存 |
| **対象** | `app/api/invites/**`, `company_invites` テーブル |
| **修正方針** | 招待発行 → トークン送付 → 受諾 → 失効をエンドツーエンドで実機確認；期限切れ招待の再利用 → 拒否確認 |
| **確認方法** | 招待フローを手作業で一周、期限切れ後に同トークンで受諾 → 403 確認 |

---

#### C-3. バックアップ・削除・エクスポート手順

| 項目 | 内容 |
|------|------|
| **指摘内容** | PoC データの投入・エクスポート・削除（退会）手順が未整備 |
| **リスク** | 🟡 **Medium** ｜ データ消失、復旧不能、規約違反 |
| **対象** | Supabase バックアップ機能、API（`/api/cascade/cleanup-deleted-projects` など） |
| **修正方針** | 1. Supabase **日次自動バックアップ確認** + **リストア手順書**（目安 RPO 24h / RTO 4h）；2. **データエクスポート手順**（CSV/JSON） + 検証；3. **退会時データ削除手順**（cascade 削除・取消手順も含む） |
| **確認方法** | バックアップ復旧テスト実施、削除実行 → DB 確認で削除完了 |

---

### 🔍 フェーズ D: テスト・検証

#### D-1. 認可被覆 E2E テスト

| 項目 | 内容 |
|------|------|
| **指摘内容** | フェーズ A 対応後、全書き込みルートで認可を実機テスト |
| **リスク** | 🟡 **Medium** ｜ テスト漏れによる認可バイパス |
| **対象** | `scripts/rbac-e2e-min.sh` (拡張), 主要 API |
| **修正方針** | 各ロール（member/manager/admin）で、権限外操作を 403/拒否確認；テスト スクリプト CI 化 |
| **確認方法** | `./scripts/rbac-e2e-min.sh` が green |

---

#### D-2. テナント越境防止テスト (RLS) ★必須

| 項目 | 内容 |
|------|------|
| **指摘内容** | A-5 の確認方法。会社 A → 会社 B データへのアクセス拒否を実証 |
| **リスク** | 🔴 **Critical** ｜ テナント越境 = PoC NG |
| **対象** | 全テーブル（`company_members`, `strategy_data`, `okrs`, `progress_logs`, `profiles`, `company_invites`, `org_alignment_*`) |
| **修正方法** | 会社 A/B を用意、A ユーザー で B データに対し SELECT/UPDATE/DELETE → 全件 0 件拒否；ロール別書込権限テスト（member が strategy_data update → 拒否） |
| **確認方法** | 実テストスクリプト（`scripts/test-rls-cross-tenant.sh`（新規））で 100% green |

---

#### D-3. レート制限テスト

| 項目 | 内容 |
|------|------|
| **指摘内容** | A-4 対応後、レート制限が動作確認 |
| **リスク** | 🟡 **Medium** ｜ DoS 防止失敗 |
| **対象** | 生成系 API、認証系、プロビジョニング |
| **修正方法** | curl/k6 等で短時間に N 回リクエスト → 429 確認；日次上限超過 → 403/配額用語確認 |
| **確認方法** | `curl -X POST https://<api>/generate-question -H "Authorization: Bearer <token>" × 20` → 429 確認 |

---

## 2. サマリ表（19 項目 × 6 軸）

| # | ID | 項目 | 重大度 | フェーズ | 対応 | 確認方法 | 工数 |
|---|---|---|---|---|---|---|---|
| 1 | A-5 | RLS 確認・整備 | 🔴 Critical | A | Supabase: RLS ポリシー確認 + migration 化 | 会社 A→B 越境テスト 拒否確認 | 3d |
| 2 | A-1 | OpenAI キー削除 | 🔴 Critical | A | `utils/ai.ts` 削除 + `NEXT_PUBLIC_OPENAI_API_KEY` 除去 | grep で 0 件確認 | 0.5d |
| 3 | A-2 | 無認証 API 認証化 | 🟠 High | A | 8 本に `rbacGuard` 追加 | Bearer なし→401, member→200 確認 | 2d |
| 4 | A-3 | 認可被覆 CI 化 | 🟠 High | A | CI ゲート化（ガード無し書き込み＝ビルド失敗） | `scripts/rbac-*.sh` green | 1.5d |
| 5 | A-4 | レート制限導入 | 🟠 High | A | Vercel WAF or `@upstash/ratelimit` | 429 確認, 日次上限テスト | 2d |
| 6 | A-6 | 依存脆弱性解消 | 🟠 High | A | `npm audit fix` + `next` 更新 | `npm audit` で high/critical = 0 | 1d |
| 7 | A-7 | 監査ログ新設 | 🟠 High | A | `audit_logs` テーブル + API 組込 | ロール変更 → `audit_logs` record 確認 | 2.5d |
| 8 | B-1 | ビルド・CI ゲート化 | 🟡 Medium | B | `ignore*` 解除 + CI 構築 | `next build` green | 1.5d |
| 9 | B-2 | セキュリティヘッダ追加 | 🟡 Medium | B | `next.config.js` に CSP/HSTS/X-Frame-Options | `curl -i` でヘッダ確認 | 1d |
| 10 | B-3 | Cookie 認証必須化 | 🟡 Medium | B | `set-cookie` に Bearer + 許可リスト | 認証なし→401, member→200 確認 | 1d |
| 11 | B-4 | ログレベル制御 | 🟡 Medium | B | ロガー層 + env フラグ配下 | 本番で機微データ非表示確認 | 1.5d |
| 12 | C-1 | PoC テナント分離 | 🟡 Medium | C | 専用会社作成・分離 | company_id 確認 | 0.5d |
| 13 | C-2 | 招待 E2E 確認 | 🟡 Medium | C | 招待フロー一周 + 期限切れテスト | 期限切れ→403 確認 | 0.5d |
| 14 | C-3 | バックアップ・削除手順 | 🟡 Medium | C | 日次 BK + リストア + 削除手順 | リストア成功、削除確認 | 1.5d |
| 15 | D-1 | 認可 E2E テスト | 🟡 Medium | D | 全ロール権限外操作テスト | `rbac-e2e-min.sh` green | 1d |
| 16 | D-2 | テナント越境テスト | 🔴 Critical | D | 会社 A→B アクセス拒否実証 | 全テーブル 0 件拒否確認 | 1d |
| 17 | D-3 | レート制限テスト | 🟡 Medium | D | 429/日次上限実機確認 | curl 試験 429 確認 | 1d |
| **計** |  |  |  |  |  |  | **30d 想定** |

---

## 3. PoC Go/No-Go チェックリスト

| # | チェック項目 | ステータス | 根拠 |
|---|---|---|---|
| 1 | ✅ フェーズ A（A-1 ～ A-7）全完了 | **必須** | 🔴 Critical/🟠 High ブロッカー解消が PoC 出発点 |
| 2 | ✅ **D-2 テナント越境テスト green** | **必須** | 「他社データに触れない」実証なし = PoC NG |
| 3 | ✅ IPA「安全なウェブサイト」11 分類で 🔴 ゼロ | **必須** | 国内クライアント対応 |
| 4 | ✅ フェーズ B-1, B-2, B-3 完了 | 強く推奨 | ビルド健全化・多層防御 |
| 5 | ✅ フェーズ C-1, C-2, C-3 完了 | 強く推奨 | テナント分離・データ保全 |
| 6 | 🔄 フェーズ D-1, D-3 実施 | 推奨 | E2E 検証・サンプルシナリオでの動作確認 |

---

## 4. リスク評価・対応マッピング

### 🔴 Critical（テナント越境・認証情報漏えい）
- **F-8（RLS）** → 実テストで「会社 A→B 拒否」100% 確認が条件
- **F-1（API キー）** → 本番環境の設定確認（Vercel）

### 🟠 High（DoS・無認証）
- **F-2（無認証 API）** → 8 本全て Bearer + membership 付与テスト
- **F-3（レート制限）** → IP/ユーザー単位の 429 レスポンス確認
- **F-9（監査ログ）** → 権限変更・削除を記録・admin 限定読取確認
- **F-10（脆弱性）** → `npm audit` high/critical = 0

### 🟡 Medium（堅牢性・運用）
- **F-4（ビルド・ヘッダ）** → CI green + ヘッダ配信確認
- **F-5（認可二重化）** → `rbacGuard` 統一 + CI 被覆チェック
- **F-6（Cookie）** → 認証必須 + 許可リスト化
- **F-7（ログ）** → 本番でデバッグログ非表示確認

---

## 5. 実装スケジュール案

| フェーズ | 期間 | 並行可能 | 備考 |
|---|---|---|---|
| **A-1,2,3,4** | Week 1-2 (4d) | 並行可 | 認証/認可・レート制限の基本工事 |
| **A-5** | Week 2-3 (3d+テスト) | A-1~4 後 | RLS が最重要・実テスト必須で時間かかり |
| **A-6,7** | Week 1-2 (3.5d) | 並行可 | 脆弱性・監査ログ |
| **B-1,2,3,4** | Week 3 (4d) | A 完了後 | ビルド・ヘッダ・Cookie・ログ |
| **C-1,2,3** | Week 3 (2.5d) | A 完了後 | テナント確認・招待・バックアップ |
| **D-1,2,3** | Week 4 (3d) | B/C 完了後 | E2E テスト・PoC Go/No-Go判定 |
| **PoC Go/No-Go** | Week 4 末 | — | A/D-2 + B-1,2,3 + C-1,4,5 完了で出発 |

---

## 6. 重点確認項目（ユーザー指定）マッピング

| 指摘 | 対応項目 | 根拠 |
|---|---|---|
| OpenAI APIキーがクライアントに露出していないか | **A-1** | F-1: Critical |
| 無認証で呼べるAI/APIエンドポイントがないか | **A-2** | F-2: High ／ 8 本の無認証生成系 API |
| APIごとに認証・会社スコープ・ロールチェックがあるか | **A-3, A-2** | F-5: Medium ／ F-2: High ／ 全 API の rbacGuard 統一 |
| strategy_data / okrs / progress_logs / org_alignment系テーブルのRLS前提と矛盾がないか | **A-5 (D-2)** | F-8: Critical ★最重要 |
| レート制限が必要なAPI一覧 | **A-4** | F-3: High ／ 生成系 11 本・認証系・プロビジョニング |
| 監査ログが必要な操作一覧 | **A-7** | F-9: High ／ ロール変更・招待・メンバー削除・戦略削除 |

---

## 7. 参考リンク・関連ドキュメント

- [08-security-review.md](./08-security-review.md) — 詳細指摘（F-1 ～ F-11）、IPA 対応、参考資料
- [09-non-functional-requirements.md](./09-non-functional-requirements.md) — 可用性・性能・運用要件
- [03-auth-rbac.md](./03-auth-rbac.md) — 認証・RBAC・API ガード詳細
- [07-api-reference.md](./07-api-reference.md) — API 59 本の認証要否分類

---

## 8. 次ステップ

1. ✅ **本修正計画書のレビュー・合意**（優先度・工数・スケジュール）
2. ⏳ **フェーズ A（A-1 ～ A-7）の実装着手** → 並行して D-2（RLS テスト環境構築）準備
3. 🔍 **A 完了後に B/C 並行実施**（ビルド・テナント確認）
4. ✓ **D-2（テナント越境テスト）green 確認で Go/No-Go 判定**
5. 🚀 **PoC 出発**（フェーズ A + D-2 + B-1,2,3 + C 最小セット完了時点）

---

**作成日**: 2026-06-25  
**対象**: growth-mvp v0.2.0  
**状態**: 計画段階（実装前）  
**確認**: ユーザー確認待ち
