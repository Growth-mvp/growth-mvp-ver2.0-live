# handleDeptCascadeDraft デバッグガイド

## 概要

`handleDeptCascadeDraft` で AI 生成結果が正しく処理されていることを確認するための DEBUG ログが追加されました。

## DEBUG ログの有効化

`.env.local` で以下が設定されていることを確認：

```
NEXT_PUBLIC_DEBUG_HYDRATE=1
```

この環境変数が `1` の場合、以下の詳細なデバッグログが出力されます。

---

## DEBUG ログの流れ

### ステップ 1: API レスポンス形式の確認

```
[Cascade] rd.keys: [name, missionDraft, lanes, ...]
[Cascade] rd.projects?.[0].keys: undefined
[Cascade] rd.okrs: undefined
[Cascade] rd.kpis: undefined

[Cascade] rd.lanes.existing.projects: 5個
  [0] title="顧客管理システムの構築", keys=title, hypothesis, mainLever, horizon, kind, okrs, ...
    okrs=✓, okr=✗, kpis=✗, kpi=✗, metrics=✗, objective=✓, keyResults=✓
    okrs[0]={"objective":"売上5倍増","keyResults":["KR1","KR2"]}
    objective="売上5倍増"
  [1] ...

[Cascade] rd.lanes.new.projects: 3個
  [0] title="新規市場開拓", keys=title, hypothesis, mainLever, ...
    ...
```

**確認ポイント**:
- ✓ `rd.lanes.existing.projects` または `rd.lanes.new.projects` が存在するか
- ✓ 各 project に `okrs`, `kpis`, `objective`, `keyResults` のいずれかが含まれているか
- ✓ 期待値: 複数のプロジェクトが返却されていることを確認

**エラーパターン**:
- ❌ `undefined` が続く場合、API レスポンスが期待形式ではない可能性
- ❌ `projects.length = 0` の場合、API が projects を返していない

---

### ステップ 2: applyLaneToProjects での処理

```
[Cascade] applyDeptDraftToProjects: lanes.existing projects 5個を処理
[Cascade] normalizeProjectDraft 成功: title="顧客管理システムの構築", okrs=2個
[Cascade] normalizeProjectDraft 成功: title="営業効率化ツール", okrs=1個
[Cascade] normalizeProjectDraft 失敗: title="" (空タイトルは無視)
...
[Cascade] applyDeptDraftToProjects: lanes.new projects 3個を処理
[Cascade] normalizeProjectDraft 成功: title="AI による予測分析", okrs=3個
...
```

**確認ポイント**:
- ✓ `normalizeProjectDraft 成功` が複数出ているか
- ✓ 各プロジェクトで `okrs=N個` が出力されているか（N > 0）
- ⚠️ `normalizeProjectDraft 失敗` は無視してOK（空タイトルなど）

**エラーパターン**:
- ❌ `normalizeProjectDraft 成功` が1個も出ない場合、API レスポンス形式が対応していない可能性
- ❌ `okrs=0個` ばかりの場合、OKR 変換ロジックが機能していない

---

### ステップ 3: 最終的な mergedProjects の確認

```
[Cascade] applyDeptDraftToProjects 完了: 最終プロジェクト数=8
  [0] "顧客管理システムの構築", okrs=2個
  [1] "営業効率化ツール", okrs=1個
  [2] "AI による予測分析", okrs=3個
  ...
[Cascade] patch.projects 設定: 8個
  [0] "顧客管理システムの構築", okrs=2個
  [1] "営業効率化ツール", okrs=1個
  [2] "AI による予測分析", okrs=3個
  ...
[Cascade] patch.lanes 設定
[Cascade] dept 更新: keys=mission, strategy, missionDraft, projects, lanes
```

**確認ポイント**:
- ✓ `最終プロジェクト数` が 0 ではなく、1 以上であること
- ✓ 各プロジェクトで `okrs=N個（N > 0）` が確認できること
- ✓ `patch.projects 設定` と `patch.lanes 設定` の両方が出力されていること
- ✓ `dept 更新: keys=...` に `projects`, `lanes` が含まれていること

**エラーパターン**:
- ❌ `最終プロジェクト数=0` の場合、projects が store に入っていない
- ❌ `patch.projects 設定` が出力されていない場合、projects 更新が走らない
- ❌ `okrs=0個` ばかりの場合、OKR 情報が抽出されていない

---

## OKR 取り込みの優先順位

`normalizeProjectDraft` では以下の優先順で OKR を抽出：

1. **okrs** (array) ← 最優先
2. **okr** (single object)
3. **kpis** (array)
4. **kpi** (single object)
5. **metrics** (array)
6. **goals** (array)
7. **outcomes** (array)
8. **keyResults** (array only)
9. **objective + keyResults** (both direct)

### 各パターンの詳細

#### パターン 1: okrs / okr（標準形式）
```typescript
// API レスポンス
{
  okrs: [
    { objective: "売上5倍", keyResults: ["KR1", "KR2"] },
    ...
  ]
}

// ログ出力
okrs[0]={"objective":"売上5倍","keyResults":["KR1","KR2"]}
```

#### パターン 2: kpis / kpi（KPI専用形式）
```typescript
// API レスポンス
{
  kpis: [
    { label: "売上成長", metrics: ["月次ARR成長", "新規顧客数"] },
    ...
  ]
}

// 変換
objective = k.objective || k.label || k.title || k.name
keyResults = k.keyResults || k.metrics || k.measures || k.values

// ログ出力
kpis[0]={"objective":"売上成長","keyResults":["月次ARR成長","新規顧客数"]}
```

