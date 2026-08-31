# GROWTH SHIFT AI モデル設定監査レポート

**監査日**: 2026-08-31  
**対象**: lib/modelConfig.ts, app/api/ 全 route.ts での OpenAI API 呼び出し  
**前提**: STAGE2=gpt-5.6-luna, Emotion補正=gpt-4o-mini, その他 reasoning/lightweight/legacy の役割分担

---

## 1. 監査対象の前提条件

### 設計意図
```
AI_MODELS.reasoning  = gpt-5.6-luna  (戦略判断・因果推論など重要処理)
AI_MODELS.lightweight = gpt-4o-mini  (軽量生成・整形・分類)
AI_MODELS.legacy     = gpt-4o        (STAGE4以降など未振り分け)
```

### STAGE別期待値
| STAGE/処理 | 期待モデル | パラメータ要件 |
|----------|---------|----------|
| STAGE2 Draft生成 | gpt-5.6-luna | max_completion_tokens, no temperature, no penalty |
| STAGE2 Draft Repair | gpt-5.6-luna | 同上 |
| STAGE2 Final Strategy | gpt-5.6-luna | 同上 |
| STAGE2 Final Repair | gpt-5.6-luna | 同上 |
| STAGE2 Midterm Design | gpt-5.6-luna | 同上 |
| STAGE2 Emotion補正 | gpt-4o-mini | max_tokens, temperature OK |
| STAGE3 Strategy Bridge | gpt-5.6-luna | 同上 |
| reasoning処理 | AI_MODELS.reasoning | 条件付け |
| lightweight処理 | AI_MODELS.lightweight | 条件付け |

---

## 2. 監査結果：STAGE2 関連

### ✅ 2-1. stage2/generate-draft/route.ts

**判定: Luna 維持**

| 項目 | 値 | 状態 |
|-----|-----|------|
| モデル | `AI_MODELS.reasoning` | ✅ 正しい |
| max_tokens 指定 | `getTokenLimitParam(model, 8000)` | ✅ Luna は max_completion_tokens |
| temperature | `getTemperatureParam(model, 0.25)` | ✅ Luna では送信しない |
| reasoning_effort | ✅ 条件付けあり | ✅ gpt-5.6 では 'low' |
| JSON mode | ✅ `{ type: 'json_object' }` | ✅ |
| presence/frequency_penalty | ❌ None | ✅ Luna では送信しない |

**結論**: 完全に正しい実装

---

### ⚠️ 2-2. stage2/generate-final/route.ts

**判定: 要確認 - 複数呼び出しパターン**

**呼び出し1: 最終ストーリー生成**
| 項目 | 値 | 状態 |
|-----|-----|------|
| モデル | `MODEL_PRIMARY` 変数 | ⏳ 要確認（恐らく AI_MODELS.reasoning） |
| max_tokens | `getTokenLimitParam(model, X)` | ✅ |
| temperature | `getTemperatureParam(model, T)` | ✅ |
| reasoning_effort | ✅ 条件付けあり | ✅ |
| JSON mode | ✅ あり | ✅ |

**呼び出し2: Emotion補正**
| 項目 | 値 | 状態 |
|-----|-----|------|
| モデル | `AI_MODELS.lightweight` | ✅ 正しい（gpt-4o-mini） |
| max_tokens | 1200 | ✅ |
| temperature | 0.45-0.55 | ✅ gpt-4o-mini OK |
| JSON mode | ❌ None | ✅ 軽量処理には不要 |

**結論**: MODEL_PRIMARY 変数の中身を確認が必要（恐らく OK）

---

## 3. 監査結果：STAGE3 関連

### ⚠️ 3-1. stage3/generate-strategy-bridge/route.ts

**判定: 警告 - Luna 対応不十分**

| 項目 | 値 | 期待値 | 状態 |
|-----|-----|--------|------|
| モデル | `AI_MODELS.reasoning` | gpt-5.6-luna | ✅ |
| max_tokens | ❌ 指定なし | 指定必須 | ❌ |
| temperature | `getTemperatureParam(model, 0.7)` | - | ✅ |
| reasoning_effort | ❌ None | gpt-5.6 では追加 | ❌ |
| JSON mode | ❌ None | - | ✅ |

**問題点**:
- max_tokens/max_completion_tokens が指定されていない
- reasoning_effort が指定されていない

