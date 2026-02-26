# STAGE2 「12問が入力できない」クラッシュ修正 完了レポート

## 🔴 エラー根本原因

```
Uncaught Error: answers12.find is not a function at /app/stage2/page.tsx Questions12Section
```

### 根本的な問題
answers12 に **配列ではなく関数が格納されていた** ことが原因

### なぜそんなことが起きたのか

```
page.tsx:
  setLocalAnswers12((prev: Stage2Answer[]) => prev.map(...))  ← 関数 updater を使用
                     ↓
store:
  setAnswers12(answers) → answers が関数オブジェクト
                     ↓
Questions12Section:
  answers12.find()  ← 関数に .find() を呼ぶとクラッシュ！
```

### 二重定義による混乱
```
page.tsx に answers12 が複数定義されていた：
- const storeAnswers12 = useStrategyStore((s) => s.answers12);
- const setAnswers12 = useStrategyStore((s) => s.setAnswers12);
  ↑ store の定義
- const answers12 = useStrategyStore((s) => (s as any).answers12 ?? EMPTY_ANSWERS12);
- const setLocalAnswers12 = useStrategyStore((s) => (s as any).setAnswers12 as any);
  ↑ local state のつもり だが、実は store の同じ setter を別の変数名で参照

結果：setLocalAnswers12 で関数 updater を使う
  → store の setAnswers12 に関数が混入する
  → state に関数が格納される
```

---

## 🔧 どう直したか（関数混入の完全防止）

### 主要戦略：「answers12 は store 唯一の正」に統一

#### 1️⃣ 二重定義を廃止（line 774-781）
```typescript
/* ★ TASK A-1: answers12 をArrayガード付きで統一 */
const answers12 = useStrategyStore((s) => {
  const v = (s as any).answers12;
  return Array.isArray(v) ? v : [];  // ← 必ず配列を返す
});
const setAnswers12 = useStrategyStore(
  (s) => (s as any).setAnswers12 as (a: Stage2Answer[]) => void
);
```

**効果：**
- storeAnswers12 / setLocalAnswers12 を廃止
- answers12 は **唯一** の定義
- Arrayガード付きで非配列が来ても []になる

#### 2️⃣ 関数 updater を完全廃止（line 1180-1187）
```typescript
const handleUpdateAnswer = useCallback(
  (id: string, answer: string) => {
    const base = Array.isArray(answers12) ? answers12 : [];  // ← ガード
    const next = base.map((a) => (a.id === id ? { ...a, answer } : a));
    setAnswers12(next);  // ← 常に配列を直接渡す
  },
  [answers12, setAnswers12]
);
```

**変更点：**
- ❌ `setLocalAnswers12((prev) => prev.map(...))`  （関数 updater）
- ✅ `setAnswers12(next)`  （配列直接渡し）

#### 3️⃣ local ↔ store 同期 useEffect を削除（line 1174-1178）

**削除したもの：**
```typescript
// 削除（line 1167-1193）
useEffect(() => {
  if (!stage2Ready) return;
  const storeHash = hashAnswers12(storeAnswers12);
  const localHash = hashAnswers12(answers12);
  if (storeHash && storeHash === localHash) return;
  if (!storeHash && localHash) return;
  if (storeAnswers12 && storeAnswers12.length > 0) {
    setLocalAnswers12((prev) => ...)  ← 関数 updater
  }
}, [stage2Ready, storeAnswers12, answers12]);

// 削除（line 1196-1223）
useEffect(() => {
  if (!stage2Ready) return;
  const localHash = hashAnswers12(answers12);
  // ...
  setAnswers12(answers12);
}, [stage2Ready, answers12, storeAnswers12, setAnswers12]);
```

**理由：**
- 同期ループの原因
- 関数 updater の温床
- store を唯一の正にしたので不要

#### 4️⃣ snapshot 復元時も配列生成（line 999-1014）
```typescript
const a12 = st.answers12 ?? [];
if (Array.isArray(a12) && a12.length > 0) {
  const base =
    Array.isArray(answers12) && answers12.length > 0
      ? answers12
      : TEMPLATE12.map((q) => ({ id: q.id, answer: '' }));  // ← 配列生成

  const next = base.map((a) => {
    const hit = a12.find((s: any) => s?.id === a.id);
    return hit ? { ...a, answer: hit.answer ?? '' } : a;
  });

  setAnswers12(next);  // ← 配列を直接渡す
}
```

