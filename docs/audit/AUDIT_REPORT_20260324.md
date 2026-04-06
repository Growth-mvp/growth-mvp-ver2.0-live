# GROWTH MVP v2.0 不具合監査レポート

**監査日**: 2026-03-24
**監査範囲**: コードベース読解（実機テストなし）
**目的**: 実機確認前に高リスク不具合候補・設計不整合・再発リスクを洗い出す

---

## 📊 総評

GROWTH の現状は**堅牢な設計**を有していますが、以下の3つのレイヤーに**致命的なリスク**が集中しています：

1. **削除・復活のカスケード漏れ**（Severity A）
   - Department 削除後、okrsV2 データが孤立し、復元・再計算時に異常値が発生する温床
   - orphan cleanup は stage4Plans のみで、okrs/okrsV2 は検証されない

2. **保存・同期の二重化・レース**（Severity A）
   - setDepartments() で useAutoSave + immediate save の両方が走る
   - refetchFromServer() 直後の restoreReady cooldown が機能不十分
   - STAGE3 AI生成時の予期しないマージ・上書き

3. **正規化・復元の項目落ち**（Severity A）
   - buildPayload() と normalizeFromDbRow() で異なる正規化が実行
   - 双方向性が欠落している（save → load で形状が変わる）
   - nullable フィールドが削除される可能性

4. **STAGE間の参照キーの混在**（Severity B）
   - departmentId, dept.name, dept.id が混在して参照される
   - title 変更や並び替えで参照が壊れやすい
   - projectTargetImpacts や okrTargetScores は projectId 依存だが、project削除時に孤立

5. **useEffect・state同期の複雑性**（Severity B）
   - recomputeValueAnalysis() が複数箇所から呼ばれ、タイミングが不定
   - setFinancePL → setProfile → recomputeValueAnalysis の多重トリガー
   - 初期化遅延（setTimeout）で順序が不保証

---

## 📋 重大度別の指摘一覧（12件）

### **Severity A: 高確率で事故につながる（5件）**

#### 【A-1】削除復活バグ：Department 削除後の okrsV2 孤立

**Severity:** A（データ損失・異常値につながる）

**対象ファイル:**
- `/utils/persist/restoreWithAudit.ts:205-230` (orphan cleanup ロジック)
- `/store/strategyStore.ts` (removeDepartment action)

**該当箇所:**
```typescript
// restoreWithAudit.ts: 205-229
if (hydratedState.stage4Plans && hydratedState.departments) {
  const validDeptIds = new Set(
    hydratedState.departments.map((d: any) => d.id || d.name)
  );

  // ★ 清掃対象は stage4Plans のみ！
  hydratedState.stage4Plans = hydratedState.stage4Plans.filter((plan: any) => {
    if (!validDeptIds.has(plan.departmentId)) {
      console.warn('[restore:orphan] Removing orphan stage4Plan:', ...);
      return false;
    }
    return true;
  });
  // ★ okrs / okrsV2 は検証されない！
}
```

**何が危ないか:**
1. Department 削除時に `departments` 配列から削除される
2. 当該 department の projects[] に含まれる okrs/okrsV2 がデータベースに残る
3. リロード時の restore では stage4Plans の orphan のみ掃除される
4. okrs/okrsV2 の department 参照が壊れたまま保持される
5. STAGE4 で該当 OKR を表示しようとするとクラッシュ
6. STAGE6 で projectTargetImpacts を計算する際、孤立した okrId を参照してNaN/エラーが発生

**なぜそう判断したか:**
- restoreWithAudit() の orphan cleanup コードを読むと、stage4Plans の validDeptIds チェックはあるが、department 配下の okrs/okrsV2 の清掃ロジックがない
- normalizeFromDbRow() で departments[].projects[] が復元されるが、削除済み parent への参照チェックがない
- deleteDepartment(deptId) の実装では、projects[] のみが nullify され、okrs/okrsV2 の孤立状態が放置される

**想定される再現シナリオ:**
1. STAGE3 で「営業部」を作成、プロジェクト「新規営業システム」、OKR「売上+30%」を追加
2. STAGE4 で OKR を確認（OK）
3. STAGE3 に戻り、「営業部」を削除（トラッシュアイコン）
4. DB 上では departments から削除されるが、okrs/okrsV2 は残る
5. リロード（F5）
6. STAGE4 に遷移 → okrId を参照しようとしてクラッシュまたは「undefined」プロジェクト表示
7. STAGE6 で projectTargetImpacts を再計算 → 孤立した okrId に対応する project がないため計算失敗

**影響範囲:**
- STAGE3/4 連動
- STAGE4/6 連動
- 実機テスト：部門削除後のSTAGE4/6表示
- データ復帰難度：高（orphan okrs/okrsV2 を手動で掃除する必要）

**修正方針の方向性:**
1. `restoreWithAudit()` の orphan cleanup を拡張：department 配下の okrs/okrsV2 も validDeptIds で検証
2. または、削除時に CascadeDelete ロジックを追加（department 削除 → 配下 projects 削除 → okrs/okrsV2 削除）
3. または、Supabase 側で FK constraint + ON DELETE CASCADE を設定

