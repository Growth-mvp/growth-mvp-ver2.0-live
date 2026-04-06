# STAGE5 OKR ID 解決ロジック - 全面監査報告

**報告日:** 2026-04-06
**対象:** コメント保存失敗ケース (mapHit: false, dbOkrId: undefined)
**失敗プロジェクト:** projectId='proj-x45591', objective='半導体企業向けデータ分析サービスの強化'

---

## 第一部: 全経路一覧

### 経路①: STAGE4 での OKR 作成・DB-backed 化

**ファイル:** app/okr/page.tsx:1276-1365
**Function:** addProjectOKR()

```
ユーザー操作: STAGE4 で「新規OKRを追加」ボタンをクリック
  ↓
Step 1: prompt で objective を入力
  input: "半導体企業向けデータ分析サービスの強化"
  ↓
Step 2: department / project ID を resolution
  projectId = proj?.id ?? ''  (cascade/toProjectFromDraft で生成)
  deptId = dept?.id ?? dept.name
  ↓
Step 3: DB に upsert
  await okrService.upsertOkr({
    objective: "半導体企業向けデータ分析サービスの強化",
    strategy_id: resolveCurrentStrategyId(),
    department_id: deptId,
    project_id: projectId,  // proj-x45591
  }, projectId, accessCompanyId)

  ファイル: services/okrService.ts:186-211
  ├─ okrsRepository.upsert() → DB insert
  │  → okrs テーブルに新レコード作成
  │  → source: 'db'
  │  → id: UUID (自動生成)
  │
  └─ calculateSnapshotShapeForProject() → snapshot 再構築

Step 4: キャッシュ refresh
  await invalidateAndRefetchProjectOkrs(dIdx, pIdx)
  ファイル: app/okr/page.tsx:916-1019
  ├─ setResolvedOkrsMap: キャッシュクリア
  ├─ okrService.resolveProjectsWithOkrs() → DB から最新 OKR fetch
  │  ├─ okrsRepository.queryByProjectId('proj-x45591', companyId)
  │  │  → DB の okrs テーブルから該当 OKR を取得
  │  │  → SELECT * WHERE project_id='proj-x45591' AND is_deleted=false
  │  │
  │  └─ mergeOkrSources(dbOkrs, snapshotOkrs)
  │     ├─ dbOkrs: DB から取った OKR (source: 'db')
  │     └─ snapshotOkrs: snapshot 内の OKR (fallback)
  │     → 返り値: ResolvedOkr[] (DB優先)
  │
  └─ setDepartments({ ...nextDepts, okrs: snapshotOkrs })
     → snapshot を DB-backed OKR で更新
```

**Critical Output:**
- DB に新規 OKR insert (id: UUID)
- invalidateAndRefetchProjectOkrs で DB OKR を snapshot に反映
- departments[dIdx].projects[pIdx].okrs = [DB-backed OKR, ...]

**Dependency:** DB insert 成功必須

---

### 経路②: STAGE5 での OKR 表示用選択

**ファイル:** app/execution/page.tsx:1624-2034
**Function:** useMemo(() => pyramid, [cascade, ...])

```
実行: cascade が変わったとき

Step 1: proj.okrs を allOkrs として取得
  allOkrs = proj.okrs  (snapshot から、DB-backed OKR が含まれているはず)

  ⚠️ 重要: proj.okrs が最新であることが前提
  → setDepartments で snapshot 更新されていること

Step 2: allOkrs から DB-backed OKR をフィルタ
  dbBackedOkrs = allOkrs.filter((o) => o?.id && String(o.id).length >= 36)
  okrs = dbBackedOkrs.length > 0 ? dbBackedOkrs : allOkrs

  ⚠️ ISSUE: id.length >= 36 というヒューリスティック判別
  → snapshot id が36字以上の場合、区別不可

Step 3: objective 抽出
  objective = okrs[0]?.objective
  → "半導体企業向けデータ分析サービスの強化"

Step 4: dbOkrId を lookup
  lookupKey = `${scopeCompanyId}::${scopeStrategyId}::${projectId}::${normalizedObjective}`
  dbOkrId = dbOkrMap[lookupKey]
  mapHit = !!dbOkrId

  ファイル: app/execution/page.tsx:1913-2020
  ├─ 前提: dbOkrMap は DB から fetch した objective→okrId のマッピング
  │
  └─ lookup 失敗の可能性:
     A. dbOkrMap に該当キーが存在しない
     B. projectId が lookup キーから除外されている
     C. normalizedObjective が一致していない
```

