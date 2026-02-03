# 保存呼び出し元の詳細棚卸し（TASK 1-1）

## 概要
リポジトリ全体の `saveStrategyData()` 呼び出し箇所を一覧化。
- **saveStrategyData()** ... Supabase DB への保存関数（utils/supabase/strategy.ts:812で定義）
- **saveStrategyDataApi** ... 上記のエイリアス（STAGE2側で`as saveStrategyDataApi`とインポート）

---

## 呼び出し元リスト

### グループ A: Zustand ストア側（store/strategyStore.ts）

#### A-1. Store メイン保存メソッド
- **ファイル**: `store/strategyStore.ts:1874`
- **メソッド**: `saveStrategyData(opts)`
- **説明**: ストア側のメイン保存ハブ。他の保存呼び出しはほぼここを経由（推奨）
- **呼び出し内容**:
  ```typescript
  const result = await saveStrategyData(
    payload,     // StrategyData
    userId,      // string
    companyId,   // string
    revision,    // number | undefined
    opts         // { mode?: 'upsert' | 'updateOnly' }
  );
  ```
- **caller候補**: `store:saveStrategyData`

#### A-2. Store 内部の retry ロジック
- **ファイル**: `store/strategyStore.ts:2129`
- **メソッド**: (refetchFromServer 内)
- **説明**: DB取得失敗時の復旧保存。saveStrategyDataApi（エイリアス）を使用
- **呼び出し内容**:
  ```typescript
  await saveStrategyDataApi(base as any);
  ```
- **caller候補**: `store:refetchFromServer:retry`

---

### グループ B: ページ側（直接 store.saveStrategyData() 経由）

#### B-1. OKR ページ
- **ファイル**: `app/okr/page.tsx:182`
- **コンテキスト**: OKR保存ボタン押下
- **呼び出し内容**:
  ```typescript
  await useStrategyStore.getState().saveStrategyData();
  ```
- **caller候補**: `okr:save`

#### B-2. Stage4 ページ
- **ファイル**: `app/stage4/page.tsx:250`
- **コンテキスト**: Stage4 OKR保存確定時
- **呼び出し内容**:
  ```typescript
  await saveStrategyData();
  ```
  （注意: `saveStrategyData` がローカルスコープで定義されているかストアメソッドかを確認要）
- **caller候補**: `stage4:save`

#### B-3. Story Process ページ（2箇所）
- **ファイル**: `app/story-process/page.tsx:819, 1014`
- **コンテキスト**: 最終ストーリー生成・確定時
- **呼び出し内容**:
  ```typescript
  await saveStrategyData(payload, user.id);
  ```
  （直接インポートの可能性あり、確認要）
- **caller候補**: `storyProcess:generate` / `storyProcess:confirm`

#### B-4. Sidebar コンポーネント
- **ファイル**: `components/Sidebar.tsx:89`
- **コンテキスト**: サイドバーメニュー操作時の保存
- **呼び出し内容**:
  ```typescript
  await useStrategyStore.getState().saveStrategyData();
  ```
- **caller候補**: `sidebar:save`

---

### グループ C: 自動保存フック

#### C-1. useAutoSave フック
- **ファイル**: `hooks/useAutoSave.ts:227`
- **コンテキスト**: 自動保存タイマー発火時
- **呼び出し内容**:
  ```typescript
  await storeApi.saveStrategyData();
  ```
  （storeApi は useStrategyStore.getState()のエイリアス）
- **caller候補**: `autoSave:tick`

---

### グループ D: Step コンポーネント（財務データ等）

#### D-1. Step3FinanceUpload コンポーネント（3箇所）
- **ファイル**: `components/steps/Step3FinanceUpload.tsx:302, 349, 364`
- **コンテキスト**: 財務データ（BS、PL）のアップロード/更新時
- **呼び出し内容**:
  ```typescript
  // 302行目
  await saveStrategyData(...)

  // 349行目
  await saveStrategyData({ ...state, financeActual: rows }, userId, companyId);

  // 364行目
  await saveStrategyData({ ...state, financePlan: rows }, userId, companyId);
  ```
  （直接インポート：`import { saveStrategyData } from '@/utils/supabase/strategy'`）
