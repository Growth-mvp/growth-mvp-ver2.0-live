# STAGE3/STAGE5 不整合問題 - 根本原因分析 & 修正戦略

## Executive Summary

GROWTHアプリケーションで「STAGE3再生成後の内容がSTAGE4/5に反映されない」「STAGE4編集が保存されない」という事故が発生しています。

**根本原因**: 3つの複合的な設計ギャップにより、STAGE3で departments が更新されても **stage4Plans が初期化されず、古い baseline を保持し続ける** ため、STAGE4/5 が古いデータを参照し、新規編集内容が正本と同期されない。

**最重要課題**: `stage4Plans` が「STAGE3の当時のスナップショット」を保持し続ける設計になっており、その後のSTAGE3更新を検知・反映する仕組みが **完全に欠落** している。

---

## 追加発見: normalize.ts で stage4Plans / executionPlanBaseline が漏れている

**Location**: `/utils/supabase/normalize.ts:711-945` (normalizeStrategyData)

**問題**:
- `normalizeStrategyData()` は `stage4Plans` と `executionPlanBaseline` を処理していない
- restore 時に DB から復元されたデータが normalize を通すと、これらフィールドが消える可能性

**確認箇所** (normalize.ts 末尾):
```typescript
const out: StrategyData = {
  // ... many fields ...
  departments,      // ✅ 正規化・保持
  stage1Issues,     // ✅ 保持
  stage1Benchmarks, // ✅ 保持
  // ❌ stage4Plans: 記載なし
  // ❌ executionPlanBaseline: 記載なし
  // ... others ...
};
```

**修正必須**:
```typescript
// normalize.ts の out オブジェクト構築時に追加
...(Array.isArray(src.stage4Plans) ? { stage4Plans: src.stage4Plans } : {}),
...(src.executionPlanBaseline && typeof src.executionPlanBaseline === 'object' ? { executionPlanBaseline: src.executionPlanBaseline } : {}),
```

**影響**:
- restore → normalize → store に反映時に、stage4Plans が消える
- 結果として「保存されたはずの stage4Plans が restore 後に消える」という現象に

---

## 1. 根本原因（詳細）

### 原因A: STAGE3再生成時に stage4Plans が削除されない

**証拠ファイル**: `/app/cascade/page.tsx:2100-2167`

```typescript
// cascade/page.tsx の再生成フロー (現状)
async function handleRegeneration() {
  const response = await fetch('/api/generate-cascade', { ... });
  const { lanes } = await response.json();

  const mergedDepts = applyDeptDraftToProjects(existingDepts, lanes, false);

  setDepartmentsInStore(mergedDepts);  // ← departments更新
  // ❌ 欠落: setStage4Plans(undefined) or setStage4Plans([])

  await saveNow();  // DB保存
}
```

**Impact**:
- STAGE3再生成で departments[0].projects が [P1, P2, P3] → [P1_v2, P2_v2, P4] に変更
- **stage4Plans[0].baseline は依然 [P1, P2, P3] を参照**
- STAGE4 訪問時：baseline が古いまま → ユーザーが編集する baseline も古い

**なぜ発生したか**:
- STAGE4の baseline は「/okr初回遷移時のスナップショット」という設計コンセプト
- しかし「スナップショット作成後、STAGE3再生成で invalidate する」ロジックが実装されなかった
- result: 古い baseline が永遠に固定

---

### 原因B: STAGE4 が部門構成変更を検知しない

**証拠ファイル**: `/app/stage4/page.tsx:189-215`

```typescript
useEffect(() => {
  if (!selectedDept) return;

  const deptId = String(selectedDept.id || selectedDept.name);

  // ⚠️ 問題：localPlans の存在チェック
  const exists = localPlans.some((p) => p.departmentId === deptId);
  if (exists) return;  // ← 既に存在したら baseline再初期化しない

  const baseline = createBaselineFromStage3(selectedDept);
  setStage4Plans([...localPlans, newPlan]);
}, [selectedDept, localPlans, setStage4Plans]);
```

