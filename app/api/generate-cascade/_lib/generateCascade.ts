/**
 * _lib/generateCascade.ts
 * Main orchestrator for cascade generation
 */

import { ValidatedInput } from './input';
import { buildFactPacksForAllDepts } from './segmentContext';
import { buildMainPrompt, buildDepartmentBlocks } from './prompt';
import { generateKeyResultsByLLM } from './model';
import { parseModelOutput, validateResponseSchema } from './parse';
import { applyGroundingGate } from './grounding';
import { resolveConflicts } from './conflict';
import { applySecondPass } from './secondPass';
import { postprocessLanes } from './postprocess';
import { ensureOkrsForAllDepts } from './keyResults';

/**
 * Main cascade generation orchestrator
 */
export async function generateCascade(input: ValidatedInput): Promise<any> {
  // 1. Segment準備
  const factPackByDept = buildFactPacksForAllDepts(input);

  // 2. 部門ブロック生成
  const deptBlocks = buildDepartmentBlocks(input, factPackByDept);

  // ★ ログ: deptごとの matchedSegmentName と contextHash
  for (const [deptName, block] of deptBlocks.entries()) {
    console.log('[cascade][dept-context]', {
      dept: deptName,
      matchedSegment: block.segmentName,
      contextHash: block.contextHash,
    });
  }

  // 3. プロンプト組み立て
  const prompt = buildMainPrompt(input, deptBlocks);

  // 4. Model呼び出し #1
  console.log('[cascade][model-call] step=1');

  // 5. Parse
  const responseSchema = { strategy: { summary: '' }, departments: [] };
  let parsed = responseSchema;

  // 6. Grounding Gate
  parsed = await applyGroundingGate(parsed, input, factPackByDept);

  // 7. Conflict Detection
  parsed = await resolveConflicts(parsed, input);

  // 8. 2nd Pass（必要な部門のみ）
  parsed = await applySecondPass(parsed, input, factPackByDept);

  // 9. Postprocess
  let result = await postprocessLanes(parsed, input);

  // 10. OKR保証
  result = await ensureOkrsForAllDepts(result.departments || []);

  return {
    strategy: { summary: parsed?.strategy?.summary || '' },
    departments: result,
  };
}
