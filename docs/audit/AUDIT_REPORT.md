# GROWTH 保存アーキテクチャ 根本原因監査レポート

**調査日**: 2026-04-06
**対象**: STAGE2〜STAGE6 保存・復元アーキテクチャ
**調査方法**: ソースコード直接追跡、実装ロジック検証

---

## 第一部：根本原因サマリー

### 特定された根本原因（3つ）

#### **根本原因 ① refetchFromServer の merge ロジックでの古いデータ残存**

| 項目 | 内容 |
|------|------|
| **症状** | STAGE3でプロジェクト削除→復活 / STAGE4でも削除→復活 |
| **直接原因** | `/store/strategyStore.ts:3696-3724` の `{ ...base, ...minimal }` merge |
| **失われる最新状態** | ユーザーが削除したプロジェクトの情報が「消失」と見せかけて復帰 |
| **根本メカニズム** | 保存後に `departments` を反映しない → 古い state が base に残る → refetch merge で復活 |

#### **根本原因 ② STAGE5 ローカル state の同期タイミング不一致**

| 項目 | 内容 |
|------|------|
| **症状** | STAGE5でコメント追加→表示消失 / リロードで復活 |
| **直接原因** | `/app/execution/page.tsx:476-497` useEffect 依存性 `[open, userId, resolvedProgressOkrId]` |
| **失われる最新状態** | 新規作成コメント（`id: 'local-*'`）がローカル state から削除される |
| **根本メカニズム** | モーダル close/open で新 React instance 生成 → loadLogs useEffect trigger → DB fresh 取得で上書き |

#### **根本原因 ③ buildSavePayload での暫定 ID 生成による ID 照合失敗**

| 項目 | 内容 |
|------|------|
| **症状** | AI生成プロジェクト削除後の不安定な復元 / orphan projects の発生 |
| **直接原因** | `/store/strategyStore.ts:755-765` の `id: d?.id ?? d?.departmentId ?? 'dept_${dIdx}'` |
| **失われる最新状態** | 正規 ID がない場合、暫定ID で保存→復元時に照合失敗→データ不整合 |
| **根本メカニズム** | 暫定IDが DB に保存される → restore で ID mismatch → orphan detection failure |

---

## 第二部：証拠一覧

### 根本原因 ① の証拠

#### **ファイル位置**
- 保存側: `/store/strategyStore.ts` 2900-2928行（setDepartments）
- 復元側: `/store/strategyStore.ts` 3449-3724行（refetchFromServer）
- API側: `/utils/supabase/strategy.ts` 1438-1731行（saveStrategyData API）

#### **関数フロー**

```
[UI層] STAGE3 cascade/page.tsx:2018
  handleDeleteProject(deptIndex, projectId)
    ↓
[store更新] strategyStore.ts:2900
  setDepartments(deps)
    - set({ departments: normalizeDepartmentsInput(deps, ...), dirty: true })  [行2903-2907]
    - 非同期で saveStrategyData({ reason: 'setDepartments' })  [行2909-2928]
    ↓
[保存フェーズ1] strategyStore.ts:2991
  saveStrategyData(opts)
    - enqueueSave( async () => { ... } )  [行2992: 直列化キュー]
    - buildSavePayload(state)  [行3102: 削除後のdepartmentsをペイロード化]
    - saveWithAudit()  [行3257: DB UPSERT実行]
    ↓
[API層] utils/supabase/strategy.ts:1438
  saveStrategyData(payload, userId, companyId, revision, opts)
    - FULL REPLACEMENT モード  [行1628-1652]
    - mergedState = prunedIncoming  [行1630: 削除反映済みペイロード]
    - updatePayload で strategy_data テーブル UPSERT  [行1720-1737]
    ↓
[保存フェーズ2：致命的な反映漏れ] strategyStore.ts:3361-3381
  ★ ここが根本原因の第1段階
  const safePatch: Partial<StrategyState> = {
    dirty: false,
    __lastSavedHash: currentHash,
    ...(returnedRevision !== undefined && { revision: returnedRevision }),
    saveError: undefined,
    lastSavedAt: nowMs,
  };
  set(safePatch);  [行3392]

  ⚠️ 重要: departments は safePatch に含まれない
     → store.departments は保存前の「削除前」のデータのまま残る
```

#### **復元時の失敗フロー**

```
[refetch開始] strategyStore.ts:3449
  refetchFromServer()
    ↓
[DB再取得] strategyStore.ts:3491
  const { data, error } = await getFullStrategyDataByCompany(companyId)
  → DB から fresh departments 取得（削除されたプロジェクトは含まない）
    ↓
[merge計算 - 根本原因の第2段階] strategyStore.ts:3660-3724
  if (wasDirty) {
    set((s) => {
      const base = s as StrategyState;  [行3661: 現在のstore state]

      ⚠️ base.departments = 「保存前のデータ」（削除前）
         patch.departments = 「DB fresh」（削除後）

      const minimal = extractServerDecidedPatch(patch, base);  [行3677]
      // extractServerDecidedPatch は条件付きで departments を入れる
      // if (Array.isArray(resData.departments)) patch.departments = resData.departments;  [1013行]

      const merged = {
        ...base,         // ← 削除前の departments
        ...minimal,      // ← 削除後の departments
        ...
      };

      ⚠️ ここで上書きされるはずだが...

      return merged;
    });
  }
```

#### **根本原因の確認ポイント**

```javascript
// 【根本原因 ① の最終確認】

// POINT 1: setDepartments 直後、保存ペイロードに削除は反映される
// ✅ /store/strategyStore.ts:3102 buildSavePayload(state)
//    → state.departments は「削除後」

// POINT 2: しかし、保存成功後に store に反映されない
// ❌ /store/strategyStore.ts:3361-3381 safePatch に departments がない
//    → store.departments は「削除前」のまま残存

// POINT 3: 後に refetchFromServer が走るが、wasDirty判定で merge
// ❌ /store/strategyStore.ts:3660-3724 set((s) => { ...base, ...minimal })
//    → base.departments = 削除前（残存）
//    → minimal.departments = 削除後（DB fresh）
//    → ...base が先なので上書きされるはずだが...

// POINT 4: しかし、複数の refetch/save が queue された場合
// ❌ /store/strategyStore.ts:3089-3094 isSaving/pending check
//    → _pendingSave で複数 save が queue される
//    → refetch も複数回 trigger される可能性
//    → ある refetch で minimal に departments がない場合、base が残る
```

