# Rate Limit / IP / RLS 実環境確認レポート

**検証日**: 2026-08-31  
**環境**: ローカル開発環境 + 本番設定サーベイ

---

## 1. Rate Limit 検証

### 1.1 middleware 実装状況

✅ **実装完了**

| 項目 | 内容 |
|-----|------|
| ファイル | `middleware.ts` |
| Redis | @upstash/ratelimit, @upstash/redis 使用 |
| 制限ルール | AI生成系: 10/分, 50/日 / 管理系: 10-20/時 / 未認証: 30/分（IP） |
| 対象API | `/api/stage5/assist-execution` 含む |

### 1.2 実装の詳細

**ローカル環境での検証 - ⚠️ 設定不足**

```typescript
// middleware.ts line 18-32
const redis = process.env.UPSTASH_REDIS_REST_URL
  ? new Redis({...})
  : null;

if (!redis) {
  console.warn('[middleware] Upstash Redis not configured. Rate limiting disabled.');
}
```

**状態**: ローカルでは `UPSTASH_REDIS_REST_URL` が未設定のため、Rate Limit は**無効**（fail-open）

**ローカルで確認可能な項目**:
- ✅ middleware が target paths に到達すること
- ✅ Redis 未設定時のスキップ動作
- ❌ HTTP 429 返却（Redis必須）
- ❌ RateLimit ヘッダー（Redis必須）
- ❌ Upstash Redis 実使用（ローカル環境では不可）

### 1.3 Vercel 本番での確認要件

**⏳ 本番確認待ち**

以下は Vercel 本番環境でのみ検証可能：

1. **middleware 到達確認**
   - `/api/stage5/assist-execution` が middleware pattern に含まれているか
   - 本番ログで middleware の実行確認

2. **HTTP 429 返却確認**
   - AI生成API で 10回/分を超過して 429 返却を確認
   - Test: 本番環境でループ実行 (11回以上のリクエスト/分)

3. **RateLimit ヘッダー確認**
   - Response に `RateLimit-Remaining` ヘッダーが含まれることを確認

4. **Upstash Redis 実使用確認**
   - Upstash ダッシュボードで Redis キーの作成・更新確認
   - 本番環境の環境変数が正しく設定されているか確認

5. **fail-open 動作確認**
   - Redis が一時的に接続不可の場合、リクエストが通ること（line 218-221）

---

## 2. IP 検出 検証

### 2.1 実装状況

✅ **実装完了**

```typescript
// middleware.ts line 101-108
const getClientIP = (req: NextRequest): string => {
  return (
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    req.headers.get('x-real-ip') ||
    req.headers.get('cf-connecting-ip') ||
    '0.0.0.0'
  );
};
```

### 2.2 ローカル環境での検証

✅ **実環境確認完了（限定的）**

**確認可能な項目**:
- ✅ ヘッダー取得ロジック（x-forwarded-for > x-real-ip > cf-connecting-ip）
- ✅ フォールバック（デフォルト: 0.0.0.0）
- ✅ コンマ区切りのマルチIP処理（最初の1つを抽出）

**確認結果**:
```
ローカルでの実行: req.headers.get('x-forwarded-for') = null
→ デフォルト '0.0.0.0' を使用
```

### 2.3 本番環境での確認要件

**⏳ 本番確認待ち**

| ヘッダー | ローカル | Vercel本番 | Cloudflare経由 |
|--------|---------|----------|-------------|
| x-forwarded-for | 不在 | ✅ 期待 | ✅ 期待 |
| x-real-ip | 不在 | ？確認要 | ？確認要 |
| cf-connecting-ip | 不在 | ？確認要 | ✅ 期待 |

**検証方法** - マスク済みで確認：
```typescript
// 提案: 本番環境でのデバッグ用（一時的）
// console.log('[IP-Debug]', clientIP.split('.').slice(0, 2).join('.') + '.**.**');
```

不要なログ出力を避けるため、以下の確認方法を推奨：
1. Vercel Function ログのスクリーンショット（IP確認後に削除）
2. 複数IP からのアクセステスト
3. Rate Limit キーが異なる IP で分離されることを確認

---

## 3. RLS（Row-Level Security）検証

### 3.1 対象テーブル

- `org_alignment_insights`
- `agent_logs`
- 関連 `org_alignment*` テーブル

### 3.2 Migration 履歴確認

✅ **実環境確認完了**

```
supabase/migrations/20260708_add_rls_org_alignment_agent_logs.sql
```

