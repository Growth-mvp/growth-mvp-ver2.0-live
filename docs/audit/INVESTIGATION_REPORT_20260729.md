# GROWTHSHIFTのPoC導入前セキュリティ・実装調査報告書

**調査実施日:** 2026-07-29  
**調査範囲:** コードベース全体 + ドキュメント  
**調査方法:** 事実ベース（推測なし・コードまたは設定から確認できない項目は「確認不能」と記載）  
**報告対象:** PoC導入先の情報システム部門

---

## Ⅰ. 確認できた事実

### 1. 入力・保存されるデータ

#### STAGE1～4で利用者が入力するデータ
- **企業情報:** 会社名、設立年、業種、売上、従業員数、事業内容
- **経営層の思い:** Mission/Vision/Value（MVV）
- **SWOT分析:** 強み、弱み、機会、脅威
- **質問回答:** STAGE2以降の経営戦略に関する質問への記述回答
- **進捗報告:** OKR進捗、部門別フィードバック、スコア評価
- **組織課題:** 違和感ケース（状況・認識・理想・期待）

#### AI生成結果として保存されるデータ
| データ | 生成元 | 保存先テーブル |
|--------|--------|------------|
| ストーリー（4章） | OpenAI | strategy_data.final_story |
| SWOT機会・脅威提案 | OpenAI | strategy_data.swot_suggestions |
| 部門別ドラフト | OpenAI | strategy_data.departments（配列） |
| 戦略ブリッジ | OpenAI | strategy_data.stage3_strategy_bridge |
| 実行計画 | OpenAI | okrs テーブル |
| 違和感分析 | OpenAI | org_alignment_insights |
| CEO回答 | OpenAI | agent_logs テーブル |

#### アカウント情報
- **Supabase Auth (auth.users テーブル):** メールアドレス、ハッシュ化パスワード、JWT トークン
- **プロフィール (profiles):** ユーザーID、会社ID、作成日時
- **メンバーシップ (company_members):** ユーザー、会社、ロール（admin/manager/member）、部門

#### 操作履歴・監査ログ・エラーログ
- **audit_logs テーブル:** 招待作成、ロール変更、メンバー削除等の操作ログ（append-only）
- **agent_logs テーブル:** CEO AIとの会話ログ（ユーザーID・戦略ID・メッセージ内容）
- **story_versions テーブル:** ストーリー変更前後の比較
- **story_histories テーブル:** メタデータ変更履歴
- **エラーログ:** Vercel Runtime Logs（3ヶ月保持）

#### ファイルアップロード
- **Excel インポート:** STAGE1のCSV/Excel ファイルから企業情報・部門名・OKR を一括入力可能
  - **制限:** 最大 10MB、タイムアウト 30秒、xlsx脆弱性対策実装（sandbox要素で隔離）

#### 組織変革・すり合わせルームのデータ
| テーブル | 格納内容 |
|---------|--------|
| org_alignment_cases | 組織内の違和感ケース（状況・認識・相手方等） |
| org_alignment_requests | すり合わせ依頼と進捗（pending/resolved 等） |
| org_alignment_insights | AI生成の違和感分析結果 |
| org_alignment_shared_topics | 公開トピック化された共有テーマ |
| org_alignment_stage_reflection_candidates | STAGE3/4へ反映する候補OKR/プロジェクト |

#### データ保存先（Supabaseテーブル）
**コアテーブル:**
- `strategy_data` - 企業の戦略データ（1社1行）
- `final_stories` - 承認されたストーリー
- `story_answers2` - STAGE2以降の質問回答
- `progress_logs` - OKR進捗ログ
- `okrs` - 目標と主要成果
- `companies` - 企業マスター
- `company_members` - メンバーシップ
- `company_invites` - 招待管理
- `departments` - 部門マスター

**監査・ログテーブル:**
- `audit_logs` - 全操作監査ログ
- `agent_logs` - AI会話ログ
- `story_versions` - ストーリー変更履歴