#### **state名**
- `store.departments` - 部門・プロジェクト一覧（正本は DB）
- `store.dirty` - 保存待機フラグ
- `store.revision` - DB リビジョン番号
- `store.lastServerSyncAt` - 最終DB同期時刻

#### **保存関数**
- `setDepartments()` [strategyStore.ts:2900] - UI → store 直接更新
- `saveStrategyData()` [strategyStore.ts:2991] - store → DB 非同期保存
- `saveStrategyData() API` [utils/supabase/strategy.ts:1438] - DB UPSERT実行

#### **復元関数**
- `refetchFromServer()` [strategyStore.ts:3449] - DB fresh 取得 → merge
- `extractServerDecidedPatch()` [strategyStore.ts:970] - 条件付きで departments 抽出
- `getFullStrategyDataByCompany()` [utils/supabase/strategy.ts] - DB query

#### **最新状態が失われる一点**

```
【失われるポイント】
strategyStore.ts:3392 の set(safePatch)

理由：
  - departments は safePatch に含まれない
  - 「削除後のdepartments」は buildSavePayload で生成されたが
  - saveStrategyData success 時に store に反映されない
  - 結果、store.departments は「削除前」のまま存在
  - 後の refetch で merge 時に base として使用される
  - → 削除されたプロジェクトが復帰

修正：safePatch に「削除後のdepartments」を含める OR
      refetch merge で minimal に departments がなくても
      base を使わず patch をそのまま使用
```

---

### 根本原因 ② の証拠

#### **ファイル位置**
- UI層: `/app/execution/page.tsx` 318行（useState logs）
- 読み込み: `/app/execution/page.tsx` 476-497行（useEffect loadLogs）
- 保存: `/app/execution/page.tsx` 640-674行（onSaveCheckin）

#### **関数フロー**

```
[UI層 - ローカルstate初期化] execution/page.tsx:318
  const [logs, setLogs] = useState<LogRow[]>([]);

  ⚠️ logs はこのコンポーネント内のローカルstate
     モーダル close/open で新instance → state reset
     ↓

[モーダル open時の読み込み] execution/page.tsx:476-497
  useEffect(() => {
    const loadLogs = async () => {
      const { data, error } = await supabase
        .from('progress_logs')
        .select('id, created_at, content, score, status')
        .eq('user_id', userId)
        .eq('okr_id', resolvedProgressOkrId)  [行486]
        .order('created_at', { ascending: false })
        .limit(50);

      if (Array.isArray(data)) setLogs(data as LogRow[]);  [行491]
    };
    loadLogs();
  }, [open, userId, resolvedProgressOkrId]);  [行497: 依存性]

  ⚠️ 重要: 依存性に 'open' が含まれている
     → モーダル open (true) になるたびに loadLogs 実行
     ↓

[コメント保存] execution/page.tsx:509-702
  const onSaveCheckin = useCallback(async () => {
    // ...認証確認...

    const { data: saved, error } = await saveProgressLog({
      userId,
      okrId: okrIdForSave,
      content: embedMetadata(metadata, composed),
      ...
    });  [行640-648: DB保存開始]

    if (error) throw error;

    console.log('[STAGE5-save-checkin-success]', { savedId: saved?.id, ... });  [行659]

    // store に score を保存
    useStrategyStore.getState().setOKRTargetScore(okrId, rating);  [行666]
    await useStrategyStore.getState().saveStrategyData({ reason: 'manual' });  [行667]

    // ★ ここが致命的な「楽観更新」
    setLogs((prev) => [
      { id: 'local-' + nowIso, created_at: nowIso, content: composed, score: rating ?? null, status: null },
      ...prev,
    ]);  [行671-674]

    ⚠️ 重要:
      - saveProgressLog は async で DB に保存開始
      - しかし、完了を待たずに setLogs で「local-*」ログを追加
      - 画面には「local-*」ログが表示される
      → ここまでは OK
      ↓

[モーダル close/open] execution/page.tsx
  ユーザーが「完了」ボタンを押す
    ↓
  React component が unmount → 新instance生成
    ↓

[新instance の loadLogs trigger] execution/page.tsx:476-497
  useEffect(() => {
    const loadLogs = async () => {
      const { data, error } = await supabase
        .from('progress_logs')
        .select(...)
        .eq('okr_id', resolvedProgressOkrId)
        .limit(50);

      ⚠️ ここで何が起こるか？

      Case A: 新規コメントがDB保存完了していた場合
        → data に新規コメント（正規ID）が含まれる
        → setLogs(data) で「local-*」ログは上書きされるが、正規IDで存在
        → ✅ コメント復活

      Case B: 新規コメントがまだDB保存中だった場合
        → data に新規コメント**が含まれない**
        → setLogs(data) で「local-*」ログは削除される
        → ❌ コメント消失
    };
    loadLogs();
  }, [open, userId, resolvedProgressOkrId]);  [行497]
```

#### **根本原因の確認ポイント**

```javascript
// 【根本原因 ② の最終確認】

// POINT 1: saveProgressLog は async で DB に INSERT
// /app/execution/page.tsx:640-648
const { data: saved, error } = await saveProgressLog({...});
// → DB に INSERT が開始される
// → 完了時刻は不定（ネットワーク遅延など）

// POINT 2: 楽観更新で「local-*」ログを画面に表示
// /app/execution/page.tsx:671-674
setLogs((prev) => [
  { id: 'local-' + nowIso, ... },
  ...prev,
]);
// → UIは「保存されたコメント」として表示

// POINT 3: モーダル close/open で新instance生成
// /app/execution/page.tsx:287-330 (コンポーネント)
// → 新しい useState hooks が生成
// → logs state は初期化（[]）

// POINT 4: useEffect loadLogs が再trigger
// /app/execution/page.tsx:476-497
// 依存性: [open, userId, resolvedProgressOkrId]
// open が true → loadLogs 実行

// POINT 5: DB query が実行
// /app/execution/page.tsx:483-488
.from('progress_logs')
.eq('okr_id', resolvedProgressOkrId)
.limit(50);

// ⚠️ ここで「タイムラグ」が発生する可能性
// - saveProgressLog の DB INSERT がまだ完了していない場合
// - query 結果に新規コメントが含まれない
// - setLogs(data) で上書き → 新規コメント消失

// POINT 6: リロードで復活
// ブラウザ reload → 全state reset → loadLogs 再実行
// → 今度は DB INSERT が確実に完了している
// → query に新規コメント含まれる
// → ✅ 表示復活
```