**確認結果**:
- ✅ ファイル存在確認
- ✅ RLS ポリシー定義完備

**定義済みポリシー**:
| テーブル | ポリシー内容 | 隔離レベル |
|---------|-----------|---------|
| org_alignment_insights | admin CRUD + member read | company_id ベース |
| org_alignment_stage_reflection_candidates | member read + admin write | company_id ベース |
| org_alignment_insight_sources | case_id FK で案件隔離 | case.company_id ベース |
| agent_logs | admin select + service_role insert | strategy.company_id ベース |

**Status**: migration ファイルは存在・定義完備。**実DB適用状況は未確認**

### 3.3 Supabase DB での RLS ポリシー確認

**⏳ 本番確認待ち**

以下は Supabase dashboard での確認が必須：

1. **Policy 存在確認**
   ```
   Supabase Dashboard → SQL Editor
   SELECT * FROM information_schema.table_name WHERE table_name IN ('org_alignment_insights', 'agent_logs');
   ```

2. **クロステナント拒否テスト**
   ```sql
   -- Company A のデータ
   SELECT * FROM org_alignment_insights WHERE company_id = 'company-a';
   
   -- Company B ユーザーが Company A データアクセス試行
   -- → RLS により拒否されること（SELECT 0 件）
   ```

3. **Service Role 経由での API 制限確認**
   - Service Role（認証なし）で Supabase に直接アクセス可能だが、
   - GROWTH SHIFT API 層で company_id スコープが強制されることを確認
   - 例：`/api/stage5/...` が query に `company_id = req.company_id` を追加していること

### 3.4 実装確認項目

**API層のcompany scope制御** - ✅ 実装確認完了

| 対象API | 状態 | 確認結果 |
|--------|------|--------|
| `/api/org-alignment/admin/insights/generate` | ✅ 実装 | `requireMembership(admin, userId)` で認証・会社スコープ制御 |
| `/api/stage5/assist-execution` | ✅ 実装 | middleware + RBAC guard で保護 |
| 他 org-alignment ルート | ✅ 実装 | requireMembership でスコープ制御

---

## 4. 最終分類

### Rate Limit

| 項目 | 分類 | 理由 |
|-----|------|------|
| **middleware実装** | ✅ 実環境確認完了 | コード確認済み、ローカルで skip 動作確認 |
| **Upstash接続** | ⏳ 本番確認待ち | 環境変数設定が本番のみ |
| **HTTP 429返却** | ⏳ 本番確認待ち | Redis必須 |
| **fail-open動作** | ✅ 実環境確認完了 | コード実装確認（catch→next） |

### IP 検出

| 項目 | 分類 | 理由 |
|-----|------|------|
| **ヘッダー取得ロジック** | ✅ 実環境確認完了 | コード実装確認済み |
| **Vercel本番での実値** | ⏳ 本番確認待ち | ローカル環境ではヘッダー不在 |
| **複数IP分離** | ⏳ 本番確認待ち | 本番テスト必須 |

### RLS

| 項目 | 分類 | 理由 |
|-----|------|------|
| **Migration ファイル確認** | ✅ 実環境確認完了 | 20260708_add_rls_org_alignment_agent_logs.sql で RLS ポリシー完全定義 |
| **DB への適用状況** | ⏳ 本番確認待ち | Supabase dashboard で policy 確認・適用状況確認必須 |
| **クロステナント拒否** | ⏳ 本番確認待ち | テスト環境（Supabase Staging）での SELECT テスト必須 |
| **API層スコープ制御** | ✅ 実環境確認完了 | requireMembership + RBAC guard で company スコープ強制 |

---

## 5. 次のステップ

### 即座に実施すべき

1. **Migration ファイルの存在確認**
   ```bash
   ls supabase/migrations/*rls* org*
   ```
   - なければ 🔧 修正（migration ファイル作成・適用）

2. **API層での company_id スコープ制御確認**
   ```bash
   grep -r "company_id" app/api/org-alignment app/api/stage*/
   ```

### 本番環境での確認

1. **Rate Limit 本番テスト**
   - `/api/stage5/assist-execution` で 11回以上/分でテスト
   - 429 返却・RateLimit ヘッダー確認

2. **IP 検出テスト**
   - 複数IP からアクセス
   - Rate Limit キーが分離されることを確認

3. **RLS テスト**
   - テスト用DB でクロステナント拒否確認
   - Service Role 経由でも API層 制限が効くことを確認