---

#### 【A-2】二重保存・レースコンディション：setDepartments の immediate save + useAutoSave

**Severity:** A（競合エラー、revision 不一致による上書き）

**対象ファイル:**
- `/store/strategyStore.ts:2900-2929` (setDepartments)
- `/store/strategyStore.ts:2931-2960` (updateDepartments)
- `/hooks/useAutoSave.ts:438` (saveStrategyData 呼び出し)

**該当箇所:**
```typescript
// strategyStore.ts: 2900-2929
setDepartments: (deps: SafeDepartmentsArg) => {
  set((s) => ({
    departments: normalizeDepartmentsInput(deps, s.departments),
    dirty: true,
    version: (s.version ?? 0) + 1,
  }));

  // ★ 即座に保存開始（async, 並行実行）
  (async () => {
    // ... cooldown check ...
    try {
      await get().saveStrategyData({ reason: 'setDepartments' });  // ← SAVE 1
    } catch (e) {
      console.warn('[strategyStore] setDepartments immediate save failed:', e);
    }
  })();
},

// AND：同時刻に
// useAutoSave が signature 変更を検知
// → trigger() → debounce(1200ms) → doSave() → saveStrategyData()  ← SAVE 2
```

**何が危ないか:**
1. `setDepartments()` 直後、即座に `saveStrategyData()` が非同期実行される
2. ほぼ同時に、useAutoSave の change detection により signature が変わり、debounce タイマが起動される
3. debounce 時間（1200ms）内に immediate save が完了すれば OK
4. しかし、immediate save が何らかの理由で遅延（ネットワーク遅延、revision 競合）した場合：
   - useAutoSave の debounce が満期し、SAVE 2 が実行される
   - SAVE 1 と SAVE 2 の `revision` が異なる可能性 → 後者が失敗または上書き
5. リーダーの場合、最初の save の revision が古く、次の save で revision 不一致エラーが発生
6. conflict cooldown（5秒）で autosave が止まり、以降の編集が保存されない

**なぜそう判断したか:**
- setDepartments() で async 即座保存が行われ、await されない
- useAutoSave の guard には conflict cooldown check があるが、2つの同時保存には対応していない
- build_payload → revision チェック → save という流れで、revision が競合する窓口がある
- strategy.ts:saveStrategyData API では revision を optimistic locking に用いているが、2つの保存が並行すると old revision で save 2 が失敗する

**想定される再現シナリオ:**
1. STAGE3 で「営業部」を作成
2. 同時に他の箇所でネットワークが遅い環境に移動
3. `updateDepartments()` を実行（部門名変更など）
4. immediate save が 100-500ms 遅延
5. useAutoSave debounce が 1200ms で満期し、SAVE 2 が開始
6. 一方 SAVE 1 がようやく完了（revision 10）
7. SAVE 2 は revision 9 で save しようとする
8. DB で revision = 10 のため revision 不一致エラー
9. UI: エラーメッセージ表示 → conflict cooldown 開始 → 5秒間自動保存停止
10. ユーザーが部門削除などを試みても保存されない

**影響範囲:**
- STAGE3（部門操作が多い）
- ネットワーク遅延が大きい環境で高確率で発生
- revision mismatch エラーログが多数発生
- conflict recovery の cooldown により以降の編集が保存されない（最大5秒間）

**修正方針の方向性:**
1. setDepartments / updateDepartments から immediate save を削除し、useAutoSave に一本化
2. または、immediate save 完了を await して、その後 useAutoSave trigger を抑止する
3. または、setDepartments 直後の署名変更を useAutoSave で検知しないようフラグを立てる
4. conflict cooldown 時間を短縮（現在5秒 → 2-3秒）

---

#### 【A-3】正規化の非対称性：save 時と load 時で型が異なる

**Severity:** A（保存情報の復元漏れ、型不整合）

**対象ファイル:**
- `/store/strategyStore.ts:536-603` (pruneUndefinedDeep, isEffectivelyEmpty)
- `/store/strategyStore.ts:1332-1704` (normalizeFromDbRow)
- `/utils/supabase/normalize.ts` (normalizeStrategyData)

**該当箇所:**

Save 時（buildSavePayload）:
```typescript
// strategyStore.ts: 536-603
function pruneUndefinedDeep<T>(obj: T): T {
  if (Array.isArray(obj)) {
    return obj
      .map(pruneUndefinedDeep)
      .filter((v) => !(v === undefined || v === null))  // ★ null も削除
      as unknown as T;
  }
  if (obj && typeof obj === 'object') {
    const out: any = {};
    for (const [k, v] of Object.entries(obj as any)) {
      const pv = pruneUndefinedDeep(v);
      const drop = pv === undefined || pv === null || (typeof pv === 'string' && pv.trim() === '');
      // ★ 空文字列も削除
      if (!drop) out[k] = pv;
    }
    return out;
  }
  return obj;
}
```

