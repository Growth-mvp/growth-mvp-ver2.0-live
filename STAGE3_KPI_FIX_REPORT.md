# STAGE3 カスケード リロード時「KPI・目標消失」問題 - 調査・修正レポート

## 0. 事象（確認済み）
STAGE3（カスケード画面）で「ミッション / プロジェクト / KPI / 目標」を生成した直後は表示されるが、ブラウザをリロード（Ctrl+R）すると**「KPI・目標だけ」が消える**。ミッション・プロジェクトは残る。

---

## 1. 原因分類

### **原因：D（保存時に OKRs/KPIs が削除される）**

より正確には、以下の複数箇所で OKRs/KeyResults が削除されていた：

| # | ファイル | 関数 | 行番号 | 問題 |
|---|---------|------|--------|------|
| 1 | `/app/api/generate-cascade/_lib/normalization.ts` | `normalizeProjects()` | 27-55 | `okrs`/`keyResults` を削除 |
| 2 | `/app/cascade/page.tsx` | `normalizeProjectDraft()` | 955-983 | `okrs`/`keyResults` を削除 |

---

## 2. データ構造：KPI/目標の実体キー

### 保存されるべき構造：
```typescript
departments[i].projects[j].okrs[0]  // OKRオブジェクト
  ├── objective: string (目標説明)
  └── keyResults: string[]  // キーリザルト（複数）
```

### 例：
```json
{
  "name": "営業部",
  "projects": [
    {
      "title": "営業部：既存顧客のLTV改善",
      "okrs": [
        {
          "objective": "既存顧客満足度の向上",
          "keyResults": [
            "顧客解約率を現状 5% → 3% に低下",
            "NPS スコアを 30 → 45 に向上",
            "平均顧客生涯価値を 150万円 → 200万円に増加"
          ]
        }
      ]
    }
  ]
}
```

---

## 3. データフロー（問題箇所）

### ステップ 1: API側生成（`/api/generate-cascade`）

```
generateCascade()
  ↓
postprocessLanes()
  ├→ normalizeProjects()     ❌ [FIX前] okrs を削除
  └→ ...
  ↓
ensureOkrsForAllDepts()     ✅ okrs を再度生成・追加
  ↓
API レスポンス返却
  └→ departments[].projects[].okrs[] が含まれるはず
```

**問題：** `normalizeProjects()` で削除、`ensureOkrsForAllDepts()` で再生成される。

### ステップ 2: UI側処理（`/app/cascade/page.tsx`）

```
fetch('/api/generate-cascade') → レスポンス受信
  ↓
applyDeptDraftToProjects(existingProjects, rd)
  ├→ applyLaneToProjects()
  │   └→ normalizeProjectDraft()   ❌ [FIX前] okrs を削除
  ↓
pushToStore() で store 更新
  │ （ただし okrs なし）
  ↓
saveNow() → saveStrategyData()     ❌ okrs なしで DB に保存
```

**問題：** UI側で再び `normalizeProjectDraft()` が okrs を削除し、DB に okrs なしで保存される。

### ステップ 3: リロード時の復元

```
loadAndHydrate() → getFullStrategyDataByCompany()
  ↓
buildStateFromDbRow()           ✅ 正常に復元（okrs がない）
  ↓
store に復元
  └→ okrs が無い状態
```

**結果：** okrs が DB に無いため、復元時も okrs がない。

---

## 4. 変換点での欠落

### [欠落1] `/app/api/generate-cascade/_lib/normalization.ts:27-55`
**関数：** `normalizeProjects(raw)`

**修正前：**
```typescript
return { title, reason, hypothesis, mainLever, horizon, kind };  // okrs なし
```

**修正後：**
```typescript
const normalized: any = { title, reason, hypothesis, mainLever, horizon, kind };
if (Array.isArray(p?.okrs)) {
  normalized.okrs = p.okrs;
}
if (Array.isArray(p?.keyResults)) {
  normalized.keyResults = p.keyResults;
}
return normalized;
```

---

### [欠落2] `/app/cascade/page.tsx:955-983`
**関数：** `normalizeProjectDraft(pd)`

**修正前：**
```typescript
const p: Project = {
  title,
  hypothesis,
  mainLever: normalizeLever(pd?.mainLever),
  horizon: normalizeHorizon(pd?.horizon),
  kind: normalizeKind(pd?.kind),
} as Project;
```

**修正後：**
```typescript
const p: Project = {
  title,
  hypothesis,
  mainLever: normalizeLever(pd?.mainLever),
  horizon: normalizeHorizon(pd?.horizon),
  kind: normalizeKind(pd?.kind),
} as Project;

// ★ FIX: OKRs を保持（削除しない）
const pdOkrs = (pd as any)?.okrs;
if (pdOkrs) (p as any).okrs = pdOkrs;
```

