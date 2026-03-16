# GROWTH Phase 1 実地検証マニュアル
## Concurrent Editing Safety Enhancement - 実地検証

**テスト実施日**: ___________
**テスト実施者**: ___________
**環境**: 本ローカル開発環境

---

## 準備フェーズ

### 前提条件の確認

- [ ] ローカル開発サーバーが起動している
- [ ] `NEXT_PUBLIC_DEBUG_HYDRATE=1` が .env.local または環境変数で有効化されている
- [ ] ブラウザが2つ以上用意できる（Firefox + Chrome 推奨、同じブラウザの別タブ/ウィンドウも可）
- [ ] DevTools Console が両ブラウザで開いている状態を維持できる

### 環境確認コマンド

```bash
# ローカルサーバー状態確認
curl -I http://localhost:3000

# DEBUG フラグ確認
grep NEXT_PUBLIC_DEBUG_HYDRATE .env.local
```

### セットアップ手順

1. **ブラウザ A を開く**
   ```
   URL: http://localhost:3000
   DevTools: F12 → Console タブを開く
   Company: テスト用企業を選択（以下、この企業を固定）
   ```

2. **ブラウザ B を開く**
   ```
   URL: http://localhost:3000
   DevTools: F12 → Console タブを開く
   Company: ブラウザ A と同じ企業を選択
   ```

3. **両ブラウザで同期確認**
   ```
   Console に以下のようなログが出ていることを確認：
   [strategyStore] 🔍 getFullStrategyDataByCompany 呼び出し前
   [audit][restore:stage2_check] wasDirty=false branch
   ```

---

## Scenario 1: /cascade での同じ項目の同時編集

**目的**: REVISION_CONFLICT が正しく検出され、ローカル編集が保持されるか確認

### テスト手順

#### Step 1: 初期状態確認（両ブラウザ共通）
- [ ] Browser A: http://localhost:3000/cascade を開く
- [ ] Browser B: 同じ URL を開く
- [ ] 両ブラウザで「Mission」フィールドが同じテキストを表示していることを確認

#### Step 2: Browser A で編集・保存
- [ ] Browser A: 「Mission」フィールドに新しいテキストを入力
  ```
  例: "This is A's mission - timestamp: [現在時刻]"
  ```
- [ ] 入力後、自動保存を待たず、明示的に保存ボタンをクリック
- [ ] Console に以下のログが出ることを確認：
  ```
  [audit][save:start] caller=store:saveStrategyData:manual
  [audit][save:done] ... result: 'success'
  ```

#### Step 3: Browser B で編集・保存（同じフィールド）
- [ ] Browser B: 「Mission」フィールルを異なる内容に編集
  ```
  例: "This is B's mission - timestamp: [現在時刻]"
  ```
- [ ] Browser B: 保存ボタンをクリック
- [ ] **Console に REVISION_CONFLICT ログが出ることを期待**

#### Step 4: REVISION_CONFLICT 検証
- [ ] Browser B の Console に以下のログを確認：
  ```
  [strategyStore] ⚠ REVISION_CONFLICT (attempt 1/3)...
  expectedRevision: [数字]
  currentRevision: [異なる数字]
  ```

#### Step 5: UI 上の入力値保持確認
- [ ] **重要**: Browser B の「Mission」フィールドのテキストが消えていないことを確認
  - 消えている場合: **FAIL - 詳細ログを記録**
  - 消えていない場合: **PASS**

#### Step 6: エラーメッセージ確認
- [ ] Browser B の画面上にエラーメッセージが表示されているか確認
- [ ] メッセージに以下が含まれているか：
  - [ ] 「他のユーザーの更新と競合しました」
  - [ ] 「あなたの変更は保持されています」
  - [ ] 「内容を確認して再度保存してください」