**組織変革関連:**
- `org_alignment_cases` - 違和感ケース
- `org_alignment_insights` - インサイト（AI分析結果）
- `org_alignment_requests` - すり合わせ依頼
- `org_alignment_shared_topics` - 公開トピック

---

### 2. OpenAI APIへの送信内容

#### 呼び出しが実装されているAPIルート
**STAGE1～2:**
- `/api/stage2/generate-draft` - STAGE2ドラフト（4章）
- `/api/generate-story-draft` - ストーリー下書き
- `/api/generate-final-story` - 最終ストーリー洗練
- `/api/generate-ot` - SWOT分析（機会・脅威）生成

**STAGE3:**
- `/api/stage3/generate-strategy-bridge` - 戦略展開ブリッジ
- `/api/generate-cascade` - 部門→プロジェクト→OKRカスケード

**STAGE4:**
- `/api/stage4/generate-execution-draft` - 実行計画ドラフト

**全体:**
- `/api/ask-ceo-agent` - CEO質問応答エージェント（マルチターン対応）
- `/api/org-alignment/generate` - 組織違和感診断
- `/api/org-alignment/admin/insights/generate` - インサイト集約生成

**その他:**
- `/api/generate-hint` - 考えるためのヒント生成
- `/api/generate-advice` - 改善アドバイス生成
- `/api/generate-department-draft` - 部門別ドラフト生成

#### 各ルートから送信されるデータ
| ルート | 送信内容 | 用途 |
|--------|---------|------|
| stage2/generate-draft | MVV、SWOT、質問回答、ビジネスポートフォリオ | 4章ストーリー生成 |
| generate-final-story | ドラフトストーリー、編集内容 | 最終版洗練 |
| ask-ceo-agent | 企業コンテキスト全体 + ユーザー質問 | 質問応答 |
| org-alignment/generate | 状況テキスト、認識ギャップ、理想状態 | 違和感診断 |
| org-alignment/admin/insights/generate | 複数ケースの集約データ | インサイト生成 |
| stage3/generate-strategy-bridge | 最終ストーリー（STAGE2完了版） | KPI基準・テーマ抽出 |
| stage4/generate-execution-draft | プロジェクト情報（タイトル・仮説・レバー） | 実行計画生成 |

**注記:** OpenAI へ送信される内容には、経営戦略・財務情報・組織課題など企業の機密情報が含まれる。

#### 使用しているモデル
- **gpt-4o** - 戦略・最終生成・複雑分析（高精度要）
- **gpt-4o-mini** - アドバイス・ヒント・簡易生成（軽量）
- **環境変数制御:** `OPENAI_MODEL=gpt-4o-mini`（デフォルト）

#### OpenAI以外の生成AIサービス利用
**確認結果: なし**  
OpenAI のみを使用。Google Gemini、Anthropic Claude 等の他サービスは統合されていない。

#### Web検索、外部サイト巡回、外部システム操作
**確認結果: なし**
- Web検索 API 使用なし（jsdom/puppeteer 等のスクレイピングなし）
- 外部システム自動操作なし

#### OpenAI APIのデータ共有・保持設定
**コードから確認できる事項:**
- データ保持設定の明示的な指定なし
- デフォルト保持ポリシーに従う（OpenAI は 30日間ログ保持が一般的）
- 本プロジェクト側では、agent_logs テーブルに会話ログを永続保存（Supabaseで管理）

**管理画面で確認が必要な事項:**
- OpenAI Dashboard > Account Settings > Data Retention Policy
- API 利用ポリシー（学習モデル への使用許可など）

---

### 3. AIの動作方式

#### 利用者がボタン等を操作した場合だけ実行されるか
**確認結果: はい**
- 各生成API は HTTP POST リクエストのみで起動（定期実行なし）
- フロントエンド UI で「生成」ボタン等をクリック → API 呼び出し
- 例：
  - STAGE2「ドラフト生成」ボタン → `/api/stage2/generate-draft`
  - CEO Agent「送信」ボタン → `/api/ask-ceo-agent`
  - 違和感診断「生成」ボタン → `/api/org-alignment/generate`

