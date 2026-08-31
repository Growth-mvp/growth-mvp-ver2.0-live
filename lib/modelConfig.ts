// lib/modelConfig.ts
import modelSpec from '@/config/models.json';

// 型定義
export type ProcessModelRole = 'reasoning' | 'lightweight';
export type ProcessKey = keyof typeof modelSpec.process_configs;

interface ProcessConfig {
  modelRole: ProcessModelRole;
  maxCompletionTokens: number;
  jsonMode: boolean;
}

// AI_MODELS: config/models.json から直接読み込み（環境変数 override なし）
export const AI_MODELS = {
  reasoning: modelSpec.ai_models.reasoning,
  lightweight: modelSpec.ai_models.lightweight,
  legacy: 'gpt-4o',
  standard: 'gpt-4o-mini',
} as const;

export const MODEL_CONFIGURATIONS = modelSpec.process_configs as const;

// OpenAI API パラメータの型定義
interface OpenAIModelParams {
  model: string;
  max_completion_tokens?: number;
  max_tokens?: number;
  reasoning_effort?: 'low';
  temperature?: number;
  presence_penalty?: number;
  frequency_penalty?: number;
  response_format?: { type: 'json_object' };
}

/**
 * 処理に応じた OpenAI API パラメータを生成
 * Luna (gpt-5.6-*) の場合は自動的に reasoning_effort を追加
 * Temperature と penalties は Luna では自動的に除外
 * JSON mode は config で定義された値に従う
 */
export function getOpenAIModelParamsForProcess(
  processKey: ProcessKey,
  options: {
    temperature?: number;
    presencePenalty?: number;
    frequencyPenalty?: number;
  } = {}
): OpenAIModelParams {
  const config = MODEL_CONFIGURATIONS[processKey];
  if (!config) {
    throw new Error(`Unknown process: ${processKey}`);
  }

  const model = config.modelRole === 'reasoning' ? AI_MODELS.reasoning : AI_MODELS.lightweight;
  const isLuna = model.startsWith('gpt-5.6');

  const params: OpenAIModelParams = {
    model,
  };

  // Token limit
  if (isLuna) {
    params.max_completion_tokens = config.maxCompletionTokens;
  } else {
    params.max_tokens = config.maxCompletionTokens;
  }

  // Luna の場合は reasoning_effort を追加
  if (isLuna) {
    params.reasoning_effort = 'low';
  }

  // Temperature を追加（Luna では送らない）
  if (options.temperature !== undefined && !isLuna) {
    params.temperature = options.temperature;
  }

  // Penalties を追加（Luna では送らない）
  if (!isLuna) {
    if (options.presencePenalty !== undefined) {
      params.presence_penalty = options.presencePenalty;
    }
    if (options.frequencyPenalty !== undefined) {
      params.frequency_penalty = options.frequencyPenalty;
    }
  }

  // JSON mode（config で定義された値を使用）
  if (config.jsonMode) {
    params.response_format = { type: 'json_object' };
  }

  return params;
}

// 互換性用の既存関数（既存コード用）
export function getTemperatureParam(
  model: string,
  value: number
): { temperature?: number } {
  if (model.startsWith('gpt-5.6')) {
    return {};
  }
  return { temperature: value };
}

export function getPenaltyParams(
  model: string,
  presencePenalty?: number,
  frequencyPenalty?: number
): Record<string, number> {
  if (model.startsWith('gpt-5.6')) {
    return {};
  }
  const params: Record<string, number> = {};
  if (presencePenalty !== undefined) {
    params.presence_penalty = presencePenalty;
  }
  if (frequencyPenalty !== undefined) {
    params.frequency_penalty = frequencyPenalty;
  }
  return params;
}

export function getTokenLimitParam(
  model: string,
  value: number
): { max_completion_tokens?: number; max_tokens?: number } {
  if (model.startsWith('gpt-5.6')) {
    return { max_completion_tokens: value };
  }
  return { max_tokens: value };
}

// ログ出力（既存コード用）
export function logModelUsage(processName: string, modelType: 'standard' | 'reasoning') {
  const model = modelType === 'standard' ? AI_MODELS.lightweight : AI_MODELS.reasoning;
  if (process.env.NODE_ENV === 'development' || process.env.DEBUG_AI_MODELS === '1') {
    console.log(`[AI] ${processName} → ${modelType} (${model})`);
  }
}

export function getModel(modelType: 'standard' | 'reasoning', processName?: string) {
  const model = modelType === 'standard' ? AI_MODELS.lightweight : AI_MODELS.reasoning;
  if (processName) {
    logModelUsage(processName, modelType);
  }
  return model;
}
