// /app/api/generate-ot/route.ts
import 'server-only';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

import { NextRequest, NextResponse } from 'next/server';
import { openai } from '@/lib/openai';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { getAuthUserIdFromBearer, requireMembership } from '@/lib/server/rbacGuard';
import { AI_MODELS, getResponsesParamsForProcess } from '@/lib/modelConfig';
import {
  OT_ANALYSIS_INSTRUCTIONS,
  OT_ANALYSIS_NEED_INSTRUCTIONS,
  OT_ANALYSIS_NEED_SCHEMA,
  OT_ANALYSIS_SCHEMA,
  OT_SEARCH_INSTRUCTIONS,
  OtRequestSchema,
  allowedIndustryLabel,
  buildAnalysisInput,
  buildSearchInput,
  EXTRACTION_LIMITS,
  buildCategoryKeys,
  classifyFailure,
  extractSearchFindings,
  isWebSearchEnabled,
  mergeSearchExtractions,
  parseAnalysis,
  parseJsonObject,
  parseNeedAnalysis,
  readResponse,
  readTokenUsage,
  toCompanyContext,
  toMarkdownList,
  UNSPECIFIED_INDUSTRY_CODE,
  type CompanyContext,
  type FailureCode,
  type OtAnalysis,
  type OtItem,
  type Segment,
  type SearchExtraction,
  type Source,
  type TokenCounts,
  type WebResult,
} from '@/lib/swot/generateOt';
import {
  MARKET_TAXONOMY,
  matchCompanyMarkets,
  planSearchCalls,
  type CompanyMatch,
  type SearchPlan,
} from '@/lib/swot/marketTaxonomy';
import { isCustomerNeedDiscoveryEnabled } from '@/lib/swot/customerNeeds/flags';
import {
  inferSegmentRoles,
  buildSegmentNeedPlans,
  type SegmentInfo,
  type SegmentPlanReport,
  type SegmentRoles,
} from '@/lib/swot/customerNeeds/runner';
import { renderRolesBlock, roleLabelJa, type CustomerRole } from '@/lib/swot/customerNeeds/roles';
import {
  capNeedItemsPerSegment,
  toNeedItems,
  type NeedItem,
  type NeedOpportunityRaw,
} from '@/lib/swot/customerNeeds/opportunities';
import { checkSourceBodies, type BodyCheckStats } from '@/lib/swot/sourceBody';
import {
  BODY_CHECK_MS,
  EXPANSION_SCHEMA,
  buildExpansionInstructions,
  focusGroups,
  mergeOpportunities,
  parseExpansionItems,
  planBodyCheck,
} from '@/lib/swot/opportunityPool';
import { OPPORTUNITY_GROUPS, type OpportunityGroup } from '@/lib/swot/opportunityGroups';
import { z } from 'zod';
import type { ResponseCreateParamsNonStreaming } from 'openai/resources/responses/responses';
import { inspectOtResult, isHttpsUrl, type QualityReport } from '@/lib/swot/qualityCheck';
import { buildSegmentReports, summarizeAdoption, type CallStat } from '@/lib/swot/diagnostics';

// SDK 5.23 の型定義に未収録だが、公式 API はこの include を受け付ける（出典一覧の取得に必要）
const SEARCH_SOURCES_INCLUDE = ['web_search_call.action.sources'] as unknown as never[];

const TOTAL_BUDGET_MS = 50_000;
const SEARCH_CAP_MS = 25_000;
const ANALYSIS_CAP_MS = 35_000;
const RETRY_STATUSES = new Set([429, 500, 502, 503, 504]);
const BACKOFF_MS = [300, 800];
const SEARCH_TRIES = 2;
const ANALYSIS_TRIES = 2;
const FALLBACK_TRIES = 2;

type Usage = {
  llmCalls: number;
  searchRequests: number;
  tokens: TokenCounts & { reportedCalls: number };
};

const newUsage = (): Usage => ({
  llmCalls: 0,
  searchRequests: 0,
  tokens: { input: 0, output: 0, reasoning: 0, reportedCalls: 0 },
});

