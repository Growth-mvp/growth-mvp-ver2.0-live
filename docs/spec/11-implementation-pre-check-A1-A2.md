# 11. 実装前確認レポート（A-1 / A-2）

> **対象**: growth-mvp v0.2.0  
> **実装内容**: A-1（OpenAI キー削除）、A-2（無認証 API 認証化）  
> **作成日**: 2026-06-25  
> **状態**: 実装前調査完了 → コード修正前確認ドキュメント

---

## 📋 実装対象のサマリー

| 項目 | 対象 | リスク | 優先度 |
|------|------|--------|--------|
| **A-1** | `utils/ai.ts` の削除 + `NEXT_PUBLIC_OPENAI_API_KEY` 参照排除 | 🔴 Critical | 1st |
| **A-2** | 無認証 API 8 本に Bearer 認証 + membership 検証を追加 | 🔴 Critical (1本) / 🟡 Medium (7本) | 2nd |

---

## 1. A-1: OpenAI API キーのクライアント露出リスク排除

### 1.1 対象ファイル一覧

| # | ファイルパス | 行番号 | 内容 | 削除/修正 |
|---|------------|--------|------|----------|
| 1 | `utils/ai.ts` | 1-29 | OpenAI クライアント初期化 + `generateStoryFromGuide()` | **削除** |
| 2 | `utils/ai.ts:4` | 4 | `process.env.NEXT_PUBLIC_OPENAI_API_KEY` | **削除** |
| 3 | `utils/ai.ts:5` | 5 | `dangerouslyAllowBrowser: true` | **削除** |

### 1.2 現在の危険性分析

#### 問題1: ブラウザで NEXT_PUBLIC キーを使用
```typescript
// utils/ai.ts:3-6
const openai = new OpenAI({
  apiKey: process.env.NEXT_PUBLIC_OPENAI_API_KEY,  // ← 危険
  dangerouslyAllowBrowser: true,                    // ← 明示的に許可
})
```

**リスク:**
- `NEXT_PUBLIC_` で始まる環境変数は、Next.js がブラウザバンドルに埋め込む
- `dangerouslyAllowBrowser: true` で、ブラウザ実行を明示的に許可
- **実装例**: `utils/ai.ts` を 1 行 import するだけで OpenAI キーがバンドルに埋め込まれ、ブラウザで誰でも抽出可能

#### 問題2: デッドコードの危険性
```bash
$ grep -r "from.*utils/ai\|from.*'@/utils/ai" app lib components --include="*.ts" --include="*.tsx"
# → 結果: 0 件（参照元なし）
```

**現状:**
- `utils/ai.ts` は**どの関数からも import されていない**
- 不使用のコード（デッドコード）だが、存在するだけで脆弱性のリスク
- 将来、誰かが `generateStoryFromGuide()` を import する可能性あり

#### 問題3: 環境変数の設定状況
```bash
# .env.local / .env.production の確認
OPENAI_API_KEY=sk-proj-...          # ✅ 存在（サーバ側・安全）
NEXT_PUBLIC_OPENAI_API_KEY=         # ❌ 未定義（危険な設定だけが残されている）
```

**分析:**
- `.env.local` に `NEXT_PUBLIC_OPENAI_API_KEY` は定義されていない
- つまり、現時点では `process.env.NEXT_PUBLIC_OPENAI_API_KEY` は `undefined`
- しかし、設定ファイルにキーが追加される可能性が高い（チェックの必要性あり）

### 1.3 修正方針

#### ステップ 1: 参照元の完全確認（grep）

```bash
# 削除前の最終確認
grep -rn "NEXT_PUBLIC_OPENAI_API_KEY" app lib components utils --include="*.ts" --include="*.tsx"
grep -rn "dangerouslyAllowBrowser" app lib components utils --include="*.ts" --include="*.tsx"
grep -rn "utils/ai" app lib components --include="*.ts" --include="*.tsx"
grep -rn "@/utils/ai" app lib components --include="*.ts" --include="*.tsx"
```

**期待値**: すべて 0 件（参照なし）

#### ステップ 2: ファイル削除

