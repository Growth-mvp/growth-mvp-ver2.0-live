# 08. セキュリティレビュー（実装ベース）

> 対象: `growth-mvp` v0.2.0 / ブランチ `main` ／ レビュー日: 2026-06-22
> 手法: ソースコード静的レビュー（認可ガードの適用範囲・Service Role 鍵の扱い・秘密情報・Cookie/ヘッダ・入力検証・監査ログ）。
> 評価基準: OWASP 的観点に加え、**IPA「安全なウェブサイトの作り方」改訂第 7 版**の脆弱性分類との対応を §11 に整理。
> 動的テスト（実際の HTTP リクエスト・ペネトレーション）は未実施。本書の指摘は **コードからの根拠（`file:line`）** を伴う。

## 0. 重大度の凡例

| 記号 | 意味 | 対応方針 |
|---|---|---|
| 🔴 **Critical** | 認証情報の漏えい・テナント越境・権限昇格に直結 | **PoC 前に必須修正** |
| 🟠 **High** | 悪用でコスト/可用性/データに実害 | PoC 前に必須修正 |
| 🟡 **Medium** | 条件付きで問題化、または堅牢性・運用上の欠陥 | PoC 前に推奨 |
| 🟢 **Good** | 適切に実装されている（記録目的） | 維持 |

---

## 1. サマリ（発見一覧）

| # | 重大度 | 概要 | 根拠 |
|---|---|---|---|
| F-1 | 🔴 Critical | OpenAI API キーがクライアント露出しうる構成（`NEXT_PUBLIC_OPENAI_API_KEY` + `dangerouslyAllowBrowser`） | `utils/ai.ts:4-5` |
| F-2 | 🟠 High | OpenAI を呼ぶ **無認証 API が 8 本**（匿名でコスト消費・DoS・任意生成が可能） | 下記 §3 |
| F-3 | 🟠 High | API に **レート制限が一切ない**（招待受諾・生成系の総当たり/濫用） | 全 `app/api/**` |
| F-4 | 🟡 Medium | `next.config.js` が **型/Lint エラーを無視してビルド**、かつ **セキュリティヘッダ未設定** | `next.config.js` |
| F-5 | 🟡 Medium | 認可ロジックが中央ガード（`rbacGuard`）と各ルート個別実装で**二重化**（適用漏れリスク） | `app/api/members/*` |
| F-6 | 🟡 Medium | **無認証の Cookie 設定エンドポイント**（会社選択 Cookie 等を任意設定可能） | `app/api/_session/set-cookie/route.ts` |
| F-7 | 🟡 Medium | 本番でも詳細 `console.log` が多く、機微データがログに出うる | `store/strategyStore.ts` ほか |
| F-8 | 🔴 Critical | **データ保護の核心**。ブラウザ（anon キー）から **ほぼ全テーブルに直接アクセス**（`company_members`・`company_invites`・`strategy_data`・`okrs`・`progress_logs`・`profiles`・`companies`・org_alignment 系）。テナント分離は **RLS のみが防壁**だが、コアテーブルの RLS 定義が repo 外で**未確認**。RLS 不備なら他社の全データを閲覧/改ざん/削除しうる | `app/**`（client `.from()`）, `supabase/migrations/` 欠落 |
| F-9 | 🟠 High | **監査ログが実質不在**。`saveWithAudit` は console 出力のみ／`agent_logs` はクライアント書込・機密全文保存／**権限変更・削除・招待の永続監査なし** | `utils/persist/saveWithAudit.ts`, `lib/supabase/agentLogs.ts` |
| F-10 | 🟠 High | **依存パッケージに既知脆弱性 51 件**（critical 2 / high 30 / moderate 15 / low 4）。`next` 本体の high 含む。15 件は `npm audit fix` で解消可、`xlsx` は修正版なし | `npm audit`（2026-06-24） |
| F-11 | 🟡 Medium | **AI/LLM 固有対策が未整理**（prompt injection・出力検証・モデル回帰）。テナント越境は主要経路で防御済（G-6）だが、**AI コンテキストがロール/部門非スコープ**・**AI 出力の書込が RLS 依存**（F-8 連動） | `app/api/ask-ceo-agent`・`generate-*` |
| G-1 | 🟢 Good | 招待トークンはハッシュ保存・256bit 乱数・有効期限・単一アクティブ制約 | `invites/create`, `company_invites` |
| G-2 | 🟢 Good | Cookie 既定が `httpOnly` / 本番 `secure` / `sameSite=lax` | `_session/set-cookie:37-39` |
| G-3 | 🟢 Good | 最後の admin の降格を防止 | `members/role/route.ts:62` |
| G-4 | 🟢 Good | `.env*` は gitignore 済み、秘密情報のコミットなし | `.gitignore` |
| G-5 | 🟢 Good | 会社/部門スコープ強制・Bearer 検証の中央ガードが存在 | `lib/server/rbacGuard.ts` |
| G-6 | 🟢 Good | **AI のテナント分離（主要経路）**: `ask-ceo-agent` が `assertCompanyScopeByStrategyId` で要求 strategyId を会社検証。認証付き `generate-*` も membership 基準 | `app/api/ask-ceo-agent/route.ts:299` |
| G-7 | 🟢 Good | **集計 AI の匿名保護**: `insights/generate` は admin 必須＋会社スコープ＋AI へ投稿者識別子を渡さない | `org-alignment/admin/insights/generate` |

---

## 2. 🔴 F-1: OpenAI API キーのクライアント露出リスク

### 内容
`utils/ai.ts` が **`NEXT_PUBLIC_OPENAI_API_KEY`** で OpenAI クライアントを生成し、`dangerouslyAllowBrowser: true` を指定している。

```ts
// utils/ai.ts:3-6
const openai = new OpenAI({
  apiKey: process.env.NEXT_PUBLIC_OPENAI_API_KEY,
  dangerouslyAllowBrowser: true,
})
```

- `NEXT_PUBLIC_` 接頭辞の環境変数は **クライアントバンドルに埋め込まれ、ブラウザから誰でも抽出可能**。
- 当該キーが本番環境に設定されていれば、**OpenAI キーが第三者に窃取され、無制限に課金される**（金銭被害・キー濫用）。

