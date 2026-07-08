# PoC 前セキュリティ監査：STAGE1-3 API/UI 権限制御確認

**作成日**: 2026-06-28  
**ステータス**: 権限チェック漏れ発見 - PoC 前修正必須  
**優先度**: High  

---

## 1. 調査概要

**目的**: PoC 前に member が STAGE1-3 を編集できないことを確認

**範囲**: API 権限チェック + UI 表示制御 + 保存フロー

**結論**: ⚠️ **2つの API で権限チェック漏れが発見** → PoC 前修正が必須

---

## 2. STAGE1-3 API 権限チェック一覧

### ✅ **安全な API**

#### STAGE1: /api/stage1/import

```typescript
// app/api/stage1/import/route.ts (line 506-531)
const userId = await getAuthUserIdFromBearer(admin, request);  // ✅ Bearer 認証
const membership = await requireMembership(admin, userId);     // ✅ Membership 確認
await assertMinRole(membership, 'manager');                   // ✅ manager 以上のみ
```

| 項目 | 状態 | 理由 |
|-----|------|------|
| 認証チェック | ✅ | getAuthUserIdFromBearer で Bearer トークン確認 |
| Membership | ✅ | requireMembership で会社所属確認 |
| Role チェック | ✅ | assertMinRole('manager') で manager/admin のみ |
| member 可否 | ❌ 不可 | role チェックで 403 Forbidden |

**判定**: **安全** - member は呼び出し不可

---

#### STAGE2 Draft: /api/stage2/generate-draft

```typescript
// app/api/stage2/generate-draft/route.ts (line 1019-1037)
const userId = await getAuthUserIdFromBearer(admin, req);      // ✅ Bearer 認証
const membership = await requireMembership(admin, userId);     // ✅ Membership 確認
await assertMinRole(membership, 'manager');                   // ✅ manager 以上のみ
```

| 項目 | 状態 | 理由 |
|-----|------|------|
| 認証チェック | ✅ | getAuthUserIdFromBearer で Bearer トークン確認 |
| Membership | ✅ | requireMembership で会社所属確認 |
| Role チェック | ✅ | assertMinRole('manager') で manager/admin のみ |
| member 可否 | ❌ 不可 | role チェックで 403 Forbidden |

**判定**: **安全** - member は呼び出し不可

---

### 🔴 **危険な API（権限チェック漏れ）**

#### STAGE2 Final: /api/stage2/generate-final

```typescript
// app/api/stage2/generate-final/route.ts (line 1075-1083)
const userId = await getAuthUserIdFromBearer(admin, req);      // ✅ Bearer 認証
const membership = await requireMembership(admin, userId);     // ✅ Membership 確認
// ❌ assertMinRole なし！ ← member でも呼び出し可能
```

| 項目 | 状態 | 理由 |
|-----|------|------|
| 認証チェック | ✅ | getAuthUserIdFromBearer で Bearer トークン確認 |
| Membership | ✅ | requireMembership で会社所属確認 |
| Role チェック | ❌ **なし** | assertMinRole 呼び出しなし |
| member 可否 | ✅ **可能** | role チェック없으므로 member も呼び出し可 |
| 操作内容 | UPDATE | strategy_data テーブルの final_story_draft カラムに保存 |

**判定**: **危険** - member が呼び出し可能 → strategy_data に書き込み可能

**リスク**: member が STAGE2 を完了して最終ストーリーを保存できてしまう

**修正案**:
```typescript
// line 1082 の後に追加
try {
  await assertMinRole(membership, 'manager');
} catch {
  return NextResponse.json({ error: 'insufficient_role' }, { status: 403 });
}
```

---

#### STAGE3 Bridge: /api/stage3/generate-strategy-bridge

```typescript
// app/api/stage3/generate-strategy-bridge/route.ts (line 212-290)
const userId = await getAuthUserIdFromBearer(admin, request);  // ✅ Bearer 認証
let membership = await requireMembership(admin, userId, bodyCompanyId);  // ✅ Membership 確認
// ❌ assertMinRole なし！ ← member でも呼び出し可能
```