#### Step 7: リトライ・再保存
- [ ] Browser B: 自動リトライが行われ、再保存が実行される
- [ ] Console で以下を確認：
  ```
  [strategyStore] ⚠ REVISION_CONFLICT (attempt 2/3)...
  [strategyStore] ⚠ REVISION_CONFLICT (attempt 3/3)...
  [strategyStore] REVISION_CONFLICT persists after 3 retries. Entering cooldown.
  ```
- [ ] 最終的に、cooldown メッセージが出るか、成功するかどちらか

#### Step 8: 最終状態確認
- [ ] Browser A で refresh → 最終的な DB 値を確認
  ```
  予期される挙動：
  - A の最初の保存値が残る場合: 楽観ロック動作正常
  - B の値に上書きされている場合: 競合解決ロジックの確認が必要
  ```

### テスト結果記入

```
Scenario 1 実施結果
─────────────────────

実施日時: ___________
実施者: ___________

【Phase: REVISION_CONFLICT 検出】
- CONFLICT ログが出たか: [ ] はい / [ ] いいえ / [ ] N/A
  出力内容: ___________

【Phase: UI 入力保持】
- Browser B の入力値が消えたか: [ ] はい(FAIL) / [ ] いいえ(PASS) / [ ] 一部消失
  具体的な状態: ___________

【Phase: エラーメッセージ】
- 「他のユーザーの更新と競合」: [ ] あり / [ ] なし
- 「あなたの変更は保持」: [ ] あり / [ ] なし
- 「内容を確認して再度保存」: [ ] あり / [ ] なし

【Phase: リトライ】
- Backoff (attempt 1→2→3) が観測されたか: [ ] はい / [ ] いいえ
  実際の時間間隔: ___________

【Phase: 最終状態】
- Browser A の値: ___________
- Browser B から見た値: ___________
- 一致しているか: [ ] はい / [ ] いいえ

【問題があったか】: [ ] なし / [ ] あり → 詳細: ___________

【総合判定】
結果: [ ] 成功 / [ ] 失敗 / [ ] 部分成功
理由: ___________
```

---

## Scenario 2: /okr での同時編集

**目的**: /cascade と異なる画面での REVISION_CONFLICT 挙動が同様に安全か確認

### テスト手順

#### Step 1: 画面移動
- [ ] Browser A: http://localhost:3000/okr を開く
- [ ] Browser B: 同じ URL を開く
- [ ] 両ブラウザが同じ OKR データを表示していることを確認

#### Step 2: 異なるフィールドで同時編集（部分的に異なる更新）
- [ ] Browser A: Objective または Key Result テキストを編集
  ```
  例: "Objective A - Test [timestamp]"
  ```
- [ ] Browser B: 別の Objective または異なる部分を編集
  ```
  例: "Objective B - Test [timestamp]"
  ```

#### Step 3: 保存順序（A → B）
- [ ] Browser A: 保存ボタンをクリック
  - Console: `[audit][save:done]` が出ることを確認
- [ ] Browser B: 保存ボタンをクリック
  - Console: `[strategyStore] ⚠ REVISION_CONFLICT` が出ることを期待

#### Step 4: 検証ポイント
- [ ] Browser B の入力値が消えていないか確認
- [ ] エラーメッセージが表示されているか確認
- [ ] A の編集内容が消えていないか確認（B から見て）

#### Step 5: リトライ結果確認
- [ ] 3回のリトライが起こっているか
- [ ] 最終的に成功するか cooldown に入るか確認

### テスト結果記入

