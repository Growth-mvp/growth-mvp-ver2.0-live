export type CascadeLaneType = 'existing' | 'new' | 'intraCollab' | 'interCollab';

export function businessNameKey(name: unknown): string {
  return String(name ?? '').normalize('NFKC').replace(/\s+/g, '').toLowerCase();
}

export function cascadeSlots(partners: string[]): Array<{ lane: CascadeLaneType; slot: number }> {
  return [
    { lane: 'existing' as const, slot: 1 }, { lane: 'existing' as const, slot: 2 },
    { lane: 'new' as const, slot: 3 }, { lane: 'intraCollab' as const, slot: 4 },
    ...(partners.length ? [{ lane: 'interCollab' as const, slot: 5 }] : []),
  ];
}

export function cascadeStrategyReferences(evidence: string): Array<{ id: string; text: string }> {
  return evidence.split(/(?<=[。！？])\s*|\n+/u).map((text) => text.trim()).filter(Boolean)
    .map((text, index) => ({ id: `S${index + 1}`, text }));
}

export function normalizeCascadeReview(raw: any, evidence: string): any {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.projects)) return raw;
  const refs = new Map(cascadeStrategyReferences(evidence).map((ref) => [ref.id, ref.text]));
  return { ...raw, projects: raw.projects.map((project: any) => {
    if (!project || typeof project !== 'object') return project;
    const ids = Array.isArray(project.strategyBasisIds) ? project.strategyBasisIds : [];
    // Resolve real source text server-side: the model need not transcribe it verbatim.
    const validIds = ids.length > 0 && ids.every((id: any) => typeof id === 'string' && refs.has(id));
    const keyResults = Array.isArray(project.keyResults) && project.keyResults.length > 0
      ? project.keyResults : project.okrs?.[0]?.keyResults;
    const collab = project.slot === 4 ? raw.intraDeptCollab?.[0] : project.slot === 5 ? raw.interDeptCollab?.[0] : '';
    return { ...project,
      mainLever: normalizeMainLever(project.mainLever),
      // Only inter-business collaboration has a partner business. Ignore stray
      // metadata on other slots; their participants are described in collaboration.
      partnerDepartment: project.slot === 5 ? project.partnerDepartment : undefined,
      strategyBasis: validIds ? ids.map((id: string) => refs.get(id)).join('\n') : project.strategyBasis,
      keyResults: Array.isArray(keyResults) ? keyResults : [],
      objective: project.objective || project.okrs?.[0]?.objective,
      collaboration: project.collaboration || collab || '',
    };
  }) };
}