function addTokens<T>(usage: Usage, res: T): T {
  const t = readTokenUsage(res);
  if (t) {
    usage.tokens.input += t.input;
    usage.tokens.output += t.output;
    usage.tokens.reasoning += t.reasoning;
    usage.tokens.reportedCalls++;
  }
  return res;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function errorStatus(e: unknown): number {
  return Number((e as { status?: unknown })?.status ?? 0);
}

async function withRetry<T>(
  tries: number,
  deadline: number,
  usage: Usage,
  capMs: number,
  run: (timeout: number) => Promise<T>
): Promise<T> {
  let lastErr: unknown = new Error('time_budget_exhausted');
  for (let i = 0; i < tries; i++) {
    const remaining = deadline - Date.now();
    if (remaining <= 1_000) break;
    usage.llmCalls++;
    try {
      return await run(Math.min(capMs, remaining - 1_000));
    } catch (e) {
      lastErr = e;
      if (!RETRY_STATUSES.has(errorStatus(e)) || i === tries - 1) break;
      await sleep(BACKOFF_MS[Math.min(i, BACKOFF_MS.length - 1)]);
    }
  }
  throw lastErr;
}

type SearchCallOutcome = { extraction: SearchExtraction | null; errorCode?: FailureCode; elapsedMs: number };

async function runSearchCall(
  input: string,
  layer: string | undefined,
  deadline: number,
  usage: Usage,
  categoryKeys?: ReadonlyMap<string, string>,
  segment?: string
): Promise<SearchCallOutcome> {
  const startedAt = Date.now();
  try {
    const params = getResponsesParamsForProcess('stage2OtSearch');
    const res = await withRetry(SEARCH_TRIES, deadline, usage, SEARCH_CAP_MS, (timeout) => {
      usage.searchRequests++;
      return openai.responses
        .create(
          {
            ...params,
            instructions: OT_SEARCH_INSTRUCTIONS,
            input,
            tools: [{ type: 'web_search' }],
            tool_choice: 'required',
            include: SEARCH_SOURCES_INCLUDE,
            store: false,
          },
          { timeout, maxRetries: 0 }
        )
        .then((r) => addTokens(usage, r));
    });
    return {
      extraction: extractSearchFindings(res, new Date().toISOString(), layer, { categoryKeys, segment }),
      elapsedMs: Date.now() - startedAt,
    };
  } catch (e) {
    return { extraction: null, errorCode: classifyFailure(e), elapsedMs: Date.now() - startedAt };
  }
}

function combineSearchOutcomes(outcomes: SearchCallOutcome[]): WebResult {
  const extractions = outcomes.flatMap((o) => (o.extraction ? [o.extraction] : []));
  const merged = mergeSearchExtractions(extractions);
  const base = {
    findings: merged.findings,
    sources: merged.sources,
    searchCalls: merged.webSearchCalls,
    diagnostics: merged.diagnostics,
    elapsedMs: Math.max(0, ...outcomes.map((o) => o.elapsedMs)),
  };
  if (merged.findings.length > 0) return { status: 'completed', ...base };
  if (extractions.length > 0 && merged.webSearchCalls === 0) return { status: 'no_search', ...base };
  const errorCode = outcomes.find((o) => o.errorCode)?.errorCode ?? merged.failureCode ?? 'unknown';
  return { status: 'failed', ...base, errorCode };
}

function callStat(id: string, o: SearchCallOutcome): CallStat {
  const d = o.extraction?.diagnostics;
  return {
    id,
    status: o.extraction ? 'ok' : 'failed',
    errorCode: o.errorCode ?? o.extraction?.failureCode ?? null,
    elapsedMs: o.elapsedMs,
    findings: o.extraction?.findings.length ?? 0,
    droppedByLimit: d?.droppedByLimit ?? 0,
    duplicateLines: d?.duplicateLines ?? 0,
    unattributedLines: d?.unattributedLines ?? 0,
    rejectedLines: d?.rejectedLines ?? 0,
  };
}

type SearchRun = {
  web: WebResult;
  classification: 'matched' | 'partial' | 'unmatched' | 'not_searched';
  calls: Array<{ id: string; categoryIds: string[] }>;
  categoryIds: string[];
  droppedCategories: number;
  callStats: CallStat[];
};

/**
 * 製品・顧客市場の分類に一致した内容から検索を組み立てる。
 * 一致が無ければ業種レベルの従来の検索を1回行う（推測はしない）。
 * 1回の検索が失敗しても、残りの結果で続行する。
 */
async function runWebSearch(args: {
  industryLabel: string;
  industrySkipStatus: 'skipped_no_industry' | 'skipped_unspecified_industry';
  regions: string[];
  match: CompanyMatch;
  needPlans: SearchPlan[];
  deadline: number;
  usage: Usage;
}): Promise<SearchRun> {
  const plans = planSearchCalls({ industryLabel: args.industryLabel, regions: args.regions, match: args.match });
  if (!args.industryLabel && plans.length === 0) {
    return {
      web: { status: args.industrySkipStatus, findings: [], sources: [], searchCalls: 0 },
      classification: 'not_searched',
      calls: [],
      categoryIds: [],
      droppedCategories: 0,
      callStats: [],
    };
  }
  const allPlans = [...plans, ...args.needPlans];
  const calls: Array<{
    id: string;
    input: string;
    categoryIds: string[];
    keys?: ReadonlyMap<string, string>;
    segment?: string;
  }> = allPlans.length
    ? allPlans.map((p) => ({
        id: p.id,
        input: p.input,
        categoryIds: p.categoryIds,
        keys: buildCategoryKeys(p.categories),
        segment: p.segment,
      }))
    : [{ id: 'industry', input: buildSearchInput(args.industryLabel, args.regions), categoryIds: [] as string[] }];
  const outcomes = await Promise.all(
    calls.map((c) =>
      runSearchCall(c.input, c.id === 'industry' ? undefined : c.id, args.deadline, args.usage, c.keys, c.segment)
    )
  );
  return {
    web: combineSearchOutcomes(outcomes),
    classification: plans.length ? (args.match.unmatchedSegments > 0 ? 'partial' : 'matched') : 'unmatched',
    calls: calls.map((c) => ({ id: c.id, categoryIds: c.categoryIds })),
    categoryIds: calls.flatMap((c) => c.categoryIds),
    droppedCategories: args.match.droppedCategories,
    callStats: outcomes.map((o, i) => callStat(calls[i].id, o)),
  };
}

async function runAnalysis(
  ctx: CompanyContext,
  web: WebResult,
  deadline: number,
  usage: Usage,
  rolesBlock?: string
): Promise<{ analysis: OtAnalysis; customerNeeds: NeedOpportunityRaw[] }> {
  const params = getResponsesParamsForProcess('stage2Ot');
  const need = rolesBlock !== undefined;
  const res = await withRetry(ANALYSIS_TRIES, deadline, usage, ANALYSIS_CAP_MS, (timeout) =>
    openai.responses
      .create(
        {
          ...params,
          instructions: need ? OT_ANALYSIS_NEED_INSTRUCTIONS : OT_ANALYSIS_INSTRUCTIONS,
          input: buildAnalysisInput(ctx, web, rolesBlock),
          text: {
            format: {
              type: 'json_schema',
              name: 'ot_analysis',
              schema: need ? OT_ANALYSIS_NEED_SCHEMA : OT_ANALYSIS_SCHEMA,
              strict: true,
            },
          },
          store: false,
        },
        { timeout, maxRetries: 0 }
      )
      .then((r) => addTokens(usage, r))
  );
  const text = readResponse(res).text;
  if (!need) return { analysis: parseAnalysis(text, web.sources.length), customerNeeds: [] };
  return parseNeedAnalysis(text, web.sources.length);
}

const ROLE_CAP_MS = 15_000;

async function invokeRoles(params: ResponseCreateParamsNonStreaming, deadline: number, usage: Usage): Promise<string> {
  const res = await withRetry(ANALYSIS_TRIES, deadline, usage, ROLE_CAP_MS, (timeout) =>
    openai.responses.create(params, { timeout, maxRetries: 0 }).then((r) => addTokens(usage, r))
  );
  return readResponse(res).text;
}

/** 分類の順番（売上降順、同額は入力順）に並べた事業情報。rank は marketTaxonomy の segments の番号と一致する */
/**
 * 分類の順番（売上降順、同額は入力順）に並べた事業情報。rank は marketTaxonomy の segments の番号と一致し、
 * その事業に一致した製品・顧客の分類だけを持つ（別の事業の分類は混ぜない）。
 */
function buildSegmentInfos(segments: readonly Segment[], businessContent: string, match: CompanyMatch): SegmentInfo[] {
  const categoriesOf = (rank: number): Pick<SegmentInfo, 'productCategories' | 'customerCategories'> => {
    const m = match.segments.find((s) => s.rank === rank);
    return { productCategories: m?.product ?? [], customerCategories: m?.customer ?? [] };
  };
  if (segments.length === 0) {
    return businessContent.trim()
      ? [{ rank: 1, name: '事業内容（自由記述）', summary: businessContent, scope: '', mainProductsServices: [], keyCustomers: [], ...categoriesOf(1) }]
      : [];
  }
  return segments
    .map((s, i) => ({ s, i }))
    .sort((a, b) => (b.s.revenue ?? 0) - (a.s.revenue ?? 0) || a.i - b.i)
    .map(({ s }, k) => ({
      rank: k + 1,
      name: s.name,
      summary: s.summary,
      scope: s.scope,
      mainProductsServices: s.mainProductsServices,
      keyCustomers: s.keyCustomers,
      ...categoriesOf(k + 1),
    }));
}

function labelOfCategory(id: string): string {
  return MARKET_TAXONOMY.find((c) => c.id === id)?.label ?? id;
}

function roleBasisCounts(roles: readonly CustomerRole[]) {
  return {
    input: roles.filter((r) => r.basis === 'input').length,
    public: roles.filter((r) => r.basis === 'public').length,
    estimated: roles.filter((r) => r.basis === 'estimated').length,
  };
}

async function runFallback(
  ctx: CompanyContext,
  web: WebResult,
  deadline: number,
  usage: Usage
): Promise<OtAnalysis> {
  const res = await withRetry(FALLBACK_TRIES, deadline, usage, Number.POSITIVE_INFINITY, (timeout) =>
    openai.chat.completions
      .create(
        {
          model: AI_MODELS.legacy,
          temperature: 0.3,
          max_tokens: 1500,
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: OT_ANALYSIS_INSTRUCTIONS },
            { role: 'user', content: buildAnalysisInput(ctx, web) },
          ],
        },
        { timeout, maxRetries: 0 }
      )
      .then((r) => addTokens(usage, r))
  );
  return parseAnalysis(res.choices[0]?.message?.content ?? '', web.sources.length);
}