Load 時（normalizeFromDbRow）:
```typescript
// strategyStore.ts: 1603-1676
const patch: any = {
  strategyId,
  revision,

  // ★ 全フィールドを復元しようとするが...
  companyName,      // undefined なら '' で補填されない
  mission,          // undefined なら '' で補填されない
  stage1Issues,     // null なら [] で補填されない
  // ...
};

// ★ pruned フィールドを削除
let pruned = 0;
for (const [key, value] of Object.entries(patch)) {
  if (value === undefined) {
    delete patch[key];    // ★ undefined フィールド削除
    pruned++;
  }
}
```

**何が危ないか:**
1. save 時：pruneUndefinedDeep() が null, 空文字列 '' を削除
2. save 時：isEffectivelyEmpty() が stage1Issues = [] なら payload 全体をスキップ
3. load 時：normalizeFromDbRow() が undefined フィールドを delete して削除
4. load 時：補填ロジック（undefined → ''）がない

例：
```
Save: { stage1Issues: [], companyName: '' }
  ↓ pruneUndefinedDeep
Payload: {} (stage1Issues と companyName が削除)
  ↓ Supabase upsert
DB: { ... stage1Issues が null, companyName が NULL ... }
  ↓ Load → normalizeFromDbRow
Restored: {} または { stage1Issues: undefined, companyName: undefined }
  ↓ UI
empty 状態に戻った（二重削除）
```

**想定される再現シナリオ:**
1. STAGE1：stage1Issues に複数の論点を入力 → 保存（OK）
2. STAGE1：全論点を削除 → 保存（buildPayload で stage1Issues は [] で pruned される）
3. リロード（F5）
4. STAGE1：論点が空のまま（復元されない）
5. 実機では「論点が復元されない」という現象が起きる

別パターン：
1. STAGE2：companyTargets (North Star) を追加 → 保存（OK）
2. UI から companyTargets をクリアしていない
3. しかし save 時に全フィールド empty 判定で payload からも削除される
4. リロード → companyTargets が消える（不正な削除）

**影響範囲:**
- STAGE1 (stage1Issues, stage1Benchmarks の削除)
- STAGE2 (companyTargets, storyDraft, answers12 の削除)
- 全 empty フィールドの往復同期
- 実機：「保存したはずなのに削除される」という報告が増える

**修正方針の方向性:**
1. pruneUndefinedDeep で empty string を削除しない（またはフラグ化）
2. normalizeFromDbRow で undefined → default value（'' or []）に補填
3. buildSavePayload と normalizeFromDbRow の型スキーマを統一
4. 往復テスト（save → load → save で不変か）を CI に追加

---

#### 【A-4】buildPayload vs normalizeStrategyData の非対称正規化

**Severity:** A（フィールド形状の不整合、保存・復元のずれ）

**対象ファイル:**
- `/store/strategyStore.ts:983` (buildPayload 呼び出し)
- `/utils/supabase/normalize.ts` (normalizeStrategyData実装)
- `/utils/supabase/strategy.ts:saveStrategyData` (保存API)

**何が危ないか:**
1. save 時に okrsV2 で空ラベル items を filter
2. load 時に復元するが、削除済み items は戻らない
3. ユーザーが「okrsV2 を確認したら item が減っていた」という現象が起きる
4. draft → save → reload で okrsV2 が減少する（予期しない削除）
5. 計算結果の不安定性（item 数が変わるため、STAGE6 計算が異なる）

**想定される再現シナリオ:**
1. STAGE4 で okrsV2 に 5 個の KR を追加（内1つは label が empty のまま保存クリック）
2. save → Supabase upsert（okrsV2 から空ラベル item が削除）
3. STAGE6 で KR 数をカウント → 4 個になっている（5 個から 1 個削除）
4. 計算結果（impact, target）が変わる

**影響範囲:**
- STAGE4/5 の okrsV2 表示
- STAGE6 計算の再現性
- revision mismatch で「計算結果がおかしい」という報告

**修正方針の方向性:**
1. buildSavePayload で okrsV2 sanitize を strict に（UI側で empty を許さない）
2. または、save 時に warning を出す（UI でユーザーが empty item に気づく）
3. normalizeStrategyData で削除済み item を復元する（復元ロジック実装）
4. save/load テストで okrsV2 item count の不変性を確認

---

#### 【A-5】STAGE3 AI生成時の予期しないマージ・上書き

**Severity:** A（ユーザー手入力データの上書き、STAGE3計画の不一致）

**対象ファイル:**
- `/app/cascade/page.tsx:1-400` (2レーンマージロジック)
- `/api/generate-cascade` (生成API)

**何が危ないか:**
1. AI 生成で lanes.existing（既存） と lanes.new（新規） が返される
2. タイトル正規化による「重複排除」は実装されている（idempotent）
3. しかし「ユーザーが STAGE3 で手入力した data」と「API が返す new lane」のマージルールが不明確
4. 例：
   - 既存：「営業プロセス改革」(ユーザー手入力)
   - new lane：「営業プロセス最適化」(AI生成)
   - → 正規化後「営業プロセス」になり、どちらか一方が上書きされる可能性
5. expectedImpactYen, probability の保持ロジックも「本当に drop されていない」かが不確実
6. 再生成のたびに projects[] が変わる可能性