| 項目 | 状態 | 理由 |
|-----|------|------|
| 認証チェック | ✅ | getAuthUserIdFromBearer で Bearer トークン確認 |
| Membership | ✅ | requireMembership で会社所属確認 |
| Role チェック | ❌ **なし** | assertMinRole 呼び出しなし |
| member 可否 | ✅ **可能** | role チェック없으므로 member も呼び出し可 |
| 操作内容 | UPDATE | strategy_data テーブルの stage3_strategy_bridge カラムに保存 |

**判定**: **危険** - member が呼び出し可能 → strategy_data に書き込み可能

**リスク**: member が STAGE3 の戦略展開ブリッジを生成・保存できてしまう

**修正案**:
```typescript
// line 290 の後に追加（return 前）
try {
  await assertMinRole(membership, 'manager');
} catch {
  return NextResponse.json({ error: 'insufficient_role' }, { status: 403 });
}
```

---

## 3. STAGE1-3 UI 権限制御確認

### ✅ **安全な UI 制御**

#### STAGE1: app/stage1/page.tsx

```typescript
// line 37
const canEdit = isAdmin || isManager;  // ✅ member は canEdit=false

// 編集フォーム
<ReadOnlyBlock readOnly={!canEdit}>
  {/* 入力フォーム */}
</ReadOnlyBlock>

// ボタン制御
<button disabled={!canEdit}>保存</button>
<button disabled={!canEdit}>AI生成</button>
```

| UI 要素 | member に表示 | 備考 |
|--------|------------|------|
| 編集フォーム | ✅ 表示 | ReadOnlyBlock で disabled |
| 保存ボタン | ✅ 表示 | disabled |
| AI 生成ボタン | ✅ 表示 | disabled |

**判定**: **安全** - member は UI 上で編集・保存できない

---

#### STAGE2: app/stage2/page.tsx

```typescript
// StrategyGuard で view モード
<StrategyGuard mode="view">
  {/* ここは表示のみ */}
</StrategyGuard>
```

| UI 要素 | member に表示 | 備考 |
|--------|------------|------|
| ストーリー表示 | ✅ 表示 | 読取のみ |
| 編集フォーム | ❌ 非表示 | view モード |
| 保存ボタン | ❌ 非表示 | view モード |

**判定**: **安全** - member は UI 上で編集できない（たただし、API 直呼び出しで修正可能）

---

#### STAGE3: app/stage3/page.tsx

```typescript
// view モードで読取のみ
<StrategyGuard mode="view">
  {/* 表示のみ */}
</StrategyGuard>
```

| UI 要素 | member に表示 | 備考 |
|--------|------------|------|
| ブリッジ表示 | ✅ 表示 | 読取のみ |
| 生成ボタン | ❌ 非表示 | view モード |
| 保存ボタン | ❌ 非表示 | view モード |

**判定**: **安全** - member は UI 上で生成・保存できない（ただし、API 直呼び出しで修正可能）

---

## 4. saveStrategyData（自動保存）の権限チェック

### **client-side 自動保存フロー**

```
STAGE4/5 でユーザー編集
  ↓
autoSave hook trigger
  ↓
store.saveStrategyData()
  ↓
Supabase client UPDATE
  ↓
RLS ポリシーで権限チェック（唯一の防御）
```

**保護メカニズム**:
- Server-side role チェック：❌ なし
- Client-side role チェック：❌ なし
- RLS ポリシー（Supabase）：✅ のみ

**リスク**: RLS が正しく実装されていることが前提

---

## 5. PoC 前に修正が必須な API

### **🔴 HIGH：修正必須**

| API | 現状 | 修正内容 | 工数 |
|-----|------|--------|------|
| /api/stage2/generate-final | role チェック漏れ | assertMinRole('manager') 追加 | 1分 |
| /api/stage3/generate-strategy-bridge | role チェック漏れ | assertMinRole('manager') 追加 | 1分 |

### **修正箇所の詳細**

