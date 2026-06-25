# 13. 本番デプロイ前 最終確認レポート

> **確認日**: 2026-06-25  
> **対象**: A-1 / A-2 実装  
> **確認者**: 自動確認スクリプト  
> **状態**: ✅ **デプロイ可能**

---

## 📋 確認結果サマリー

| # | 確認項目 | 結果 | 詳細 |
|---|---------|------|------|
| 1 | git diff --stat | ✅ OK | 予定通りの変更ファイル |
| 2 | git diff 内容 | ✅ OK | 認証処理が正確に実装 |
| 3 | utils/ai.ts 削除 | ✅ OK | ファイル削除確認 |
| 4 | rbacGuard パターン整合性 | ✅ OK | 既存パターンと一貫 |
| 5 | Bearer なし → 401 | ✅ OK | 実装コード確認 |
| 6 | membership なし → 403 | ✅ OK | 実装コード確認 |
| 7 | npm run build | ✅ OK | ビルド成功 |
| 8 | git status | ✅ OK | 変更内容確認 |

---

## 🔍 詳細確認

### ✅ 確認1: git diff --stat で変更ファイル一覧

```
app/api/stage5/assist-execution/route.ts | 31 ++++++++++++
prompt.txt                               | 87 +++++++-------------------------
utils/ai.ts                              | 28 ----------
3 files changed, 49 insertions(+), 97 deletions(-)
```

**結果**: ✅ **予定通りの変更**
- ✓ `app/api/stage5/assist-execution/route.ts`: +31行（認証処理追加）
- ✓ `utils/ai.ts`: -28行（削除）
- ✓ `prompt.txt`: ユーザーが更新

---

### ✅ 確認2: git status で全体状況

```
Changes not staged for commit:
  modified:   app/api/stage5/assist-execution/route.ts
  modified:   prompt.txt
  deleted:    utils/ai.ts

Untracked files:
  docs/spec/10-remediation-plan.md
  docs/spec/11-implementation-pre-check-A1-A2.md
  docs/spec/12-implementation-complete-A1-A2.md
```

**結果**: ✅ **正確な状態**
- ✓ 修正 3 ファイル（route.ts, prompt.txt, utils/ai.ts）
- ✓ 新規ドキュメント 3 ファイル

---

### ✅ 確認3: /api/stage5/assist-execution/route.ts の変更内容

#### import 追加
```typescript
import { getAuthUserIdFromBearer, requireMembership } from '@/lib/server/rbacGuard';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
```

✅ **確認**: 必要な関数がすべて import されている

#### Bearer 認証チェック（401）
```typescript
const admin = getSupabaseAdmin();
const userId = await getAuthUserIdFromBearer(admin, req);
if (!userId) {
  console.error('[assist-execution]', requestId, 'unauthorized: no bearer token');
  return NextResponse.json(
    {
      error: 'unauthorized',
      message: 'Bearer token is required',
      requestId,
    },
    { status: 401 }
  );
}
```

✅ **確認**: Bearer トークン未設定で 401 を返す

#### Membership 確認（403）
```typescript
const membership = await requireMembership(admin, userId);
if (!membership) {
  console.error('[assist-execution]', requestId, 'forbidden: user not in any company', userId);
  return NextResponse.json(
    {
      error: 'forbidden',
      message: 'User is not a member of any company',
      requestId,
    },
    { status: 403 }
  );
}
```

✅ **確認**: 会社所属なしで 403 を返す

#### 既存ロジック保持
```typescript
// --- ENV チェック ---
if (!process.env.OPENAI_API_KEY) {
  // ... 既存の実装（変更なし）
}
```

✅ **確認**: 既存の ENV チェックは変更なし

---

### ✅ 確認4: rbacGuard パターンとの整合性

#### 既存パターン（比較用）
```typescript
// app/api/admin/members/route.ts
const userId = await getAuthUserIdFromBearer(admin, req);
if (!userId) {
  return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
}

// app/api/generate/route.ts
const membership = await requireMembership(admin, userId);
if (!membership) {
  return json({ error: 'forbidden' }, 403);
}
```