**Impact**:
1. STAGE4初回訪問 → baseline 作成（当時の部門構成から）✅
2. STAGE3で再生成 → departments 変更
3. STAGE4再訪問 → selectedDept 変更検知、**でも localPlans に存在 → skip** ❌
4. **baseline は依然古い構成**

**理由**:
- 条件判定が「department IDの存在」のみで、「構成の変化」を検知していない
- department hash や revision を追跡していない

**結果**:
- 変更前: departments[0].projects = [A, B]
- 変更後: departments[0].projects = [A_v2, B_v2, C_new]
- STAGE4 baseline: 依然 [A, B] (古い)
- ユーザーが見る差分: なし（baseline自体が stale）

---

### 原因C: merge 時に stage4Plans が保護されていない

**証拠ファイル**: `/store/strategyStore.ts:3508-3513` (refetchFromServer内)

```typescript
const merged: any = {
  ...(base as any),
  ...(patch as any),  // ← patch が base 全部を上書き
  // Some specific fields protected:
  stage1Benchmarks: (patch as any).stage1Benchmarks ?? (base as any).stage1Benchmarks,
  answers12: (patch as any).answers12 ?? (base as any).answers12,
  winPatternsCandidate: (patch as any).winPatternsCandidate ?? (base as any).winPatternsCandidate,
  // ❌ stage4Plans は保護なし
};
```

**Impact**:
- refetch/restore時に patch に stage4Plans なし → base.stage4Plans は undefined/null に上書きされる
- または古い patch が apply → 巻き戻り

**シナリオ**:
```
Local state: stage4Plans = [plan_v2] (new edits)
DB fetch: stage4Plans = [plan_v1] (old version)
Merge: patch = { stage4Plans: [plan_v1] } (because DB is newer)
Result: stage4Plans = [plan_v1] ← ユーザー編集が消える
```

---

### 原因D: executionPlanBaseline の orphaning

**証拠ファイル**: `/store/strategyStore.ts:3400-3410`

```typescript
// 初回 /okr 遷移時のみ
if (!s.executionPlanBaseline || !s.executionPlanBaseline.snapshot) {
  executionPlanBaseline = {
    companyId: s.companyId,
    createdAt: Date.now(),
    snapshot: JSON.parse(JSON.stringify(s.departments))  // Deep copy of departments
  };
}
```

**問題**:
- snapshot は初回作成後、**以降 STAGE3 再生成しても更新されない**
- snapshot内の projects 参照が dead links に
- restore 時に古い snapshot から復元される可能性

**Impact**:
- STAGE3再生成 → departments 新構成に
- executionPlanBaseline.snapshot → 古い構成のままコピー保持
- 後にこの snapshot から復元 → 古い project 構成に巻き戻る

---

### 原因E: 状態正本の曖昧性

**設計上の根本問題**:

```
STAGE3: departments が正本（STAGE3で更新）
STAGE4: stage4Plans が semi-正本（baseline = snapshot, current = edits）
STAGE5: departments を読むが、stage4Plans が古い可能性
DB保存: departments + stage4Plans 両方保存（不整合可能）

→ 複数の「準正本」が共存 → 同期漏れ
```

**なぜこうなったか**:
- STAGE4 baseline は「差分表示」のためのスナップショット設計
- しかし「差分対象の正本が変更された時の invalidation ルール」がない
- 結果：departments が ground truth だが、stage4Plans が「過去の departments」をキャッシュし続ける

---

## 2. 根本原因の優先度まとめ