- **caller候補**: `step3Finance:import` / `step3Finance:uploadActual` / `step3Finance:uploadPlan`

---

### グループ E: STAGE2 内での保存（saveStrategyDataApi エイリアス）

#### E-1. Stage2 ページ
- **ファイル**: `app/stage2/page.tsx:1437`
- **コンテキスト**: 生成/確定フロー
- **呼び出し内容**:
  ```typescript
  const saveResult = await saveStrategyDataApi(...)
  ```
  （エイリアス：`import { saveStrategyData as saveStrategyDataApi }`）
- **caller候補**: `stage2:save`

#### E-2. Step2SWOT コンポーネント
- **ファイル**: `components/steps/Step2SWOT.tsx:315`
- **コンテキスト**: SWOT分析更新時
- **呼び出し内容**:
  ```typescript
  await saveStrategyDataApi(state, userId!, companyId!);
  ```
- **caller候補**: `step2SWOT:save`

#### E-3. Step2Portfolio コンポーネント
- **ファイル**: `components/steps/Step2Portfolio.tsx:101`
- **コンテキスト**: ポートフォリオ更新時
- **呼び出し内容**:
  ```typescript
  await saveStrategyDataApi(payload, userId!, companyId!);
  ```
- **caller候補**: `step2Portfolio:save`

#### E-4. Step5Confirm コンポーネント
- **ファイル**: `components/steps/Step5Confirm.tsx:364`
- **コンテキスト**: Stage2 最終確定時
- **呼び出し内容**:
  ```typescript
  await saveStrategyDataApi({ ...current, ...patch }, userId!, companyId!);
  ```
- **caller候補**: `step5Confirm:finalize`

---

## 保存ルート分類

### Route 1: ストア経由（推奨）
- B-1, B-3（OKR、Stage4、Story Process）
- B-4, C-1（Sidebar、自動保存）
- **特徴**: store.saveStrategyData() を呼ぶため、revisionやhydrationガード等の共通ロジックを経由
- **置換ルール**: すでにストア経由 → `saveWithAudit` でラップするだけ

### Route 2: 直接呼び出し（統一化要）
- D-1（Step3FinanceUpload）
- E-2, E-3, E-4（Step2系、Step5）
- **特徴**: saveStrategyData() / saveStrategyDataApi をページ側で直接インポート
- **問題**: ストア経由の共通ロジック（revision同期等）をバイパスしている可能性
- **置換ルール**:
  - 可能なら store.saveStrategyData() に寄せる
  - 難しければ直接 saveWithAudit() に置換

### Route 3: リトライ用（確認要）
- A-2（refetchFromServer 内）
- **特徴**: 復旧用の保存で通常フロー外
- **置換ルール**: caller: `store:refetchFromServer:retry` でマーク

---

## 置換スケジュール（推奨順序）

1. **優先度 HIGH**: store/strategyStore.ts:1874 (メイン) + A-2
   - ここを saveWithAudit に置換すれば、すべての store 経由呼び出しが監査対象になる

2. **優先度 HIGH**: D-1 (Step3FinanceUpload)
   - 直接呼び出しなので個別に caller 付きで saveWithAudit に置換

3. **優先度 MEDIUM**: E-1, E-2, E-3, E-4 (STAGE2系)
   - saveStrategyDataApi をすべて saveWithAudit に置換

4. **優先度 MEDIUM**: B-2 (Stage4) の saveStrategyData が何なのか確認
   - 直接呼び出しならストア経由に寄せるか saveWithAudit に置換

---

## 次のステップ（TASK 1-2～1-4）

1. saveWithAudit に `caller` パラメータを追加
2. 監査ログに `effectiveCompanyId`, `strategyId`, `revision (before/after)`, `payloadSize`, `caller`, `result` を含める
3. 各呼び出し箇所を順次置換（caller値を適切に指定）