```bash
rm utils/ai.ts
```

#### ステップ 3: Vercel 環境変数の確認・削除

Vercel ダッシュボード → Settings → Environment Variables:
- [ ] `NEXT_PUBLIC_OPENAI_API_KEY` が設定されていないことを確認
- [ ] 設定されていれば、**削除する**
- [ ] `OPENAI_API_KEY`（サーバ側） のみ存在することを確認

#### ステップ 4: CI ゲートの追加（将来）

プッシュ時に自動チェック：
```bash
# grep ゲート: NEXT_PUBLIC_* に KEY/SECRET/TOKEN を禁止
grep -r "NEXT_PUBLIC_.*KEY\|NEXT_PUBLIC_.*SECRET\|NEXT_PUBLIC_.*TOKEN" . --include="*.ts" --include="*.tsx"
# → 0 件で成功
```

### 1.4 修正後の確認コマンド

```bash
# 確認1: utils/ai.ts が削除されたか
test ! -f utils/ai.ts && echo "✅ utils/ai.ts 削除完了" || echo "❌ utils/ai.ts が残っている"

# 確認2: NEXT_PUBLIC_OPENAI 参照が完全に消えたか
grep -r "NEXT_PUBLIC_OPENAI" app lib components utils --include="*.ts" --include="*.tsx" 2>/dev/null && echo "❌ NEXT_PUBLIC_OPENAI 参照あり" || echo "✅ 参照なし"

# 確認3: dangerouslyAllowBrowser 参照が完全に消えたか
grep -r "dangerouslyAllowBrowser" app lib components utils --include="*.ts" --include="*.tsx" 2>/dev/null && echo "❌ dangerouslyAllowBrowser 参照あり" || echo "✅ 参照なし"

# 確認4: ビルド成功
next build

# 確認5: 関連テスト（生成系 API）が動作すること
# → /api/stage5/assist-execution, その他生成系 API の動作確認
```

### 1.5 影響範囲分析

**削除の影響**:
- ❌ `utils/ai.ts` → 未使用（参照元なし）
- ✅ 他のコード → 影響なし

**サーバ側の OpenAI 実装**:
- ✅ `lib/openai.ts` → `process.env.OPENAI_API_KEY` で安全に実装
- ✅ `lib/openaiClient.ts` → `process.env.OPENAI_API_KEY` で安全に実装

**結論**: **修正による既存機能への影響なし**

---

## 2. A-2: 無認証で OpenAI を呼べる API の認証必須化

### 2.1 対象 API 一覧（8 本）

| # | API パス | 現在の実装 | OpenAI呼び出し | 認証チェック | 修正必要性 |
|---|---------|----------|------------|-----------|----------|
| 1 | `/api/generate-question` | テンプレート返却 | ❌ なし | ❌ なし | 🟡 推奨 |
| 2 | `/api/generate-insight` | ビジネスロジック | ❌ なし | ❌ なし | 🟡 推奨 |
| 3 | `/api/generate-department-summary` | 廃止 (410 Gone) | ❌ なし | ❌ なし | ⏸️ スキップ |
| 4 | `/api/okr-from-exec` | テンプレート返却 | ❌ なし | ❌ なし | 🟡 推奨 |
| 5 | `/api/recommend-top-patterns` | ルールベース | ❌ なし | ❌ なし | 🟡 推奨 |
| 6 | `/api/recommend-exec-patterns` | ルールベース | ❌ なし | ❌ なし | 🟡 推奨 |
| 7 | `/api/stage5/assist-execution` | OpenAI 呼び出し | ✅ **あり** | ❌ **なし** | 🔴 **必須** |
| 8 | `/api/knowledge` | メモリストア | ❌ なし | ❌ なし | 🟡 推奨 |

### 2.2 最優先: `/api/stage5/assist-execution` の詳細

#### ファイル位置
```
app/api/stage5/assist-execution/route.ts
```

#### 現在の実装（抜粋）