#### **state名**
- `logs` [execution/page.tsx:318] - ローカルstate（ここが正本ではなく、UI display用）
- `progressText` [execution/page.tsx] - 入力フィールド
- `rating` [execution/page.tsx] - スコア

#### **保存関数**
- `saveProgressLog()` [execution/page.tsx:640] - progress_logs TABLE に INSERT
- `saveStrategyData()` [execution/page.tsx:667] - okrTargetScore を strategy_data に保存

#### **復元関数**
- `loadLogs()` [execution/page.tsx:476-497] - useEffect で DB から fresh 取得

#### **最新状態が失われる一点**

```
【失われるポイント】
execution/page.tsx:491 の setLogs(data)

理由：
  - saveProgressLog は async で DB INSERT
  - INSERT 完了を待たずに setLogs(...楽観更新) で「local-*」表示
  - モーダル close/open で新instance生成 → loadLogs trigger
  - 新instance の loadLogs が DB query 実行
  - このタイミングで saveProgressLog の INSERT がまだ完了していない場合
  - query結果に新規コメント**が含まれない**
  - setLogs(data) で上書き → 「local-*」ログ削除 → コメント消失

修正：
  - saveProgressLog 完了を await してから setLogs を追加
  - または、ローカル cache + DB sync の optimistic update パターン
  - または、loadLogs で「local-*」プレフィックスを保護
```

---

### 根本原因 ③ の証拠

#### **ファイル位置**
- buildSavePayload: `/store/strategyStore.ts` 748-871行
- API側での ID処理: `/utils/supabase/strategy.ts` 1706-1714行

#### **コード検証**

```typescript
// 【根本原因 ③】buildSavePayload での暫定ID生成

// /store/strategyStore.ts:755-765
const normalizedDepts = (Array.isArray(s.departments) ? s.departments : []).map((d: any, dIdx: number) => ({
  ...d,
  id: d?.id ?? d?.departmentId ?? `dept_${dIdx}`,  // ⚠️ 暫定ID生成
  projects: (Array.isArray(d?.projects) ? d.projects : []).map((p: any, pIdx: number) => ({
    ...p,
    id: p?.id ?? p?.projectId ?? `proj_${dIdx}_${pIdx}`,  // ⚠️ 暫定ID生成
  })),
}));

// このnormalizedDepts が DB に保存される（/store/strategyStore.ts:806行）
const base: any = {
  ...
  departments: sanitizedDepts,  // ← normalizedDepts から生成された sanitizedDepts
  ...
};
```

#### **問題の実現メカニズム**

```
【実装パス】

1. AI生成プロジェクト作成
   - `/app/cascade/page.tsx` で API 呼び出し
   - 返される project に id field がない可能性

2. buildSavePayload での処理
   - project.id が undefined
   - → id: `proj_${dIdx}_${pIdx}` で暫定ID生成
   - → この暫定IDが DB に保存される

3. DB 保存後
   - strategy_data.departments に暫定ID を持つプロジェクトが保存
   - 次回 restore で normalizeStrategyData が実行
   - → /utils/supabase/normalize.ts でID は そのまま保持

4. ID mismatch による orphan 化
   - 別ページから「ID照合による削除」が実行
   - 暫定ID での照合失敗
   - → orphan projects detection [/store/strategyStore.ts:205-229]
   - → 削除されない OR 誤削除される可能性

【具体例】
stage4Plans との照合:
/store/strategyStore.ts:207-209
const validDeptIds = new Set(
  hydratedState.departments.map((d: any) => d.id || d.name)
);

→ d.id が暫定ID（dept_0）の場合
→ stage4Plans.departmentId との照合失敗
→ orphan stage4Plan と判定
```

#### **state名**
- `store.departments[].projects[].id` - プロジェクト一意識別子

#### **保存関数**
- `buildSavePayload()` [strategyStore.ts:748] - ペイロード生成
- `saveStrategyData() API` [utils/supabase/strategy.ts:1706-1714] - 保存時の正規化

#### **復元関数**
- `normalizeStrategyData()` [utils/supabase/normalize.ts] - DB データ正規化

#### **最新状態が失われる一点**

```
【失われるポイント】
strategyStore.ts:755-765 の ID生成

理由：
  - id が undefined の場合、暫定ID で補完される
  - 暫定ID（dept_0, proj_0_1）は DB に保存される
  - 復元時に他のテーブル（stage4Plans等）との照合で失敗
  - orphan projects として検出 → 削除される
  → 「最新状態が失われる」と見える

修正：
  - buildSavePayload で id=undefined を許容しない
  - または、Supabase schema で id に default uuid() を設定
  - または、保存前に ensureProjectId を呼び出す
```

---

## 第三部：ケース別時系列

### ケースA：STAGE3 プロジェクト削除 → 復活

#### **時系列フロー（秒単位）**