```
Scenario 2 実施結果
─────────────────────

実施日時: ___________
実施者: ___________

【初期化フェーズ】
- 両ブラウザで同じ OKR が表示されたか: [ ] はい / [ ] いいえ

【編集フェーズ】
- Browser A の編集内容: ___________
- Browser B の編集内容: ___________
- 編集箇所の重複度: [ ] なし / [ ] 部分的 / [ ] 完全重複

【保存フェーズ】
- Browser A 保存成功: [ ] はい / [ ] いいえ
- Browser B CONFLICT 検出: [ ] はい / [ ] いいえ
- Browser B 入力値消失: [ ] なし(PASS) / [ ] あり(FAIL)

【最終状態】
- Browser A の編集が DB に残ったか: [ ] はい / [ ] いいえ
- Browser B の編集が DB に残ったか: [ ] はい / [ ] いいえ / [ ] 一部
- 最終 revision: ___________

【総合判定】
結果: [ ] 成功 / [ ] 失敗 / [ ] 部分成功
理由: ___________
```

---

## Scenario 3: 削除 vs 編集

**目的**: 削除と編集が混在した場合、データの整合性が保たれるか確認

### テスト手順

#### Step 1: 初期 department/project 確認
- [ ] Browser A, B 両方で /cascade を開く
- [ ] 対象となる department または project を確認（例：部門ID = "D1"）
  ```
  確認内容:
  - 部門名: ___________
  - 部門配下の要素数: ___________
  ```

#### Step 2: Browser A で削除
- [ ] Browser A: 対象 department/project を削除操作
  ```
  例: "削除ボタンをクリック" → "確認ダイアログで削除確認"
  ```
- [ ] Console で削除処理のログを確認
- [ ] Browser A: 明示的に保存ボタンをクリック
  ```
  期待ログ: [audit][save:done]
  ```

#### Step 3: Browser B で同じ department 配下の項目を編集
- [ ] Browser B: 削除されようとしている department の配下項目（例：project の name）を編集
  ```
  例: "Project Name - edited by B [timestamp]"
  ```

#### Step 4: Browser B で保存
- [ ] Browser B: 保存ボタンをクリック
- [ ] Console: `[strategyStore] ⚠ REVISION_CONFLICT` を期待
- [ ] **重要**: UI が壊れていないか確認（入力欄が不適切な位置に浮いていないか等）

#### Step 5: 最終状態確認
- [ ] Browser A を refresh
- [ ] 削除された department は本当に消えているか
- [ ] B が編集した項目はどうなっているか
  - [ ] 削除に巻き込まれて消えた（仕様通り）
  - [ ] 残っている（設計に応じて正常な可能性）
  - [ ] 予期しない位置に移動している（FAIL）

### テスト結果記入

```
Scenario 3 実施結果
─────────────────────

実施日時: ___________
実施者: ___________

【削除フェーズ】
- 削除対象: ___________
- Browser A 削除操作成功: [ ] はい / [ ] いいえ
- Browser A 保存成功: [ ] はい / [ ] いいえ
- 削除後、Browser A から見える状態: ___________

【編集フェーズ】
- Browser B 編集対象: ___________（削除対象の配下）
- Browser B 編集内容: ___________
- Browser B 入力値が消えたか: [ ] はい(FAIL) / [ ] いいえ(PASS)

【競合フェーズ】
- Browser B CONFLICT 検出: [ ] はい / [ ] いいえ
- リトライ後の状態: ___________

【最終状態（Refresh後）】
- 削除された department は消えているか: [ ] はい / [ ] いいえ
- B が編集した項目の状態: ___________
  - [ ] 削除に巻き込まれた（仕様通り）
  - [ ] 残っている（別仕様）
  - [ ] 予期しない位置（FAIL）

【UI 整合性】
- UI が壊れた（項目が浮いてる等）: [ ] なし(PASS) / [ ] あり(FAIL)
  具体的: ___________

【総合判定】
結果: [ ] 成功 / [ ] 失敗 / [ ] 要調査
理由: ___________
```

---

## Scenario 4: 追加 vs 編集

**目的**: 新規要素の追加と既存要素の編集が混在したとき、両方が保持されるか

### テスト手順

#### Step 1: 初期状態確認
- [ ] Browser A, B 両方で /cascade を開く
- [ ] 現在の project 数を確認
  ```
  初期 project 数: ___________
  ```