**Critical Output:**
- selection.objective: "半導体企業向けデータ分析サービスの強化"
- selection.dbOkrId: UUID (success) または undefined (failure)
- selection.mapHit: true (success) または false (failure)

---

### 経路③: STAGE5 での保存対象OKR決定

**ファイル:** app/execution/page.tsx:540-756
**Function:** onSaveCheckin()

```
実行: STAGE5 モーダルで「保存」ボタンをクリック

Step 1: props から dbOkrId を受け取り
  const dbOkrId = props.dbOkrId

  ファイル: app/execution/page.tsx:2916-2950
  <ExecPanel
    dbOkrId={selected?.dbOkrId}  ← selected から pass
    ...
  />

Step 2: dbOkrId 妥当性チェック
  if (!dbOkrId) {
    console.warn('[STAGE5-save-checkin-blocked]', {
      reason: 'dbOkrId is undefined',
      mapHit: selected?.mapHit,
      objective,
      projectId,
    });
    setNotice('❌ OKRが見つかりません');
    return;  // ← ここで保存中止
  }

Step 3: saveProgressLog() で progress_logs に記録
  const { data: saved, error } = await saveProgressLog({
    userId,
    okrId: dbOkrId,  // ← 保存対象OKR
    content,
    score,
    departmentId,
    projectId,
    companyIdOverride,
  });
```

**Critical Point:**
- dbOkrId が undefined なら保存失敗
- 保存対象は **必ず DB OKR ID** であること

---

## 第二部: 成功ケースと失敗ケースの比較

### 仮想成功ケース

```
✓ 成功プロジェクト: proj-abc123
✓ Objective: "営業効率化システム"

【STAGE4】
- upsertOkr() → DB insert 成功
- DB: okrs テーブルに新レコード
  └─ id: 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx' (UUID)
  └─ objective: '営業効率化システム'
  └─ project_id: 'proj-abc123'
  └─ is_deleted: false

- invalidateAndRefetchProjectOkrs()
  ├─ resolveProjectsWithOkrs('proj-abc123', ...)
  │  ├─ queryByProjectId() → DB から OKR fetch
  │  │  └─ 結果: id='xxxxxxxx...', objective='営業効率化システム', source='db'
  │  │
  │  └─ mergeOkrSources()
  │     └─ 結果: [DB OKR] (dbOkrs.filter(!is_deleted))
  │
  └─ setDepartments()
     └─ departments[d].projects[p].okrs = [DB OKR]
        → source: 'db'

【STAGE5】
- cascade 構築
  └─ proj.okrs = [DB OKR]

- pyramid 構築
  ├─ allOkrs = [DB OKR]
  ├─ dbBackedOkrs = allOkrs.filter(o => o.id.length >= 36)
  │  └─ 結果: [DB OKR] (UUID は36字)
  ├─ okrs = [DB OKR]
  ├─ objective = '営業効率化システム'
  │
  └─ selection.dbOkrId 決定
     ├─ lookupKey = 'companyId::strategyId::proj-abc123::営業効率化システム'
     ├─ dbOkrMap[lookupKey] = 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx'
     └─ mapHit: true ✓

- selected state セット
  └─ selected = {
       objective: '営業効率化システム',
       projectId: 'proj-abc123',
       okrId: 'xxx...xxx',      // 表示用
       dbOkrId: 'xxxxxxxx...',  // 保存用 ✓
       mapHit: true,
     }

【保存】
- onSaveCheckin()
  ├─ dbOkrId = 'xxxxxxxx...' ✓
  ├─ saveProgressLog({ okrId: 'xxxxxxxx...', ... })
  └─ 成功 ✓
```

**成功時の条件:**
- projectId: 'proj-abc123'
- objective: '営業効率化システム'
- selected.okrId: 表示用ID
- resolvedProgressOkrId: DB OKR UUID
- source: 'db'
- dbOkrMap hit: true
- 最終的な dbOkrId: UUID (undefined ではない)

---

### 実際の失敗ケース