#### パターン 3: metrics / goals / outcomes（その他パターン）
```typescript
// API レスポンス（metrics パターン）
{
  metrics: [
    { title: "ユーザー数", values: [1000, 2000, 3000] },
    ...
  ]
}

// 変換
objective = m.objective || m.label || m.title || m.name
keyResults = m.keyResults || m.values || m.measures

// ログ出力
metrics[0]={"objective":"ユーザー数","keyResults":[1000, 2000, 3000]}
```

---

## 実際のデバッグ手順

### 1. ブラウザの DevTools を開く
```
F12 → Console タブ
```

### 2. Cascade ページで「AIでこの部門のたたき台」ボタンをクリック

### 3. Console に [Cascade] で始まるログを探す

```
[Cascade] 部門マッチ成功："営業部"
[Cascade] rd.keys: [name, missionDraft, lanes, ...]
[Cascade] rd.lanes.existing.projects: 5個
  [0] title="顧客管理システムの構築", keys=...
    okrs=✓
[Cascade] applyDeptDraftToProjects: lanes.existing projects 5個を処理
[Cascade] normalizeProjectDraft 成功: title="顧客管理システムの構築", okrs=2個
...
[Cascade] applyDeptDraftToProjects 完了: 最終プロジェクト数=5
[Cascade] patch.projects 設定: 5個
```

### 4. 画面上で確認

ページを更新（F5）して、以下が表示されることを確認：
- ✓ プロジェクト一覧にタイトルが表示されている
- ✓ 各プロジェクトに「目標（Objective）」「指標（KeyResults）」が表示されている
- ✓ OKR 数が 1 個以上ある

---

## よくある問題と対処法

### 問題 1: lanes が undefined / projects が空

```
[Cascade] rd.lanes.existing.projects: 0個
[Cascade] rd.lanes.new.projects: 0個
```

**原因**: API が lane 構造で projects を返していない可能性

**対処法**:
1. API エンドポイント `/api/generate-cascade` の仕様を確認
2. レスポンス形式が `{ lanes: { existing: { projects: [...] } } }` であることを確認
3. または、`{ projects: [...] }` 形式の場合、コード側で対応する

---

### 問題 2: okrs が 0 個ばかり

```
[Cascade] normalizeProjectDraft 成功: title="顧客管理", okrs=0個
```

**原因**: API レスポンスで OKR フィールドが異なる名前で返されている

**対処法**:
1. Console に出力された `keys=` を確認
2. 例: `keys=title, hypothesis, kpis, ...` の場合、`okrs` ではなく `kpis` で返っている
3. `normalizeProjectDraft` の優先順位を確認し、該当パターンが実装されているか確認
4. 必要に応じて、新しいパターンを追加

---

### 問題 3: patch.projects が設定されていない

```
[Cascade] patch.projects 設定: 0個
```

**原因**: `mergedProjects` が空、または既存 projects と同じと判定された

**対処法**:
1. `applyDeptDraftToProjects 完了` のログで `最終プロジェクト数` を確認
2. 0 の場合、lane から projects が抽出されていない
3. 既存プロジェクトがある場合、`jsonEq(mergedProjects, existingProjects)` で比較されているため、内容が同じだと patch に入らない

---

### 問題 4: 画面に OKR が表示されない

```
[Cascade] normalizeProjectDraft 成功: title="顧客管理", okrs=2個
...
[Cascade] patch.projects 設定: 5個
  [0] "顧客管理", okrs=2個
```

ログは OK だが、画面に表示されない場合：

**原因**: store → view の反映タイミング

**対処法**:
1. ページをリロード（F5）して確認
2. 編集モードを開いて、プロジェクト詳細を確認
3. DevTools → React DevTools（拡張機能）で dept state を確認

---

## DEBUG ログの検索

Console で特定のログだけを見たい場合：

```javascript
// すべての [Cascade] ログをフィルター
console.clear();

// 手動フィルター（DevTools の Filter 入力欄に入力）
[Cascade]

// または、特定のステップだけ見たい場合
normalizeProjectDraft 成功
applyDeptDraftToProjects 完了
patch.projects 設定
```

---

## ログレベル別まとめ

| ログレベル | 内容 | 例 |
| --- | --- | --- |
| **基本情報** | 部門マッチ、レスポンス型 | `部門マッチ成功:"営業部"` |
| **lanes 詳細** | 各 lane の projects 内容 | `rd.lanes.existing.projects: 5個` |
| **normalize 結果** | 各 project の正規化結果 | `normalizeProjectDraft 成功: okrs=2個` |
| **最終結果** | merge 後の projects 一覧 | `applyDeptDraftToProjects 完了: 最終プロジェクト数=5` |
| **patch 内容** | store に保存する内容 | `patch.projects 設定: 5個` |
| **dept 更新** | store に反映されたキー | `dept 更新: keys=mission, projects, lanes` |

---

## DEBUG ログの無効化

本番環境では `.env.local` から以下を削除またはコメントアウト：

```
# NEXT_PUBLIC_DEBUG_HYDRATE=1
```

ビルド時に DEBUG ログは削除されます（`if (DEBUG)` チェック）。

---

## 参考資料

- **修正対象コード**: `app/cascade/page.tsx:1868-2050`
- **API エンドポイント**: `/api/generate-cascade`
- **主要関数**:
  - `normalizeProjectDraft()` - project の正規化
  - `applyLaneToProjects()` - lane の projects を merge
  - `applyDeptDraftToProjects()` - dept の全 lane をまとめて merge
  - `handleDeptCascadeDraft()` - AI 生成ボタンのハンドラ