```typescript
// 行 200-211: 認証チェック（ENV のみ）
if (!process.env.OPENAI_API_KEY) {
  return NextResponse.json({ error: 'missing_env' }, { status: 500 });
}

// 行 250-258: OpenAI 呼び出し（誰でも実行可能）
const completion = await openai.chat.completions.create({
  model: 'gpt-4o',
  temperature: 0.3,
  response_format: { type: 'json_object' },
  messages: [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt },  // ← ユーザー入力
  ],
});
```

#### リスク分析

| リスク | 内容 | 重大度 |
|--------|------|--------|
| **認証なし** | 誰でも API をリクエスト可能 | 🔴 Critical |
| **会社スコープなし** | どの会社のデータかが不明 | 🔴 Critical |
| **ユーザー入力検証** | memo がそのまま OpenAI に送信される | 🟡 Medium |
| **API 利用コスト** | 匿名ユーザーが OpenAI API 利用可能 → コスト爆発 | 🔴 Critical |

#### 修正コード案

```typescript
// /app/api/stage5/assist-execution/route.ts (先頭に追加)

import { getAuthUserIdFromBearer, requireMembership } from '@/lib/server/rbacGuard';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';

export async function POST(req: Request) {
  // ★★★ 追加: Bearer 認証 ★★★
  const admin = getSupabaseAdmin();
  const userId = await getAuthUserIdFromBearer(admin, req);
  if (!userId) {
    return NextResponse.json(
      { error: 'unauthorized', message: 'Bearer token required' },
      { status: 401 }
    );
  }

  // ★★★ 追加: Membership 確認（会社スコープ） ★★★
  const membership = await requireMembership(admin, userId);
  if (!membership) {
    return NextResponse.json(
      { error: 'forbidden', message: 'Not a member of any company' },
      { status: 403 }
    );
  }

  // ★ 既存のロジック（ENV チェック） ★
  if (!process.env.OPENAI_API_KEY) {
    return NextResponse.json({ error: 'missing_env' }, { status: 500 });
  }

  // ... 以下、既存の実装のまま
  const body = await readJsonSafe(req);
  const { memo, progress_items, context } = body ?? {};
  
  // memo の簡易検証（オプション）
  if (typeof memo !== 'string' || memo.length === 0) {
    return NextResponse.json({ error: 'invalid_memo' }, { status: 400 });
  }

  // ... OpenAI 呼び出し
  const completion = await openai.chat.completions.create({
    model: 'gpt-4o',
    temperature: 0.3,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
  });

  // ... 既존 응답 로직
}
```

### 2.3 推奨: その他 API の認証追加（7 本）

#### 共通の修正パターン

各 API の `export async function POST(req: Request)` の**先頭**に以下を追加:

```typescript
import { getAuthUserIdFromBearer, requireMembership } from '@/lib/server/rbacGuard';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';

// ... 

export async function POST(req: Request) {
  // ★★★ 追加: Bearer 認証 & Membership ★★★
  const admin = getSupabaseAdmin();
  const userId = await getAuthUserIdFromBearer(admin, req);
  if (!userId) {
    return NextResponse.json(
      { error: 'unauthorized', message: 'Bearer token required' },
      { status: 401 }
    );
  }

  const membership = await requireMembership(admin, userId);
  if (!membership) {
    return NextResponse.json(
      { error: 'forbidden', message: 'Not a member of any company' },
      { status: 403 }
    );
  }

  // ★ 既存のロジック（以下のコードは変更なし） ★
  // ...
}
```

#### 対象ファイル一覧

| # | ファイルパス | 修正内容 |
|---|------------|---------|
| 1 | `app/api/generate-question/route.ts` | 認証追加 |
| 2 | `app/api/generate-insight/route.ts` | 認証追加 |
| 4 | `app/api/okr-from-exec/route.ts` | 認証追加 |
| 5 | `app/api/recommend-top-patterns/route.ts` | 認証追加 |
| 6 | `app/api/recommend-exec-patterns/route.ts` | 認証追加 |
| 8 | `app/api/knowledge/route.ts` | 認証追加（GET/POST 両方） |

#### スキップ
- `app/api/generate-department-summary/route.ts` → 廃止済み（410 Gone）

### 2.4 既存の rbacGuard / getAuthUserIdFromBearer / requireMembership の使われ方