#### Step 2: Browser A で新規 project を追加
- [ ] Browser A: 「Add Project」などのボタンをクリック
- [ ] 新規 project の情報を入力
  ```
  Project Name: "New Project A - [timestamp]"
  その他フィールド: ___________
  ```
- [ ] Browser A: 明示的に保存ボタンをクリック
  ```
  期待ログ: [audit][save:done]
  ```

#### Step 3: Browser B で既存 project を編集
- [ ] Browser B: 既存の project 1つを選択して編集
  ```
  編集対象: ___________
  編集内容: "Edited by B - [timestamp]"
  ```

#### Step 4: Browser B で保存
- [ ] Browser B: 保存ボタンをクリック
- [ ] Console: `[strategyStore] ⚠ REVISION_CONFLICT` を期待
- [ ] Browser B の入力値が消えていないか確認

#### Step 5: リトライ結果確認
- [ ] 3回のリトライが実行されるか
- [ ] 最終的に成功するか cooldown に入るか

#### Step 6: 最終状態確認
- [ ] Browser A を refresh
- [ ] A が追加した project が残っているか
  ```
  最終 project 数: ___________ （初期 + 1 のはず）
  A が追加した project: [ ] 残っている / [ ] 消えた(FAIL)
  ```
- [ ] B が編集した project が反映されているか
  ```
  B が編集した project の内容: ___________
  ```

### テスト結果記入

```
Scenario 4 実施結果
─────────────────────

実施日時: ___________
実施者: ___________

【追加フェーズ】
- Browser A 追加対象: ___________
- Browser A 保存成功: [ ] はい / [ ] いいえ
- 初期 project 数: ___________

【編集フェーズ】
- Browser B 編集対象: ___________
- Browser B 編集内容: ___________
- Browser B 入力値消失: [ ] なし(PASS) / [ ] あり(FAIL)

【競合フェーズ】
- Browser B CONFLICT 検出: [ ] はい / [ ] いいえ
- Backoff 実行: [ ] はい / [ ] いいえ

【最終状態（Refresh後）】
- 最終 project 数: ___________
- A が追加した project: [ ] 残っている(PASS) / [ ] 消えた(FAIL)
- B が編集した project: [ ] 反映されている / [ ] 反映されていない
- 両 project の内容が期待通りか: [ ] はい / [ ] いいえ

【総合判定】
結果: [ ] 成功 / [ ] 失敗 / [ ] 部分成功
理由: ___________
```

---

## Scenario 5: Restore/Hydrate 直後の Ghost Save

**目的**: 画面リロード後、何も編集しなくても保存が走らないことを確認

### テスト手順

#### Step 1: 初期化（Browser A のみ）
- [ ] Browser A: http://localhost:3000/cascade を開く
- [ ] Console をクリア（`console.clear()` を実行）
- [ ] 何も編集しない状態で 5〜10 秒待機

#### Step 2: Restore フェーズの観測
- [ ] Console に以下のログが出ることを確認：
  ```
  [strategyStore] 🔍 getFullStrategyDataByCompany 呼び出し前
  [getFullStrategyDataByCompany] revision: [数字]
  [audit][restore:stage2_check] wasDirty=false branch
  ```

#### Step 3: Post-Restore Cooldown の検証（最重要）
- [ ] Restore 完了後、2秒以内に以下のログが出ないことを確認：
  ```
  ❌ 避けるべきログ:
  [audit][save:start]  ← restore 直後の保存
  [AutoSave][SAVE] ...
  ```

- [ ] **代わりに**、以下のログが出ることを期待：
  ```
  ✅ 期待ログ:
  [AutoSave][mode] payload - SKIP: post-restore cooldown { timeSinceSync: [値] }
  ```

#### Step 4: Revision 確認
- [ ] Restore 前後で revision が変わっていないことを確認
  ```
  restore 前 revision: ___________
  restore 後 revision: ___________
  変わっているか: [ ] はい(FAIL) / [ ] いいえ(PASS)
  ```