**結論**: STAGE3 は Luna 対応が不完全

---

## 4. 監査結果：STAGE4/5/6 関連

### ❌ 4-1. stage4/generate-execution-draft/route.ts

**判定: hardcode 残存**

| 項目 | 値 | 期待値 | 状態 |
|-----|-----|--------|------|
| モデル | ❌ `'gpt-4o-mini'` (hardcode) | AI_MODELS.lightweight | ❌ |
| max_tokens | ❌ 指定なし | - | ❌ |
| temperature | 0.7 | - | ✅ |
| JSON mode | ❌ None | - | ✅ |
| modelConfig 使用 | ❌ No | ✅ Yes | ❌ |

**問題点**:
- モデルが hardcode されている
- lib/modelConfig.ts を使用していない

**結論**: STAGE4 は hardcode による旧設定

---

### ⏳ 4-2. stage5/assist-execution/route.ts

**判定: 判定不能 - 内容未確認**

---

## 5. 監査結果：その他の生成系 API

### ❌ 5-1. generate-advice/route.ts

**判定: 旧 fallback 残存**

```typescript
model: process.env.OPENAI_MODEL ?? 'gpt-4o'
```

| 項目 | 値 | 状態 |
|-----|-----|------|
| モデル | ❌ Fallback 'gpt-4o' | ❌ hardcode |

---

### ❌ 5-2. generate-cascade/route.ts

**判定: hardcode + fallback 混在**

**呼び出し1-3**: すべて
```typescript
model: process.env.OPENAI_MODEL ?? 'gpt-4o'
```

| 呼び出し | max_tokens | JSON mode | 状態 |
|--------|-----------|-----------|------|
| 呼び出し1 | 500 | ✅ | ❌ fallback |
| 呼び出し2 | 5000 | ✅ | ❌ fallback |
| 呼び出し3 | - | ✅ | ❌ fallback |

**結論**: 全呼び出しで旧 fallback 復活

---

### ❌ 5-3. generate-department-draft/route.ts

**判定: 旧 fallback 残存**

```typescript
model: process.env.OPENAI_MODEL ?? 'gpt-4o'
```

---

### ❌ 5-4. その他 (generate-example, generate-department-question, generate-final-story, generate-hint, generate-ot, generate, generate-strategy, generate-story-draft)

**判定: 旧 fallback 残存**

複数ファイルで統一：
```typescript
model: process.env.OPENAI_MODEL ?? 'gpt-4o'
// または
model: process.env.OPENAI_MODEL ?? 'gpt-4o-mini'
// または hardcode
model: 'gpt-4o' / 'gpt-4o-mini'
```

---

## 6. 監査結果：org-alignment 関連

### ❌ 6-1. org-alignment/generate/route.ts
### ❌ 6-2. org-alignment/admin/insights/generate/route.ts
### ❌ 6-3. org-alignment/intake/route.ts

**判定: 旧 fallback 残存**

すべて：
```typescript
model: process.env.OPENAI_MODEL || 'gpt-4o'
```

**追加問題**:
- 本来 lightweight 対象か reasoning 対象か不明
- org-alignment は新機能のため、Luna 対応方針が不明

---

## 7. 監査結果：その他

### ❌ 7-1. ask-ceo-agent/route.ts

**判定: hardcode 残存**

```typescript
model: 'gpt-4o'
```

| 項目 | 値 | 状態 |
|-----|-----|------|
| モデル | ❌ 'gpt-4o' (hardcode) | ❌ |
| temperature | 0.2 | ✅ |

---

## 8. 最終分類

### ✅ Luna 維持（1件）

| ファイル | 処理 | 状態 |
|--------|-----|------|
| stage2/generate-draft | STAGE2 Draft生成 | 完全に正しい |

### ⚠️ 意図せず旧モデルへ戻っている（13件以上）

| ファイル | 問題 |
|--------|------|
| generate-advice | `process.env.OPENAI_MODEL ?? 'gpt-4o'` |
| generate-cascade (全3呼び出し) | 旧 fallback |
| generate-department-draft | 旧 fallback |
| generate-department-question | 旧 fallback |
| generate-example | 旧 fallback |
| generate-final-story | 変数参照（要確認） |
| generate-hint | 旧 fallback |
| generate-ot (複数呼び出し) | 旧 fallback + hardcode |
| generate | 旧 fallback |
| generate-strategy | 旧 fallback |
| generate-story-draft | 旧 fallback |
| org-alignment/generate | 旧 fallback |
| org-alignment/admin/insights/generate | 旧 fallback |
| org-alignment/intake | 旧 fallback |
| stage3/generate-strategy-bridge | モデルOK だが max_tokens/reasoning_effort 未指定 |