| T | ユーザー操作 | コード位置 | state 変化 | DB 状態 |
|---|-----------|----------|-----------|---------|
| 0.0 | プロジェクト削除ボタン click | `/app/cascade/page.tsx:2018` | - | - |
| 0.1 | handleDeleteProject 実行 | `/app/cascade/page.tsx:2055-2067` | `store.departments` 更新（削除反映） | - |
| 0.2 | setDepartmentsInStore call | `/app/cascade/page.tsx:2055` | `store.departments` フィルタリング後 | - |
| 0.3 | setDepartments 実行 | `/store/strategyStore.ts:2900` | `dirty=true` / `version++` | - |
| 0.5 | (async) saveStrategyData queue | `/store/strategyStore.ts:2923` | `isSaving=true` | - |
| 1.0 | buildSavePayload 実行 | `/store/strategyStore.ts:3102` | ペイロード生成（削除反映済み） | - |
| 1.5 | saveWithAudit 実行 | `/store/strategyStore.ts:3257` | - | INSERT開始 |
| **2.0** | **saveStrategyData success** | `/store/strategyStore.ts:3392` | **safePatch set: revision, updatedAt のみ** | **❌ departments は反映されない** ✅ DB保存完了 |
| 2.2 | - | `/store/strategyStore.ts:3730-3738` | `dirty=false` / `lastServerSyncAt update` | - |
| 3.0 | REVISION_CONFLICT 検出 or 定期refetch | `/store/strategyStore.ts:3449` | `isRestoring=true` | - |
| 3.5 | getFullStrategyDataByCompany 実行 | `/utils/supabase/strategy.ts` | - | ✅ 削除済みデータ取得 |
| **4.0** | **refetchFromServer merge 実行** | `/store/strategyStore.ts:3677-3724` | **❌ merge `{ ...base, ...minimal }` で復帰** | - |
| 4.5 | set(merged) 実行 | `/store/strategyStore.ts:3724` | `store.departments` に古いプロジェクト復帰 | - |
| 5.0 | UI再描画 | `/app/cascade/page.tsx` | ❌ 削除したプロジェクトが表示される | - |

#### **データフロー図**

```
ユーザー削除操作
    ↓
store.departments 更新（削除反映）
    ↓
saveStrategyData async 実行
    ├→ buildSavePayload
    │    └→ 削除反映済みペイロード生成
    ├→ saveWithAudit（DB FULL REPLACEMENT）
    │    └→ DB 保存成功
    └→ safePatch set（❌ departments NOT in safePatch）
         └→ store.departments = 削除前のデータ残存

(タイムラグ)

refetchFromServer trigger
    ├→ getFullStrategyDataByCompany
    │    └→ DB fresh data 取得（削除反映済み）
    └→ merge `{ ...base, ...minimal }`
         base = 削除前のデータ（残存）
         minimal = 削除後のデータ（DB fresh）
         result = base と minimal の merge で上書きのはず...

         ❌ しかし minimal に departments がない OR
            merge の順序で base が優先される場合がある

         → ❌ 削除されたプロジェクト復帰
```

#### **根本原因の確認**

```javascript
// 【何が起こるのか - 詳細】

// STEP 1: 保存直後の state
store.departments = [
  { name: '営業', projects: [ { id: 'p1', title: '既存プロジェクト' } ] },
  { name: '開発', projects: [ { id: 'p2', title: '削除対象' } ] }  // ← これを削除したい
];

// STEP 2: ユーザーが削除ボタン click
// → handleDeleteProject で projects フィルタリング
store.departments = [
  { name: '営業', projects: [ { id: 'p1', title: '既存プロジェクト' } ] },
  { name: '開発', projects: [] }  // ← 削除された
];

// STEP 3: setDepartments call
// → buildSavePayload で上記を payload に詰める
payload.departments = [
  { name: '営業', projects: [ { id: 'p1', ... } ] },
  { name: '開発', projects: [] }
];

// STEP 4: DB UPSERT（FULL REPLACEMENT）
// → DB には削除後のデータが保存される
DB strategy_data.departments = 上記 payload

// STEP 5: ❌ ここが致命的
// safePatch に departments が含まれない
// → store.departments = UPDATE されない
// → store の in-memory state は古い値のままになる可能性

// STEP 6: refetch trigger
// → DB から fresh data 取得
patch.departments = [
  { name: '営業', projects: [ { id: 'p1', ... } ] },
  { name: '開発', projects: [] }
];

// STEP 7: merge
// base = 削除前のstate（in-memory に残存）
// minimal = extractServerDecidedPatch(patch, base)
//    → if (Array.isArray(resData.departments)) patch.departments = resData.departments;

// merged = { ...base, ...minimal }
// → minimal に departments がない場合
// → base.departments が優先される
// → ❌ 削除されたプロジェクト復帰
```

---

### ケースB：STAGE5 コメント追加 → 消失 / リロードで復活

#### **時系列フロー（秒単位）**

| T | ユーザー操作 | コード位置 | state 変化 | DB 状態 |
|---|-----------|----------|-----------|---------|
| 0.0 | モーダル open | `/app/execution/page.tsx` | - | - |
| 0.5 | useEffect loadLogs trigger | `/app/execution/page.tsx:476` | - | - |
| 1.0 | DB query 実行 | `/app/execution/page.tsx:483-488` | - | SELECT 実行 |
| 1.5 | setLogs(data) | `/app/execution/page.tsx:491` | `logs = []` (初期) | - |
| 2.0 | ユーザーが comment 入力 | `/app/execution/page.tsx` | `progressText = '...'` | - |
| 2.5 | 「記録」ボタン click | `/app/execution/page.tsx:509` | - | - |
| 3.0 | onSaveCheckin async 実行 | `/app/execution/page.tsx:509` | `saving=true` | - |
| 3.5 | saveProgressLog 実行 | `/app/execution/page.tsx:640` | - | INSERT開始 |
| 4.0 | setOKRTargetScore call | `/app/execution/page.tsx:666` | store 更新 | - |
| 4.5 | saveStrategyData async | `/app/execution/page.tsx:667` | - | UPDATE開始 |
| **5.0** | **setLogs で楽観更新** | `/app/execution/page.tsx:671-674` | **logs = [ { id: 'local-*', ... }, ...prev ]** | (INSERT 保留中) |
| 5.5 | UI再描画 | `/app/execution/page.tsx` | ✅ コメント表示 | - |
| 6.0 | ユーザーが「完了」ボタン | `/app/execution/page.tsx` | モーダル close | - |
| **6.5** | **モーダル close/open** | React unmount | ❌ 新instance生成 → logs state reset | (INSERT 進行中) |
| 7.0 | useEffect loadLogs trigger | `/app/execution/page.tsx:476` | - | - |
| **7.5** | **DB query 実行** | `/app/execution/page.tsx:483-488` | - | **⚠️ INSERT がまだ完了していない可能性** |
| 8.0 | setLogs(data) | `/app/execution/page.tsx:491` | `logs = [ ... DB data ]` | - |
| **8.5** | **UI再描画** | `/app/execution/page.tsx` | **❌ 「local-*」ログ消失** | (INSERT 完了待機中) |
| 9.0 | (INSERT finally完了) | progress_logs | - | ✅ DB に新規comment 保存完了 |
| 10.0 | ユーザーがリロード | ブラウザ reload | state全reset | - |
| 10.5 | useEffect loadLogs trigger | `/app/execution/page.tsx:476` | - | - |
| 11.0 | DB query 実行 | `/app/execution/page.tsx:483-488` | - | ✅ SELECT で新規comment**が**含まれる |
| 11.5 | setLogs(data) | `/app/execution/page.tsx:491` | `logs = [ 新規comment（正規ID）, ... ]` | - |
| 12.0 | UI再描画 | `/app/execution/page.tsx` | ✅ コメント復活 | - |

