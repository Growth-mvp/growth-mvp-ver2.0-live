# 保存/復元ポイント棚卸し

## DB 保存（Supabase）

### 1. `saveStrategyData()`
- **定義**: `utils/supabase/strategy.ts:812`
- **操作**: DB保存（UPSERT）
- **保存対象**:
  - `strategy` テーブル（全StrategyDataフィールド）
  - `story_answers2` テーブル（別途保存）
  - `final_story` テーブル（別途保存）
- **呼び出し箇所**:
  - `store/strategyStore.ts:1874` - ストア内のメイン保存メソッド
  - `utils/supabase/strategy.ts:1386` - saveFullStrategySnapshot()内
  - `utils/supabase/strategy.ts:1666` - （未確認、コンテキスト取得要）
  - `utils/supabase/strategy.ts:1710` - （未確認、コンテキスト取得要）
  - `utils/supabase/strategy.ts:1801` - saveFullStrategySnapshot()内
  - `app/okr/page.tsx:182` - OKRページ
  - `app/stage4/page.tsx:250` - Stage4ページ
  - `app/story-process/page.tsx:819,1014` - ストーリープロセスページ
  - `components/Sidebar.tsx:89` - サイドバー
  - `components/steps/Step3FinanceUpload.tsx:302,349,364` - 財務アップロード
  - `hooks/useAutoSave.ts:227` - 自動保存フック

### 2. `saveFullStrategySnapshot()`
- **定義**: `utils/supabase/strategy.ts:1787`
- **操作**: 複数テーブルへの一括保存トランザクション
- **保存対象**:
  - `strategy` テーブル（saveStrategyData()経由）
  - `story_answers2` テーブル（saveStoryAnswers2()経由）
  - `final_story` テーブル（saveFinalStory()経由）
- **呼び出し箇所**:
  - （直接呼び出しは検索結果に見当たらず。restore系から呼ばれる可能性）

### 3. `getFullStrategyDataByCompany()`
- **定義**: `utils/supabase/strategy.ts:675`
- **操作**: DB取得（SELECT + 関連テーブルの多重結合）
- **取得対象**:
  - `strategy` テーブル（最新版、company_idで絞込）
  - `story_answers2` テーブル（answers2フィールド）
  - `final_story` テーブル（finalStoryフィールド）
  - `segment_assumptions` テーブル（segments情報）
  - その他関連データ
- **呼び出し箇所**:
  - `store/strategyStore.ts:2055,2131` - ストア内の再取得/リトライ
  - `utils/supabase/strategy.ts:905` - saveFullStrategySnapshot()内での検証
  - `utils/supabase/strategy.ts:1357` - 更新前のカレント取得
  - `utils/supabase/strategy.ts:1642` - （コンテキスト未確認）
  - `utils/supabase/strategy.ts:1697` - （コンテキスト未確認）
  - `app/stage2/page.tsx:849` - Stage2ページでの取得
  - `app/api/ask-ceo-agent/route.ts:172` - CEO質問API
  - `app/api/debug/strategy/route.ts:10` - デバッグAPI

---

## LocalStorage 保存（ブラウザキャッシュ）

### 4. `saveStage1SnapshotToLocalStorage()`
- **定義**: `utils/stageSnapshot.ts:58`
- **操作**: LocalStorage保存（一時的なスナップショット）
- **保存対象**:
  - `issueBlocks[]` - 課題ブロック配列
  - `metricsSummary` - メトリクスサマリー（ROIC等）
  - `companyName` - 企業名
  - `companyId` - 企業ID
- **ストレージキー**: `STAGE1_SNAPSHOT_KEY` (定義: utils/stageSnapshot.ts)
- **呼び出し箇所**:
  - `store/strategyStore.ts:2305` - ストア内の saveStage1Snapshot()メソッド（ラップ）
  - `store/strategyStore.ts:1371,2300` - ストアからの間接呼び出し

### 5. `saveStage2SnapshotToLocalStorage()`
- **定義**: `utils/stageSnapshot.ts:146`
- **操作**: LocalStorage保存（一時的なスナップショット）
- **保存対象**:
  - `Stage2State` オブジェクト全体
    - `mvv` (Mission/Vision/Values)
    - `swot` (SWOT分析)
    - `winPatternsCandidate` (勝利パターン候補)
    - その他Stage2固有フィールド
  - `companyId` - 企業ID
- **ストレージキー**: `STAGE2_SNAPSHOT_KEY` (定義: utils/stageSnapshot.ts)
- **呼び出し箇所**:
  - `store/strategyStore.ts:2318` - ストア内の saveStage2Snapshot()メソッド（ラップ）
  - `store/strategyStore.ts:1393,1400,1407,1421` - ストアからの間接呼び出し
  - `app/stage2/page.tsx:1011,1419,1619` - Stage2ページからの直接呼び出し

---

## 復元（Load）ポイント

### 復元関数（詳細は別途調査要）
- `loadStage1Snapshot()` - LocalStorageから復元
- `loadStage2Snapshot()` - LocalStorageから復元
- `hydrate()` / `initFromServer()` - DBから復元

---

## 要注意箇所

1. **revision不整合** - saveStrategyDataの revision パラメータ処理が複数パターン存在
2. **multipleテーブル整合性** - strategy, story_answers2, final_story の保存順序と失敗時の挙動
3. **LocalStorageとDBの同期** - saveStage1/2SnapshotはDBへの永続化がされていない可能性
4. **Hydration中のスキップ** - store内でhydrating判定による保存スキップが存在