#### Step 5: 15 秒観察
- [ ] Restore 完了から 15 秒間、以下を確認：
  - [ ] `[AutoSave]` の SKIP ログが 2 秒以内に出るか
  - [ ] 2 秒後から通常の autosave が走り始めるか
  - [ ] 不要な `[audit][save:start]` が出ないか

### テスト結果記入

```
Scenario 5 実施結果
─────────────────────

実施日時: ___________
実施者: ___________

【Restore フェーズ】
- Restore ログが出たか: [ ] はい / [ ] いいえ
- Restore 実行時刻: ___________

【Post-Restore Cooldown】
- Restore 直後 2 秒以内に [AutoSave] SKIP ログが出たか: [ ] はい(PASS) / [ ] いいえ(FAIL)
  該当ログ: ___________

【Ghost Save チェック】
- Restore 直後に不要な [audit][save:start] が出たか: [ ] なし(PASS) / [ ] あり(FAIL)
- 出た場合のタイムスタンプ: ___________
- 出た場合の reason: ___________

【Revision 遷移】
- Restore 前: ___________
- Restore 後: ___________
- 無駄に増えたか: [ ] いいえ(PASS) / [ ] はい(FAIL)

【15 秒観察の所見】
- 2 秒以内: [AutoSave] SKIP が出た回数: ___________
- 2 秒～15 秒: [AutoSave] が通常動作するか: [ ] はい / [ ] いいえ
- 不要な保存: [ ] なし(PASS) / [ ] あり(FAIL)

【総合判定】
結果: [ ] 成功 / [ ] 失敗 / [ ] 要調査
理由: ___________
```

---

## Scenario 6: 手動保存 vs Autosave の重複

**目的**: 同一ユーザー内で手動保存と autosave が重なっても二重保存しないことを確認

### テスト手順

#### Step 1: 初期化（Browser A のみ）
- [ ] Browser A: http://localhost:3000/cascade を開く
- [ ] Console をクリア
- [ ] 何か項目（Mission など）を編集開始
  ```
  編集内容: "Manual + AutoSave test - [timestamp]"
  ```

#### Step 2: Autosave 前のタイミングで手動保存
- [ ] Browser A: テキストを入力したら **すぐに** 保存ボタンをクリック
  ```
  タイミング: autosave trigger までの時間（約 1.2 秒）より前
  ```
- [ ] Console で以下を確認：
  ```
  [audit][save:start] caller=store:saveStrategyData:manual
  [audit][save:done]
  ```

#### Step 3: Autosave の抑制確認
- [ ] 保存完了後、2 秒間以上 autosave が走らないことを確認
  ```
  期待ログ:
  [AutoSave][mode] payload - SKIP: minIntervalMs not elapsed
  ```

#### Step 4: もう一度編集→手動保存
- [ ] Browser A: 別のフィールドを編集
- [ ] 手動保存ボタンをクリック
- [ ] Console:
  ```
  ✓ [audit][save:done] が 1 回だけ出ているか（二重保存でないか）
  ✓ [audit][save:start] が 1 回だけ出ているか
  ```

#### Step 5: _loadingSave ガード確認
- [ ] 保存中に再度保存ボタンをクリック
  ```
  期待動作: 2 番目のクリックが無視される（ガード動作）
  ```
- [ ] Console で以下を確認：
  ```
  [strategyStore] saveStrategyData: already saving, set pending
  ```

#### Step 6: Pending 再実行の確認
- [ ] 最初の保存が完了した後、pending 再実行ログが出るか
  ```
  期待ログ:
  [strategyStore] pending detected, re-running saveStrategyData
  ```

### テスト結果記入