### 現状の緩和と残存リスク
- 現時点で `utils/ai.ts` は **どこからも import されていない（デッドコード）** ため、未参照ならバンドルには含まれない。
- ただし **環境変数名が `NEXT_PUBLIC_` で用意されている時点で潜在的に危険**で、誰かが本ファイルを 1 行 import した瞬間に漏えいする。サーバ側は `lib/openai.ts`（`OPENAI_API_KEY`、非 public）が正で、本ファイルは重複・不要。

### 改善
1. **`utils/ai.ts` を削除**する。
2. デプロイ環境（Vercel）から **`NEXT_PUBLIC_OPENAI_API_KEY` を削除**し、`OPENAI_API_KEY`（サーバ専用）のみにする。
3. OpenAI 呼び出しは **必ずサーバ（API ルート）経由**に統一（既に大半はそうなっている）。
4. CI に「`NEXT_PUBLIC_*` に `KEY`/`SECRET`/`TOKEN` を含む変数を禁止」する lint/grep ゲートを追加。

---

## 3. 🟠 F-2: 無認証で OpenAI を呼べる API

### 内容
以下 8 本は **Bearer 認証・membership 検証を一切持たず**、本文を受け取って OpenAI 生成を実行する（`auth-checks=0`）。

| ルート | リスク |
|---|---|
| `/api/generate-question` | 匿名で 12 問生成を実行 → コスト消費 |
| `/api/generate-insight` | 同上 |
| `/api/generate-department-summary` | 同上 |
| `/api/okr-from-exec` | 同上 |
| `/api/recommend-top-patterns` | 同上 |
| `/api/recommend-exec-patterns` | 同上 |
| `/api/stage5/assist-execution` | 同上 |
| `/api/knowledge` | ナレッジ取得/登録が匿名で可能 |
| （参考）`/api/market/pbr` | 外部 API 中継が匿名で可能（コスト/レート） |

> 上記は本文に `companyId`/`strategyId` を取らないため**他社データの直接漏えい（IDOR）は無い**が、**匿名ユーザーが OpenAI クォータを焼き切る／任意プロンプトで生成させる**ことができる。公開エンドポイントとしてインターネットに晒される PoC では実害が大きい。

### 改善
- 8 本すべてに `lib/server/rbacGuard.ts` の `getAuthUserIdFromBearer()` + `requireMembership()` を適用し、最低でも「ログイン済み・会社所属」を要求する。
- `agent:use` 等の capability で role 制御も付与（[03-auth-rbac.md](./03-auth-rbac.md)）。
- 設計原則として「**Service Role を使う API は RLS をバイパスするため、ガードの適用漏れ＝全テナント露出**」であることを徹底する。

---

## 4. 🟠 F-3: レート制限の不在

### 内容
`app/api/**` のどのルートにもレート制限・スロットリングが見当たらない。

- OpenAI 生成系 → コスト DoS。
- `/api/invites/accept`・`/api/auth/link-invited-user` → トークン総当たり（トークン自体は 256bit ハッシュで現実的でないが、防御層は持つべき）。
- `/api/companies/provision`・`/api/members` → 大量アカウント/メンバー作成。

### 改善
- エッジ（Vercel）またはミドルウェアで **IP / ユーザー単位のレート制限**を導入（例: `@upstash/ratelimit` + Redis、または Vercel WAF）。
- 生成系は **ユーザー単位の日次上限**も設定（コスト保護）。

---

## 5. 🟡 F-4: ビルド設定とセキュリティヘッダ

### 内容
```js
// next.config.js
eslint: { ignoreDuringBuilds: true },     // Lint エラーを無視してビルド
typescript: { ignoreBuildErrors: true },  // 型エラーを無視してビルド
```
- 型/Lint エラーを握りつぶしてデプロイされる → **未検出の不具合・セキュリティ的に危ういコードがそのまま本番化**しうる。
- さらに **セキュリティ HTTP ヘッダが未設定**（CSP / HSTS / X-Frame-Options / X-Content-Type-Options / Referrer-Policy / Permissions-Policy）。クリックジャッキング・XSS 緩和・MIME スニッフィング対策が無い。

### 改善
1. PoC 前に型/Lint エラーを解消し、`ignoreBuildErrors` / `ignoreDuringBuilds` を **false** に戻す（最低でも CI では型チェックを通す）。
2. `next.config.js` の `async headers()` で以下を付与:
   - `Strict-Transport-Security: max-age=63072000; includeSubDomains; preload`
   - `X-Frame-Options: DENY`（または CSP `frame-ancestors 'none'`）
   - `X-Content-Type-Options: nosniff`
   - `Referrer-Policy: strict-origin-when-cross-origin`
   - `Content-Security-Policy`（Next/Supabase/OpenAI ドメインを許可した最小ポリシー）
   - `Permissions-Policy`（不要な API を無効化）

---

## 6. 🟡 F-5: 認可ロジックの二重化

### 内容
- 多くの書き込み API は中央ガード `lib/server/rbacGuard.ts` を使用（良い）。
- 一方 `app/api/members/route.ts` / `members/role/route.ts` は **Bearer 検証・ロール判定を各ルートでインライン実装**している（`admin.auth.getUser` + `company_members` 直引き）。
  - 機能的には正しく admin 強制・同一会社確認・最終 admin 保護まで実装されている（→ G-3）。
  - しかし **判定ロジックが分散**しており、将来の修正漏れ・差異の温床になる。

### 改善
- すべての書き込み API を `rbacGuard`（`requireMembership` + `assertCapability` / `assertMinRole`）に統一する。
- 「ガードを通したか」を一覧化するテスト（`scripts/rbac-*.sh` を拡張）で**全ルートの認可被覆を CI で保証**する。

---

## 7. 🟡 F-6: 無認証の Cookie 設定エンドポイント

### 内容
- `app/api/_session/set-cookie`・`set-company` は **認証チェック 0**（`auth-checks=0`）で Cookie を設定できる。
- Cookie 既定は安全（httpOnly / secure(本番) / sameSite=lax）だが、**任意の名前/値の Cookie を匿名で設定**でき、会社選択 Cookie の改ざんも可能。