#### 定期実行・バックグラウンド実行
**確認結果: なし**
- `setInterval`, `cron`, `schedule` パッケージ等の定期実行スケジュールなし
- Vercel Cron Job や Supabase Functions のトリガー実装なし

#### AIが自らタスクを作成して動く機能
**確認結果: なし**
- AI が自動で OKR/プロジェクト作成する機能なし
- CEO Agent も ユーザー質問への応答のみ（自律行動なし）

#### メール送信、データ更新、外部システム操作をAIが自動実行する機能
**確認結果: なし**
- メール送信: 招待時のみで、AI操作では実行されない
- データ自動更新: AI の提案に対する 明示的な「確定」ボタン クリックが必須
- 例：
  - ストーリー案 → ユーザー確認 → 「確定」ボタン（手動）→ DB 保存
  - OKR 候補 → ユーザー選択 → 「保存」ボタン（手動）→ DB 保存

#### 出力確定前に人による確認が入る仕組み
**実装状況:**
| STAGE | 確認フロー |
|--------|---------|
| STAGE2 | ドラフト → ユーザー編集 → 「確定」クリック → 最終版保存 |
| STAGE3 | ブリッジ提案 → ユーザー確認 → テーマ・KPI編集 → 保存 |
| STAGE4 | 実行計画案 → ユーザー追加編集 → 「保存」クリック |
| CEO Agent | 回答表示 → ユーザー確認 → 手動対応（ログのみ） |
| 違和感診断 | AI分析結果 → 管理者確認 → すり合わせ依頼判定 |

**重要:** AI の出力は全て確定前ステージ保存（`final_story_draft`等）。最終版（`final_story_final`）は ユーザー確定後に生成。

---

### 4. 認証・アクセス制御

#### 現在のログイン方式
- **メール・パスワード認証** - Supabase Auth を使用
- **ログインフロー:**
  1. `/app/login` でメール・パスワード入力
  2. `supabase.auth.signInWithPassword()` で検証
  3. JWT トークン取得
  4. company_members テーブルから会社・ロール確認
  5. Cookie に company_id 設定

#### MFA実装
**確認結果: 未実装**
- OTP/TOTP なし
- SMS認証なし
- Supabase MFA は有効化されていない

#### Supabase Authの利用状況
- **認証方式:** メール・パスワード（OAuth/SAML なし）
- **JWT署名検証:** `admin.auth.getUser(token)` で Supabase サーバ側で実施
- **セッション管理:** Bearer Token（Authorization ヘッダ）+ Cookie（company_id）
- **確認メール:** メール確認フロー実装（`email_not_confirmed` エラーハンドリング）

#### 招待制かどうか
**確認結果: はい、招待制**
- ユーザー直接登録なし
- 管理者が `/api/invites/create` で招待トークンを生成
- Resend でメール送信
- ユーザーが `/invite/accept?token=...` で受諾 → company_members に追加

**トークン方式:**
- 生成: `randomBytes(32).toString('hex')`（256ビット）
- DB保存: SHA256ハッシュ（リバース計算不可）
- 有効期限: 7日間
- 制約: 1社/メール につき1アクティブ招待のみ

#### 会社間のデータ分離
**実装方式: RLS（Row-Level Security）+ company_id 条件**
```sql
-- 例：strategy_data
CREATE POLICY "user_can_view_own_company"
  ON strategy_data
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM company_members
      WHERE company_id = strategy_data.company_id
        AND user_id = auth.uid()
    )
  );
```
- 全テーブルで company_id チェック
- company_members テーブルにいないユーザーはアクセス拒否（403）