**想定される再現シナリオ:**
1. STAGE3 で「営業プロセス改革」をユーザーが手入力で作成
2. AI で cascade 生成クリック
3. API が existing lane: [「営業プロセス改革」], new lane: [「営業プロセス最適化」] を返す
4. マージ後：「営業プロセス」でまとめられ、ユーザー入力の metadata が失われる
5. 再度 AI 生成 → 同じ title なら new lane が上書き
6. ユーザーの手入力（hypothesis, mainLever など）が消える

**影響範囲:**
- STAGE3 全体（複数回の AI 生成 + 手入力のマージ）
- マルチユーザー環境（他ユーザーの AI 生成時に自分の手入力が消える）
- STAGE4 以降との連動（STAGE3 data が不安定なため）

**修正方針の方向性:**
1. タイトル正規化の定義を明確にドキュメント化
2. マージロジックで「既存データ優先」か「新規データ優先」かを明示
3. 再生成のたびに "version" をつけ、履歴管理
4. ユーザー手入力 metadata（hypothesis など）を「AI 生成で上書きしない」と明記
5. マージ結果を UI で preview し、ユーザー確認を必須に

---

### **Severity B: 条件次第で不具合化する（4件）**

#### 【B-1】STAGE間の参照キー混在：departmentId vs dept.name vs dept.id

**Severity:** B（参照がズレやすい、title 変更で壊れる）

**対象ファイル:**
- `/utils/persist/restoreWithAudit.ts:206-209` (dept.id || dept.name)

**該当箇所:**
```typescript
// restoreWithAudit.ts: 206-209
const validDeptIds = new Set(
  hydratedState.departments.map((d: any) => d.id || d.name)
  // ★ dept.id と dept.name の両方を使用！どちらでもマッチ
);
```

**何が危ないか:**
1. department の ID は：d.id（UUID）と d.name（名前） の両方で識別される可能性
2. project 参照時に projectId 使用、しかし title で検索される場合も
3. name が重複する場合がある（不幸な事態）：
   - dept1.id = "uuid-123", dept1.name = "営業部"
   - dept2.id = "uuid-456", dept2.name = "営業部" ← 重複
   - validDeptIds = {"uuid-123", "uuid-456", "営業部"}
   - マッチ順序が不定
4. title 変更時に参照が壊れる
5. マージ時に dept.id と dept.name で異なる department が混在

**想定される再現シナリオ:**
1. STAGE3 で「営業部」(id: uuid-1) を作成 → project 追加
2. STAGE3 で「営業部」の name を「営業推進部」に変更
3. リロード
4. stage4Plans 復元時、departmentId = uuid-1 で検索
5. しかし validDeptIds = {"uuid-1" またはそのname}
6. name 参照時に新 name「営業推進部」がマッチせず → orphan 判定
7. stage4Plans が削除される

**影響範囲:**
- STAGE3/4 連動
- department の name 変更後のリロード
- 複数 department で同じ name がある環境

**修正方針の方向性:**
1. department reference を ID のみに統一（name ではなく id を常に使用）
2. normalize.ts で dept.id が必ずあるようにする（ID 生成ロジック ensureDepartmentId 活用）
3. stage4Plans は departmentId で strict に管理
4. orphan cleanup で `d.id` のみ使用（|| d.name は削除）

---

#### 【B-2】recomputeValueAnalysis の多重トリガー・タイミング不定

**Severity:** B（計算結果の再現性低下、STAGE6 異常値）

**対象ファイル:**
- `/store/strategyStore.ts:2271-2352` (recomputeValueAnalysis)
- `/store/strategyStore.ts:2355-2407` (setFinancePL で setTimeout トリガー)
- `/store/strategyStore.ts:2409-2449` (setFinanceBS で setTimeout トリガー)
- `/store/strategyStore.ts:1984-1996` (setProfile で setTimeout トリガー)

**該当箇所:**
```typescript
// strategyStore.ts: 2355-2407
setFinancePL: (rows: FinancePLRow[]) => {
  // ... unit conversion ...
  set((s) => { ... financePL: yenRows, dirty: true ... });

  // ★ setTimeout で非同期トリガー（順序不保証）
  setTimeout(() => get().recomputeValueAnalysis('setFinancePL'), 0);
};

// 同様に setFinanceBS, setProfile など複数箇所
// ★ 総計 8+ 箇所から recomputeValueAnalysis() が呼ばれる
```

**何が危ないか:**
1. setFinancePL, setFinanceBS, setProfile, setSegmentPL, ... が全部 recomputeValueAnalysis を呼ぶ
2. 全部 setTimeout(..., 0) で登録されるため、実行順序が不保証
3. 例：
   - setProfile(financePL: [...]) 呼び出し
   - setFinanceBS(...) 呼び出し（同じマクロタスク内）
   - task queue: [recomputeValueAnalysis for setProfile, recomputeValueAnalysis for setFinanceBS]
   - 実行順序は不定 → CAGR 計算結果が異なる可能性
4. hydrating 中に recompute が呼ばれ、不完全な state で計算される
5. recomputeValueAnalysis 自体が source = 'local' か 'refetchFromServer' かで behavior が異なる

