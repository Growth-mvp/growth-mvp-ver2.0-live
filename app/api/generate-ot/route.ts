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
  readResponse,
  readTokenUsage,
  toCompanyContext,
  toMarkdownList,
  UNSPECIFIED_INDUSTRY_CODE,
  type CompanyContext,
  type FailureCode,
  type OtAnalysis,
  type OtItem,
  type SearchExtraction,
  type TokenCounts,
  type WebResult,
} from '@/lib/swot/generateOt';
import { matchCompanyMarkets, planSearchCalls, type CompanyMatch } from '@/lib/swot/marketTaxonomy';
import { isCustomerNeedDiscoveryEnabled } from '@/lib/swot/customerNeeds/flags';
import { buildNeedSearchPlan } from '@/lib/swot/customerNeeds/searchPlan';
import { inspectOtResult, type QualityReport } from '@/lib/swot/qualityCheck';
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
  categoryKeys?: ReadonlyMap<string, string>
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
      extraction: extractSearchFindings(res, new Date().toISOString(), layer, { categoryKeys }),
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
  needDiscovery: boolean;
  deadline: number;
  usage: Usage;
}): Promise<SearchRun> {
  const plans = planSearchCalls({ industryLabel: args.industryLabel, regions: args.regions, match: args.match });
  const needPlan = args.needDiscovery
    ? buildNeedSearchPlan({ industryLabel: args.industryLabel, regions: args.regions, match: args.match })
    : null;
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
  const allPlans = needPlan ? [...plans, needPlan] : plans;
  const calls: Array<{ id: string; input: string; categoryIds: string[]; keys?: ReadonlyMap<string, string> }> = allPlans.length
    ? allPlans.map((p) => ({ id: p.id, input: p.input, categoryIds: p.categoryIds, keys: buildCategoryKeys(p.categories) }))
    : [{ id: 'industry', input: buildSearchInput(args.industryLabel, args.regions), categoryIds: [] as string[] }];
  const outcomes = await Promise.all(
    calls.map((c) => runSearchCall(c.input, c.id === 'industry' ? undefined : c.id, args.deadline, args.usage, c.keys))
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
  usage: Usage
): Promise<OtAnalysis> {
  const params = getResponsesParamsForProcess('stage2Ot');
  const res = await withRetry(ANALYSIS_TRIES, deadline, usage, ANALYSIS_CAP_MS, (timeout) =>
    openai.responses
      .create(
        {
          ...params,
          instructions: OT_ANALYSIS_INSTRUCTIONS,
          input: buildAnalysisInput(ctx, web),
          text: {
            format: { type: 'json_schema', name: 'ot_analysis', schema: OT_ANALYSIS_SCHEMA, strict: true },
          },
          store: false,
        },
        { timeout, maxRetries: 0 }
      )
      .then((r) => addTokens(usage, r))
  );
  return parseAnalysis(readResponse(res).text, web.sources.length);
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

    const parsed = OtRequestSchema.safeParse(await req.json().catch(() => ({})));
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
    const searchRun: SearchRun = !webEnabled
      ? { web: { status: 'disabled', findings: [], sources: [], searchCalls: 0 }, classification: 'not_searched', calls: [], categoryIds: [], droppedCategories: 0, callStats: [] }
      : await runWebSearch({
          industryLabel: isUnspecifiedIndustry ? '' : industryLabel,
          industrySkipStatus: isUnspecifiedIndustry ? 'skipped_unspecified_industry' : 'skipped_no_industry',
          regions: ctx.currentRegions ?? [],
          match,
          needDiscovery,
          deadline,
          usage,
        });
    const web = searchRun.web;
    const searchMs = Date.now() - startedAt;

    let analysis: OtAnalysis | undefined;
    let usedFallback = false;
    let fallbackCode: FailureCode | undefined;
    const analysisStartedAt = Date.now();
    try {
      analysis = await runAnalysis(ctx, web, deadline, usage);
    } catch (e) {
      fallbackCode = classifyFailure(e);
      console.error('[generate-ot] analysis_failed', JSON.stringify({ code: fallbackCode }));
      try {
        analysis = await runFallback(ctx, web, deadline, usage);
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

    const opportunity = finalAnalysis.opportunities.map((i) => i.text);
    const threat = finalAnalysis.threats.map((i) => i.text);
    const resultMarkdown =
      toMarkdownList(opportunity, '機会', 'Opportunity') + '\n' + toMarkdownList(threat, '脅威', 'Threat');

    return NextResponse.json(
      {
        opportunity,
        threat,
        result: resultMarkdown,
        insights: { opportunity: finalAnalysis.opportunities, threat: finalAnalysis.threats },
        sources: web.sources,
        meta: {
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
