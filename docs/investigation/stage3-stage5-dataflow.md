# STAGE3/STAGE5 Data Flow Investigation Report

## 実行要約

GROWTHアプリケーションの STAGE3（部門戦略再生成）から STAGE5（実行支援）にかけて、**複数の状態分岐とデータ同期漏れ** が発見されました。特に以下の3つの根本問題により、再生成内容が STAGE4/5 に反映されず、STAGE4 編集が保存されない状態が発生しています。

---

## 1. データの一本線の実態

### 1.1 STAGE3（Cascade/部門戦略再生成）

**機能**: ユーザーが「回答を反映して再生成」をクリック

**実装位置**: `/app/cascade/page.tsx:2100-2167`

**フロー**:
```
UI: "回答を反映して再生成" clicked
  ↓
API Call: POST /api/generate-cascade
  ↓ (AI生成)
Response: { lanes: { existing: [...], new: [...] } }
  ↓
Merge: applyDeptDraftToProjects(existingDepts, laneMerge, preserveOkrs=false)
  ↓
Store Update: setDepartmentsInStore(mergedDepts)
  ↓
Save: saveNow() → Saves to DB
```

**状態更新対象**:
- ✅ `strategyStore.departments` → 新しいプロジェクト構成に更新
- ❌ `strategyStore.stage4Plans` → **更新されない（重大）**
- ❌ `strategyStore.executionPlanBaseline` → **更新されない（重大）**
- ✅ DB（revision 増加）

**Source of Truth（この段階）**:
- Primary: `strategyStore.departments` + DB
- Orphaned: `stage4Plans`（更新されないまま古い値を保持）

---

### 1.2 STAGE4（OKR/実行計画策定）

**機能**: 部門を選択 → Baselineを表示 → プロジェクト編集 → 保存

**実装位置**: `/app/stage4/page.tsx`

**データ読み込みフロー**:
```
Page Load
  ↓
useEffect: loadAndHydrate(companyId)
  ↓
useStrategyStore.departments から departments 取得
  ↓
selectedDeptId 選択時
  ↓
useEffect (line 189-215):
  if (!plan exists for this dept) {
    baseline = createBaselineFromStage3(selectedDept)  ← 現在の departments から生成
    stage4Plans = [..., newPlan]
    setStage4Plans(localPlans)
  }
```

**Baseline 初期化**:
```typescript
function createBaselineFromStage3(dept: Department): Stage4Baseline {
  return {
    projects: dept.projects.map(p => ({
      title: p.title,
      kpiTargets: extractKpiTargets(p),
      skillRequirements: p.skillRequirements,
      humanInvestments: p.humanInvestments,
      valueDriverLinks: p.valueDriverLinks
    }))
  };
}
```

**編集時**:
```
User edits project name/KPI/skills in STAGE4
  ↓
updateCurrent() called
  ↓
stage4Plans[i].current updated (local state + store)
  ↓
useAutoSave() triggers save
```

**保存ペイロード構成**:
```typescript
// strategyStore.ts buildSavePayload() line 832-833
const base: any = {
  // ... other fields ...
  stage4Plans: s.stage4Plans,                    // ✅ 含まれる
  executionPlanBaseline: s.executionPlanBaseline, // ✅ 含まれる
};
```

**Source of Truth**:
- Primary: `stage4Plans` (local store)
  - `stage4Plans[i].baseline` ← STAGE3の当時のスナップショット
  - `stage4Plans[i].current` ← STAGE4での編集値
- Fallback: `departments` (read-only, STAGE3から読み込み)

**重大な問題**:
- ❌ STAGE3 再生成後も baseline は**更新されない**
- ❌ baseline が指す projects は古い内容のまま固定
- ❌ current での編集内容と baseline のズレが広がる

---

### 1.3 STAGE5（Execution/実行支援）

**機能**: プロジェクト進捗表示 → 北極星売上寄与率表示 → OKR進捗管理

**実装位置**: `/app/execution/page.tsx:960-1072`