#### 関数定義: `lib/server/rbacGuard.ts`

| 関数 | 役割 | 戻り値 |
|------|------|--------|
| `getAuthUserIdFromBearer(admin, req)` | Bearer token から userId を抽出・検証 | `userId (string) \| null` |
| `requireMembership(admin, userId, companyId?)` | ユーザーの company_id / role / departmentId を取得 | `Membership \| null` |
| `assertCapability(membership, action, {targetDeptId})` | アクション実行権限を強制 | void (失敗時 throw) |
| `assertMinRole(membership, minRole)` | 最低ロール（admin等）を要求 | void |

#### 使用例1: `/api/admin/members/invite` (Bearer + admin)

```typescript
// 行 36: Bearer 認証
const callerId = await getAuthUserIdFromBearer(admin, req);
if (!callerId) {
  return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
}

// 行 82-88: admin ロール確認（手動実装）
const { data: membership, error: memErr } = await admin
  .from('company_members')
  .select('company_id, role')
  .eq('user_id', callerId)
  .eq('role', 'admin')
  .limit(1)
  .maybeSingle();

if (memErr || !membership?.company_id) {
  return NextResponse.json({ error: 'admin_only' }, { status: 403 });
}
```

**パターン**: ✅ Bearer + 権限確認（インライン実装）

#### 使用例2: `/api/generate` (Bearer + Membership)

```typescript
// 行 73: Bearer 認証
const userId = await getAuthUserIdFromBearer(admin, req);
if (!userId) {
  return json({ error: 'unauthorized' }, 401);
}

// 行 77: Membership 確認
const membership = await requireMembership(admin, userId);
if (!membership) {
  return json({ error: 'forbidden' }, 403);
}

// ... 既存のロジック
```

**パターン**: ✅ Bearer + `requireMembership()` を使用（推奨）

#### 使用例3: `/api/org-alignment/generate` (Bearer + Membership + Capability)

```typescript
const userId = await getAuthUserIdFromBearer(admin, req);
if (!userId) {
  return json({ error: 'unauthorized' }, 401);
}

const membership = await requireMembership(admin, userId);
if (!membership) {
  return json({ error: 'forbidden' }, 403);
}

assertCapability(membership, 'agent:use', {});  // capability 強制
// ...
```

**パターン**: ✅ Bearer + `requireMembership()` + `assertCapability()` を使用（完全）

### 2.5 修正後の確認コマンド

#### 確認1: API が Bearer トークンなしで 401 を返すか

```bash
# /api/stage5/assist-execution (Bearer なし)
curl -X POST https://localhost:3000/api/stage5/assist-execution \
  -H "Content-Type: application/json" \
  -d '{"memo":"test"}' \
  -w "\nStatus: %{http_code}\n"
# 期待値: 401 Unauthorized
```

#### 確認2: 有効な Bearer トークンで 200/400 が返るか（テスト トークン生成必要）

```bash
# ポストマン / テストスクリプト で、有効な Bearer トークンを使用
curl -X POST https://localhost:3000/api/stage5/assist-execution \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <valid-token>" \
  -d '{"memo":"test progress"}' \
  -w "\nStatus: %{http_code}\n"
# 期待値: 200 OK または 400 Bad Request (リクエスト内容による)
```

#### 確認3: 全 8 本の API が認証をチェックしているか

```bash
# grep で全 API の認証チェック状況を確認
grep -n "getAuthUserIdFromBearer\|requireMembership" \
  app/api/generate-question/route.ts \
  app/api/generate-insight/route.ts \
  app/api/okr-from-exec/route.ts \
  app/api/recommend-top-patterns/route.ts \
  app/api/recommend-exec-patterns/route.ts \
  app/api/stage5/assist-execution/route.ts \
  app/api/knowledge/route.ts

# 期待値: 各ファイルで getAuthUserIdFromBearer と requireMembership が見つかる
```

#### 確認4: ビルド成功

```bash
npm run build
# または
next build

# 期待値: build successful (型エラー・Lint エラーなし)
```

#### 確認5: フロント側の Bearer トークン付与確認

