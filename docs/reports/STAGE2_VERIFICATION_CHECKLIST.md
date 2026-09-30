# STAGE2 検証チェックリスト

## 目的
`answers12` と `winPatternsCandidate` が DB に保存・復元され、refetch でも上書きされないことを確保する。

---

## 検証環境設定

### 必須環境変数
ブラウザのコンソールで以下を設定：
```javascript
localStorage.setItem('DEBUG', 'true');
localStorage.setItem('NEXT_PUBLIC_DEBUG_HYDRATE', '1');
```

または `.env.local` に以下を追加：
```
NEXT_PUBLIC_DEBUG_HYDRATE=1
```

---

## 検証手順

### 【ステップ 1】同一端末でのリロード

#### 1-1. データを準備
1. STAGE2 ページを開く
2. **winPatternsCandidate** に 1 件以上追加（例：「市場規模拡大」）
3. **answers12** (12問回答) のうち 1 問だけ回答する（例：問1に「経営課題はXX」）
4. **手動保存** ボタンをクリック

#### 1-2. ログを取得（保存後）
コンソールで以下を確認：
```
[strategyStore] saveStrategyData before API call: {
  answers12_len: 1,      ← 1件の回答がある
  winPatternsCandidate_len: 1,  ← 1件の勝ち筋候補がある
  ...
}
```

#### 1-3. リロード実行
ページをリロード（Cmd+R / Ctrl+R）

#### 1-4. リロード後のログを確認
コンソールで以下をすべてチェック：

**A. DB から生行を拾えたか確認（TASK 2 ログ）：**
```
[stage2][db_raw_check]: {
  has_raw_story_draft: true,
  has_raw_win_patterns_candidate: true,  ← true であること
  has_raw_answers12: true,                ← true であること or
  has_raw_answers_12: true,               ← DB列が答え_12の場合 true
  ...
}
```

⚠️ **もし answers_12 が true で answers12 が false の場合：**
- FIELD_MAP を修正する必要があります（下記参照）

**B. DB から復元後の状態（buildStateFromDbRow）：**
```
[buildStateFromDbRow] raw_復元: {
  answers12_len: 1,              ← 0 でなく 1
  winPatternsCandidate_len: 1,   ← 0 でなく 1
  storyDraft_len: 4,             ← あれば
  ...
}
```

**C. refetch 後のパッチ状態：**
```
[strategyStore refetch] 📦 full state from DB: {
  answers12_len: 1,              ← 0 でなく 1
  winPatternsCandidate_len: 1,   ← 0 でなく 1
  ...
}
```

**D. refetch 完了後の最終状態（TASK 3 ログ）：**
```
[audit][restore:stage2_check] wasDirty=false branch: {
  answers12_len: 1,              ← 0 でなく 1 ← ★ 重要
  winPatternsCandidate_len: 1,   ← 0 でなく 1 ← ★ 重要
  storyDraft_len: 4,             ← あれば
  ...
}
```

#### 1-5. 結果確認（ページ上でも視認）
STAGE2 ページ上で：
- ✅ **winPatternsCandidate** が保持されている（「市場規模拡大」が見える）
- ✅ **answers12** の問1が回答状態で表示される

---

### 【ステップ 2】別端末でログイン

#### 2-1. 別の端末（またはシークレットモード）でログイン
別の端末で同じアカウントでログイン

#### 2-2. STAGE2 ページを開く

#### 2-3. ログを取得
1-4 と同じログを確認（同じ値が見えるはず）

#### 2-4. 結果確認
- ✅ **winPatternsCandidate** が見える
- ✅ **answers12** の問1の回答が見える

---

## トラブルシューティング

### ❌ answers12_len や winPatternsCandidate_len が 0 の場合

#### Case 1: `[stage2][db_raw_check]` で has_raw_answers12 = false
**原因：** DB に列が存在しないか、カラム名が異なる
**確認：**
- DB スキーマを確認（`answers_12` vs `answers12`）
- FIELD_MAP が誤っていないか確認

**修正：**
```typescript
// /utils/supabase/strategy.ts の FIELD_MAP
const FIELD_MAP = {
  ...
  answers12: 'answers_12',  // ← DB列が answers_12 の場合はここを変更
  ...
}
```

#### Case 2: `[buildStateFromDbRow] raw_復元` で answers12_len = 0
**原因：** DB 行は存在するが、復元時に ensureArray で空配列に変換されている
**確認：**
- buildStateFromDbRow() の ensureArray 処理を確認
- buildDbRowFromState() で配列として保存されたか確認

#### Case 3: `[strategyStore refetch] 📦 full state` では値があるのに、最終状態で 0
**原因：** refetch 後に STAGE2 フィールドが上書きされている
**修正：** → TASK 3 は完了済み。修正を適用したか確認

```typescript
// /store/strategyStore.ts 行 2318-2320, 2366-2368
answers12: (minimal as any).answers12 ?? (base as any).answers12,
winPatternsCandidate: (minimal as any).winPatternsCandidate ?? (base as any).winPatternsCandidate,
```

---

## 期待される結果

| 項目 | 期待値 |
|------|--------|
| `[stage2][db_raw_check]` が表示される | ✅ |
| `has_raw_answers12` or `has_raw_answers_12` = true | ✅ |
| リロード後も answers12_len > 0 | ✅ |
| リロード後も winPatternsCandidate_len > 0 | ✅ |
| 別端末でも同じ値が見える | ✅ |

---

## ログの見方

### DEV ログのみ表示（DEBUG フラグ）
```
[stage2][db_raw_check]
[buildStateFromDbRow] raw_復元
[strategyStore refetch] 📦 full state
[audit][restore:stage2_check]
```

### 本番環境（NEXT_PUBLIC_DEBUG_HYDRATE='1'）
```
[audit][restore:field_check]
[audit][restore:stage2_check]
```

---

## 次のステップ

✅ TASK 2 と TASK 3 の修正が完了したら、上記の検証手順を実行してください。