**データ読み込みフロー**:
```
Page Load
  ↓
useEffect: loadAndHydrate(companyId)
  ↓
useStrategyStore から departments + editableCascadeResult 取得
  ↓
cascade = useMemo(() =>
  departments.length > 0
    ? departments  ← STAGE3データを直接使う
    : editableCascadeResult
)
  ↓
cascade[di].projects[pi] から表示データ抽出
  ↓
User が OKR進捗/フィードバック入力
  ↓
saveStrategyData() → DB保存
```

**表示対象データ**:
```
For each project:
  - Project title, okrsV2, milestones, impactRevenue...
  - OKRs: from okrsV2 (KRStructured[])
  - KPIs: from kpis string array
  - Milestones: from planMilestones
  - Impact: impactRevenueMJPY, impactOpIncomeMJPY
```

**進捗保存ロジック**:
```typescript
// lines 319, 379
const okrId = okrKey(di, pi, oi, okr);
useStrategyStore.getState().setOKRTargetScore(okrId, rating);
await useStrategyStore.getState().saveStrategyData({ reason: 'manual' });
```

**Source of Truth**:
- Primary: `departments` (STAGE3からの最新值)
- Read-only: `editableCascadeResult` (fallback)
- Progress tracking: `okrTargetScores` (store側で別管理)

**問題**:
- ❌ STAGE3 再生成時に departments は更新されるが、stage4Plans は古いまま
- ❌ STAGE4 で編集した内容（skillPlans など）が STAGE5 に見えない
- ❌ departments が新構成でも、stage4Plans が旧構成のままなら不整合

---

## 2. Save/Restore の流れ（revision と競合処理）

### 2.1 Save Payload の構成

**Location**: `/utils/persist/saveWithAudit.ts:117-200`

```typescript
async function saveWithAudit(
  stage: string,
  companyId: string,
  effectiveUserId: string,
  data: StrategyData,
  options?: SaveOptions
): Promise<AuditResult>
```

**Payload構成**:
```typescript
// buildSavePayload() → strategyStore.ts:820-850
const base: any = {
  company_id: companyId,
  user_id: userId,
  thought: data.thought,
  mission: data.mission,
  vision: data.vision,
  // ... MVV/SWOT/财務など ...
  departments: data.departments,              // ✅ STAGE3 structure
  stage4Plans: data.stage4Plans,              // ✅ 含まれる
  executionPlanBaseline: data.executionPlanBaseline,  // ✅ 含まれる
  revision: data.revision,                    // ✅ Revision included
  // ... その他 ...
};
```

**問題点**:
- ✅ stage4Plans はペイロードに含まれている
- ❌ しかし STAGE3 再生成時に stage4Plans が消去されていないため、古い内容が保存される可能性
- ❌ departments のみ新になり、stage4Plans は古いままという状態で保存される

### 2.2 Revision と競合処理

**Location**: `/utils/persist/saveWithAudit.ts:127-165`

```typescript
// Save時のrevision check
if (revisionBefore && revisionAfter && revisionAfter < revisionBefore) {
  console.error('[audit][save:warning] REVISION_ROLLBACK_DETECTED!', {
    revisionBefore,
    revisionAfter,
  });
  // ⚠️ ただし、このログは出ても処理を止めていない可能性
}
```

**シナリオ（競合シナリオ）**:
```
Time T0: STAGE4 で plan 編集中（local revision=5）
  stage4Plans.current = {project_v1...}

Time T1: STAGE3 で再生成実行
  departments更新 → DB保存（revision → 6）

Time T2: STAGE4 で保存試みる
  建出 revision mismatch（ローカルrevision=5, DB=6）
  ⚠️ API reject or silent override?
```

**Restore ロジック** (`/utils/persist/restoreWithAudit.ts:115-210`):
```typescript
export async function restoreWithAudit(
  stage: string,
  effectiveCompanyId: string,
  options?: { allowSnapshot?: boolean }
): Promise<RestoreDecision>
```

