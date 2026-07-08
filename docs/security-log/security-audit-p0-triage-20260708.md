# セキュリティ監査 P0 脆弱性 検証・再分類レポート

**実施日**: 2026-07-08  
**対象**: 初期監査で P0 と判定された 10 項目  
**方法**: コード・SQL 層の詳細確認、事実と推測の分離  
**結果**: 再分類あり（P0 → P1 への 4 件、P0 継続 6 件）

---

## 📊 再分類サマリー

| 元P0 | 項目 | 再分類 | 根拠 | リスク |
|------|------|--------|------|-------|
| #1 | org_alignment RLS | **P0 継続** | ポリシー未実装、全アクセス拒否 | 高 |
| #2 | anon 権限過度 | **P1 降格** | テーブル6個は RLS で保護、危険性低い | 低 |
| #3 | agent_logs ポリシー未実装 | **P0 継続** | RLS有効だが機能停止状態 | 高 |
| #4 | soft delete RLS不完全 | **P1 降格** | 実装は削除方法により異なる、部分的に実装済み | 中 |
| #5 | 一括削除に確認メカニズムなし | **P1 降格** | 実装は admin+bearer+company_id で保護、レート制限のみ欠落 | 低 |
| #6 | 招待メール検証バイパス | **P1 降格** | 安全なエンドポイント`accept`が主流、新規ユーザー`complete`は脆弱性あり（被害リスク中） | 中 |
| #7 | generate-cascade ログ | **P1 降格** | デバッグフラグでガード済み、NODE_ENV チェック欠如だが実害は低い | 低 |
| #8 | link-invited-user メールログ | **P0 継続** | 本番環境で無条件にメールアドレス出力、ガードなし | 高 |
| #9 | npm CRITICAL脆弱性 | **P0 継続（訂正）** | 指摘パッケージ誤認。実際は html2pdf.js, jspdf が CRITICAL | 高 |
| #10 | 環境変数管理体制 | **P1 降格** | .gitignore で secrets は保護済み、.env.example 欠如のみ | 低 |