/** Validate the complete proposal before mutating any response state. */
export function validateCascadeReview(
  review: any,
  partners: string[],
  evidence: string,
  deptName = '',
  options: { indirect?: boolean } = {},
): string[] {
  const issues: string[] = [];
  const hasText = (v: any): boolean => typeof v === 'string' && v.trim().length > 0;
  const compact = (v: string): string => v.replace(/\s+/g, '');
  for (const field of ['missionDraft', 'missionDescription', 'currentPosition', 'strategicRole']) {
    if (!hasText(review?.[field])) issues.push(`missing_${field}`);
  }
  const slots = cascadeSlots(partners);
  const projects = Array.isArray(review?.projects) ? review.projects : [];
  if (projects.length !== slots.length) issues.push('project_count');
  const titles = new Set<string>();
  for (const spec of slots) {
    const matches = projects.filter((p: any) => p?.slot === spec.slot);
    if (matches.length !== 1) { issues.push(`slot_${spec.slot}_count`); continue; }
    const p = matches[0];
    for (const field of ['title', 'reason', 'hypothesis', 'objective', 'strategyBasis']) {
      if (!hasText(p[field])) issues.push(`slot_${spec.slot}_${field}`);
    }
    const basisIds = Array.isArray(p.strategyBasisIds) ? p.strategyBasisIds : [];
    const referenceIds = new Set(cascadeStrategyReferences(evidence).map((ref) => ref.id));
    const hasSourceReference = basisIds.length > 0 && basisIds.every((id: any) => referenceIds.has(id));
    if ((basisIds.length > 0 && !hasSourceReference) ||
        (!hasSourceReference && hasText(p.strategyBasis) && !compact(evidence).includes(compact(p.strategyBasis)))) {
      issues.push(`slot_${spec.slot}_ungrounded_basis`);
    }
    const titleKey = businessNameKey(String(p.title ?? '').replace(`${deptName}：`, ''));
    if (titles.has(titleKey)) issues.push(`slot_${spec.slot}_duplicate_title`);
    titles.add(titleKey);
    if (spec.lane === 'interCollab' && !partners.includes(p.partnerDepartment)) issues.push('unregistered_partner');
    if (spec.lane !== 'interCollab' && p.partnerDepartment) issues.push(`slot_${spec.slot}_unexpected_partner`);
    if (['intraCollab', 'interCollab'].includes(spec.lane) && !hasText(p.collaboration)) issues.push(`slot_${spec.slot}_collaboration`);
    if (!(MAIN_LEVERS as readonly string[]).includes(p.mainLever)) issues.push(`slot_${spec.slot}_lever`);
    if (!['short', 'mid', 'long'].includes(p.horizon) || !['growth', 'cost', 'efficiency', 'future'].includes(p.kind)) issues.push(`slot_${spec.slot}_classification`);
    if (!Array.isArray(p.skillRequirements?.roleSkills) || p.skillRequirements.roleSkills.length === 0 || !p.skillRequirements.roleSkills.every(hasText) ||
        !Array.isArray(p.skillRequirements?.executionSkills) || p.skillRequirements.executionSkills.length === 0 || !p.skillRequirements.executionSkills.every(hasText)) issues.push(`slot_${spec.slot}_skills`);
    const investments = Array.isArray(p.humanInvestments) ? p.humanInvestments : [];
    if (new Set(investments.map((i: any) => i?.category)).size < 2 || investments.some((i: any) =>
      !['TRAINING_OJT', 'ALLOCATION', 'TOOLS_PROCESS', 'EXTERNAL', 'HIRING'].includes(i?.category) || !hasText(i?.title) || !hasText(i?.detail))) issues.push(`slot_${spec.slot}_investments`);
    const causal = p.causalDesign;
    if (!['buyer', 'problem', 'intervention', 'customerChange', 'revenueMechanism', 'differentiation']
      .every((field) => hasText(causal?.[field]))) issues.push(`slot_${spec.slot}_causal_design`);
    // A historical growth rate cannot serve as a quantified forecast for an untested intervention.
    if (/[0-9０-９]+(?:[.．][0-9０-９]+)?\s*[%％]/u.test(String(p.hypothesis ?? ''))) {
      issues.push(`slot_${spec.slot}_unagreed_effect_number`);
    }
    if (spec.slot === 3 && (!hasText(p.exploration?.payer) || !hasText(p.exploration?.offering) ||
        !hasText(p.exploration?.paymentTest) || !hasText(p.exploration?.decisionRule))) {
      issues.push('slot_3_business_validation');
    }

    if (/別セグメント|別事業|複数事業/.test(String(p.title ?? ''))) issues.push(`slot_${spec.slot}_unspecified_title`);
    if (spec.slot === 4) {
      const phases = p.collaborationStructure?.phases;
      if (!Array.isArray(phases) || phases.length < 2 || !phases.every((phase: any) =>
        ['phase', 'owner', 'deliverable', 'handoverTo'].every(field => hasText(phase?.[field]))) ||
        !hasText(p.collaborationStructure?.jointDecision)) issues.push('slot_4_collaboration_structure');
    }
    if (spec.slot === 5) {
      const structure = p.crossBusinessStructure;
      if (structure?.partnerBusiness !== p.partnerDepartment ||
        !['ownResponsibility', 'partnerResponsibility', 'revenueAttribution', 'responsibilityBoundary']
          .every(field => hasText(structure?.[field]))) issues.push('slot_5_collaboration_structure');
    }

    const krs = Array.isArray(p.keyResults) ? p.keyResults : [];
    if (krs.length !== 3) issues.push(`slot_${spec.slot}_kpi_count`);
    const labels = new Set<string>();
    for (const kr of krs) {
      if (!['label', 'unit', 'measurementMethod', 'hypothesisLink'].every((field) => hasText(kr?.[field]))) issues.push(`slot_${spec.slot}_kpi_definition`);
      if (!['customer_outcome', 'business_outcome', 'validation', 'leading'].includes(kr?.kind)) issues.push(`slot_${spec.slot}_kpi_kind`);
      if (!['client_business', 'own_business', 'end_user', 'internal_process'].includes(kr?.measurementScope) ||
          !['population', 'calculation', 'dataSource', 'comparison'].every((field) => hasText(kr?.[field]))) {
        issues.push(`slot_${spec.slot}_kpi_operational_definition`);
      }
      if (/または|又は|あるいは/.test(String(kr?.unit ?? ''))) issues.push(`slot_${spec.slot}_ambiguous_unit`);
      if (['顧客成果指標', '当社の収益指標', '実行の先行指標'].includes(kr?.label)) issues.push(`slot_${spec.slot}_placeholder_kpi`);
      const key = businessNameKey(kr?.label);
      if (labels.has(key)) issues.push(`slot_${spec.slot}_duplicate_kpi`);
      labels.add(key);
      if (/顧客顧客|に振り向け要求|だけでは.*件数/.test(String(kr?.label ?? ''))) issues.push(`slot_${spec.slot}_broken_kpi`);
    }
    if (spec.lane !== 'new' &&
        (!krs.some((kr: any) => kr?.kind === 'business_outcome' && kr?.measurementScope === 'own_business') ||
         !krs.some((kr: any) => kr?.kind === 'customer_outcome' &&
           (['client_business', 'end_user'].includes(kr?.measurementScope) ||
            (options.indirect === true && kr?.measurementScope === 'internal_process'))))) {
      issues.push(`slot_${spec.slot}_customer_and_business_outcomes`);
    }
    if (!krs.some((kr: any) => spec.lane === 'new' ? kr?.kind === 'validation' : ['customer_outcome', 'business_outcome'].includes(kr?.kind))) {
      issues.push(`slot_${spec.slot}_no_outcome`);
    }
  }
  return [...new Set(issues)];
}