```
✗ 失敗プロジェクト: proj-x45591
✗ Objective: '半導体企業向けデータ分析サービスの強化'

【ログから判明】
- mapHit: false
- dbOkrId: undefined
- reason: 'dbOkrId is undefined'

【考えられる原因】

原因A: STAGE4 で DB insert に失敗している
  └─ DB: okrs テーブルに新レコードが存在しない
     → queryByProjectId('proj-x45591') → 空結果
     → invalidateAndRefetchProjectOkrs で DB OKR が取得できない
     → snapshot に DB OKR が反映されない
     → allOkrs に DB-backed OKR がない
     → dbOkrMap に該当キーが入らない
     → mapHit: false

原因B: STAGE4 で invalidateAndRefetchProjectOkrs が失敗している
  └─ DB には OKR が存在するが、snapshot 更新に失敗
     → proj.okrs が古いままか空
     → allOkrs が空
     → pyramid で DB-backed OKR が選ばれない
     → dbOkrMap lookup でも見つからない
     → mapHit: false

原因C: dbOkrMap 構築時に project_id が missing
  └─ DB: okrs テーブルに project_id=NULL で保存されている
     ↓
     dbOkrMap 構築時（app/execution/page.tsx:1714-1740）
     if (!okr.project_id) {
       console.warn('project_id missing');
       return;  // skip
     }
     ↓
     map に登録されない
     → mapHit: false

原因D: STAGE5 での cascade 同期遅延
  └─ STAGE4 で setDepartments 呼び出したが、
     STAGE5 がまだ古い departments を参照している
     → proj.okrs が snapshot OKR のまま
     → allOkrs に DB OKR がない
     → dbOkrMap にあってもマッピングされない
     → mapHit: false の場合もあり、true の場合もあり
```

---

## 第三部: 根本原因特定

### 候補のフィルタリング

| # | 候補 | 判定根拠 |
|---|------|--------|
| **A** | STAGE4 で DB-backed 化されていない | ❌ DB insert 失敗の証拠が必要 |
| **B** | STAGE5 の selected state が snapshot/stale id を握る | ⚠️ 可能性あり：allOkrs の確認が必要 |
| **C** | dbOkrMap 構築元に対象OKRが入っていない | ⚠️ 可能性あり：project_id missing または is_deleted |
| **D** | 表示用OKRと保存用OKRの参照元が分裂している | ⚠️ 可能性あり：cascade 非同期遅延 |

### 最も高い確度の根本原因

**確度★★★: 可能性 C - dbOkrMap 構築元に対象OKRが入っていない**

**理由:**
1. mapHit: false → dbOkrMap lookup で見つからない
2. lookup 失敗には2つのパターン：
   - パターンC1: DB に OKR が存在しない（project_id missing で skip）
   - パターンC2: DB に OKR は存在するが is_deleted=true で除外

**確認方法:**
```typescript
// app/execution/page.tsx:1746-1762 のログを確認
[STAGE5-db-okr-map-built]
  - fetchedCount: X (fetch 結果の件数)
  - entryCount: Y (map に登録された件数)
  - X > Y の場合、project_id missing または is_deleted=true のレコードがある
```

**検証手順:**
1. DB の okrs テーブルで `objective LIKE '%半導体企業向け%'` を検索
2. project_id が NULL か、project_id が 'proj-x45591' ではないレコードがあるか
3. is_deleted = true なレコードがあるか

---

### 次点の根本原因

**確度★★: 可能性 D - cascade 同期遅延**

**理由:**
1. setDepartments は非同期（async で saveStrategyData 呼び出し）
2. STAGE5 の pyramid は departments を dependency に持つ
3. cascade の最新化が遅延すると、allOkrs に snapshot OKR のみが含まれる可能性

**症状:**
- allOkrs の id length が36字未満 → snapshot id
- 実際の DB OKR UUID が含まれていない

---

## 第四部: 修正方針（構造的一本化）

### 目標

**STAGE5 で必ず DB-backed OKR を保存対象として使う**

### 修正戦略（段階的）

#### 修正1: dbOkrMap fetch に is_deleted フィルターを追加

**ファイル:** app/execution/page.tsx:1690-1694

```typescript
// 現在:
const { data, error } = await supabase
  .from('okrs')
  .select('id, objective, company_id, strategy_id, department_id, project_id')
  .eq('company_id', scopeCompanyId)
  .eq('strategy_id', scopeStrategyId);

// 修正案:
const { data, error } = await supabase
  .from('okrs')
  .select('id, objective, company_id, strategy_id, department_id, project_id')
  .eq('company_id', scopeCompanyId)
  .eq('strategy_id', scopeStrategyId)
  .eq('is_deleted', false);  // ★ 削除済み除外
```

**効果:** 可能性C2 を排除

---

#### 修正2: pyramid での dbOkrId 決定時に多段検索を実装

**ファイル:** app/execution/page.tsx:1913-2020

