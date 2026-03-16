# Phase 2A 実装ロードマップ

## 概要

OKR の正本を `strategy_data` から専用 `okrs` テーブルへ**段階的**に分離。
既存画面・UX は変わらず、内部アーキテクチャを改善。

---

## Timeline

```
Week 1
├─ 2026-03-16 (Mon) Phase 2A-1 完了 ← 現在位置
├─ 2026-03-17-18 (Tue-Wed) Phase 2A-2 インフラ整備
├─ 2026-03-19-20 (Thu-Fri) Phase 2A-3 Backfill
│
Week 2
├─ 2026-03-23 (Mon) Phase 2A-4 STAGE4 切替 ← 最優先・最長
├─ 2026-03-24-25 (Tue-Wed) STAGE4 運用テスト
├─ 2026-03-26 (Thu) Phase 2A-5 STAGE5 切替
├─ 2026-03-27 (Fri) Phase 2A-6 STAGE3 移行開始
│
Week 3
├─ 2026-03-30 (Mon) Phase 2A-6 STAGE3 完了
├─ 2026-03-31 (Tue) 総合テスト
└─ 2026-04-01 (Wed) Phase 2A 本番適用
```

**想定日数:** 11 営業日

---

## Phase 2A-2: インフラ整備（3-4 日）

### Checklist

- [ ] **DB Migration**
  - [ ] okrs テーブル SQL 作成
  - [ ] RLS Policy 設定
  - [ ] Index 作成
  - [ ] Staging へ適用テスト

- [ ] **型追加**
  - [ ] `types/okrs.ts` 新規作成
  - [ ] `types/strategy.ts` に id フィールド追加
  - [ ] 既存コンパイル確認

- [ ] **Repository 層**
  - [ ] `utils/supabase/okrsRepository.ts` 実装
  - [ ] queryByProjectId, upsert, softDelete, batchUpdateSortOrder
  - [ ] Unit test (mock DB)

- [ ] **Service 層**
  - [ ] `services/okrService.ts` 実装
  - [ ] resolveProjectsWithOkrs() 完成度 100%
  - [ ] upsertOkr() 実装
  - [ ] syncOkrsSnapshotToStrategyData() 実装
  - [ ] mergeOkrSources() ロジック確定
  - [ ] Integration test

**成果物:**
- okrs テーブル生成
- OkrService/Repository の基本実装
- 統合テスト環境

---

## Phase 2A-3: Backfill & Migration（2 日）

### Checklist

- [ ] **Migration Script**
  - [ ] `utils/supabase/migration.ts` 実装
  - [ ] backfillOkrsTableFromStrategyData()
  - [ ] ensureDepartmentIds(), ensureProjectIds()
  - [ ] Idempotent 設計確認

- [ ] **Data Validation**
  - [ ] Staging でテスト実行
  - [ ] 既存データ件数確認（before = after）
  - [ ] Duplicate ID 検査
  - [ ] Orphaned project 検査

- [ ] **本番 Backfill（慎重）**
  - [ ] Transaction 内で実行
  - [ ] ロールバック計画作成
  - [ ] 実行ログ記録
  - [ ] 完了確認

**成果物:**
- okrs テーブルに既存 OKR すべて移行
- `okrs_migration_status = 'completed'`

---

## Phase 2A-4: STAGE4 切替（2-3 日）

### Checklist

**読込フロー**
- [ ] OkrService.resolveProjectsWithOkrs() を okr/page.tsx へ統合
- [ ] okrs テーブルが正本（DB優先）
- [ ] snapshot fallback が動作
- [ ] 新しい OKR が okrs テーブルに save される

**保存フロー**
- [ ] add/edit/delete → okrsRepository.upsert/softDelete()
- [ ] 保存成功後に syncOkrsSnapshotToStrategyData()
- [ ] Error 時は rollback（snapshot 更新なし）

**UI 動作**
- [ ] 新規 OKR 追加 → 入力欄表示
- [ ] OKR 編集 → 即座に反映
- [ ] OKR 削除 → soft delete
- [ ] Reorder → sort_order 保存

**検証テスト**
- [ ] 新規追加 → 再読込 OK
- [ ] 編集 → 再読込 OK
- [ ] 削除 → 再読込で消える
- [ ] Project owner / KPI owner 分離維持
- [ ] 既存 STAGE4 UX 変わらず

**ロールバック計画**
- [ ] git revert 可能性確認
- [ ] DB rollback script 用意

