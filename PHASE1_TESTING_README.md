# GROWTH Phase 1 実地検証 - 総合ガイド

**プロジェクト**: GROWTH Concurrent Editing Safety Enhancement - Phase 1
**実施対象**: Concurrent editing 改修（commit: ee49f83）
**検証フェーズ**: 実地テスト（ローカル環境）

---

## 📋 ドキュメント構成

本テストフェーズは、以下の 3 つのドキュメントで構成されています：

| ドキュメント | 用途 | 読者 |
|-------------|------|------|
| **TESTING_MANUAL.md** | 詳細な実施手順、準備、各シナリオの詳細 | テスト実施者（詳細を知りたい場合） |
| **TEST_CHECKLIST.md** | 簡潔なチェックリスト、確認項目 | テスト実施者（実施中、素早く確認） |
| **LOG_REFERENCE.md** | ログ詳細、トラブルシューティング | テスト実施者＆分析者 |
| **PHASE1_TESTING_README.md** | このファイル（概要、全体構成） | 全員 |

---

## 🎯 テストの目的

**Phase 1 改修（concurrent editing safety enhancement）が本番投入可能か判定する**

### 検証対象の主要機能

1. **REVISION_CONFLICT 検出と安全な回復**
   - 競合時にローカル編集が消えないか
   - 3 回のリトライと exponential backoff が機能するか
   - ユーザーへのエラーメッセージが明確か

2. **Restore/Hydrate 直後の Ghost Save 防止**
   - リロード直後に不要な保存が走らないか
   - post-restore cooldown (2 秒) が有効か

3. **手動保存と Autosave の二重保存防止**
   - _loadingSave ガードが機能するか
   - pending 再実行が適切に動作するか

4. **複合シナリオでのデータ整合性**
   - 削除と編集が混在しても事故らないか
   - 追加と編集が混在しても事故らないか

---

## 🚀 実施手順（概要）

### Step 1: 環境準備（5 分）

```bash
# ローカルサーバーが起動しているか確認
curl http://localhost:3000

# NEXT_PUBLIC_DEBUG_HYDRATE=1 が有効か確認
cat .env.local | grep NEXT_PUBLIC_DEBUG_HYDRATE
```

### Step 2: テストシナリオ実施（30～45 分）

6 つのシナリオを順に実施：
1. `/cascade` での同時編集（5 分）
2. `/okr` での同時編集（5 分）
3. 削除 vs 編集（5 分）
4. 追加 vs 編集（5 分）
5. Restore 直後の ghost save 防止（3 分）
6. 手動保存 vs autosave 重複防止（5 分）

### Step 3: 結果報告（10 分）

TEST_CHECKLIST.md に結果を記入

---

## 📖 ドキュメント使い分けガイド

### 📄 TESTING_MANUAL.md を読むべき人

```
✓ テストを始める前に全体像を把握したい
✓ 各シナリオの詳細手順を知りたい
✓ 確認ポイントの理由背景を知りたい
✓ 問題が起きた場合のトラブルシューティングを見たい

→ 最初に読むべき「バイブル」的ドキュメント
```

**読み方**:
1. 最初に「準備フェーズ」の前提条件を確認
2. 各 Scenario ごとに「テスト手順」を最後まで読む
3. 「テスト結果記入」セクションにリアルタイムで記入
4. 「問題が起きたときのトラブルシューティング」を参照

---

### ✅ TEST_CHECKLIST.md を使うべき場面

```
✓ テスト実施中、素早く確認項目を確認したい
✓ 短時間で各シナリオの合否を判定したい
✓ 後で「何をテストしたのか」を思い出したい

→ 実施中は常に手元に置いておくドキュメント
```

**使い方**:
1. TESTING_MANUAL で詳細を理解してから、本チェックリストを開く
2. 各シナリオを実施しながら、チェックボックスを埋める
3. 実施後、「【結果】: [ ] PASS / [ ] FAIL」で判定

---

### 🔍 LOG_REFERENCE.md を見るべき場合

```
✓ 「このログは何を意味しているのか」を知りたい
✓ 期待されるログが出ていないと感じた
✓ エラーログが出ているが、致命的かどうか判定したい
✓ 本番デプロイ時のログ設定を確認したい

→ トラブルシューティング＆分析用ドキュメント
```