```
Scenario 6 実施結果
─────────────────────

実施日時: ___________
実施者: ___________

【手動保存フェーズ】
- 編集内容: ___________
- 手動保存ボタンクリック成功: [ ] はい / [ ] いいえ
- [audit][save:start] 実行: [ ] はい / [ ] いいえ
- [audit][save:done] 実行: [ ] はい / [ ] いいえ

【Autosave 抑制】
- 保存完了後 2 秒以内に autosave 走行: [ ] なし(PASS) / [ ] あり(FAIL)
- [AutoSave] SKIP ログ出現: [ ] あり / [ ] なし

【二重保存防止】
- 保存中に再度保存ボタンをクリック時の動作: [ ] 無視(PASS) / [ ] 二重実行(FAIL)
- [strategyStore] already saving, set pending ログ: [ ] あり / [ ] なし

【Pending 再実行】
- 最初の保存完了後に pending 再実行されたか: [ ] はい / [ ] いいえ
- ログ: ___________

【Save ログの統計】
- [audit][save:start] 出現回数: ___________
- [audit][save:done] 出現回数: ___________
- 数が一致しているか: [ ] はい(PASS) / [ ] いいえ(FAIL)

【総合判定】
結果: [ ] 成功 / [ ] 失敗 / [ ] 要調査
理由: ___________
```

---

## 確認すべきログ一覧

### ログ出力ポイントと見方

#### 1. **REVISION_CONFLICT 発生時**

**ログ場所**: Chrome/Firefox DevTools → Console

```javascript
// 1. strategyStore.ts での検出
[strategyStore] ⚠ REVISION_CONFLICT (attempt 1/3). Preserving local edits and refetching...
{
  expectedRevision: 5,
  currentRevision: 6,
  occurredAt: 1678900000000,
  attempt: 1
}

// 2. strategy.ts での検出（API 層）
[StrategyData] ⚠ REVISION_CONFLICT detected {
  userId: "user-123",
  companyId: "company-456",
  strategyId: "strategy-789",
  expectedRevision: 5,
  message: "Data was modified by another session"
}

// 3. Backoff 実行（2 回目）
[strategyStore] ⚠ REVISION_CONFLICT (attempt 2/3)...

// 4. Backoff 実行（3 回目）
[strategyStore] ⚠ REVISION_CONFLICT (attempt 3/3)...

// 5. 最終的に失敗
[strategyStore] REVISION_CONFLICT persists after 3 retries. Entering cooldown.
{
  saveError: "他のユーザーの更新と競合しました。あなたの変更は保持されています。内容を確認して再度保存してください。",
  pendingConflictRecovery: false,
  conflictCooldownUntil: 1678900003000  // 3秒 cooldown
}
```

**確認ポイント**:
- expectedRevision と currentRevision が異なるか
- userId と companyId が正しいか
- 3 回のリトライが出ているか（attempt 1/3, 2/3, 3/3）
- Backoff 時間が 0ms → 250ms → 800ms か（精密には測定不要、大体の流れを見る）

---

#### 2. **Post-Restore Cooldown（Scenario 5）**

```javascript
// Restore 開始
[strategyStore] 🔍 getFullStrategyDataByCompany 呼び出し前
{
  companyId: "company-456",
  _loadingRefetch: true
}

// Restore 完了
[audit][restore:stage2_check] wasDirty=false branch {
  ceoIntent_len: 150,
  storyDraft_len: 0,
  answers12_len: 3,
  ...
}

// Post-Restore Cooldown ログ（Restore 直後 2 秒以内）
[AutoSave][mode] payload - SKIP: post-restore cooldown {
  timeSinceSync: 342  // milliseconds（342ms しか経過していない）
}

// Cooldown 期間終了後（2 秒後）は通常の autosave に戻る
[AutoSave][signature-length] {
  length: 5432,
  mode: "payload",
  ...
}
```

**重要**: Restore 直後に `[audit][save:start]` が **出ないこと** が正常

---

#### 3. **Autosave ガード（各種）**