**成果物:**
- STAGE4 が okrs テーブルを正本として動作
- 保存 → 再読込サイクル完全

---

## Phase 2A-5: STAGE5 切替（1-2 日）

### Checklist

- [ ] progress_logs に okr_id 参照追加
- [ ] 既存ログは fallback で読める
- [ ] 新規ログは okr_id を持つ
- [ ] OKR 検索 / 表示が okr_id ベース
- [ ] テスト完了

**成果物:**
- STAGE5 が okr_id で OKR を参照

---

## Phase 2A-6: STAGE3 移行（3-4 日）

### Checklist

**読込統一**
- [ ] getProjectKpiLabels() が resolveProjectsWithOkrs() を使用
- [ ] okrs 優先 + snapshot fallback
- [ ] 既存カスケード生成との整合確認

**保存統一**
- [ ] 新規 KPI 追加 → OkrService.upsertOkr()
- [ ] KPI 編集 → OkrService.upsertOkr()
- [ ] KPI 削除 → OkrService.deleteOkr()
- [ ] canonical sync 責務を Service 層へ移行

**AI生成対応**
- [ ] AI生成 OKR → okrs テーブルへ反映
- [ ] Draft OKR も正本化
- [ ] snapshot 同期

**STAGE4 との整合**
- [ ] STAGE3 で追加 → STAGE4 で見える ← 重要
- [ ] STAGE4 で編集 → STAGE3 で見える
- [ ] 不整合テスト完全実施

**成果物:**
- STAGE3 も okrs テーブル正本へ統一
- Phase 1 の「指標追加後に STAGE4 でだけ見える」不具合が再発しない

---

## 並行作業

### Documentation
- [ ] コードコメント追加（source tracking, owner 分離）
- [ ] README 更新（新 OKR アーキテクチャ説明）

### 監視設定
- [ ] Debug API `/api/debug/okrs` デプロイ
- [ ] Alert: OKR count mismatch 検知
- [ ] Log: sync タイミング記録

### Test Coverage
- [ ] Unit: OkrService, merge logic
- [ ] Integration: DB ↔ Store ↔ UI
- [ ] E2E: STAGE3/4/5 全フロー

---

## 成功基準

| 項目 | 基準 |
|------|------|
| **okrs テーブル** | すべての OKR が正本として存在、RLS 正常 |
| **STAGE4** | 保存 → 再読込で崩れない、owner 分離維持 |
| **STAGE5** | okr_id で progress_log 参照可能 |
| **STAGE3** | 追加 KPI が STAGE4 で見える、整合性確認 |
| **Snapshot** | fallback として機能、backfill後も同期 |
| **UX** | 既存画面・操作感 100% 維持 |
| **Performance** | query 遅延なし、sync 遅延なし |

---

## リスク軽減

| リスク | 対策 |
|--------|------|
| OKR 喪失 | backfill テスト、ロールバック計画、検証確認 |
| 不整合 | merge ロジック一元化、source tracking |
| owner 混同 | 型明確化、コメント、テスト |
| STAGE間の不整合再発 | resolveProjectsWithOkrs() 統一使用、テスト |
| Performance 悪化 | Index 最適化、query test、load test |

---

## Go/No-Go Checkpoint

### Phase 2A-3 終了時
- [ ] backfill 成功率 100%
- [ ] データ件数一致確認
- [ ] DB 正상 검증

### Phase 2A-4 終了時
- [ ] STAGE4 保存/읽取 정상
- [ ] 기존 UX 유지 확인
- [ ] 재읽取 안정성 확인
→ **OK면 본번 적용 가능**

### Phase 2A 종료時
- [ ] 전체 테스트 완료
- [ ] 모니터링 설정 완료
- [ ] 문서 완성
→ **Production ready**

---

## 롤백 계획

각 phase 별로:

1. **DB 롤백**: 백업에서 restore
2. **코드 롤백**: feature branch에서 revert
3. **상태 복구**: store 초기화, cache clear

---

**담당:** Backend (OkrService, Repository, Backfill)
**협력:** Frontend (STAGE3/4/5 UI 통합)
**리뷰:** Tech Lead (설계 & code review)

---

**최종 목표:**
> OKR 정본화 완료 후, Phase 2B에서는 Project 테이블 분리, Phase 2C에서는 KR 별도 테이블화로 진행 가능한 기초 마련
