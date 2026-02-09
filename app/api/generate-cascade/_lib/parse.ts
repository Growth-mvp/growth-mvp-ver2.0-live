/**
 * _lib/parse.ts
 * JSON parsing and response validation
 */

import { ResponseSchema } from './schemas';

/**
 * Parse and validate LLM response
 */
export function parseModelOutput(content: string): any {
  try {
    return JSON.parse(content);
  } catch {
    return null;
  }
}

/**
 * Validate response against schema
 */
export function validateResponseSchema(data: any): { success: boolean; data?: any; error?: string } {
  const result = ResponseSchema.safeParse(data);
  if (result.success) {
    return { success: true, data: result.data };
  }
  return { success: false, error: JSON.stringify(result.error) };
}
