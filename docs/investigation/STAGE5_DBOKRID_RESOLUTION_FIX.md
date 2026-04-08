# STAGE5 dbOkrId undefined 緊急構造修正

**実施日時:** 2026-04-06
**対象ファイル:** app/execution/page.tsx, services/okrService.ts

---

## 問題概要

STAGE5 で `dbOkrId is undefined` が再発している。
- proj-x45591: 修正済み
- proj-8oro7q: 未確認
- proj-vrmnn8: 未確認

既に修正した層：
- ✅ okrsRepository.upsert(): business key で新規重複防止
- ✅ mergeOkrSources(): business key で既存重複を1件に収束
- ✅ invalidateAndRefetchProjectOkrs(): snapshot を排除

それでも再発する原因：
- STAGE5 が保存対象 OKR を一意に解決できていない
- selected / resolvedProgressOkrId / dbOkrMap / proj.okrs の参照元が分裂している

---

## 修正戦略

### 層1: DB-backed OKR 解決関数（共通）

**関数名:** `resolveDbBackedOkrForSelection()`
**責務:** business key で DB OKR を一意に解決
**入力:**
- companyId
- strategyId
- departmentId
- projectId
- objective (正規化済み)

**処理:**
1. business key を構築：`company_id::strategy_id::department_id::project_id::objective`
2. resolvedOkrsMap（既にキャッシュされている）から検索
3. なければ proj.okrs から source='db' を検索
4. 複数ヒット時の勝者判定：
   - is_deleted=false 優先
   - source='db' 優先
   - updated_at 最新優先

**戻り値:**
```typescript
{
  okrId: string | null,
  source: 'db' | 'snapshot' | 'unresolved',
  objective: string,
}
```

### 層2: モーダル state の拡張

**新しい state 追加:**
```typescript
const [resolvedDbOkrId, setResolvedDbOkrId] = useState<string | null>(null);
const [resolvedDbOkrSource, setResolvedDbOkrSource] = useState<'db' | 'snapshot' | 'unresolved' | null>(null);
const [resolvedDbOkrObjective, setResolvedDbOkrObjective] = useState<string>('');
```

**セット処理（モーダル open 時）:**
```typescript
useEffect(() => {
  if (!selected) {
    setResolvedDbOkrId(null);
    setResolvedDbOkrSource(null);
    setResolvedDbOkrObjective('');
    return;
  }

  // モーダル open 時点で DB OKR を一意に解決
  const resolved = resolveDbBackedOkrForSelection({
    companyId,
    strategyId,
    departmentId: selected.departmentId,
    projectId: selected.projectId,
    objective: selected.objectiveNormalized,
  });

  setResolvedDbOkrId(resolved.okrId);
  setResolvedDbOkrSource(resolved.source);
  setResolvedDbOkrObjective(resolved.objective);

  if (resolved.source === 'unresolved') {
    console.warn('[STAGE5-resolve-db-okr] unresolved', {
      businessKey: `${companyId}::${strategyId}::${selected.departmentId}::${selected.projectId}::${selected.objectiveNormalized}`,
      hit: 'miss',
    });
  } else {
    console.debug('[STAGE5-resolve-db-okr] resolved', {
      businessKey: `${companyId}::${strategyId}::${selected.departmentId}::${selected.projectId}::${selected.objectiveNormalized}`,
      hit: 'success',
      chosenId: resolved.okrId,
      source: resolved.source,
    });
  }
}, [selected, companyId, strategyId, ...dependencies]);
```

### 層3: 保存時の唯一の正本化

**修正前:**
```typescript
// onSaveCheckin() 内で複数経路で dbOkrId を計算
let targetOkrId = dbOkrId;  // pyramid から取得
if (!targetOkrId) {
  targetOkrId = resolveDbOkrId(...)  // 別の計算
}
```

**修正後:**
```typescript
// onSaveCheckin() 内
const saveTargetOkrId = resolvedDbOkrId;  // モーダル state の唯一の正本

if (!saveTargetOkrId) {
  // フォールバック promotion を試行
  const fallbackResult = await ensureMainOkrIsDbBacked(...);
  if (fallbackResult) {
    saveTargetOkrId = fallbackResult.id;
    console.warn('[STAGE5-promotion-fallback] success', {
      promotedId: fallbackResult.id,
      objective: resolvedDbOkrObjective,
    });
  } else {
    console.error('[STAGE5-save-checkin-blocked] unresolved and fallback failed', {
      businessKey: ...,
      reason: 'no_db_okr_available',
    });
    alert('このOKRを保存できません。STAGE4 で確認してから再度お試しください。');
    return;
  }
}

// 保存実行
const checkinId = await saveCheckinToDb({
  okrId: saveTargetOkrId,  // ← これが唯一の正本
  ...
});
```