### 緩和と残存
- サーバ側 API は `requireMembership` で **会社所属を都度再検証**するため、Cookie 改ざんだけで他社データにアクセスできるわけではない（直接の認可バイパスではない）。
- ただし汎用 Cookie 設定口は **セッション固定/CSRF の足場**になりうる。

### 改善
- `set-cookie` は **ログイン済みユーザーに限定**し、設定可能な Cookie 名を**許可リスト化**（任意名を禁止）。
- 会社切替は専用 API（所属検証込み）に限定する。

---

## 8. 🟡 F-7: 本番ログの機微情報

### 内容
- `store/strategyStore.ts` 等に大量の `console.log`。多くは `NEXT_PUBLIC_DEBUG_*` フラグでガードされているが、無条件出力も残る。
- 戦略データ・部門・財務などの**事業機密**がブラウザコンソール/サーバログに流出しうる。
- 招待系のログはトークン値そのものは出していない（"no bearer token" 等のメッセージのみ）→ 軽微。

### 改善
- 本番で無条件の `console.log` を抑止（ロガー層を導入し、レベル制御 + 機微フィールドのマスキング）。
- デバッグログは全て env フラグ配下へ。

---

## 9. 🔴 F-8: データ保護（テナント分離）が RLS 依存・未確認 ★最重要

### 内容
**本アプリのデータ保護の生命線**。ブラウザ（anon キー）から **ほぼ全テーブルに直接アクセス**している（サーバ API を経由しない）。クライアント `.from()` の対象テーブルと回数（概数）:

| テーブル | 機微度 | 直アクセス回数 |
|---|---|---|
| `company_members`（所属・ロール） | 高 | 41 |
| `progress_logs`（進捗） | 高 | 9 |
| `company_invites`（招待・email/role） | 高 | 9 |
| `strategy_data`（戦略・財務） | 最高 | 7 |
| `profiles`（個人情報） | 高 | 7 |
| `okrs`（OKR） | 高 | 7 |
| `org_alignment_*`（組織課題） | 高 | 計 14 |
| `companies` | 中 | 1 |

- これらは **RLS（Row Level Security）だけがテナント分離の防壁**。だが `companies`/`company_members`/`strategy_data`/`okrs`/`progress_logs`/`profiles` の **定義 SQL（RLS 含む）がリポジトリに無く、ポリシーの有無/正しさを確認できない**（[02-data-model.md](./02-data-model.md) §1）。
- org_alignment・invites 系は migration で RLS 有効化を確認できているが、上記コアテーブルは**未確認**。
- **結論: RLS が 1 つでも欠落/不備なら、ログイン済みユーザーが他社の戦略・財務・進捗・メンバー・招待情報を閲覧/改ざん/削除できる（テナント越境）。「データが保護されている」とは現時点で断言できない。** これが PoC における最重要の確認事項。
- **ロール別の書込制御も RLS 依存**: 戦略の保存（`strategy_data`/`okrs`）は**クライアント直書き**で、`strategy:edit`（member=不可）の capability は **UI 側の判定**にすぎない。サーバ側でこれを強制するのは RLS だけなので、**RLS が会社一致しか見ていない場合、member が戦略を書き換えられる**（権限マトリクスがサーバ側で破れる。AI 生成結果の保存も同様＝F-11 と連動）。

### 改善（PoC の最低ライン）
1. **全テーブルで RLS が有効か、Supabase 管理画面/SQL で確認**（`select relrowsecurity from pg_class ...`）。
2. 全テーブルに `company_id = （auth 経由の所属会社）` を強制する RLS ポリシーを設定し、**マイグレーションとしてリポジトリ化**。**書込系（insert/update/delete）はロール条件**（例: `strategy_data` の編集は admin/manager のみ）も RLS に明記。
3. **実テスト**: 会社 A のユーザーで会社 B のデータに `select`/`update`/`delete` を試し**全拒否**を確認。加えて **member が自社 `strategy_data` を更新できないこと**（ロール書込制御）も確認（PoC 前の必須テスト）。
4. anon キーで到達可能なテーブル/列を棚卸しし、機微データの直アクセスは可能なら API 経由に寄せる。

---

## 9.5 🟠 F-9: 監査ログ（Audit Logging）の欠如

### 内容
「監査」を名乗る仕組みはあるが、**セキュリティ監査証跡として機能していない**。

1. **`saveWithAudit`（`utils/persist/saveWithAudit.ts`）は console.log 出力のみ。**
   - `[audit][save:...]` はすべて `console.log`（DB へ書き込まない）。目的は保存/復元事故の**デバッグ観測**であり、改ざん耐性のある証跡ではない。
   - `docs/_md_dump/AUDIT_LOG_VERIFICATION.md` も「保存事故をログで追えるか」という観点で、セキュリティ監査ではない。
2. **唯一の永続ログ `agent_logs` に問題。**（`lib/supabase/agentLogs.ts`）
   - **クライアント側の anon Supabase クライアントで insert** しており、ユーザーが偽造・省略可能（RLS 頼み）。
   - `content`（AI 会話全文）を保存 → **事業機密・PII が平文で蓄積**。保持期間・マスキング・アクセス制御の定義がない。
3. **セキュリティ的に重要な操作の永続監査が無い。**
   - ロール変更（`members/role`）、招待発行/受諾、メンバー削除（`members`）、データ削除（`cascade/cleanup-deleted-projects`）、管理データ操作（`admin/data-management`）のいずれも **監査レコードを残していない**（コード調査で `insert`（audit 目的）0 件）。
   - 結果として **「誰が・いつ・何を変更/削除/権限付与したか」を事後追跡できない**。インシデント対応・不正調査・説明責任（アカウンタビリティ）が成立しない。

### リスク
- 権限昇格や不正なデータ削除が起きても**検知・追跡が不能**。
- 顧客（外部クライアント）に対して「操作履歴を提示できない」＝ エンタープライズ取引での信頼・コンプライアンス要件を満たせない。

