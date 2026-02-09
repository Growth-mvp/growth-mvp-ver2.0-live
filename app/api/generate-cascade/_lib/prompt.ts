/**
 * _lib/prompt.ts
 * Prompt template generation and assembly
 */

export type DepartmentBlock = {
  name: string;
  segmentName?: string;
  direction?: string;
  expectations?: string[];
  focusThemes?: string[];
  answers6?: string;
  financeSummary?: string;
  portfolioPosition?: string;
  contextHash?: string;

  // 内部利用：プロンプト組み立て用（表示用ではない）
  factPackBlock?: string;
  uniquenessRule?: string;
  segGuardBlock?: string;
};

type FactAnchor = { id: string; text: string };
type DeptFactPackLike = {
  segmentName?: string;
  anchors?: FactAnchor[];
  customers?: string[];
  overview?: string;
};

const asArray = <T = any>(v: any): T[] => (Array.isArray(v) ? v : []);

const safeStr = (v: any) => (typeof v === 'string' ? v : v == null ? '' : String(v));

function stripAiPrefix(s: string) {
  return safeStr(s).replace(/^\s*\[ai#\d+\]\s*/i, '').trim();
}

function joinNonEmpty(lines: string[], sep = '\n') {
  return lines.map(safeStr).map(s => s.trim()).filter(Boolean).join(sep);
}

function buildFactPackBlock(factPack?: DeptFactPackLike, segKey?: string) {
  if (!factPack) {
    return `\n\n[FACTPACK]\n- segment: ${segKey}\n- anchors: （利用可能な事実なし）`;
  }
  const anchors = asArray<FactAnchor>(factPack.anchors);
  const customers = asArray<string>(factPack.customers);
  const customerLines =
    customers.length > 0 ? `\n- customers: ${customers.map(c => `"${c}"`).join(', ')}` : '';
  const anchorLines =
    anchors.length > 0
      ? anchors.map(a => `  - ${a.id}: "${a.text}"`)
          .join('\n')
      : '  - （利用可能なanchorsなし）';

  return `\n\n[FACTPACK]\n- segment: ${factPack.segmentName}${customerLines}\n- anchors (必ず2つ以上を reason/hypothesis で引用すること):\n${anchorLines}`;
}

function buildUniquenessRule(deptName: string) {
  return `
[UNIQUENESS_CONSTRAINT]
- 生成するプロジェクト案は「他部門と同一/酷似」禁止
- existing lane の各プロジェクト title は必ず "${deptName}：" で始める（例："${deptName}：既存顧客のLTV改善"）
- new lane の各プロジェクト title も必ず "${deptName}：" で始める（例："${deptName}：新規用途開拓の検証"）
- hypothesis と reason には、必ず [SEGMENT] の要素（overview/customers/PL/BS のどれか）を最低1つ"引用"して根拠にする
- 禁止：汎用テンプレ（DX推進/業務効率化/新規開拓 だけの抽象表現）で終わらせること`.trim();
}

function buildSegmentGuardBlock(allowedSegmentName?: string, forbiddenSegmentNames: string[] = [], forbiddenTokens: string[] = []) {
  const allowed = allowedSegmentName ? `"${allowedSegmentName}"` : '（未指定）';
  const forbSegs =
    forbiddenSegmentNames.length > 0 ? forbiddenSegmentNames.map(s => `"${s}"`).join(', ') : '（なし）';
  const forbTokens =
    forbiddenTokens.length > 0 ? forbiddenTokens.slice(0, 20).map(s => `"${s}"`).join(', ') : '（なし）';

  return `
[SEGMENT_GUARD - セグメント汚染防止]
- 許可セグメント: ${allowed}
- 禁止セグメント: ${forbSegs}
- 禁止トークン（タイトル/理由/仮説に混入しやすい語）: ${forbTokens}
- title / reason / hypothesis に「禁止セグメント名」「禁止トークン」を混入させないこと
`.trim();
}

function hashForContext(s: string): string {
  // 軽量・安定（暗号用途ではない）
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16);
}

/**
 * Build department-specific context
 */
export function buildDepartmentBlocks(input: any, factPackByDept: Map<string, any>): Map<string, DepartmentBlock> {
  const blocks = new Map<string, DepartmentBlock>();

  const departments = asArray<any>(input?.departments);
  const allBusinessSegments = asArray<any>(input?.allBusinessSegments);

  for (const d of departments) {
    const name = safeStr(d?.name || d?.departmentName || d?.title);
    if (!name) continue;

    const segmentName =
      safeStr(d?.segmentName) ||
      safeStr(d?.businessSegmentName) ||
      safeStr(d?.segment?.name) ||
      safeStr(allBusinessSegments.find((s: any) => safeStr(s?.name) === name)?.segmentName) ||
      safeStr(allBusinessSegments.find((s: any) => safeStr(s?.departmentName) === name)?.segmentName);

    const direction = safeStr(d?.direction || d?.strategyDirection || d?.role || d?.positioning);

    const expectations = asArray<string>(d?.expectations);
    const focusThemes = asArray<string>(d?.focusThemes);

    // answers6 は “文字列に整形した回答” を想定（route 側で answersText 作ってたはず）
    // ここでは柔軟に拾う（配列/オブジェクトでも文字列化して一旦プロンプトへ）
    const answers6 =
      safeStr(d?.answers6Text) ||
      safeStr(d?.answers6) ||
      safeStr(d?.answersText) ||
      (() => {
        const a6 = d?.answers6;
        if (Array.isArray(a6)) return a6.map((x, i) => `Q${i + 1}: ${safeStr(x)}`).join('\n');
        if (a6 && typeof a6 === 'object') return Object.entries(a6).map(([k, v]) => `${k}: ${safeStr(v)}`).join('\n');
        return '';
      })();

    const financeSummary =
      safeStr(d?.financeSummary) ||
      safeStr(d?.segmentFinanceSummary) ||
      safeStr(d?.plSummary) ||
      safeStr(d?.segmentPlSummary);

    const portfolioPosition =
      safeStr(d?.portfolioPosition) ||
      safeStr(d?.portfolio) ||
      safeStr(d?.position) ||
      safeStr(d?.portfolioLabel);

    const factPack = factPackByDept?.get(name) as DeptFactPackLike | undefined;
    const factPackBlock = buildFactPackBlock(factPack, segmentName || name);

    // bannedTitles は route 側で組むのが理想だが、ここでも最低限拾う
    const uniquenessRule = buildUniquenessRule(name);

    // Segment guard: allowed=この部門の segmentName、forbidden=他部門 segment
    const forbiddenSegmentNames = asArray<any>(allBusinessSegments)
      .map(s => safeStr(s?.segmentName || s?.name || s?.departmentName))
      .filter(Boolean)
      .filter(s => s !== (segmentName || name));

    // forbiddenTokens は route だと titles/keywords から作ってたが、ここは軽量に “他セグメント名” を転用
    const forbiddenTokens = forbiddenSegmentNames
      .flatMap(s => [s, s.replace(/(事業部|本部|部門|部)$/g, '')])
      .filter(Boolean);

    const segGuardBlock = buildSegmentGuardBlock(segmentName || name, forbiddenSegmentNames, forbiddenTokens);

    const ctxMaterial = joinNonEmpty(
      [
        name,
        segmentName ? `segment:${segmentName}` : '',
        direction ? `direction:${direction}` : '',
        expectations.length ? `expectations:${expectations.join('|')}` : '',
        focusThemes.length ? `focusThemes:${focusThemes.join('|')}` : '',
        answers6 ? `answers6:${answers6}` : '',
        financeSummary ? `finance:${financeSummary}` : '',
        portfolioPosition ? `portfolio:${portfolioPosition}` : '',
        factPackBlock,
      ],
      '\n'
    );

    const contextHash = hashForContext(ctxMaterial);

    blocks.set(name, {
      name,
      segmentName,
      direction,
      expectations,
      focusThemes,
      answers6,
      financeSummary,
      portfolioPosition,
      contextHash,
      factPackBlock,
      uniquenessRule,
      segGuardBlock,
    });
  }

  return blocks;
}

/**
 * Build main cascade prompt
 */
export function buildMainPrompt(input: any, deptBlocks: Map<string, DepartmentBlock>): string {
  const companyName = safeStr(input?.companyName || input?.company?.name || '');
  const mvv = safeStr(input?.mvv || input?.missionVisionValue || input?.mission || '');
  const story = safeStr(input?.strategyStory || input?.story || '');
  const swot = safeStr(input?.swot || input?.swotSummary || '');
  const winPatterns = asArray<any>(input?.winPatterns || input?.winPatternCandidates || []).map(x => safeStr(x?.title || x)).filter(Boolean);

  // 部門ブロックの並び（入力順に近いものを優先）
  const deptOrder = asArray<any>(input?.departments).map(d => safeStr(d?.name || d?.departmentName || d?.title)).filter(Boolean);
  const orderedNames = deptOrder.length
    ? deptOrder.filter(n => deptBlocks.has(n))
    : Array.from(deptBlocks.keys());

  const deptSections = orderedNames.map((name) => {
    const b = deptBlocks.get(name);
    if (!b) return '';
    const answersText = b.answers6
      ? `\n[部門の現状認識]\n${b.answers6}\n`
      : '';

    const focusThemes = b.focusThemes?.length
      ? `\n[注力領域の意味づけ]\n- ${b.focusThemes.join('\n- ')}\n`
      : '';

    const expectations = b.expectations?.length
      ? `\n[経営チームからの期待]\n- ${b.expectations.join('\n- ')}\n`
      : '';

    const finance = b.financeSummary
      ? `\n[財務・業績]\n${b.financeSummary}\n`
      : '';

    const portfolio = b.portfolioPosition
      ? `\n[portfolio]\n${b.portfolioPosition}\n`
      : '';

    return `
[部門] ${name}
${answersText}${focusThemes}${expectations}${finance}${portfolio}
${b.factPackBlock ?? ''}
${b.uniquenessRule ?? ''}
${b.segGuardBlock ?? ''}
`.trim();
  }).filter(Boolean).join('\n\n' + '-'.repeat(40) + '\n\n');

  const winPatternBlock = winPatterns.length
    ? `\n[勝ち筋候補]\n- ${winPatterns.join('\n- ')}\n`
    : '';

  // 2レーン + 必須フィールド + 引用強制（route.ts でやってた骨格）
  const instructions = `
あなたは世界最高の経営戦略コンサルタントです。以下の情報をもとに、部門ごとの提案を作成してください。

【重要ルール】
- 出力は必ず JSON のみ（前後に説明文を付けない）
- 部門ごとに「既存進化 2本 + 新規探索 1本」の合計3プロジェクトを厳守
- 既存進化（existing）：短期〜中期（今年〜3年）でPLに効く改善/成長（mainLeverはACQ/ARPU/CHURN/COST/EFFICIENCY中心）
- 新規探索（new）：将来成長の仮説検証（mainLeverはFUTURE中心、ただしACQ/ARPU等でも可）
- 各プロジェクトは必ず citations を含み、最低2つの fact-id を入れる（FACTPACK anchorsから選ぶ）
- reason と hypothesis には、FACTPACK anchors の内容を「引用」形式で最低2回入れること：
  例）「○○…」(fact-seg-1) のように本文中へ埋め込む
- valueDriverLinks は最低1件、humanInvestments は最低1件を必ず含める
- title は必ず部門固有（他部門や一般論の焼き直し禁止、UNIQUENESS_CONSTRAINT を遵守）
- SEGMENT_GUARD を厳守（他セグメント名/トークン混入禁止）

【出力JSONスキーマ（概形）】
{
  "departments": [
    {
      "name": "部門名",
      "missionDescription": "部門ミッション（短い説明）",
      "lanes": {
        "existing": {
          "projects": [
            {
              "title": "...",
              "reason": "...",
              "hypothesis": "...",
              "mainLever": "ACQ" | "ARPU" | "CHURN" | "COST" | "EFFICIENCY" | "FUTURE",
              "horizon": "short" | "mid" | "long",
              "kind": "growth" | "cost" | "efficiency" | "future",
              "citations": ["fact-...", "fact-..."],
              "valueDriverLinks": [{"driver":"...", "kpi":"...", "logic":"..."}],
              "skillRequirements": { "executionSkills": ["..."], "roleSkills": ["..."] },
              "humanInvestments": [{ "category":"TRAINING_OJT|HIRING|EXTERNAL|TOOLS_PROCESS|ALLOCATION", "title":"...", "detail":"...", "owner":"", "horizon":"0_3M|3_6M|6_12M" }],
              "generatedBy": "ai",
              "generatedSlot": 1,
              "generatedGroup": "cascade_v1"
            }
          ]
        },
        "new": {
          "projects": [ { ... generatedSlot: 3 ... } ]
        }
      }
    }
  ]
}

【会社情報】
- companyName: ${companyName || '（未指定）'}
${mvv ? `- MVV:\n${mvv}\n` : ''}${story ? `- Strategy Story:\n${story}\n` : ''}${swot ? `- SWOT:\n${swot}\n` : ''}${winPatternBlock}
`.trim();

  return `${instructions}\n\n【部門別情報】\n\n${deptSections}\n`;
}
