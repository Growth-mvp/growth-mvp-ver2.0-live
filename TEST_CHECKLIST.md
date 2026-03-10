# GROWTH Phase 1 テスト実施チェックリスト
## 簡潔版 - 実施時の確認用

**テスト実施日**: ___________
**テスト実施者**: ___________
**環境**: ローカル開発環境 (http://localhost:3000)

---

## 🔧 前提条件チェック

```
[ ] NEXT_PUBLIC_DEBUG_HYDRATE=1 が有効化されている
[ ] ローカルサーバーが起動している（http://localhost:3000 にアクセス可能）
[ ] ブラウザ A (DevTools Console 開放)
[ ] ブラウザ B (DevTools Console 開放)
[ ] 同じテスト企業を両ブラウザで開いている
```

---

## Scenario 1: /cascade での同時編集（同じフィールド）

**所要時間**: 約 5 分

```
実施: [ ] 実施中 [ ] 完了 [ ] スキップ

□ Browser A: Mission フィールドに "A: [時刻]" を入力・保存
  ├─ Console に [audit][save:done] が出たか: [ ] Yes / [ ] No
  └─ revision が増えたか: [ ] Yes / [ ] No

□ Browser B: 同じ Mission フィールドに "B: [時刻]" を入力・保存
  ├─ Console に REVISION_CONFLICT ログが出たか: [ ] Yes / [ ] No
  │  └─ ログ: [strategyStore] ⚠ REVISION_CONFLICT (attempt 1/3)
  ├─ Browser B の入力が消えたか: [ ] 消えた(FAIL) / [ ] 残ってる(PASS)
  ├─ エラーメッセージが出たか: [ ] Yes / [ ] No
  │  └─ 「変更は保持されています」が含まれるか: [ ] Yes / [ ] No
  └─ 3 回のリトライが観測されたか: [ ] Yes / [ ] No

□ 最終状態確認
  ├─ Browser A を refresh
  ├─ 最終的に保存された Mission 値: ___________
  └─ A と B のどちらが保持されたか: [ ] A / [ ] B / [ ] 不明確

【結果】: [ ] PASS / [ ] FAIL / [ ] 部分成功
理由: ___________
```

---

## Scenario 2: /okr での同時編集

**所要時間**: 約 5 分

```
実施: [ ] 実施中 [ ] 完了 [ ] スキップ

□ Browser A: /okr を開き Objective を編集・保存
  └─ [audit][save:done] 確認: [ ] Yes / [ ] No

□ Browser B: 別の Objective を編集・保存
  ├─ REVISION_CONFLICT ログ: [ ] Yes / [ ] No
  ├─ 入力値消失: [ ] なし(PASS) / [ ] あり(FAIL)
  └─ 3 回リトライ: [ ] Yes / [ ] No

□ 最終状態
  ├─ Browser A の編集が残っているか: [ ] Yes / [ ] No
  ├─ Browser B の編集が残っているか: [ ] Yes / [ ] No
  └─ 両方残っているか: [ ] Yes / [ ] No / [ ] 一部

【結果】: [ ] PASS / [ ] FAIL / [ ] 部分成功
理由: ___________
```

---

## Scenario 3: 削除 vs 編集

**所要時間**: 約 5 分

```
実施: [ ] 実施中 [ ] 完了 [ ] スキップ

□ Browser A: Department または Project を削除・保存
  ├─ 削除対象: ___________
  ├─ [audit][save:done] 確認: [ ] Yes / [ ] No
  └─ Browser A から見えるか: [ ] 消えてる / [ ] 残ってる(異常)

□ Browser B: 削除対象の配下項目を編集・保存
  ├─ 編集対象: ___________
  ├─ REVISION_CONFLICT ログ: [ ] Yes / [ ] No
  ├─ Browser B の入力値消失: [ ] なし(PASS) / [ ] あり(FAIL)
  └─ UI が壊れた: [ ] なし / [ ] あり(FAIL)

□ 最終状態（Refresh 後）
  ├─ 削除対象は消えているか: [ ] Yes / [ ] No
  ├─ B が編集した項目はどこにあるか: ___________
  ├─ 予期しない位置に移動: [ ] なし(PASS) / [ ] あり(FAIL)
  └─ 削除が復活: [ ] なし(PASS) / [ ] あり(FAIL)

【結果】: [ ] PASS / [ ] FAIL / [ ] 要調査
理由: ___________
```

---

## Scenario 4: 追加 vs 編集

**所要時間**: 約 5 分

```
実施: [ ] 実施中 [ ] 完了 [ ] スキップ

□ 初期 project 数: ___________

□ Browser A: 新規 project を追加・保存
  ├─ 追加した project: ___________
  ├─ [audit][save:done] 確認: [ ] Yes / [ ] No
  └─ Browser A から見えるか: [ ] Yes / [ ] No

□ Browser B: 既存 project を編集・保存
  ├─ 編集対象: ___________
  ├─ REVISION_CONFLICT ログ: [ ] Yes / [ ] No
  ├─ 入力値消失: [ ] なし(PASS) / [ ] あり(FAIL)
  └─ 3 回リトライ: [ ] Yes / [ ] No

□ 最終状態（Refresh 後）
  ├─ 最終 project 数: ___________ (初期 + 1 のはず)
  ├─ A が追加した project が残っているか: [ ] Yes(PASS) / [ ] No(FAIL)
  ├─ B が編集した project が反映されているか: [ ] Yes / [ ] No
  └─ 両方共存しているか: [ ] Yes / [ ] No

【結果】: [ ] PASS / [ ] FAIL / [ ] 部分成功
理由: ___________
```

---

## Scenario 5: Restore 直後の Ghost Save 防止

**所要時間**: 約 3 分

```
実施: [ ] 実施中 [ ] 完了 [ ] スキップ

□ Browser A: /cascade を開く
  └─ Console をクリア

□ 画面をリロード
  └─ Console で restore ログが出るか: [ ] Yes / [ ] No

□ 何も編集せず 5 秒待機
  ├─ [AutoSave][mode] payload - SKIP: post-restore cooldown ログが出たか: [ ] Yes(PASS) / [ ] No(FAIL)
  ├─ 2 秒以内に [audit][save:start] が出たか: [ ] なし(PASS) / [ ] あり(FAIL)
  └─ revision が無駄に増えたか: [ ] いいえ(PASS) / [ ] はい(FAIL)

□ さらに 10 秒以上観察
  ├─ 不要な [audit][save:*] が出ていないか: [ ] なし(PASS) / [ ] あり(FAIL)
  └─ Console に異常エラーがないか: [ ] なし / [ ] あり

【結果】: [ ] PASS / [ ] FAIL
理由: ___________
```

---

## Scenario 6: 手動保存 vs Autosave 重複防止

**所要時間**: 約 5 分

```
実施: [ ] 実施中 [ ] 完了 [ ] スキップ

□ Browser A: /cascade を開き何か編集
  └─ Console をクリア

□ autosave 前に手動保存ボタンをクリック
  ├─ [audit][save:start] 出現: [ ] Yes / [ ] No
  ├─ [audit][save:done] 出現: [ ] Yes / [ ] No
  └─ revision が 1 増えたか: [ ] Yes / [ ] No

□ 保存完了後 2 秒間、autosave が走らないか
  ├─ [AutoSave][mode] payload - SKIP ログ: [ ] Yes(PASS) / [ ] No(FAIL)
  ├─ [audit][save:start] が出なかったか: [ ] なし(PASS) / [ ] あり(FAIL)
  └─ minIntervalMs スキップログ: [ ] 出た / [ ] 出ていない

□ 別フィールドを編集・手動保存（1.5 秒以上経過後）
  ├─ 再度 [audit][save:start] が出たか: [ ] Yes / [ ] No
  ├─ [audit][save:done] が出たか: [ ] Yes / [ ] No
  └─ revision がさらに 1 増えたか: [ ] Yes / [ ] No

□ 保存中に再度保存ボタンをクリック
  ├─ [strategyStore] already saving, set pending ログ: [ ] Yes(PASS) / [ ] No(FAIL)
  ├─ [audit][save:start] が二重に出ない: [ ] なし(PASS) / [ ] あり(FAIL)
  └─ pending 再実行後に [audit][save:start] が出たか: [ ] Yes / [ ] No

【結果】: [ ] PASS / [ ] FAIL / [ ] 部分成功
理由: ___________
```

---

## 📊 総合判定

### 合格基準チェック

```
【MUST PASS】以下がすべて満たされているか

□ ローカル編集が UI 上で消えない
  └─ Scenario 1-4 で「入力値が消えたか」が全て No

□ Ghost Save が発生しない
  └─ Scenario 5 で「[audit][save:start] が出た」が No

□ 二重保存が起きない
  └─ Scenario 6 で「二重に出ない」が Yes

□ 削除/追加/編集の混在でも致命的巻き戻りなし
  └─ Scenario 3-4 で「FAIL」がない

□ Error Message が明確
  └─ Scenario 1-2 で「変更は保持されています」が出ている
```

### 最終判定

```
【総合結果】: [ ] PASS / [ ] FAIL / [ ] 要改善

PASS: 6/6 シナリオが成功、合格基準をすべて満たす
FAIL: 1 つ以上の MUST PASS が失敗、または致命的問題がある
要改善: 部分的に問題あり、本番投入前に修正が必要

具体的な問題点（ある場合）:
─────────────────────
1. ___________
2. ___________
3. ___________

推奨修正優先度:
─────────────────────
[ ] 高 - ローカル編集の消失、二重保存など
[ ] 中 - Ghost save や UI 不具合
[ ] 低 - ログ表示や細微な タイミング問題
```

---

## 📝 追加メモ

### ログ抽出が必要な場合

```
以下のコマンドで Console ログを保存：

Chrome/Firefox:
1. DevTools → Console
2. コンソール右側の メニュー （⋮） → ログを保存
3. または Ctrl+A → コピーして テキストエディタに貼り付け
```

### 問題が見つかった場合

```
詳細ログを記録し、以下を含めて報告してください：

1. 問題が発生したシナリオ（1～6）
2. 再現手順（どのボタンを、いつクリックしたか）
3. 期待された動作
4. 実際の動作
5. Console ログ（REVISION_CONFLICT 周辺）
6. 最終的な DB 状態（何が残ったか）
```

---

**テスト完了後、各シナリオの【結果】セクションを埋めて報告してください。**