```javascript
// ガード理由ごとのログ

// 1. Conflict cooldown 中
[AutoSave][mode] payload - SKIP: in conflict cooldown period

// 2. Post-restore cooldown 中
[AutoSave][mode] payload - SKIP: post-restore cooldown {
  timeSinceSync: 500
}

// 3. Conflict 回復中
[AutoSave][mode] payload - SKIP: pending conflict recovery

// 4. 最小間隔未達
[AutoSave][mode] payload - SKIP: minIntervalMs not elapsed

// 5. 水分が出ていない
[AutoSave][mode] payload - SKIP: dirty=false, skip (not forced, not manual)
```

**確認ポイント**: 期待されるスキップ理由が出ているか

---

#### 4. **Manual Save（手動保存）**

```javascript
// 手動保存開始
[audit][save:start] caller=store:saveStrategyData:manual {
  userId: "user-123",
  effectiveCompanyId: "company-456",
  strategyId: "strategy-789",
  revisionBefore: 5,
  payloadSize: 12345,
  mode: "upsert",
  trigger: "unknown",
  retryCount: 0
}

// 成功
[audit][save:done] caller=store:saveStrategyData:manual duration=234ms {
  effectiveCompanyId: "company-456",
  strategyId: "strategy-789",
  revisionBefore: 5,
  revisionAfter: 6,
  result: "success"
}
```

**確認ポイント**: revisionBefore から revisionAfter に 1 増えたか

---

#### 5. **二重保存防止（Already Saving ガード）**

```javascript
// 保存中に再度保存ボタンをクリック
[strategyStore] saveStrategyData: already saving, set pending {
  reason: "manual",
  isSaving: true,
  isLoading: true
}

// 最初の保存完了後、pending が自動実行
[strategyStore] pending detected, re-running saveStrategyData {
  reason: 'pending'
}

// 2 回目の保存実行
[audit][save:start] caller=store:saveStrategyData:pending ...
```

**確認ポイント**:
- `already saving, set pending` が出ているか
- その後 pending 再実行が自動で走るか
- `[audit][save:start]` が 1 回目の完了後に出るか

---

### ログを見つけるコマンド（DevTools 内）

```javascript
// Scenario 1-4: REVISION_CONFLICT ログをフィルタ
console.log('--- CONFLICT LOGS ---');
// DevTools の Filter で以下を入力：
// [strategyStore] ⚠ REVISION_CONFLICT

// Scenario 5: Post-Restore Cooldown をフィルタ
// [AutoSave][mode] payload - SKIP: post-restore cooldown

// Scenario 6: Save ログをカウント
// [audit][save:start]
// [audit][save:done]
```

---

## 問題が起きたときのトラブルシューティング

### Issue 1: Conflict 後に UI 入力が消える

**症状**: Browser B で REVISION_CONFLICT 後、入力欄が空になる

**確認ログ**:
```
❌ 以下のログが出ていないか？
[strategyStore refetch] 📦 full state from DB
...
(その後、state が削除されたものになっている)
```

**原因候補**:
1. `extractServerDecidedPatch` が user-editable フィールドを誤って上書き
2. `wasDirty` フラグが false になっている
3. refetch 後に dirty が無条件にリセットされている

**確認手順**:
```javascript
// Console で以下を実行（refetch 後すぐ）
const store = useStrategyStore.getState();
console.log('dirty:', store.dirty);
console.log('mission:', store.mission);  // 期待: 消えていない
console.log('lastConflictInfo:', store.lastConflictInfo);  // 期待: conflict 情報がある
```

---

### Issue 2: Ghost Save（restore 直後の無駄保存）

**症状**: Restore 完了直後に revision が勝手に増える

**確認ログ**:
```
❌ 期待しないログ:
[audit][save:start] ... revisionBefore: 5
[audit][save:done] ... revisionAfter: 6
（restore 直後なのに revision が増えている）
```

