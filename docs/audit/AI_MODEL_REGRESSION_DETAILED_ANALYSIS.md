# AI モデル回帰 詳細分析レポート

**分析日**: 2026-08-31  
**対象**: STAGE2 generate-draft/final の処理単位別モデル・パラメータ追跡

---

## 1. 処理単位別詳細分析

### STAGE2 generate-draft/route.ts

#### 処理1: Draft主生成

**openai.chat.completions.create() - Line 1345**

| 項目 | 内容 |
|-----|------|
| **model パラメータ** | `model` (変数参照) |
| **model 定義元** | Line 1263: `const model = AI_MODELS.reasoning;` |
| **実効モデル** | ✅ **gpt-5.6-luna** |
| **fallback** | なし（直接呼び出し） |
| **max_completion_tokens** | Line 1354: `...getTokenLimitParam(model, 8000)` → **max_completion_tokens: 8000** ✅ |
| **reasoning_effort** | Line 1355-1356: `...(model.startsWith('gpt-5.6') ? { reasoning_effort: 'low' } : {})` → **reasoning_effort: 'low'** ✅ |
| **temperature** | Line 1348: `...getTemperatureParam(model, 0.25)` → **パラメータ省略**（Luna 非対応） ✅ |
| **presence/frequency_penalty** | **パラメータ省略**（Luna 非対応） ✅ |
| **response_format** | Line 1349: `{ type: 'json_object' }` ✅ |
| **判定** | ✅ **完全に正常** - Luna 設定通り |

---

#### 処理2: Draft Repair

**openai.chat.completions.create() - Line 1568**

| 項目 | 内容 |
|-----|------|
| **model パラメータ** | `model` (変数参照) |
| **model 定義元** | Line 1263: `const model = AI_MODELS.reasoning;` → gpt-5.6-luna |
| **実効モデル** | ✅ **gpt-5.6-luna** |
| **fallback** | なし |
| **max_completion_tokens** | Line 1577: `...getTokenLimitParam(model, 4000)` → **max_completion_tokens: 4000** ✅ |
| **reasoning_effort** | Line 1578-1579: `...(model.startsWith('gpt-5.6') ? { reasoning_effort: 'low' } : {})` → **reasoning_effort: 'low'** ✅ |
| **temperature** | Line 1571: `...getTemperatureParam(model, 0.0)` → **パラメータ省略** ✅ |
| **presence/frequency_penalty** | **パラメータ省略** ✅ |
| **response_format** | Line 1572: `{ type: 'json_object' }` ✅ |
| **判定** | ✅ **完全に正常** - Luna 設定通り |

---

### STAGE2 generate-final/route.ts

#### 処理3: Final Strategy主生成

**callOpenAIChat() 経由 → openai.chat.completions.create() - Line 1028**

**外側の呼び出し**: Line 1893-1905
```typescript
const result = await callOpenAIChat({
  model: AI_MODELS.reasoning,           // ← Line 1894
  max_tokens: 5200,
  temperature: baseTemperature,
  presence_penalty: 0.2,
  frequency_penalty: 0.2,
  messages: [...],
});
```

**callOpenAIChat() 内部実装** (Line 1013-1025):
```typescript
const base: ChatCompletionCreateParamsNonStreaming = {
  model,
  ...getTemperatureParam(model, temperature),
  ...getTokenLimitParam(model, max_tokens),
  ...getPenaltyParams(model, presence_penalty, frequency_penalty),
  messages: [...],
  ...(SUPPORTS_JSON_MODE.test(model) ? { response_format: { type: 'json_object' } } : {}),
  // ← reasoning_effort パラメータがない ❌
};
```

| 項目 | 内容 |
|-----|------|
| **model パラメータ** | `AI_MODELS.reasoning` (Line 1894) |
| **model 定義元** | lib/modelConfig.ts: `reasoning: process.env.OPENAI_REASONING_MODEL \|\| 'gpt-5.6-luna'` |
| **実効モデル** | ✅ **gpt-5.6-luna** |
| **fallback** | Line 1940-1948: 429/5xx エラー時のみ `allowFallback: true` → AI_MODELS.lightweight へ |
| **max_completion_tokens** | Line 1896 → callOpenAIChat Line 1015: `...getTokenLimitParam(model, 5200)` → **max_completion_tokens: 5200** ✅ |
| **reasoning_effort** | ❌ **callOpenAIChat() 内で未設定** ❌❌❌ |
| **temperature** | Line 1895 → Line 1014: `...getTemperatureParam(model, baseTemperature)` → **パラメータ省略** ✅ |
| **presence/frequency_penalty** | Line 1901-1902 → Line 1017: `...getPenaltyParams(...)` → **パラメータ省略** ✅ |
| **response_format** | Line 1022-1024: `SUPPORTS_JSON_MODE.test(model)` (Luna は支援) → `{ type: 'json_object' }` ✅ |
| **判定** | ❌ **回帰: reasoning_effort が未設定** |

---

#### 処理4: Final Emotion補正（オプション）