| # | 根本原因 | 確度 | 症状 | 影響度 |
|----|---------|------|------|-------|
| **A** | STAGE3再生成時に stage4Plans 削除なし | ⭐⭐⭐⭐⭐ | 再生成後も baseline 旧 | CRITICAL |
| **B** | STAGE4 が部門構成変更未検知 | ⭐⭐⭐⭐⭐ | baseline 永遠に固定 | CRITICAL |
| **C** | merge 時 stage4Plans 保護なし | ⭐⭐⭐ | refetch で巻き戻し | HIGH |
| **D** | executionPlanBaseline orphan化 | ⭐⭐⭐ | 古い snapshot 復元 | HIGH |
| **E** | normalize.ts で stage4Plans 漏れ | ⭐⭐⭐⭐ | restore で削除される | **CRITICAL** |
| **F** | revision conflict silent | ⭐⭐ | UI feedback なし | MEDIUM |

**最高確度**: **仮説 A + B + E** の複合（これだけで完全に説明可能）

---

## 3. データフロー正本マッピング（現状と修正後）

### 現状（問題あり）

| データ | 保持元 | 読み込み元 | 更新トリガ | 問題 |
|-------|-------|---------|---------|------|
| departments | strategyStore + DB | STAGE3, STAGE5 | STAGE3再生成時 | ✅ primary |
| stage4Plans | strategyStore + DB | STAGE4 | STAGE4編集 + save | ❌ stale baseline |
| executionPlanBaseline | strategyStore + DB | (参照のみ) | 初回 /okr訪問 | ❌ orphaned |
| okrTargetScores | strategyStore | STAGE5 | OKR rating input | ⚠️ local-only |

**同期漏れ（複合）**:
1. STAGE3 updates departments
2. stage4Plans.baseline remains old（原因A)
3. STAGE3再生成時にクリアされない（原因B)
4. normalize で restore 時に消える（原因E)
5. Result: **完全な不整合**

### 修正後（期待される状態）

| データ | 保持元 | 読み込み元 | 更新トリガ | 整合性 |
|-------|-------|---------|---------|-------|
| departments | DB (primary) | STAGE3, STAGE4, STAGE5 | STAGE3再生成 | ✅ single source |
| stage4Plans | DB | STAGE4, (reference) | STAGE4編集時にクリア + reinit | ✅ derived, auto-refresh |
| commitHistory | DB | STAGE4 (read-only) | STAGE4 commit | ✅ immutable |
| okrTargetScores | DB | STAGE5 | OKR rating input | ✅ persisted |

**同期メカニズム**:
- STAGE3再生成 → departments 更新 → stage4Plans cleared
- STAGE4訪問 → departments から baseline fresh init
- STAGE5 → departments + okrTargetScores から display

---

## 4. 修正方針（優先順）

### 修正0: normalize.ts で stage4Plans / executionPlanBaseline を保持 [PRIORITY: CRITICAL]

**ファイル**: `/utils/supabase/normalize.ts:861-942`

**修正場所** (normalizeStrategyData の out 構築箇所):
```typescript
const out: StrategyData = {
  // ... existing fields ...
  departments,
  stage1Issues,
  stage1Benchmarks,
  // ★新規追加
  ...(Array.isArray(src.stage4Plans) ? { stage4Plans: src.stage4Plans } : {}),
  ...(src.executionPlanBaseline && typeof src.executionPlanBaseline === 'object'
    ? { executionPlanBaseline: src.executionPlanBaseline }
    : {}),
  // ... rest ...
};
```

**効果**:
- restore → normalize 時に stage4Plans が消えなくなる
- executionPlanBaseline が保護される
- 「保存したのに消える」という現象が解決

**実装タイミング**: 最初に実装（他の修正の前提）

---

### 修正1: STAGE3再生成時にstage4Plansを初期化 [PRIORITY: CRITICAL]

**ファイル**: `/app/cascade/page.tsx:2114-2120`

**修正前**:
```typescript
setDepartmentsInStore(mergedDepts);
// ❌ stage4Plans is not cleared
await saveNow();
```

