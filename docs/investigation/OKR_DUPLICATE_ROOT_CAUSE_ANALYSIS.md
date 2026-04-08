# OKR 重複発生と snapshot 残留の根本原因分析

**作成日時:** 2026-04-06
**問題状況:** 同一 project_id + objective の DB OKR が重複作成され、さらに snapshot が残留

---

## 第一部: DB 重複発生の根本原因

### 現象
REFETCH RESULT の diagnostic log で:
```json
{
  "count": 2,
  "resolvedOkrs": [
    { "id": "56082b61-1dba-4e8c-a6fc-d9d5fa6bef1b", "objective": "半導体企業向けデータ分析サービスの強化", "project_id": "proj-x45591", "source": "db" },
    { "id": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx", "objective": "半導体企業向けデータ分析サービスの強化", "project_id": "proj-x45591", "source": "db" }
  ]
}
```
同じ objective なのに異なる id を持つ DB OKR が2件

### 原因の仮説

**okrsRepository.upsert() の衝突判定不十分**

現在の実装 (line 138-142):
```typescript
const { data, error } = await supabase
  .from(TABLE_NAME)
  .upsert(insertData, {
    onConflict: 'id',  // ← id のみで衝突判定
  })
  .select()
  .single();
```

**問題:**
- `onConflict: 'id'` は「既存 id と衝突したら UPDATE」という意味
- しかし `ensureMainOkrIsDbBacked()` では **id を指定していない** (line 117)
  ```typescript
  const okrId = input.id || crypto.randomUUID?.() || `okr_${Date.now()}`;
  ```
- つまり毎回新しい id が生成される → 衝突判定されない → 毎回 INSERT
- 結果：同じ project_id + objective でも複数行が作成される

### DB 側の UNIQUE 制約

**確認必須:**
1. okrs テーブルに `company_id + strategy_id + department_id + project_id + objective` の UNIQUE 制約があるか
2. あればなぜ重複が入ったのか（制約が機能していない、または後で追加された）
3. なければ Supabase 側で UNIQUE 制約を追加する必要がある

**Supabase upsert() の onConflict パラメータ:**
```typescript
.upsert(data, {
  onConflict: 'column1,column2,column3'  // 複数列指定可能
})
```

---

## 第二部: snapshot 残留の原因

### mergeOkrSources() の実装 (services/okrService.ts:344-404)

**現状:**
```typescript
export function mergeOkrSources(dbOkrs: OkrRow[], snapshotOkrs: OKR[]): OkrMergeResult {
  // DB OKR を resolved に追加
  const resolved: ResolvedOkr[] = dbOkrs
    .filter((o) => !o.is_deleted)
    .map((o) => ({ ...o, source: 'db' as const }));

  // snapshot のみの OKR を追加（fallback）
  snapshotOkrs.forEach((snap) => {
    if (snap.id && dbMap.has(snap.id)) {
      return;  // DB に同じ id がある → スキップ
    }
    // ★ snapshot からのみの OKR を追加
    const fallbackOkr: ResolvedOkr = { ...snap, source: 'snapshot' as const };
    resolved.push(fallbackOkr);
  });

  return { resolved, ... };
}
```

**問題:**
- snapshot 側で同じ objective があっても、**id が異なれば**両方返す
- DB OKR2件 (id 異なる) + snapshot OKR1件 = 計3件で返される可能性
- `mergeOkrSources()` は ID ベースの重複排除のみ行う（objective ベースではない）

### invalidateAndRefetchProjectOkrs() の実装 (app/okr/page.tsx:970-1002)

**現状:**
```typescript
const snapshotOkrs: OKR[] = resolved.resolvedOkrs
  .filter((ok) => ok?.source === 'db')  // ★ DB source のみ
  .map((resolvedOkr, idx) => ({ ... }));
```

**一見良く見えるが:**
- `resolved.resolvedOkrs` に複数の DB OKR がある場合、**全て snapshot に変換される**
- 本来は1件に絞るべき
- 例：DB OKR 2件 → 両方とも snapshot に変換 → snapshot に2件登録される

---

## 第三部: 修正が必要な層

