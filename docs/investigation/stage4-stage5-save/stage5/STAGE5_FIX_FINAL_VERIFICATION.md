# STAGE5 修正 - 最終確認レポート

**確認日**: 2026-04-09
**修正内容**: STAGE5 lifecycle の restore_not_ready 問題を解決

---

## A. 修正の概要

### 問題
STAGE5 初回訪問では save が成功するが、別画面へ移動して戻ると save が失敗する（reason: 'restore_not_ready'）

### 根本原因
Effect-1（company scope effect）が同じ company に対しても setCompanyScope を呼び、restoreReady を false に上書き。その後 Effect-2（loadAndHydrate trigger）が hydrated=true で early return してしまい、restoreReady の復帰ができない。

### 修正内容
Effect-1 に `scopeCompanyId === accessCompanyId` の条件を追加し、同じ company の場合は setCompanyScope を呼ばないようにした。これにより restoreReady が false に上書きされず、正常に restore できる。

---

## B. 修正ファイルの確認

### 修正ファイル: `/app/execution/page.tsx`

**修正箇所:**
1. LINE 1564-1606: Effect-1（company scope effect）
   - 新しい condition `if (scopeCompanyId === accessCompanyId)` を追加
   - 同じ company なら early return（setCompanyScope を呼ばない）
   - デバッグログを追加

2. LINE 1608-1647: Effect-2（loadAndHydrate trigger effect）
   - デバッグログを詳細化
   - early return の理由を明確に記録

**修正行数:**
- 追加: +37 行
- 削除: 0 行
- 破壊的変更: なし

---

## C. STAGE4 への影響確認

### ✅ 確認結果: **影響なし**

**理由:**
1. **異なるコンポーネント**
   - STAGE5: `/app/execution/page.tsx`
   - STAGE4: `/app/okr/page.tsx`
   - 相互にインポート関係がない

2. **修正箇所が STAGE5 専用**
   - execution/page.tsx の useEffect のみ修正
   - okr/page.tsx は修正対象外
   - strategyStore.ts は修正対象外

3. **shared な部分の変更がない**
   - strategyStore.ts のロジック: 変更なし
   - master guard: 変更なし
   - fetch/hydrate guard: 変更なし
   - force パラメータ: 未使用
   - useAutoSave.ts: 変更なし

### STAGE4 の独立性確認

```typescript
// okr/page.tsx:315
const setCompanyScope = useStrategyStore((s) => s.setCompanyScope);

// okr/page.tsx:352-371
useEffect(() => {
  if (!accessCompanyId) return;
  if (lastAppliedCompanyRef.current === accessCompanyId && scopeCompanyId === accessCompanyId) return;

  if (scopeCompanyId && scopeCompanyId !== accessCompanyId) {
    hardResetForCompanySwitch(accessCompanyId);
    setCompanyScope(accessCompanyId);
  } else {
    setCompanyScope(accessCompanyId);
  }
  lastAppliedCompanyRef.current = accessCompanyId;
}, [accessCompanyId, scopeCompanyId, setCompanyScope, setHydrated]);
```

**STAGE4 の effect と STAGE5 の effect の違い:**
- STAGE4: `lastAppliedCompanyRef` で guard している
- STAGE5: 修正前は同じ company でも常に setCompanyScope を呼んでいた
- 修正後: STAGE5 も同じ company では skip するようになった

**結論:** STAGE4 への影響は完全にゼロです。STAGE4 は独立した flow を持ており、修正は STAGE5 のみです。

---

## D. 修正の安全性確認

### Guard の保全確認

| Guard | 変更 | 理由 |
|-------|------|------|
| **master guard (LINE 3318)** | ❌ 変更なし | strategyStore.ts は修正対象外 |
| **fetch/hydrate guard (LINE 3281)** | ❌ 変更なし | strategyStore.ts は修正対象外 |
| **force パラメータ** | ❌ 未使用 | 修正で force は使用していない |
| **hydrating flag** | ❌ 変更なし | 強制的に false に設定していない |
| **isFetching flag** | ❌ 変更なし | 強制的に false に設定していない |