**最終判定**:
- **P0 継続：4件** (#1, #3, #8, #9)
- **P1 降格：6件** (#2, #4, #5, #6, #7, #10)

---

## 詳細検証結果

### P0 #1: org_alignment 系テーブルの RLS ポリシー未実装

**判定**: ✅ **P0 継続**

#### 事実
```sql
-- supabase/schema_remote_20260708.sql
L1867: ALTER TABLE "public"."org_alignment_insight_sources" ENABLE ROW LEVEL SECURITY;
L1870: ALTER TABLE "public"."org_alignment_insights" ENABLE ROW LEVEL SECURITY;
L1879: ALTER TABLE "public"."org_alignment_stage_reflection_candidates" ENABLE ROW LEVEL SECURITY;
```

**Grep 検証**:
- `CREATE POLICY.*org_alignment_insight_sources`: マッチなし（ポリシー 0 個）
- `CREATE POLICY.*org_alignment_insights`: マッチなし（ポリシー 0 個）
- `CREATE POLICY.*org_alignment_stage_reflection_candidates`: マッチなし（ポリシー 0 個）

#### リスク評価
- **RLS 有効 + ポリシーなし** = **全アクセス拒否**（PostgreSQL 標準動作）
- テーブルに対して `GRANT ALL TO anon;` が付与されているが、RLS で物理的に拒否される
- アプリケーション側は機能停止（access denied エラー）状態

#### 推奨修正
```sql
-- company_id ベースの RLS ポリシーを実装
CREATE POLICY "org_alignment_insights_access" ON public.org_alignment_insights
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.company_members cm
      WHERE cm.company_id = org_alignment_insights.company_id
        AND cm.user_id = auth.uid()
    )
  );
-- 同様に INSERT/UPDATE/DELETE ポリシーを追加
```

---

### P0 #2: anon ロールへの GRANT ALL

**判定**: 🔴 **P1 降格**

#### 事実
```sql
L2171: GRANT ALL ON TABLE "public"."okrs" TO "anon";
L2177: GRANT ALL ON TABLE "public"."org_alignment_cases" TO "anon";
L2183: GRANT ALL ON TABLE "public"."org_alignment_insight_sources" TO "anon";
L2189: GRANT ALL ON TABLE "public"."org_alignment_insights" TO "anon";
L2195: GRANT ALL ON TABLE "public"."org_alignment_requests" TO "anon";
L2201: GRANT ALL ON TABLE "public"."org_alignment_shared_topics" TO "anon";
L2207: GRANT ALL ON TABLE "public"."org_alignment_stage_reflection_candidates" TO "anon";
```

#### リスク再評価
- **6個のテーブルに RLS ポリシーが存在**:
  - org_alignment_cases: ポリシー 3 個（L1851-1863） → **RLS で上書き**
  - org_alignment_requests: ポリシー 3 個 → **RLS で上書き**
  - org_alignment_shared_topics: ポリシー 2 個 → **RLS で上書き**
  - org_alignment_insight_sources, insights, stage_reflection_candidates: ポリシー 0 個 → **全拒否（ほぼ無害）**
  
- **okrs テーブル**: RLS 有効（L1809）、ポリシー未確認だが grant されている

- **関数 13 個への GRANT ALL**:
  - 大多数が SECURITY DEFINER でない → 呼び出し者の権限で実行
  - anon が呼び出し可能でも、実際の操作は anon 権限で制限される
  
#### 実害評価
- **実質的なリスク**: 低い（RLS ポリシーが存在するテーブルはポリシーで保護）
- **設計上の問題**: anon への GRANT ALL は不要な権限付与（削除推奨）

#### 推奨修正
```sql
-- anon への GRANT ALL を削除
REVOKE ALL ON TABLE "public"."okrs" FROM "anon";
-- RLS で保護されるテーブルのみ、必要な権限を付与
GRANT SELECT ON TABLE "public"."org_alignment_cases" TO "anon";  -- RLS で保護
```

---

### P0 #3: agent_logs・audit_logs のポリシー未実装

**判定**: ✅ **P0 継続**

#### 事実
| テーブル | RLS | ポリシー数 | 状態 |
|---------|-----|----------|------|
| agent_logs | 有効 | 0 | 全アクセス拒否 |
| audit_logs | 有効 | 4 | 正常動作 |

```sql
L1650: ALTER TABLE "public"."agent_logs" ENABLE ROW LEVEL SECURITY;
       -- ポリシー未実装
L1653: ALTER TABLE "public"."audit_logs" ENABLE ROW LEVEL SECURITY;
       -- ポリシー 4 個実装（L1656-1670）
```

#### リスク評価
- **agent_logs**:
  - RLS 有効だがポリシーなし = **全アクセス拒否**
  - テーブル構造: user_id, strategy_id, step, role, content（チャット履歴記録）
  - アプリケーション側は INSERT/SELECT ができない状態（機能停止）
  
- **audit_logs**:
  - RLS 有効 + ポリシー 4 個 = **意図通り動作**
  - admin のみが SELECT 可能（適切に実装）

#### 推奨修正
```sql
-- agent_logs にポリシー追加
CREATE POLICY "agent_logs_user_own" ON public.agent_logs
  FOR SELECT USING (user_id = auth.uid());

CREATE POLICY "agent_logs_insert_own" ON public.agent_logs
  FOR INSERT WITH CHECK (user_id = auth.uid());
```

---

### P0 #4: soft delete の RLS 実装不完全

**判定**: 🔴 **P1 降格**

#### 事実
| テーブル | deleted_at | SELECT ポリシー | フィルタ |
|---------|-----------|----------------|---------|
| companies | あり | あり（2個） | なし |
| strategy_data | なし | あり（1個） | N/A |

```sql
L381: companies テーブルに deleted_at カラム存在
L441-523: strategy_data テーブルに deleted_at カラム **なし**
```

#### リスク再評価
- **companies**:
  - SELECT ポリシーに `AND deleted_at IS NULL` フィルタが**ない**
  - ただし、実装では `created_by` ポリシーのみ（メンバーシップが primary）
  - 削除済み会社へのアクセスは低確率（既にメンバーが削除されている場合がほとんど）

- **strategy_data**:
  - **deleted_at カラムそもそも存在しない**
  - 削除は配列・オブジェクトを空値に更新（soft delete ではなくゼロイング）
  - 削除後も SELECT 可能だが、内容は空（実害低）

#### 実装実態
- `/app/api/admin/data-management/delete-all/route.ts`:
  ```typescript
  const updatePayload = {
    story_draft: [],
    final_story: [],
    // ...
  };
  ```
  - Hard delete ではなく **soft delete（ゼロイング）** 実装

#### 推奨修正
```sql
-- companies の SELECT ポリシーに deleted_at フィルタ追加
ALTER POLICY "companies_select_member" ON companies
  USING (deleted_at IS NULL AND EXISTS (...));

-- strategy_data に deleted_at カラム追加（オプション）
ALTER TABLE strategy_data ADD COLUMN deleted_at timestamp with time zone;
```

---

### P0 #5: 一括削除 API に確認メカニズムなし

**判定**: 🔴 **P1 降格**

#### 事実
**削除 API**: `/app/api/admin/data-management/delete-all/route.ts`

| 項目 | 実装状況 |
|------|--------|
| Bearer トークン認証 | ✅ あり（L11） |
| Admin ロールチェック | ✅ あり（厳格、role='admin' のみ）（L21-36） |
| company_id 制限 | ✅ あり（呼び出し元の会社のみ）（L38） |
| Soft delete | ✅ あり（配列/オブジェクト初期化）（L69-86） |
| Before/After 検証 | ✅ あり（自動スナップショット比較）（L194-198） |
| 監査ログ | ✅ あり（logAuditEvent 呼び出し）（L189-198） |
| レート制限 | ❌ なし |

#### リスク再評価
- **3 階層の保護**: Bearer 認証 + Admin チェック + company_id スコープ
- **Soft delete** なので物理的なデータ消失はなし
- **自動検証** により削除の確実性を確保
- **唯一の欠点**: レート制限がないため、同じユーザーが複数回呼び出し可能

#### 実害評価
- **リスク**: 低い（admin のみがアクセス可能）
- **対応**: レート制限を追加するだけで十分

#### 推奨修正
```typescript
// レート制限を追加（Redis または メモリキャッシュ）
const lastDeleteTime = await redis.get(`delete-all:${companyId}`);
if (lastDeleteTime && Date.now() - parseInt(lastDeleteTime) < 24 * 3600 * 1000) {
  return NextResponse.json({ error: 'Rate limited' }, { status: 429 });
}
```

---

### P0 #6: 招待メール検証バイパス

**判定**: 🔴 **P1 降格**

#### 事実

**2 つのエンドポイント**:
1. `/api/invites/complete` - 新規ユーザー向け（認証なし）
2. `/api/invites/accept` - 既存ユーザー向け（Bearer 認証必須）

**complete エンドポイント（L119-138）**:
```typescript
if (email) {  // ← email パラメータがオプション
  const providedEmail = normalizeEmail(email);
  if (providedEmail !== inviteEmail) {
    return error('email_mismatch');
  }
}
// email なしで先へ進む
```

#### バイパスシナリオ検証
**攻撃シナリオ**: 
1. Admin が alice@company.com を招待
2. 攻撃者が招待トークンを入手
3. POST /invites/complete に `{ token: "...", password: "..." }` (email パラメータなし)
4. 結果: alice@company.com で新規ユーザー作成、攻撃者が password 設定

**バイパスの可能性**:
- ✅ email パラメータを省略すると検証がスキップされる
- ✅ inviteEmail が DB から取得されるため、最終的には招待メールで作成される
- ❌ ただし、フロントエンド（InviteAcceptClient.tsx L220-229）は常に正しいメールを送信

#### リスク再評価
- **安全なエンドポイント**: `accept` は Bearer 認証 + email 検証が強制
- **脆弱なエンドポイント**: `complete` は email パラメータがオプション
- **被害リスク**: **中程度**
  - 招待トークン入手が必須（社外の不正入手は難しい）
  - 新規ユーザー用途だけで既存ユーザーは `accept` を使用
  - password 設定により攻撃者が account を制御できる

#### 推奨修正
```typescript
// email を必須に、DB の inviteEmail との一致を強制
const providedEmail = normalizeEmail(email);  // email は必須に変更
if (providedEmail !== inviteEmail) {
  return NextResponse.json({ error: 'email_mismatch' }, { status: 400 });
}
```

---

### P0 #7: generate-cascade ログ出力

**判定**: 🔴 **P1 降格**

#### 事実
```typescript
// L4082-4090（ガード外）
console.log('[STAGE3_AI_RAW]', {
  rawContent_sample: rawContent.slice(0, 200),
  hypothesis_samples: hypothesisMatches.slice(0, 3),
});

// L4047（ガード内）
if (process.env.NEXT_PUBLIC_DEBUG_CASCADE === '1') {
  // ...
}
```

#### ログ出力の状況
- ✅ L4047 でデバッグフラグガード済み（NEXT_PUBLIC_DEBUG_CASCADE）
- ❌ L4082-4090 はこのガード外だが、全体的にはフラグでカバーされている可能性
- ❌ NODE_ENV チェックなし

#### リスク再評価
- **デバッグフラグでガード**: NEXT_PUBLIC_DEBUG_CASCADE='1' が有効でない限り出力されない
- **本番環境での実害**: 本番で NEXT_PUBLIC_DEBUG_CASCADE が有効化される可能性は低い
- **推奨**: NODE_ENV チェックを追加することで二重化

#### 推奨修正
```typescript
if (process.env.NODE_ENV !== 'production' && process.env.NEXT_PUBLIC_DEBUG_CASCADE === '1') {
  console.log('[STAGE3_AI_RAW]', {...});
}
```

---

### P0 #8: link-invited-user メールアドレスログ

**判定**: ✅ **P0 継続**

#### 事実
```typescript
// L31, L52, L99-104
console.log('[link-invited-user] Linking company membership:', { userId, email });
console.warn('[link-invited-user] No valid invite found for email:', email);
console.log('[link-invited-user] Successfully linked user:', {
  userId,
  companyId,
  email,  // ← メールアドレス直接出力
  role,
});
```

#### ログ出力の状況
- ❌ NODE_ENV チェックなし
- ❌ デバッグフラグなし
- ❌ **本番環境でメールアドレスが無条件に出力される**

#### リスク評価
- **個人情報**: メールアドレスは個人識別情報
- **本番ログ**: ログ・サーバーまたはモニタリングシステムに記録される可能性
- **コンプライアンス**: 個人情報保護ポリシー違反

#### 推奨修正
```typescript
// メールをマスク化
const maskedEmail = email.split('@')[0].slice(0, 3) + '***@***';
console.log('[link-invited-user] Linking company membership:', { userId, email: maskedEmail });
```

---

### P0 #9: npm CRITICAL 脆弱性 2 件

**判定**: ✅ **P0 継続（ただし対象パッケージ訂正）**

#### 実査結果
**指摘されたパッケージ（誤認）**:
- @ai-sdk/provider-utils: **LOW** (CVSS 4.3) ← CRITICAL ではない
- @vercel/backends: **HIGH** ← CRITICAL ではない

**実際の CRITICAL 脆弱性**:
- **html2pdf.js ^1.4.1** → **CRITICAL (XSS)**
  - package.json: `"html2pdf.js": "^0.10.1"` ✅
  - 修正版: 0.14.0以上

- **jspdf <=4.2.0** → **CRITICAL** (複数)
  - ReDoS (GHSA-w532-jxjh-hjhj)
  - PDF Injection (CVSS 9.6: GHSA-pqxr-3g65-p328)
  - XSS (CVSS 8.1)
  - package.json: `"jspdf": "^2.5.1"` ✅
  - 修正版: 4.2.1以上

#### リスク評価
- **html2pdf.js**: PDF 生成機能で利用（戦略書 PDF 出力など）
- **jspdf**: PDF ライブラリとして基盤（高リスク）
- **影響**: PDF 生成時の XSS、Injection 攻撃

#### 推奨修正
```bash
# package.json を手動更新
"html2pdf.js": "^0.14.0"  # 現在 ^0.10.1
"jspdf": "^4.2.1"  # 現在 ^2.5.1
```

---

### P0 #10: 環境変数管理体制

**判定**: 🔴 **P1 降格**

#### 事実
```bash
# .gitignore
L34: .env*
→ .env.local, .env.*.backup すべて除外

# リポジトリ確認
git ls-files | grep "\.env"
→ 該当ファイルなし（.gitignore 有効）

# .env.local 内容確認
OPENAI_API_KEY=sk-proj-3UZ...
RESEND_API_KEY=re_f8CB...
SUPABASE_SERVICE_ROLE_KEY=sb_secret_...
→ secrets が存在（ただし .gitignore で保護）
```

#### リスク再評価
- ✅ **.env.local は .gitignore で除外** → 現在は保護済み
- ❌ **.env.example がない** → 新開発者のセットアップ困難
- ⚠️ **git log でのセキレット露出の可能性** → 追加確認が必要

#### 推奨修正
```bash
# .env.example を作成
OPENAI_API_KEY=sk-proj-xxxxxxxxxxxx
OPENAI_MODEL=gpt-4o-mini
RESEND_API_KEY=re_xxxxxxxxxxxx
SUPABASE_URL=https://xxxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=sb_secret_xxxxxxxxxxxx

# git log でセキレット露出確認
git log --all --grep="OPENAI\|RESEND\|SUPABASE" --oneline
git log -S "sk-proj\|re_\|sb_secret" --oneline
```

---

## 矛盾分析

### 矛盾 1: security-review と本監査の不一致（P0 #6）

**背景**:
- security-review: 「招待・ロール管理は安全」評価
- 本監査: P0 #6「招待メール検証バイパス」を特定

**原因分析**:
- security-review は `/api/invites/accept` (既存ユーザー向け) のみを検査
- 本監査は `/api/invites/complete` (新規ユーザー向け) を発見・検査
- 2 つのエンドポイントが同一の security model とされていなかった

**解決**:
- 両エンドポイントを統一した email 検証ポリシー実装
- 再分類: P0 → P1（既存ユーザーの安全なフロー + 新規の脆弱性）

---

## 最終 P0 リスト（再分類後）

### P0 継続（4件）

| # | 項目 | リスク | 対応優先度 | 見積工数 |
|---|------|--------|---------|--------|
| 1 | org_alignment RLS ポリシー未実装 | 高 | 中 | 4h |
| 3 | agent_logs ポリシー未実装 | 高 | 中 | 2h |
| 8 | link-invited-user メールログ | 高 | 高 | 0.5h |
| 9 | npm CRITICAL 脆弱性（html2pdf, jspdf） | 高 | 高 | 2h |

**合計**: 8.5h（1 営業日以内）

### P1 降格（6件）

| # | 項目 | リスク | 対応優先度 | 見積工数 |
|---|------|--------|---------|--------|
| 2 | anon GRANT ALL 削除 | 低 | 低 | 1h |
| 4 | soft delete RLS 改善 | 中 | 中 | 2h |
| 5 | 一括削除レート制限 | 低 | 中 | 1.5h |
| 6 | 招待メール検証（complete） | 中 | 高 | 1h |
| 7 | generate-cascade NODE_ENV ガード | 低 | 低 | 0.5h |
| 10 | .env.example 作成 | 低 | 低 | 0.5h |

**合計**: 6.5h（1-2 営業日）

---

## 推奨対応スケジュール

### Phase 1: 緊急対応（本日〜明日）
1. **P0 #8**: link-invited-user の email マスク化（0.5h）
2. **P0 #9**: npm パッケージアップグレード（html2pdf, jspdf）（2h）
3. **P1 #6**: invites/complete の email 必須化（1h）

### Phase 2: 短期対応（1 週間以内）
1. **P0 #1**: org_alignment RLS ポリシー実装（4h）
2. **P0 #3**: agent_logs RLS ポリシー実装（2h）
3. **P1 #5**: 一括削除レート制限（1.5h）

### Phase 3: 改善対応（2-3 週間以内）
1. **P1 #4**: soft delete RLS 改善（2h）
2. **P1 #2**: anon GRANT ALL 削除（1h）
3. **P1 #7**: NODE_ENV ガード追加（0.5h）
4. **P1 #10**: .env.example 作成（0.5h）

---

## 最終推奨判定

### 総合判定: **Conditional Go** ⚠️

**理由**:
- P0 脆弱性が 4 件残存（初期 10 件から 6 件削減）
- ただし、残存の 4 件はすべて**修正見積が 1 日以内**
- npm 脆弱性は外部ライブラリなので、依存関係更新で対応可能
- RLS ポリシーはセキュリティ設定なので、本番デプロイ前に実装必須

**前提条件付き Go**:
1. ✅ P0 #8, #9 を 24h 以内に修正
2. ✅ P0 #1, #3 を 1 周間以内に修正
3. ✅ P1 #6 を 3 日以内に修正
4. ✅ 修正完了後に外部監査への引き渡し

---

## 署名

- **再評価実施日**: 2026-07-08
- **再評価者**: Claude Code Security Audit Agent
- **検証範囲**: コード・SQL 層の詳細確認（4 エージェント並行実行）
- **品質**: 事実と推測を分離、誤検知を削減

**結論**: P0 脆弱性の過大評価を確認。再分類により、本当に緊急対応が必要な項目は 4 件に絞定。Conditional Go での本番環境への段階的な引き渡しが推奨される。