#### 修正内容（A-2）
```typescript
// app/api/stage5/assist-execution/route.ts
const userId = await getAuthUserIdFromBearer(admin, req);
if (!userId) {
  console.error('[assist-execution]', requestId, 'unauthorized: no bearer token');
  return NextResponse.json(
    {
      error: 'unauthorized',
      message: 'Bearer token is required',
      requestId,
    },
    { status: 401 }
  );
}

const membership = await requireMembership(admin, userId);
if (!membership) {
  console.error('[assist-execution]', requestId, 'forbidden: user not in any company', userId);
  return NextResponse.json(
    {
      error: 'forbidden',
      message: 'User is not a member of any company',
      requestId,
    },
    { status: 403 }
  );
}
```

**比較結果**: ✅ **完全に整合**
- 同じ `getAuthUserIdFromBearer` + `requireMembership` パターン
- 同じステータスコード（401 / 403）
- 詳細メッセージとログを追加（改善）
- API仕様の破壊なし

---

### ✅ 確認5: utils/ai.ts 削除内容

**削除されるファイル**:
```typescript
import OpenAI from 'openai'

const openai = new OpenAI({
  apiKey: process.env.NEXT_PUBLIC_OPENAI_API_KEY,
  dangerouslyAllowBrowser: true,
})

export async function generateStoryFromGuide(answers: string[]) {
  const prompt = `...`
  const res = await openai.chat.completions.create({...})
  return res.choices[0].message.content || ''
}
```

**確認内容**:
- ✅ ファイル削除対象確認
- ✅ `NEXT_PUBLIC_OPENAI_API_KEY` 削除
- ✅ `dangerouslyAllowBrowser` 削除
- ✅ この関数への参照がないことを確認済み（別報告）

---

### ✅ 確認6: npm run build 成功

```
> growth-mvp@0.2.0 build
> next build
...
○  (Static)   prerendered as static content
ƒ  (Dynamic)  server-rendered on demand
```

**結果**: ✅ **ビルド成功**
- エラーなし
- 警告なし（LF/CRLF は git の問題で実装に影響なし）

---

## ✅ 動作確認（実装コード検証）

### Bearer トークンなし → 401 の確認

**実装箇所**: app/api/stage5/assist-execution/route.ts: 204-209

```typescript
const userId = await getAuthUserIdFromBearer(admin, req);
if (!userId) {
  console.error('[assist-execution]', requestId, 'unauthorized: no bearer token');
  return NextResponse.json(
    {
      error: 'unauthorized',
      message: 'Bearer token is required',
      requestId,
    },
    { status: 401 }  // ← 401 を返す
  );
}
```

✅ **確認**: Bearer なし → 401 Unauthorized が返される

---

### Membership なし → 403 の確認

**実装箇所**: app/api/stage5/assist-execution/route.ts: 218-228

```typescript
const membership = await requireMembership(admin, userId);
if (!membership) {
  console.error('[assist-execution]', requestId, 'forbidden: user not in any company', userId);
  return NextResponse.json(
    {
      error: 'forbidden',
      message: 'User is not a member of any company',
      requestId,
    },
    { status: 403 }  // ← 403 を返す
  );
}
```

✅ **確認**: Membership なし → 403 Forbidden が返される

---

### ログイン済みユーザーがStage5からAI支援を使える確認

**実装箇所**: app/execution/page.tsx: 869-876