### 層1: okrsRepository.upsert()
**修正内容:**
```typescript
// 現在：
onConflict: 'id'

// 修正後：
const onConflictColumns = input.id
  ? ['id']
  : ['company_id', 'strategy_id', 'department_id', 'project_id', 'objective'];
onConflict: onConflictColumns.join(',')
```

**効果:**
- id がない場合は company_id + strategy_id + department_id + project_id + objective で衝突判定
- 同じ project_id + objective なら UPDATE（新規 INSERT ではなく）
- 新規重複の発生を防ぐ

**前提:**
- DB 側に `UNIQUE(company_id, strategy_id, department_id, project_id, objective)` 制約が必須
- なければ Supabase SQL エディタで追加する必要がある

### 層2: mergeOkrSources()
**修正内容:**
- DB OKR が複数ある場合のみ対応（グループ化して最初の1件のみ返す）
- または objective ベースの重複排除を追加

### 層3: invalidateAndRefetchProjectOkrs()
**修正内容:**
- 複数 DB OKR がある場合に警告
- 最初の1件のみを snapshot に変換する（もしくは全て DB として保持）

---

## 第四部: 既存重複データの扱い

### オプション A: そのまま残す
- 新規作成だけ止める
- 既存重複は放置
- 問題：STAGE5 で複数 OKR が参照される可能性

### オプション B: Migration で整理
- `company_id + strategy_id + department_id + project_id + objective` でグループ化
- 最初のものだけを残す
- 他は `is_deleted = true` にする
- 利点：一度きりの整理、以降は重複なし

### オプション C: クリーンアップ API を作成
- 管理者向けエンドポイント
- 重複を検出してクリーンアップ

**推奨: オプション B (Migration) ないしは C (API)**

---

## 第五部: 必須確認項目

### ✅ 確認1: DB 側の UNIQUE 制約
```sql
-- Supabase SQL エディタで実行
SELECT constraint_type, constraint_name, table_name
FROM information_schema.table_constraints
WHERE table_name = 'okrs' AND constraint_type = 'UNIQUE';
```

**期待値:**
- `(company_id, strategy_id, department_id, project_id, objective)` の UNIQUE 制約が存在すること

### ✅ 確認2: 既存重複データ
```sql
SELECT
  company_id, strategy_id, department_id, project_id, objective,
  COUNT(*) as count
FROM okrs
WHERE is_deleted = false
GROUP BY company_id, strategy_id, department_id, project_id, objective
HAVING COUNT(*) > 1;
```

**期待値:**
- 重複が何件あるか把握
- 対象プロジェクトの重複も確認

### ✅ 確認3: mergeOkrSources の出力
- DB OKR 複数の場合、全て返すのか、1件のみ返すのか
- snapshot との重複排除ロジック

### ✅ 確認4: invalidateAndRefetchProjectOkrs の処理
- 複数 DB OKR を全て snapshot に変換しているのか
- 最初の1件のみに絞るべきではないか

---

## 第六部: 修正手順（案）

1. **SQL で既存重複を確認**
   ```sql
   SELECT ... HAVING COUNT(*) > 1;
   ```

2. **okrsRepository.upsert() を修正**
   - onConflict に複数列指定
   - DB 側に UNIQUE 制約確認・追加

3. **mergeOkrSources() を修正**
   - objective ベースの重複排除ロジックを追加
   - または DB OKR 複数の場合に警告

4. **invalidateAndRefetchProjectOkrs() を修正**
   - 複数 DB OKR を1件に絞る
   - snapshot 変換時に複数を含めない

5. **diagnostic log で検証**
   ```json
   {
     "count": 1,
     "resolvedOkrs": [
       { "id": "...", "objective": "半導体...", "source": "db" }
     ]
   }
   ```

6. **既存重複をクリーンアップ**
   - Migration または API で is_deleted = true

7. **STAGE5 で保存成功確認**

---

## まとめ

| 層 | 問題 | 原因 | 修正内容 |
|---|---|---|---|
| okrsRepository | 毎回新しい id で INSERT | onConflict: 'id' のみ | 複数列衝突判定 + DB UNIQUE 制約 |
| mergeOkrSources | snapshot が残留 | ID ベースのみ重複排除 | objective ベース重複排除 |
| invalidateAndRefetchProjectOkrs | 複数 DB OKR を全て snapshot に | フィルタ不足 | 1件に絞る処理追加 |