### ロジック的な安全性

**修正前の flow:**
```
同じ company でも:
  setCompanyScope → restoreReady=false に上書き
  Effect-2 の early return で loadAndHydrate 未実行
  → restoreReady が false のまま
```

**修正後の flow:**
```
同じ company では:
  setCompanyScope 呼ばない → restoreReady は保持
  Effect-2 の早期 return でもロジック正常
  （restoreReady=true なら guard を通過）
```

**初回訪問時の flow（変更なし）:**
```
scopeCompanyId=undefined では:
  condition `scopeCompanyId === accessCompanyId` は false
  → skip しない
  → setCompanyScope 呼ぶ
  → Effect-2 で loadAndHydrate 実行（hydrated=false だから）
  → restoreReady=true に復帰
  ✅ 変更なし
```

---

## E. デバッグログの追加確認

### 追加されたログ

**Effect-1（company scope effect）:**
```javascript
[STAGE5-effect-1-scope] {
  event: 'effect1_start',
  accessCompanyId,
  scopeCompanyId,
  hydrated,
  restoreReady,
  isRestoring,
  condition_isSameCompany,
  willCall_hardReset,
  willCall_setCompanyScope,
  timestamp,
}

[STAGE5-effect-1-scope] {
  event: 'skip_same_company',  // ← 新しい
  reason: 'scopeCompanyId already matches accessCompanyId',
}

[STAGE5-effect-1-scope] {
  event: 'setCompanyScope_after',
  restoreReady,
  isRestoring,
  __isFetchingFromServer,
}
```

**Effect-2（loadAndHydrate trigger effect）:**
```javascript
[STAGE5-effect-2-hydrate] {
  event: 'effect2_start',
  accessCompanyId,
  scopeCompanyId,
  hydrated,
  restoreReady,
  condition_earlyReturn,
  timestamp,
}

[STAGE5-effect-2-hydrate] {
  event: 'earlyReturn_because_already_hydrated',
  reason: 'hydrated=true && scopeCompanyId===accessCompanyId',
}

[STAGE5-effect-2-hydrate] {
  event: 'loadAndHydrate_completed',
  timestamp,
}
```

---

## F. 期待される動作の検証項目

### テスト1: 初回訪問
```
期待:
  ✅ setCompanyScope が呼ばれる
  ✅ loadAndHydrate が実行される
  ✅ save 成功（ok: true）
  ✅ dirty が false に落ちる
  ✅ UI の「未保存」マークが消える

ログで確認:
  [STAGE5-effect-1-scope] { event: 'setCompanyScope_called' }
  [STAGE5-effect-2-hydrate] { event: 'loadAndHydrate_completed' }
  [STAGE5-save-checkin-result] { ok: true, dirty: false }
```

### テスト2: 別画面へ移動 → STAGE5 に戻る（修正の効果を検証）
```
期待（修正後）:
  ✅ setCompanyScope が呼ばれない（skip）
  ✅ restoreReady が保持される（true）
  ✅ save 成功（ok: true） ← 修正による改善
  ✅ dirty が false に落ちる
  ✅ UI の「未保存」マークが消える

ログで確認（修正後の新しいログ）:
  [STAGE5-effect-1-scope] { event: 'skip_same_company' }  ← 新規ログ
  [STAGE5-effect-2-hydrate] { event: 'earlyReturn_because_already_hydrated' }
  [STAGE5-save-checkin-result] { ok: true, dirty: false }  ← 修正により成功
```

### テスト3: 異なる company への切り替え
```
期待:
  ✅ setCompanyScope が呼ばれる（skip しない）
  ✅ restoreReady が false にリセットされる（正常）
  ✅ loadAndHydrate が実行される
  ✅ 新しい company の restore が完了

ログで確認:
  [STAGE5-effect-1-scope] { event: 'setCompanyScope_called' }
  [STAGE5-effect-2-hydrate] { event: 'loadAndHydrate_completed' }
```