**効果：**
- snapshot から復元するときも関数ではなく配列を渡す
- 無防備な状態がない

#### 5️⃣ Questions12Section で配列ガード（line 644-645, 648, 658, 680）
```typescript
const safeAnswers12 = Array.isArray(answers12) ? answers12 : [];

const currentAnswer = safeAnswers12.find((a) => a.id === selectedId)?.answer ?? '';
const answeredTotal = safeAnswers12.filter((a) => a.answer?.trim()).length;
const isAnswered = !!safeAnswers12.find((a) => a.id === q.id && a.answer?.trim());
```

**効果：**
- 最後の砦。万一 answers12 が非配列でも落ちない

---

## 💡 dirty 連動の根拠（保存スキップ防止）

### store の setAnswers12（line 1460-1465）
```typescript
setAnswers12: (answers) => {
  set((s) => ({ ...s, answers12: answers, dirty: true }));  // ← 必ず dirty: true
  setTimeout(() => {
    get().saveStage2Snapshot();
  }, 0);
},
```

✅ **dirty: true を確実に立てる** → saveStrategyData がスキップしない

### saveStrategyData の判定（line 2005-2008）
```typescript
if (!force && !state0.dirty) {
  if (DEBUG) console.log('[strategyStore] saveStrategyData: dirty=false, skip (not forced)');
  return { ok: false, skipped: true, reason: 'dirty_false' };
}
```

✅ **force=false かつ dirty=false のときだけスキップ**

### 流れ図
```
ユーザー入力
  ↓
handleUpdateAnswer(id, answer)
  ↓
setAnswers12(next)  ← answers12 更新
  ↓
store で answers12 更新 + dirty: true  ← ★ CRITICAL
  ↓
saveStage2Snapshot() 自動呼び出し（localStorage）
  ↓
saveStrategyData() で dirty チェック
  ↓
dirty: true なので保存実行 → DB に反映
  ↓
リロード → store hydrate / snapshot / DB restore で復元
```

**保証：** ユーザーが答えを入力した瞬間、答え12_len > 0 が store に確定される

---

## 実施した修正

### TASK A：/app/stage2/page.tsx の修正（クラッシュ根絶）

#### A-1. answers12 の定義を統一（line 771-778）
**Before:**
```typescript
const storeAnswers12 = useStrategyStore((s) => s.answers12);
const setAnswers12 = useStrategyStore((s) => s.setAnswers12);
// ...
const answers12 = useStrategyStore((s) => (s as any).answers12 ?? EMPTY_ANSWERS12);
const setLocalAnswers12 = useStrategyStore((s) => (s as any).setAnswers12 as any);
```

**After:**
```typescript
/* ★ TASK A-1: answers12 をArrayガード付きで統一 */
const answers12 = useStrategyStore((s) => {
  const v = (s as any).answers12;
  return Array.isArray(v) ? v : [];
});
const setAnswers12 = useStrategyStore(
  (s) => (s as any).setAnswers12 as (a: Stage2Answer[]) => void
);
```

**効果：**
- answers12 の二重定義を廃止（storeAnswers12 / setLocalAnswers12 の混在を排除）
- Arrayガード付きで必ず配列を返す
- `.find()` のクラッシュ防止

#### A-2. local ↔ store 同期 useEffect を削除（line 1167-1171）
**削除内容：**
1. `storeAnswers12 -> local sync` useEffect（元の line 1167-1193）
2. `local answers12 -> store sync` useEffect（元の line 1196-1223）

**理由：**
- answers12 を store 唯一の正に統一した
- local state の同期が不要
- 「関数 updater → store に関数が入る」事故の根本原因

#### A-3. handleUpdateAnswer を store 直更新に修正（line 1173-1180）
**Before:**
```typescript
const handleUpdateAnswer = useCallback((id: string, answer: string) => {
  setLocalAnswers12((prev: Stage2Answer[]) => prev.map((a: Stage2Answer) => ...));
}, []);
```

**After:**
```typescript
const handleUpdateAnswer = useCallback(
  (id: string, answer: string) => {
    const base = Array.isArray(answers12) ? answers12 : [];
    const next = base.map((a) => (a.id === id ? { ...a, answer } : a));
    setAnswers12(next);
  },
  [answers12, setAnswers12]
);
```