**使い方**:
1. ファイル別ログ出力場所で該当ファイルを検索
2. ログの「出現のタイミング」と「確認ポイント」を確認
3. 自分の環境で同じログが出ているか比較

---

## ⚠️ 重要な前提条件

テスト実施前に、以下をすべて確認してください：

```
環境確認チェックリスト
─────────────────────

□ ローカル開発サーバーが起動している
  $ npm run dev  # または yarn dev

□ .env.local に NEXT_PUBLIC_DEBUG_HYDRATE=1 が設定されている
  $ grep NEXT_PUBLIC_DEBUG_HYDRATE .env.local
  NEXT_PUBLIC_DEBUG_HYDRATE=1

□ ブラウザが 2 つ以上用意できる
  推奨: Chrome + Firefox（同じブラウザだと Cookie が共有される恐れ）
  代替: Chrome 標準ウィンドウ + プライベートウィンドウ

□ DevTools Console が両ブラウザで開けている
  Chrome/Firefox: F12 → Console タブ

□ テスト用の企業 (Company) が用意されている
  両ブラウザで同じ企業を選択する予定
```

---

## 🎭 テストシナリオ概要

| # | シナリオ | ページ | 目的 | 重要度 |
|---|---------|--------|------|--------|
| 1 | /cascade 同時編集 | /cascade | REVISION_CONFLICT 検出 | ⭐⭐⭐ |
| 2 | /okr 同時編集 | /okr | 別画面での conflict 挙動 | ⭐⭐⭐ |
| 3 | 削除 vs 編集 | /cascade | データ整合性（危険度高） | ⭐⭐⭐ |
| 4 | 追加 vs 編集 | /cascade | データ整合性（追加保持） | ⭐⭐ |
| 5 | Ghost save 防止 | /cascade | Post-restore cooldown | ⭐⭐⭐ |
| 6 | 手動 vs autosave | /cascade | 二重保存防止 | ⭐⭐ |

**⭐⭐⭐ 高優先度**: テストが失敗すると本番投入不可

---

## 📊 合格基準

以下の 4 項目すべてが満たされたら **PASS**：

### 1️⃣ ローカル編集が保持される

```
Scenario 1, 2, 3, 4 で、REVISION_CONFLICT 後に入力値が消えていない
→ UI 上で「入力欄に値が残っている」ことを目視確認
```

### 2️⃣ Ghost Save が起きない

```
Scenario 5 で、Restore 直後に不要な [audit][save:start] が出ていない
→ Console ログで「2 秒以内に save が走っていない」ことを確認
```

### 3️⃣ 二重保存が起きない

```
Scenario 6 で、[audit][save:start] が期待回数（1 または 2）のみ出現
→ 保存中の再クリックが無視される
```

### 4️⃣ 致命的な巻き戻りがない

```
Scenario 3, 4 で、データが意図しない形で消えたり移動したりしていない
→ 削除が復活したり、追加が消えたりしていない
```

---

## ❌ 不合格条件（どれか 1 つに該当したら FAIL）

```
FAIL 1: Conflict 後に入力値が消える
  → ローカル編集の消失 = 致命的バグ

FAIL 2: Restore 直後に勝手に保存される
  → Ghost save = デバッグが困難になり本番危険

FAIL 3: 同一ユーザー内で意図しない二重保存
  → duplicate revision = データ整合性の低下

FAIL 4: 削除が復活、または追加が消える
  → Full replace 構造の致命的欠陥
```

---

## 📝 テスト後の報告方法

### 簡潔版（推奨）

```markdown
# Phase 1 テスト結果報告

## 総合判定
[ ] PASS / [ ] FAIL / [ ] 要改善

## 実施シナリオ
- Scenario 1: [ ] PASS / [ ] FAIL
- Scenario 2: [ ] PASS / [ ] FAIL
- Scenario 3: [ ] PASS / [ ] FAIL
- Scenario 4: [ ] PASS / [ ] FAIL
- Scenario 5: [ ] PASS / [ ] FAIL
- Scenario 6: [ ] PASS / [ ] FAIL

## 問題点（ある場合）
1. [シナリオ番号] - 具体的な問題内容
2. [ログ抜粋]
3. [再現手順]

## 追加メモ
```

### 詳細版

TEST_CHECKLIST.md の「【結果】」セクションをすべて埋める

---

## 🛠️ トラブルシューティング（よくある問題）

### ❓ Q: Console に REVISION_CONFLICT ログが出ない