export const MAIN_LEVERS = ['ACQ', 'ARPU', 'CHURN', 'COST', 'EFFICIENCY', 'FUTURE'] as const;
export type MainLever = (typeof MAIN_LEVERS)[number];

/** プロンプトに示した各レバーの定義文。定義文そのものの表記は、同じ値として扱う。 */
const MAIN_LEVER_DEFINITIONS: Record<MainLever, string> = {
  ACQ: '新規顧客数・案件数',
  ARPU: '単価・LTV・客単価',
  CHURN: '解約率・離脱率',
  COST: '固定費・変動費・人件費などコスト全般',
  EFFICIENCY: '業務効率・時間削減（最終的にコスト/スループットに効く）',
  FUTURE: '将来の成長余地（新規事業・仕組み・人材など）',
};

const leverKey = (v: string): string => v.normalize('NFKC').replace(/\s+/g, '').toLowerCase();

const LEVER_CODE_TOKEN = /(?<![A-Za-z])(ACQ|ARPU|CHURN|COST|EFFICIENCY|FUTURE)(?![A-Za-z])/giu;

/**
 * 同じ値の表記ゆれ（大文字小文字・空白・全角半角、説明文の中にコードが1つだけある「ACQ（…）」「人材・組織（FUTURE）」、定義文そのもの）だけを
 * レバーのコードへ正規化する。コードが複数あるときや、意味を推測しなければ決められないときは元の値を返す（別のレバーへ振り分けない）。
 */
export function normalizeMainLever(raw: unknown): unknown {
  if (typeof raw !== 'string') return raw;
  const text = raw.normalize('NFKC').trim();
  const upper = text.toUpperCase();
  if ((MAIN_LEVERS as readonly string[]).includes(upper)) return upper;
  const codes = new Set(Array.from(text.matchAll(LEVER_CODE_TOKEN), (m) => m[1].toUpperCase()));
  if (codes.size === 1) return [...codes][0];
  if (codes.size > 1) return raw;
  const byDefinition = MAIN_LEVERS.find((code) => leverKey(MAIN_LEVER_DEFINITIONS[code]) === leverKey(text));
  return byDefinition ?? raw;
}

/** 修復の指示（mainLever が不正だったスロットに渡す）。 */
export const MAIN_LEVER_CORRECTION =
  'mainLever は次のコードのどれか1つだけを英大文字で返す: ACQ, ARPU, CHURN, COST, EFFICIENCY, FUTURE。説明文・日本語・複数の値・配列は入れない。';