**復元優先順**:
1. DB data（MVV存在チェック）
2. Store data（DB empty時）
3. LocalStorage snapshot（stage1/stage2のみ）

**stage4Plans の復元**:
- ✅ DB に保存されていれば復元される
- ❌ しかし復元時に「baseline が orphaned していないか」の検証がない
- ❌ 古いbaseline が復元された場合、current projects と対応していない可能性

---

## 3. データ流失ポイント（Gap Analysis）

### Gap A: STAGE3 再生成 → stage4Plans 未初期化

**詳細**:
```
cascade/page.tsx:2114-2116
// setDepartmentsInStore() 呼び出し後
setDepartmentsInStore(mergedDepts);  // ← departments は更新
// ⚠️ stage4Plans は setStage4Plans() されていない
// → 古い baselineが保持される
```

**Impact**:
- STAGE4 初回訪問時：新department構成が見える（OK）
- STAGE4 すでに plan 存在時：古い baseline のまま（NG）
- Result: **baseline は旧 projects を参照し続ける**

### Gap B: STAGE4 → 部門構成変更の検知なし

**詳細**:
```
stage4/page.tsx:189-215
useEffect(() => {
  // 依存array: [selectedDept, localPlans, setStage4Plans]
  // selectedDept.projects の「構成変化」を検知しない
  // 単に「selectedDept が変わった」のみ
}, [...]);
```

**解決策がない**:
- departments hash / revision を追跡していない
- STAGE3 で再生成 → departments 変更されても、useMemo は内容を深く比較しない
- 結果：baseline は初回のまま

### Gap C: stage4Plans が merge 時に失われる可能性

**Location**: `/store/strategyStore.ts:3508-3513`

```typescript
const merged: any = {
  ...(base as any),
  ...(patch as any),  // ← patch が base を上書き
  // Protection for stage1Benchmarks, answers12, winPatternsCandidate added
  // ⚠️ stage4Plans の protection なし
};
```

**Scenario**:
- refetchFromServer() 呼び出し時
- patch に stage4Plans なし → base の stage4Plans が上書きされる
- または patch に古い stage4Plans → 巻き戻る

### Gap D: executionPlanBaseline の orphaning

**詳細**: `executionPlanBaseline` は「初回 /okr 遷移時のスナップショット」を保持
```typescript
// strategyStore.ts:3403
if (!s.executionPlanBaseline || !s.executionPlanBaseline.snapshot) {
  executionPlanBaseline = {
    companyId: s.companyId,
    createdAt: Date.now(),
    snapshot: JSON.parse(JSON.stringify(s.departments))  // Deep copy
  };
}
```

**問題**:
- ✅ 初回は正しく作成される
- ❌ STAGE3 再生成後も **snapshot は更新されない**
- ❌ snapshot 内の projects が deletedになってもそのまま
- ❌ 後にこのsnapshot から復元する際、dangling references

---

## 4. 根本原因の切り分け

| 仮説 | 推定度 | 根拠 | 現象との対応 |
|------|------|------|----------|
| **A: 別 state を見ている** | ⭐⭐⭐⭐⭐ | STAGE3は departments更新、STAGE4 は stage4Plans参照。両者は別構造。STAGE3再生成で departments は更新されるが stage4Plans は放置される。 | 再生成後に STAGE4 baseline が旧内容のまま → 別 state 説が確定 |
| **B: baseline スナップショット更新忘れ** | ⭐⭐⭐⭐⭐ | stage4/page.tsx:189-215 で baseline は「selectedDept が変わった時のみ」初期化。以降は fixed。STAGE3 再生成で dept更新 → baseline は再初期化されない。 | 再生成後も baseline は旧 projects 参照 → 確定 |
| **C: save payload に乗っていない** | ⭐ | strategyStore.ts:832-833 で stage4Plans は payload に明示的に含まれている。ただし STAGE3再生成時に消去されていないため、古い内容が保存される。 | payload 検証で含まれることを確認 |
| **D: restore race / 巻き戻し** | ⭐⭐⭐ | refetch 時に merge 処理で stage4Plans protection なし。古い stage4Plans が restore されうる。 | merge ロジック検査で protection 欠落を確認 |
| **E: project id 破損** | ⭐⭐ | AI再生成で project id は uuid 採番のため毎回異なる可能性あり。ただし title ベースの matching で対応している。 | title matching で対応しているため priority低い |