**A**: 以下を確認してください

1. **Scenario 1-4 なら「同じフィールド」を編集しているか**
   - 異なるフィールドなら conflict が起きないことがある
   - 同じ項目（例：Mission）を両ブラウザで編集してください

2. **保存順序が A → B → 保存 の順になっているか**
   - A が保存 → B が保存の順序でないと conflict が起きません

3. **revision が同じままになっていないか**
   - Browser A が保存直後に revision が増えるはず
   - 増えていなければ A の保存が成功していない

### ❓ Q: UI 上で入力値が消えてしまった

**A**: FAIL の可能性が高いです

1. **console ログで「wasDirty」が false になっていないか確認**
   - dirty=false なら refetch でフル置換されてしまう

2. **extractServerDecidedPatch が user-editable フィールドを削除していないか**
   - LOG_REFERENCE.md で該当ログを確認

3. **refetch 後に state を確認**
   ```javascript
   const store = useStrategyStore.getState();
   console.log(store.mission);  // 消えていないか
   ```

### ❓ Q: Ghost save（restore 直後の無駄保存）が起きてしまった

**A**: Post-restore cooldown が機能していません

1. **lastServerSyncAt が設定されているか確認**
   ```javascript
   const store = useStrategyStore.getState();
   console.log('lastServerSyncAt:', store.lastServerSyncAt);
   ```

2. **post-restore cooldown ログが出ているか確認**
   - Console で `[AutoSave][mode] payload - SKIP: post-restore cooldown` を検索

3. **strategyStore.ts:3529 で lastServerSyncAt が設定されているか確認**

---

## 📞 サポート情報

### テスト中に問題が発生した場合

```
1. LOG_REFERENCE.md でログを確認
2. TEST_CHECKLIST.md の対応シナリオで「問題があったか」にチェック
3. 詳細ログを以下の形式で保存：
   - Console ログをテキストエディタにコピー
   - ログファイル名: growth-phase1-test-logs-[日付].txt
4. テスト結果レポートと共にログを提供
```

### テスト後の質問・相談

```
以下のいずれかの形式で報告してください：

【シンプル】
- テストした日時
- 成功/失敗
- 失敗した場合はシナリオ番号と簡潔な説明

【詳細】
- TEST_CHECKLIST.md をすべて埋めたもの
- 関連 Console ログ（テキストファイル）
- 再現手順（箇条書き）
```

---

## 📅 テスト実施予定

```
推奨スケジュール
─────────────────────

【第 1 日】（45 分）
- Scenario 1-4 を実施（環境準備含め 45 分）

【第 2 日】（15 分）
- Scenario 5-6 を実施（15 分）

【第 3 日】（30 分）
- 問題があれば追加検証
- 結果報告書作成
```

---

## ✨ テスト実施のコツ

### 1. Console は常に開いておく

```
ブラウザ B は特に重要：
- F12 で DevTools を開く
- Console タブを選択
- 保存ボタンクリック直後に Console をチェック
```

### 2. ログの時刻を注視する

```
Scenario 6 で重要：
- Console 右下 Settings で「メッセージのタイムスタンプを表示」
- [audit][save:start] と [audit][save:done] の時刻差を見る
```

### 3. Refresh は意図的に

```
Scenario 3-4-5 で重要：
- 最終状態を確認する前に「意図的に Refresh」してから見る
- これで「UI だけ」と「実際の DB」のズレを検出できる
```

### 4. スクリーンショットを残す

```
以下の場合、スクリーンショットを保存：
- REVISION_CONFLICT エラーメッセージが出たとき
- 入力値が消えた場合
- 予期しない UI になったとき
```

---

## 🎉 次のステップ

### PASS した場合

```
→ Phase 1 改修は本番投入可能（要所有者確認）
→ デプロイ準備を開始
→ ステージング環境での追加検証も推奨
```

### FAIL した場合

```
→ 問題点を詳細に分析
→ ログをもとに修正パッチを作成
→ Phase 1.5 または Phase 2 として修正スプリント
→ 修正後、再テスト実施
```

---

## 📚 参考資料

- **実装コミット**: `ee49f83`
- **実装計画**: GROWTH Phase 1 Implementation Plan
- **設計ドキュメント**: Architecture Decision Record (ADR)

---

**テスト開始前に、このドキュメントを読み終えてください。質問があれば、進める前に確認してください。**

**頑張ってください！🚀**
