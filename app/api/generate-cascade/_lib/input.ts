/**
 * _lib/input.ts
 * Input validation and parsing
 */

import { ReqSchema, ReqSchemaType } from './schemas';

export type ValidatedInput = ReqSchemaType;

/**
 * Parse and validate generate-cascade request
 */
export function parseGenerateCascadeInput(body: any): ValidatedInput {
  const result = ReqSchema.safeParse(body);
  if (!result.success) {
    throw new Error(`Invalid request: ${JSON.stringify(result.error.errors)}`);
  }
  return result.data as ValidatedInput;
}