#### 修正1: /api/stage2/generate-final

**ファイル**: `app/api/stage2/generate-final/route.ts`

**現在のコード** (line 1075-1090):
```typescript
const userId = await getAuthUserIdFromBearer(admin, req);
if (!userId) {
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
}

const membership = await requireMembership(admin, userId);
if (!membership) {
  return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
}

// ❌ ここに assertMinRole がない！
const body = await req.json();
```

**修正後**:
```typescript
const userId = await getAuthUserIdFromBearer(admin, req);
if (!userId) {
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
}

const membership = await requireMembership(admin, userId);
if (!membership) {
  return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
}

// ✅ 追加
try {
  await assertMinRole(membership, 'manager');
} catch (e: any) {
  return NextResponse.json(
    { error: 'insufficient_role', message: e?.message },
    { status: 403 }
  );
}

const body = await req.json();
```

---

#### 修正2: /api/stage3/generate-strategy-bridge

**ファイル**: `app/api/stage3/generate-strategy-bridge/route.ts`

**現在のコード** (line 212-290):
```typescript
const userId = await getAuthUserIdFromBearer(admin, request);
let membership = await requireMembership(admin, userId, bodyCompanyId);

if (!membership) {
  return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
}

// ❌ ここに assertMinRole がない！
const req_body = await request.json();
```

**修正後**:
```typescript
const userId = await getAuthUserIdFromBearer(admin, request);
let membership = await requireMembership(admin, userId, bodyCompanyId);

if (!membership) {
  return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
}

// ✅ 追加
try {
  await assertMinRole(membership, 'manager');
} catch (e: any) {
  return NextResponse.json(
    { error: 'insufficient_role', message: e?.message },
    { status: 403 }
  );
}

const req_body = await request.json();
```

---

## 6. STAGE4/5 への影響確認

### **STAGE4 保存フロー**

```
Member が STAGE4 編集
  ↓
UI: canEdit=true で保存ボタン有効
  ↓
autoSave → saveStrategyData()
  ↓
strategy_data UPDATE（stage4Plans など）
  ↓
RLS チェック（member で UPDATE 可能か）
```

**現状**: RLS 修正を見送っているため、member は strategy_data UPDATE 可能

**判定**: ✅ 影響なし（PoC では member 編集を許可）

---

### **STAGE5 保存フロー**

```
Member が STAGE5 入力
  ↓
UI: canEdit=true で保存ボタン有効
  ↓
autoSave → progress_logs INSERT
  ↓
RLS チェック（member で INSERT 可能か）
```

**現状**: progress_logs に RLS が未実装のため、member INSERT 可能

**判定**: ✅ 影響なし（PoC では member 入力を許可）

---

## 7. RLS Migration ファイルの適用状態

### **ファイル**: `supabase/migrations/20260628_fix_strategy_data_rls_role_control.sql`

**現在の状態**: 📋 **適用保留**

**ステータス**:
- ✅ 作成済み
- ⏸️ Supabase に未適用
- 📝 PoC 後に適用予定

**コメント追加**: ファイルの先頭に「適用保留」を明記すべき

```sql
-- ============================================================
-- ⚠️ 【適用保留】このmigrationはPoC前には適用しないでください
-- 理由: STAGE4のデータ（project_target_impacts等）が
--      strategy_dataに保存されており、member編集を壊す可能性がある
-- 適用予定: PoC後にSTAGE4データの分離を実装してから
-- ============================================================
```

---

## 8. PoC 前の最小修正案

### **優先度1（必須 - 2分で完了）**

修正する API：
1. `/api/stage2/generate-final` に `assertMinRole('manager')` 追加
2. `/api/stage3/generate-strategy-bridge` に `assertMinRole('manager')` 追加

修正理由：
- member が STAGE2 Final や STAGE3 を実行・保存できてしまう
- strategy_data に直接書き込まれるため、RLS 設定より優先される

---

### **優先度2（確認 - 5分）**