フロント側が API リクエストを送信する際に Bearer トークンを付与しているか:

```typescript
// 修正例: フロント側の API クライアント
const response = await fetch('/api/stage5/assist-execution', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${userToken}`,  // ← 必須
  },
  body: JSON.stringify({ memo, progress_items, context }),
});
```

---

## 3. 修正すると影響が出そうな画面・機能

### 3.1 A-1: `utils/ai.ts` 削除の影響

**影響なし** → 未使用ファイル

### 3.2 A-2: 認証追加の影響

#### 影響あり: Stage 5（実行支援）

| 画面 | ファイル | 影響 | 対応 |
|------|---------|------|------|
| Stage 5 実行パネル | `app/execution/page.tsx` | `/api/stage5/assist-execution` に Bearer トークンを付与する必要がある | フロント側でクライアント実装確認・修正 |
| 実行支援 AI | `app/execution/ExecutionPanel.tsx` (想定) | API 呼び出し時に `Authorization: Bearer <token>` を付与 | フロント側でクライアント実装確認・修正 |

#### フロント側の修正確認

```bash
# grep: Authorization ヘッダーの付与状況を確認
grep -rn "Authorization.*Bearer\|Authorization.*token" app/execution --include="*.tsx"

# 期待値: Stage 5 / assist-execution 関連で Authorization ヘッダーが見つかる
```

#### その他の API の影響

- `generate-question`, `generate-insight` 等は、フロント側が認証トークンを付与しているか確認が必要
- 現在の実装状況によっては、フロント側でも修正が必要な可能性あり

---

## 4. 修正後の確認コマンド（まとめ）

```bash
#!/bin/bash
# 実装完了後の確認スクリプト

echo "=== A-1: OpenAI キー削除確認 ==="
test ! -f utils/ai.ts && echo "✅ utils/ai.ts 削除完了" || echo "❌ FAIL"
grep -r "NEXT_PUBLIC_OPENAI" . --include="*.ts" --include="*.tsx" 2>/dev/null && echo "❌ NEXT_PUBLIC_OPENAI 参照残存" || echo "✅ 参照なし"
grep -r "dangerouslyAllowBrowser" . --include="*.ts" --include="*.tsx" 2>/dev/null && echo "❌ dangerouslyAllowBrowser 残存" || echo "✅ なし"

echo ""
echo "=== A-2: API 認証追加確認 ==="
for api in "generate-question" "generate-insight" "okr-from-exec" "recommend-top-patterns" "recommend-exec-patterns" "stage5/assist-execution" "knowledge"; do
  if grep -q "getAuthUserIdFromBearer\|requireMembership" "app/api/$api/route.ts" 2>/dev/null; then
    echo "✅ $api 認証追加"
  else
    echo "❌ $api 認証未追加"
  fi
done

echo ""
echo "=== ビルド確認 ==="
npm run build && echo "✅ ビルド成功" || echo "❌ ビルド失敗"

echo ""
echo "=== フロント側 Bearer トークン確認 ==="
grep -r "Authorization.*Bearer\|Authorization.*token" app/execution --include="*.tsx" && echo "✅ Authorization ヘッダー見つかる" || echo "⚠️ 確認が必要"
```

実行:
```bash
bash ./check-a1-a2-implementation.sh
```

---

## 5. 各 API に追加すべき認証・会社所属チェックの方針

### 5.1 標準パターン（推奨）

全ての無認証 API に統一して以下を追加：

```typescript
import { getAuthUserIdFromBearer, requireMembership } from '@/lib/server/rbacGuard';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';

export async function POST(req: Request) {
  // 1. Bearer トークン検証
  const admin = getSupabaseAdmin();
  const userId = await getAuthUserIdFromBearer(admin, req);
  if (!userId) {
    return NextResponse.json(
      { error: 'unauthorized', message: 'Bearer token is required' },
      { status: 401 }
    );
  }

  // 2. Membership 取得（会社スコープ）
  const membership = await requireMembership(admin, userId);
  if (!membership) {
    return NextResponse.json(
      { error: 'forbidden', message: 'User is not a member of any company' },
      { status: 403 }
    );
  }

  // 3. 以下、既存のロジック
  // ... ビジネスロジック実装
}
```

### 5.2 ロール制御が必要な場合（高度な実装）

一部の API（将来の拡張）で role 制限が必要な場合：

```typescript
import { assertMinRole, assertCapability } from '@/lib/server/rbacGuard';