**修正後**:
```typescript
setDepartmentsInStore(mergedDepts);
// ★新規追加
const state = useStrategyStore.getState();
if (state.stage4Plans && state.stage4Plans.length > 0) {
  console.warn('[fix:A] STAGE3再生成でstage4Plansをクリア');
  state.setStage4Plans(undefined);  // or []
}
await saveNow();
```

**効果**:
- STAGE4次回訪問時：selectedDept 変更 → baseline が fresh に再初期化される
- 古い baseline が表示されない

**注意**:
- STAGE4で既に編集中の場合、その編集は失われる（警告UI追加必要）

---

### 修正2: STAGE4で部門構成変更を検知し、baseline再初期化 [PRIORITY: HIGH]

**ファイル**: `/app/stage4/page.tsx:189-215`

**修正前**:
```typescript
useEffect(() => {
  if (!selectedDept) return;

  const deptId = String(selectedDept.id || selectedDept.name);
  const exists = localPlans.some((p) => p.departmentId === deptId);
  if (exists) return;  // ← 問題：構成変化を検知しない

  const baseline = createBaselineFromStage3(selectedDept);
  setStage4Plans([...localPlans, newPlan]);
}, [selectedDept, localPlans, setStage4Plans]);
```

**修正後**:
```typescript
// 新規：department hash を計算
const deptHash = useMemo(() => {
  if (!selectedDept) return '';
  return hashObject({
    id: selectedDept.id,
    name: selectedDept.name,
    projectCount: selectedDept.projects?.length,
    projectTitles: selectedDept.projects?.map((p: Project) => p.title),
  });
}, [selectedDept]);

useEffect(() => {
  if (!selectedDept) return;

  const deptId = String(selectedDept.id || selectedDept.name);
  const existingPlan = localPlans.find((p) => p.departmentId === deptId);

  // ★変更：hash が変わったら re-init
  if (existingPlan && existingPlan.deptHashAtCreation !== deptHash) {
    console.warn('[fix:B] 部門構成が変更。baseline再初期化', {
      oldHash: existingPlan.deptHashAtCreation,
      newHash: deptHash,
    });
    // baseline再初期化
    const newBaseline = createBaselineFromStage3(selectedDept);
    const updated = existingPlan;
    updated.baseline = newBaseline;
    updated.current = JSON.parse(JSON.stringify(newBaseline));
    setStage4Plans(localPlans.map((p) =>
      p.departmentId === deptId ? updated : p
    ));
    return;
  }

  if (!existingPlan) {
    // 初回作成
    const baseline = createBaselineFromStage3(selectedDept);
    const newPlan: Stage4Plan = {
      departmentId: deptId,
      status: 'Draft',
      baseline,
      current: JSON.parse(JSON.stringify(baseline)),
      deptHashAtCreation: deptHash,  // ★ hash記録
      updatedAt: new Date().toISOString(),
    };
    setStage4Plans([...localPlans, newPlan]);
  }
}, [selectedDept, deptHash, localPlans, setStage4Plans]);

// Helper function
function hashObject(obj: any): string {
  return require('crypto')
    .createHash('sha256')
    .update(JSON.stringify(obj))
    .digest('hex');
}
```

**効果**:
- STAGE3再生成で部門構成変更 → hash 不一致検知 → baseline 自動再初期化
- ユーザーが aware（console warn）
- current は fresh に再構築（編集は失われるが、新しい baseline に基づく）

**型拡張**:
```typescript
// types/strategy.ts
export type Stage4Plan = {
  departmentId: string;
  status: 'Draft' | 'Review' | 'Approved';
  baseline: Stage4Baseline;
  current: Stage4Current;
  deptHashAtCreation?: string;  // ★ 新規追加
  updatedAt?: string;
  updatedBy?: string;
};
```

---

### 修正3: merge 時にstage4Plansを保護 [PRIORITY: HIGH]

**ファイル**: `/store/strategyStore.ts:3508-3520`