**openai.chat.completions.create() - Line 1390**

**外側の呼び出し**: Line 1947-1954 (条件付き)
```typescript
if (needsEmotionRetouching) {
  const emotionRetouched = await enhanceEmotionIfNeeded(
    finalResult,
    AI_MODELS.lightweight,  // ← Line 1950
    emotionMode || 'default'
  );
}
```

**enhanceEmotionIfNeeded() 内部** (Line 1378-1391):
```typescript
const response = await openai.chat.completions.create({
  model,  // ← AI_MODELS.lightweight (= gpt-4o-mini)
  temperature: Math.min(0.45, typeof temperature === 'number' ? temperature : 0.4),
  max_tokens: 1200,
  messages: [...],
});
```

| 項目 | 内容 |
|-----|------|
| **model パラメータ** | `AI_MODELS.lightweight` (Line 1950) |
| **model 定義元** | lib/modelConfig.ts: `lightweight: process.env.OPENAI_LIGHTWEIGHT_MODEL \|\| 'gpt-4o-mini'` |
| **実効モデル** | ✅ **gpt-4o-mini** |
| **fallback** | なし（軽量処理専用） |
| **max_tokens** | Line 1380: **max_tokens: 1200** ✅ |
| **reasoning_effort** | N/A（gpt-4o-mini 非対応） |
| **temperature** | Line 1379: **0.25〜0.45** ✅ |
| **presence/frequency_penalty** | **パラメータなし** ✅ |
| **response_format** | Line 1385-1386: `SUPPORTS_JSON_MODE.test(model)` (gpt-4o-mini は非対応) → **response_format なし** ✅ |
| **判定** | ✅ **正常** - gpt-4o-mini 設定通り |

---

#### 処理5: Final Repair（修正パス）

**repairExecutiveStoryIfNeeded() → callOpenAIChat() - Line 1478**

**外側の呼び出し**: Line 2052-2062
```typescript
const repaired = await repairExecutiveStoryIfNeeded(
  finalResult,
  AI_MODELS.reasoning,  // ← Line 2055
  0.35
);
```

**repairExecutiveStoryIfNeeded() 内部** (Line 1473-1485):
```typescript
const repaired = await callOpenAIChat({
  model: args.model,  // ← AI_MODELS.reasoning
  max_tokens: args.maxTokens ?? 3600,
  temperature: 0.35,
  presence_penalty: 0.1,
  frequency_penalty: 0.1,
  messages: [...],
});
```

**callOpenAIChat() 内** (Line 1013-1025):
```typescript
const base: ChatCompletionCreateParamsNonStreaming = {
  model,
  ...getTemperatureParam(model, temperature),
  ...getTokenLimitParam(model, max_tokens),
  ...getPenaltyParams(model, presence_penalty, frequency_penalty),
  messages: [...],
  ...(SUPPORTS_JSON_MODE.test(model) ? { response_format: { type: 'json_object' } } : {}),
  // ← reasoning_effort パラメータがない ❌
};
```

| 項目 | 内容 |
|-----|------|
| **model パラメータ** | `AI_MODELS.reasoning` (Line 2055) |
| **model 定義元** | lib/modelConfig.ts: `reasoning: 'gpt-5.6-luna'` |
| **実効モデル** | ✅ **gpt-5.6-luna** |
| **fallback** | Line 1940-1948: `allowFallback: false` のため対象外 |
| **max_completion_tokens** | Line 1474: `...getTokenLimitParam(model, 3600)` → **max_completion_tokens: 3600** ✅ |
| **reasoning_effort** | ❌ **callOpenAIChat() 内で未設定** ❌❌❌ |
| **temperature** | Line 1475 → Line 1014: `...getTemperatureParam(model, 0.35)` → **パラメータ省略** ✅ |
| **presence/frequency_penalty** | Line 1476-1477 → Line 1017: `...getPenaltyParams(...)` → **パラメータ省略** ✅ |
| **response_format** | Line 1022-1024: `SUPPORTS_JSON_MODE.test(model)` (Luna は支援) → `{ type: 'json_object' }` ✅ |
| **判定** | ❌ **回帰: reasoning_effort が未設定** |

---

### STAGE3 generate-strategy-bridge/route.ts

**openai.chat.completions.create() - 確認中**

[追跡継続...]

---

## 2. 回帰確認サマリ

### ✅ 正常（期待値通り）

| 処理 | モデル | reasoning_effort | max_completion_tokens | 判定 |
|-----|--------|----------------|-------------------|----|
| **generate-draft / 主生成** | gpt-5.6-luna | ✅ low | ✅ 8000 | ✅ 正常 |
| **generate-draft / Repair** | gpt-5.6-luna | ✅ low | ✅ 4000 | ✅ 正常 |
| **generate-final / Emotion補正** | gpt-4o-mini | N/A | ✅ 1200 | ✅ 正常 |

### ❌ 回帰確認（期待値と異なる）