**想定される再現シナリオ:**
1. STAGE1：finance 複数パネルを一気に入力（setFinancePL, setFinanceBS, setSegmentPL を連続呼び出し）
2. 3つの setTimeout(..., 0) が登録される
3. 実行順序が A → B → C だった回と、C → B → A だった回で計算結果が異なる
4. STAGE6：valueAnalysis を基に企業価値を計算
5. 同じ input で異なる output（revenue CAGR が 8% vs 9%）
6. 再計算のたびに値が変わる（キャッシュなし）

**影響範囲:**
- STAGE1（finance 入力時）
- STAGE6（valueAnalysis 依存）
- 複数フィールド同時更新時（フォーム送信など）
- setProfile で複数 finance フィールド変更時

**修正方針の方向性:**
1. setFinancePL, setFinanceBS 直後に同期で recomputeValueAnalysis() を呼ぶ（setTimeout 削除）
2. または、1つのマクロ action（updateFinanceBundle など）に統合して 1 度だけ recompute
3. recomputeValueAnalysis にキャッシュ（signature 変わってなければ skip）を実装
4. hydrating 中の recompute を禁止（現在は source = 'local' でスキップするが、refetchFromServer でもスキップ）

---

#### 【B-3】projectTargetImpacts/projectIssueLinks の orphan 検証欠落

**Severity:** B（孤立した参照、計算失敗）

**対象ファイル:**
- `/utils/persist/restoreWithAudit.ts:205-244` (orphan cleanup: stage4Plans のみ)
- `/store/strategyStore.ts:611-634` (sanitizeProjectTargetImpacts, sanitizeProjectIssueLinks)

**何が危ないか:**
1. project を削除しても projectTargetImpacts/projectIssueLinks に孤立した projectId が残る
2. リロード時に復元されるが、孤立した items はそのまま保持される
3. STAGE6 計算時に不存在の projectId を参照してエラー
4. UI で「そんなプロジェクトはない」という impact が表示される（混乱）
5. JSON sanitize は「数値の妥当性」のみで、「参照の妥当性」を確認しない

**想定される再現シナリオ:**
1. STAGE6 で 「プロジェクトA」に対して projectTargetImpacts を設定（delta = +100M）
2. STAGE3 に戻り、「プロジェクトA」を削除
3. リロード
4. STAGE6：projectTargetImpacts は [{ projectId: "project-A", targetId: "target-1", delta: 100 }] のまま
5. 計算時に projectId = "project-A" の project が見つからず、error or skip
6. UI：「impact が計算されない」と思わせる

**影響範囲:**
- STAGE6 Phase E（projectTargetImpacts, projectIssueLinks）
- project 削除 → STAGE6 リロード シナリオ

**修正方針の方向性:**
1. restoreWithAudit で projectTargetImpacts, projectIssueLinks も orphan cleanup
2. または、project 削除時に projectTargetImpacts/projectIssueLinks も同時削除（cascade）
3. 計算時に `if (!projectExists(projectId)) skip` ロジック追加

---

#### 【B-4】restoreReady cooldown の不十分さ

**Severity:** B（STAGE3 再生成後のレース）

**対象ファイル:**
- `/store/strategyStore.ts:2910-2920` (setDepartments で post-restore cooldown check)
- `/hooks/useAutoSave.ts:366-374` (autosave側の post-restore cooldown)

**該当箇所:**
```typescript
// setDepartments で 2.1 秒待つ
if (state.restoreReady && state.lastServerSyncAt) {
  const timeSinceSync = Date.now() - state.lastServerSyncAt;
  if (timeSinceSync < 2100) {  // ★ 2.1秒
    const delayMs = Math.max(100, 2100 - timeSinceSync);
    await new Promise(r => setTimeout(r, delayMs));
  }
}

// useAutoSave でも同じく 2 秒
if (restoreReady && lastServerSyncAt) {
  const timeSinceSync = Date.now() - lastServerSyncAt;
  if (timeSinceSync < 2000) {  // ★ 2秒
    return;
  }
}
```

**何が危ないか:**
1. restore 直後に departments が save される場合、2.1秒待つ
2. しかし restore process 自体が 1-2秒かかるかもしれない
3. 実際の cooldown が「restore 完了から 2秒」ではなく「restore 開始から 2秒」かも
4. network latency で restore が遅延した場合、cooldown が足りない
5. setDepartments + useAutoSave の両方で cooldown check があり、重複処理
6. cascade 生成直後の saveStrategyData（STAGE3 AI 生成で呼ばれる）では immediate save されるため cooldown が効かない

**想定される再現シナリオ:**
1. STAGE3 load → restore process 開始 (network latency 大)
2. 500ms かかる
3. restore 完了 → lastServerSyncAt = now()
4. 同時に updateDepartments で immediate save 開始
5. 2.1秒待つが、その間に restore で新 revision が確定
6. 2.1秒待った後 save しても old revision で collision
7. conflict cooldown 開始

**影響範囲:**
- STAGE3（restore 後の immediate operations）
- 高レイテンシ環境（restore が遅い）
- 複数 operation の並行実行