**修正前**:
```typescript
const merged: any = {
  ...(base as any),
  ...(patch as any),
  // Protection for specific fields
  stage1Benchmarks: (patch as any).stage1Benchmarks ?? (base as any).stage1Benchmarks,
  // ❌ stage4Plans no protection
};
```

**修正後**:
```typescript
const merged: any = {
  ...(base as any),
  ...(patch as any),
  // Protection for specific fields
  stage1Benchmarks: (patch as any).stage1Benchmarks ?? (base as any).stage1Benchmarks,
  answers12: (patch as any).answers12 ?? (base as any).answers12,
  winPatternsCandidate: (patch as any).winPatternsCandidate ?? (base as any).winPatternsCandidate,
  // ★新規追加：stage4Plans protection
  stage4Plans: (patch as any).stage4Plans ?? (base as any).stage4Plans,
  executionPlanBaseline: (patch as any).executionPlanBaseline ?? (base as any).executionPlanBaseline,
};
```

**効果**:
- refetch時に patch が不完全でも、base の stage4Plans が保護される
- 巻き戻し防止

---

### 修正4: restore 時に orphan stage4Plans を削除 [PRIORITY: MEDIUM]

**ファイル**: `/utils/persist/restoreWithAudit.ts:195-210`

**修正前**:
```typescript
let hydratedState = normalizeStrategyData(dbData);
hydratedState = {
  ...hydratedState,
  revision: dbData.revision ?? hydratedState.revision,
  strategyId: dbData.id ?? hydratedState.strategyId,
};
return hydratedState;  // ← stage4Plans orphans check なし
```

**修正後**:
```typescript
let hydratedState = normalizeStrategyData(dbData);
hydratedState = {
  ...hydratedState,
  revision: dbData.revision ?? hydratedState.revision,
  strategyId: dbData.id ?? hydratedState.strategyId,
};

// ★新規追加：stage4Plans orphan validation
if (hydratedState.stage4Plans && hydratedState.departments) {
  const validDeptIds = new Set(
    hydratedState.departments.map((d) => d.id || d.name)
  );

  hydratedState.stage4Plans = hydratedState.stage4Plans.filter((plan) => {
    if (!validDeptIds.has(plan.departmentId)) {
      console.warn('[restore:orphan] Removing orphan stage4Plan:', {
        departmentId: plan.departmentId,
        validIds: Array.from(validDeptIds),
      });
      return false;
    }
    return true;
  });
}

return hydratedState;
```

**効果**:
- restore時に departments と stage4Plans の整合性を check
- 古い plan が復元されても、対応部門が存在しなければ削除
- orphan prevent

---

### 修正5: executionPlanBaseline を STAGE3再生成時に更新 [PRIORITY: MEDIUM]

**ファイル**: `/app/cascade/page.tsx:2120-2130`

**修正追加**:
```typescript
// ★新規追加：executionPlanBaseline をリセット
if (state.executionPlanBaseline) {
  console.warn('[fix:D] executionPlanBaseline をリセット（STAGE3再生成）');
  state.setExecutionPlanBaseline(undefined);  // Reset to re-init on next /execution visit
}
```

**効果**:
- STAGE3再生成後、executionPlanBaseline は古い snapshot を削除
- STAGE5次回訪問時に fresh なスナップショットが作成される

---

### 修正6: revision / restore race の UI feedback [PRIORITY: MEDIUM]

**ファイル**: `/store/strategyStore.ts:1360-1400` (saveStrategyData 完了後)

**追加**:
```typescript
// save完了時に revision を反映
const result = await saveWithAudit(
  'cascade',
  companyId,
  userId,
  state,
  { reason: 'save', ...options }
);

if (result.status === 'conflict') {
  // ★conflict 時は UI に alert
  console.error('[save:conflict]', result);
  throw new Error(`保存競合: 別のユーザーが変更しました。リロードして再度変更してください。`);
} else if (result.revisionBefore && result.revisionAfter) {
  // revision が更新された場合、store に reflect
  set({ revision: result.revisionAfter });
  console.log('[save:success]', {
    revisionBefore: result.revisionBefore,
    revisionAfter: result.revisionAfter,
  });
}
```

