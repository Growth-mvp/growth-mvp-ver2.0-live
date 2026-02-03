# 監査ログ検証：典型事故パターンの追跡可能性（TASK 4）

## ゴール
以下の「典型的な保存/復元事故」がログで追跡できるか確認し、追跡不可な事故がないかチェック。

---

## 典型事故パターン 1: restore 直後に古い store が save を上書きで走る

### 事故シナリオ
```
Timeline:
1. 09:00:00 DB に strategy (id=abc, rev=1, mvv='DB値')を保存
2. 09:00:01 restoreWithAudit('stage2', companyId)
   → DB データ取得、sourceUsed=db → [audit][restore:decision]
3. 09:00:02 （同じ時間にローカルstoreの古い state が save を発火）
   → [audit][save:start] caller=??? で古い revision で保存
4. 結果: DB の rev=2 が上書きで rev=1 に戻される
```

### ログで追跡可能か？
✅ **追跡可能**

- `[audit][restore:decision] sourceUsed=db revision=1` で DB を選んだことが記録
- その直後に `[audit][save:start] caller=... revisionBefore=1 revisionAfter=?` が出現
- duration が近い場合は「restore 直後の上書き save」として認識可能
- **ただし**: ページ内のローカル state（store外）が古い場合、caller が不明確になる可能性

### 改善案
caller を「ページ側のどのタイミング」で save が走ったのか特定しやすく：
- `caller: 'stage2:autoSave:afterRestore'` のような形で明示的に mark する
- useEffect内での自動保存時に「restore 直後」フラグを付ける

---

## 典型事故パターン 2: companyId 一時未確定で snapshot 判定が暴発し、誤クリア/誤適用

### 事故シナリオ
```
Timeline:
1. 08:59:00 ユーザーが company-A に所属
2. 09:00:00 company-A の STAGE2 snapshot を保存
3. 09:00:10 company-B に switch（一時的に companyId=undefined）
4. 09:00:11 restoreWithAudit('stage2', undefined) が呼ばれる
   場合 A（改善前）: snapshot を誤判定（company-A 用 snapshot が残っている）
   場合 B（改善後）: companyId が undefined なら snapshot 判定を skip
```

### ログで追跡可能か？
✅ **改善後は追跡可能（改善前は不可）**

改善後のログ（restoreWithAudit 実装）：
```
[audit][restore:start] stage=stage2 effectiveCompanyId=undefined
[audit][restore:decision] sourceUsed=none reason="companyId_not_ready"
```

→ companyId が undefined のまま restore が defer された（snapshot 判定なし）

改善前は「snapshot がクリアされた」というログもなく、暗黙的に skip される。

### 検証結果
✅ **改善済み**: restoreWithAudit の Check 1 で `if (!effectiveCompanyId)` 実装済み

---

## 典型事故パターン 3: strategy_data 以外が関係して「見た目だけ消える」

### 事故シナリオ
```
事故: story_answers2 / final_stories が DB に保存されず、
     strategy_data だけが保存された場合

Timeline:
1. 09:00:00 saveWithAudit(payload) が called
2. saveWithAudit → saveStrategyData(payload)
   ただし saveStrategyData は strategy_data テーブルにのみ保存
   （story_answers2, final_stories は別途保存ロジックが必要）
3. 結果: strategy_data は最新だが、answers2 は古いまま
   → UI には「全部消えた」ように見える
```

### ログで追跡可能か？
⚠️ **部分的に追跡可能**

- `[audit][save:done] payloadSize=XXXXX revision=before/after` で payload サイズは記録
- ただし「どのフィールドが実は保存されなかったか」は記録していない

### 改善案
saveWithAudit の監査ログに以下を追加：
```typescript
console.log('[audit][save:done]', {
  ...existing,
  // 新規: どのフィールドが payload に含まれていたか
  hasStoryAnswers2: Array.isArray(payload.answers2),
  hasFinalStory: Array.isArray(payload.finalStory),
  hasProgress: Array.isArray(payload.progressLogs),
  // 新規: 期待される外部テーブル保存の hint
  relatedTablesSaved: ['strategy_data'], // story_answers2, final_stories等は別途？
});
```

### 検証結果
⚠️ **改善候補**: TASK 4 の実装で詳細ログを追加できます。

---

## 典型事故パターン 4: revision が restore 経由で巻き戻る、または setRevision 同期漏れ

### 事故シナリオ
```
Timeline:
1. 09:00:00 DB: strategy (id=abc, rev=5)
2. 09:00:01 restoreWithAudit('stage2', companyId)
   → DB からロード、sourceUsed=db, revision=5
3. 09:00:02 store に restore が行われるが、
   revision を sync し忘れる
4. 09:00:03 UI 側で store.revision = 3（古い値）のまま save
   → setRevision が呼ばれず、REVISION_CONFLICT
```

### ログで追跡可能か？
✅ **追跡可能（前コミット で既に修正済み）**

- `[audit][restore:done] strategyId=abc revision=5` で DB revision を記録
- その直後に `[audit][save:start] caller=... revisionBefore=3` が出現
  → revision ずれが一目でわかる