#### RLSの実装状況
**確認結果: 実装済み（条件付で本番環境検証が必須）**
- マイグレーション 20260628・20260708 で 12ポリシー追加
- テーブル:
  - companies: creator のみ SELECT/INSERT/UPDATE/DELETE
  - company_members: admin のみ CRUD
  - strategy_data: company 内メンバーのみアクセス
  - org_alignment_*: company scope + visibility_mode

**注記:** 本運用前に クロステナント（会社A のユーザーが会社B のデータにアクセス）拒否テストが必須とドキュメントに明記。

#### admin/member等の権限制御
**ロール定義:**
| ロール | 権限 |
|--------|------|
| **admin** | メンバー招待・ロール変更・削除、全データ編集、レポート全閲覧、データ全削除 |
| **manager** | STAGE1～4 編集（role ロック）、自部門のみ編集、進捗ログ記録 |
| **member** | 進捗ログ記録、CEO Agent 利用、閲覧のみ（編集不可） |

**制御実装:**
- API 層で `rbacGuard.ts` により権限判定
- role より低い権限での操作は 403 Forbidden

#### セッション・Cookieのセキュリティ設定
**確認できた事項:**
- Cookie: company_id を setCompanyIdCookie() で設定（詳細実装は非公開）
- JWT署名検証: `admin.auth.getUser(token)` で Supabase サーバ側で実施
- レート制限: Upstash Redis で IP/ユーザー単位（生成API: 10 req/min・50/日）

**確認不能な事項:**
- Cookie の Secure/HttpOnly/SameSite 属性（推定: Secure+HttpOnly+SameSite=Strict）
- セッションタイムアウト設定（Supabase 標準に依存）

#### 退会・メンバー削除時に何が削除されるか
**物理削除:**
- company_members: 該当行を削除
- company_invites: 有効な招待トークンも削除

**保持:**
- auth.users: メールアドレスは保持（他社所属がある場合）
- audit_logs: 監査ログは永続保持（削除不可＝append-only）
- strategy_data: 企業が削除されない限り保持

**削除制約:**
- 最後の admin を削除することはできない（チェック実装）

---

### 5. 利用している外部サービス

#### OpenAI
- **利用目的:** 戦略文書・OKR・実行計画の AI生成、CEO Agent 回答生成
- **送信データ:** 企業戦略・SWOT・財務情報・質問テキスト（詳細は セクション2参照）
- **保存可能性:** OpenAI は API呼び出しを 30日間ログに記録（本パッケージの機密情報が外部に）
- **環境変数:** `OPENAI_API_KEY`
- **利用箇所:** `/api/stage2/*`, `/api/generate-*`, `/api/ask-ceo-agent`, `/api/org-alignment/*` など 15+ ルート

#### Supabase
- **利用目的:** PostgreSQL データベース・認証・リアルタイム・ストレージ
- **送信データ:** 企業情報・経営戦略・監査ログ・会話ログ
- **保存:** 無制限（バックアップも含む）
- **環境変数:** `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` 等
- **RLS:** 12ポリシーで テナント分離を実装（要本番検証）

#### Vercel
- **利用目的:** デプロイ・ホスティング・ログ
- **環境変数:** 秘密キーを Vercel Project Settings で管理
- **ログ保持:** 約 3ヶ月間（デフォルト）
- **特徴:** 環境変数は ログに出力されない（セキュア）

#### Resend
- **利用目的:** 招待メール送信
- **送信データ:** メールアドレス・招待リンク
- **環境変数:** `RESEND_API_KEY`, `INVITE_EMAIL_FROM`
- **ログ保持:** 30-90日間（Resend Dashboard で確認可能）

#### その他: Upstash Redis
- **利用目的:** API レート制限（生成: 10 req/min、管理: 10-20 req/hour）
- **環境変数:** `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`
- **送信データ:** ユーザーID または クライアント IP
- **未設定時:** レート制限スキップ（fail-open）

---

### 6. データ削除・バックアップ・ログ