**効果：**
- 関数 updater を廃止（常に配列を生成して setAnswers12 に渡す）
- store が関数を誤受け取りしない
- dirty フラグが正しく立つようになる

#### A-4. restoreStage2Snapshot 内で answers12 を配列set に統一（line 996-1011）
**Before:**
```typescript
const a12 = st.answers12 ?? [];
if (Array.isArray(a12) && a12.length > 0) {
  setLocalAnswers12((prev: Stage2Answer[]) =>
    prev.map((a: Stage2Answer) => {
      const fromSnapshot = a12.find((s: any) => s.id === a.id);
      return fromSnapshot ? { ...a, answer: fromSnapshot.answer ?? '' } : a;
    })
  );
}
```

**After:**
```typescript
const a12 = st.answers12 ?? [];
if (Array.isArray(a12) && a12.length > 0) {
  const base =
    Array.isArray(answers12) && answers12.length > 0
      ? answers12
      : TEMPLATE12.map((q) => ({ id: q.id, answer: '' } as Stage2Answer));

  const next = base.map((a) => {
    const hit = a12.find((s: any) => s?.id === a.id);
    return hit ? { ...a, answer: hit.answer ?? '' } : a;
  });

  setAnswers12(next);
  lastSyncedAnswersHashRef.current = hashAnswers12(next);
}
```

**効果：**
- snapshot からの復元で、常に配列を生成して setAnswers12 に渡す
- snapshot の a12 が空の場合、テンプレから初期配列を生成

#### A-5. Questions12Section 内に配列ガード追加（line 644-645, 648, 658, 680）
**Before:**
```typescript
const currentAnswer = answers12.find((a) => a.id === selectedId)?.answer ?? '';
const answeredTotal = answers12.filter((a) => a.answer?.trim()).length;
// ...
const isAnswered = !!answers12.find((a) => a.id === q.id && a.answer?.trim());
```

**After:**
```typescript
const safeAnswers12 = Array.isArray(answers12) ? answers12 : [];
const currentAnswer = safeAnswers12.find((a) => a.id === selectedId)?.answer ?? '';
const answeredTotal = safeAnswers12.filter((a) => a.answer?.trim()).length;
// ...
const isAnswered = !!safeAnswers12.find((a) => a.id === q.id && a.answer?.trim());
```

**効果：**
- props で answers12 が非配列でも `.find()` / `.filter()` で落ちない
- 最後の砦としての保険ガード

### TASK B：/store/strategyStore.ts の修正（dirty=false スキップ対策）

#### B-1. setAnswers12 が dirty を立てることを確認（line 1460-1465）
**確認結果：** ✅ OK
```typescript
setAnswers12: (answers) => {
  set((s) => ({ ...s, answers12: answers, dirty: true }));
  setTimeout(() => {
    get().saveStage2Snapshot();
  }, 0);
},
```

- ✅ dirty: true を立てている
- ✅ saveStage2Snapshot() を呼んでいる

#### B-2. saveStrategyData が dirty を正しくチェックすることを確認（line 2005-2008）
**確認結果：** ✅ OK
```typescript
if (!force && !state0.dirty) {
  if (DEBUG) console.log('[strategyStore] saveStrategyData: dirty=false, skip (not forced)');
  return { ok: false, skipped: true, reason: 'dirty_false' };
}
```

- ✅ force=false かつ dirty=false の場合のみスキップ
- ✅ page.tsx から setAnswers12(next) が呼ばれると dirty=true が立つため、スキップされない

---

## 修正後の動作フロー

### 12問入力時の流れ
1. UI でテキスト入力 → `handleUpdateAnswer(id, answer)` 呼び出し
2. `answers12` を再計算して `setAnswers12(next)` 呼び出し
3. store で `answers12` を更新、同時に **`dirty: true` を立てる**
4. `saveStage2Snapshot()` で localStorage に自動保存
5. `saveStrategyData()` が dirty=true を検知して DB に保存
6. リロード後も答えが復元される（store hydrate → snapshot → DB restore）

### 保護機構
- ✅ answers12 は必ず配列（Arrayガード）
- ✅ `.find()` / `.filter()` で落ちない（複数の箇所に保険）
- ✅ 入力 → dirty → save のフロー（スキップなし）
- ✅ store が唯一の正（local state 廃止）

---

## 検証結果