**UI側**:
```typescript
// SaveStatusIndicator で conflict 表示
{saveError && (
  <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3">
    {saveError}
    <button onClick={handleReload}>リロード</button>
  </div>
)}
```

**効果**:
- revision conflict が silent に処理されず、ユーザーに通知
- 巻き戻しリスク軽減

---

## 5. 修正の実装順序

| # | 修正項目 | 優先度 | 所要時間 | 依存関係 |
|----|---------|--------|---------|---------|
| 0 | normalize.ts で stage4Plans 保持 | CRITICAL | 30min | なし（最初） |
| 1 | STAGE3再生成時に stage4Plans クリア | CRITICAL | 30min | 0の後 |
| 2 | STAGE4 baseline hash検知 + reinit | HIGH | 2h | 1の後 |
| 3 | merge 時に stage4Plans 保護 | HIGH | 1h | 0の後 |
| 4 | restore 時 orphan validation | MEDIUM | 1h | 0,1,2の後 |
| 5 | executionPlanBaseline リセット | MEDIUM | 30min | 1の後 |
| 6 | revision conflict の UI feedback | MEDIUM | 1.5h | なし |

**推奨実装順**:
**0 → 1 → 3 → 2 → 5 → 4 → 6**

理由:
- **0: 最初に実施**（normalize.ts 修正は全部品の基盤）
- 1,3: 並行可能（1はcascade page、3は store）→ 1 → 3 順で
- 2: 1の後（baseline hash tracking）
- 5: 1と同じ restoration context
- 4: 全体が整った後（orphan 検証は最後の safety check）
- 6: UX向上は最後

---

## 6. 検証項目（修正後の確認）

### 必須検証

**V1. STAGE3再生成 → STAGE4で新構成が見える**

```
Pre: STAGE3 projects = [P1, P2]
Action: Regenerate → [P1_v2, P2_v2, P3_new]
Post:
  - STAGE4訪問
  - baseline.projects.count === 3 ✅
  - baseline.projects[2].title === "P3_new" ✅
```

**V2. STAGE4編集が保存・復元される**

```
Action: STAGE4 で project title "A" → "A_edit"
Save → HTTP 200, revision incremented
Reload → title === "A_edit" ✅
```

**V3. STAGE5で新プロジェクト表示**

```
Pre: STAGE3 regen (新project追加)
Action: STAGE5訪問
Result: 新project の ProjectCard が表示される ✅
```

**V4. revision conflict が UI に出る**

```
Action:
  T0: STAGE3 save (revision 10 → 11)
  T1: STAGE4 edit with local revision 10
  T2: STAGE4 save attempt
Result: Error message displayed to user ✅
```

### 望ましい検証

**V5. baseline vs current の差分表示が正しい**

```
baseline: [P1, P2]
current: [P1_edit_title, P2_edit_kpi, P3_new]
DiffViewer:
  - P1: title changed ✅
  - P2: kpi changed ✅
  - P3: new ✅
```

**V6. STAGE4 commit ロジックが動作**

```
Action: STAGE4 で "確定" ボタン
Result:
  - status: Draft → Review/Approved
  - stage4Plans で committedAt timestamp 記録 ✅
```

---

## 7. 残課題・将来改善

### 短期（修正直後）

- [ ] ユーザーへの通知：「STAGE3再生成でSTAGE4の下書きはリセットされます」
- [ ] STAGE4 UI：baseline 破棄に対する確認ダイアログ
- [ ] ログ整備：[diag][...] ログを本番では info level に downgrade

### 中期（1-2ヶ月後）

- [ ] STAGE4/5 の state 正本を departments に一元化
  - stage4Plans は「確定済み content」のみ保持
  - draft content は local-only に
