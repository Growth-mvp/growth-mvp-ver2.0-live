# STAGE4/STAGE5 保存不具合 調査・修正レポート

## 不具合概要

**STAGE4/STAGE5** の保存機能に以下の障害が発生していました：

- **STAGE5**: 実績ログ（progress_log）と戦略データ（strategy_data）の同期が失敗し、保存結果がユーザーに正しく反映されていない
- **STAGE4**: 部門・プロジェクトデータの復元時に整合性の問題が発生していた

## STAGE4 の原因と修正概要

### 原因
- STAGE3 で再生成されたプロジェクトデータと STAGE4 で編集されたプラン間に整合性がなくなる可能性があった

### 修正内容
- **ハッシュベース検知**: Department の構成（id, name, projects, KPI count）から hash を計算し、STAGE3 再生成を自動検知
- **自動 baseline 再初期化**: hash が変わった場合、baseline を再初期化して編集状態をリセット
- **Orphan 計画削除**: 削除された部門に紐づく計画を自動削除

### 修正ファイル
- `app/stage4/page.tsx`: STAGE4 コンポーネント本体

### 関連ドキュメント
- `stage4/MODIFICATION_SUMMARY_STAGE4_SAVE_FIX.md`: 修正内容の詳細まとめ

---

## STAGE5 の原因と修正概要

### 根本原因
**`restoreReady` フラグの不適切な制御**
- `setCompanyScope` の呼び出しによって `restoreReady` が無意識にリセットされ、保存チェックが失敗していた
- 複数の effect が競合し、restore 状態が不安定になっていた

### 修正内容
1. **setCompanyScope 呼び出し制御**: 同じ company ID の場合は `setCompanyScope` を呼ばない
2. **restore_ready ガード**: 保存前に `restoreReady`, `__isFetchingFromServer`, `boot.isHydrating` をチェック
3. **saveStrategyData 戻り値確認**: 保存結果の `ok` フラグで成否を判定
4. **Effect-1 スコープ制御**: Company scope を適切に管理（同一会社時はスキップ）
5. **Effect-2 ハイドレーション制御**: ハイドレーション完了条件を明確化

### 修正ファイル
- `app/execution/page.tsx`: STAGE5 実績ログ画面本体
- `hooks/useAutoSave.ts`: 自動保存ロジック（restore_ready チェック強化）
- `store/strategyStore.ts`: store アクション（サマリー文字列のキャッシング など）

### 関連ドキュメント
- `INVESTIGATION_REPORT_STAGE4_STAGE5_SAVE_FAILURE.md`: 全体的な不具合分析（メインレポート）
- `stage5/INVESTIGATION_STAGE5_SAVE_BLOCK_ROOT_CAUSE.md`: STAGE5 restore_ready 問題の詳細
- `stage5/STAGE5_MODIFICATION_IMPLEMENTATION.md`: 実装内容の詳細
- `stage5/STAGE5_LIFECYCLE_TIMELINE_ANALYSIS.md`: Effect ライフサイクルの分析
- `stage5/STAGE5_LIFECYCLE_FIX_IMPLEMENTATION.md`: Effect 修正の詳細
- `stage5/STAGE5_FIX_FINAL_VERIFICATION.md`: 最終検証内容
- `stage5/FORCE_PARAMETER_DETAILED_ANALYSIS.md`: force パラメータの詳細分析
- `stage5/FINAL_MODIFICATION_STRATEGY_STAGE5.md`: 修正戦略の最終版
- `stage5/DIRTY_FLAG_INVESTIGATION.md`: dirty フラグの動作検証
- `stage5/MODIFICATION_PLAN1_SAVERESULT_CHECK.md`: 保存結果チェックの修正計画
- `stage5/RESTORE_NOT_READY_ROOT_CAUSE_INVESTIGATION.md`: restore_not_ready 調査報告
- `stage5/DEBUG_LOG_IMPLEMENTATION_AND_ANALYSIS.md`: デバッグログの実装内容

---

## ドキュメント構成

### ルートレベル
- **INVESTIGATION_REPORT_STAGE4_STAGE5_SAVE_FAILURE.md**: 全体的な不具合分析とレポート（主要ドキュメント）

### stage4/
- **MODIFICATION_SUMMARY_STAGE4_SAVE_FIX.md**: STAGE4 修正内容のまとめ

### stage5/
- **INVESTIGATION_STAGE5_SAVE_BLOCK_ROOT_CAUSE.md**: STAGE5 restore_ready 問題の根本原因分析
- **STAGE5_MODIFICATION_IMPLEMENTATION.md**: STAGE5 実装内容の詳細
- **STAGE5_LIFECYCLE_TIMELINE_ANALYSIS.md**: Effect の実行順序とタイミング分析
- **STAGE5_LIFECYCLE_FIX_IMPLEMENTATION.md**: Effect ライフサイクル修正の詳細
- **STAGE5_FIX_FINAL_VERIFICATION.md**: 最終的な修正内容の検証
- **FORCE_PARAMETER_DETAILED_ANALYSIS.md**: force パラメータの詳細分析
- **FINAL_MODIFICATION_STRATEGY_STAGE5.md**: 修正戦略の最終版
- **DIRTY_FLAG_INVESTIGATION.md**: dirty フラグの動作メカニズム検証
- **MODIFICATION_PLAN1_SAVERESULT_CHECK.md**: 保存結果チェック機能の修正計画
- **RESTORE_NOT_READY_ROOT_CAUSE_INVESTIGATION.md**: restore_not_ready 状態の根本原因調査
- **DEBUG_LOG_IMPLEMENTATION_AND_ANALYSIS.md**: デバッグログの実装と動作分析

---

## 修正完了の確認

- [x] STAGE4 実装確認（テスト完了）
- [x] STAGE5 実装確認（実機確認完了）
- [x] デバッグログ整理（優先ログ削除、DEBUG 限定化）
- [x] ドキュメント整理（docs 配下に移動）

---

## 参考資料

修正の詳細については、上記のドキュメント一覧を参照してください。
特に **INVESTIGATION_REPORT_STAGE4_STAGE5_SAVE_FAILURE.md** が全体的な文脈を提供します。
