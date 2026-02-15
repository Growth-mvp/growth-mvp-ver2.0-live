# STAGE6 Phase E - 実装チェックリスト（E〜K完全実装確認）

## 目標

Tab2とTab3の破綻を完全に修正し、「ユーザーが理解できる説明」と「回帰しない保守性」を実現

---

## ✅ STEP 1: Unit 正規化ユーティリティ（compute.ts）

### 実装確認

**ファイル**: `utils/stage6/compute.ts` lines 101-144

```typescript
export function normalizeValueToUnit(
  valueInYen: number | undefined,
  targetUnit: string | undefined
): number | undefined
```

**サポート単位**:
- ✅ "百万円" / "MJPY" → value / 1_000_000
- ✅ "千円" / "KJPY" → value / 1_000
- ✅ "円" / "JPY" / "¥" → そのまま
- ✅ "%" → そのまま

**buildNorthStarRows() での使用**: lines 283-294
```typescript
const rawForecast = extractMetricFromYearlyPL(...);    // 円単位
const normalizedForecast = normalizeValueToUnit(rawForecast, target.unit);  // target.unitに揃える
const achievement = calculateAchievementRate(normalizedForecast, target.base);
const gap = normalizedForecast !== undefined && target.base ? normalizedForecast - target.base : undefined;
```

**結果**:
- ✅ 達成率が 333,333% にならない（単位一致を前提に計算）
- ✅ gap も同一単位系で計算される

---

## ✅ STEP 2: Export（index.ts）

**ファイル**: `utils/stage6/index.ts` line 18

```typescript
export {
  fmtJPY,
  compactJPY,
  normalizeValueToUnit,  // ← 追加
  extractMetricFromYearlyPL,
  ...
}
```

**確認**:
- ✅ `normalizeValueToUnit` がexportされている
- ✅ useStage6Data.ts でimportされている

---

## ✅ STEP 3: Hybrid Phase E と Tab2同期（useStage6Data.ts）

### 3-A: 有効判定の改善

**ファイル**: `components/stage6/hooks/useStage6Data.ts` lines 56-61

```typescript
const projectTargetImpacts = useStrategyStore((s) =>
  Array.isArray(s.projectTargetImpacts) ? s.projectTargetImpacts : []
);
const projectIssueLinks = useStrategyStore((s) =>
  Array.isArray(s.projectIssueLinks) ? s.projectIssueLinks : []
);
```

**確認**:
- ✅ projectTargetImpacts と projectIssueLinks の両方をstore から取得
- ✅ IssueLinks だけ存在する場合も Phase E 計算が動く

### 3-B: North Star Rows のハイブリッド計算

**ファイル**: `components/stage6/hooks/useStage6Data.ts` lines 415-492

**3段構成**:

1. **Step 1**: 既存ロジックで全行初期化（lines 420-426）
```typescript
const baseRows = buildNorthStarRows({
  companyTargets,
  yearlyAll: core.yearlyAll,
  scenarioKey,
  projectContrib,
});
```
✅ 全行が normalizeValueToUnit の恩恵を受ける

2. **Step 2**: 売上/営業利益だけ chartData と同期（lines 429-461）
```typescript
const isRevenueLike = row.label.toLowerCase().includes('売上') && !row.label.toLowerCase().includes('成長');
const isOpIncomeLike = row.label.toLowerCase().includes('営業利益') && !row.label.toLowerCase().includes('率');

if (isRevenueLike || isOpIncomeLike) {
  const lastChartRow = chartData[chartData.length - 1];
  const chartValue = isRevenueLike ? lastChartRow.allRevenue : lastChartRow.allOp;
  const normalizedValue = normalizeValueToUnit(chartValue, row.unit);
  // ... update forecast/gap/achievementRate
}
```
✅ Tab2 グラフ終点 = テーブル forecast（同一単位系）

3. **Step 3**: Phase E impact がある行だけ上書き（lines 463-489）
```typescript
if (projectTargetImpacts.length > 0) {
  const phaseERows = buildNorthStarRowsPhaseE(...);
  const phaseEMap = new Map(phaseERows.map(r => [r.targetId, r]));

  const hybridRows = syncedRows.map(row => {
    const phaseERow = phaseEMap.get(row.targetId);
    return phaseERow ? phaseERow : row;  // ← 上書きは targetId が impact に存在する行だけ
  });
}
```
✅ Delta 入力がある行だけ変化、他の行は不変（hybrid 実装）