**最高確度**: **仮説 A + B** の複合が原因。STAGE3 再生成時に stage4Plans が初期化されず、baseline が古いまま固定化される。

---

## 5. 必須となる修正

### Fix1: STAGE3 再生成時に stage4Plans を初期化

**場所**: `/app/cascade/page.tsx:2114-2116`

```typescript
// 現在（問題）
setDepartmentsInStore(mergedDepts);
// ↓ 修正後
setDepartmentsInStore(mergedDepts);
setStage4Plans(undefined);  // ← clear stage4Plans
```

**Effect**:
- STAGE4 次回訪問時：plan new で fresh baseline が生成される
- STAGE4 既存編集内容：失われる（警告必要）

### Fix2: 部門構成変更検知メカニズムの追加

**案A**: revision hash 追跡
```typescript
// stage4/page.tsx で
const deptHash = useMemo(() =>
  hashObject(departments),
  [departments]
);

useEffect(() => {
  if (selectedPlan && deptHash !== selectedPlan.deptHashAtBaseline) {
    showWarning('部門構成が変更されました。baseline を再生成してください。');
  }
}, [deptHash, selectedPlan]);
```

### Fix3: merge 時の stage4Plans 保護

**場所**: `/store/strategyStore.ts:3508-3513`

```typescript
const merged: any = {
  ...(base as any),
  ...(patch as any),
  stage4Plans: (patch as any).stage4Plans ?? (base as any).stage4Plans,  // ← 保護追加
};
```

### Fix4: restore 時の orphan 検証

**場所**: `/utils/persist/restoreWithAudit.ts:195-210`

```typescript
// 復元後
const hydratedState = normalizeStrategyData(dbData);

// ★ 追加: stage4Plans の orphan 検証
if (hydratedState.stage4Plans) {
  hydratedState.stage4Plans = hydratedState.stage4Plans.filter(plan => {
    const dept = hydratedState.departments?.find(d =>
      (d.id || d.name) === plan.departmentId
    );
    if (!dept) {
      console.warn('[restore] orphan stage4Plan removed:', plan.departmentId);
      return false;  // remove orphan
    }
    return true;
  });
}
```

---

## 6. 検証対象

以下の条件下で、データフロー断点を確認すること：

1. **STAGE3 再生成前後で departments が変更される**
   - 新プロジェクト追加（新 project id）
   - プロジェクト削除
   - プロジェクト名変更

2. **STAGE4 baseline と current のズレを監視**
   - 再生成直後に STAGE4 訪問 → baseline は旧か新か
   - 編集後に reload → current は保持されるか

3. **STAGE5 表示内容**
   - STAGE3 再生成後、STAGE5 で新プロジェクト見えるか
   - STAGE4 で編集した skillPlans は見えるか

4. **保存ペイロードの完全性**
   - save 直前に console.log で stage4Plans の内容確認
   - DB保存後に fetch で確認

---

## 結論

**根本原因**: STAGE3 再生成時に `stage4Plans` が初期化されず、`baseline` が古い department 構成のまま固定される。その結果：
- STAGE3 の新構成が STAGE4 baseline に反映されない
- STAGE4 編集内容（current）と baseline が乖離
- STAGE5 でも古い project 構成が操作対象になる

**修正優先度（降順）**:
1. **HIGH**: STAGE3 再生成時に stage4Plans をクリア
2. **HIGH**: merge 時の stage4Plans 保護
3. **MEDIUM**: 部門構成変更検知ロジック
4. **MEDIUM**: restore 時の orphan 検証