### 改善
- **改ざん耐性のある `audit_logs` テーブル**を新設（append-only、Service Role でサーバ側からのみ書込、`actor_user_id` / `company_id` / `action` / `target` / `before`/`after` / `ip` / `ua` / `created_at`）。
- **記録対象（最小）**: 認証（ログイン/失敗）、ロール変更、招待発行・受諾、メンバー追加/削除、戦略/部門/プロジェクトの削除、データエクスポート、管理操作。
- `agent_logs` は **サーバ側書込に変更**し、機微フィールドの保持方針（保持期間・マスキング・アクセス権）を定義。
- 監査ログ自体への **アクセスを admin に限定**し、改変・削除を不可にする（RLS + append-only）。

---

## 9.6 🟠 F-10: 依存パッケージの既知脆弱性

### 内容
`npm audit`（2026-06-24 実行）で **51 件**（critical 2 / high 30 / moderate 15 / low 4）。主なもの:

- **`next` 本体（high）**: Image Optimization API のキャッシュキー混同。→ Next.js の更新で解消。
- `form-data` / `tar` / `undici` / `ws` / `path-to-regexp` / `minimatch` / `glob`（いずれも high、多くは transitive）。
- **`xlsx`（high・修正版なし）**: Prototype Pollution / ReDoS。Stage1 のインポート/エクスポートで使用。**信頼できないファイルのパースに注意**。
- `yaml`（moderate）他。

修正可否: **15 件は `npm audit fix`（非破壊）で解消可**、9 件は `--force`（破壊的変更あり）、`xlsx` 等は修正版なしで代替/緩和が必要。

### 改善
1. `npm audit fix`（非破壊）をまず適用し、High 以上を可能な範囲で解消。
2. `next` を最新の安全版へ更新。
3. `xlsx` は **信頼できない入力をパースしない**運用にするか、メンテされている代替（例: `exceljs`）への置換を検討。
4. Dependabot / CI で継続監視（[09] 運用保守）。

---

## 9.7 🟡 F-11: AI/LLM 固有のセキュリティ

### 内容
本プロダクトは AI（OpenAI）中心で、ユーザー入力と戦略データをプロンプトに載せて生成する。一般的な Web 脆弱性とは別に、**LLM 固有のリスクへの対策方針が未整理**。

1. **Prompt injection（プロンプト注入）**: ユーザー入力（12 問回答・違和感ケース・進捗テキスト・取込ドキュメント等）に「これまでの指示を無視して〜」等を混入され、AI の挙動を乗っ取られる恐れ。`ask-ceo-agent` や各 `generate-*` は入力をそのままプロンプトへ載せる。
2. **出力検証の不足**: 生成結果（特に JSON 構造化出力）の検証は `safeParseFacilitatorJSON` 等一部のみ。出力をそのまま保存/表示する経路の検証・サニタイズが不十分だと、誤情報や不正データの混入につながる。
3. **モデル変更時の回帰**: `gpt-4o` / `gpt-4o-mini` 等のモデル更新で、安全挙動・出力フォーマットが変わりうるが、**回帰確認の仕組みがない**。

### マルチテナント × RBAC 環境での AI 固有論点（重点）

本システムは「会社（テナント）分離 ＋ ロール（admin/manager/member）」前提なので、AI でも**テナント越境**と**権限越え**を個別に評価した。

- **テナント越境（AI 経由）— 主要経路は良好（確認済）**: `ask-ceo-agent` は `requireMembership` + **`assertCompanyScopeByStrategyId`** で「要求 `strategyId` が呼び出し元の会社か」を検証してからコンテキストを取得（→ G-6）。認証付き `generate-*` も `requireMembership` 基準で、body の `companyId` を信用しない作り。
  - 残課題: **無認証 generate 系 8 本（F-2）はテナント束縛が無い**。`generate-strategy` は body に `companyId?` を受けるため、**membership 由来で固定し body 値は無視**することを徹底。
- **AI コンテキストがロール/部門スコープでない**: `ask-ceo-agent` は**会社全体の戦略・財務・進捗**を取得する。member や（部門限定の）manager でも、UI で制限される会社横断情報を **AI 経由で引き出せる**可能性。意図した挙動か要判断（必要なら AI コンテキストをロール/部門で絞る）。
- **AI 出力の書き戻しに `strategy:edit` がサーバ強制されない**: `generate-*` は**結果を返すだけで DB 書込をしない**（確認済）。保存はクライアント→`strategy_data`（anon）で **RLS 依存**。`agent:use` は全ロール可のため、**RLS がロールを見ていない場合、member が AI 生成結果を会社戦略として保存できてしまう**（capability マトリクスの `member: strategy:edit=false` がサーバ側で破れる）。→ F-8 の RLS 設計でロール別書込を担保すること。
- **集計 AI の匿名保護 — 良好（確認済）**: `org-alignment/admin/insights/generate` は **admin 必須**＋会社スコープ＋AI プロンプトに**投稿者の識別子を渡さず相手"属性"のみ**（→ G-7）。可視性（anonymous）境界を越えた識別はしていない。

### 改善
- ユーザー入力と「システム指示」を明確に分離し、**入力は信頼しない前提**でプロンプト設計（区切り・ロール分離・指示の再注入対策）。
- AI コンテキストは **テナント（会社）＋必要に応じてロール/部門でフィルタ**（F-8 と連動）。`companyId` は常に membership 由来で固定。
- AI 生成結果の**保存経路で `strategy:edit` 相当の書込権限を担保**（RLS のロール条件、または保存を権限付き API 経由へ）。
- 出力は**スキーマ検証＋表示時エスケープ**を徹底（特に保存/再表示経路）。
- モデル更新時の**回帰テスト**（代表プロンプトの安全挙動・フォーマット確認）を運用に組み込む。
- 参考: **OWASP Top 10 for LLM Applications**（LLM01 Prompt Injection 等）、**OWASP Machine Learning Security Top 10**、**NIST AI RMF**、**MITRE ATLAS**（AI への攻撃手法カタログ）。

---

## 10. 🟢 良好な実装（維持すべき点）