**修正方針の方向性:**
1. setDepartments / updateDepartments の immediate save を廃止（useAutoSave に一本化）
2. または、restore → 3秒待つ（post-restore grace period）
3. または、restore 完了を hook して、その後に pending saves を実行

---

### **Severity C: 保守性悪化・技術債・ノイズ（3件）**

#### 【C-1】ログの過剰性：DEBUG ログが大量・本来のエラーが埋もれる

**Severity:** C（本番運用で検索困難、noise）

**対象ファイル:**
- `/store/strategyStore.ts` 全体（40+ DEBUG ログ）
- `/hooks/useAutoSave.ts` 全体（30+ DEBUG/payload mode ログ）
- `/utils/persist/restoreWithAudit.ts` 全体（15+ audit ログ）

**何が危ないか:**
1. debug statement が 150+ 行ある
2. 一度 DEBUG=1 にすると、console.log が 500+行/分 になる
3. browser DevTools のログが crash または検索困難
4. 本当のエラー（[audit][save:exception]）が埋もれる
5. production でも DEBUG env var の設定漏れで verbose ログが出続ける
6. ログが多すぎてパフォーマンス低下（JSON.stringify のコストも高い）

**修正方針の方向性:**
1. debug statement を3分類：
   - [audit] - 本当に重要（always on）
   - [diagnostic] - dev限定
   - [trace] - 一時的 / 削除予定
2. strategyStore の DEBUG ログを半減（重複排除）
3. useAutoSave の guard-check ログを1行に（複数 condition の結合）
4. CI で console.log 数をチェック（threshold 超過で fail）

---

#### 【C-2】旧構造混在：lanes vs departments の並立

**Severity:** C（保守性悪化、将来の refactoring 困難）

**対象ファイル:**
- `/app/cascade/page.tsx:133-149` (lanes 型定義)

**何が危ないか:**
1. API response format が 2種類（projects[] と lanes.existing/lanes.new）
2. page 内で互換性を保つが、type定義が複雑化
3. 将来の migrate が困難（どのformat を canonical にするか不明）
4. 削除済み機能（全社たたき台）のコメントが残置
5. laneType ('existing' | 'new') が pages に限定（store に上がらない）
6. department 構造自体に lanes がないため、store ↔ page の型missmatch

**修正方針の方向性:**
1. canonical format を決定（departments[].projects[] のみ）
2. API が lanes で返す場合、ページ側でさっさと projects[] に変換
3. store には projects[] のみ持つ（lanes は page local state）
4. 削除済み機能の comment を削除（code cleanliness）

---

#### 【C-3】type assertion過多：any を多用する

**Severity:** C（型安全性の低下、refactoring 時の誤り）

**対象ファイル:**
- `/app/cascade/page.tsx` (any が 20+ 出現)
- `/utils/supabase/normalize.ts` (any が 30+ 出現)
- `/store/strategyStore.ts` (any が多い)

**修正方針の方向性:**
1. unknown → 明示的な type guard
2. interface を extend（Record<string, any> ではなく）
3. strict TS config（noImplicitAny = true）

---

## 🗺️ データ正本マップ

### **Department**
- **正本**: `strategyStore.departments[]`
  - load: `normalizeFromDbRow → department.id || department.name`
  - save: `buildSavePayload → departments array (id 必須)`
  - **問題**: id と name が混在して参照される
- **派生**:
  - cascade/page.tsx: page local state with lanes
  - stage4Plans: departmentId 参照
- **リスク**: name 変更で参照が壊れ、id と name の混在参照

### **Project**
- **正本**: `departments[].projects[]`
  - load: `normalizeFromDbRow → projects map`
  - save: `buildSavePayload → departments[].projects[]`
- **派生**:
  - stage4Plans (departmentId ref)
  - projectTargetImpacts (projectId ref)
  - projectIssueLinks (projectId ref)
- **リスク**: project 削除時、派生 arrays の orphan 検証欠落

### **OKR (okrs)**
- **正本**: `departments[].projects[].okrs[]`
  - type: `{ objective, keyResults: string[], owner }`
  - load: `normalizeFromDbRow → okrs array`
  - save: `buildSavePayload → okrs array`
  - STAGE4/5 で使用
- **派生**: progress_logs table で okr_id 参照
- **リスク**: okrs delete 時に progress_logs が orphaned

### **OKR (okrsV2)**
- **正本**: `departments[].projects[].okrsV2[]`
  - type: `{ id, label, kind, bridgeToLever, expectedImpactYen, probability }`
  - load: `normalizeFromDbRow → okrsV2 array`
  - save: `buildSavePayload → okrsV2 sanitize（空ラベル除外）`
  - STAGE6 計算に使用
- **派生**: 無（okrs と独立）
- **リスク**: save 時に item が削除される（往復不一致）

### **Progress Log**
- **正本**: `progress_logs` table
  - type: `{ id, okr_id, projectId, departmentId, content, status, score, created_at }`
  - save: `saveProgressLog()` API（strategy_data と別）
  - load: separate fetch（restore に含まれない）
- **派生**: 無
- **リスク**: okr_id/projectId/departmentId delete 時 orphaned