### 層4: 表示用と保存用の統一

**対象:** pyramid, mobileCards, modal open selection

**修正方針:**
```typescript
// 修正前
const displayOkr = snapshot.okrs[0];  // source不問
const saveOkr = dbOkrMap.get(...);    // DB のみ

// 修正後
const displayOkr = resolveDbBackedOkr() || snapshot.okrs[0];  // DB 優先、fallback は snapshot
const saveOkr = resolveDbBackedOkr();  // DB のみ（なければ unresolved）
```

---

## 実装手順

### Step 1: 共通関数の作成

**ファイル:** services/okrService.ts

```typescript
/**
 * STAGE5 用：DB-backed OKR を business key で一意に解決
 * @param companyId
 * @param strategyId
 * @param departmentId
 * @param projectId
 * @param objective 正規化済み
 * @returns { okrId, source, objective }
 */
export function resolveDbBackedOkrForSelection(params: {
  companyId: string;
  strategyId: string;
  departmentId: string;
  projectId: string;
  objective: string;
  resolvedOkrsMap?: Map<string, ResolvedOkr[]>;
  fallbackOkrs?: OKR[];
}): {
  okrId: string | null;
  source: 'db' | 'snapshot' | 'unresolved';
  objective: string;
} {
  const { companyId, strategyId, departmentId, projectId, objective, resolvedOkrsMap, fallbackOkrs } = params;

  const businessKey = `${companyId}::${strategyId}::${departmentId}::${projectId}::${objective}`;

  // Step 1: resolvedOkrsMap から DB OKR を検索（mergeOkrSources で既に1件に絞られている）
  const cacheKey = `${companyId}::${strategyId}::${departmentId}::${projectId}`;
  const cachedOkrs = resolvedOkrsMap?.get(cacheKey) ?? [];
  const dbOkr = cachedOkrs.find(
    (o) => o.source === 'db' && normalizeObjectiveKey(o.objective) === objective
  );

  if (dbOkr) {
    return {
      okrId: dbOkr.id,
      source: 'db',
      objective: dbOkr.objective,
    };
  }

  // Step 2: fallback OKRs から source='db' を検索
  const fallbackDbOkr = (fallbackOkrs ?? []).find(
    (o) => o.source === 'db' && normalizeObjectiveKey(o.objective) === objective
  );

  if (fallbackDbOkr) {
    return {
      okrId: fallbackDbOkr.id,
      source: 'db',
      objective: fallbackDbOkr.objective,
    };
  }

  // Step 3: DB OKR がなければ unresolved
  return {
    okrId: null,
    source: 'unresolved',
    objective,
  };
}
```

### Step 2: モーダル state の拡張

**ファイル:** app/execution/page.tsx

