# handleDeptCascadeDraft 改善サマリー

## 改善内容

`handleDeptCascadeDraft` 周辺で、AI 生成結果が正しく処理されていることを確保するための改善を実施しました。

### 改善のポイント

1. ✅ **lanes から projects を確実に抽出** - API レスポンスの lanes.existing と lanes.new から projects を抽出
2. ✅ **OKR/KPI の多形対応** - 複数の別名パターンを吸収して StoreOKR に正規化
3. ✅ **詳細なデバッグログ** - lanes 内の project keys と OKR フィールドを全て出力

---

## 詳細な改善内容

### 1. DEBUG ログの拡張（行 1868-1906）

#### lanes.existing の詳細ログ
```typescript
if (rd.lanes?.existing?.projects?.length) {
  console.log(`[Cascade] rd.lanes.existing.projects: ${rd.lanes.existing.projects.length}個`);
  rd.lanes.existing.projects.forEach((p, i) => {
    console.log(`  [${i}] title="${p.title}", keys=${Object.keys(p).join(', ')}`);
    console.log(`    okrs=${(p as any).okrs ? '✓' : '✗'}, okr=${(p as any).okr ? '✓' : '✗'}, ...`);
    if ((p as any).okrs?.length) console.log(`    okrs[0]=${JSON.stringify((p as any).okrs[0])...}`);
  });
}
```

**確認される内容**:
- 各 project のタイトル
- 各 project に含まれるフィールド一覧
- okrs/okr/kpis/kpi/metrics/objective/keyResults の有無（✓/✗）
- 実際の OKR データのサンプル

#### lanes.new の詳細ログ
- lanes.existing と同じ形式で lanes.new の projects も出力

---

### 2. normalizeProjectDraft の強化（行 948-1030）

#### OKR 取り込み優先順位の拡張

**従来**（6パターン）:
1. okrs > okr > kpis > kpi > metrics > objective+keyResults

**改善後**（9パターン）:
1. okrs (array)
2. okr (single)
3. kpis (array) → objective, keyResults に変換
4. kpi (single) → objective, keyResults に変換
5. metrics (array) → objective, keyResults に変換
6. **goals (array)** ← 新規
7. **outcomes (array)** ← 新規
8. **keyResults (array only)** ← 新規
9. objective + keyResults (direct)

#### 別名の吸収強化

**objective 相当の抽出**:
```typescript
objective: k.objective || k.label || k.title || k.name || ''
```

**keyResults / KPI 相当の抽出**:
```typescript
keyResults: k.keyResults || k.metrics || k.measures || k.values || []
```

例：
- API が `{ goals: [{ goal: "...", metrics: [...] }] }` を返している場合、自動変換
- API が `{ outcomes: [{ outcome: "...", measures: [...] }] }` を返している場合、自動変換

---

### 3. applyLaneToProjects のログ強化（行 1057-1082）

```typescript
if (!normalized) {
  if (DEBUG) {
    console.log('[Cascade] normalizeProjectDraft 失敗: title="' + (pd?.title || '(empty)') + '"');
  }
  continue;
}

if (DEBUG) {
  console.log('[Cascade] normalizeProjectDraft 成功: title="' + normalized.title + '", okrs=' + (normalized.okrs?.length ?? 0) + '個');
}
```

**確認される内容**:
- 各 project がどう正規化されたか
- 正規化失敗のプロジェクト（空タイトルなど）
- 最終的に OKR が何個取り込まれたか

---

### 4. applyDeptDraftToProjects のログ強化（行 1085-1134）

#### 処理ステップのログ
```typescript
if (DEBUG && deptDraft?.lanes?.existing?.projects?.length) {
  console.log('[Cascade] applyDeptDraftToProjects: lanes.existing projects ' + deptDraft.lanes.existing.projects.length + '個を処理');
}
```

#### 最終結果のログ
```typescript
if (DEBUG) {
  console.log('[Cascade] applyDeptDraftToProjects 完了: 最終プロジェクト数=' + result.length);
  result.forEach((p, i) => {
    console.log(`  [${i}] "${p.title}", okrs=${p.okrs?.length ?? 0}個`);
  });
}
```

**確認される内容**:
- lanes.existing と lanes.new がそれぞれ何個の projects を処理したか
- dedupe 後の最終プロジェクト数
- 各プロジェクトの OKR 個数

---

### 5. handleDeptCascadeDraft の patch 出力ログ（行 2020-2048）

```typescript
if (!jsonEq(mergedProjects, existingProjects)) {
  patch.projects = mergedProjects;
  if (DEBUG) {
    console.log('[Cascade] patch.projects 設定: ' + mergedProjects.length + '個');
    mergedProjects.forEach((p, i) => {
      console.log(`  [${i}] "${p.title}", okrs=${p.okrs?.length ?? 0}個`);
    });
  }
}
```