### **STAGE6: ProjectTargetImpacts**
- **正本**: `projectTargetImpacts[]`
  - type: `{ projectId, targetId, delta }`
  - load: `normalizeFromDbRow → projectTargetImpacts`
  - save: `buildSavePayload → sanitize（NaN, invalid strength filter）`
- **派生**: 無
- **リスク**: project delete 時 orphaned（検証なし）

### **STAGE6: Simulation Result**
- **正本**: `simulationResult`
  - type: `{ projection, finalProb, krsSnapshot, meta }`
  - 計算: `calcYearlyFromKrs()` で okrsV2 から生成
  - 保存: `buildSavePayload`
- **派生**: 無（計算結果）
- **リスク**: okrsV2 sanitize で item 削除 → 計算結果がおかしくなる

---

## 🧪 優先確認シナリオ（10件）

### **1. Department 削除後の STAGE4 遷移**
```
操作：
1. STAGE3：Department「営業部」を作成
2. Project「新規営業システム」+ OKR「売上+30%」を追加
3. 確認：STAGE4 で OKR が表示される ✓
4. STAGE3 に戻る → 「営業部」を削除（trash icon）
5. リロード（F5）
6. STAGE4 遷移

期待：okrs が消えているはず、undefined error またはクラッシュ
実装検証：orphan cleanup が okrsV2 も clean しているか確認
```

### **2. setDepartments + useAutoSave 二重保存**
```
操作：
1. STAGE3：Department 名を変更
2. ネットワークを "slow 3G" に設定（DevTools）
3. 変更直後、他の field も編集（同一マクロタスク）
4. コンソールで [audit][save:start] ログを監視

期待：save 1 回のみ（setDepartments immediate save）
実装検証：immediate save + useAutoSave が両方走っていないか
```

### **3. stage1Issues empty → save → load**
```
操作：
1. STAGE1：stage1Issues に複数の issue を追加
2. 保存確認 → DB 反映
3. UI：全 issue を削除
4. 保存（manual save button または autosave）
5. リロード（F5）

期待：stage1Issues が復元される（empty で消えない）
実装検証：pruneUndefinedDeep で [] が削除されていないか
```

### **4. ProjectTargetImpacts orphan 検証**
```
操作：
1. STAGE6：Project A に projectTargetImpact 設定（delta=100M）
2. STAGE3 → Project A を削除
3. リロード（F5）
4. STAGE6 遷移 → impact 計算

期待：Project A の impact が消えている（orphan cleanup）
実装検証：restoreWithAudit で projectTargetImpacts も orphan clean がされているか
```

### **5. recomputeValueAnalysis 多重実行**
```
操作：
1. STAGE1：Finance 複数 panel を素早く連続修正
   - setFinancePL(rows)
   - setFinanceBS(rows)
   - setSegmentPL(data)
   (3x setTimeout)
2. console で recompute が何回呼ばれるか count
3. 計算結果（e.g., revenueCagrPct）を記録
4. 同じ input で再実行 → 異なる結果?

期待：1回のみ call (または idempotent result)
実装検証：setTimeout なく sync call で変更したか
```

### **6. restore 直後の immediate save 競合**
```
操作：
1. STAGE3 load → restore process 観察
2. console: [audit][restore:done] ← restore 完了
3. 同時に updateDepartments call
4. console: [audit][save:start] ← save 開始（cooldown wait）
5. revision 競合 監視

期待：conflict cooldown により save が遅延される
実装検証：setDepartments で 2.1 秒 wait が動作しているか
```

### **7. Cascade AI 生成でのマージ**
```
操作：
1. STAGE3：「営業プロセス改革」を手入力で作成（hypothesis="..."）
2. AI で cascade 生成（API call）
3. API が existing lane: [「営業プロセス改革」], new lane: [「営業プロセス最適化」] を返す
4. マージ結果を確認
5. ユーザー hypothesis が preserve されているか

期待：ユーザー手入力が消えない（new lane で上書きされない）
実装検証：cascade merge ロジックでユーザーデータ優先か
```

### **8. 複数 department deletion + STAGE4 リロード**
```
操作：
1. STAGE3：Department A, B, C を作成
2. 各 department に Project + OKR 追加
3. STAGE4 → 全 3 部門の OKR 確認 ✓
4. STAGE3 → A, B を削除（C は残す）
5. リロード（F5）
6. STAGE4 遷移 → OKR 一覧確認

期待：C の OKR のみ表示（A, B は orphaned 削除）
実装検証：orphan cleanup で複数 department delete を処理しているか
```

### **9. okrsV2 empty label sanitize**
```
操作：
1. STAGE4：okrsV2 に KR 5個を追加
2. 1 個は label=""のまま
3. save（OK）
4. リロード（F5）
5. okrsV2 count を確認

期待：4個（empty 削除）
実装検証：save 時 sanitize が動作しているか、item 数が変わることを UI 通知しているか
```