const isLeverError = (error: string): boolean => /^slot_\d+_lever$/.test(error);

const SLOT4_CONDITIONS = ['collaboration', 'collaboration_structure', 'kpi_count', 'kpi_kind', 'kpi_definition', 'kpi_operational_definition', 'ambiguous_unit', 'customer_and_business_outcomes', 'no_outcome'] as const;

/** 診断用（スロット4）：KPIの分類と単位、連携構造の有無、各検証条件の合否。本文・ラベルは含めない。 */
function slot4DiagnosticsOf(candidate: any, errors: string[], indirect: boolean): unknown {
  const text = (v: unknown): boolean => typeof v === 'string' && v.trim().length > 0;
  const short = (v: unknown): unknown => (typeof v === 'string' ? v.slice(0, 40) : v ?? null);
  const krs = Array.isArray(candidate?.keyResults) ? candidate.keyResults : [];
  const phases = Array.isArray(candidate?.collaborationStructure?.phases) ? candidate.collaborationStructure.phases : [];
  const failing = new Set(errors);
  return {
    indirect,
    kpis: krs.map((kr: any) => ({ kind: short(kr?.kind), measurementScope: short(kr?.measurementScope), unit: short(kr?.unit) })),
    structure: {
      phaseCount: phases.length,
      phasesComplete: phases.length > 0 && phases.every((ph: any) => ['phase', 'owner', 'deliverable', 'handoverTo'].every((k) => text(ph?.[k]))),
      jointDecisionPresent: text(candidate?.collaborationStructure?.jointDecision),
    },
    conditions: Object.fromEntries(SLOT4_CONDITIONS.map((c) => [c, !failing.has(`slot_4_${c}`)])),
  };
}

/** AIが返した mainLever の値（正規化前）。診断用に短く切って記録する。 */
function rawMainLeverOf(raw: any): unknown {
  const value = raw?.project?.mainLever ?? raw?.projects?.[0]?.mainLever;
  return typeof value === 'string' ? value.slice(0, 120) : value ?? null;
}

/** 修復の指示。前回の値を示し、そのスロットの施策が効かせる指標を1つだけ選び直させる。 */
export function mainLeverCorrectionFor(rejected: unknown): string {
  const shown = rejected === undefined || rejected === null || rejected === '' ? '（未入力）' : typeof rejected === 'string' ? rejected : JSON.stringify(rejected);
  return `${MAIN_LEVER_CORRECTION} 前回の値「${shown}」は使えない。このスロットの施策が効かせる指標を1つだけ選び直す。`;
}

export type SlotFeedback = {
  previousCandidate: unknown;
  previousValidationErrors: string[];
  mainLeverCorrection?: string;
};

/** 1スロットの応答を正規化して検証する。他スロットの指摘は含めない。 */
export function reviewSlotCandidate(
  raw: any,
  slot: number,
  ctx: { plan: any; allowedPartners: string[]; finalStrategy: string; department: string; indirect?: boolean },
): { candidate: any; errors: string[] } {
  const projectRaw = raw?.project ?? raw?.projects?.[0];
  const withSlot = projectRaw && typeof projectRaw === 'object' ? { ...projectRaw, slot } : undefined;
  const normalized = normalizeCascadeReview({ ...ctx.plan, projects: withSlot ? [withSlot] : [] }, ctx.finalStrategy);
  const candidate = normalized.projects[0];
  const errors = validateCascadeReview(normalized, ctx.allowedPartners, ctx.finalStrategy, ctx.department, { indirect: ctx.indirect === true })
    .filter((e) => e.startsWith(`slot_${slot}_`) || (slot === 5 && e === 'unregistered_partner'));
  if (!candidate) errors.push(`slot_${slot}_missing`);
  return { candidate, errors };
}

/**
 * スロットごとに生成する。不合格のスロットだけを、指摘とともに最大 maxAttempts 回まで作り直す。
 * 他スロットは作り直さない。最後まで合格しなければ指摘を連結した例外を投げる。
 */