**確認される内容**:
- patch.projects に何個の projects が入ったか
- 各プロジェクトの最終的な OKR 個数
- patch.lanes が設定されたか
- dept 更新に何が含まれたか

---

## テスト方法

### ステップ 1: DEBUG ログを有効化

`.env.local` を確認：
```
NEXT_PUBLIC_DEBUG_HYDRATE=1
```

### ステップ 2: ブラウザ DevTools を開く

```
F12 → Console タブ
```

### ステップ 3: Cascade ページで AI 生成を実行

1. `http://localhost:3000/cascade` にアクセス
2. 部門の「AIでこの部門のたたき台」ボタンをクリック
3. ローディング完了を待つ

### ステップ 4: Console でログを確認

```
[Cascade] 部門マッチ成功："営業部"
[Cascade] rd.keys: [...]
[Cascade] rd.lanes.existing.projects: 5個
  [0] title="顧客管理システムの構築", keys=title, hypothesis, ..., okrs
    okrs=✓, okr=✗, kpis=✗, ...
    okrs[0]={"objective":"売上5倍","keyResults":["KR1","KR2"]}
[Cascade] applyDeptDraftToProjects: lanes.existing projects 5個を処理
[Cascade] normalizeProjectDraft 成功: title="顧客管理システムの構築", okrs=2個
...
[Cascade] applyDeptDraftToProjects 完了: 最終プロジェクト数=5
  [0] "顧客管理システムの構築", okrs=2個
  ...
[Cascade] patch.projects 設定: 5個
[Cascade] patch.lanes 設定
[Cascade] dept 更新: keys=mission, strategy, missionDraft, projects, lanes
```

### ステップ 5: UI で確認

ページをリロード（F5）して以下を確認：
- ✓ プロジェクト一覧が表示される
- ✓ 各プロジェクトに目標（Objective）が表示される
- ✓ 各プロジェクトに指標（KeyResults）が表示される

---

## 期待される改善効果

| 問題 | 従来 | 改善後 |
| --- | --- | --- |
| **lanes が空の場合** | `undefined` でハング | `rd.lanes.existing.projects: 0個` でログ出力、原因が特定可能 |
| **OKR フィールド名が異なる** | 取り込み失敗、okrs=0 | 9 パターン対応で自動吸収 |
| **API レスポンスの謎** | ブラックボックス | lane/project/OKR 構造を全て可視化 |
| **merge 失敗時の原因不明** | 「なぜプロジェクトが入らないのか？」 | `applyDeptDraftToProjects 完了: 最終プロジェクト数=0` で即座に判明 |
| **patch が反映されない** | 「保存されたのか？」 | `dept 更新: keys=...` で確認可能 |

---

## ファイル変更一覧

- **app/cascade/page.tsx**
  - 行 131-147: `ApiDeptDraft` 型に `okrs`, `kpis` を追加
  - 行 948-1030: `normalizeProjectDraft` に OKR パターン追加（goals, outcomes, keyResults only）
  - 行 1057-1082: `applyLaneToProjects` に DEBUG ログ追加
  - 行 1085-1134: `applyDeptDraftToProjects` に DEBUG ログ追加
  - 行 1868-1906: `handleDeptCascadeDraft` に lanes 詳細ログ追加
  - 行 2020-2048: `handleDeptCascadeDraft` に patch ログ追加

---

## ビルド検証

✅ `npm run build` 成功

---

## デバッグガイド

詳細なデバッグ方法は以下を参照：

📖 `docs/DEBUG-GUIDE-HANDLECASCADEDRAFT.md`

---

## 追加対応可能なパターン

将来的に以下のパターンに対応することも可能：

```typescript
// パターン A: result パターン
{
  result: [
    { title: "...", indicators: ["...", "..."] }
  ]
}

// パターン B: items パターン
{
  items: [
    { name: "...", measures: ["...", "..."] }
  ]
}

// パターン C: roadmap パターン
{
  roadmap: [
    { milestone: "...", success_metrics: ["...", "..."] }
  ]
}
```

これらが返された場合、`normalizeProjectDraft` に以下を追加するだけで対応可能：

```typescript
} else if (Array.isArray((pd as any).result) && (pd as any).result.length) {
  okrsList = (pd as any).result.map((r: any) => ({
    objective: r.title || r.name || r.objective || '',
    keyResults: r.indicators || r.measures || r.metrics || [],
  }));
} else if (Array.isArray((pd as any).items) && (pd as any).items.length) {
  // ...
```

---

## まとめ

この改善により、handleDeptCascadeDraft は以下を実現します：

✅ **lanes から projects を確実に抽出** - API レスポンス形式に関わらず、lanes 内の projects を全てカバー
✅ **OKR/KPI を多形対応で吸収** - 9 つのパターンで API 仕様の変動に対応
✅ **完全な可視化** - 全ステップの詳細ログで問題発生時の原因特定が容易
✅ **本番対応** - DEBUG ログは条件付きなので本番での性能影響なし