### ⚠️ hardcode 残存（3件）

| ファイル | モデル | 問題 |
|--------|--------|------|
| stage4/generate-execution-draft | 'gpt-4o-mini' | modelConfig 非使用 |
| ask-ceo-agent | 'gpt-4o' | hardcode |
| generate-ot | 'gpt-4o' | 混在 |

### ⏳ 判定不能（2件）

| ファイル | 理由 |
|--------|------|
| stage2/generate-final | MODEL_PRIMARY 変数の中身確認が必須 |
| stage5/assist-execution | 内容未確認 |

---

## 9. 重大な問題点

### 問題1: env fallback の全体復活

```typescript
// ❌ 複数ファイルで以下が復活している
process.env.OPENAI_MODEL ?? 'gpt-4o'
process.env.OPENAI_MODEL ?? 'gpt-4o-mini'
```

**原因**: lib/modelConfig.ts 作成後も、既存コードの更新が未実施

**影響**:
- STAGE2-6 全体で Luna 対応が部分的
- 環境変数が 'gpt-4o' をデフォルトにしていた時代への回帰

---

### 問題2: STAGE3 bridge の Luna 対応不完全

```typescript
// ✅ モデルは正しい
model: AI_MODELS.reasoning
// ❌ だが パラメータが不完全
// max_tokens/max_completion_tokens 指定なし
// reasoning_effort 指定なし
```

**影響**: gpt-5.6-luna の最適なパラメータが使用されていない

---

### 問題3: org-alignment 処理の方針不明

- org-alignment は新機能（2026年7月以降）
- Luna 対応方針が定められていない
- 認識分析・insight生成は reasoning vs lightweight か判定できない

---

## 10. 推奨修正アクション

### 優先度1: hardcode の一掃

```typescript
// ❌ 以下を全削除
process.env.OPENAI_MODEL ?? 'gpt-4o'
process.env.OPENAI_MODEL ?? 'gpt-4o-mini'
hardcoded 'gpt-4o' / 'gpt-4o-mini'

// ✅ 以下で統一
AI_MODELS.reasoning   (STAGE2, STAGE3 reasoning系)
AI_MODELS.lightweight (Emotion補正, org-alignment 分類系)
AI_MODELS.legacy      (STAGE4, STAGE5, STAGE6 等 未振り分け)
```

**対象ファイル数**: 13+

### 優先度2: STAGE3 bridge パラメータ補完

```typescript
// stage3/generate-strategy-bridge/route.ts
const base = {
  model,
  ...getTokenLimitParam(model, 10000),  // ← 追加
  ...getTemperatureParam(model, 0.7),
  ...((model.startsWith('gpt-5.6')) && { reasoning_effort: 'low' } || {}),  // ← 追加
  messages: [...]
}
```

### 優先度3: org-alignment の方針決定

**選択肢**:
1. reasoning = AI_MODELS.reasoning（重要判断）
2. lightweight = AI_MODELS.lightweight（軽量分類）
3. legacy = AI_MODELS.legacy（未振り分け）

決定後、全呼び出しを統一

### 優先度4: STAGE2 generate-final の MODEL_PRIMARY 確認

変数参照の中身が AI_MODELS.reasoning か確認し、必要に応じて明示的に統一

---

## 11. 検証チェックリスト（修正後）

- [ ] lib/modelConfig.ts のみから AI_MODELS を取得
- [ ] `process.env.OPENAI_MODEL` の直接参照がない（grep で 0 件）
- [ ] 'gpt-4o' hardcode が AI_MODELS.legacy のみ（ask-ceo-agent を除く必要な場合は例外記録）
- [ ] STAGE2 Draft/Final: max_completion_tokens, no temperature
- [ ] STAGE3 Bridge: max_completion_tokens + reasoning_effort
- [ ] Emotion補正: AI_MODELS.lightweight 統一
- [ ] org-alignment: 方針決定 + 統一
- [ ] STAGE4+: 方針決定後 legacy か他か統一

