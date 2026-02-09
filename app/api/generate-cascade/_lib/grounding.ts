/**
 * _lib/grounding.ts
 * Grounding validation for cascade projects
 * Implements citation checking, fact-id validation, and regeneration retry logic
 */

import { callOpenAIJsonWithRetry, extractJsonObject } from '@/app/api/_shared/utils';
import { ProjectSchema } from './schemas';

/* =========================
 * Helper functions: Citation and fact-id validation
 * ========================= */

/**
 * Count fact-id occurrences in text
 * Matches patterns like (fact-...) or （fact-...）
 */
const countFactIds = (text: string): number => {
  // [（(] で全角か半角の開き括弧、[）)] で全角か半角の閉じ括弧
  const factIdPattern = /[（(][^）)]*fact-[^）)]*[)）]/g;
  const matches = text.match(factIdPattern);
  return matches?.length ?? 0;
};

/**
 * Count inline quoted citations with fact-ids
 * Matches patterns like 「text」(fact-id) or 『text』(fact-id)
 */
const countInlineQuotes = (p: any): number => {
  const text = `${p?.reason ?? ''} ${p?.hypothesis ?? ''}`;
  // 引用符が 「」 または 『』、括弧が () または （） の両パターンに対応
  // パターン: [「『]...[」』] \s* [（(]...(fact-...)[)）]
  const citationPattern = /[「『][^」』]+[」』]\s*[（(][^）)]*fact-[^）)]*[)）]/g;
  const matches = text.match(citationPattern);
  return matches?.length ?? 0;
};

/**
 * Get grounding level for a project
 * Level A: citations>=2 AND fact-id出現2回以上
 * Level B: citations>=2 but fact-id<2
 * Level C: citations<2
 */
const getGroundingLevel = (
  p: any
): { level: 'A' | 'B' | 'C'; matchCount: number; factIdCount: number } => {
  const citations = Array.isArray(p?.citations) ? p.citations : [];
  const text = `${p?.reason ?? ''} ${p?.hypothesis ?? ''}`;
  const inlineQuoteMatches = countInlineQuotes(p);
  const factIdMatches = countFactIds(text);

  // Level A: citations>=2 && fact-id 出現 >=2（reason+hypothesisのどこか）
  if (citations.length >= 2 && factIdMatches >= 2) {
    return { level: 'A', matchCount: inlineQuoteMatches, factIdCount: factIdMatches };
  }

  // Level B: citations>=2 だが fact-id 出現 1回以下
  if (citations.length >= 2) {
    return { level: 'B', matchCount: inlineQuoteMatches, factIdCount: factIdMatches };
  }

  // Level C: citations<2
  return { level: 'C', matchCount: inlineQuoteMatches, factIdCount: factIdMatches };
};

/**
 * Check if project has inline quoted citations
 */
const hasInlineQuotes = (p: any): boolean => {
  return countInlineQuotes(p) >= 2;
};

/**
 * Check if project is grounded (Level A)
 */
const isProjectGrounded = (p: any): boolean => {
  const groundingLevel = getGroundingLevel(p);
  return groundingLevel.level === 'A';
};

/**
 * Check if project has all required fields
 */
const hasRequiredFields = (p: any): boolean => {
  if (!p?.title || !p?.reason || !p?.hypothesis) return false;
  if (!p?.mainLever || !p?.kind || !p?.horizon) return false;
  if (!Array.isArray(p?.valueDriverLinks) || p.valueDriverLinks.length < 1) return false;
  if (!p?.skillRequirements) return false;
  if (!Array.isArray(p?.humanInvestments) || p.humanInvestments.length < 1) return false;
  return true;
};

/* =========================
 * Tracking sets for grounding/conflict/risk issues
 * ========================= */

const groundingFailedDepts = new Set<string>();
const conflictFailedDepts = new Set<string>();
const highRiskDepts = new Set<string>();

/* =========================
 * Main grounding verification function
 * ========================= */

/**
 * Check all projects for grounding requirements
 * Attempts regeneration with retry prompt if level !== 'A'
 */