- [ ] revision hash を departments に付与（整合性 check 自動化）
- [ ] executionPlanBaseline を廃止（departments から直接 derive）

### 長期（設計リファクタ）

- [ ] STAGE3/4/5 の state 構造を再設計
  - departments: immutable source of truth
  - stage4Plans: committed snapshots のみ
  - okrTargetScores: append-only log
- [ ] Event Sourcing パターン導入
  - departments の変更履歴（commit log）
  - stage4Plans の編集履歴（draft log）
- [ ] 複数ユーザーの並行編集 support
  - CRDTベースの conflict-free merge

---

## 8. 最終チェックリスト（修正実装時）

修正を実装する前に、以下を確認：

- [ ] **修正0: normalize.ts** で stage4Plans/executionPlanBaseline の追加場所を特定
- [ ] **修正0の後**: restore → normalize の流れで消えないことをテスト
- [ ] 修正1 のコード書き換え場所を特定（cascade/page.tsx:2114-2120）
- [ ] 修正2 で Stage4Plan に deptHashAtCreation を追加、型更新確認
- [ ] 修正3 で merge ロジックが store.ts:3508-3513 で protection 入っているか確認
- [ ] 修正4 で orphan detection ロジックが DB query と整合するか確認
- [ ] 修正5 で executionPlanBaseline の初期化タイミング（修正1の直後）確認
- [ ] 修正6 で saveError state が SaveStatusIndicator で反映されるか確認
- [ ] 全修正後、再現テストケース A-D が PASS するか確認（docs/investigation/stage3-stage5-repro.md）
- [ ] 本番 deploy 前に stage 環境での smoke test（ケースA: 編集→保存→リロード）

---

## 9. リスク評価

### 修正0のリスク

**Risk**: normalize.ts の修正で意図しない副作用が出る

**Mitigation**:
- stage4Plans / executionPlanBaseline は「透過的に保持する」だけ
- 値の正規化・検証は他の関数で実施
- test: restore → normalize → store に反映後、値が同一か確認

### 修正1のリスク

**Risk**: STAGE4 で編集中のデータが削除される

**Mitigation**:
- 削除前に console.warn で alert
- STAGE3再生成時に dialog で「STAGEの下書きがリセットされます」と事前通知
- STAGE4 再訪問時に「前回のバージョン」を localStorage cache から復元可能にする（オプション）

### 修正2のリスク

**Risk**: hash 計算が重い / 計算漏れ

**Mitigation**:
- hash object は shallow（title array のみ）
- useMemo で memoize
- unit test で hash stability を確認

### 修正3のリスク

**Risk**: merge ロジックが複雑化

**Mitigation**:
- 既に他フィールドで protection が実装されているため、pattern に従うだけ
- 他の ?? operations と consistency check

### 修正4のリスク

**Risk**: orphan check で正当な plan が削除される

**Mitigation**:
- validDeptIds = set(departments.map(d => d.id || d.name))
- test で department ID の stability を確認

---

## 10. 結論

この複合的な修正により：

1. **反映不良（再生成後 STAGE4/5 に反映されない）** → 解決
   - 原因: stage4Plans 未初期化
   - 修正: STAGE3再生成時にクリア + hash watch で baseline reinit

2. **保存事故（STAGE4 編集が保存されない）** → 解決
   - 原因: merge 時の stage4Plans 保護なし
   - 修正: merge 時に ?? で protection 追加

3. **恒久対策（再読込・遷移での断点排除）** → 実現
   - 原因: departments と stage4Plans の同期漏れ
   - 修正: 複数の同期ポイント（regen時、hash watch、merge、restore）でカバー

**最重要メッセージ**:
> departments が ground truth。stage4Plans は derived state。STAGE3で dependencies が変わったら自動 invalidate する。

この原則を実装することで、future の STAGE3 機能追加でも同様の問題は起きなくなる。