| 処理 | モデル | reasoning_effort | 問題 | 判定 |
|-----|--------|----------------|------|------|
| **generate-final / 主生成** | gpt-5.6-luna | ❌ **未設定** | callOpenAIChat() で reasoning_effort が追加されていない | ❌ 回帰 |
| **generate-final / Repair** | gpt-5.6-luna | ❌ **未設定** | callOpenAIChat() で reasoning_effort が追加されていない | ❌ 回帰 |

---

## 3. 回帰原因の追跡

### 問題の源：callOpenAIChat() 関数

**ファイル**: app/api/stage2/generate-final/route.ts  
**行**: 1013-1025（callOpenAIChat() の実装）

```typescript
// ❌ 現在のコード（reasoning_effort が欠落）
const base: ChatCompletionCreateParamsNonStreaming = {
  model,
  ...getTemperatureParam(model, temperature),
  ...getTokenLimitParam(model, max_tokens),
  ...getPenaltyParams(model, presence_penalty, frequency_penalty),
  messages: [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ],
  ...(SUPPORTS_JSON_MODE.test(model)
    ? { response_format: { type: 'json_object' as const } }
    : {}),
  // ← reasoning_effort パラメータがない
};

const resp = await openai.chat.completions.create(base, {
  signal: controller.signal,
});
```

**正しい形式** (generate-draft から):

```typescript
// ✅ 期待値（generate-draft で実装されている）
...(model.startsWith('gpt-5.6') ? { reasoning_effort: 'low' } : {}),
```

---

## 4. Git 履歴による回帰時期の確認

**generate-final/route.ts の commit 履歴**:

```
f067842 - Remove CRITICAL console logs containing sensitive business data (最新)
cf548d4 - Organize documentation files...
288b07f - Update route.ts
...
```

**最新コミット (f067842) での callOpenAIChat() 実装状況**:

```bash
$ git show f067842:app/api/stage2/generate-final/route.ts | grep -A 15 "const base.*ChatCompletion"
```

→ **reasoning_effort パラメータは存在しない**

---

## 5. 推定時期と原因

### 推定根拠

1. **generate-draft** では reasoning_effort が正しく実装されている
   - Line 1355-1356 で条件付け実装
   - 単純直接呼び出し

2. **generate-final** では callOpenAIChat() を共通関数として使用
   - Line 1028 で openai.chat.completions.create() 呼び出し
   - reasoning_effort が条件付け実装されていない

3. **回帰時期**
   - ✅ generate-draft は期待値通り
   - ❌ generate-final はずっと未実装の可能性（Luna 移行時に generate-draft のみ実装した可能性）

---

## 6. 最終判定

### 回帰が確認されたもの

| 処理 | 目標モデル | 実効モデル | 状態 | 根本原因 | 修正箇所 |
|-----|----------|----------|------|--------|--------|
| **generate-final / Final Strategy主生成** | gpt-5.6-luna | gpt-5.6-luna | ⚠️ **回帰** | reasoning_effort 未設定 | Line 1013-1025 (callOpenAIChat) |
| **generate-final / Final Repair** | gpt-5.6-luna | gpt-5.6-luna | ⚠️ **回帰** | reasoning_effort 未設定 | Line 1013-1025 (callOpenAIChat) |

### 監査誤判定ではなく実際の回帰

- ✅ generate-draft: 完全に正常（Luna 仕様通り）
- ❌ generate-final: callOpenAIChat() の抽象化が reasoning_effort を未実装のまま

---

## 7. 修正方針

### Fix: callOpenAIChat() に reasoning_effort を追加

**ファイル**: app/api/stage2/generate-final/route.ts  
**行**: 1013-1025

```typescript
// 修正前
const base: ChatCompletionCreateParamsNonStreaming = {
  model,
  ...getTemperatureParam(model, temperature),
  ...getTokenLimitParam(model, max_tokens),
  ...getPenaltyParams(model, presence_penalty, frequency_penalty),
  messages: [...],
  ...(SUPPORTS_JSON_MODE.test(model) ? { response_format: { type: 'json_object' } } : {}),
};

// 修正後
const base: ChatCompletionCreateParamsNonStreaming = {
  model,
  ...getTemperatureParam(model, temperature),
  ...getTokenLimitParam(model, max_tokens),
  ...getPenaltyParams(model, presence_penalty, frequency_penalty),
  messages: [...],
  ...(SUPPORTS_JSON_MODE.test(model) ? { response_format: { type: 'json_object' } } : {}),
  ...(model.startsWith('gpt-5.6') ? { reasoning_effort: 'low' } : {}),  // ← 追加
};
```

---

## 8. 検証チェックリスト（修正後）

- [ ] callOpenAIChat() 内の reasoning_effort 条件付け実装確認
- [ ] generate-final の Main 生成が reasoning_effort: 'low' を使用することを確認
- [ ] generate-final の Repair が reasoning_effort: 'low' を使用することを確認
- [ ] lib/modelConfig.ts の AI_MODELS.reasoning が 'gpt-5.6-luna' であることを確認