- **招待**: `randomBytes(32)`（256bit）→ SHA ハッシュ保存、`expires_at`、`(company_id,email) where accepted_at is null` の単一制約（`invites/create`, `company_invites` migration）。
- **Cookie**: `httpOnly` 既定 true、本番 `secure`、`sameSite=lax`。
- **権限の単一ソース**: `lib/rbac.ts` に capability を集約、API/UI 共用。会社・部門スコープ強制（`rbacGuard`）。
- **最終 admin 保護**: 会社から admin が消える降格を拒否。
- **秘密情報の取り扱い**: `.env*` は gitignore 済み、リポジトリに秘密ファイルなし。`SERVICE_ROLE` がクライアントに露出していない（`NEXT_PUBLIC` 混入なし）。
- **G-6 AI のテナント分離（主要経路）**: `ask-ceo-agent` は `requireMembership` + `assertCompanyScopeByStrategyId` で要求 `strategyId` が呼び出し元会社のものか検証。認証付き `generate-*` も membership 基準（body の `companyId` を信用しない）。
- **G-7 集計 AI の匿名保護**: `org-alignment/admin/insights/generate` は admin 必須＋会社スコープ＋AI へ投稿者識別子を渡さず相手属性のみ。

---

## 11. IPA ガイドラインとの対応

国内クライアント向け PoC を前提に、**IPA（情報処理推進機構）「安全なウェブサイトの作り方」改訂第 7 版**の代表的脆弱性分類に対し、本アプリの実装状況をマッピングする。あわせて IPA「ログの出力（適切な監査）」「セキュリティ・バイ・デザイン」の観点も評価する。

### 11.1 「安全なウェブサイトの作り方」脆弱性別チェック

| IPA 分類（代表的脆弱性） | 本アプリの状況 | 評価 | 関連 |
|---|---|---|---|
| 1. SQL インジェクション | Supabase クライアント（パラメータ化クエリ）経由。生 SQL 連結なし | 🟢 低リスク | — |
| 2. OS コマンドインジェクション | 外部コマンド実行なし | 🟢 該当なし | — |
| 3. パス名・ディレクトリトラバーサル | `stage1/import` に `fs`/`path` 操作なし＝ファイルはメモリ内パース（papaparse/pdf-parse） | 🟢 低リスク（確認済） | `stage1/import` |
| 4. 不適切なセッション管理 | Supabase Auth + Cookie（httpOnly/secure/SameSite=lax）。ただし **無認証 Cookie 設定口**あり | 🟡 要改善 | F-6 |
| 5. クロスサイト・スクリプティング（XSS） | `dangerouslySetInnerHTML` の使用 **0 件**（確認済）＝React 自動エスケープ。ただし **CSP 未設定**で多層防御が弱い | 🟡 要改善（CSP） | F-4 |
| 6. CSRF | API は Bearer トークン（Cookie 自動送信に依存しない）方式が中心 → CSRF 耐性あり。一方 **Cookie 設定口・Cookie 依存箇所**は要点検 | 🟡 要確認 | F-6 |
| 7. HTTP ヘッダインジェクション | ユーザー入力を用いたリダイレクト/ヘッダ生成は検出されず | 🟢 低リスク（確認済） | — |
| 8. メールヘッダインジェクション | 招待メールは **Supabase Auth（`inviteUserByEmail`/`generateLink`）経由**で自前 SMTP ヘッダ組み立てなし | 🟢 低リスク（確認済） | `invites/*` |
| 9. クリックジャッキング | **X-Frame-Options / CSP frame-ancestors 未設定** | 🔴 未対応 | F-4 |
| 10. バッファオーバーフロー | Node/TS 実行環境のため非該当 | 🟢 該当なし | — |
| 11. アクセス制御・認可制御の不備 | 中央ガード `rbacGuard` あり（良）。だが **無認証 API 8 本**・認可の二重化・RLS 未確認が残る | 🔴 要改善 | F-2, F-5, F-8 |

### 11.2 IPA「ログの出力（監査）」観点

IPA は不正アクセスの検知・追跡のため、**認証・重要操作のログ取得**を推奨している。本アプリは F-9 のとおり **権限変更・削除・招待等の永続監査が無く、要件未達**。→ F-9 の改善（`audit_logs` 新設）で対応する。

### 11.3 「安全なウェブサイトの運用」「セキュリティ・バイ・デザイン」観点

| 観点 | 状況 | 対応 |
|---|---|---|
| 秘密情報の管理 | `.env` 非コミット（良）。だが `NEXT_PUBLIC_OPENAI_API_KEY` の存在は設計上の欠陥 | F-1 |
| ソフトウェア更新 | 依存に既知脆弱性 51 件（npm audit） | F-10 |
| 障害・攻撃への耐性 | レート制限なし（DoS 耐性が低い） | F-3 |
| 多層防御 | セキュリティヘッダ未設定 | F-4 |

> 補足: 当初 🟡「要確認」としていた XSS（`dangerouslySetInnerHTML`）・オープンリダイレクト・メールヘッダ・パス処理は **本レビューで静的確認し、いずれも該当箇所なし＝低リスク**に更新した（上表）。残る要点検は CSRF まわり（Cookie 依存箇所）で、最終確認は動的テスト（フェーズ D-4）で行う。

---

## 12. 改善点（優先度つき）

### 必須（PoC ブロッカー）= 「最低限のセキュリティ担保」ライン
1. **F-8（最優先・データ保護）**: 全テーブルの RLS を確認・整備し、**会社 A→会社 B のデータに触れないことを実テスト**。マイグレーション化。
2. **F-1**: `utils/ai.ts` 削除 + `NEXT_PUBLIC_OPENAI_API_KEY` を環境から除去。OpenAI はサーバ専用キーのみ。
3. **F-2**: 無認証の生成系 8 本に認証/認可を付与（`rbacGuard`）。
4. **F-3**: レート制限を導入（IP/ユーザー単位 + 生成系の日次上限）。
5. **F-10**: `npm audit fix`（非破壊）適用 + `next` 更新で High 以上を可能な範囲で解消。
6. **F-9**: 改ざん耐性のある `audit_logs` を新設し、認証・権限変更・削除・招待を記録（IPA ログ要件）。

### 強く推奨（PoC 前）
7. **F-4**: 型/Lint ビルド無視を解除 + セキュリティヘッダ追加（クリックジャッキング/XSS 多層防御＝IPA #5/#9）。
8. **F-5**: 認可を `rbacGuard` に統一し、全ルートの認可被覆を CI で保証（IPA #11）。
9. **F-6**: Cookie 設定口の認証必須化 + Cookie 名許可リスト（IPA #4/#6）。
10. CSRF まわり（Cookie 依存箇所）をコード精査 + 動的テストで実証。

