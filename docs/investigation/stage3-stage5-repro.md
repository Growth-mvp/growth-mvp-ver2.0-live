# STAGE3/STAGE5 再現テスト ケース定義

## テスト実行方針

以下のケースA-Dを**順序通り**実行し、各ステップで以下を記録：

```
[diag][stage:action:point]
  departments.length: N
  stage4Plans.length: M
  stage4Plans[0].baseline.projects.length: X
  stage4Plans[0].current.projects.length: Y
  revision: R
  project ids and titles (first 3)
```

---

## ケースA: STAGE4編集 → 保存 → リロード

### 目的
STAGE4での編集が保存され、リロード後も保持されることを確認

### 前提
- 企業データが既に存在（STAGE1-3 完了）
- STAGE4 まだ訪問したことなし（clean state）

### 手順

```
[T0] STAGE3データ確認
  - Navigate to /cascade
  - Log: [diag][stage3:init]
    - departments count
    - department[0].projects count and titles
    - revision

[T1] STAGE4訪問（初回）
  - Navigate to /stage4
  - Log: [diag][stage4:init]
    - departments (should match stage3)
    - stage4Plans (should be empty or [])
    - Wait for baseline init...

[T2] 部門選択 → baseline生成
  - Click first department
  - Wait for useEffect baseline creation (189-215)
  - Log: [diag][stage4:baseline:created]
    - stage4Plans[0].baseline.projects[] titles
    - stage4Plans[0].current.projects[] titles (should match baseline)
    - Confirm: baseline === current (deep equal)

[T3] プロジェクト編集
  - Click edit on first project
  - Change: project title "ProjectA" → "ProjectA_edited"
  - Change: KPI target from 100 → 150
  - Log: [diag][stage4:edit:before]
    - stage4Plans[0].current.projects[0].title
    - stage4Plans[0].current.projects[0].kpiTargets

[T4] 保存実行
  - Trigger save (auto or manual)
  - Log: [diag][stage4:save:payload]
    - Confirm stage4Plans in payload
    - Confirm current.projects[0].title === "ProjectA_edited"
    - Confirm save API response (HTTP 200)
    - Log new revision from response

[T5] リロード
  - Reload page (F5)
  - Wait for loadAndHydrate
  - Log: [diag][stage4:reload:post]
    - departments (refreshed from DB)
    - stage4Plans (refreshed from DB)
    - stage4Plans[0].current.projects[0].title (should be "ProjectA_edited")

[Result]
  ✅ PASS: title と KPI target が保持されている
  ❌ FAIL: 変更が消えている（巻き戻し or 保存漏れ）
```

---

## ケースB: STAGE3再生成 → STAGE4変更確認

### 目的
STAGE3で再生成後、新プロジェクト構成が STAGE4 に反映されることを確認

### 前提
- ケースA完了（STAGE4に既に edit history有）
- STAGE3とSTAGE4の差分表示が正しく動作する

### 手順

```
[T0] STAGE3データ取得（再生成前）
  - Navigate to /cascade
  - Log: [diag][stage3:pre-regen]
    - departments[0].projects[0].title (e.g., "ProjectA_edited" from ケースA)
    - departments[0].projects.count: N_old = 2
    - revision: R_old = 7

[T1] 再生成実行
  - Click "回答を反映して再生成"
  - Wait for /api/generate-cascade response
  - Wait for setDepartmentsInStore + saveNow()
  - Log: [diag][stage3:regen:api]
    - API response lanes.existing.count
    - API response lanes.new.count
    - Merged result departments[0].projects.count: N_new = 3 (e.g., 新proj追加)
    - departments[0].projects[0].title (should change or be preserved?)
    - revision: R_new = 8 (incremented)

[T2] STAGE3確認後、STAGE4訪問
  - Navigate to /stage4
  - Wait for loadAndHydrate
  - Log: [diag][stage4:post-regen:init]
    - departments[0].projects.count (should be N_new = 3)
    - stage4Plans[0] exists?
    - stage4Plans[0].baseline.projects.count (should be ?)
      - ❌ BUG: still N_old = 2 (old baseline not updated)
      - ✅ FIXED: N_new = 3 (baseline updated)
    - stage4Plans[0].current.projects.count

[T3] 差分表示確認（ProjectEditor内）
  - Log: [diag][stage4:diff:display]
    - DiffViewer で baseline vs current を比較
    - 新projectはどう表示されるか
    - ❌ BUG: 新project表示されない（baseline固定）
    - ✅ FIXED: 新project追加として表示

[T4] 部門変更フロー
  - Select department 2nd time (or refresh selected)
  - Check if useEffect (189-215) re-runs
  - Log: [diag][stage4:refresh:attempt]
    - Does baseline recreate from new department?
    - ❌ BUG: No, localPlans.some(exists) returns true → skip
    - ✅ FIXED: Detects new structure → baseline recreated

[Result]
  ✅ PASS: STAGE3新構成が STAGE4 baseline に反映
  ❌ FAIL: baseline が旧構成のまま（仮説B確定）
```

---

## ケースC: STAGE5でのデータ整合性

### 目的
STAGE3再生成が STAGE5にも反映されることを確認