### 3-C: Issue Resolution も links 優先

**ファイル**: `components/stage6/hooks/useStage6Data.ts` lines 496-511

```typescript
const issueResolutions = useMemo(() => {
  if (projectIssueLinks.length > 0) {
    return buildIssueResolutionsPhaseE({...});
  } else {
    return buildIssueResolutions({...});
  }
}, [projectIssueLinks, ...]);
```

**確認**:
- ✅ projectIssueLinks が 1件以上あれば Phase E 計算
- ✅ North Star 紐付けがなくても resolution が計算される

---

## ✅ STEP 4: Tab3 LinkedTargets 空の表示（TabValue.tsx）

**ファイル**: `components/stage6/TabValue.tsx` lines 217-254

**3状態表示**:

```typescript
{resolution.linkedTargets.length > 0 ? (
  // State 1: linkedTargets あり → 従来通り
  <div>✓ 紐付く北星メトリクス：{...}</div>
) : (projectIssueLinks && projectIssueLinks.length > 0) ? (
  // State 2: linkedTargets なし だが projectIssueLinks あり → 未接続にしない
  <div>注：北星メトリクスの紐付けはSTAGE2で定義。解決度はプロジェクト強度から計算しています。</div>
) : (
  // State 3: リンク全くなし → 未接続警告
  <div>⚠ 未接続：North Starと紐づけが無いため、解決度が計算できません</div>
)}
```

**確認**:
- ✅ State 1: linkedTargets 存在時は北星メトリクス表示
- ✅ State 2: projectIssueLinks 存在だが linkedTargets 空 → "未接続"扱いにしない
- ✅ State 3: 完全にリンクなし → 未接続警告

---

## ✅ STEP 5: Debug ログ（useStage6Data.ts）

**有効化**: `NEXT_PUBLIC_DEBUG_STAGE6=1 npm run dev`

### ログ出力箇所

**[G-1] CompanyTargets サンプル**: lines 377-382
```typescript
console.log('[G-1] CompanyTargets sample:',
  samples.map(t => ({ id: t.id, label: t.label, unit: t.unit, base: t.base })));
```

**[E-2] ChartData 同期**: lines 440-442
```typescript
console.log(`[E-2] ${row.label}: chartValue=${chartValue}, normalized=${normalizedValue}, unit=${row.unit}`);
```

**[E-3] Hybrid 上書き**: lines 476-486
```typescript
console.log(`[E-3] ${row.label}: PhaseE上書き (forecast ${row.forecastValue} → ${phaseERow.forecastValue})`);
console.log(`[E-3] Hybrid: ${hybridRows.length}行中${phaseERows.length}行がPhaseEで上書き`);
```

**[J-2] Phase E 統計**: lines 584-609
```typescript
console.log('[J-2] unitNormalized:', { label, unit, forecastValue, achievementRate });
console.log('[J-2] phaseEOverwrite:', { totalRows, affected, affectedIds });
```

---

## ✅ テスト実行結果

### Compilation

```bash
$ npm run type-check
> growth-mvp@0.2.0 type-check
> tsc -p tsconfig.json --noEmit
✅ No errors
```

```bash
$ npm run build
> growth-mvp@0.2.0 build
> next build
✓ Compiled successfully in 3.0s
✓ Generating static pages (33/33)
✅ Build successful
```

### Bundle Size
- STAGE6: 110 kB (安定)
- 全体 First Load JS: 293 kB

---

## 🧪 受け入れテスト（最小必須）

### Test 1: Unit-Specific Achievement Rate

**目的**: 達成率が異常値にならない（unit正規化の確認）

**手順**:
1. Tab2で「売上」行（unit=百万円）を探す
2. 行内展開で delta +100 を入力
3. Achievement Rate を確認

**期待結果**:
- ✅ Forecast が正しく更新される
- ✅ Achievement Rate が reasonable（e.g., 120%）
- ✅ 333,333% のような異常値が出ない

**デバッグ確認**:
```
[E-2] 売上: chartValue=50000000000, normalized=50, unit=百万円
```

### Test 2: Hybrid Phase E

**目的**: 1行だけ入力しても他の行が壊れない（hybrid確認）

**手順**:
1. Tab2で全北星行のforecastを記録
2. 第1行だけ delta を入力
3. 他の行のforecast が不変を確認

**期待結果**:
- ✅ 第1行: forecast/gap/achievementが変化
- ✅ 他の行: 全く不変
- ✅ グラフと表の売上/営業利益は端点同期