### 推奨（PoC 後でも可）
11. **F-7**: 本番ログのレベル制御・機微フィールドのマスキング。
12. **F-11（AI セキュリティ）**: prompt injection 対策・出力検証・AI コンテキストの会社スコープ確認・モデル変更時の回帰（OWASP LLM Top 10 基準）。
13. `xlsx` の代替検討（修正版なし）/ Dependabot で継続監視（F-10）。
14. `agent_logs` のサーバ側書込化・保持期間/マスキング方針の策定（F-9 の一部）。

---

## 13. 外部クライアント PoC までに必要なステップ

> 「社外クライアントに触ってもらう PoC」を **限定公開・少人数・短期間**で安全に行うための最小ライン。

### フェーズ A: セキュリティ必須修正（ブロッカー解消）
- [ ] **A-1** `utils/ai.ts` 削除、`NEXT_PUBLIC_OPENAI_API_KEY` を全環境から除去（F-1）。
- [ ] **A-2** 無認証生成系 8 本に `getAuthUserIdFromBearer` + `requireMembership` を追加（F-2）。
- [ ] **A-3** 全 `app/api/**` の **認可被覆チェックを CI 化**（ガード無し書き込みルート＝ビルド失敗）（F-5）。
- [ ] **A-4** レート制限導入（少なくとも生成系・認証系）（F-3）。
- [ ] **A-5（最優先）** 全テーブルの **RLS を確認・整備**し、**会社 A のユーザーで会社 B のデータに `select/update/delete` できないことを実テスト**。ポリシーをマイグレーション化（F-8）。
- [ ] **A-6** `npm audit fix`（非破壊）適用 + `next` 更新で High 以上を解消（F-10）。
- [ ] **A-7** **`audit_logs` 新設**（append-only / サーバ書込）。認証・権限変更・削除・招待を記録（F-9 / IPA ログ要件）。

### フェーズ B: ビルド健全化・多層防御
- [ ] **B-1** `tsc --noEmit` と `next lint` を **CI 必須ゲート**化、`ignoreBuildErrors`/`ignoreDuringBuilds` を解除（F-4）。
- [ ] **B-2** セキュリティヘッダ（CSP/HSTS/X-Frame-Options ほか）を `next.config.js` に追加（F-4）。
- [ ] **B-3** `set-cookie`/`set-company` の認証必須化・Cookie 名許可リスト（F-6）。
- [ ] **B-4** 本番ログのレベル制御・機微マスキング（F-7）。
- [ ] **B-5** Dependabot で依存脆弱性を継続監視。`xlsx`（修正版なし）の代替/緩和を検討（F-10）。
- [ ] **B-6** CSRF まわり（Cookie 依存箇所）をコード精査 + 動的テストで実証（IPA #6）。

### フェーズ C: テナント運用・データ保護
- [ ] **C-1** PoC クライアント専用の **会社（テナント）を分離**して払い出し、他テナントと混在させない。
- [ ] **C-2** 招待フロー（`invites/*`）でのオンボーディングを実機確認（有効期限・単一招待・受諾後失効）。
- [ ] **C-3** バックアップ/リストア手順（Supabase スナップショット）と **データ削除（退会時）手順**を用意。
- [ ] **C-4** 個人情報・事業機密の取り扱い同意（NDA / 利用規約 / プライバシーポリシー）を PoC 開始前に締結。
- [ ] **C-5** OpenAI への送信データに関する **データ処理の明示**（学習不使用設定の確認、機微データの送信範囲）。

### フェーズ D: 運用・監視
- [ ] **D-1** エラー監視（Sentry 等）とアラート。
- [ ] **D-2** OpenAI コストのダッシュボード/上限アラート。
- [ ] **D-3** `audit_logs`（F-9 / A-7）の保全・admin 限定閲覧と、インシデント時の追跡手順を整備。
- [ ] **D-4** ステージング環境での **動的セキュリティテスト**（認可バイパス・IDOR・レート制限・IPA 11 分類の実機確認）。PoC 前にこのレビューの指摘を再実証する。

### フェーズ E: PoC リリース判定（Go/No-Go）
- [ ] フェーズ A 全項目完了（A-1〜A-7、必須）。**特に A-5（他社データに触れない実テスト）が green であること**。
- [ ] フェーズ B-1/B-2/B-3 完了。
- [ ] フェーズ C-1/C-4/C-5 完了。
- [ ] IPA「安全なウェブサイトの作り方」11 分類で 🔴 が残っていない（§11）。
- [ ] 主要シナリオ（Stage1→6、組織変革、招待）の E2E と RBAC E2E（`scripts/rbac-e2e-min.sh`）が green。

---

## 14. 参考資料・標準の補足

セキュリティの「チェックシート」は複数あり、**目的・粒度・言語・合否判定に使えるか**が異なる。混同せず、用途で使い分ける。

### 主要な参考資料