**原因候補**:
1. `lastServerSyncAt` が設定されていない
2. `post-restore cooldown` のチェック条件が間違っている
3. `restoreReady` フラグが正しく set されていない

**確認手順**:
```javascript
const store = useStrategyStore.getState();
console.log('lastServerSyncAt:', store.lastServerSyncAt);  // 期待: 現在時刻
console.log('restoreReady:', store.restoreReady);          // 期待: true
console.log('isRestoring:', store.isRestoring);            // 期待: false
```

---

### Issue 3: 二重保存（同一ユーザーで 2 回保存される）

**症状**: `[audit][save:start]` が 1 回のつもりなのに 2 回出力

**確認ログ**:
```
❌ 期待しないログ:
[audit][save:start] ... revisionBefore: 5
[audit][save:done] ... revisionAfter: 6
[audit][save:start] ... revisionBefore: 6  ← 2 回目
[audit][save:done] ... revisionAfter: 7
```

**原因候補**:
1. `_loadingSave` ガードが効いていない
2. autosave と手動保存が同時実行
3. `minIntervalMs` チェックが効いていない

**確認手順**:
```javascript
const store = useStrategyStore.getState();
console.log('_loadingSave:', store._loadingSave);          // 期待: false（保存終了後）
console.log('boot.isSaving:', store.boot?.isSaving);       // 期待: false
console.log('_pendingSave:', store._pendingSave);          // 期待: false
```

---

### Issue 4: Conflict リトライが 3 回出ない（早期に終了）

**症状**: attempt 2/3 まで行かず、1 回で FAIL する

**確認ログ**:
```
❌ 期待しないログ:
[strategyStore] ⚠ REVISION_CONFLICT (attempt 1/3)...
[strategyStore] REVISION_CONFLICT persists after 3 retries...
（attempt 2/3, 3/3 がスキップされている）
```

**原因候補**:
1. refetchFromServer() が例外を投げている
2. retry ループが `continue` されていない
3. Backoff `setTimeout` が動作していない

**確認手順**:
```javascript
// refetch エラーログを確認
[strategyStore] refetch after conflict failed: ...

// または backoff が実行されたか
// 手動で attempt 1 と attempt 2 のログの時刻差を確認
// 期待: 250ms 以上の差
```

---

### Issue 5: 削除・追加で予期しない巻き戻り

**症状**: Scenario 3 or 4 で、A の削除/追加が B の編集後に消える

**確認ログ**:
```
初期 project 数: 5
A が追加後: 6
B の conflict により refetch
最終 project 数: 5  ← 追加が消えた（FAIL）
```

**原因候補**:
1. refetch 時に server state で完全に上書きされている
2. dirty フラグが false なのに full replace されている
3. extractServerDecidedPatch が projects 全体を削除している

**確認手順**:
```javascript
// refetch 前後の state を確認
console.log('Before refetch - projects:', store.projects.length);
console.log('After refetch - projects:', store.projects.length);

// extractServerDecidedPatch の出力を確認
[strategyStore refetch] ... の出力で projects_len を見る
```

---

## 最終チェックリスト（テスト完了後）

```
テスト完了チェックリスト
─────────────────────

全 6 シナリオ実施済み: [ ] はい / [ ] いいえ

【合格判定】
- ローカル編集が UI 上で消えない: [ ] ✓ / [ ] ✗
- Ghost save が発生しない: [ ] ✓ / [ ] ✗
- 二重保存が起きない: [ ] ✓ / [ ] ✗
- 削除/追加/編集の混在で致命的巻き戻りなし: [ ] ✓ / [ ] ✗

【最終判定】
すべての合格判定が ✓ か: [ ] はい(PASS) / [ ] いいえ(FAIL)

FAIL 項目がある場合、以下を記載：
─────────────────────
問題内容: ___________
発生シナリオ: ___________
確認ログ: ___________
推奨修正: ___________
```

---

**マニュアル終了。以上のテストを実施し、結果をレポート形式で記入してください。**