### npm run type-check
- ✅ page.tsx の修正にはコンパイルエラーなし
  （既存の型エラーは restoreWithAudit.ts にあり、無関係）

### npm run dev
- ✅ dev server 起動成功（port 3001）

### 期待される挙動（テスト時に確認）
1. STAGE2 の「12問」タブを開く
2. 任意の質問にテキスト入力（クラッシュなし）
3. ブラウザコンソール：エラー `answers12.find is not a function` が出ない
4. コンソールログで `[strategyStore] saveStrategyData: dirty=false, skip` が出ない
5. 手動保存後、リロードして入力が残ることを確認

---

## 修正ファイル

| ファイル | 変更箇所 | 修正内容 |
|---------|--------|--------|
| `/app/stage2/page.tsx` | line 771-778 | answers12 定義を統一（Arrayガード） |
| `/app/stage2/page.tsx` | line 1167-1171 | local ↔ store sync useEffect 削除 |
| `/app/stage2/page.tsx` | line 1173-1180 | handleUpdateAnswer を配列直更新に修正 |
| `/app/stage2/page.tsx` | line 996-1011 | restoreStage2Snapshot で配列set に統一 |
| `/app/stage2/page.tsx` | line 644-645, 648, 658, 680 | Questions12Section に配列ガード追加 |

---

## コミットメッセージ案

```
fix(stage2): stabilize answers12 as array and mark dirty on update

- Unify answers12 definition with array guard to prevent "find is not a function" crash
- Remove local-to-store sync useEffect (answers12 now uses store as single source of truth)
- Update handleUpdateAnswer to directly set array instead of function updater
- Add array guard in restoreStage2Snapshot and Questions12Section
- Ensure setAnswers12 always sets dirty=true for proper save flow

Fixes: Uncaught Error: answers12.find is not a function at Questions12Section
```

---

## ✅ 最終確認チェックリスト（実装検証完了）

### /app/stage2/page.tsx の確認
- ✅ **line 775-778：** answers12 は store 値のみ（Arrayガード付き）
- ✅ **line 779-781：** setAnswers12 は単一定義（型安全）
- ✅ **line 797-802：** storeAnswers12 / setLocalAnswers12 は削除（コメントアウト）
- ✅ **line 1174-1178：** local ↔ store 同期 useEffect 削除
- ✅ **line 1180-1187：** handleUpdateAnswer は配列直更新（関数updater廃止）
- ✅ **line 999-1014：** restoreStage2Snapshot で配列生成して setAnswers12
- ✅ **line 644-645, 648, 658, 680：** Questions12Section に safeAnswers12 ガード

### /store/strategyStore.ts の確認
- ✅ **line 1460-1465：** setAnswers12 が `dirty: true` を立てる
- ✅ **line 1462-1464：** saveStage2Snapshot() を呼ぶ
- ✅ **line 2005-2008：** saveStrategyData が dirty チェック（スキップロジック正常）

### 実装の保証
| 項目 | 状況 | 根拠 |
|-----|------|------|
| answers12 は必ず配列 | ✅ 保証 | Arrayガード（line 775-777） |
| 関数 updater は廃止 | ✅ 保証 | handleUpdateAnswer 実装（line 1183-1184） |
| dirty が立つ | ✅ 保証 | setAnswers12 実装（line 1461） |
| 保存スキップなし | ✅ 保証 | dirty チェック逻辑（line 2005） |
| 復元時も安全 | ✅ 保証 | snapshot 処理（line 1007-1012） |

---

## 🧪 次のステップ（テスト実行）

1. **ブラウザで動作確認（STAGE2 → 12問タブ）**
   - テキスト入力 → クラッシュなし
   - コンソール：エラー `answers12.find is not a function` が出ない

2. **保存ログ確認**
   - コンソール：`[strategyStore] saveStrategyData: dirty=false, skip` が出ない
   - 代わりに通常の save ログが出る

3. **リロード確認**
   - 同一端末でリロード → 入力が残る
   - 別端末でログイン → 同じデータが見える

4. **git commit（ローカルで実行）**
   ```bash
   cd C:\dev\growth-mvp-ver2.0
   git add app/stage2/page.tsx STAGE2_ANSWERS12_FIX_SUMMARY.md
   git commit -m "fix(stage2): stabilize answers12 as array and mark dirty on update"
   ```