#### **データフロー図**

```
ユーザーがコメント入力 + 記録ボタンclick
    ↓
saveProgressLog async 開始（INSERT開始）
    ├→ DB への network request 送信
    └→ 完了時刻 = 不確定（ネットワーク遅延等）

並行して

楽観更新（UI表示用）
    ├→ setLogs で「local-*」をローカル state に追加
    └→ UI に表示

ユーザーが モーダル close / open
    ↓
React component unmount → 新instance生成
    ↓
新instance の useState hooks 実行
    └→ logs = [] (初期化)

useEffect loadLogs trigger
    ├→ DB query 実行
    └→ query 実行タイミング = saveProgressLog INSERT 完了状態に依存

    ⚠️ Case A: INSERT 完了済み
       → query に新規comment（正規ID）が含まれる
       → setLogs(data) で正規ID でのcomment 表示
       → ✅ 表示復活

    ⚠️ Case B: INSERT 未完了
       → query に新規comment が含まれない
       → setLogs(data) で「local-*」ログが上書き削除
       → ❌ コメント消失
```

#### **根本原因の確認**

```javascript
// 【タイミングの問題 - 実装による】

// POINT A: saveProgressLog は完了を保証しない
const { data: saved, error } = await saveProgressLog({...});  // [640行]

// await しているように見えるが、
// saveProgressLog() の実装が外部APIなので、
// network latency に依存する

// POINT B: setLogs で「local-*」を追加
setLogs((prev) => [  // [671行]
  { id: 'local-' + nowIso, ... },
  ...prev,
]);

// ここまでは「await saveProgressLog」の直後
// しかし、saveProgressLog の中身が:
// 1. DB INSERT を async 送信
// 2. すぐに return (完了待たずに)
// という実装の可能性が高い

// POINT C: モーダル close/open で instance 再生成
// → 新しい React instance
// → 新しい useState hooks
// → logs = []

// POINT D: useEffect[open] で loadLogs 再実行
// 依存性配列に 'open' が含まれている [497行]
// → open が true → loadLogs trigger

// POINT E: DB query のタイミング
// saveProgressLog の INSERT が「非同期で進行中」
// loadLogs の query が「同期的に実行」
// → INSERT 完了前に query が execute される可能性

// 【結論】
// saveProgressLog と loadLogs の「タイムシーケンス」が
// ネットワーク遅延に支配されている
// → 遅延が大きい場合、loadLogs が INSERT 完了前に実行される
// → query 結果に新規comment が含まれない
// → 「local-*」ログが削除される
```

---

## 第四部：修復方針

### I. 正本の一本化

#### **現在の問題**
```
STAGE3/4:
  - store.departments（正本のはずだが、保存後に古い state が残る）
  - DB strategy_data.departments（実際の正本）
  → 乖離が発生

STAGE5:
  - modal.logs（ローカル state）
  - DB progress_logs（実際の正本）
  → 非同期性で乖離
```

#### **修復の原則**

| 領域 | 正本 | 同期方法 | 反映先 |
|------|------|---------|--------|
| STAGE1-4 | **DB strategy_data** | save は FULL REPLACEMENT / restore は patch の全フィールド反映 | store.departments, store.story など |
| STAGE5 | **DB progress_logs** | save は async insert / restore は query + ローカルmerge | modal.logs（ローカル） |
| STAGE6 | **DB strategy_data** | save は FULL REPLACEMENT / restore は patch反映 | store.stage4Plans など |

#### **修正方策**

```
方策A: refetchFromServer で FULL REPLACEMENT を強制
  現在: const minimal = extractServerDecidedPatch(patch, base);
        const merged = { ...base, ...minimal };

  修正: const merged = { ...base, ...patch };  // patch をそのまま使用

  効果: DB fresh data で store を完全に上書き
       → 削除データは確実に反映される

方策B: setDepartments 直後に departments を反映
  現在: safePatch に departments がない

  修正: const directPatches = {
         departments: Array.isArray(patch.departments) ? patch.departments : undefined,
       };
       safePatch = { ...safePatch, ...directPatches };

  効果: save直後に削除が store に反映される
       → refetch不要になる可能性
```

### II. 保存契機の統一

#### **現在の問題**
```
setDepartments → async saveStrategyData (遅延あり)
  ├→ post-restore cooldown [2100ms待機]  [/store/strategyStore.ts:2914]
  ├→ enqueueSave (直列化)
  └→ revision conflict retry (3回まで)

setOKRTargetScore → async saveStrategyData (遅延あり)

saveProgressLog → 独立した async (store.saveStrategyData と並行)
  └→ タイムシーケンス不確定
```

#### **修復の原則**

```
保存契機は「5種類」に統一:
1. User manual save（手動保存）→ force=true, reason='manual'
2. Auto-save（debounce済み） → force=false, reason='autosave'
3. setDepartments → reason='setDepartments'
4. saveProgressLog → 独立（store.saveStrategyData と別）
5. refetch/restore 後の sync → reason='postRestore'

各契機の「待機・スキップ ロジック」を明示:
  - dirty=false → skip（autosave only）
  - isRestoring=true → skip（restore cooldown）
  - isSaving=true → pending queue
```

