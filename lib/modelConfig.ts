// lib/modelConfig.ts
// OpenAI モデル設定: reasoning (戦略判断) と lightweight (軽量処理) の役割分担

export const AI_MODELS = {
  // reasoning: 戦略判断・因果推論など重要な処理 (gpt-5.6-luna)
  // 用途: STAGE2の最終戦略生成・リペア・中計設計、STAGE3の展開推論、組織変革の認識分析など
  reasoning: process.env.OPENAI_REASONING_MODEL || 'gpt-5.6-luna',

  // lightweight: 軽量な生成・整理・分類 (gpt-4o-mini)
  // 用途: 感情エディット、文章整形、JSON生成、分類など
  lightweight: process.env.OPENAI_LIGHTWEIGHT_MODEL || 'gpt-4o-mini',

  // legacy: 既存ロジックで使用中のモデル（当面は gpt-4o）
  // 用途: STAGE4以降など、まだ振り分け対象外の処理
  legacy: process.env.OPENAI_LEGACY_MODEL || 'gpt-4o',

  // standard: 互換性用（lightweight と同じ）
  standard: process.env.OPENAI_STANDARD_MODEL || 'gpt-4o-mini',
} as const;

// モデル使用ログ (開発環境用)
export function logModelUsage(processName: string, modelType: 'standard' | 'reasoning') {
  const model = modelType === 'standard' ? AI_MODELS.standard : AI_MODELS.reasoning;
  if (process.env.NODE_ENV === 'development' || process.env.DEBUG_AI_MODELS === '1') {
    console.log(`[AI] ${processName} → ${modelType} (${model})`);
  }
}

// モデル名の取得 (プロセス名とともにログ出力)
export function getModel(modelType: 'standard' | 'reasoning', processName?: string) {
  const model = modelType === 'standard' ? AI_MODELS.standard : AI_MODELS.reasoning;
  if (processName) {
    logModelUsage(processName, modelType);
  }
  return model;
}

// GPT-5.6 Luna では max_tokens ではなく max_completion_tokens を使用
export function getTokenLimitParam(model: string, value: number) {
  if (model.startsWith('gpt-5.6')) {
    return { max_completion_tokens: value };
  }
  return { max_tokens: value };
}

// GPT-5.6 Luna では temperature をサポートしていないため、パラメータを省略
export function getTemperatureParam(model: string, value: number) {
  if (model.startsWith('gpt-5.6')) {
    return {};
  }
  return { temperature: value };
}

// GPT-5.6 Luna では presence_penalty / frequency_penalty をサポートしていないため、パラメータを省略
export function getPenaltyParams(
  model: string,
  presencePenalty?: number,
  frequencyPenalty?: number
) {
  if (model.startsWith('gpt-5.6')) {
    return {};
  }
  return {
    ...(presencePenalty !== undefined ? { presence_penalty: presencePenalty } : {}),
    ...(frequencyPenalty !== undefined ? { frequency_penalty: frequencyPenalty } : {}),
  };
}

// STAGE2 モデル構成の回帰防止チェック（ビルド時に実行）
export function validateStage2ModelConfig() {
  const errors: string[] = [];

  // 期待値の確認
  const expectations = {
    reasoning: 'gpt-5.6-luna',
    lightweight: 'gpt-4o-mini',
  };

  // reasoning が gpt-5.6-luna か確認
  if (!AI_MODELS.reasoning.includes('gpt-5.6')) {
    errors.push(`❌ AI_MODELS.reasoning must be gpt-5.6-luna, but got: ${AI_MODELS.reasoning}`);
  }

  // lightweight が gpt-4o-mini か確認
  if (!AI_MODELS.lightweight.includes('gpt-4o-mini')) {
    errors.push(`❌ AI_MODELS.lightweight must be gpt-4o-mini, but got: ${AI_MODELS.lightweight}`);
  }

  // エラーがあればスローしない（ビルド失敗にしない）が、コンソールに出力
  if (errors.length > 0 && process.env.NODE_ENV !== 'production') {
    console.error('[STAGE2 Model Config] Potential regression detected:\n', errors.join('\n'));
  }

  return { isValid: errors.length === 0, errors };
}