const EvidenceSchema = z.object({
  findings: z
    .array(
      z.object({
        theme: z.string().max(200),
        statement: z.string().max(500),
        sourceIndex: z.number().int().min(1).max(50),
        layer: z.string().max(40).optional(),
        categoryId: z.string().max(60).optional(),
        segment: z.string().max(100).optional(),
      })
    )
    .max(40),
  sources: z
    .array(
      z.object({
        index: z.number().int().min(1).max(50),
        url: z.string().max(2000).refine((u) => isHttpsUrl(u)),
        title: z.string().max(300),
        retrievedAt: z.string().max(40),
        contentVerified: z.boolean().optional(),
        bodyCheck: z.enum(['matched', 'not_matched', 'unavailable']).optional(),
      })
    )
    .max(20),
});

const ExtendRequestSchema = OtRequestSchema.extend({
  mode: z.literal('extend'),
  evidence: EvidenceSchema.optional(),
  existing: z
    .array(z.object({ text: z.string().max(300), group: z.enum(OPPORTUNITY_GROUPS).optional() }))
    .max(30)
    .optional(),
  focus: z.array(z.enum(OPPORTUNITY_GROUPS)).max(4).optional(),
});

function isExtendBody(body: unknown): boolean {
  return typeof body === 'object' && body !== null && (body as { mode?: unknown }).mode === 'extend';
}

