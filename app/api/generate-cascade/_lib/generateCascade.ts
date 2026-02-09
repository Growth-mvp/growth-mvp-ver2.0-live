/**
 * _lib/generateCascade.ts
 * Main orchestrator for cascade generation
 */

import { ValidatedInput } from './input';
import { buildFactPacksForAllDepts } from './segmentContext';
import { buildMainPrompt, buildDepartmentBlocks } from './prompt';
import { parseModelOutput } from './parse';
import { callOpenAIJsonWithRetry, extractJsonObject } from '@/app/api/_shared/utils';
import { applyGroundingGate } from './grounding';
import { resolveConflicts } from './conflict';
import { applySecondPass } from './secondPass';
import { postprocessLanes } from './postprocess';
import { ensureOkrsForAllDepts } from './keyResults';

/**
 * Build fallback departments from input
 * Ensures minimum structure: name, segmentName, lanes with empty projects
 */
function buildBaseDepartments(input: ValidatedInput): any[] {
  const inputDepts = Array.isArray(input?.departments) ? input.departments : [];

  return inputDepts
    .map((d: any) => {
      const name = typeof d?.name === 'string' ? d.name.trim() : '';
      if (!name) return null;

      return {
        name,
        segmentName: typeof d?.segmentName === 'string' ? d.segmentName : '',
        direction: typeof d?.direction === 'string' ? d.direction : '',
        expectations: Array.isArray(d?.expectations) ? d.expectations : [],
        focusThemes: Array.isArray(d?.focusThemes) ? d.focusThemes : [],
        answers6: typeof d?.answers6 === 'string' ? d.answers6 : '',
        financeSummary: typeof d?.financeSummary === 'string' ? d.financeSummary : '',
        portfolioPosition: typeof d?.portfolioPosition === 'string' ? d.portfolioPosition : '',
        missionDescription: typeof d?.missionDescription === 'string' ? d.missionDescription : '',
        lanes: {
          existing: { projects: [] },
          new: { projects: [] },
        },
      };
    })
    .filter(Boolean);
}

/**
 * Main cascade generation orchestrator
 * Resilient to OpenAI failures - always returns departments with lanes 2+1
 */
export async function generateCascade(input: ValidatedInput): Promise<any> {
  // 0. Fallback departments from input
  const baseDepts = buildBaseDepartments(input);
  if (baseDepts.length === 0) {
    console.warn('[cascade][init] no departments in input');
    return { strategy: { summary: '' }, departments: [] };
  }

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

  // 4. Model呼び出し（OpenAI失敗に強靭化）
  console.log('[cascade][model-call] step=1');

  let departments: any[] = baseDepts; // Fallback初期値

  try {
    // OpenAI API呼び出し
    const modelResponse = await callOpenAIJsonWithRetry(
      prompt,
      'あなたは世界最高の経営戦略コンサルタントです。JSON のみを返してください。',
      'cascade-generation'
    );

    if (modelResponse && modelResponse.trim()) {
      // Parse & Validate
      const parsed = parseModelOutput(modelResponse);
      const validatedDepts = Array.isArray(parsed?.departments) ? parsed.departments : [];

      if (validatedDepts.length > 0) {
        departments = validatedDepts;
        console.log(`[cascade][model] ok depts=${validatedDepts.length}`);
      } else {
        console.log('[cascade][model] empty -> fallback');
      }
    } else {
      console.log('[cascade][model] null response -> fallback');
    }
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.warn(`[cascade][model] error -> fallback err="${errMsg.slice(0, 100)}"`);
    // departments は baseDepts のまま
  }

  // 5. Parse - departments で初期化
  let parsed = {
    strategy: { summary: '' },
    departments: departments,
  };

  // 6. Grounding Gate
  parsed = await applyGroundingGate(parsed, input, factPackByDept);

  // 7. Conflict Detection
  parsed = await resolveConflicts(parsed, input, factPackByDept);

  // 8. 2nd Pass（必要な部門のみ）
  parsed = await applySecondPass(parsed, input, factPackByDept);

  // 9. Postprocess - lanes 2+1 を保証
  let result = await postprocessLanes(parsed, input);

  // 10. OKR保証
  result = await ensureOkrsForAllDepts(result.departments || []);

  return {
    strategy: { summary: parsed?.strategy?.summary || '' },
    departments: result,
  };
}