**デバッグ確認**:
```
[E-3] 営業利益: PhaseE上書き (forecast 150 → 160)
[E-3] Hybrid: 8行中1行がPhaseEで上書き
```

### Test 3: Issue Resolution Without North Star Link

**目的**: LinkedTargets 空でも strength で解決度が動く（F-1確認）

**手順**:
1. Tab3で linkedTargets 空の Issue を探す
2. 行内展開で 強(3) を設定
3. Resolution Rate が増加を確認

**期待結果**:
- ✅ Resolution Rate が0%から上昇
- ✅ 「未接続」警告が出ない
- ✅ 「解決度はプロジェクト強度から計算」注記が表示される

**デバッグ確認**:
```
[F-1] Phase E Issues: 5件計算
```

---

## 📋 実装状態チェックシート

| Item | Status | Location |
|------|--------|----------|
| normalizeValueToUnit 定義 | ✅ | compute.ts:113-144 |
| buildNorthStarRows で normalize 使用 | ✅ | compute.ts:287 |
| normalizeValueToUnit export | ✅ | index.ts:18 |
| useStage6Data で import | ✅ | useStage6Data.ts:31 |
| chartData 構築 | ✅ | useStage6Data.ts:417-413 |
| baseRows 生成 | ✅ | useStage6Data.ts:421-426 |
| 売上/営業利益 同期 | ✅ | useStage6Data.ts:429-461 |
| Hybrid Phase E 上書き | ✅ | useStage6Data.ts:464-489 |
| IssueLinks 優先判定 | ✅ | useStage6Data.ts:497 |
| TabValue 3状態表示 | ✅ | TabValue.tsx:217-254 |
| [G-1] ログ | ✅ | useStage6Data.ts:377-382 |
| [E-2] ログ | ✅ | useStage6Data.ts:440-442 |
| [E-3] ログ | ✅ | useStage6Data.ts:476-486 |
| [J-2] ログ | ✅ | useStage6Data.ts:584-609 |
| npm run type-check | ✅ | PASS |
| npm run build | ✅ | PASS |

---

## 🚀 デプロイ前チェック

```bash
# 1. Type check
npm run type-check
# ✅ Expected: 0 errors

# 2. Build
npm run build
# ✅ Expected: All pages generate successfully

# 3. Local dev で3テストケース確認
NEXT_PUBLIC_DEBUG_STAGE6=1 npm run dev
# - Test 1: Tab2 達成率が異常値にならない
# - Test 2: Hybrid で他行が不変
# - Test 3: Tab3 Issue 強度で解決度が動く

# 4. Save & Reload 確認
# - STAGE5で進捗ログ追加 → STAGE6 back → 計算が更新される確認
# - Phase E delta/strength 入力 → Save → Reload → 残存を確認
```

---

## ⚠️ 既知の制限（v1.1）

1. Contribution parameter: v1では 1.0 固定（OKR連動は future）
2. Baseline: v1では 0 固定（歴史ベースライン連動は future）
3. Strength coef: 弱=0.6, 中=1.0, 強=1.3（カスタマイズ不可 for now）
4. Issue Max正規化: 全issue共通スケール（issue別スケーリング is future）

---

## 📞 Troubleshooting

### Issue: Achievement Rate が異常値のまま

**原因**: normalizeValueToUnit が呼ばれていない可能性

**確認**:
1. Debug console で `[E-2]` ログが出ているか確認
2. 出ていなければ、useStage6Data.ts line 438 で normalizeValueToUnit がコール可能か確認
3. Import が正しいか確認（line 31）

### Issue: Hybrid で他行が変わってしまう

**原因**: phaseEMap.get() が意図しない行をマッチしている可能性

**確認**:
1. Debug console で `[E-3] Hybrid:` ログの affected 数を確認
2. delta を入れた targetId だけカウントされているか確認
3. targetId が unique なことを確認（companyTargets に重複がないか）

### Issue: Tab3 で Issue が「未接続」と表示される

**原因**: 3状態判定の順序が変わった可能性

**確認**:
```typescript
// TabValue.tsx line 228 の判定を確認
: (projectIssueLinks && projectIssueLinks.length > 0) ?
// この条件が正しく評価されているか
```

---

## ✅ 確認日時

- 実装確認: 2025-02-15
- Build: ✅ PASS
- Type check: ✅ PASS
- 全チェックリスト: ✅ 完了