### **10. Multiple user cascade generation race**
```
操作：
1. User A, User B が同じ company / department にアクセス
2. User A が STAGE3 で cascade AI 生成 call (長い)
3. User B が同じ department を編集 → save
4. User A の cascade 生成が返ってくる → merge + save
5. 最終 state 確認

期待：どちらかのデータが intact（race-free merge）
実装検証：最後の save の revision が correct か
```

---

## 📅 修正順番の提案

修正時は以下の順番を推奨します（dependency 順）：

### **Phase 1: Foundation（正本統一・保存経路固定）**
1. **normalize.ts + buildPayload の正規化統一**
   - save/load で同じスキーマを使用
   - undefined → default value の補填を明確化
   - 往復テスト（save → load → save で不変）を CI に追加
   - **Priority**: A → 他の修正が効かない土台

2. **Department ID の正本化**
   - `d.id` のみに統一（name は参照に使わない）
   - orphan cleanup で validDeptIds = Set(d.id のみ)
   - **Priority**: A → projectTargetImpacts, projectIssueLinks の修正に必要

### **Phase 2: 削除安全性（orphan cleanup 完全化）**
3. **restoreWithAudit のorphan cleanup 拡張**
   - projectTargetImpacts, projectIssueLinks の orphan clean を追加
   - okrs/okrsV2 の parent dept 参照チェック（warnings）
   - **Priority**: A → 削除復活を防ぐ

4. **progress_logs の orphan handling**
   - progress_logs load 時に okr_id/projectId/departmentId validate
   - orphaned logs を warning でログ出力
   - **Priority**: B → STAGE5 安定化

### **Phase 3: 保存・同期の整理（二重化排除）**
5. **setDepartments / updateDepartments の immediate save 削除**
   - useAutoSave に一本化
   - post-restore cooldown を useAutoSave 側で strictly enforce
   - **Priority**: A → 競合エラーを大幅削減

6. **recomputeValueAnalysis の多重トリガー整理**
   - setTimeout を削除（sync call or 1つの macro action に統合）
   - source 別の logic を simplify
   - キャッシュ層を追加
   - **Priority**: B → STAGE6 計算の再現性

### **Phase 4: 検証強化（orphan detect + warn）**
7. **buildPayload + sanitize の厳格化**
   - projectTargetImpacts/projectIssueLinks の delta=0 filter → UI warning
   - okrsV2 empty label → UI warning（削除予定を通知）
   - **Priority**: C → ユーザー体験向上

8. **restore decision log の充実**
   - orphan count, lost items を audit log に記録
   - version mismatch warning
   - **Priority**: C → troubleshooting 用

### **Phase 5: 技術債削減（ログ整理、型安全化）**
9. **ログ整理**
   - DEBUG ログを 50% 削減（重複排除）
   - [audit] と [diagnostic] を分離
   - CI で console.log threshold check 追加
   - **Priority**: C → 本番運用 streamline

10. **Type safety 改善**
    - any を最小化
    - unknown + type guard で置換
    - strict TS config 導入
    - **Priority**: C → 将来 refactoring 容易化

---

## 📝 危険地図（一覧図）

```
┌─────────────────────────────────────────────────────────┐
│ GROWTH 高リスク領域 - 危険地図                          │
├─────────────────────────────────────────────────────────┤
│                                                          │
│ ★★★ CRITICAL (Severity A):                            │
│  A-1) Department delete → okrsV2 orphan                │
│  A-2) setDepartments + useAutoSave 二重保存           │
│  A-3) save/load 正規化の非対称性                      │
│  A-4) buildPayload vs normalize.ts の齟齬             │
│  A-5) STAGE3 AI生成の予期しないマージ                │
│                                                          │
│ ★★ HIGH (Severity B):                                 │
│  B-1) departmentId vs dept.name キー混在              │
│  B-2) recomputeValueAnalysis 多重トリガー            │
│  B-3) projectTargetImpacts orphan 検証欠落            │
│  B-4) post-restore cooldown 不十分                    │
│                                                          │
│ ★ MEDIUM (Severity C):                                │
│  C-1) ログの過剰性・混在                               │
│  C-2) lanes vs departments 旧構造混在                │
│  C-3) any 多用による型安全性低下                     │
│                                                          │
│ 最高リスク: A-1（削除復活） + A-2（二重保存）の組合  │
│ 最高優先: Phase 1（正規化統一）                       │
│                                                          │
└─────────────────────────────────────────────────────────┘
```

---

## 📌 最終まとめ

GROWTH は**多機能で複雑な設計**を持つプラットフォームですが、以下の3つの領域で**高リスク**が集中しています：

1. **削除安全性**：department 削除後の okrs/okrsV2 孤立
2. **保存同期**：二重保存による競合、post-restore レース
3. **正規化**：save/load で型が異なり、往復不一致

特に「STAGE3 部門削除 → STAGE4 遷移」「STAGE6 計算異常」などのシナリオで**高い再現性**で不具合が発生する可能性があります。

修正は **Phase 1（正規化統一） → Phase 2（orphan cleanup）→ Phase 3（二重化排除）** の順で進めると、依存関係を最小化しながら**最大のリスク削減**が期待できます。

---

**監査完了日**: 2026-03-24
**次ステップ**: 実機テストで再現シナリオ 10 件を検証
