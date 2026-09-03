# 全STAGE 横断監査：cross-device persistence リスク
**調査日**: 2026-09-03  
**対象**: STAGE1 ～ STAGE6 のすべてのページ

---

## 監査結果サマリー

| **STAGE** | **Store** | **Persist** | **DB Override Risk** | **UPDATE on Open** | **判定** |
|-----------|---------|---------|---|---|---|
| **STAGE1** | strategyStore (v38) | YES | LOW | NONE | ✅ 問題なし |
| **STAGE2** | strategyStore (v38) | YES | NONE | NONE | ✅ 修正完了 |
| **STAGE3** | strategyStore (v38) | YES | MEDIUM | LOW | ⚠️ 同種リスク |
| **STAGE4** | strategyStore (v38) | YES | LOW | NONE | ✅ 問題なし |
| **STAGE5** | strategyStore (v38) | PARTIAL | NONE | NONE | ✅ 問題なし |
| **STAGE6** | strategyStore (v38) | YES | MEDIUM | LOW | ⚠️ 同種リスク |

---

## 詳細監査結果

### ✅ STAGE1：問題なし

**使用 store**: `useStrategyStore` (v5, v38)

**Zustand persist**: YES - persist middleware active

**localStorage 業務データ**:
- financePL, financeBS, segmentPL, segmentBS
- stage1Benchmarks, companyName, industry, businessSegments
- isListed, ticker, pbrManual

**DB restore データ**:
- 全 STAGE1 財務データ + ベンチマーク
- getFullStrategyDataByCompany → normalizeStrategyData

**autosave**: YES
- useAutoSave hook mounted
- requireHydrated: true
- mode: payload, debounce: 1200ms

**hydrate時 dirty リスク**: **LOW**
- setHydrated() が明示的に dirty=false を set（line 1931）
- version bump なし（restore中）

**別端末の旧localStorage が DB を上書きする可能性**: **LOW**
- 全財務データは DB-first restore
- localStorage は cache のみ
- fallback: stage1DummyDataBundle

**ページを開いただけで UPDATE**: **NONE**
- restore は 1 回のみ
- 以降は manual save のみ

**判定**: ✅ **問題なし**

---

### ✅ STAGE2：修正完了（v38）

**使用 store**: `useStrategyStore` (v5, v38)

**Zustand persist**: YES - 但し**finalStory* は除外**（v38 で修正）

**localStorage 業務データ**（修正後）:
- ✅ KEPT: storyDraft, answers12, ceoIntent, winPatternsCandidate, companyTargets
- ❌ EXCLUDED: finalStory, finalStoryDraft, finalStoryEdited, finalStoryFinal

**DB restore データ**:
- finalStory, finalStoryDraft, finalStoryEdited, finalStoryFinal
- answers12, stage2FinalDocumentEdits

**migrate 関数（v38）での処理**（line 4916-4938）:
```typescript
// ★ FIX (v38): Clear all STAGE2 Final Story fields from old localStorage
(migrated as any).finalStory = undefined;
(migrated as any).finalStoryDraft = undefined;
(migrated as any).finalStoryEdited = undefined;
(migrated as any).finalStoryFinal = undefined;
```

**autosave**: YES - requireHydrated: true, 1200ms debounce

**hydrate時 dirty リスク**: **NONE**
- setHydrated() が dirty=false を set（line 1931）
- migrate() で finalStory* を明示的に破棄

**別端末の旧localStorage が DB を上書きする可能性**: **NONE**
- v38 migrate で全 finalStory* field を破棄
- DB が Final Story の単一 source of truth

**ページを開いただけで UPDATE**: **NONE**
- finalStory* が localStorage に残らない
- DB restore のみで正常な値に置き換わる

**判定**: ✅ **FIXED - 問題なし**

**本番テスト**: ✅ PASSED
- 別端末で STAGE2 を開くだけで updated_at が変わらない確認済み

---

### ⚠️ STAGE3（cascade）：同種リスクあり

**使用 store**: `useStrategyStore` (v5, v38)

**Zustand persist**: YES
- departments（全 projects/OKRs 構造）
- stage3_strategy_bridge（keyThemes, strategicCore, departmentIssues）

**localStorage 業務データ**:
- departments[].projects[].okrs[]
- stage3_strategy_bridge（生成結果）

**DB restore データ**:
- departments, projects, OKRs
- stage3_strategy_bridge（DB の確定版）

**autosave**: YES - useAutoSave hook at line 2355

**existing guard（saveStrategyData）**（line 3801-3824）:
```typescript
if (payload.stage3_strategy_bridge && !payload.stage3_strategy_bridge.strategicCore) {
  const currentBridge = get().stage3_strategy_bridge;
  if (currentBridge?.strategicCore) {
    (payload).stage3_strategy_bridge = currentBridge; // 不完全を完全版で置き換え
  }
}
```

**リスク分析**: **MEDIUM - 同種リスク存在**

**具体的問題**:
1. 別端末の old localStorage に古い departments（5 projects）が残っている
2. 新端末の DB には新しい departments（3 projects、最新）がある
3. ページを開く → localStorage が先に restore
4. UI に old projects（5 個）が表示される（DB restore まで）
5. ネットワーク遅延で 500ms 以上 stale 状態が続く

**existing guards で保護されていない部分**:
- Bridge 完全性チェックは **save 時** のみ
- Page load 時に **old departments が表示される** ことは防げない
- orphan cleanup（stage4Plans 向け）は departments 自体には適用されない

**判定**: ⚠️ **同種リスク - 検証と修正案が必要**

---

### ✅ STAGE4（OKR）：問題なし

**使用 store**: `useStrategyStore` (v5, v38)

