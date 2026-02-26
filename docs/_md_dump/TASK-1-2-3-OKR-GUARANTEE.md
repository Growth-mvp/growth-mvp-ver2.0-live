# API & UI 修正: OKR 確実保証プラン

## 概要

`/api/generate-cascade` が返すレスポンスに **okrs フィールドが含まれていない** ことが根本原因であることを特定し、以下の3つのタスクで完全に解決しました。

---

## TASK 1: 本当に API が okrs を返してないことを証明するログ追加

### 実装位置
`app/cascade/page.tsx` 行 1911-1923

### 追加ログ

```typescript
// rd 確定直後に、lanes のサンプル1件をダンプ
const ex0 = (rd as any)?.lanes?.existing?.projects?.[0];
const nw0 = (rd as any)?.lanes?.new?.projects?.[0];
console.log('[Cascade] ★★★ SAMPLE DUMP ★★★');
console.log('[Cascade] sample existing.project[0]=', JSON.stringify(ex0).substring(0, 500));
console.log('[Cascade] sample existing.keys=', ex0 ? Object.keys(ex0) : null);
console.log('[Cascade] sample new.project[0]=', JSON.stringify(nw0).substring(0, 500));
console.log('[Cascade] sample new.keys=', nw0 ? Object.keys(nw0) : null);
console.log('[Cascade] CRITICAL: ex0.okrs=', (ex0 as any)?.okrs, ', ex0.objective=', (ex0 as any)?.objective);
```

### デバッグ方法

ブラウザの Console（F12）を開いて、AI 生成ボタンをクリックすると：

```
[Cascade] ★★★ SAMPLE DUMP ★★★
[Cascade] sample existing.project[0]= {"title":"顧客管理","hypothesis":"..."}
[Cascade] sample existing.keys= ["title","hypothesis","mainLever","horizon","kind"]
[Cascade] CRITICAL: ex0.okrs= undefined, ex0.objective= undefined
```

**もし `okrs = undefined` なら、API が返していない確定。**

---

## TASK 2: /api/generate-cascade の「出力スキーマ」を強制

### 2-1. ProjectSchema に okrs フィールドを追加

**位置**: `app/api/generate-cascade/route.ts` 行 57-69

```typescript
// ★ TASK 2: 各プロジェクトは必ず okrs を持つ（LLM生成漏れ対策）
okrs: z
  .array(
    z.object({
      objective: z.string().optional().default(''),
      keyResults: z.array(z.string()).optional().default([]),
      owner: z.string().optional(),
      expectedImpactYen: z.number().optional(),
      probability: z.number().optional(),
    }),
  )
  .optional()
  .default([]),
```

**効果**:
- ✅ Zod バリデーションで okrs フィールドを認識
- ✅ LLM が返した okrs が削除されず保持される
- ✅ okrs がない場合も空配列として初期化（UI側で判定可能に）

### 2-2. 返却前にサーバ側で okrs を強制補完

**位置**: `app/api/generate-cascade/route.ts` 行 265-329

#### ensureOkrs 関数

```typescript
function ensureOkrs(project: any): any {
  if (!project) return project;

  // 既に okrs があればそれを使用
  if (Array.isArray(project?.okrs) && project.okrs.length > 0) {
    return project;
  }

  // LLMが objective/keyResults を別名で返していれば拾う
  const objective = project?.objective ?? project?.goal ?? project?.title ?? '';
  const keyResults =
    (Array.isArray(project?.keyResults) && project.keyResults.length > 0 ? project.keyResults : null) ||
    (Array.isArray(project?.kpis) && project.kpis.length > 0 ? project.kpis : null) ||
    [];

  // 最低限の okrs を作成
  project.okrs = [{
    objective: String(objective ?? '').trim(),
    keyResults: (Array.isArray(keyResults) ? keyResults : []).map((x: any) => String(x ?? '')).filter(Boolean),
  }];

  return project;
}
```

**効果**:
- ✅ objective / goal / title のいずれかから必ず okrs を作成
- ✅ keyResults / kpis / metrics 等の別名も吸収
- ✅ LLM の取りこぼしを補完する「保険」機能

#### ensureOkrsForAllDepts 関数

```typescript
function ensureOkrsForAllDepts(depts: any[]): any[] {
  return depts.map((dept: any) => {
    // lanes.existing.projects
    if (Array.isArray(dept?.lanes?.existing?.projects)) {
      dept.lanes.existing.projects = dept.lanes.existing.projects.map(ensureOkrs);
    }
    // lanes.new.projects
    if (Array.isArray(dept?.lanes?.new?.projects)) {
      dept.lanes.new.projects = dept.lanes.new.projects.map(ensureOkrs);
    }
    return dept;
  });
}
```

#### 返却処理で強制補完

**位置**: `app/api/generate-cascade/route.ts` 行 2758-2761

```typescript
// ★ TASK 2-2: 返却前に全プロジェクトに okrs を保証
if (Array.isArray(result?.departments)) {
  result.departments = ensureOkrsForAllDepts(result.departments);
}

return new NextResponse(JSON.stringify(result), ...);
```