```typescript
// モーダル component 内（Modal props で受け取る）
interface ExecutionDetailModalProps {
  selected: {
    departmentId: string;
    projectId: string;
    okrId: string;
    progressOkrId: string;
    resolvedProgressOkrId: string;
    objectiveNormalized: string;  // 新規追加
  } | null;
  resolvedOkrsMap: Map<string, ResolvedOkr[]>;
  // ...
}

export function ExecutionDetailModal(props: ExecutionDetailModalProps) {
  const [resolvedDbOkrId, setResolvedDbOkrId] = useState<string | null>(null);
  const [resolvedDbOkrSource, setResolvedDbOkrSource] = useState<'db' | 'snapshot' | 'unresolved' | null>(null);
  const [resolvedDbOkrObjective, setResolvedDbOkrObjective] = useState<string>('');

  // モーダル open 時点で DB OKR を解決
  useEffect(() => {
    if (!props.selected) {
      setResolvedDbOkrId(null);
      setResolvedDbOkrSource(null);
      setResolvedDbOkrObjective('');
      return;
    }

    const resolved = resolveDbBackedOkrForSelection({
      companyId: props.companyId,
      strategyId: props.strategyId,
      departmentId: props.selected.departmentId,
      projectId: props.selected.projectId,
      objective: props.selected.objectiveNormalized,
      resolvedOkrsMap: props.resolvedOkrsMap,
      fallbackOkrs: props.displayOkrs,
    });

    setResolvedDbOkrId(resolved.okrId);
    setResolvedDbOkrSource(resolved.source);
    setResolvedDbOkrObjective(resolved.objective);

    console.debug('[STAGE5-resolve-db-okr]', {
      businessKey: `${props.companyId}::${props.strategyId}::${props.selected.departmentId}::${props.selected.projectId}::${props.selected.objectiveNormalized}`,
      hit: resolved.okrId ? 'success' : 'miss',
      chosenId: resolved.okrId,
      source: resolved.source,
    });
  }, [props.selected, props.companyId, props.strategyId, props.resolvedOkrsMap, props.displayOkrs]);

  // onSaveCheckin 内
  const handleSaveCheckinWithDbOkr = async () => {
    let targetOkrId = resolvedDbOkrId;

    // フォールバック promotion
    if (!targetOkrId && resolvedDbOkrSource === 'unresolved') {
      console.warn('[STAGE5-promotion-fallback] attempting', {
        objective: resolvedDbOkrObjective,
        projectId: props.selected?.projectId,
      });

      // ensureMainOkrIsDbBacked を実行
      const fallbackResult = await ensureMainOkrIsDbBacked(
        props.selected?.departmentIdx ?? 0,
        props.selected?.projectIdx ?? 0
      );

      if (fallbackResult) {
        targetOkrId = fallbackResult.id;
        console.warn('[STAGE5-promotion-fallback] success', {
          promotedId: fallbackResult.id,
          objective: resolvedDbOkrObjective,
        });
      } else {
        console.error('[STAGE5-save-checkin-blocked]', {
          reason: 'promotion_failed',
          objective: resolvedDbOkrObjective,
        });
        alert('OKRの準備に失敗しました。STAGE4 で確認してから再度お試しください。');
        return;
      }
    }

    if (!targetOkrId) {
      console.error('[STAGE5-save-checkin-blocked]', {
        reason: 'no_valid_okr',
        source: resolvedDbOkrSource,
      });
      alert('このOKRを保存できません。');
      return;
    }

    // 保存実行（targetOkrId を使用）
    await saveCheckinToDb({
      okrId: targetOkrId,
      ...
    });
  };
}
```

### Step 3: ログの整理

**削除対象:**
- [addProjectOKR-TARGET]
- [ensureMainOkrIsDbBacked-TARGET]
- [updateProjectOKRDb-TARGET]
- ROOT-CAUSE 調査ログ

**追加ログ:**
- [STAGE5-resolve-db-okr]: business key, hit/miss, chosen id, source
- [STAGE5-save-checkin-blocked]: reason（no_valid_okr, promotion_failed, unresolved）
- [STAGE5-promotion-fallback]: success/failure

---

## 検証ポイント

### テスト1: proj-x45591

```
1. STAGE4 で OKR を作成/修正
2. STAGE5 を開く
   → [STAGE5-resolve-db-okr] success, chosenId: uuid-1, source: db
3. モーダル を開く
   → console に resolvedDbOkrId が null でない
4. コメント入力 → 保存
   → [STAGE5-save-checkin-blocked] が出ない
   → ✅ 記録しました
```

### テスト2: proj-8oro7q

```
同様の手順でテスト
期待値：同じく成功
```

### テスト3: proj-vrmnn8

```
同様の手順でテスト
期待値：同じく成功
```

---

## 禁止事項

- selected.okrId をそのまま保存対象に使わない
- snapshot source の OKR を保存対象にしない
- 保存時に複数経路で dbOkrId を計算しない
- 表示用で snapshot、保存用で DB という分裂を残さない

---

## 実装の流れ

1. ✅ resolveDbBackedOkrForSelection() を services/okrService.ts に作成
2. ✅ ExecutionDetailModal の state 拡張（resolvedDbOkrId）
3. ✅ モーダル open useEffect で解決関数を実行
4. ✅ onSaveCheckin で resolvedDbOkrId を唯一の正本として使う
5. ✅ フォールバック promotion を追加
6. ✅ 個別プロジェクトの TARGET ログを削除
7. ✅ 3 project でテスト