**Zustand persist**: YES
- stage4Plans（departmentId, status, baseline, current）
- departments（STAGE3 からの cascade）

**DB restore 時の orphan cleanup**（line 251-267）:
```typescript
const validDeptIds = new Set(
  hydratedState.departments.map((d: any) => d.id || d.name)
);
hydratedState.stage4Plans = hydratedState.stage4Plans.filter((plan: any) => {
  if (!validDeptIds.has(plan.departmentId)) {
    console.warn('[restore:orphan] Removing orphan stage4Plan:', {
      departmentId: plan.departmentId,
    });
    return false;
  }
  return true;
});
```

**guard の効果**:
- old localStorage の stage4Plans が検証される
- 無効な departmentId への参照は削除される
- DB からの fresh departments と同期

**判定**: ✅ **問題なし - guard が機能**

---

### ✅ STAGE5（execution）：問題なし

**使用 store**: `useStrategyStore` (v5, v38)

**Zustand persist**: PARTIAL
- departments, projects, OKRs（部門 cascade から）
- **okrTargetScores は persist されない**（partialize に含まれない）

**okrTargetScores**:
- DB のみから取得（restore 時）
- localStorage には保存されない
- transient data として正しく扱われている

**autosave**: YES - execution page at line 22

**hydrate時 dirty**: **LOW**
- setHydrated() が dirty=false を set
- okrTargetScores は localStorage から復元されないので競合なし

**判定**: ✅ **問題なし - transient data 正しく処理**

---

### ⚠️ STAGE6（financial simulation）：同種リスクあり

**使用 store**: `useStrategyStore` (v5, v38)

**Zustand persist**: YES
- simulationResult（projection, finalProb, krsSnapshot）
- csvFinanceData, financeSummary, businessPortfolio
- projectTargetImpacts, projectIssueLinks

**simulationResult 構造**（line 105-115）:
```typescript
{
  projection: {
    points: { year: string; sales: number; op: number; opMargin: number }[];
  };
  finalProb: number;
  krsSnapshot?: any[];
  meta?: { label?: string; note?: string };
}
```

**リスク分析**: **MEDIUM - 同種リスク存在**

**具体的問題**:
1. Device A で financial simulation を生成 → simulationResult が localStorage に保存
2. Device B で STAGE1 財務データが更新される
3. Device C が execution ページを開く
4. old simulationResult（old assumptions に基づく）が localStorage から先に復元
5. DB からの fresh simulationResult が到着するまで、古い financial projections が表示
6. ネットワーク遅延で 500ms 以上 stale

**guard がない**:
- STAGE3 のような bridge completeness check なし
- simulationResult のタイムスタンプ/version 検証なし

**判定**: ⚠️ **同種リスク - 修正案が必要**

---

## クリティカル発見

### 1. STAGE2 は完全に修正された
- v38 migration で finalStory* を完全に除外
- 本番テストで確認済み
- 別端末での cross-device persistence 問題は解決

### 2. STAGE3 と STAGE6 に同様リスク
- **STAGE3**: old departments/projects が表示される可能性
- **STAGE6**: old financial simulation が表示される可能性
- いずれも「UI に stale data が表示される」リスク（DB update リスクではなく）

### 3. STAGE4 は proper guard を持つ
- orphan cleanup が機能している
- 他のコンポーネントの参考例

### 4. STAGE5 は clean
- okrTargetScores を persist から除外
- transient data を正しく扱っている

---

## 修正が必要な STAGE

### STAGE3: page load 時の bridge validation

**問題**: old departments が localStorage から復元される

**修正案**:
```typescript
// STAGE3 page.tsx の useEffect で追加
useEffect(() => {
  const strategy = useStrategyStore.getState();
  
  // Bridge が incomplete なら DB から再取得
  if (strategy.stage3_strategy_bridge && 
      !strategy.stage3_strategy_bridge.strategicCore) {
    console.warn('[STAGE3] Incomplete bridge from localStorage, waiting for DB...');
    // DB restore が自動的に上書きするまで待機
  }
}, []);
```

**または**: simulationResult と同様に persist から除外

---

### STAGE6: simulation result の鮮度チェック

**問題**: old financial simulation が表示される

**修正案 A**: simulationResult を persist から除外
```typescript
// store/strategyStore.ts partialize から削除
// simulationResult: s.simulationResult, // ← DELETE
```

**修正案 B**: timestamp validation を追加
```typescript
// execution page load 時に
const sim = useStrategyStore((s) => s.simulationResult);
if (sim?.meta?.generatedAt && Date.now() - sim.meta.generatedAt > 3600000) {
  // 1時間以上古い → refresh
}
```

**推奨**: 修正案 A（STAGE2 と同じパターン）

---

## 実装の優先度

| **優先度** | **STAGE** | **アクション** |
|-----------|---------|---|
| 1（高）| STAGE6 | simulationResult を persist から除外（v39 migration） |
| 2（中）| STAGE3 | bridge validation を page load 時に追加 |
| 3（低）| 全体 | cross-device persistence 監査をまた 1 か月後に実施 |

---

## 監査判定結果

- ✅ **STAGE1**: 問題なし
- ✅ **STAGE2**: 修正完了（v38 confirmed）
- ⚠️ **STAGE3**: 同種リスク - UI 表示の stale 化（DB update リスクなし）
- ✅ **STAGE4**: 問題なし - orphan cleanup が機能
- ✅ **STAGE5**: 問題なし - transient data 正しく処理
- ⚠️ **STAGE6**: 同種リスク - simulation 結果の stale 化（DB update リスク低）

**全体リスク評価**: LOW
- UPDATE on page open リスクはなし（STAGE2 修正で解決）
- UI 表示の stale 化リスクのみ（STAGE3, 6）
- 既存 guard で大部分が保護されている