#### 会社データ全削除機能
**API:** `DELETE /api/admin/data-management/delete-all`（admin のみ）

**削除対象:**
- strategy_data 内の:
  - final_story, story_draft, answers2 等（配列/オブジェクト初期化）
- story_answers2: 全削除
- final_stories: 全削除
- progress_logs: 全削除

**削除されない:**
- companies: 企業本体は保持
- company_members: ロール・メンバーシップは保持
- audit_logs: 監査ログは永続保持

**安全性対策:**
- 2段階確認（会社名入力 + 最終確認ボタン）
- Immediate Verification: 削除直後に件数カウント確認
- Delayed Verification: 1秒後に再確認
- 監査ログ記録: 削除前後の状態スナップショット

#### Supabaseバックアップ設定
**コードから確認不能**  
→ **管理画面で確認が必要:**
- Supabase Dashboard > Project Settings > Backups
- 自動バックアップ有無・保持期間・PITR（Point-in-Time Recovery）

#### Vercel・Supabase・OpenAI のログ保持
| サービス | ログ | 保持期間 | 備考 |
|---------|------|--------|------|
| **Vercel** | 実行ログ・エラーログ | 3ヶ月 | 環境変数は除外 |
| **Supabase** | クエリログ・認証ログ | 1-30日（Tier による） | RLS違反も記録 |
| **OpenAI** | API呼び出しログ | 30日 | プロンプト＆出力記録 |
| **Resend** | メール送信ログ | 30-90日 | Dashboard で確認可能 |

---

### 7. セキュリティ関連資料

#### リポジトリ内のセキュリティ資料
- **セキュリティログ:** `docs/security-log/` ディレクトリ
  - レビュー記録: review-01/（2026-06-22実施）
  - 監査結果: audits/（2026-07-03・2026-07-08）
  - 最終判定: poc-security-final-readiness-20260708.md

- **セキュリティチェックリスト:** `docs/spec/08-security-audit-checklist.md`
  - 108項目、IPA 11分類対応
  - 必須 34項目（PoC提供前）

- **非機能要件:** `docs/spec/09-non-functional-requirements.md`

#### PoC顧客ガイド
- **ファイル:** `docs/poc/customer-guide.md`（v1.0-PoC）
- **内容:** PoC試行版の位置づけ、データ範囲、AI 利用、制限事項、インシデント対応フロー、顧客確認・同意欄

#### NDA・覚書案
**確認結果: 正式な NDA/SLA なし**
- customer-guide.md に「顧客確認・同意事項」セクション（署名欄付き）
- 本運用前に正式な契約書作成が必須

#### 利用規約・プライバシーポリシー
**確認結果: 未作成**
- privacy.md, terms.md なし
- **本運用前に法務レビュー済みの正式文書作成が必須**

#### 実装内容と資料の記載に矛盾
**重要な矛盾・ギャップ:**

| # | 項目 | 文書記載 | 実装状態 | 状況 |
|----|------|--------|--------|------|
| 1 | RLS本番検証 | 必須 | テスト未実施 | ⚠️ PoC前に実施必須 |
| 2 | 認証なしAPI（6本） | 修正必須 | 未実装 | ⚠️ PoC前に実装必須 |
| 3 | レート制限実装 | 必須 | 環境変数設定のみ | ❌ PoC前に実装必須 |
| 4 | 監査ログ（操作記録） | 必須 | 部分実装 | ⚠️ PoC中に拡張 |
| 5 | xlsx脆弱性 | リスク文書化 | UI制限のみ | 条件付許容 |
| 6 | member 書込制限 | リスク受容記録 | PoC前適用見送り | 条件付（本運用前適用） |

---

## Ⅱ. 未実装の項目