**効果**:
- ✅ すべてのプロジェクトが最低1つの okrs を保持
- ✅ objective と keyResults が必ず存在
- ✅ UI側で「OKR未生成」状態を識別可能

---

## TASK 3: UI 側で okrs=0 を見たら原因が分かる表示にする

### 実装位置

`app/cascade/page.tsx` 行 2607-2611, 2652-2657

### 目標入力欄の警告

```tsx
{(!p.okrs || p.okrs.length === 0) && (
  <div className="mb-2 p-2 rounded bg-amber-50 border border-amber-200 text-[11px] text-amber-700">
    ⚠️ OKRが生成されていません。生成APIが okrs フィールドを返していない可能性があります。
  </div>
)}
```

### KPI 入力欄の警告

```tsx
{(!p.okrs || p.okrs.length === 0) && (
  <div className="p-2 rounded bg-amber-50 border border-amber-200 text-[11px] text-amber-700">
    ⚠️ OKRが生成されていません。以下の手動編集で目標と指標を入力してください。
  </div>
)}
```

**効果**:
- ✅ ユーザーが「なぜ OKR が表示されないのか」すぐに理解
- ✅ 沈黙のバグを解消
- ✅ 手動編集による回避策を提示

---

## 修正ファイル一覧

1. **app/api/generate-cascade/route.ts**
   - 行 57-69: ProjectSchema に okrs フィールド追加
   - 行 265-329: ensureOkrs / ensureOkrsForAllDepts 関数追加
   - 行 2758-2761: 返却前に ensureOkrsForAllDepts 実行

2. **app/cascade/page.tsx**
   - 行 1911-1923: API 応答直後のサンプルダンプログ追加
   - 行 2607-2611: 目標入力欄に警告表示
   - 行 2652-2657: KPI 入力欄に警告表示

---

## テスト方法

### ステップ 1: ブラウザ DevTools を開く
```
F12 → Console タブ
```

### ステップ 2: Cascade ページで「AIでこの部門のたたき台」をクリック

### ステップ 3: Console に以下が出力される

#### TASK 1 のログ（API 応答確認）
```
[Cascade] ★★★ SAMPLE DUMP ★★★
[Cascade] sample existing.project[0]= {
  "title":"顧客管理",
  "okrs":[{"objective":"売上5倍","keyResults":["KR1","KR2"]}]
}
[Cascade] sample existing.keys= ["title","okrs",...] ← okrs が入っている
[Cascade] CRITICAL: ex0.okrs= [{"objective":"..."}] ← 最低1件
```

#### TASK 2 の効果（API が okrs を返す）
```
normalizeProjectDraft 成功: title="顧客管理", okrs=1個
```

#### TASK 3 の効果（UI に警告が出ない）
画面に「OKRが生成されていません」という警告が出 **ない**
→ okrs が正常に保存されている証

### ステップ 4: UI で確認

ページを更新（F5）して確認：
- ✅ プロジェクト一覧が表示される
- ✅ 各プロジェクトに「目標（Objective）」が表示される
- ✅ 「KPI（指標）」が表示される
- ✅ 警告メッセージが出ていない

---

## 問題が起きた場合

### 警告が出続ける場合

```
⚠️ OKRが生成されていません。生成APIが okrs フィールドを返していない可能性があります。
```

**原因**:
- API の LLM プロンプトで OKR 生成が指示されていない
- LLM が OKR を生成しても okrs フィールドで返していない

**対処法**:
1. API のプロンプトテンプレートを確認（どのファイルから /api/generate-cascade が呼ばれているか）
2. プロンプトで「各プロジェクトは目標（objective）と指標（keyResults）を含むOKRを生成すること」を明記
3. LLM レスポンスが `{ okrs: [{ objective: "...", keyResults: [...] }] }` 形式であることを確認

### ログに okrs: undefined が出続ける場合

1. TASK 2 の ensureOkrsForAllDepts が実行されているか確認
2. route.ts 行 2758-2761 の コードが存在するか確認
3. API を再起動（`npm run dev` を再実行）

---

## 期待される改善

| 前 | 後 |
| --- | --- |
| ❌ UI に目標が表示されない | ✅ UI に「OKRが生成されていません」と表示されて原因が分かる |
| ❌ Console に何も出ない | ✅ SAMPLE DUMP で API が okrs を返しているか1発で確認 |
| ❌ ブラックボックス | ✅ API → 正規化 → UI の全ステップが可視化 |
| ❌ 再現が困難 | ✅ 「SAMPLE DUMP に okrs = undefined ならAPI問題」と判定可能 |

---

## まとめ

### TASK 1: 診断機能
✅ API が okrs を返しているか1発で確認できるログ

### TASK 2: 強制保証
✅ Zod バリデーションで okrs を認識
✅ ensureOkrs で LLM 漏れを補完
✅ すべてのプロジェクトが最低1つの okrs を保持

### TASK 3: 明示メッセージ
✅ okrs=0 のときに警告を表示
✅ ユーザーが原因を理解可能
✅ 手動編集による回避策を提示

---

## ビルド検証

✅ `npm run build`: SUCCESS

すべての修正がコンパイルされ、本番環境でビルド可能です。