/**
 * 追加探索。前回の生成で得た出典と根拠（クライアントが保持）を使い、Web 検索はやり直さない。
 * 既存の候補と重複しない新しい候補だけを返す。既存の候補は、このレスポンスでは変更しない。
 */
async function runExtend(body: unknown, startedAt: number): Promise<NextResponse> {
  const parsed = ExtendRequestSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: '入力形式が不正です' }, { status: 400 });
  const data = parsed.data;
  const deadline = startedAt + TOTAL_BUDGET_MS;
  const usage = newUsage();
  const ctx = toCompanyContext(data, allowedIndustryLabel(data.industry.trim()));
  // 根拠がなければ外部情報は空。Web 検索は行わず、社内情報と既存の候補だけで探索仮説を出す
  const web: WebResult = {
    status: 'completed',
    findings: data.evidence?.findings ?? [],
    sources: data.evidence?.sources ?? [],
    searchCalls: 0,
  };
  const existingItems: OtItem[] = (data.existing ?? []).map((e) => ({
    text: e.text.trim(),
    group: e.group,
    basis: 'hypothesis',
    evidence: '',
    sourceIndex: null,
  }));
  const focus: OpportunityGroup[] = data.focus?.length ? data.focus : focusGroups(existingItems);
  const params = getResponsesParamsForProcess('stage2Ot');
  let text: string;
  try {
    const res = await withRetry(ANALYSIS_TRIES, deadline, usage, ANALYSIS_CAP_MS, (timeout) =>
      openai.responses
        .create(
          {
            ...params,
            instructions: buildExpansionInstructions({ focus, existing: existingItems.map((i) => i.text) }),
            input: buildAnalysisInput(ctx, web),
            text: { format: { type: 'json_schema', name: 'ot_expansion', schema: EXPANSION_SCHEMA, strict: true } },
            store: false,
          },
          { timeout, maxRetries: 0 }
        )
        .then((r) => addTokens(usage, r))
    );
    text = readResponse(res).text;
  } catch (e) {
    console.error('[generate-ot] expansion_failed', JSON.stringify({ code: classifyFailure(e) }));
    return NextResponse.json({ error: 'O/T追加生成に失敗しました' }, { status: errorStatus(e) === 429 ? 429 : 502 });
  }
  const obj = parseJsonObject(text);
  if (!obj) return NextResponse.json({ error: 'O/T追加生成に失敗しました' }, { status: 502 });
  const incoming = parseExpansionItems(obj, web.sources.length);
  const merged = mergeOpportunities(existingItems, incoming);
  const added = merged.items.slice(existingItems.length);
  return NextResponse.json({
    opportunity: added.map((i) => i.text),
    insights: { opportunity: added, threat: [] },
    meta: {
      mode: 'extend',
      added: merged.added,
      duplicates: merged.duplicates,
      capped: merged.capped,
      focus,
      total: existingItems.length + merged.added,
      model: params.model,
      searchCalls: 0,
      elapsedMs: Date.now() - startedAt,
      llmCalls: usage.llmCalls,
      tokens: { ...usage.tokens, llmCalls: usage.llmCalls },
    },
  });
}