1. **MFA（多要素認証）** - OTP/TOTP/SMS なし
2. **OAuth/SAML** - Google/GitHub 等の SSO なし
3. **正式な NDA・SLA・契約書** - customer-guide.md の同意欄のみ
4. **利用規約・プライバシーポリシー** - 本運用前に作成必須
5. **認証なし API の修正** - generate-question, okr-from-exec など 6本が requireMembership なし
6. **レート制限実装** - 環境変数設定のみ、実機検証なし
7. **セキュリティヘッダ追加** - CSP は実装済みだが X-Frame-Options など不足
8. **GitHub Actions CI ゲート** - npm audit, RLS テスト自動化なし
9. **xlsx → exceljs 移行** - Q4 2026予定

---

## Ⅲ. コードからは確認できず、管理画面で確認が必要な項目

1. **Supabase バックアップ設定**
   - 場所: Supabase Dashboard > Project Settings > Backups
   - 確認項目: 自動バックアップ有無・保持期間・PITR対応

2. **OpenAI データ保持ポリシー**
   - 場所: OpenAI Account Settings > Data Retention Policy
   - 確認項目: API呼び出しのログ記録・保持期限

3. **Vercel ログ保持期間**
   - 場所: Vercel Project > Monitoring > Logs
   - 確認項目: 実行ログ保持期間（デフォルト 3ヶ月）

4. **Resend メール送信ログ**
   - 場所: Resend Dashboard > Emails
   - 確認項目: ログ保持期間、Domain verification

5. **Upstash Redis 設定**
   - 場所: Upstash Console
   - 確認項目: Database settings・Eviction policy・有効期限

6. **セッションタイムアウト設定**
   - Supabase Auth ドキュメント確認
   - 推定: JWT リフレッシュトークンに基づく（明示的なタイムアウト設定なし）

7. **本番環境の環境変数**
   - Vercel Project Settings > Environment Variables
   - 秘密キーが正しく設定されているか確認

---

## Ⅳ. 先方への回答で注意すべき表現

### 1. データの国外送信について
**推奨表現:**
> 「OpenAI API へのコンテキスト送信は必要に応じて行われます。同社は米国拠点のため、データが米国に送信・処理される可能性があります。」

**注記:** プロンプト内に企業の機密戦略・財務情報が含まれるため、明示的な同意取得が必須。

### 2. ログ保持期間について
**推奨表現:**
> 「OpenAI は API呼び出しログを 30日間保持します。Vercel は実行ログを約 3ヶ月間保持します。詳細は各社ダッシュボード（管理画面）で確認できます。」

### 3. バックアップ・復旧について
**推奨表現:**
> 「Supabase での自動バックアップ設定は、管理画面で確認が可能です。PoC 終了時にはデータの完全削除・エクスポート・本運用への移行から選択いただきます。」

### 4. セキュリティ レベルについて
**推奨表現:**
> 「本システムは RLS（Row-Level Security）によりテナント分離を実装しており、PoC 本番環境での適用前に クロステナント拒否テストを実施します。」

**注記:** RLS 本番テスト未実施のため「完全保証」ではなく「実装済みで検証予定」との表現が正確。

### 5. インシデント対応について
**推奨表現:**
> 「重大インシデント時は平日日中の初動対応を目指します。PoC 段階では SLA（サービスレベル契約）はなく、復旧保証なしでの提供となります。本運用移行時に SLO（目標値）を設定します。」

### 6. npm 脆弱性について
**推奨表現:**
> 「42件の既知脆弱性のうち、xlsx（Excel 処理）に Prototype Pollution のリスクがあります。PoC では ファイルサイズ制限（10MB）・タイムアウト（30秒）・アクセス制限（admin のみ）の対策を実装しており、短期的に exceljs への移行を計画しています。」

---

## Ⅴ. 参照したファイル名と該当箇所

### コード・実装
- `app/api/*/route.ts` - OpenAI API 呼び出し実装
- `lib/openai.ts`, `lib/openaiClient.ts` - OpenAI クライアント
- `lib/supabaseAdmin.ts` - Supabase 管理者クライアント
- `middleware.ts` - レート制限・認証チェック
- `lib/rbac.ts` - 権限マトリックス定義
- `lib/authUtils.ts` - JWT 署名検証
- `app/login/LoginClient.tsx` - ログイン UI
- `app/api/invites/*` - 招待機能実装
- `app/api/admin/data-management/delete-all/route.ts` - データ削除 API
- `supabase/migrations/*.sql` - RLS ポリシー・テーブル定義