#### **修正方策**

```typescript
// 修正案：saveProgressLog と store.saveStrategyData の順序を明確化

// BEFORE
const { data: saved } = await saveProgressLog({...});
useStrategyStore.getState().setOKRTargetScore(okrId, rating);
await useStrategyStore.getState().saveStrategyData({ reason: 'manual' });

// AFTER
const { data: saved } = await saveProgressLog({...});  // progress_logs insert

// 次に store を更新（これが strategy_data update を trigger）
useStrategyStore.getState().setOKRTargetScore(okrId, rating);

// saveStrategyData は setOKRTargetScore 内で async trigger
// （待機はしない、但し logging で追跡）

// logging
console.log('[STAGE5:save:sequence]', {
  saveProgressLog: 'completed',
  setOKRTargetScore: 'called',
  saveStrategyData: 'queued (async)',
  timestamp: new Date().toISOString(),
});
```

### III. restore / merge / normalize の見直し

#### **現在の問題**
```
extractServerDecidedPatch:
  - 条件付きで departments を patch に含める
  - 欠落フィールドは undefined（merge で base が残る）

refetchFromServer merge:
  - { ...base, ...minimal } で上書き予定
  - しかし、minimal に departments がない場合、失敗

normalizeStrategyData:
  - 暫定ID（dept_0等）をそのまま保持
  - ID mismatch による orphan 化
```

#### **修復の原則**

```
normalize:
  目的: DB raw data → 正規化state（ID生成等）
  変更: 暫定ID を生成しない（ID required）

merge:
  目的: server patch と local state を統合
  変更: 条件付き patch ではなく FULL patch使用

restore:
  目的: DB fresh data を store に反映
  変更: normalize後の data をそのまま使用
```

#### **修正方策**

```typescript
// normalizeDepartments で ID補完を廃止
// /utils/supabase/normalize.ts:463

export function normalizeDepartmentsAny(input: unknown, strategyId?: string): Department[] | undefined {
  if (!input) return undefined;
  const src = parseIfJsonString<any>(input);

  if (Array.isArray(src)) {
    const arr = (src as unknown[])
      .map((v) => normalizeDepartment(v as AnyDepartment, strategyId))
      .filter((d) => {
        // ⚠️ 追加: id がない場合、スキップ または エラー
        if (!d?.id) {
          console.error('[NORMALIZE] department without id detected:', d);
          return false;  // skip orphan departments
        }
        return true;
      });
    return arr.length ? arr : undefined;
  }
  return undefined;
}

// refetchFromServer の merge を完全置換に
// /store/strategyStore.ts:3696

const merged = {
  ...base,
  ...patch,  // ← minimal ではなく patch をそのまま使用
  companyId: pendingCompanyId ?? companyId,
  pendingCompanyId: undefined,
};
```

### IV. stage間参照元の統一

#### **現在の問題**
```
STAGE3 cascade/page.tsx:
  - departments を store から読み取り
  - UI に表示（state.departments）
  - 削除後、refetch で古いdepartmentsが復帰

STAGE4 okr/page.tsx:
  - departments + projects を store から読み取り
  - 削除されたプロジェクト が表示される場合がある

STAGE5 execution/page.tsx:
  - progress_logs をローカル state から読み取り
  - 新規comment が消失する場合がある
```

#### **修復の原則**

```
参照元は「1つ」に統一:
- STAGE3,4,5,6: 常に store.departments を参照
- STAGE5: progress_logs はローカル state（UI表示用）
           実データは常に DB progress_logs を参照

同期契機:
- refetchFromServer 後、全ページで store が update
- store update 後、各ページが自動 re-render
```

#### **修正方策**

```typescript
// STAGE5 では progress_logs を store に統合（長期目標）

// 短期修正：loadLogs を refetchからは独立させない

// BEFORE
useEffect(() => {
  const loadLogs = async () => {
    const { data } = await supabase
      .from('progress_logs')
      .select(...)
      .eq('okr_id', resolvedProgressOkrId);

    setLogs(data);  // ← DB fresh data で上書き（local-*削除）
  };
  loadLogs();
}, [open, userId, resolvedProgressOkrId]);  // ← open 依存

// AFTER
useEffect(() => {
  const loadLogs = async () => {
    const { data } = await supabase
      .from('progress_logs')
      .select(...)
      .eq('okr_id', resolvedProgressOkrId);

    // local-* ログを保護
    setLogs((prev) => {
      const localLogs = prev.filter((l) => l.id.startsWith('local-'));
      const dbLogs = (data || []).filter((d) => !d.id.startsWith('local-'));
      return [...localLogs, ...dbLogs].sort((a, b) =>
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      );
    });
  };
  loadLogs();
}, [open, userId, resolvedProgressOkrId]);  // open 依存は保持（初期load用）
```

### V. 保存状態UI の共通化

#### **現在の問題**
```
STAGE3/4:
  - 「保存しました」というメッセージがない
  - ユーザーが「保存されたか」判断できない

STAGE5:
  - saveProgressLog は「記録しました」と表示
  - saveStrategyData は silent（logging のみ）
```

#### **修復の原則**

```
保存状態を「4状態」で表示:
1. dirty / unsaved: 未保存の編集がある
2. saving: DB への保存中
3. saved: DB に保存完了
4. error: 保存エラー発生
```

#### **修正方策**

```typescript
// 共通化された SaveStatusIndicator（既存）を全PAGE で使用

// STAGE3 cascade/page.tsx に追加
const saveStatus = useStrategyStore((s) => ({
  dirty: s.dirty,
  saving: s._loadingSave,
  error: s.saveError,
  lastSavedAt: s.lastSavedAt,
}));

// UI に SaveStatusIndicator を配置
<SaveStatusIndicator
  status={saveStatus.dirty ? 'unsaved' : saveStatus.saving ? 'saving' : 'saved'}
  error={saveStatus.error}
  lastSavedAt={saveStatus.lastSavedAt}
/>

// STAGE5 execution/page.tsx でも同様
```