export async function generateSlotProjects(opts: {
  templates: Array<{ slot: number }>;
  requestSlot: (template: { slot: number }, feedback: SlotFeedback) => Promise<any>;
  plan: any;
  allowedPartners: string[];
  finalStrategy: string;
  department: string;
  maxAttempts?: number;
  indirect?: boolean;
  diagnostics?: any[];
}): Promise<any[]> {
  const projects: any[] = [];
  for (const template of opts.templates) {
    let candidate: any;
    let errors: string[] = [];
    for (let attempt = 0; attempt < (opts.maxAttempts ?? 2); attempt++) {
      const leverRejected = errors.some(isLeverError);
      const feedback: SlotFeedback = {
        previousCandidate: candidate,
        previousValidationErrors: errors,
        ...(leverRejected ? { mainLeverCorrection: mainLeverCorrectionFor(candidate?.mainLever) } : {}),
      };
      if (leverRejected) console.warn('[cascade][slot-lever-rejected]', { slot: template.slot, attempt: attempt + 1, mainLever: candidate?.mainLever ?? null });
      const raw = await opts.requestSlot(template, feedback);
      const reviewed = reviewSlotCandidate(raw, template.slot, opts);
      candidate = reviewed.candidate;
      errors = reviewed.errors;
      opts.diagnostics?.push({
        phase: 'slot', slot: template.slot, attempt: attempt + 1,
        rawMainLever: rawMainLeverOf(raw), mainLever: candidate?.mainLever ?? null, errors: [...errors],
        ...(template.slot === 4 ? { slot4: slot4DiagnosticsOf(candidate, errors, opts.indirect === true) } : {}),
      });
      if (!errors.length) break;
    }
    if (errors.length) throw new Error(errors.join(','));
    projects.push(candidate);
  }
  return projects;
}

/** 事業セグメントに対応しない部門（人事部など）へ渡す指示。顧客・市場の根拠を創作させず、支援・協働の成果で設計させる。 */
export const INDIRECT_DEPARTMENT_GUIDANCE =
  '間接部門（事業セグメントに対応しない部門）。直接の顧客・市場の根拠がなくても、全社戦略と部門の役割・6問回答から施策を設計する。成果は、全社戦略の実現に必要な人材・能力、事業部門（営業・開発・生産など）への支援、事業・部門間の協働と役割分担、それらの企業価値・業績への貢献として示す。研修件数や制度整備を最終目的にしない。causalDesign の buyer は支援を受ける事業部門・全社、customerChange は事業部門の業務や全社の人材・能力の変化とする。顧客成果の指標は支援先部門の成果（measurementScope は internal_process）で書き、顧客や市場の数値を創作しない。mainLever は施策が効かせる指標に合わせて6コードから1つ選び、ARPUを既定にしない。';

/** FACTPACK の対応結果から、間接部門かを判定する。対応結果が無い場合は事業部門として扱う。 */
export function isIndirectDepartment(facts: { segmentMatched?: boolean } | null | undefined): boolean {
  return facts?.segmentMatched === false;
}

/** 生成入力へ加える部門の区分と、間接部門の指示 */
export function departmentScopeFields(indirect: boolean): { departmentScope: 'indirect' | 'business'; departmentGuidance?: string } {
  return indirect
    ? { departmentScope: 'indirect', departmentGuidance: INDIRECT_DEPARTMENT_GUIDANCE }
    : { departmentScope: 'business' };
}

/**
 * 応答テンプレートの mainLever。間接部門は説明文を入れず（null）、モデルに6コードから選ばせる。
 * 事業部門は従来どおりの既定値を示す。
 */
export function leverForTemplate(indirect: boolean, slot: number): string | null {
  if (indirect) return null;
  return slot === 3 ? 'FUTURE' : 'ARPU';
}

/** 応答テンプレートの因果設計（buyer・customerChange）と顧客成果の指定。間接部門は支援先部門の成果で示す。 */
export function designTemplateFor(indirect: boolean): {
  buyer: string;
  customerChange: string;
  kpi: { measurementScope: 'client_business' | 'internal_process'; population: string };
} {
  return indirect
    ? {
        buyer: '支援を受ける事業部門・全社',
        customerChange: '事業部門の業務や全社の人材・能力の変化',
        kpi: { measurementScope: 'internal_process', population: '支援を受ける事業部門の対象業務の範囲' },
      }
    : {
        buyer: '発注企業・施設運営者',
        customerChange: '発注企業・利用者の変化',
        kpi: { measurementScope: 'client_business', population: '対象施設・利用者の範囲' },
      };
}
