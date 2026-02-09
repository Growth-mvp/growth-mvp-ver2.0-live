/**
 * _lib/secondPass.ts
 * Second pass generation for departments with issues (duplicates, grounding failures, conflicts)
 *
 * Implements retry logic for departments that failed validation during first pass.
 * Applies SEGMENT_GUARD constraints to prevent vocabulary contamination across segments.
 */

import { callOpenAIJsonWithRetry, extractJsonObject } from '@/app/api/_shared/utils';
import { STOP_WORDS_TASK3, GENERIC_BASE_TITLES } from './constants';
import { ProjectSchema } from './schemas';
import { pickName } from './utils';

/**
 * Simple normalization: lowercase, remove spaces and special symbols
 */
function normalizeLoose(s: string): string {
  return (s ?? '')
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/[・･]/g, '・')
    .replace(/(事業部|本部|部門|部)$/g, '')
    .trim();
}

/**
 * SEGMENT_GUARD normalization for allowed segment name checking
 */
function normalizeForGuard(s: string): string {
  return (s ?? '')
    .toLowerCase()
    .replace(/\s+/g, '')           // スペース除去
    .replace(/[　\s]/g, '')         // 全角スペース除去
    .replace(/[・・\-\/_]/g, '')    // 記号除去（・ / - など）
    .replace(/(事業部|本部|部門|部)$/g, '') // サフィックス除去
    .trim();
}

/**
 * Title similarity normalization
 */