export async function POST(req: NextRequest) {
  const startedAt = Date.now();
  const deadline = startedAt + TOTAL_BUDGET_MS;
  const usage = newUsage();
  try {
    const admin = getSupabaseAdmin();
    const userId = await getAuthUserIdFromBearer(admin, req);
    if (!userId) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }
    const membership = await requireMembership(admin, userId);
    if (!membership) {
      return NextResponse.json({ error: 'forbidden' }, { status: 403 });
    }
    // STAGE2 の機会・脅威の編集は管理者のみ（画面の仕様と一致させる）。初回生成も追加探索も同じ条件
    if (String(membership.role ?? '').toLowerCase() !== 'admin') {
      return NextResponse.json({ error: 'forbidden' }, { status: 403 });
    }

    const rawBody: unknown = await req.json().catch(() => ({}));
    if (isExtendBody(rawBody)) return runExtend(rawBody, startedAt);
    const parsed = OtRequestSchema.safeParse(rawBody);
    if (!parsed.success) {
      return NextResponse.json({ error: '入力形式が不正です' }, { status: 400 });
    }

    const industryCode = (parsed.data.industry ?? '').trim();
    const industryLabel = allowedIndustryLabel(industryCode);
    const isUnspecifiedIndustry = industryCode === UNSPECIFIED_INDUSTRY_CODE;
    const industrySource: 'allowlisted' | 'unspecified' | 'unrecognized' | 'none' = isUnspecifiedIndustry
      ? 'unspecified'
      : industryLabel
        ? 'allowlisted'
        : industryCode
          ? 'unrecognized'
          : 'none';
    const analysisIndustry = industryLabel || industryCode.slice(0, 100);
    const baseCtx = toCompanyContext(parsed.data, analysisIndustry);
    const needDiscovery = isCustomerNeedDiscoveryEnabled(process.env.OT_CUSTOMER_NEED_DISCOVERY);
    const segments = parsed.data.businessSegments;
    const match: CompanyMatch = matchCompanyMarkets({
      businessContent: parsed.data.businessContent,
      segments: segments.map((s) => ({
        revenue: s.revenue,
        productTexts: [s.name, s.summary, s.scope, ...s.mainProductsServices],
        customerTexts: s.keyCustomers,
      })),
    });
    const ctx: CompanyContext = {
      ...baseCtx,
      marketLabels: [...match.product, ...match.customer, ...match.substitute, ...match.criteria].map((c) => c.label),
    };

    const webEnabled = isWebSearchEnabled(process.env.OT_WEB_SEARCH_ENABLED);
    const needEnabled = webEnabled && needDiscovery;
    const searchIndustry = isUnspecifiedIndustry ? '' : industryLabel;
    const regions = ctx.currentRegions ?? [];
    const segmentInfos = buildSegmentInfos(segments, parsed.data.businessContent, match);
    const rolesStartedAt = Date.now();
    const segmentRoles: SegmentRoles[] = needEnabled
      ? await inferSegmentRoles({
          segments: segmentInfos,
          businessContent: parsed.data.businessContent,
          params: getResponsesParamsForProcess('stage2Roles'),
          invoke: (params) => invokeRoles(params, deadline, usage),
        })
      : [];
    const rolesMs = needEnabled ? Date.now() - rolesStartedAt : null;
    const planned = needEnabled
      ? buildSegmentNeedPlans({ industryLabel: searchIndustry, regions, segments: segmentInfos, segmentRoles })
      : { plans: [] as SearchPlan[], reports: [] as SegmentPlanReport[] };
    const needPlans = planned.plans;
    const segmentPlans = planned.reports;
    const needActive = needEnabled && needPlans.length > 0 && segmentRoles.some((r) => r.roles.length > 0);
    const searchRun: SearchRun = !webEnabled
      ? { web: { status: 'disabled', findings: [], sources: [], searchCalls: 0 }, classification: 'not_searched', calls: [], categoryIds: [], droppedCategories: 0, callStats: [] }
      : await runWebSearch({
          industryLabel: searchIndustry,
          industrySkipStatus: isUnspecifiedIndustry ? 'skipped_unspecified_industry' : 'skipped_no_industry',
          regions,
          match,
          needPlans: needActive ? needPlans : [],
          deadline,
          usage,
        });
    let web = searchRun.web;
    let bodyStats: BodyCheckStats | null = null;
    let bodyMs: number | null = null;
    const bodyCheckPlanned = needEnabled && web.findings.length > 0 && planBodyCheck(deadline - Date.now());
    if (bodyCheckPlanned) {
      const bodyStartedAt = Date.now();
      const checked = await checkSourceBodies({
        sources: web.sources,
        findings: web.findings,
        deadlineMs: bodyStartedAt + BODY_CHECK_MS,
      });
      web = { ...web, sources: checked.sources };
      bodyStats = checked.stats;
      bodyMs = Date.now() - bodyStartedAt;
    }
    const allRoles: CustomerRole[] = segmentRoles.flatMap((r) => r.roles);
    const rolesBlock = needActive
      ? renderRolesBlock(
          segmentRoles.map((r) => ({ segment: r.name, roles: r.roles })),
          labelOfCategory
        )
      : undefined;
    const searchMs = Date.now() - startedAt;

    let analysis: OtAnalysis | undefined;
    let customerNeeds: NeedOpportunityRaw[] = [];
    let usedFallback = false;
    let fallbackCode: FailureCode | undefined;
    const analysisStartedAt = Date.now();
    try {
      const run = await runAnalysis(ctx, web, deadline, usage, rolesBlock);
      analysis = run.analysis;
      customerNeeds = run.customerNeeds;
    } catch (e) {
      fallbackCode = classifyFailure(e);
      console.error('[generate-ot] analysis_failed', JSON.stringify({ code: fallbackCode }));
      try {
        analysis = await runFallback(ctx, web, deadline, usage);
        customerNeeds = [];
        usedFallback = true;
      } catch (e2) {
        console.error('[generate-ot] fallback_failed', JSON.stringify({ code: classifyFailure(e2) }));
        return NextResponse.json(
          { error: 'O/T生成に失敗しました' },
          { status: errorStatus(e2) === 429 ? 429 : 502 }
        );
      }
    }
    if (!analysis) {
      return NextResponse.json({ error: 'O/T生成に失敗しました' }, { status: 502 });
    }
    const analysisMs = Date.now() - analysisStartedAt;

    const inspected = inspectOtResult(analysis, web.sources, searchRun.categoryIds, web.findings);
    const finalAnalysis = inspected.analysis;
    const quality: QualityReport = inspected.report;
    const segmentReports = buildSegmentReports(match, web, analysis, finalAnalysis);

    let needItems: NeedItem[] = [];
    let needQuality: QualityReport | null = null;
    let needDropped: Record<string, number> | null = null;
    let needEvidence: Record<string, number> | null = null;
    if (needActive && !usedFallback && customerNeeds.length > 0) {
      const segmentNames = segmentInfos.map((s) => s.name);
      const converted = toNeedItems({
        items: customerNeeds,
        roles: allRoles,
        findings: web.findings,
        sources: web.sources,
        segments: segmentNames,
        labelOf: roleLabelJa,
        categoryLabelOf: labelOfCategory,
      });
      const inspectedNeeds = inspectOtResult({ opportunities: converted.items, threats: [] }, web.sources, [], web.findings);
      const capped = capNeedItemsPerSegment(
        inspectedNeeds.analysis.opportunities.filter((i): i is NeedItem => i.need !== undefined),
        segmentNames
      );
      needItems = capped.items;
      needQuality = inspectedNeeds.report;
      needDropped = { ...converted.dropped, ...capped.dropped };
      needEvidence = { ...converted.evidenceUse };
    }
    const diagnostics = {
      version: 2,
      classification: searchRun.classification,
      searchStatus: web.status,
      searchCalls: web.searchCalls,
      searchRequests: usage.searchRequests,
      calls: searchRun.callStats,
      adoption: summarizeAdoption(web, analysis, finalAnalysis),
      tokens: { ...usage.tokens, llmCalls: usage.llmCalls },
      limits: EXTRACTION_LIMITS,
      totals: web.diagnostics
        ? {
            lines: web.diagnostics.lines,
            attributedLines: web.diagnostics.attributedLines,
            rejectedLines: web.diagnostics.rejectedLines,
            unattributedLines: web.diagnostics.unattributedLines ?? 0,
            duplicateLines: web.diagnostics.duplicateLines ?? 0,
            droppedByLimit: web.diagnostics.droppedByLimit ?? 0,
            findings: web.diagnostics.findings,
          }
        : null,
      byCategory: web.diagnostics?.byCategory ?? {},
      segments: segmentReports,
      adoptedCategoryIds: Array.from(
        new Set(segmentReports.flatMap((s) => (s.adoptedOpportunity + s.adoptedThreat > 0 ? s.categoryIds : [])))
      ),
      unmatchedSegments: match.unmatchedSegments,
      customerNeeds: needEnabled
        ? {
            active: needActive,
            segments: segmentPlans.map((p) => {
              const roles = segmentRoles.find((r) => r.rank === p.rank)?.roles ?? [];
              return {
                rank: p.rank,
                name: p.name,
                plan: p.planKind,
                planReason: p.reason,
                customerConfirmed: p.customerConfirmed,
                categoryIds: p.categoryIds,
                roleCounts: roleBasisCounts(roles),
                roles: roles.map((r) => ({
                  role: r.role,
                  basis: r.basis,
                  label: r.label,
                  categoryIds: r.categoryIds ?? [],
                })),
              };
            }),
            plans: needPlans.length,
            bodyCheck: bodyStats,
            bodyCheckSkipped: needEnabled && web.findings.length > 0 && !bodyCheckPlanned,
            candidates: customerNeeds.length,
            adopted: needItems.length,
            dropped: needDropped,
            evidenceUse: needEvidence,
            bySegment: needItems.reduce<Record<string, number>>((acc, i) => {
              const key = i.need.segmentName ?? '未特定';
              acc[key] = (acc[key] ?? 0) + 1;
              return acc;
            }, {}),
            grades: {
              verified: needItems.filter((i) => i.need.grade === 'verified_public').length,
              hypothesis: needItems.filter((i) => i.need.grade === 'hypothesis').length,
            },
            quality: needQuality
              ? {
                  sourceIndexInvalid: needQuality.sourceIndexInvalid,
                  unlinkedCitations: needQuality.unlinkedCitations,
                  numberNotInSourceCorrected: needQuality.numberNotInSourceCorrected,
                }
              : null,
            timingsMs: { roles: rolesMs, bodyCheck: bodyMs },
          }
        : null,
      quality,
      timingsMs: { total: Date.now() - startedAt, search: searchMs, analysis: analysisMs },
      llmCalls: usage.llmCalls,
    };

    const analysisModel = usedFallback ? AI_MODELS.legacy : getResponsesParamsForProcess('stage2Ot').model;
    const searchModel = getResponsesParamsForProcess('stage2OtSearch').model;
    const analysisMode = web.status === 'completed' ? 'with_web' : 'internal_only';
    const elapsedMs = Date.now() - startedAt;
    const webSearchMeta = {
      enabled: webEnabled,
      status: web.status,
      searchCalls: web.searchCalls,
      searchRequests: usage.searchRequests,
      classification: searchRun.classification,
      droppedCategories: searchRun.droppedCategories,
      calls: searchRun.calls,
      callStats: searchRun.callStats,
      model: web.status === 'completed' || web.status === 'no_search' || web.status === 'failed' ? searchModel : null,
      errorCode: web.errorCode ?? null,
      elapsedMs: web.elapsedMs ?? null,
      diagnostics: web.diagnostics ?? null,
      industrySource,
      customerNeedDiscovery: needDiscovery,
    };
    console.info(
      '[generate-ot]',
      JSON.stringify({
        analysisModel,
        usedFallback,
        fallbackCode: fallbackCode ?? null,
        analysisMode,
        currentRegionScope: ctx.currentRegions?.length ? 'specified' : 'unspecified',
        webSearch: webSearchMeta,
        sources: web.sources.length,
        quality,
        diagnostics,
        llmCalls: usage.llmCalls,
        elapsedMs,
      })
    );

    const marketOpportunities: OtItem[] = needEnabled
      ? finalAnalysis.opportunities.map((i) => ({ ...i, discoveryPath: 'market' as const }))
      : finalAnalysis.opportunities;
    const finalOpportunities: OtItem[] = [...marketOpportunities, ...needItems];
    const opportunity = finalOpportunities.map((i) => i.text);
    const threat = finalAnalysis.threats.map((i) => i.text);
    const resultMarkdown =
      toMarkdownList(opportunity, '機会', 'Opportunity') + '\n' + toMarkdownList(threat, '脅威', 'Threat');

    return NextResponse.json(
      {
        opportunity,
        threat,
        result: resultMarkdown,
        insights: { opportunity: finalOpportunities, threat: finalAnalysis.threats },
        sources: web.sources,
        meta: {
          evidence: {
            findings: web.findings.slice(0, 40).map((f) => ({
              theme: f.theme,
              statement: f.statement.slice(0, 300),
              sourceIndex: f.sourceIndex,
              ...(f.layer ? { layer: f.layer } : {}),
              ...(f.categoryId ? { categoryId: f.categoryId } : {}),
              ...(f.segment ? { segment: f.segment } : {}),
            })),
            sources: web.sources.map((s) => ({
              index: s.index,
              url: s.url,
              title: s.title,
              retrievedAt: s.retrievedAt,
              ...(s.contentVerified !== undefined ? { contentVerified: s.contentVerified } : {}),
              ...(s.bodyCheck ? { bodyCheck: s.bodyCheck } : {}),
            })),
          },
          model: analysisModel,
          usedFallback,
          fallbackCode: fallbackCode ?? null,
          analysisMode,
          webSearch: webSearchMeta,
          quality,
          diagnostics,
          llmCalls: usage.llmCalls,
          elapsedMs,
        },
      },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (err) {
    console.error('❌ O/T生成エラー', JSON.stringify({ code: classifyFailure(err) }));
    return NextResponse.json({ error: 'O/T生成に失敗しました' }, { status: 500 });
  }
}