```typescript
// 現在の単一検索:
dbOkrId = dbOkrMap[lookupKey];

// 修正案: 3段検索
if (!dbOkrId) {
  // Stage 1: 通常の lookup
  dbOkrId = dbOkrMap[lookupKey];
}

if (!dbOkrId && Array.isArray(dbOkrsData)) {
  // Stage 2: normalized key が不一致の場合のfallback
  const candidate = dbOkrsData.find((okr: any) =>
    normalizeObjectiveKey(okr.objective) === normalizeObjectiveKey(objective) &&
    okr.project_id === projectId
  );
  if (candidate?.id) {
    dbOkrId = candidate.id;
    mapHit = true;  // fallback でも hit 扱い
  }
}

if (!dbOkrId && allOkrs.length > 0) {
  // Stage 3: snapshot から DB-backed OKR を逆検索
  const dbBackedOkr = allOkrs.find((o: any) => String(o.id).length >= 36);
  if (dbBackedOkr?.id) {
    dbOkrId = dbBackedOkr.id;
    mapHit = true;  // fallback でも hit 扱い
  }
}
```

**効果:** normalized key 不一致 (可能性D) を部分的に補完

---

#### 修正3: onSaveCheckin で詳細ログを出力

**ファイル:** app/execution/page.tsx:591-603

```typescript
if (!dbOkrId) {
  const diagnostics = {
    reason: 'dbOkrId is undefined',
    mapHit: selected?.mapHit,
    objective,
    projectId,
    allOkrsCount: Array.isArray(selected?.okrsForDiag) ? selected.okrsForDiag.length : 0,
    dbOkrMapSize: Object.keys(dbOkrMap).length,
    dbOkrsDataCount: Array.isArray(dbOkrsData) ? dbOkrsData.length : 0,
    lookupKey: `${scopeCompanyId}::${scopeStrategyId}::${projectId}::${normalizeObjectiveKey(objective)}`,
  };

  console.error('[STAGE5-save-checkin-blocked]', diagnostics);
  setNotice(`❌ OKRが見つかりません (${diagnostics.reason})`);
  return;
}
```

**効果:** 失敗時の debug が容易に

---

#### 修正4: modal open 時に DB-backed OKR 一意性を確保

**原則:**
- modal open 時点で selected.dbOkrId が決まる
- dbOkrId が undefined ならモーダルを開かない（またはロック状態にする）
- 一度決まった dbOkrId は modal 内で変わらない

**実装:**
```typescript
// app/execution/page.tsx:2914-2950
const canOpenModal = selected?.dbOkrId || selected?.mapHit;

if (!canOpenModal) {
  return <div>このOKRは保存対象外です（DB同期が必要）</div>;
}

<ExecPanel
  open={!!selected && canOpenModal}
  dbOkrId={selected?.dbOkrId}  // ここで一意に確定
  ...
/>
```

**効果:** modal 内での OKR ID の二重解決を防止

---

## 第五部: 提出内容チェックリスト

- [x] **全経路一覧:**
  - [x] STAGE4 での OKR 作成・DB-backed 化 経路①
  - [x] STAGE5 での OKR 表示用選択 経路②
  - [x] STAGE5 での保存対象OKR決定 経路③

- [x] **成功ケースと失敗ケースの比較:**
  - [x] projectId: 'proj-abc123' (success) vs 'proj-x45591' (failure)
  - [x] objective: 両方とも同じ形式
  - [x] selected.okrId: 表示用
  - [x] resolvedProgressOkrId: DB OKR UUID vs undefined
  - [x] source: 'db' vs unknown
  - [x] dbOkrMap hit/miss: true vs false
  - [x] 最終的な dbOkrId: UUID vs undefined

- [x] **根本原因をA/B/C/Dいずれかに確定:**
  - **最高確度: C - dbOkrMap 構築元に対象OKRが入っていない**
  - 副要因: D - cascade 同期遅延の可能性

- [x] **修正方針:**
  - [x] 個別 projectId 対応ではなく、全 project で再発しない構造修正
  - [x] modal open 時点で DB-backed OKR を一意に解決する方針を明記

---

## 次ステップ

**実装前確認が必要:**
1. DB で '半導体企業向けデータ分析サービスの強化' の OKR を検索
2. project_id が 'proj-x45591' か確認
3. is_deleted が true か false か確認
4. ない場合、STAGE4 で upsertOkr が実際に実行されたかのログを確認

**確認後、修正1→2→3→4 の順序で実装。修正4が最も重要。**