### 前提
- ケースB 完了（STAGE3で再生成完了）
- STAGE4baseline の状態が既知（固定or更新）

### 手順

```
[T0] STAGE4再生成直後の状態確認
  - Log from ケースB: [diag][stage4:post-regen:init]
  - stage4Plans[0].baseline.projects.count: N_baseline
  - departments[0].projects.count: N_dept

[T1] STAGE5訪問
  - Navigate to /execution
  - Wait for loadAndHydrate
  - Wait for cascade useMemo calculation (960-990)
  - Log: [diag][stage5:init]
    - cascade.length (should equal departments.length)
    - cascade[0].projects.count
    - Expected: should be N_dept (STAGE3新構成)

[T2] 新projectが表示されるか
  - Check ProjectCard list rendering
  - Log: [diag][stage5:display:projects]
    - List of project titles displayed
    - Confirm: contains new project (added in STAGE3 regen)
    - ❌ BUG: New project not shown
    - ✅ FIXED: New project shown

[T3] OKR/KPI進捗表示
  - For each displayed project:
    - Check okrsV2.length
    - Check milestones.length
    - Check impactRevenue value
  - Log: [diag][stage5:display:details]
    - First 3 projects: title, okrsV2.count, milestones.count

[T4] 進捗入力 → 保存
  - Click on OKR rating input
  - Set rating = 0.8
  - Click save
  - Log: [diag][stage5:save]
    - okrTargetScores updated?
    - saveStrategyData called?
    - Payload includes all required fields?

[T5] リロード確認
  - Reload page
  - Log: [diag][stage5:reload:post]
    - cascade[0].projects.count (should still be N_dept)
    - OKR rating preserved (0.8)?

[Result]
  ✅ PASS: STAGE5で新構成が表示され、進捗が保存される
  ❌ FAIL: 新projectが見えない、または保存されない
```

---

## ケースD: Revision Conflict / Restore Race

### 目的
異なるステージから同時保存した場合、revision競合が正しく処理されることを確認

### 前提
- 並行アクセス環境をシミュレート（実装では1ユーザーでもタイミング可）

### 手順

```
[T0] 初期状態確認
  - Navigate to /stage4
  - Log: [diag][stage4:t0:state]
    - revision: R_start = 10

[T1] STAGE4で編集（保存せず）
  - Click edit on project
  - Change title: "ProjectA" → "ProjectA_stage4"
  - Log: [diag][stage4:t1:edit]
    - localPlans[0].current.projects[0].title: "ProjectA_stage4"
    - ⚠️ Not saved yet, revision still 10 locally

[T2] 別タブで STAGE3 再生成シミュレート
  - (Or: use browser dev console to simulate)
  - Manually call: useStrategyStore.getState().saveStrategyData({ reason: 'simulated-regen' })
  - This increments revision to 11
  - Log: [diag][stage4:t2:external-save]
    - useStrategyStore.getState().revision: 11

[T3] STAGE4側で保存試みる
  - Click save on STAGE4 changes
  - saveWithAudit() called
  - Log: [diag][stage4:t3:save-attempt]
    - buildSavePayload() creates payload with local revision=10
    - API detects revision mismatch (payload=10, DB=11)
    - Response: conflict error? or silent override?
    - Check response status and error field

[T4] UI feedback確認
  - Check if conflict error is displayed to user
  - Check if saveStatusIndicator shows error
  - Log: [diag][stage4:t3:conflict-display]
    - Error shown to user? (YES/NO)
    - User can retry with force-save? (YES/NO)
    - User can discard and reload? (YES/NO)

[T5] Reload後の状態
  - Click "reload"
  - Wait for loadAndHydrate (restore with DB data)
  - Log: [diag][stage4:t5:restore]
    - revision: 11 (from DB)
    - stage4Plans[0].current.projects[0].title
      - ❌ BUG: "ProjectA" (STAGE4編集が消える)
      - ✅ FIXED: "ProjectA_stage4" (ユーザー編集が保持される or 警告後選択可能)

[Result]
  ✅ PASS: Conflict が UI で表示され、ユーザーが対応可能
  ⚠️ PARTIAL: Conflict 検知されるが、UI feedback不足
  ❌ FAIL: Conflict silent (ログにはあるが UI見えない)
```

---

## ケースE（オプション）: Auto-Save Race

### 目的
自動保存中に手動保存された場合、racing条件が安全か確認

### 手順

```
[T0] useAutoSave設定確認
  - Check: /hooks/useAutoSave.ts interval = ?
  - Log: [diag][autosave:config]
    - Interval: e.g., 10000ms (10 sec)

[T1] STAGE4で編集 → Auto-saveトリガ
  - Change project title → triggers auto-save
  - Log: [diag][autosave:t1:triggered]
    - saveStrategyData called with reason='autosave'

[T2] Auto-save完了前に手動保存
  - Before auto-save completes (check network panel)
  - Click manual save button
  - Log: [diag][autosave:t2:manual-during-auto]
    - Two saveWithAudit() calls in parallel?
    - First one completes → revision 12
    - Second one starts with payload revision 11 → conflict?

[T3] DB最終状態確認
  - Check DB directly or reload page
  - Log: [diag][autosave:t3:final]
    - revision: 12 (highest)
    - stage4Plans content: which save's version?

[Result]
  ✅ PASS: Last write wins (latest revision preserved)
  ⚠️ PARTIAL: Conflict handled but with data loss
  ❌ FAIL: Race leads to corruption
```