### ドキュメント
- `docs/spec/08-security-audit-checklist.md` - セキュリティチェックリスト（108項目）
- `docs/security-log/audits/2026-07-08_audit-02-post-remediation.md` - 第2回監査結果
- `docs/poc/customer-guide.md` - PoC 顧客向けガイド v1.0
- `docs/security-log/npm-audit-remaining-20260708.md` - npm 脆弱性分析
- `docs/security-log/poc-security-final-readiness-20260708.md` - PoC 最終準備レポート
- `CLASSIFICATION_POC_FINDINGS.md` - PoC 優先度分類

---

## Ⅵ. 追加確認チェックリスト

### PoC 本番環境展開前（1週間以内）
- [ ] RLS クロステナント拒否テスト実施（会社A → 会社B のデータアクセス全拒否確認）
- [ ] 認証なし API 6本への requireMembership 実装
- [ ] レート制限の実機検証（生成API 10req/分・50/日の動作確認）
- [ ] Excel インポート サイズ制限・検証の動作確認
- [ ] logout 時の localStorage 残存キー確認（なし状態）
- [ ] customer-guide.md 顧客署名取得
- [ ] npm audit 残存脆弱性リスク共有・確認
- [ ] Vercel 本番環境での環境変数設定確認

### 運用開始後（初月以内）
- [ ] 監査ログ（role 変更・invite・delete）の拡張実装
- [ ] セキュリティヘッダ追加（X-Frame-Options 等）
- [ ] インシデント対応フロー初動テスト

### 本運用移行予定（2026-09-01）
- [ ] 正式な利用規約・プライバシーポリシー（法務レビュー済み）
- [ ] NDA・データ処理契約（DPA）テンプレート
- [ ] SLA → SLO 定義（可用性・RTO/RPO）
- [ ] 外部監査合格
- [ ] xlsx → exceljs 移行完了
- [ ] GitHub Actions CI ゲート完全構築（RLS テスト含む）
- [ ] 24/7 インシデント対応体制整備

---

## Ⅶ. まとめ

GROWTHSHIFTのPoC実装調査の結果、以下が確認されました：

### ✅ 実装済み・良好
- Supabase Auth によるメール・パスワード認証
- RLS ベースのテナント分離（12ポリシー実装）
- 招待制（トークンベース、7日有効期限）
- 監査ログ（audit_logs テーブル）
- OpenAI API統合（15+ 生成エンドポイント）
- データ全削除機能（2段階確認、削除検証付き）
- セキュリティドキュメント（108項目チェックリスト、第2回監査実施）

### ⚠️ 要確認・要改善
- **RLS 本番テスト未実施** ← PoC 前に必須
- **認証なし API 6本** ← PoC 前に requireMembership 追加
- **レート制限実装なし** ← PoC 前に検証
- **npm 脆弱性 42件** ← 管理措置実装済み、短期移行計画あり

### ❌ 未実装（本運用移行時）
- MFA（OTP/TOTP）
- OAuth/SAML
- 正式な利用規約・プライバシーポリシー
- SLA/SLO 定義

### 判定
**PoC 提供可否:** ⚠️ **条件付 Go（外部監査との合意が前提）**

**提供前提条件:**
1. RLS クロステナント拒否テスト実施
2. customer-guide.md 顧客署名取得
3. npm 脆弱性リスク認識共有
4. 本番環境 環境変数設定確認

---

**調査実施者:** Claude AI  
**調査実施日:** 2026-07-29  
**報告書作成日:** 2026-07-29  
**確認方法:** コードベース + ドキュメント精査（推測なし）
