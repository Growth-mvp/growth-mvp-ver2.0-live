# 経営計画書プレビューの障害記録（2026-10）

## 1. 計画書画面の 404（動的ルートの audience 判定）

- **状態**: 解消（修正済み）。型チェックとビルドは成功。ブラウザでの確認は未実施
- **症状**: 計画書の画面が 404 になる
- **原因**: 動的ルート `app/report/[audience]-plan/` では、`useParams` が `bank-plan` を返す（`bank` ではない）。audience の判定が失敗し、404 になる（ROUTING_FIX_REPORT の記載）
- **修正**: 固定の静的ルート `app/report/bank-plan/`、`shareholder-plan/`、`employee-plan/` を追加し、audience を固定値にした（現在の `bank-plan/page.tsx` は `const audience = 'bank' as const;`）
- **残件**:
  - `app/report/[audience]-plan/` が現存する。報告書は削除を推奨しているが、未実施（ROUTING_FIX_REPORT L189-191）。削除は別途承認が必要
  - 設計書 §9「画面の重複」と同じ件
- **元の資料**: [docs/archive/stakeholder-plan-dev-2026-10/](../archive/stakeholder-plan-dev-2026-10/)（ROUTING_FIX_REPORT は本書に内容を移し、ルートから削除）

## 2. 無限ループ（`getSnapshot should be cached`）

- **状態**: 解消（修正済み）。型チェックとビルドは成功。ブラウザでの確認は報告時点では未実施
- **症状**: 「getSnapshot should be cached」のエラーと、再描画の繰り返し
- **原因**: ストアの selector が、呼び出しごとに新しいオブジェクトを返していた（ZUSTAND_INFINITE_LOOP_FIX_REPORT の記載）
- **修正**: 計画書ページで必要な項目だけを返す selector に変更した（報告書の記載）
- **現状**: 現在の `app/report/bank-plan/page.tsx:23` は `useStrategyStore((state) => state)` を使う。報告書の selector は現存しない。同じ原因（呼び出しごとの新規オブジェクト）による再発は、この形では起きない
- **未確認**: ストア全体を購読しているため、不要な再描画が多くないかは確認していない

## 3. 参考

- 他社の strategyId に関するセキュリティの修正は、[docs/security-log/2026-10-19_company-isolation-and-rbac-record.md](../security-log/2026-10-19_company-isolation-and-rbac-record.md) §1 に記録している