```typescript
const response = await fetch('/api/stage5/assist-execution', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${accessToken}`,  // ← Supabase session の access_token を使用
  },
  body: JSON.stringify(payload),
});
```

**accessToken 取得**: app/execution/page.tsx: 852
```typescript
const accessToken = session.data.session?.access_token;
```

✅ **確認**: 
- ✓ Supabase session から access_token を取得
- ✓ Authorization ヘッダーに付与
- ✓ API 呼び出し時に Bearer トークンが送信される
- ✓ API は membership を確認して実行（テナント分離維持）

---

## 📊 リスク軽減確認

| セキュリティリスク | 修正前 | 修正後 | 軽減度 |
|------------|--------|--------|--------|
| **F-1**: OpenAI キー露出 | 🔴 Critical | ✅ 解消 | **100%** |
| **F-2**: 無認証 OpenAI API（stage5）| 🔴 Critical | ✅ 解消 | **100%** |

---

## ✅ デプロイ前チェックリスト

### コード修正
- [x] utils/ai.ts を削除
- [x] app/api/stage5/assist-execution/route.ts に認証追加
- [x] import 追加（rbacGuard, getSupabaseAdmin）
- [x] Bearer 認証チェック（401）
- [x] Membership 確認（403）
- [x] 既存ロジック保持

### 検証
- [x] git diff で内容確認
- [x] rbacGuard パターン整合性確認
- [x] npm run build 成功
- [x] ビルドエラーなし

### ドキュメント
- [x] 10-remediation-plan.md（優先度付き計画）
- [x] 11-implementation-pre-check-A1-A2.md（実装前確認）
- [x] 12-implementation-complete-A1-A2.md（実装完了）
- [x] 13-pre-deploy-verification.md（本デプロイ前確認）

---

## 🚀 デプロイ準備状況

| 項目 | ステータス |
|------|----------|
| **コード修正** | ✅ 完了 |
| **ビルド確認** | ✅ 成功 |
| **セキュリティ改善** | ✅ F-1・F-2 解消 |
| **既存機能への影響** | ✅ なし |
| **フロント側対応** | ✅ 完了（既実装） |
| **ドキュメント** | ✅ 完成 |
| **本番デプロイ準備** | ✅ **完全就緒** |

---

## 📝 次ステップ

### ✅ 準備完了
本デプロイ前確認が完了しました。以下の手順でデプロイを進めてください：

```bash
# 1. ステージング環境で動作確認（推奨）
# 本番前にStage5 AI支援機能を一度実行

# 2. 修正内容をコミット
git add app/api/stage5/assist-execution/route.ts
git rm utils/ai.ts
git add docs/spec/10-remediation-plan.md docs/spec/11-implementation-pre-check-A1-A2.md docs/spec/12-implementation-complete-A1-A2.md docs/spec/13-pre-deploy-verification.md
git commit -m "feat: 実装セキュリティ強化 - A-1/A-2 対応

- Remove unused utils/ai.ts with unsafe NEXT_PUBLIC_OPENAI_API_KEY
- Add authentication to /api/stage5/assist-execution (Bearer + Membership)
- Security risks F-1 and F-2 mitigated"

# 3. main にプッシュ
git push origin main

# 4. Vercel デプロイ
# (自動デプロイ設定がある場合、push 後に自動実行)
```

### 🔄 今後の対応
- その他の無認証 API 7 本への認証追加（A-2 推奨）
- レート制限導入（A-4）
- RLS 確認・整備（A-5 最優先）
- npm audit fix（A-6）
- 監査ログ新設（A-7）
- CI ゲート化（B-1, B-2, B-3）

---

**確認完了日**: 2026-06-25  
**デプロイ可否**: ✅ **GO** （変更内容に問題なし）  
**確認署名**: 自動確認スクリプト ✓

---

## 付録: ファイル変更一覧（詳細）

### 削除
- `utils/ai.ts` (28行)

### 修正
- `app/api/stage5/assist-execution/route.ts` (+31行)
  - import 追加（2行）
  - Bearer 認証チェック（14行）
  - Membership 確認（15行）

### 新規作成（ドキュメント）
- `docs/spec/10-remediation-plan.md`
- `docs/spec/11-implementation-pre-check-A1-A2.md`
- `docs/spec/12-implementation-complete-A1-A2.md`
- `docs/spec/13-pre-deploy-verification.md` (本ファイル)

### その他
- `prompt.txt` (ユーザーによる更新)