function normalizeForSim(title: string): string {
  return (title ?? '')
    .toLowerCase()
    .replace(/\[ai#\d+\]\s*/i, '') // [AI#1] を除去
    .replace(/^[^：:]+[：:]\s*/, '') // 部門名prefix を除去
    .replace(/[【】「」（）『』\[\]()・：:—\-\s]/g, '') // 記号を除去
    .trim();
}

/**
 * Jaccard distance (set similarity)
 */
function jaccard(s1: string, s2: string): number {
  const set1 = new Set((s1 ?? '').split(''));
  const set2 = new Set((s2 ?? '').split(''));
  const intersection = new Set([...set1].filter((x: string) => set2.has(x)));
  const union = new Set([...set1, ...set2]);
  if (union.size === 0) return 1; // 両方空
  return intersection.size / union.size;
}

/**
 * Check if any token appears in the blob
 */
function containsAny(blob: string, tokens: string[]): string | null {
  const b = normalizeLoose(blob);
  for (const tok of tokens) {
    const t = normalizeLoose(tok);
    if (!t) continue;
    if (b.includes(t)) return tok;
  }
  return null;
}

/**
 * Extract tokens from segment name (split by symbols)
 */
function splitSegmentNameTokens(name: string): string[] {
  return (name ?? '')
    .split(/[・\-_\s]+/)
    .filter(Boolean)
    .map(s => s.trim())
    .filter(s => s.length >= 2);
}

/**
 * Extract keywords from text (simple word extraction)
 */
function pickKeywords(text: string): string[] {
  const normalizedText = (text ?? '')
    .toLowerCase()
    .replace(/[【】「」（）『』\[\]()・：:—\-\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const tokens = normalizedText.split(/[^一-龠ぁ-んァ-ヶa-zA-Z0-9]+/).filter(Boolean);
  const filtered = tokens.filter((tok: string) => tok.length >= 3);
  return Array.from(new Set(filtered)).slice(0, 20);
}

/**
 * Collect all project titles and their corresponding department names
 */
function collectAllTitles(depts: any[]): Map<string, { deptNames: string[]; count: number }> {
  const titleMap = new Map<string, { deptNames: string[]; count: number }>();

  for (const dept of depts || []) {
    const deptName = dept?.name ?? '';
    const projects = [
      ...(dept?.lanes?.existing?.projects ?? []),
      ...(dept?.lanes?.new?.projects ?? []),
      ...(dept?.projects ?? []),
    ];

    for (const proj of projects) {
      const rawTitle = proj?.title ?? '';
      const baseTitle = normalizeForSim(rawTitle);

      if (!baseTitle) continue;

      if (!titleMap.has(baseTitle)) {
        titleMap.set(baseTitle, { deptNames: [], count: 0 });
      }

      const entry = titleMap.get(baseTitle)!;
      if (!entry.deptNames.includes(deptName)) {
        entry.deptNames.push(deptName);
      }
      entry.count += 1;
    }
  }

  return titleMap;
}

/**
 * Check if title is generic (template-based)
 */
function isGeneric(bt: string): boolean {
  return GENERIC_BASE_TITLES.some(g => bt.includes(g.toLowerCase()));
}

/**
 * Build forbidden tokens from other segments (SEGMENT_GUARD preparation)
 */
function buildForbiddenTokens(businessSegments: any[], allowedSegName: string): string[] {
  const allowN = normalizeLoose(allowedSegName);
  const tokens: string[] = [];

  for (const s of (businessSegments ?? []) as any[]) {
    const name = (s?.name ?? '').trim();
    if (normalizeLoose(name) === allowN) continue;

    // セグメント名自体と分解語彙を追加
    tokens.push(name);
    tokens.push(...splitSegmentNameTokens(name));

    // overview と customers から語彙抽出
    const ov = (s?.overview ?? '').trim();
    const cust = (s?.mainCustomers ?? (s?.customers ?? '')).trim();
    tokens.push(...pickKeywords(ov));
    tokens.push(...pickKeywords(cust));
  }

  // 重複除去 & 上限（増えすぎ防止）
  const result = Array.from(new Set(tokens.filter(Boolean))).slice(0, 60);

  // デバッグログ：トークン数確認
  if (process.env.NEXT_PUBLIC_DEBUG_HYDRATE === '1') {
    console.log(`[cascade][segGuard] allowed="${allowedSegName}" forbiddenTokens.len=${result.length}`);
  }

  return result;
}

/**
 * SEGMENT_GUARD soft penalty filtering
 */
function filterForbiddenTokens(tokens: string[]): string[] {
  // STOP_WORDS（テンプレ語）を除外
  const filtered1 = tokens.filter((tok: string) => !STOP_WORDS_TASK3.has(tok.toLowerCase()));
  // 3文字未満を除外
  const filtered2 = filtered1.filter((tok: string) => tok.length >= 3);
  // 数字のみ を除外
  const filtered3 = filtered2.filter((tok: string) => !/^\d+$/.test(tok));
  // 記号のみ を除外（日本語/英数字を含まないもの）
  const filtered4 = filtered3.filter((tok: string) => /[一-龠ぁ-んァ-ヶa-zA-Z0-9]/.test(tok));
  return filtered4;
}

/**
 * Validate second pass result for vocabulary contamination
 */
function validateSecondPassWithTokens(
  deptName: string,
  allowedSegName: string,
  segs: any[],
  secondDept: any,
  bannedSegmentNames?: string[]
): { valid: boolean; riskScore?: number; hitTokens?: string[] } {
  const rawTokens = buildForbiddenTokens(segs, allowedSegName);
  // TASK 4: soft penalty フィルタリング（STOP_WORDS/3文字未満/数字のみ/記号のみ除外）
  const forbiddenFiltered = filterForbiddenTokens(rawTokens);

  // allowed name に含まれるトークンを除外（完全一致のみ）
  const allowedNorm = normalizeForGuard(allowedSegName);
  const forbiddenUniq = Array.from(new Set(forbiddenFiltered)).filter((t: string) => {
    const tn = normalizeForGuard(t);
    if (!tn) return false;
    return tn !== allowedNorm; // 完全一致のみ除外
  });

  // tokens が弱くても forbiddenSegmentNames との合算で検知対象を確保
  let checkTokens = forbiddenUniq;
  if ((!forbiddenUniq || forbiddenUniq.length < 5) && bannedSegmentNames && bannedSegmentNames.length > 0) {
    checkTokens = Array.from(new Set([...forbiddenUniq, ...bannedSegmentNames]));
    console.log(
      `[cascade][dup] tokens_weak但し回避可能: dept="${deptName}" tokens.len=${forbiddenUniq?.length ?? 0} segs=${bannedSegmentNames?.length ?? 0}`
    );
  }

  const allProjects = [
    ...(secondDept?.lanes?.existing?.projects ?? []),
    ...(secondDept?.lanes?.new?.projects ?? []),
    ...(secondDept?.projects ?? []),
  ];

  // TASK 4 soft penalty ロジック（ユニーク違反トークン数 = riskScore）
  const hits = new Set<string>(); // ユニーク化用Set
  const RISK_THRESHOLD = 2;

  for (const proj of allProjects) {
    const blob = `${proj?.title ?? ''} ${proj?.reason ?? ''} ${proj?.hypothesis ?? ''}`;
    const hit = containsAny(blob, checkTokens);
    if (hit) {
      hits.add(hit); // 同じトークンは1点のみ
    }
  }

  const riskScore = hits.size; // ユニークなトークン数
  const hitTokens = Array.from(hits);

  // デバッグログ：ユニークなトークンのみ出力
  for (const t of hits) {
    console.log(`[cascade][guard][risk] token="${t}" riskScore=${riskScore} dept="${deptName}"`);
  }

  // riskScore が閾値以上なら valid=false
  if (riskScore >= RISK_THRESHOLD) {
    console.log(`[cascade][dup][rejected] dept="${deptName}" riskScore=${riskScore} >= RISK_THRESHOLD`);
    return { valid: false, riskScore, hitTokens };
  }

  console.log(`[cascade][dup][accepted] dept="${deptName}" riskScore=${riskScore}`);
  return { valid: true, riskScore };
}

/**
 * Infer project archetype based on title and content
 */
function inferProjectArchetype(project: any, deptName: string, lane: string): string {
  const title = (project?.title ?? '').toLowerCase();
  const hypothesis = (project?.hypothesis ?? '').toLowerCase();
  const kind = project?.kind ?? '';
  const mainLever = project?.mainLever ?? '';

  if (title.includes('品質') || title.includes('テスト') || hypothesis.includes('品質') || hypothesis.includes('不具合')) return 'quality';
  if (title.includes('自動化') || title.includes('効率化') || hypothesis.includes('自動化') || kind === 'efficiency') return 'automation';
  if (title.includes('営業') || title.includes('販売') || deptName.includes('営業') || mainLever === 'ACQ') return 'sales';
  if (title.includes('新規') || title.includes('事業') || kind === 'future' || lane === 'new') return 'new_business';
  if (title.includes('データ') || title.includes('分析') || title.includes('it') || hypothesis.includes('データ')) return 'data_it';
  if (title.includes('組織') || title.includes('人事') || title.includes('育成') || deptName.includes('人事')) return 'org_hr';
  if (title.includes('コスト') || title.includes('削減') || kind === 'cost') return 'cost';
  if (title.includes('マーケ') || title.includes('広告') || deptName.includes('マーケ')) return 'marketing';

  return 'general';
}

/**
 * Get skills and investments by archetype
 */
function getSkillsAndInvestmentsByArchetype(archetype: string): {
  executionSkills: string[];
  roleSkills: string[];
  investments: any[];
} {
  const templates: Record<string, any> = {
    quality: {
      executionSkills: ['品質管理', '検証力', '改善運用'],
      roleSkills: ['QAエンジニア'],
      investments: [
        { category: 'TRAINING_OJT', title: '品質管理研修', detail: 'テスト設計と品質保証の実践トレーニング', owner: '', horizon: '0_3M' },
        { category: 'TOOLS_PROCESS', title: '検証ツール導入', detail: '自動テストツールとCI/CD環境の整備', owner: '', horizon: '3_6M' },
      ],
    },
    automation: {
      executionSkills: ['自動化設計', 'プロセス標準化', 'データ活用'],
      roleSkills: ['エンジニア'],
      investments: [
        { category: 'TOOLS_PROCESS', title: '業務自動化ツール導入', detail: 'RPA・ワークフロー自動化の環境構築', owner: '', horizon: '0_3M' },
        { category: 'TRAINING_OJT', title: '効率化ワークショップ', detail: '業務プロセス分析と改善手法の習得', owner: '', horizon: '3_6M' },
      ],
    },
    sales: {
      executionSkills: ['提案力', '交渉力', 'PM'],
      roleSkills: ['営業', 'セールス'],
      investments: [
        { category: 'TRAINING_OJT', title: '提案力強化研修', detail: '顧客課題発見と提案スキルの向上', owner: '', horizon: '0_3M' },
        { category: 'TOOLS_PROCESS', title: 'CRM・SFA導入', detail: '顧客管理と営業活動の可視化ツール', owner: '', horizon: '3_6M' },
      ],
    },
    new_business: {
      executionSkills: ['事業開発', '仮説検証', 'MVP設計'],
      roleSkills: ['プロダクトマネジャー'],
      investments: [
        { category: 'HIRING', title: 'プロダクトマネジャー採用', detail: '新規事業推進のための専門人材獲得', owner: '', horizon: '3_6M' },
        { category: 'EXTERNAL', title: 'MVP開発パートナー契約', detail: '迅速な仮説検証のための外部リソース活用', owner: '', horizon: '0_3M' },
      ],
    },
    data_it: {
      executionSkills: ['データ分析', 'システム設計', '標準化'],
      roleSkills: ['データアナリスト', 'エンジニア'],
      investments: [
        { category: 'TOOLS_PROCESS', title: 'データ基盤構築', detail: 'BI・分析環境の整備とデータ統合', owner: '', horizon: '3_6M' },
        { category: 'TRAINING_OJT', title: 'データ活用研修', detail: 'SQL・分析手法の実践トレーニング', owner: '', horizon: '0_3M' },
      ],
    },
    org_hr: {
      executionSkills: ['育成設計', '組織開発', 'ファシリテーション'],
      roleSkills: ['人事', 'HRビジネスパートナー'],
      investments: [
        { category: 'TRAINING_OJT', title: 'マネジメント研修', detail: 'リーダーシップと育成スキルの強化', owner: '', horizon: '0_3M' },
        { category: 'ALLOCATION', title: '人材配置最適化', detail: 'スキルマトリクスに基づく適材適所の実現', owner: '', horizon: '3_6M' },
      ],
    },
    cost: {
      executionSkills: ['コスト分析', '調達力', '標準化'],
      roleSkills: ['経営企画', '調達'],
      investments: [
        { category: 'TOOLS_PROCESS', title: 'コスト管理システム導入', detail: '経費可視化と予実管理の効率化', owner: '', horizon: '3_6M' },
        { category: 'TRAINING_OJT', title: 'コスト削減ワークショップ', detail: 'ムダ発見と改善提案の手法習得', owner: '', horizon: '0_3M' },
      ],
    },
    marketing: {
      executionSkills: ['マーケティング分析', 'コンテンツ企画', 'データ活用'],
      roleSkills: ['マーケター', 'デザイナー'],
      investments: [
        { category: 'TOOLS_PROCESS', title: 'MA・広告ツール導入', detail: 'マーケティングオートメーションと効果測定', owner: '', horizon: '3_6M' },
        { category: 'TRAINING_OJT', title: 'デジタルマーケ研修', detail: 'SEO・広告運用の実践スキル習得', owner: '', horizon: '0_3M' },
      ],
    },
    general: {
      executionSkills: ['PM', '改善運用', '標準化'],
      roleSkills: [],
      investments: [
        { category: 'TRAINING_OJT', title: 'プロジェクト管理研修', detail: '計画立案と進捗管理スキルの習得', owner: '', horizon: '0_3M' },
        { category: 'TOOLS_PROCESS', title: '業務標準化の仕組み整備', detail: '効率的な実行を支援するプロセス導入', owner: '', horizon: '3_6M' },
      ],
    },
  };

  return templates[archetype] || templates['general'];
}

/**
 * Fill missing STAGE 3 fields for a project
 */
function fillMissingStage3Fields(project: any, availableKPIs: any[], deptName: string = '', lane: string = ''): void {
  // 1. valueDriverLinks の補完
  if (!project.valueDriverLinks || project.valueDriverLinks.length === 0) {
    if (availableKPIs && availableKPIs.length > 0) {
      project.valueDriverLinks = availableKPIs
        .slice(0, 2)
        .map((kpi: any) => kpi.id)
        .filter(Boolean);
    } else {
      project.valueDriverLinks = [];
    }
  }

  // 2. archetype の推定
  if (!project.archetype) {
    project.archetype = inferProjectArchetype(project, deptName, lane);
  }

  // 3. archetype に基づく skills/investments の補完
  const { executionSkills, roleSkills, investments } = getSkillsAndInvestmentsByArchetype(project.archetype || 'general');

  if (!project.executionSkills || project.executionSkills.length === 0) {
    project.executionSkills = executionSkills;
  }

  if (!project.roleSkills || project.roleSkills.length === 0) {
    project.roleSkills = roleSkills;
  }

  if (!project.requiredInvestments || project.requiredInvestments.length === 0) {
    project.requiredInvestments = investments;
  }
}

/**
 * Main export: Apply second pass generation for departments with issues
 */
export async function applySecondPass(
  parsed: any,
  input: any,
  context: any
): Promise<any> {
  const normalized = { ...parsed };
  const departments = input?.departments || [];
  const allBusinessSegments = input?.allBusinessSegments || [];
  const availableKPIs = input?.availableKPIs || [];

  // Sets for tracking departments that need second pass
  const duplicateDeptNames = context?.duplicateDeptNames || new Set<string>();
  const groundingFailedDepts = context?.groundingFailedDepts || new Set<string>();
  const conflictFailedDepts = context?.conflictFailedDepts || new Set<string>();
  const highRiskDepts = context?.highRiskDepts || new Set<string>();

  // Check if second pass is needed
  const needsSecondPass =
    duplicateDeptNames.size > 0 ||
    groundingFailedDepts.size > 0 ||
    conflictFailedDepts.size > 0 ||
    highRiskDepts.size > 0;

  if (needsSecondPass) {
    const reasons: string[] = [];
    if (duplicateDeptNames.size > 0)
      reasons.push(`duplicates: ${Array.from(duplicateDeptNames).join(',')}`);
    if (groundingFailedDepts.size > 0)
      reasons.push(`grounding-failed: ${Array.from(groundingFailedDepts).join(',')}`);
    if (conflictFailedDepts.size > 0)
      reasons.push(`conflict-failed: ${Array.from(conflictFailedDepts).join(',')}`);
    if (highRiskDepts.size > 0) reasons.push(`high-risk: ${Array.from(highRiskDepts).join(',')}`);
    console.log(`[cascade][2ndpass] 発火条件: ${reasons.join(' / ')}`);

    const titleMap = collectAllTitles(Array.isArray(normalized?.departments) ? normalized.departments : []);
    const bannedTitlesList: string[] = [];

    for (const [bt, { deptNames }] of titleMap) {
      // 複数部門で同じ baseTitle か generic の場合
      if (new Set(deptNames).size > 1 || isGeneric(bt)) {
        bannedTitlesList.push(bt);
      }
    }

    // 2nd-pass対象を union 化（duplicates/grounding-failed/conflict-failed/high-risk）
    const secondPassTargets = new Set<string>([
      ...Array.from(duplicateDeptNames),
      ...Array.from(groundingFailedDepts),
      ...Array.from(conflictFailedDepts),
      ...Array.from(highRiskDepts),
    ]);

    // 対象部門ごとに2nd pass
    for (const targetDeptName of secondPassTargets) {
      const deptIndex = (normalized?.departments ?? []).findIndex((d: any) => d?.name === targetDeptName);
      if (deptIndex < 0) continue;

      const dept = normalized.departments[deptIndex];
      const deptInput = departments.find((d: any) => {
        const n = pickName(d);
        return n === targetDeptName;
      });

      if (!deptInput) continue;

      // SEGMENT_GUARD: request-level allBusinessSegments を使用
      const segPool = Array.isArray(allBusinessSegments) ? (allBusinessSegments as any[]) : [];

      // allowedSegmentName を必ず埋める（空禁止）
      const allowedSegmentName =
        (typeof (deptInput as any)?.segmentName === 'string' && (deptInput as any).segmentName.trim()) ||
        targetDeptName; // 最終フォールバック：部門名

      const forbiddenSegmentNames = segPool
        .map((s: any) => (s?.name ?? '').trim())
        .filter((n: string) => n && normalizeLoose(n) !== normalizeLoose(allowedSegmentName));

      // forbiddenTokens を他セグメント語彙から構築（segPool ベース）
      const forbiddenTokens = buildForbiddenTokens(segPool, allowedSegmentName);

      // 2nd pass用プロンプト作成（元のdeptBlocks生成ロジックを再利用）
      const secondPassDeptBlock = (() => {
        const name = targetDeptName;
        const answers = (deptInput?.answers || []) as Array<{ stepNumber: number; answer?: string; label?: string }>;
        const answersText = (answers || [])
          .sort((a: any, b: any) => (a?.stepNumber || 0) - (b?.stepNumber || 0))
          .slice(0, 6)
          .map((a: any) => `Q${a.stepNumber}${a.label ? `(${a.label})` : ''}: ${String(a.answer || '')}`)
          .join('\n');

        const focusThemesArr = (deptInput?.focusThemes || []) as any[];
        const constraintsArr = (deptInput?.constraints || []) as any[];
        const focusThemes = focusThemesArr.slice(0, 3).join('、');
        const constraints = constraintsArr.slice(0, 2).join('、');

        let segBlock = '';
        if (Array.isArray(segPool) && segPool.length > 0) {
          const segmentInfo = segPool
            .slice(0, 5)
            .map((s: any) => {
              const segName = (s?.name ?? '').trim();
              const segOverview = (s?.overview ?? '').trim().slice(0, 200);
              const segPL = (s as any)?.segmentPL;
              const plStr = segPL
                ? ` / PL: ${segPL?.revenue ?? 0}円(売上), ${segPL?.COGS ?? 0}円(原価), ${segPL?.operatingProfit ?? 0}円(営利)`
                : '';
              return `- ${segName}${plStr}${segOverview ? ` / ${segOverview}` : ''}`;
            })
            .join('\n');

          segBlock = `\n[SEGMENT]\n${segmentInfo}`;
        }

        const deptName = name;
        const uniquenessRule = `
[UNIQUENESS_CONSTRAINT - 2ND PASS]
- ★前回生成したタイトルと異なるプロジェクト案を生成する（必須）
- 禁止タイトル: ${bannedTitlesList.map((t: string) => `"${t}"`).join(', ')}
- 新しいプロジェクト案は、別の"顧客層"、"価値提案"、"KPI" の組み合わせを使用すること
- ★[SEGMENT]から固有名詞を2つ抽出してtitleに含めること（例："自動車OEM"、"医療機器メーカー"、"建機アフター市場"など）
- existing lane の各プロジェクト title は必ず "${deptName}：" で始まり、[SEGMENT] から抽出した顧客層・対象市場を含める
- new lane の各プロジェクト title も必ず "${deptName}：" で始まり、[SEGMENT] から抽出した顧客層・対象市場を含める
- hypothesis と reason には、必ず [SEGMENT] の要素（customers / overview）を最低1つ引用して根拠にする

[SEGMENT_GUARD - セグメント汚染防止]
- ★ このセグメント専用：${allowedSegmentName || '（指定なし）'}
- ★ 禁止セグメント：${forbiddenSegmentNames.length > 0 ? forbiddenSegmentNames.map((s: string) => `"${s}"`).join(', ') : '（なし）'}
- ★ 禁止語彙（他セグメントから）：${forbiddenTokens.slice(0, 20).map((t: string) => `"${t}"`).join(', ')}
- [SEGMENT]語彙以外を使用禁止（他セグメント名や語彙は絶対に含めるな）
- title / hypothesis / reason のどこにも、禁止セグメント名・禁止語彙を含めたら失格
- 必ず allowed セグメント（${allowedSegmentName || '（指定なし）'}）の語彙のみを使用すること`;

        return `
[部門] ${name}

[質問への回答]
${answersText}

[既存事業の焦点]
${focusThemes}

[制約条件]
${constraints}
${segBlock}
${uniquenessRule}
`.trim();
      })();

      const secondPassPrompt = `以下の ${targetDeptName} 部門について、前回とは異なるプロジェクト案を生成してください。

${secondPassDeptBlock}

# 出力形式（前回と同じ）
{
  "departments": [
    {
      "name": "${targetDeptName}",
      "missionDraft": "...",
      "missionDescription": "...",
      "lanes": {
        "existing": {
          "projects": [
            { "title": "...", "hypothesis": "...", "reason": "...", ... },
            { "title": "...", "hypothesis": "...", "reason": "...", ... }
          ]
        },
        "new": {
          "projects": [
            { "title": "...", "hypothesis": "...", "reason": "...", ... }
          ]
        }
      },
      ...
    }
  ]
}`.trim();

      // 2nd pass LLM呼び出し
      try {
        // OpenAI リトライ機能を使用（fetch failed/UND_ERR_SOCKET 対策）
        const secondRawContent = await callOpenAIJsonWithRetry(
          secondPassPrompt,
          '必ずJSONのみを返し、日本語で。前後の説明は禁止。',
          `2ndpass-dept=${targetDeptName}`,
          0.35, // temperature for 2nd pass
          1500  // maxTokens for 2nd pass
        );

        const secondParsed = extractJsonObject(secondRawContent);

        if (secondParsed && Array.isArray(secondParsed?.departments) && secondParsed.departments.length > 0) {
          const secondDept = secondParsed.departments[0];

          // 語彙混入検知検証（bannedSegmentNames 与えてトークン不足時も対応）
          const validation = validateSecondPassWithTokens(
            targetDeptName,
            allowedSegmentName,
            segPool,
            secondDept,
            forbiddenSegmentNames
          );

          if (validation.valid) {
            // 2nd passの結果で置き換え
            if (secondDept?.lanes?.existing || secondDept?.lanes?.new) {
              normalized.departments[deptIndex].lanes = secondDept.lanes;
            }
            if (secondDept?.missionDescription) {
              normalized.departments[deptIndex].missionDescription = secondDept.missionDescription;
            }
          } else {
            // reject時に highRiskDepts を追加
            highRiskDepts.add(targetDeptName);
            console.log(
              `[cascade][dup][reject] dept="${targetDeptName}" riskScore=${validation.riskScore} hitTokens=${validation.hitTokens?.join(',')}`
            );
          }
        }
      } catch (err: any) {
        console.warn(`[cascade][dup] 2nd pass失敗 (${targetDeptName}):`, err?.message);
        // 失敗時は1st passの結果をそのまま使用
      }
    }
  }

  // ★ STAGE3フィールドの補完（fallback）
  if (Array.isArray(normalized?.departments)) {
    for (const dept of normalized.departments) {
      const deptName = dept?.name ?? '';
      if (dept?.lanes?.existing?.projects) {
        for (const proj of dept.lanes.existing.projects) {
          fillMissingStage3Fields(proj, availableKPIs, deptName, 'existing');
        }
      }
      if (dept?.lanes?.new?.projects) {
        for (const proj of dept.lanes.new.projects) {
          fillMissingStage3Fields(proj, availableKPIs, deptName, 'new');
        }
      }
      if (dept?.projects) {
        for (const proj of dept.projects) {
          fillMissingStage3Fields(proj, availableKPIs, deptName, '');
        }
      }
    }
  }

  return normalized;
}