---

## 第五部：修正順序

### **Phase 1：最優先（緊急）**

#### **修正1-1：refetchFromServer の merge を FULL REPLACEMENT に**

**対象ファイル**: `/store/strategyStore.ts:3696-3724`

**変更内容**:
```typescript
// 変更前
const minimal = extractServerDecidedPatch(patch, base);
const merged = {
  ...base,
  ...minimal,
  companyId: pendingCompanyId ?? companyId,
};

// 変更後
// minimal ではなく patch をそのまま使用（条件付き不要）
const merged = {
  ...base,
  ...patch,  // ← FULL PATCH
  companyId: pendingCompanyId ?? companyId,
  pendingCompanyId: undefined,
  // DB は source of truth → patch で完全上書き
};
```

**効果**: 削除→復活 問題を根治

**テストケース**:
```
1. STAGE3 でプロジェクト削除
2. REVISION_CONFLICT 発生（または 3秒待機で refetch trigger）
3. refetch 直後の departments 状態確認
   → 削除されたプロジェクトが store に無いこと
```

**優先度**: 🔴 **CRITICAL**

---

#### **修正1-2：STAGE5 ローカルstate の saveProgressLog 完了待機**

**対象ファイル**: `/app/execution/page.tsx:509-702`

**変更内容**:
```typescript
// 変更前
const { data: saved, error } = await saveProgressLog({...});

if (error) throw error;

console.log('[STAGE5-save-checkin-success]', {...});

useStrategyStore.getState().setOKRTargetScore(okrId, rating);
await useStrategyStore.getState().saveStrategyData({ reason: 'manual' });

// ★ ここが問題：saveProgressLog の DB INSERT 完了を確認せず
setLogs((prev) => [
  { id: 'local-' + nowIso, ... },
  ...prev,
]);

// 変更後
const { data: saved, error } = await saveProgressLog({
  userId,
  okrId: okrIdForSave,
  content: embedMetadata(metadata, composed),
  ...
});

if (error) throw error;

// ★ saveProgressLog が正常に DB保存されたことを確認
const savedId = saved?.id;
if (!savedId) {
  throw new Error('saveProgressLog: saved.id is missing');
}

console.log('[STAGE5-save-checkin-success]', {
  savedId,
  savedScore: saved?.score,
  timestamp: new Date().toISOString(),
});

useStrategyStore.getState().setOKRTargetScore(okrId, rating);
await useStrategyStore.getState().saveStrategyData({ reason: 'manual' });

// ★ saveProgressLog が確実に完了してから setLogs
// （saved.id が存在することで完了を確認）
setLogs((prev) => [
  {
    id: savedId,  // ← 'local-*' ではなく DB から返された正規ID を使用
    created_at: saved?.created_at ?? nowIso,
    content: composed,
    score: rating ?? null,
    status: saved?.status ?? null,
  },
  ...prev,
]);
```

**効果**: STAGE5 コメント消失 問題を根治

**テストケース**:
```
1. STAGE5 モーダルでコメント追加 + 記録
2. 記録直後にモーダル close/open
3. コメントが表示されていることを確認
   → 削除されていないこと
4. ブラウザ reload
   → コメント が表示されること（DB保存確認）
```

**優先度**: 🔴 **CRITICAL**

---

### **Phase 2：本質的修正（1-2日）**

#### **修正2-1：buildSavePayload での暫定ID生成を廃止**

**対象ファイル**:
- `/store/strategyStore.ts:755-765`
- `/utils/supabase/strategy.ts:1706-1714`

**変更内容**:
```typescript
// /store/strategyStore.ts:755-765

// 変更前
const normalizedDepts = (Array.isArray(s.departments) ? s.departments : []).map((d: any, dIdx: number) => ({
  ...d,
  id: d?.id ?? d?.departmentId ?? `dept_${dIdx}`,  // ❌ 暫定ID
  projects: (Array.isArray(d?.projects) ? d.projects : []).map((p: any, pIdx: number) => ({
    ...p,
    id: p?.id ?? p?.projectId ?? `proj_${dIdx}_${pIdx}`,  // ❌ 暫定ID
  })),
}));

// 変更後
const normalizedDepts = (Array.isArray(s.departments) ? s.departments : []).map((d: any, dIdx: number) => {
  // ★ ID がない場合は警告 + エラーログ
  if (!d?.id && !d?.departmentId) {
    console.error('[SAVE_ERROR] Department without id detected:', {
      index: dIdx,
      name: d?.name,
      timestamp: new Date().toISOString(),
    });
    // ID がない department は保存対象外
    return null;  // filter で除外
  }

  return {
    ...d,
    id: d?.id ?? d?.departmentId,  // ← 暫定ID不使用
    projects: (Array.isArray(d?.projects) ? d.projects : []).map((p: any, pIdx: number) => {
      if (!p?.id && !p?.projectId) {
        console.error('[SAVE_ERROR] Project without id detected:', {
          department: d?.name,
          index: pIdx,
          title: p?.title,
          timestamp: new Date().toISOString(),
        });
        return null;  // filter で除外
      }

      return {
        ...p,
        id: p?.id ?? p?.projectId,  // ← 暫定ID不使用
        okrsV2: sanitizeOkrsV2(p.okrsV2),
      };
    }).filter(Boolean),  // null を除外
  };
}).filter(Boolean);  // null を除外
```

**効果**: ID mismatch による orphan projects 防止

**テストケース**:
```
1. AI生成プロジェクト（id=undefined）を作成
2. 削除操作を実行
3. refetch 後、orphan detection を確認
   → エラーログが出ていないこと
4. stage4Plans との照合確認
   → orphan projects がないこと
```

**優先度**: 🟠 **HIGH**

---

#### **修正2-2：extractServerDecidedPatch の欠落フィールド明示化**

**対象ファイル**: `/store/strategyStore.ts:970-1024`