| 参考資料 | 種類 | 特徴 | 言語 |
|---|---|---|---|
| **OWASP Top 10** | リスクの地図 | 代表的リスク 10 カテゴリ。全体像把握・教育向け。**合否判定には粒度が粗い** | 日/英 |
| **OWASP ASVS**（Application Security Verification Standard） | 検証要件チェックリスト | 認証/アクセス制御/入力検証/ログ等を**合否式**で網羅。L1(基本)/L2(標準)/L3(高セキュア)の段階あり | 主に英 |
| **OWASP WSTG**（Web Security Testing Guide） | テスト手順書 | 実際に攻撃を試す**動的テストの how-to** | 英 |
| **OWASP Cheat Sheet Series** | 実装の手引き | CSP・JWT・Cookie 等、**個別対策の辞書** | 英 |
| **IPA「安全なウェブサイトの作り方」** | 国内教育＋対策 | 代表的脆弱性 11 種＋対策＋失敗例。**日本語・国内文脈で読みやすい**。ASVS ほど網羅/合否式ではない | 日 |
| **IPA「ウェブ健康診断仕様」** | 簡易診断項目 | 軽量なチェック項目。簡易点検・動的テストの項目出しに | 日 |
| **Supabase Production Checklist / RLS ガイド** | スタック固有（データ層） | RLS・認証・バックアップを公式が項目化。**本アプリの F-8（データ保護）に直撃** | 英 |
| **Vercel Production Checklist / Security・Firewall** | スタック固有（基盤層） | 本番移行のベストプラクティス＋DDoS/**WAF・レート制限**・環境変数・Deployment Protection。**F-1/F-3/F-6 に効く** | 英 |
| **Next.js「Going to Production」** | スタック固有（アプリ層） | セキュリティヘッダ・キャッシュ・最適化の本番前チェック。**F-4 に効く** | 英 |
| **OWASP Top 10 for LLM Applications** | AI/LLM 固有リスク | Prompt Injection 等 LLM アプリの代表リスク。**F-11 に直結** | 英 |
| **OWASP ML Security Top 10 / NIST AI RMF / MITRE ATLAS** | AI セキュリティ標準 | ML/AI への攻撃と管理策の枠組み。AI 機能の設計・運用指針 | 英 |

### 選び方の軸
- **目的**: リスク地図（Top 10）／検証要件（ASVS）／テスト手順（WSTG）／実装辞書（Cheat Sheet）／国内教育（IPA 作り方）／簡易診断（IPA 健康診断）／スタック固有（Supabase・Vercel・Next.js）。
- **合否判定に使えるか**: ASVS・IPA 健康診断・各スタックチェックリストは項目チェック向き。Top 10・IPA 作り方は教育・網羅確認向き。
- **言語**: 社内・国内クライアント説明は IPA（日本語）、客観的証跡は ASVS（国際標準）。

### スタック固有チェックリストは「3 層」で押さえる
本プロダクトは Supabase + Vercel + Next.js 構成のため、公式チェックリストを **役割の異なる 3 層**として併用する。

| 層 | チェックリスト | 主に効く発見 |
|---|---|---|
| データ層（DB・認可・RLS） | **Supabase** Production / RLS | F-8（テナント分離・最重要） |
| 基盤層（公開・WAF・秘密情報・レート制限） | **Vercel** Production / Security・Firewall | F-1・F-3・F-6 |
| アプリ層（ヘッダ・キャッシュ・ビルド） | **Next.js** Going to Production | F-4 |

### 本 PoC での使い分け
1. **データ保護は Supabase Production/RLS チェックリスト**で潰す（F-8＝最重要）。
2. **基盤（公開・WAF・レート制限・環境変数）は Vercel チェックリスト**で確認（F-1/F-3/F-6）。
3. **アプリ（セキュリティヘッダ等）は Next.js Going to Production**で確認（F-4）。
4. **全体の合否基準は OWASP ASVS Level 1**（PoC は L1 で十分。○×で埋めれば「最低限担保」の客観的証跡になる）。
5. **国内向け説明・教育は IPA「安全なウェブサイトの作り方」**（本書 §11 で 11 分類に対応済み）。
6. **本番前の動的テストは OWASP WSTG / IPA 健康診断**の項目を使う（フェーズ D-4）。
7. 個別実装の修正時は **OWASP Cheat Sheet** を辞書として参照。
8. **AI/LLM 機能は OWASP Top 10 for LLM Applications** を基準に対策（prompt injection 等＝F-11）。

> 使い分けの目安: 「**スタック 3 層（Supabase=データ / Vercel=基盤 / Next.js=アプリ）＋ ASVS L1=合否表 / IPA=国内説明 / WSTG=実機テスト / OWASP LLM Top10=AI**」。

---

## 15. あとでやれるといいリスト（PoC 後の改善バックログ）

PoC の最低ライン（§12 必須）には含めないが、**本運用・規模拡大に向けて順次着手したい**もの。

### セキュリティ強化
- [ ] **多要素認証（MFA）** の導入。
- [ ] OWASP **ASVS を L1 → L2** に引き上げ。
- [ ] **外部業者によるペネトレーションテスト**（年次）。
- [ ] **WAF** 導入（Vercel WAF 等）と異常検知。
- [ ] 秘密情報の **シークレットマネージャ化＋キーの定期ローテーション**。
- [ ] **CSP の厳格化**（nonce/hash 化、`unsafe-inline` 排除）。
- [ ] `xlsx` をメンテされた代替（例: `exceljs`）へ置換（F-10、修正版なしのため）。
- [ ] **脆弱性開示ポリシー**（`security.txt`）と受付窓口。

### データ保護・プライバシー
- [ ] **データ分類**の定義（事業機密／個人情報／AI 入力データ／監査ログ）と取扱ルール。
- [ ] **データ保持期間**の定義（`agent_logs`・進捗ログ・退会後データ・バックアップ）と保持超過の自動削除。
- [ ] **個人情報・機微データの最小化／項目レベルのマスキング・暗号化**。
- [ ] バックアップからの **定期リストア訓練**。
- [ ] 事業拡大時の **ISMS（ISO 27001）/ P マーク** 等の取得検討。

### AI/LLM セキュリティ（F-11 の発展）
- [ ] prompt injection 対策の継続改善（入力分離・指示再注入対策）。
- [ ] AI 出力の検証・サニタイズの全経路適用。
- [ ] モデル変更時の**回帰テスト**を運用化。

### 運用・監視・品質・ガバナンス
- [ ] 監査ログの **集中管理（SIEM）とアラート**（F-9 の発展）。
- [ ] **インシデント対応手順**（連絡体制・初動・ログ保全・顧客通知基準）の整備。
- [ ] **権限の定期棚卸し**（admin/manager/member の付与レビュー運用）。
- [ ] 依存更新の自動化（**Renovate**）＋ **SBOM** 生成。
- [ ] **E2E / 統合テストの拡充**とカバレッジ計測（[09] 運用保守）。
- [ ] レート制限の **用途別チューニング**・コスト異常検知（[08] F-3 / [09] システム環境）。
- [ ] `strategy_data`（巨大 JSONB）の **差分保存・分割**による性能改善（[09] 性能）。
- [ ] OKR 二重ソースの **正本一本化**（[09] 移行性、`docs/phase2a/`）。

> これらは「やらないと PoC に出せない」ものではない。**§12 必須 → §13 PoC ステップ**を優先し、本リストは PoC 運転と並行して計画的に消化する。

---

## 16. レイヤ別セキュリティ要件（Vercel / コードベース / Supabase）

「インフラ（Vercel）／コードベース／DB（Supabase）」の 3 層でセキュリティ要件が詰められているかを、**現状・PoC でやる・今後やる**に整理する。

> **検証状況の前提**: 本レビューで実検証できたのは **コードベース層のみ**。Vercel / Supabase の設定は**環境未入手のため未確認**で、以下はコードの利用状況からの推定＋公式チェックリストに基づく「やるべきこと」。環境入手後に実値で確認する。

### 16.1 Vercel（インフラ／基盤層）— ⚠️ 環境入手後に要確認

| 要件 | 現状（推定） | PoC でやる | 今後やる |
|---|---|---|---|
| 秘密情報・環境変数 | `NEXT_PUBLIC_OPENAI_API_KEY` 誤用（F-1） | 鍵をサーバ専用へ（A-1）／`NEXT_PUBLIC_*` に KEY/SECRET 禁止の CI ゲート | シークレットマネージャ・キーローテーション |
| レート制限・WAF・DDoS | なし（F-3） | Vercel WAF または rate limit 導入（A-4） | 用途別チューニング・異常検知 |
| セキュリティヘッダ配信 | 未設定（F-4） | CSP/HSTS/X-Frame-Options 等を付与（B-2） | CSP 厳格化（nonce） |
| Deployment / Preview 保護 | 未確認 | Preview 環境の認証保護・本番のみ公開を確認 | — |
| 監視・コスト | なし | エラー監視（D-1）／OpenAI コスト上限（D-2） | SIEM 連携 |

> 参照: **Vercel Production Checklist / Security・Firewall**。

### 16.2 コードベース（アプリ層）— ✅ 本レビューで検証済み

| 要件 | 現状 | PoC でやる | 今後やる |
|---|---|---|---|
| 認証・認可の被覆 | 無認証 8 本（F-2）・認可二重化（F-5）／中央ガードは存在（G-5） | 無認証 API に認証付与（A-2）・全書込の認可被覆を CI 化（A-3） | — |
| 依存パッケージ | 既知脆弱性 51 件（F-10） | `npm audit fix`＋`next` 更新（A-6） | Dependabot/SBOM・`xlsx` 置換 |
| 入力検証・XSS | `dangerouslySetInnerHTML` 0 件（良）／CSP は Vercel 層 | （CSP は 16.1） | — |
| AI/LLM | 対策未整理（F-11）／テナント分離は主要経路で確認（G-6/G-7） | AI コンテキストを会社固定・出力検証・member の AI 書込防止（F-8 連動） | モデル回帰テスト・ASVS/LLM 継続 |
| ログ・監査 | ログ過多（F-7）・監査ログ実質不在（F-9） | `audit_logs` 新設（A-7）・ログのレベル制御 | SIEM・保持/マスキング方針 |
| ビルド品質 | 型/Lint 無視（F-4） | `tsc`/`lint` を CI 必須化（B-1） | — |
| 秘密のハードコード | なし・`.env*` 非コミット（G-4） | 維持 | — |

> 参照: **OWASP ASVS Level 1 / Next.js Going to Production / OWASP Top 10 for LLM Applications**。

### 16.3 Supabase（DB 層）— ⚠️ 環境入手後に要確認（最重要）

| 要件 | 現状（推定） | PoC でやる | 今後やる |
|---|---|---|---|
| RLS・テナント分離 | コア定義 repo 外で**未確認**。ほぼ全テーブルにクライアント直アクセス（F-8） | 全テーブルの RLS 確認・整備、**会社 A→B 越境拒否を実テスト**（A-5） | — |
| ロール別書込制御 | RLS 依存・未確認（F-8/F-11） | 書込 RLS に**ロール条件**（戦略編集は admin/manager）、**member 書込拒否を実テスト** | — |
| スキーマ管理 | コアテーブル定義が repo 外 | RLS 含む定義を**マイグレーション化**（A-5） | — |
| バックアップ・復旧 | 未確認 | 日次バックアップ確認＋リストア手順（C-3） | 定期リストア訓練 |
| データ保持・削除 | 方針なし | 退会時データ削除手順（C-3） | 保持期間の自動削除・データ分類 |
| 監査ログ保存 | `agent_logs` がクライアント書込（F-9） | サーバ書込化＋`audit_logs`（A-7） | — |
| Auth 設定 | 未確認 | メール確認・パスワードポリシー・トークン期限を確認 | MFA |

> 参照: **Supabase Production Checklist / RLS ガイド**。

### 16.4 まとめ（3 層 × PoC 優先）

- **最優先は Supabase 層の F-8**（テナント分離＋ロール別書込）。データ保護の生命線で、環境入手後に**実テストでの確認が必須**。
- **コードベース層**は本レビューで検証済み。PoC ブロッカー（F-1/F-2/F-9/F-10）を潰せば「最低限担保」ライン。
- **Vercel 層**は環境入手後に、鍵・レート制限・ヘッダ・Preview 保護を設定で確認。
- 各層の詳細タスクは §12（改善点）・§13（PoC ステップ）に対応。

---

## 付録: 検証コマンド（再現用）

```bash
# 認可ガードの適用被覆（guarded / total）
grep -rl "rbacGuard\|getAuthUserIdFromBearer\|requireMembership" app/api --include=route.ts | wc -l
find app/api -name route.ts | wc -l

# NEXT_PUBLIC に秘密が混ざっていないか
grep -rhoE "NEXT_PUBLIC_[A-Z_]+" app lib utils components store hooks | sort -u

# ブラウザ OpenAI 実行の検出
grep -rn "dangerouslyAllowBrowser\|NEXT_PUBLIC_OPENAI_API_KEY" app lib utils components

# データ保護: ブラウザ(anonキー)から直接触る全テーブル（F-8）
grep -rhoE "\.from\(['\"][a-z_]+['\"]\)" app components store hooks --include=*.tsx --include=*.ts | grep -v "api/" | grep -oE "['\"][a-z_]+['\"]" | tr -d "\"'" | sort | uniq -c | sort -rn

# 依存パッケージの脆弱性（F-10）
npm audit
```