---

## 5. 最小修正のパッチ

### ファイル 1: `/app/api/generate-cascade/_lib/normalization.ts`

```diff
export function normalizeProjects(raw: any): NormProject[] {
  // ...
  return list
    .map((p: any) => {
      const title = p.title.trim();
      // ... 他のフィールド処理

-     return { title, reason, hypothesis, mainLever, horizon, kind };
+     const normalized: any = { title, reason, hypothesis, mainLever, horizon, kind };
+
+     // ★ FIX: OKRs を保持
+     if (Array.isArray(p?.okrs)) {
+       normalized.okrs = p.okrs;
+     }
+     if (Array.isArray(p?.keyResults)) {
+       normalized.keyResults = p.keyResults;
+     }
+
+     return normalized;
    });
}
```

### ファイル 2: `/app/cascade/page.tsx`

```diff
function normalizeProjectDraft(pd: ApiProjectDraft): Project | null {
  // ...
  const p: Project = {
    title,
    hypothesis,
    mainLever: normalizeLever(pd?.mainLever),
    horizon: normalizeHorizon(pd?.horizon),
    kind: normalizeKind(pd?.kind),
  } as Project;

+ // ★ FIX: OKRs を保持（削除しない）
+ const pdOkrs = (pd as any)?.okrs;
+ if (pdOkrs) (p as any).okrs = pdOkrs;

  // skillRequirements, humanInvestments の処理...

  return p;
}
```

---

## 6. 修正確認手順

### 再現手順（修正前の確認）
1. STAGE3 カスケード画面へ移動
2. いずれか部門で「生成（ミッション/プロジェクト/KPI/目標）」をクリック
3. AI生成完了を確認（目標・KPIが画面に表示される）
4. **Ctrl+R（フルリロード）** でページをリロード
5. **[修正前] KPI・目標が消えることを確認**

### 修正後の確認手順
1. **修正コード反映**
2. 上記 1-3 の手順を実行
3. **Ctrl+R（フルリロード）でページをリロード**
4. **[修正後] KPI・目標が保持されることを確認**

### デバッグログ確認（NEXT_PUBLIC_DEBUG_CASCADE=1 の場合）
```javascript
// [fix][normalizeProjectDraft] ログで okrs が保持されているか確認
console.log('[fix][normalizeProjectDraft]', {
  title: '...',
  hasOkrs: true,
  okrsLen: 1,
});

// [fix][before-save] ログで saveNow() の直前に okrs が存在するか確認
console.log('[fix][before-save]', {
  dept: '営業部',
  projectCount: 3,
  projectsWithOkrs: 3,  // 全プロジェクトに okrs が含まれている
  sample: [
    {
      title: '営業部：既存顧客のLTV改善',
      hasOkrs: true,
      okrsLen: 1,
      kr0: '顧客解約率を現状 5% → 3% に低下'
    }
  ]
});
```

---

## 7. 保存・復元フロー（修正後）

```
API生成 ✓ OKRs を含む
  ↓
postprocessLanes()
  ├→ normalizeProjects() ✓ OKRs を保持（修正後）
  └→ ensureOkrsForAllDepts() ✓ OKRs 追加
  ↓
UI受信 → normalizeProjectDraft() ✓ OKRs を保持（修正後）
  ↓
pushToStore() ✓ OKRs を含む状態で更新
  ↓
saveNow() → saveStrategyData() ✓ OKRs を含んで DB に保存
  ↓
リロード時：buildStateFromDbRow() ✓ OKRs を復元
  ↓
UI表示 ✓ KPI・目標が表示される
```

---

## 8. 関連ファイル一覧（参考）

| ファイル | 用途 |
|---------|------|
| `/app/api/generate-cascade/_lib/generateCascade.ts` | メイン生成処理 |
| `/app/api/generate-cascade/_lib/postprocess.ts` | 後処理（normalizeProjects 呼び出し） |
| `/app/api/generate-cascade/_lib/normalization.ts` | **修正** - normalizeProjects |
| `/app/api/generate-cascade/_lib/keyResults.ts` | OKRs 生成・確保（ensureOkrsForAllDepts） |
| `/app/cascade/page.tsx` | **修正** - UI処理（normalizeProjectDraft） |
| `/utils/supabase/strategy.ts` | saveStrategyData（DB保存） |
| `/types/strategy.ts` | 型定義 |

---

## 9. 注記

- **okrs** フィールドは複数の名前（okrs, keyResults, kpis, metrics）で参照される可能性がある（互換性）
- **修正はリスク最小化**に設計（新規フィールド追加なし、既存フロー変更なし）
- **backward compatibility** を維持（okrs がない場合は ensureOkrsForAllDepts で補完）

---

**修正日**: 2026-02-09
**作成**: Claude Code Investigation Agent