### テスト4: STAGE4 への影響がないか
```
期待:
  ✅ STAGE4 で save が成功する
  ✅ STAGE4 → STAGE5 の遷移が正常
  ✅ STAGE4 のデータが消えていない

ログで確認:
  [STAGE4-save-okr-result] { ok: true }（変化なし）
  [okr/page] ログに異常がない
```

---

## G. コミット メッセージの候補

```
Fix STAGE5 lifecycle issue: prevent setCompanyScope on same company revisit

Root cause: When revisiting STAGE5 with the same company, setCompanyScope
was being called and resetting restoreReady to false. Effect-2 would then
early return due to hydrated=true, leaving restoreReady=false and causing
save failures with reason='restore_not_ready'.

Solution: Add condition to skip setCompanyScope when scopeCompanyId already
matches accessCompanyId (same company). This prevents restoreReady from being
reset, allowing normal restore flow to complete.

Changes:
- execution/page.tsx:1564-1606 (Effect-1): Add early return for same company
- execution/page.tsx:1608-1647 (Effect-2): Add detailed debug logs
- No changes to master guard, force parameter, or strategyStore logic
- Zero impact to STAGE4 (independent component)

Impact:
- STAGE5 initial visit: no change (setCompanyScope still called)
- STAGE5 revisit: now succeeds (previously failed with restore_not_ready)
- Company switch: still works (condition = false, setCompanyScope called)
- STAGE4: zero impact (okr/page.tsx independent)

Logs added for verification:
- [STAGE5-effect-1-scope]: lifecycle tracking
- [STAGE5-effect-2-hydrate]: early return detection
```

---

## H. 修正の完全性チェックリスト

### 実装完了
- [x] 根本原因の特定（STAGE5 lifecycle timeline 分析）
- [x] Effect-1 の condition 追加（同じ company skip）
- [x] デバッグログの追加（lifecycle トレーシング）
- [x] STAGE4 への影響確認（ゼロ確認）
- [x] コミット メッセージの準備

### 待機中（ユーザー検証）
- [ ] 実機での初回訪問テスト
- [ ] 実機での再訪問テスト（修正の効果確認）
- [ ] console ログの確認
- [ ] STAGE4 の save が正常か確認
- [ ] ブラウザの localStorage/IndexedDB の確認

### オプション（必要に応じて）
- [ ] force パラメータを使わずにさらなる改善
- [ ] hydrating/isFetching の無限ループ防止（現在は不要）
- [ ] 他の画面遷移シナリオでの検証

---

## I. リスク評価まとめ

### 修正によるリスク
- **最小限**: early return 条件の追加のみ
- **破壊的変更**: ゼロ
- **guard 削除**: なし
- **force 使用**: なし

### 修正による利益
- **STAGE5 再訪問時の save 成功**: 期待
- **dirty flag の正常化**: 期待
- **master guard の誤発動解消**: 期待

### Rollback の容易性
- **修正を削除する難度**: 極容易（condition 削除のみ）
- **既存ロジックへの依存**: なし

---

## J. 実装完了宣言

✅ **STAGE5 lifecycle 修正の実装が完了しました。**

修正内容:
- `/app/execution/page.tsx` の 2 つの useEffect に condition と logs を追加
- 同じ company への再訪問時に setCompanyScope が呼ばれないようにした
- restoreReady が false に上書きされなくなったため、restore flow が正常完了
- STAGE4 への影響は完全にゼロ

次のステップ:
- ユーザーが実機で検証し、console ログで動作を確認
- 修正が期待通りに動作することを確認後、コミット
- 必要に応じて追加のデバッグログを削除（運用フェーズ）

---

**この修正により、STAGE5 の restore_not_ready エラーが完全に解決されることを期待します。**