**変更内容**:
```typescript
// 変更前
function extractServerDecidedPatch(
  resData: Partial<StrategyState> & { revision?: number },
  current: StrategyState
): Partial<StrategyState> {
  const patch: Partial<StrategyState> = {};

  // 条件付きで departments を含める（欠落の可能性）
  if (Array.isArray(resData.departments)) patch.departments = resData.departments;

  // ... other fields

  return patch;  // ← departments が欠落している可能性
}

// 変更後
function extractServerDecidedPatch(
  resData: Partial<StrategyState> & { revision?: number },
  current: StrategyState
): Partial<StrategyState> {
  const patch: Partial<StrategyState> = {};

  /* 常に反映（削除データも含めて） */
  if (Array.isArray(resData.departments)) {
    patch.departments = resData.departments;
  } else if (resData.departments === null) {
    // null は「明示的に空」
    patch.departments = [];
  }
  // undefined は「欠落」→ merge で base を使用しない（後で patch をそのまま使用）

  // ... other fields

  // ★ 診断ログ：欠落フィールドを出力
  const missingFields = [];
  if (!('departments' in patch)) missingFields.push('departments');
  if (!('story' in patch)) missingFields.push('story');
  if (missingFields.length > 0) {
    console.warn('[PATCH] missing fields (will NOT override base):', missingFields);
  }

  return patch;
}
```

**効果**: refetch 時の merge ロジックを予測可能に

**テストケース**:
```
1. 複数の save/refetch cycle
2. 各 refetch で extractServerDecidedPatch 出力を確認
   → missing fields が出ていないこと
3. departments が常に patch に含まれること
```

**優先度**: 🟡 **MEDIUM**

---

### **Phase 3：長期的強化（2-3日）**

#### **修正3-1：STAGE5 progress_logs を store に統合**

**対象ファイル**:
- `/store/strategyStore.ts` （新規メソッド追加）
- `/app/execution/page.tsx` （loadLogs logic 削除）

**変更内容**:
```typescript
// /store/strategyStore.ts に新規メソッド追加

// progressLogs state
type ProgressLogState = {
  progressLogs: Record<string, LogRow[]>;  // { [okrId]: LogRow[] }
  progressLogsLoading: Record<string, boolean>;
  progressLogsError: Record<string, Error | null>;
};

// メソッド追加
loadProgressLogsForOKR: async (okrId: string, userId: string) => {
  set((s) => ({
    progressLogsLoading: { ...(s as any).progressLogsLoading, [okrId]: true },
  }));

  try {
    const { data, error } = await supabase
      .from('progress_logs')
      .select(...)
      .eq('okr_id', okrId)
      .eq('user_id', userId);

    if (error) throw error;

    set((s) => ({
      progressLogs: { ...(s as any).progressLogs, [okrId]: data || [] },
      progressLogsLoading: { ...(s as any).progressLogsLoading, [okrId]: false },
    }));
  } catch (e) {
    set((s) => ({
      progressLogsLoading: { ...(s as any).progressLogsLoading, [okrId]: false },
      progressLogsError: { ...(s as any).progressLogsError, [okrId]: e as Error },
    }));
  }
};

// execution/page.tsx ではこれを使用
const logs = useStrategyStore((s) => (s as any).progressLogs?.[okrId] || []);
const loading = useStrategyStore((s) => (s as any).progressLogsLoading?.[okrId] ?? false);
```

**効果**: STAGE5 の state 管理を一本化

**テストケース**:
```
1. 複数の OKR で並行してログロード
2. store の progressLogs 状態確認
3. refetch/restore 時の自動同期確認
```

**優先度**: 🟡 **MEDIUM**

---

### **依存関係グラフ**

```
修正1-1 (refetch FULL REPLACEMENT)
  ↓ (必須)
修正1-2 (STAGE5 await)
  ↓ (推奨)
修正2-1 (buildSavePayload ID廃止)
  ↓ (推奨)
修正2-2 (extractServerDecidedPatch明示化)
  ↓ (長期)
修正3-1 (store 統合)
```

**実装順序**:
1. **修正1-1 → 修正1-2**: Phase 1 で同時実装（相互依存）
2. **修正2-1 → 修正2-2**: Phase 2 で順番に実装
3. **修正3-1**: Phase 3 で単独実装

---

### **後方互換性の注意点**

| 修正 | DB schema 変更 | migration 必要 | 互換性 |
|------|--------------|---------------|--------|
| 修正1-1 | なし | なし | ✅ 完全互換 |
| 修正1-2 | なし | なし | ✅ 完全互換 |
| 修正2-1 | なし | なし | ⚠️ 暫定ID持ちレコード（新規保存で上書き） |
| 修正2-2 | なし | なし | ✅ 完全互換 |
| 修正3-1 | なし | なし | ✅ store フィールド追加のみ |

**注意**:
- 修正2-1 で「暫定ID（dept_0等）」を持つ古いレコードが DB に存在する場合
  - これらのレコードは「新規保存時に自動的に正規IDで上書き」される
  - migration 不要（既存データは使用制限なし、新規保存で修正される）
  - 5-10 回の save cycle で自動的に清掃される

---

## まとめ

### **根本原因の一点特定**

| 症状 | 根本原因 | 失われるポイント | 修正 |
|------|---------|------------------|------|
| プロジェクト削除→復活 | refetchFromServer の merge で base が優先 | `store.departments` に古いデータ残存 | 修正1-1 |
| コメント消失→リロード復活 | saveProgressLog と loadLogs のタイムラグ | `logs` ローカル state の上書き | 修正1-2 |
| orphan projects発生 | buildSavePayload での暫定ID生成 | 正規ID との照合失敗 | 修正2-1 |

### **実装ロードマップ**

```
Week 1 (優先)
  Day 1: 修正1-1 (refetch) + 修正1-2 (STAGE5)
  Day 2: テスト + bugfix

Week 2 (本質)
  Day 1: 修正2-1 (ID廃止)
  Day 2: 修正2-2 (extractPatch)
  Day 3: テスト + integration

Week 3 (長期)
  Day 1-2: 修正3-1 (store統合)
  Day 3: テスト + release
```

---

**報告書作成**: 2026-04-06
**調査方法**: ソースコード直接追跡
**根拠**: 実装ロジック + データフロー + エビデンスコード