async function groundingCheckAndRetry(
  depts: any[],
  factPackByDept: Map<string, any>
): Promise<void> {
  const failedProjects: Array<{
    deptIndex: number;
    deptName: string;
    laneType: 'existing' | 'new';
    projectIndex: number;
    slot: number;
    project: any;
    groundingLevel: string;
    citationCount: number;
    factIdCount: number;
    matchCount: number;
  }> = [];

  // 失敗したproject特定
  for (let dIdx = 0; dIdx < depts.length; dIdx++) {
    const dept = depts[dIdx];
    const deptName = dept?.name ?? `dept_${dIdx}`;

    // existing lane
    if (dept?.lanes?.existing?.projects) {
      for (let pIdx = 0; pIdx < dept.lanes.existing.projects.length; pIdx++) {
        const proj = dept.lanes.existing.projects[pIdx];
        const groundingLevel = getGroundingLevel(proj);

        if (groundingLevel.level !== 'A') {
          const slot = pIdx + 1;
          const citationCount = Array.isArray(proj?.citations) ? proj.citations.length : 0;

          // デバッグログ: isProjectGrounded が false のとき詳細出力
          const reasonHead = (proj?.reason ?? '').slice(0, 200);
          const hypothesisHead = (proj?.hypothesis ?? '').slice(0, 200);
          console.log(
            `[cascade][grounding][ng] dept=${deptName} lane=existing slot=${slot} ` +
            `level=${groundingLevel.level} citations=${citationCount} factIdCount=${groundingLevel.factIdCount} matchCount=${groundingLevel.matchCount}\n` +
            `  reason[0:200]="${reasonHead}"\n` +
            `  hypothesis[0:200]="${hypothesisHead}"\n` +
            `  citations=[${(proj?.citations ?? []).join(', ')}]`
          );

          failedProjects.push({
            deptIndex: dIdx,
            deptName,
            laneType: 'existing',
            projectIndex: pIdx,
            slot,
            project: proj,
            groundingLevel: groundingLevel.level,
            citationCount,
            factIdCount: groundingLevel.factIdCount,
            matchCount: groundingLevel.matchCount,
          });
        }
      }
    }

    // new lane
    if (dept?.lanes?.new?.projects) {
      for (let pIdx = 0; pIdx < dept.lanes.new.projects.length; pIdx++) {
        const proj = dept.lanes.new.projects[pIdx];
        const groundingLevel = getGroundingLevel(proj);

        if (groundingLevel.level !== 'A') {
          const slot = 3 + pIdx;
          const citationCount = Array.isArray(proj?.citations) ? proj.citations.length : 0;

          // デバッグログ: isProjectGrounded が false のとき詳細出力
          const reasonHead = (proj?.reason ?? '').slice(0, 200);
          const hypothesisHead = (proj?.hypothesis ?? '').slice(0, 200);
          console.log(
            `[cascade][grounding][ng] dept=${deptName} lane=new slot=${slot} ` +
            `level=${groundingLevel.level} citations=${citationCount} factIdCount=${groundingLevel.factIdCount} matchCount=${groundingLevel.matchCount}\n` +
            `  reason[0:200]="${reasonHead}"\n` +
            `  hypothesis[0:200]="${hypothesisHead}"\n` +
            `  citations=[${(proj?.citations ?? []).join(', ')}]`
          );

          failedProjects.push({
            deptIndex: dIdx,
            deptName,
            laneType: 'new',
            projectIndex: pIdx,
            slot,
            project: proj,
            groundingLevel: groundingLevel.level,
            citationCount,
            factIdCount: groundingLevel.factIdCount,
            matchCount: groundingLevel.matchCount,
          });
        }
      }
    }
  }

  // 失敗projectがあれば再生成（最大1回）
  if (failedProjects.length > 0) {
    for (const failed of failedProjects) {
      const dept = depts[failed.deptIndex];
      const deptName = dept?.name ?? '';
      const slot = failed.slot;

      console.log(
        `[cascade][grounding][retry] dept=${deptName} slot=${slot} level=${failed.groundingLevel} ` +
        `citations=${failed.citationCount} factIdCount=${failed.factIdCount} matchCount=${failed.matchCount}`
      );

      // FACTPACK anchors を取得
      const factPack = factPackByDept.get(deptName);
      const anchorsList = factPack?.anchors ?? [];
      const anchorsText = anchorsList
        .map((a: any) => `  - ${a.id}: ${a.text}`)
        .join('\n');

      // テンプレ文：2つのanchorを「text」(fact-id)で埋める形式を強制
      const templateExample = anchorsList.length >= 2
        ? `例：「${anchorsList[0].text}」(${anchorsList[0].id}) により${anchorsList[0].text.slice(0, 20)}が確認でき、` +
          `「${anchorsList[1].text}」(${anchorsList[1].id}) の観点から戦略を立案する`
        : '例：「主要な事実」(fact-...) のサポートのもと、「別の事実」(fact-...) と組み合わせて提案する';

      // 再生成prompt
      const retryPrompt = `
前回のプロジェクト案では、引用ベース生成の要件を満たしていません。
現在の状況：
- citations数: ${failed.citationCount}/2 (必須: 2個以上)
- fact-id出現数: ${failed.factIdCount} (必須: 1回以上)
- 引用フォーマット数: ${failed.matchCount} (推奨: 2回以上)

以下の部門について、${failed.laneType === 'existing' ? '既存進化レーン' : '新規探索レーン'}のプロジェクト案を修正してください：

部門: ${deptName}

【このセグメントで利用可能なFACTPACK anchors】
${anchorsText || '（利用可能なanchorsなし）'}

【修正必須条件】
1. citations は最低2個の anchor ID を含むこと（上記リストから選択すること、捏造禁止）
2. reason と hypothesis に 「text」(fact-id) 形式で最低2箇所含めること（必ず括弧内に fact-id を記入）
   ${templateExample}
3. 固有名詞（顧客名/製品名/工程）を title に必須で含めること
4. 他の部門と異なるanchorsを選ぶこと

前回の出力（参考）：
${JSON.stringify(failed.project, null, 2)}

修正後のプロジェクト案の JSON のみを返してください：

{
  "title": "...",
  "reason": "...",
  "hypothesis": "...",
  "mainLever": "ACQ" | "ARPU" | "CHURN" | "COST" | "EFFICIENCY" | "FUTURE",
  "horizon": "short" | "mid" | "long",
  "kind": "growth" | "cost" | "efficiency" | "future",
  "citations": ["fact-...", "fact-..."],
  "valueDriverLinks": [...],
  "skillRequirements": {...},
  "humanInvestments": [...],
  "generatedBy": "ai",
  "generatedSlot": ${slot},
  "generatedGroup": "cascade_v1"
}
`.trim();

      try {
        // OpenAI リトライ機能を使用（fetch failed/UND_ERR_SOCKET 対策）
        const retryRaw = await callOpenAIJsonWithRetry(
          retryPrompt,
          '修正プロジェクト案の JSON のみを返してください。日本語で。',
          `grounding-retry-dept=${deptName}`
        );
        const retryParsed = extractJsonObject(retryRaw);

        if (retryParsed) {
          const retrySafe = ProjectSchema.safeParse(retryParsed);
          const retryProject = retrySafe.success ? retrySafe.data : retryParsed;

          // 再検証: grounding + required fields
          if (isProjectGrounded(retryProject) && hasRequiredFields(retryProject)) {
            // 成功：差し替え
            if (failed.laneType === 'existing') {
              depts[failed.deptIndex].lanes.existing.projects[failed.projectIndex] = retryProject;
            } else {
              depts[failed.deptIndex].lanes.new.projects[failed.projectIndex] = retryProject;
            }
            console.log(`[cascade][grounding][retry-success] dept=${deptName} slot=${slot}`);
          } else {
            // 再生成でもNGなら fallback（既存結果を採用）
            const failReason = !isProjectGrounded(retryProject) ? 'grounding_ng' : 'required_fields_missing';
            console.warn(`[cascade][grounding][fail] dept=${deptName} slot=${slot} reason="${failReason}" (再生成でも条件未充足、既存結果を採用)`);
            // grounding failed として記録
            groundingFailedDepts.add(deptName);
          }
        } else {
          // JSON解析失敗なら fallback
          console.warn(`[cascade][grounding][fail] dept=${deptName} slot=${slot} reason="retry_json_parse_error"`);
          // grounding failed として記録
          groundingFailedDepts.add(deptName);
        }
      } catch (err) {
        console.warn(`[cascade][grounding][fail] dept=${deptName} slot=${slot} reason="retry_error" error=${err instanceof Error ? err.message : String(err)}`);
        // grounding failed として記録
        groundingFailedDepts.add(deptName);
      }
    }
  }
}

/* =========================
 * Public API
 * ========================= */

/**
 * Apply grounding gate - validates citations and regenerates if needed
 *
 * @param parsed - Parsed cascade data with departments
 * @param input - Original input (unused but kept for interface compatibility)
 * @param factPackByDept - Map of department names to FACTPACK anchors
 * @returns Parsed data with grounding-validated projects
 */
export async function applyGroundingGate(
  parsed: any,
  input: any,
  factPackByDept: Map<string, any>
): Promise<any> {
  if (!parsed?.departments) {
    return parsed;
  }

  const normalized = {
    ...parsed,
    departments: parsed.departments,
  };

  // TASK 2-2: Grounding validation and retry
  await groundingCheckAndRetry(normalized.departments, factPackByDept);

  return normalized;
}

/* =========================
 * Export tracking sets for other modules
 * ========================= */

export { groundingFailedDepts, conflictFailedDepts, highRiskDepts };