---

## デバッグログ出力方法

以下のlog statements を調査時にコード内に挿入：

### STAGE3再生成時：
```typescript
// /app/cascade/page.tsx around 2114
console.log('[diag][stage3:regen:after]', {
  departments_count: mergedDepts.length,
  department0_projects_count: mergedDepts[0]?.projects.length,
  department0_projects_titles: mergedDepts[0]?.projects.map(p => p.title),
  revision_before: useStrategyStore.getState().revision,
  stage4Plans_count_before: useStrategyStore.getState().stage4Plans?.length,
});

setDepartmentsInStore(mergedDepts);
console.log('[diag][stage3:after-set]', {
  revision_after: useStrategyStore.getState().revision,
  stage4Plans_count_after: useStrategyStore.getState().stage4Plans?.length,
});
```

### STAGE4 baseline初期化時：
```typescript
// /app/stage4/page.tsx around 200
console.log('[diag][stage4:baseline:init]', {
  dept_id: deptId,
  dept_projects_count: selectedDept.projects.length,
  dept_projects_titles: selectedDept.projects.map(p => p.title),
  baseline_projects_count: baseline.projects.length,
});
```

### Save前:
```typescript
// /store/strategyStore.ts buildSavePayload() 前
console.log('[diag][save:payload]', {
  stage4Plans_in_state: s.stage4Plans,
  stage4Plans_in_payload: base.stage4Plans,
  departments_in_payload_count: base.departments?.length,
  revision: base.revision,
});
```

### Restore後:
```typescript
// /utils/persist/restoreWithAudit.ts around 210
console.log('[diag][restore:post]', {
  departments_count: hydratedState.departments?.length,
  stage4Plans_count: hydratedState.stage4Plans?.length,
  revision: hydratedState.revision,
});
```

---

## テスト実行チェックリスト

- [ ] ケースA実行完了 → stage4 編集が保存・復元される
- [ ] ケースB実行完了 → stage3 再生成が stage4 baseline に反映される
- [ ] ケースC実行完了 → stage5 で新プロジェクト表示される
- [ ] ケースD実行完了 → revision conflict が UI で表示される
- [ ] Console logs を収集 → `docs/investigation/logs-*.txt` に保存
- [ ] 各ケース結果を下記フォーマットで記録

---

## テスト結果記録テンプレート

```markdown
## ケース[A/B/C/D] 実行結果

**実行日**: YYYY-MM-DD HH:mm
**実行者**: [name]
**環境**: [dev/staging/prod]

### ステップごとの観測

| Step | 項目 | 期待値 | 実際値 | 結果 |
|------|------|--------|--------|------|
| T0 | departments.length | N_old | ? | ✅/❌ |
| T1 | stage4Plans created | Yes | ? | ✅/❌ |
| T2 | baseline projects count | N_old | ? | ✅/❌ |
| T3 | edit reflected in current | Yes | ? | ✅/❌ |
| T4 | save succeeds | HTTP 200 | ? | ✅/❌ |
| T5 | reload preserved edit | Yes | ? | ✅/❌ |

### Console Logs（関連部分）

```
[diag][stage:...]
...
```

### 問題検出

- [ ] Problem A: stage4Plans not cleared on regen
- [ ] Problem B: baseline not updated
- [ ] Problem C: payload incomplete
- [ ] Problem D: revision conflict not shown
- [ ] Problem E: restore overwrites current

### 備考

...
```

---

## 追加の自動テスト提案

以下は将来的に Playwright / Cypress で自動化すべき：

```typescript
// test/stage4-regen.spec.ts (pseudo code)
describe('STAGE4 Regeneration Handling', () => {
  test('Should update baseline when STAGE3 regenerates', async () => {
    // Setup: create baseline
    await page.goto('/stage4');
    await selectDepartment('Dept A');
    let baseline1 = await getBaselineProjectCount();

    // Action: STAGE3 regenerate
    await page.goto('/cascade');
    await triggerRegeneration();
    await saveAndWait();

    // Verify: STAGE4 baseline updated
    await page.goto('/stage4');
    await selectDepartment('Dept A');
    let baseline2 = await getBaselineProjectCount();

    expect(baseline2).toBe(baseline1 + 1);  // or change as per regen
  });
});
```

---

## 予想される問題と対応

| 問題 | 再現ケース | 原因（仮説） | 対応 |
|------|----------|-----------|------|
| stage4Plans not cleared | B | A,B | Fix setStage4Plans(undefined) at cascade regen |
| baseline fixed | B | B | Watch dept hash, re-init baseline on change |
| stage4Plans lost on merge | D | D | Add protection in merge logic |
| revision conflict silent | D | D | Display error in UI |
| current overwrites baseline | C | (auto-save side-effect) | Add deep-copy protection |