// admin のみに限定する場合
assertMinRole(membership, 'admin');

// 特定の capability を要求する場合
assertCapability(membership, 'agent:use', {});
```

### 5.3 会社スコープの強制

現在の実装：
- `membership.companyId` が自動的に取得される
- リクエストボディの `companyId` は**信用しない**（membership 由来で固定する）

```typescript
// ❌ 危険: ボディから companyId を取得
const companyId = body.companyId;  // ← 信用しない

// ✅ 安全: membership から companyId を取得
const companyId = membership.companyId;
```

---

## 6. 実装チェックリスト

### A-1: OpenAI キー削除

- [ ] `grep -r "NEXT_PUBLIC_OPENAI"` で 0 件確認
- [ ] `grep -r "dangerouslyAllowBrowser"` で 0 件確認
- [ ] `utils/ai.ts` ファイル削除
- [ ] `npm run build` で成功
- [ ] Vercel ダッシュボードで環境変数確認（NEXT_PUBLIC_OPENAI_API_KEY を削除）

### A-2: API 認証追加 (7 本)

#### `/api/stage5/assist-execution` (🔴 最優先)

- [ ] `getAuthUserIdFromBearer()` 追加
- [ ] `requireMembership()` 追加
- [ ] Bearer なし → 401 確認
- [ ] Bearer あり → 200/400 確認
- [ ] フロント側で Bearer トークンを付与

#### 推奨 6 本

- [ ] `generate-question`
- [ ] `generate-insight`
- [ ] `okr-from-exec`
- [ ] `recommend-top-patterns`
- [ ] `recommend-exec-patterns`
- [ ] `knowledge`

各ファイルで:
- [ ] `getAuthUserIdFromBearer()` 追加
- [ ] `requireMembership()` 追加
- [ ] ビルド成功 (`npm run build`)
- [ ] フロント側でトークン付与確認

### 全般

- [ ] `npm run build` で成功
- [ ] `next lint` で エラーなし
- [ ] フロント側の API クライアント確認（Bearer トークン付与）
- [ ] ステージング環境でリグレッション テスト実施

---

## 7. 参考資料・関連ドキュメント

- [08-security-review.md](./08-security-review.md) — F-1, F-2 の詳細
- [03-auth-rbac.md](./03-auth-rbac.md) — API ガード詳細・実装パターン
- [07-api-reference.md](./07-api-reference.md) — API 59 本の一覧・認証要否分類
- [10-remediation-plan.md](./10-remediation-plan.md) — 全 19 項目の優先度

---

## 8. よくある質問 (FAQ)

### Q: utils/ai.ts を削除しても、OpenAI を呼ぶ API は動作するか?

**A**: はい。`lib/openai.ts` と `lib/openaiClient.ts` のサーバ側実装で、`process.env.OPENAI_API_KEY` を使用しており、`utils/ai.ts` は使われていません。削除による影響は**ありません**。

### Q: フロント側の修正はどこを見るべき?

**A**: 以下のファイルで API 呼び出し時に Bearer トークンを付与しているか確認：
- `app/execution/page.tsx` (Stage 5)
- `app/execution/ExecutionPanel.tsx` (想定)
- その他、`fetch()` / `axios` で `/api/` を呼び出しているファイル

### Q: Membership が null になるケースは?

**A**: ユーザーがどの会社にも所属していない場合。通常、ユーザー作成時に `companies/provision` で初期 company を作成するため、normal flow では発生しない。

### Q: admin のみに限定する必要がある API は?

**A**: 現時点では、修正対象の 8 本は role 制限なし。ロール制限は将来の拡張で対応（A-3 で実装予定）。

---

**次ステップ**: 本レポートに基づいて、A-1・A-2 の実装を開始してください。

**作成日**: 2026-06-25  
**状態**: レビュー待ち