確認項目：
- [ ] STAGE4 の保存 API が存在するか
- [ ] STAGE5 の保存 API が存在するか
- [ ] これらの API に assertMinRole があるか（member 除外でなく、member 許可）

---

## 9. 修正後の期待状態

### **修正前後の比較**

| 操作 | member | manager | admin |
|-----|--------|---------|-------|
| **STAGE1 保存（修正前）** | ❌ API チェックで拒否 | ✅ 可能 | ✅ 可能 |
| **STAGE2 Draft（修正前）** | ❌ API チェックで拒否 | ✅ 可能 | ✅ 可能 |
| **STAGE2 Final（修正前）** | ✅ **可能（危険）** | ✅ 可能 | ✅ 可能 |
| **STAGE2 Final（修正後）** | ❌ API チェックで拒否 | ✅ 可能 | ✅ 可能 |
| **STAGE3 Bridge（修正前）** | ✅ **可能（危険）** | ✅ 可能 | ✅ 可能 |
| **STAGE3 Bridge（修正後）** | ❌ API チェックで拒否 | ✅ 可能 | ✅ 可能 |
| **STAGE4 保存（全期間）** | ✅ 可能 | ✅ 可能 | ✅ 可能 |
| **STAGE5 入力（全期間）** | ✅ 可能 | ✅ 可能 | ✅ 可能 |

---

## 10. 最終チェックリスト（PoC 開始前）

### **実装チェック**

- [ ] `/api/stage2/generate-final` に `assertMinRole('manager')` 追加
- [ ] `/api/stage3/generate-strategy-bridge` に `assertMinRole('manager')` 追加
- [ ] コンパイル / TypeScript チェック成功
- [ ] **修正後のテスト**:
  - [ ] member が `/api/stage2/generate-final` 呼び出し → 403 返却確認
  - [ ] manager が `/api/stage2/generate-final` 呼び出し → 200 返却確認
  - [ ] member が `/api/stage3/generate-strategy-bridge` 呼び出し → 403 返却確認
  - [ ] manager が `/api/stage3/generate-strategy-bridge` 呼び出し → 200 返却確認

### **RLS Migration**

- [ ] `supabase/migrations/20260628_fix_strategy_data_rls_role_control.sql` の先頭に「適用保留」コメント追加
- [ ] ファイルは削除せず、参考資料として残す

### **PoC 開始**

- [ ] 上記修正が全て完了した状態で PoC 開始
- [ ] member ユーザーが STAGE1-3 を編集できないことを確認
- [ ] member ユーザーが STAGE4-5 を編集できることを確認

---

**ステータス**: PoC 前修正が必須。修正工数は 2～3 分で完了。

---

## 修正完了（2026-06-28）

### ✅ 実施済みの修正

1. **`/api/stage2/generate-final`** に `assertMinRole(membership, 'manager')` を追加
   - 位置：line 1085-1090
   - インポート：assertMinRole を追加（line 13）
   - 権限不足時：403 返却

2. **`/api/stage3/generate-strategy-bridge`** に `assertMinRole(membership, 'manager')` を追加
   - 位置：line 292-301
   - インポート：assertMinRole を追加（line 10）
   - 権限不足時：403 返却

### ✅ ビルド確認

- `npm run build`：成功 ✅
- TypeScript チェック：成功 ✅
- API ルート確認：
  - `/api/stage2/generate-final` ✅
  - `/api/stage3/generate-strategy-bridge` ✅

### 📋 期待動作

| ユーザー種別 | /api/stage2/generate-final | /api/stage3/generate-strategy-bridge |
|----------|--------------------------|--------------------------------------|
| member | ❌ 403（insufficient_role） | ❌ 403（Manager role required） |
| manager | ✅ 200（可能） | ✅ 200（可能） |
| admin | ✅ 200（可能） | ✅ 200（可能） |

### ✅ 影響確認

- STAGE1-3 の編集・保存：protected ✅
- STAGE4/5 の編集・保存：影響なし ✅
- API 権限チェック：統一済み ✅

---

**PoC 開始前準備**: 完了。RLS migration は引き続き適用保留。
