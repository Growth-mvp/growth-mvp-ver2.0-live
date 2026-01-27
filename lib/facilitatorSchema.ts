/**
 * /lib/facilitatorSchema.ts
 * ファシリテーターモードの構造化JSON出力スキーマ（Zod）
 *
 * meta.output='json' のときに LLM 応答を検証する
 * 検証失敗してもcontentは返す（graceful fallback）
 */

import { z } from 'zod';

/**
 * 次アクション（action）の最小スキーマ
 * id: 一意識別子（内部向け）
 * label: ユーザー向け短い説明
 * target: 対象（例: "/cascade", "OKR", "SWOT"）
 * reason: なぜこれをするのか（1-2行）
 */
export const NextActionSchema = z.object({
  id: z.string().optional(),
  label: z.string(),
  target: z.string().optional(),
  reason: z.string().optional(),
});

export type NextAction = z.infer<typeof NextActionSchema>;

/**
 * ファシリテーター出力の最小スキーマ
 *
 * - assistant_message: LLMの応答テキスト（または推奨テキスト）
 * - status: ステータス判定（pass/caution/block）
 * - next_actions: 次アクション配列
 * - confidence: このアドバイスの信頼度（0-1）
 */
export const FacilitatorResponseSchema = z.object({
  assistant_message: z.string().optional(),
  status: z.enum(['pass', 'caution', 'block']).optional(),
  next_actions: z.array(NextActionSchema).optional(),
  confidence: z.number().min(0).max(1).optional(),
});

export type FacilitatorResponse = z.infer<typeof FacilitatorResponseSchema>;

/**
 * JSON出力用の最小応答スキーマ
 * content と合わせて使用される想定
 */
export const StructuredResponseSchema = z.object({
  content: z.string(),
  facilitator: FacilitatorResponseSchema.optional(),
});

export type StructuredResponse = z.infer<typeof StructuredResponseSchema>;

/**
 * JSON文字列をパースしてZodで検証する
 * 失敗時は null を返す（graceful）
 *
 * @param jsonStr - LLMが返したJSON文字列
 * @returns 検証済みオブジェクト、または null
 */
export function safeParseFacilitatorJSON(
  jsonStr: string | null | undefined
): FacilitatorResponse | null {
  if (!jsonStr || typeof jsonStr !== 'string') return null;

  try {
    const parsed = JSON.parse(jsonStr);
    const validated = FacilitatorResponseSchema.safeParse(parsed);
    return validated.success ? validated.data : null;
  } catch {
    return null;
  }
}

/**
 * LLMがJSON出力するときの systemPrompt 追記テンプレート
 * JSON_OUTPUTセクションを systemPrompt に追加する
 */
export function buildJSONOutputInstruction(): string {
  return `
【JSON出力モード】
必ず以下のJSON形式のみで返してください。余計な文章や説明は禁止。

{
  "assistant_message": "ユーザーへの回答（簡潔な1-2文）",
  "status": "pass|caution|block",
  "next_actions": [
    {
      "label": "○○を実施",
      "target": "/cascade",
      "reason": "××のため"
    }
  ],
  "confidence": 0.8
}

注意:
- assistant_message は必ず含める
- next_actions は最大3件
- すべてのフィールドが必須ではない（あるだけでOK）
- JSONの構文エラーは許さない
`.trim();
}