### 検証結果
✅ **既に対策済み**: recent commit で setRevision 後に store.revision を同期している

---

## 典型事故パターン 5: snapshot から hydrate した後に、古い snapshot が「再度」適用される

### 事故シナリオ
```
Timeline:
1. 09:00:00 snapshot から restore → [audit][restore:done] sourceUsed=snapshot
2. 09:00:01 ユーザーが data 編集
3. 09:00:02 store.revision が更新される
4. 09:00:10 （何かのタイミングで） restoreStage2Snapshot() が再度呼ばれる
   → 古い snapshot がもう一度適用される
   （ユーザーの編集が消える）
```

### ログで追跡可能か？
✅ **追跡可能（但し didInitRef.current 保護がある）**

- `[audit][restore:start]` が複数回出現
- `didInitRef.current` で「初回だけ」と制限済み
- 2回目以降の restoreStage2Snapshot() の呼び出しはログに出ない
  （早期 return で useEffect 内で 1回だけ）

### 検証結果
✅ **既に対策済み**: `didInitRef.current` で 1回限定

---

## 検証チェックリスト

### 保存側（saveWithAudit）
- [x] caller が記録される → restore/save 順序が追跡できる
- [x] effectiveCompanyId が記録される → 企業ズレが検出できる
- [x] revision (before/after) が記録される → revision 巻き戻りが検出できる
- [x] payloadSize が記録される → 空の保存/部分保存が検出できる
- [x] duration が記録される → 保存時間異常が検出できる
- [x] error が記録される → 保存失敗が記録される
- [ ] **改善候補**: payload に含まれる field 一覧（answers2, final_stories等）を記録

### 復元側（restoreWithAudit）
- [x] companyId 未確定時は snapshot 判定をしない（Check 1）
- [x] snapshot/DB の companyId ずれを検出 → clear with reason（Check 2）
- [x] DB に確定データがあれば snapshot 不使用（Check 3）
- [x] 採用ソース と理由をログ出し
- [x] didClearSnapshot フラグで snapshot 削除を追跡
- [ ] **改善候補**: DB vs store vs snapshot の data size を比較ログ

### STAGE2 の統合
- [x] restoreWithAudit の結果で hydration を分岐
- [x] restore 再実行を didInitRef で防止
- [x] async restore の error 処理

---

## ログ出力サンプル

### Case 1: DB 優先で restore（成功パターン）
```
[audit][restore:start] stage=stage2 effectiveCompanyId=12345
  timestamp=2026-02-03T10:00:00Z allowSnapshot=true

[audit][restore:decision] sourceUsed=db reason="db_has_mvv" dbRevision=5 strategyId=uuid-abc

[Stage2] using DB source, hydration deferred to caller
```

### Case 2: snapshot から fallback（空のDB パターン）
```
[audit][restore:start] stage=stage2 effectiveCompanyId=12345
  timestamp=2026-02-03T10:00:00Z allowSnapshot=true

[audit][restore:decision] sourceUsed=snapshot reason="db_and_store_empty_fallback"

[Stage2] restoring from snapshot...
[Stage2] snapshot restored successfully

[audit][restore:done] sourceUsed=snapshot strategyId=uuid-snap
```

### Case 3: snapshot 会社ずれで削除
```
[audit][restore:start] stage=stage2 effectiveCompanyId=12345
  timestamp=2026-02-03T10:00:00Z allowSnapshot=true

[audit][restore:decision] sourceUsed=none reason="snapshot_company_mismatch"
  snapshotCompanyId=99999 effectiveCompanyId=12345

[audit][restore:decision] didClearSnapshot=true reason="mismatch"
```

### Case 4: 保存→復元の逆転タイミング検出
```
[audit][restore:decision] sourceUsed=db revision=5
...delay...
[audit][save:start] caller=stage2:autoSave revisionBefore=3 revisionAfter=?
  → revision mismatch detected! (DB=5 but save sent 3)
```

---

## 結論

✅ **以下は追跡可能**:
1. restore 直後の save 上書き（caller とタイムスタンプから）
2. companyId ずれによる誤クリア（Check 2 ログ）
3. revision 巻き戻り（before/after ログ）
4. snapshot 再実行による誤適用（didInitRef 保護＆ log）

⚠️ **以下は改善候補**:
1. story_answers2 / final_stories 等の「外部テーブル保存」の成否
2. snapshot vs store vs DB のデータサイズ比較
3. 「restore 直後」という意図を caller に明示的に mark

---

## TASK 4 実装内容

1. ✅ restoreWithAudit 実装（監査ログ統一）
2. ✅ saveWithAudit 実装（caller + 詳細ログ）
3. ✅ STAGE2 で restoreWithAudit 統合
4. ✅ このドキュメント（典型パターン検証）

**追加実装**（必要に応じて）:
- [ ] saveWithAudit に「payload field 一覧」ログを追加
- [ ] restoreWithAudit に「data size 比較」ログを追加
- [ ] STAGE2 save 時に「restore 直後」フラグを caller に付与
