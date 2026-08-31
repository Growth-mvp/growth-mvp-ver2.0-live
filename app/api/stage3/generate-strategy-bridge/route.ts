// /app/api/stage3/generate-strategy-bridge/route.ts
// STAGE3戦略展開ブリッジ生成：STAGE2最終ストーリーからAI生成
import 'server-only';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { openai } from '@/lib/openai';
import { getOpenAIModelParamsForProcess } from '@/lib/modelConfig';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { getAuthUserIdFromBearer, requireMembership, assertMinRole } from '@/lib/server/rbacGuard';
import { logInputGuard, checkSuspiciousKeywords } from '@/lib/inputGuardLogger';

interface ChapterStory {
  title: string;
  body: string;
}

interface StrategicCore {
  primaryShift?: string;
  concreteDomains?: string[];
  customerValue?: string;
  coreCapabilities?: string[];
  portfolioShift?: string;
  behaviorChange?: string;
  nonNegotiableThemes?: string[];
}

interface Stage3StrategyBridge {
  keyThemes: string[];
  departmentIssues: string[];
  kpiCriteria: string[];
  commonBehaviorChanges: string[];
  strategicCore: StrategicCore;
  departmentTranslationRules: string[];
  generatedAt: string;
}

interface Stage2FinalDocumentEdits {
  conclusion?: string;
  assumptions?: {
    external?: string[];
    internal?: string[];
    implications?: string[];
  };
  overview?: {
    whyChange?: string;
    whereToPlay?: string;
    whatToWin?: string;
    howToExecute?: string;
  };
  midtermStrategy?: {
    midtermConcept?: string;
    targetVisionForMidterm?: string;
    priorityStrategicThemes?: string[];
    growthStrategy?: string;
    profitImprovementStrategy?: string;
    portfolioPolicy?: string;
    companyWideDecisionCriteria?: string[];
    deploymentPrinciplesForUnits?: string[];
    managementMeetingIssues?: string[];
    strategicCore?: StrategicCore;
  };
}

const GENERIC_PHRASES = [
  '成長領域',
  '新市場',
  '高付加価値',
  '新技術',
  '新興市場',
  '顧客関係',
  '顧客ニーズ',
  '競争優位性',
  '資本効率',
  'リソース',
];

const ACTION_SUFFIX_PATTERNS = [
  /への注力$/u,
  /への集中$/u,
  /への進出$/u,
  /への展開$/u,
  /へのシフト$/u,
  /を開拓する$/u,
  /を強化する$/u,
  /を開発する$/u,
  /を推進する$/u,
  /を促進する$/u,
  /を強める$/u,
  /を提供する$/u,
  /を進める$/u,
  /を図る$/u,
  /を確立する$/u,
  /に取り組む$/u,
  /に注力する$/u,
  /に集中する$/u,
  /に進出する$/u,
  /に対応する製品を提供する$/u,
  /の高付加価値化を進める$/u,
  /での競争優位性を確立する$/u,
  /での顧客関係を強化する$/u,
  /のニーズに対応する製品を提供する$/u,
];

const DOMAIN_ACTION_TERMS = [
  '高性能化',
  '生産効率',
  '導入',
  '強化',
  '開発',
  '高付加価値化',
  '顧客関係',
  '効率化',
  '改善',
  '推進',
  '促進',
  '確立',
];

const WEAK_STANDALONE_TERMS = [
  'AI',
  'ADAS',
  'DMS',
  '車',
  '機械',
  '製品',
  '技術',
  '市場',
  '事業',
  '産業',
  '顧客',
];

function uniqueStrings(values: Array<string | undefined | null>, max = 8): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const s = String(value ?? '')
      .replace(/^[\s・\-−●]+/u, '')
      .replace(/\s+/gu, '')
      .trim();
    if (!s || seen.has(s)) continue;
    seen.add(s);
    result.push(s);
    if (result.length >= max) break;
  }
  return result;
}

function normalizeCompact(value: string): string {
  return String(value ?? '').replace(/\s+/gu, '').trim();
}

function isGenericPhrase(value: string): boolean {
  const s = normalizeCompact(value);
  return GENERIC_PHRASES.some((phrase) => s === phrase || s.includes(`${phrase}を`) || s.includes(`${phrase}に`));
}

function stripActionSuffix(value: string): string {
  let s = String(value ?? '').trim();
  s = s.replace(/^[\s・\-−●]+/u, '').replace(/[。．.、,]$/u, '').trim();
  for (const pattern of ACTION_SUFFIX_PATTERNS) {
    s = s.replace(pattern, '').trim();
  }
  s = s.replace(/^(特に|特に、|重点的に|重点として)/u, '').trim();
  return s;
}

function isActionStatement(value: string): boolean {
  return /(する|進める|高める|強化|開発|提供|確立|改善|配分|移管|撤退|見直|促進|効率化|明確化|対応する)$/u.test(value);
}

function includesInSource(sourceText: string, term: string): boolean {
  return normalizeCompact(sourceText).includes(normalizeCompact(term));
}

function isDomainLike(value: string): boolean {
  return /(市場|領域|産業|用途|顧客|ユニット|システム|機器|製品|ソリューション|モジュール)$/u.test(value);
}

function isBadDomainCandidate(value: string): boolean {
  const s = normalizeCompact(value);
  if (!s || s.length < 3) return true;
  if (WEAK_STANDALONE_TERMS.includes(s)) return true;
  if (/時代の/u.test(s) || /目・筋肉・骨格/u.test(s)) return true;
  if (isGenericPhrase(s)) return true;
  if (DOMAIN_ACTION_TERMS.some((term) => s.includes(term))) return true;
  if (isActionStatement(s) && !isDomainLike(s)) return true;
  return false;
}

function toDomainLabel(term: string): string {
  const s = normalizeCompact(term)
    .replace(/^[・、,／/]+/u, '')
    .replace(/[・、,／/]+$/u, '');
  if (!s || WEAK_STANDALONE_TERMS.includes(s)) return '';
  if (/(市場|関連市場|領域|産業|用途|ユニット|システム|ソリューション|モジュール)$/u.test(s)) return s;
  if (/機器$/u.test(s)) return `${s}市場`;
  return `${s}関連市場`;
}

function splitUseCaseList(value: string): string[] {
  return normalizeCompact(value)
    .replace(/[、，,／/・]/gu, '・')
    .split('・')
    .map((part) => part
      .replace(/^(および|及び|ならびに|並びに|または|又は|向け|用途)$/u, '')
      .replace(/を支える.*$/u, '')
      .replace(/向け.*$/u, '')
      .trim())
    .filter((part) => part.length >= 3 && !WEAK_STANDALONE_TERMS.includes(part));
}

function scoreDomainCandidate(value: string): number {
  const s = normalizeCompact(value);
  let score = 0;
  if (/関連市場$/u.test(s)) score += 30;
  else if (/市場$/u.test(s)) score += 40;
  if (/向け/u.test(s)) score += 15;
  if (/ユニット|システム|ソリューション|モジュール/u.test(s)) score += 8;
  if (/フィジカルAI|ロボット|ドローン|医療機器/u.test(s)) score += 10;
  if (WEAK_STANDALONE_TERMS.includes(s)) score -= 80;
  if (DOMAIN_ACTION_TERMS.some((term) => s.includes(term))) score -= 80;
  return score + Math.min(s.length, 40) / 10;
}

function removeContainedShortTerms(values: string[], max = 8, sortByDomainScore = true): string[] {
  const unique = uniqueStrings(values, values.length);
  const filtered = unique
    .filter((value, _index, array) => {
      const s = normalizeCompact(value);
      return !array.some((other) => {
        const o = normalizeCompact(other);
        if (o === s || o.length <= s.length) return false;
        if (s.length <= 8 && o.includes(s)) return true;
        if (/市場$/u.test(s)) {
          const base = s.replace(/市場$/u, '');
          return base.length >= 3 && o.includes(base) && /市場$/u.test(o);
        }
        return false;
      });
    })
  const ordered = sortByDomainScore
    ? filtered.sort((a, b) => scoreDomainCandidate(b) - scoreDomainCandidate(a))
    : filtered;
  return ordered.slice(0, max);
}

function extractMarketPhrases(sourceText: string): string[] {
  const candidates: string[] = [];
  const patterns = [
    /[一-龠ぁ-んァ-ヶA-Za-z0-9・ー／\/()（）]{2,40}向け[一-龠ぁ-んァ-ヶA-Za-z0-9・ー／\/()（）]{2,30}市場/gu,
    /[一-龠ぁ-んァ-ヶA-Za-z0-9・ー／\/()（）]{2,50}(?:関連市場|市場)/gu,
  ];
  for (const pattern of patterns) {
    for (const match of sourceText.matchAll(pattern)) {
      const value = stripActionSuffix(match[0])
        .replace(/^.*(?:。|．|、|：|:)/u, '')
        .trim();
      if (value && !isBadDomainCandidate(value)) candidates.push(value);
    }
  }
  return candidates;
}

function extractInputOnlyDomainHints(sourceText: string): string[] {
  const candidates: string[] = [];

  // ここでは固定例を足すのではなく、入力本文に実在する語だけを市場・用途ラベルに整える。
  const explicitTerms = ['フィジカルAI', 'ロボット', 'ドローン', '医療機器'];
  for (const term of explicitTerms) {
    if (includesInSource(sourceText, term)) {
      candidates.push(toDomainLabel(term));
    }
  }

  const aiUseCasePatterns = [
    /AIで動く([^。\n、]{2,80}?)(?:の中|を支える|向け|に使われる|で使われる|のため)/gu,
    /AIで動く([^。\n]{2,80}?)(?:ユニット|機器|システム)/gu,
  ];
  for (const pattern of aiUseCasePatterns) {
    for (const match of sourceText.matchAll(pattern)) {
      for (const term of splitUseCaseList(match[1] || '')) {
        candidates.push(toDomainLabel(term));
      }
    }
  }

  return candidates.filter(Boolean);
}

function extractNonNegotiableThemes(
  sourceText: string,
  seedValues: Array<string | undefined | null>,
  max = 8,
): string[] {
  const candidates: string[] = [];
  const compactSource = normalizeCompact(sourceText);

  const aiUnitMatch =
    sourceText.match(/AIで動く[^\n。．]{2,60}?ユニット/u) ||
    sourceText.match(/AIで動く[^\n。．]{2,60}?を支えるユニット/u);
  if (aiUnitMatch && (compactSource.includes('部品サプライヤー') || compactSource.includes('部品'))) {
    const unit = normalizeCompact(aiUnitMatch[0])
      .replace(/の中で.*$/u, '')
      .replace(/を支えるユニット$/u, '向けユニット');
    candidates.push(`部品サプライヤーから${unit}への転換`);
  }

  if (includesInSource(sourceText, 'フィジカルAI') && includesInSource(sourceText, '目・筋肉・骨格')) {
    candidates.push('フィジカルAI時代の目・筋肉・骨格を担う統合技術');
  }

  if (
    includesInSource(sourceText, '光学') &&
    includesInSource(sourceText, 'モータ') &&
    (includesInSource(sourceText, '精密加工') || includesInSource(sourceText, '精密部品')) &&
    includesInSource(sourceText, '光学メカトロユニット')
  ) {
    candidates.push('光学・モータ・精密加工を統合した光学メカトロユニット');
  }

  if (includesInSource(sourceText, '設計段階')) {
    const designPhrase = sourceText.match(/[^\n。．]{0,20}設計段階[^\n。．]{0,18}/u)?.[0];
    candidates.push(designPhrase ? stripActionSuffix(designPhrase) : '次世代産業の設計段階への関与');
  }

  if (
    (includesInSource(sourceText, '成熟領域') || includesInSource(sourceText, '既存事業')) &&
    (includesInSource(sourceText, '成長領域') || includesInSource(sourceText, '成長市場')) &&
    (includesInSource(sourceText, '経営資源') || includesInSource(sourceText, '資源配分'))
  ) {
    candidates.push('成熟領域から成長領域への経営資源移管');
  }

  candidates.push(
    ...seedValues
      .map((value) => stripActionSuffix(String(value ?? '')))
      .filter((value) => value && !isBadDomainCandidate(value) && !/^[A-Za-z0-9]+市場$/u.test(normalizeCompact(value))),
  );

  return removeContainedShortTerms(candidates, max, false);
}

function buildSourceText(
  finalStoryFinal?: ChapterStory[],
  stage2FinalDocumentEdits?: Stage2FinalDocumentEdits
): string {
  const chunks: string[] = [];
  if (Array.isArray(finalStoryFinal)) {
    chunks.push(finalStoryFinal.map((ch) => `${ch.title || ''}\n${ch.body || ''}`).join('\n'));
  }
  const edits = stage2FinalDocumentEdits;
  if (edits?.conclusion) chunks.push(edits.conclusion);
  if (edits?.assumptions?.external?.length) chunks.push(edits.assumptions.external.join('\n'));
  if (edits?.assumptions?.internal?.length) chunks.push(edits.assumptions.internal.join('\n'));
  if (edits?.assumptions?.implications?.length) chunks.push(edits.assumptions.implications.join('\n'));
  if (edits?.overview) chunks.push(Object.values(edits.overview).filter(Boolean).join('\n'));
  const mts = edits?.midtermStrategy;
  if (mts) {
    chunks.push([
      mts.midtermConcept,
      mts.targetVisionForMidterm,
      ...(mts.priorityStrategicThemes || []),
      mts.growthStrategy,
      mts.profitImprovementStrategy,
      mts.portfolioPolicy,
      ...(mts.companyWideDecisionCriteria || []),
      ...(mts.deploymentPrinciplesForUnits || []),
      ...(mts.managementMeetingIssues || []),
      mts.strategicCore?.primaryShift,
      ...(mts.strategicCore?.concreteDomains || []),
      mts.strategicCore?.customerValue,
      ...(mts.strategicCore?.coreCapabilities || []),
      mts.strategicCore?.portfolioShift,
      mts.strategicCore?.behaviorChange,
      ...(mts.strategicCore?.nonNegotiableThemes || []),
    ].filter(Boolean).join('\n'));
  }
  return chunks.filter(Boolean).join('\n');
}

function extractDomainCandidates(sourceText: string, seedValues: string[] = [], max = 8): string[] {
  const candidates: string[] = [];

  candidates.push(...extractMarketPhrases(sourceText));

  for (const seed of seedValues) {
    const stripped = stripActionSuffix(seed);
    if (stripped && !isBadDomainCandidate(stripped)) candidates.push(stripped);
  }

  candidates.push(...extractInputOnlyDomainHints(sourceText));

  const source = sourceText.replace(/\r/gu, '\n');
  const nounChunkPattern = /[一-龠ぁ-んァ-ヶA-Za-z0-9・ー／\/()（）,\s]{2,60}(?:市場|領域|事業|産業|用途|顧客|技術|ユニット|システム|機器|製品|ソリューション|モジュール)/gu;
  for (const match of source.matchAll(nounChunkPattern)) {
    const value = stripActionSuffix(match[0].replace(/\n/gu, ''));
    if (value && value.length <= 60 && !isBadDomainCandidate(value)) candidates.push(value);
  }

  const aiPhysicalPattern = /AIで動く[^\n。．]{2,50}/gu;
  for (const match of source.matchAll(aiPhysicalPattern)) {
    const value = stripActionSuffix(match[0]);
    if (value && value.length <= 60 && !isBadDomainCandidate(value)) candidates.push(value);
  }

  const aiCompoundPattern = /[一-龠ぁ-んァ-ヶA-Za-z0-9・ー]{1,24}AI[一-龠ぁ-んァ-ヶA-Za-z0-9・ー]{0,18}/gu;
  for (const match of source.matchAll(aiCompoundPattern)) {
    const value = stripActionSuffix(match[0]);
    if (value && value.length >= 4 && !isBadDomainCandidate(value)) candidates.push(toDomainLabel(value));
  }

  const normalized = removeContainedShortTerms(candidates.filter((value) => !isBadDomainCandidate(value)), max);
  const marketDomains = normalized.filter((value) => /(?:市場|関連市場)$/u.test(normalizeCompact(value)));
  return marketDomains.length >= 3 ? marketDomains.slice(0, max) : normalized;
}

function extractCapabilityCandidates(sourceText: string, seedValues: string[] = [], max = 8): string[] {
  const candidates: string[] = [];
  candidates.push(...seedValues.map(stripActionSuffix));
  const capabilityPattern = /[一-龠ぁ-んァ-ヶA-Za-z0-9・ー／\/()（）,\s]{2,50}(?:技術|能力|強み|加工|金型|モータ|モジュール|メカトロ|量産|制御|信頼性|安全性)/gu;
  for (const match of sourceText.matchAll(capabilityPattern)) {
    const value = stripActionSuffix(match[0].replace(/\n/gu, ''));
    if (value && value.length <= 50 && !isGenericPhrase(value)) candidates.push(value);
  }
  return uniqueStrings(candidates, max);
}

function normalizeStrategicCore(
  aiCore: StrategicCore | undefined,
  parsed: any,
  stage2FinalDocumentEdits?: Stage2FinalDocumentEdits,
  finalStoryFinal?: ChapterStory[]
): StrategicCore {
  const fallback = createFallbackStrategicCore(parsed, stage2FinalDocumentEdits, finalStoryFinal);
  const mts = stage2FinalDocumentEdits?.midtermStrategy;
  const sourceText = buildSourceText(finalStoryFinal, stage2FinalDocumentEdits);

  const primaryShift =
    aiCore?.primaryShift ||
    mts?.strategicCore?.primaryShift ||
    fallback.primaryShift;
  const customerValue =
    aiCore?.customerValue ||
    mts?.strategicCore?.customerValue ||
    fallback.customerValue;
  const portfolioShift =
    aiCore?.portfolioShift ||
    mts?.strategicCore?.portfolioShift ||
    fallback.portfolioShift;
  const behaviorChange =
    aiCore?.behaviorChange ||
    mts?.strategicCore?.behaviorChange ||
    fallback.behaviorChange;

  const domainSeeds = [
    ...(mts?.strategicCore?.concreteDomains || []),
    ...(aiCore?.concreteDomains || []),
    ...(mts?.priorityStrategicThemes || []),
    ...(parsed.departmentIssues || []),
    ...(fallback.concreteDomains || []),
  ];
  const concreteDomains = extractDomainCandidates(sourceText, domainSeeds, 8)
    .filter((d) => !isBadDomainCandidate(d));

  const capabilitySeeds = [
    ...(mts?.strategicCore?.coreCapabilities || []),
    ...(aiCore?.coreCapabilities || []),
    ...(stage2FinalDocumentEdits?.assumptions?.internal || []),
    ...(fallback.coreCapabilities || []),
  ];
  const coreCapabilities = extractCapabilityCandidates(sourceText, capabilitySeeds, 8);

  const nonNegotiableSeeds = [
    mts?.strategicCore?.primaryShift,
    ...(mts?.strategicCore?.nonNegotiableThemes || []),
    ...(aiCore?.nonNegotiableThemes || []),
    ...(mts?.priorityStrategicThemes || []),
    ...(concreteDomains || []),
    primaryShift,
    customerValue,
    portfolioShift,
  ];
  const nonNegotiableThemes = extractNonNegotiableThemes(sourceText, nonNegotiableSeeds, 8);

  return {
    ...(primaryShift ? { primaryShift } : {}),
    ...(concreteDomains.length > 0 ? { concreteDomains } : {}),
    ...(customerValue ? { customerValue } : {}),
    ...(coreCapabilities.length > 0 ? { coreCapabilities } : {}),
    ...(portfolioShift ? { portfolioShift } : {}),
    ...(behaviorChange ? { behaviorChange } : {}),
    ...(nonNegotiableThemes.length > 0 ? { nonNegotiableThemes } : {}),
  };
}

function createFallbackStrategicCore(
  parsed: any,
  stage2FinalDocumentEdits?: Stage2FinalDocumentEdits,
  finalStoryFinal?: ChapterStory[]
): StrategicCore {
  const mts = stage2FinalDocumentEdits?.midtermStrategy;

  // primaryShift：midtermConcept または growthStrategy から作る
  let primaryShift: string | undefined;
  if (mts?.midtermConcept) {
    primaryShift = mts.midtermConcept;
  } else if (mts?.growthStrategy) {
    primaryShift = mts.growthStrategy;
  } else if (parsed.keyThemes?.length > 0) {
    primaryShift = parsed.keyThemes[0];
  }

  const sourceText = buildSourceText(finalStoryFinal, stage2FinalDocumentEdits);

  // concreteDomains：市場・用途・技術領域だけを抽出。施策文は入れない
  const concreteDomains = extractDomainCandidates(sourceText, [
    ...(mts?.strategicCore?.concreteDomains || []),
    ...(mts?.priorityStrategicThemes || []),
    ...(parsed.departmentIssues || []),
  ], 8);

  // customerValue：targetVisionForMidterm を優先。なければ最終ストーリーから抽出
  let customerValue: string | undefined;
  if (mts?.targetVisionForMidterm) {
    customerValue = mts.targetVisionForMidterm;
  } else if (finalStoryFinal && finalStoryFinal.length > 0) {
    const storyBody = finalStoryFinal[0]?.body || '';
    const valueMatch = storyBody.match(/(?:顧客価値|選ばれる理由|提供価値)[：:].+?(?=\n|$)/);
    if (valueMatch) {
      customerValue = valueMatch[0];
    }
  }

  // coreCapabilities：最終ストーリーから技術・能力・強みらしい語を抽出
  const coreCapabilities = extractCapabilityCandidates(sourceText, [
    ...(mts?.strategicCore?.coreCapabilities || []),
    ...(stage2FinalDocumentEdits?.assumptions?.internal || []),
    ...(parsed.keyThemes || []),
  ], 8);

  // portfolioShift：portfolioPolicy を優先。なければ kpiCriteria を使う
  let portfolioShift: string | undefined;
  if (mts?.portfolioPolicy) {
    portfolioShift = mts.portfolioPolicy;
  } else if (parsed.kpiCriteria?.length > 0) {
    portfolioShift = parsed.kpiCriteria[0];
  }

  // behaviorChange：deploymentPrinciplesForUnits を優先。なければ commonBehaviorChanges を使う
  let behaviorChange: string | undefined;
  if (mts && mts.deploymentPrinciplesForUnits && mts.deploymentPrinciplesForUnits.length > 0) {
    behaviorChange = mts.deploymentPrinciplesForUnits[0];
  } else if (parsed.commonBehaviorChanges?.length > 0) {
    behaviorChange = parsed.commonBehaviorChanges[0];
  }

  // nonNegotiableThemes：STAGE3で落としてはいけない転換・領域・顧客価値を保持
  const nonNegotiableThemes = extractNonNegotiableThemes(sourceText, [
    mts?.strategicCore?.primaryShift,
    ...(mts?.strategicCore?.nonNegotiableThemes || []),
    ...(mts?.priorityStrategicThemes || []),
    ...concreteDomains,
    primaryShift,
    customerValue,
    portfolioShift,
  ], 8);

  return {
    ...(primaryShift ? { primaryShift } : {}),
    ...(concreteDomains.length > 0 ? { concreteDomains } : {}),
    ...(customerValue ? { customerValue } : {}),
    ...(coreCapabilities.length > 0 ? { coreCapabilities } : {}),
    ...(portfolioShift ? { portfolioShift } : {}),
    ...(behaviorChange ? { behaviorChange } : {}),
    ...(nonNegotiableThemes.length > 0 ? { nonNegotiableThemes } : {}),
  };
}

function createFallbackDepartmentTranslationRules(
  parsed: any,
  strategicCore: StrategicCore
): string[] {
  const rules: string[] = [];

  if (strategicCore.primaryShift) {
    rules.push(`各部門ミッションには ${strategicCore.primaryShift.slice(0, 30)} のうち自部門が担う役割を明記する`);
  }

  if (strategicCore.concreteDomains?.length) {
    rules.push(`各プロジェクトは ${strategicCore.concreteDomains[0]} などの重点領域またはコア・テーマのいずれかに接続する`);
  }

  if (strategicCore.customerValue || strategicCore.portfolioShift || strategicCore.behaviorChange) {
    const dims = [
      strategicCore.customerValue ? '顧客価値' : '',
      strategicCore.portfolioShift ? 'ポートフォリオ転換' : '',
      strategicCore.behaviorChange ? '行動変化' : ''
    ].filter(Boolean).join(' / ');
    if (dims) {
      rules.push(`KPIは ${dims} の変化を測る指標にする`);
    }
  }

  if (strategicCore.nonNegotiableThemes?.length) {
    rules.push(`全部門が保持すべき ${strategicCore.nonNegotiableThemes[0]} などのテーマは、部門戦略でも具体化する`);
  }

  if (rules.length < 3) {
    if (parsed.keyThemes?.length) {
      rules.push(`各部門の戦略は全社 keyThemes（${parsed.keyThemes[0]}など）に整合させる`);
    }
    if (parsed.departmentIssues?.length) {
      rules.push(`${parsed.departmentIssues[0]}など全社重点領域への貢献を明示する`);
    }
  }

  return rules.slice(0, 6);
}

async function generateStrategyBridge(
  finalStoryFinal: ChapterStory[],
  stage2FinalDocumentEdits?: Stage2FinalDocumentEdits
): Promise<{ bridge: Stage3StrategyBridge; debugInfo: any }> {
  const debugInfo: any = {
    storyLength: finalStoryFinal.length,
    hasOpenaiKey: !!process.env.OPENAI_API_KEY,
    openaiKeyLength: process.env.OPENAI_API_KEY ? process.env.OPENAI_API_KEY.length : 0,
  };

  if (!process.env.OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY is not configured');
  }

  const storyText = finalStoryFinal
    .map((ch, i) => `【第${i + 1}章】${ch.title}\n${ch.body}`)
    .join('\n\n');

  debugInfo.storyTextLength = storyText.length;

  // 補助セクション情報がある場合は組み込む
  let contextText = `【最終ストーリー】
${storyText}`;

  if (stage2FinalDocumentEdits) {
    if (stage2FinalDocumentEdits.conclusion) {
      contextText += `

【この戦略ストーリーの結論】
${stage2FinalDocumentEdits.conclusion}`;
    }
    if (stage2FinalDocumentEdits.assumptions) {
      const { external, internal, implications } = stage2FinalDocumentEdits.assumptions;
      contextText += '\n\n【戦略判断の前提】';
      if (external?.length) {
        contextText += `\n外部環境：\n${external.map(e => `・${e}`).join('\n')}`;
      }
      if (internal?.length) {
        contextText += `\n内部環境：\n${internal.map(i => `・${i}`).join('\n')}`;
      }
      if (implications?.length) {
        contextText += `\n戦略上の含意：\n${implications.map(i => `・${i}`).join('\n')}`;
      }
    }
    if (stage2FinalDocumentEdits.overview) {
      const { whyChange, whereToPlay, whatToWin, howToExecute } = stage2FinalDocumentEdits.overview;
      contextText += '\n\n【戦略ストーリーの全体像】';
      if (whyChange) contextText += `\n危機認識：${whyChange}`;
      if (whereToPlay) contextText += `\n戦略選択：${whereToPlay}`;
      if (whatToWin) contextText += `\n目指す未来：${whatToWin}`;
      if (howToExecute) contextText += `\n実行設計：${howToExecute}`;
    }
    if (stage2FinalDocumentEdits.midtermStrategy) {
      const mts = stage2FinalDocumentEdits.midtermStrategy;
      contextText += '\n\n【中計設計：全社戦略の展開軸】';
      if (mts.midtermConcept) contextText += `\n基本コンセプト：${mts.midtermConcept}`;
      if (mts.targetVisionForMidterm) contextText += `\n目指す姿：${mts.targetVisionForMidterm}`;
      if (mts.priorityStrategicThemes?.length) {
        contextText += `\n重点戦略テーマ：\n${mts.priorityStrategicThemes.map((t: string) => `・${t}`).join('\n')}`;
      }
      if (mts.growthStrategy) contextText += `\n成長戦略：${mts.growthStrategy}`;
      if (mts.profitImprovementStrategy) contextText += `\n収益改善戦略：${mts.profitImprovementStrategy}`;
      if (mts.portfolioPolicy) contextText += `\n事業ポートフォリオ方針：${mts.portfolioPolicy}`;
      if (mts.companyWideDecisionCriteria?.length) {
        contextText += `\n全社共通の判断基準：\n${mts.companyWideDecisionCriteria.map((c: string) => `・${c}`).join('\n')}`;
      }
      if (mts.deploymentPrinciplesForUnits?.length) {
        contextText += `\n部門・社員への展開方針：\n${mts.deploymentPrinciplesForUnits.map((p: string) => `・${p}`).join('\n')}`;
      }
      if (mts.managementMeetingIssues?.length) {
        contextText += `\n経営会議で確認すべき論点：\n${mts.managementMeetingIssues.map((i: string) => `・${i}`).join('\n')}`;
      }
      if (mts.strategicCore) {
        const core = mts.strategicCore;
        contextText += '\n\n【戦略の芯（STAGE3で保持すべき固有テーマ）】';
        if (core.primaryShift) contextText += `\n転換の軸：${core.primaryShift}`;
        if (core.concreteDomains?.length) contextText += `\n重点領域：${core.concreteDomains.map((d) => `・${d}`).join('\n')}`;
        if (core.customerValue) contextText += `\n顧客価値：${core.customerValue}`;
        if (core.coreCapabilities?.length) contextText += `\n中核能力：${core.coreCapabilities.map((c) => `・${c}`).join('\n')}`;
        if (core.portfolioShift) contextText += `\n資源配分・ポートフォリオ転換：${core.portfolioShift}`;
        if (core.behaviorChange) contextText += `\n行動変化：${core.behaviorChange}`;
        if (core.nonNegotiableThemes?.length) contextText += `\n保持すべきテーマ：${core.nonNegotiableThemes.map((t) => `・${t}`).join('\n')}`;
      }
    }
  }

  const prompt = `以下はSTAGE2で策定された全社戦略の最終ストーリーおよび補助セクションです。
このストーリーをもとに、各事業部門長が自部門戦略・重点プロジェクト・KPIを設計する際の判断材料となる全社戦略サマリーを、6つのキーで変換してください。

${contextText}

---

## 出力形式（必須・重要）

JSON形式で以下を返してください。
【重要】keyThemes / departmentIssues / kpiCriteria / commonBehaviorChanges だけを返すのは禁止です。
【必須】JSONには必ず6つのキーをすべて含めてください：
  1. keyThemes
  2. departmentIssues
  3. kpiCriteria
  4. commonBehaviorChanges
  5. strategicCore
  6. departmentTranslationRules

各項目は箇条書き3～4個、1項目40～60文字程度。
STAGE2の章タイトル（第1章～第4章）は含めず、部門長が実行判断に使える具体的な表現で書いてください。

{
  "keyThemes": ["会社として目指す方向1", "方向2", ...],
  "departmentIssues": ["重点的に伸ばす領域1", "領域2", ...],
  "kpiCriteria": ["見直すべき事業・活動1", "活動2", ...],
  "commonBehaviorChanges": ["各部門に求める役割1", "役割2", ...],
  "strategicCore": {
    "primaryShift": "既存の何から、どの方向へ転換するのか",
    "concreteDomains": ["入力に出てきた重点市場・用途・顧客領域・技術領域"],
    "customerValue": "顧客が選ぶ理由・提供価値",
    "coreCapabilities": ["戦略実現の源泉となる強み・能力"],
    "portfolioShift": "経営資源や事業ポートフォリオをどう移すか",
    "behaviorChange": "社員・部門に求める行動変化",
    "nonNegotiableThemes": ["STAGE3以降で一般語に丸めず保持するテーマ"]
  },
  "departmentTranslationRules": ["部門戦略へ展開するときの必須ルール1", "ルール2", ...]
}

---

## 出力内容の定義

### keyThemes（会社として目指す方向）
会社全体のビジョン・基本方針。部門長が自部門の活動を整合させる上での指針。
重要：抽象名詞で終わらせず、「〜する」「〜に転換する」などの動作表現で書くこと。
例：
- 成長領域に人材・予算・開発工数を優先配分する
- 既存顧客の課題深掘りにより、提案単価を高める
- グローバル市場での現地化戦略を強化する
- デジタル基盤への投資をすすめて業務効率を改善する

### departmentIssues（重点的に伸ばす領域）
全社が重点的に取り組む成長テーマ。各部門がリソース配分の優先順位を判断する材料。
重要：各部門に求める具体的なアクション・テーマを述べること。
例：
- AI・データを活用した新規事業・新商品開発に取り組む
- 既存顧客へのアップセル・クロスセル機会を拡大する
- 業務プロセスをデジタル化し非効率をなくす
- 新興市場の顧客ニーズを把握して事業化を進める

### kpiCriteria（見直すべき事業・活動）
継続するべきでない・スケールダウンするべき事業領域。各部門が経営資源の転換判断をする基準。
重要：具体的なアクション（廃止・外部化・統合など）を示すこと。
例：
- 低採算事業からの段階的撤退スケジュールを確定する
- 付加価値が低い周辺サービスを廃止・外部化する
- レガシーなオペレーションを自動化・統合し効率化を進める
- 戦略に非整合な提携や協力関係を見直す

### commonBehaviorChanges（各部門に求める役割）
全部門が共通して実践すべき方針・期待される行動変化。各部門の戦略設計の共通基準。
重要：「各部門が〜を明確にする」「〜に転換する」など、各部門の実行責任を示すこと。
例：
- 各部門が全社戦略に対する具体的な貢献領域・KPI目標を明確にする
- 顧客課題の変化を常に把握し、提供価値の見直しを進める
- 部門最適ではなく全社最適を基準に経営資源の配分・転換判断をする
- 他部門との協業機会を主体的に探索し相乗効果を追求する

### strategicCore（戦略の芯・必須）
STAGE2の12問回答・最終ストーリー・補助セクション（特に中計設計）から、この会社固有の戦略の芯を抽出する。
【必須】「成長領域」「新市場」「高付加価値」「新技術」などの一般語だけに丸めず、入力に含まれる重点市場・用途・技術・顧客価値・やめることを保持すること。
【禁止】入力にない市場名・技術名・製品名・顧客名は絶対に追加しないこと。企業固有ワードは必ず入力から引用すること。

primaryShift：midtermConcept または growthStrategy から作る。存在しない場合は keyThemes から作る。
concreteDomains：入力に含まれる「市場・用途・顧客領域・技術領域・製品領域」の名詞句だけを入れる。
  - 「〜する」「〜を進める」「〜を強化する」「〜を提供する」などの施策文は禁止。
  - 「成長市場」「新興市場」「顧客関係」などの一般語だけは禁止。
  - priorityStrategicThemes が施策文の場合は、そこから市場名・用途名・技術領域名だけを抜き出す。
customerValue：targetVisionForMidterm を優先。なければ最終ストーリーから「顧客価値」「選ばれる理由」に近い文を使う。
coreCapabilities：最終ストーリーから技術・能力・強みらしい語を抽出。
portfolioShift：portfolioPolicy を優先。なければ kpiCriteria を使う。
behaviorChange：deploymentPrinciplesForUnits を優先。なければ commonBehaviorChanges を使う。
nonNegotiableThemes：STAGE3以降で落としてはいけない「転換の軸・重点領域・顧客価値・やめること」を3～8個で保持する。
  - concreteDomains と coreCapabilities の単純コピーで水増ししない。
  - 一般語だけに丸めず、入力に出てきた固有の重点領域や技術観を保持する。

### departmentTranslationRules（部門展開ルール・必須）
STAGE3で部門ミッション・重点プロジェクト・KPIを作る際に守るべき必須ルール。
【必須】3～6個のルールを含めること。以下は例だが、入力の内容に応じて作成すること：
- 各部門ミッションには strategicCore.primaryShift のうち自部門が担う役割を明記する
- 各プロジェクトは strategicCore.concreteDomains または nonNegotiableThemes のいずれかに接続する
- KPIは customerValue / portfolioShift / behaviorChange の変化を測る指標にする
- 部門間での重複を避け、strategicCore.primaryShift を分割配置する

---

【最終確認】JSONに以下がすべて含まれているか確認してから出力してください：
- keyThemes（配列）
- departmentIssues（配列）
- kpiCriteria（配列）
- commonBehaviorChanges（配列）
- strategicCore（オブジェクト・必須）
- departmentTranslationRules（配列・必須）

JSON のみを出力してください。説明やコメントは不要です。`;

  let response;
  try {
    const bridgeParams = getOpenAIModelParamsForProcess('stage3Bridge', {
      temperature: 0.7,
    });
    if (process.env.NODE_ENV === 'development' || process.env.DEBUG_AI_MODELS === '1') {
      console.log(`[AI] stage3-strategy-bridge → ${bridgeParams.model}`);
    }
    console.log('[STAGE3] OpenAI API call start', { model: bridgeParams.model, promptLength: prompt.length });
    response = await openai.chat.completions.create({
      ...bridgeParams,
      messages: [
        {
          role: 'user',
          content: prompt,
        },
      ],
    });
    debugInfo.openaiResponseReceived = true;
    debugInfo.choicesLength = response.choices.length;
  } catch (e: any) {
    debugInfo.openaiError = {
      message: e?.message,
      code: e?.code,
    };
    throw new Error(`OpenAI API failed: ${e?.message || 'unknown error'}`);
  }

  const content = response.choices[0]?.message?.content ?? '';
  debugInfo.contentLength = content.length;
  debugInfo.contentPreview = content.substring(0, 200);

  console.log('[STAGE3] OpenAI response received', { contentLength: content.length });

  let parsed: Stage3StrategyBridge;
  try {
    // JSON抽出
    console.log('[STAGE3] Attempting JSON extraction from content');
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      debugInfo.jsonExtractionFailed = true;
      throw new Error('JSON not found in response');
    }

    debugInfo.jsonFound = true;
    console.log('[STAGE3] JSON found, length:', jsonMatch[0].length);

    const raw = JSON.parse(jsonMatch[0]);
    debugInfo.jsonParseSuccess = true;

    console.log('[STAGE3] JSON parsed successfully', {
      keys: Object.keys(raw),
    });

    // 型チェック＆標準化
    const toStringArray = (v: any): string[] => {
      if (!Array.isArray(v)) return [];
      return v
        .map((x) => String(x ?? '').trim())
        .filter(Boolean)
        .slice(0, 5); // 最大5個まで
    };
    const toLongStringArray = (v: any, max = 8): string[] => {
      if (!Array.isArray(v)) return [];
      return v
        .map((x) => String(x ?? '').trim())
        .filter(Boolean)
        .slice(0, max);
    };
    const toString = (v: any, max = 500): string | undefined => {
      const s = String(v ?? '').trim();
      return s ? s.slice(0, max) : undefined;
    };
    const rawCore = raw.strategicCore && typeof raw.strategicCore === 'object' && !Array.isArray(raw.strategicCore)
      ? raw.strategicCore
      : undefined;
    const aiStrategicCore = rawCore
      ? Object.fromEntries(
          Object.entries({
            primaryShift: toString(rawCore.primaryShift),
            concreteDomains: toLongStringArray(rawCore.concreteDomains),
            customerValue: toString(rawCore.customerValue),
            coreCapabilities: toLongStringArray(rawCore.coreCapabilities),
            portfolioShift: toString(rawCore.portfolioShift),
            behaviorChange: toString(rawCore.behaviorChange),
            nonNegotiableThemes: toLongStringArray(rawCore.nonNegotiableThemes),
          }).filter(([, v]) => Array.isArray(v) ? v.length > 0 : v !== undefined),
        ) as StrategicCore
      : undefined;

    const baseParsed = {
      keyThemes: toStringArray(raw.keyThemes),
      departmentIssues: toStringArray(raw.departmentIssues),
      kpiCriteria: toStringArray(raw.kpiCriteria),
      commonBehaviorChanges: toStringArray(raw.commonBehaviorChanges),
    };

    // strategicCore: AI結果をそのまま採用せず、入力由来の固有語で必ず正規化する
    let strategicCoreSource: 'ai-normalized' | 'fallback-normalized' = 'fallback-normalized';
    const finalStrategicCore = normalizeStrategicCore(
      aiStrategicCore,
      baseParsed,
      stage2FinalDocumentEdits,
      finalStoryFinal,
    );
    if (aiStrategicCore && Object.keys(aiStrategicCore).length > 0) {
      strategicCoreSource = 'ai-normalized';
    }

    // departmentTranslationRules: AI結果を優先、なければfallbackを作成
    let departmentTranslationRulesSource: 'ai' | 'fallback' = 'fallback';
    let finalDepartmentTranslationRules = toLongStringArray(raw.departmentTranslationRules, 6);
    if (finalDepartmentTranslationRules.length > 0) {
      departmentTranslationRulesSource = 'ai';
    } else {
      finalDepartmentTranslationRules = createFallbackDepartmentTranslationRules(baseParsed, finalStrategicCore);
    }

    parsed = {
      ...baseParsed,
      strategicCore: finalStrategicCore,
      departmentTranslationRules: finalDepartmentTranslationRules,
      generatedAt: new Date().toISOString(),
    };

    // デバッグ情報に追加
    debugInfo.strategicCoreSource = strategicCoreSource;
    debugInfo.departmentTranslationRulesSource = departmentTranslationRulesSource;
    debugInfo.strategicCoreConcreteDomains = finalStrategicCore.concreteDomains || [];
    debugInfo.strategicCoreNonNegotiableThemes = finalStrategicCore.nonNegotiableThemes || [];

    // バリデーション
    const requiredKeys = ['keyThemes', 'departmentIssues', 'kpiCriteria', 'commonBehaviorChanges'];
    for (const key of requiredKeys) {
      if (!Array.isArray((parsed as any)[key])) {
        throw new Error(`${key} is not an array`);
      }
    }

    // strategicCore と departmentTranslationRules は必須
    if (!parsed.strategicCore || typeof parsed.strategicCore !== 'object') {
      throw new Error('strategicCore must be an object');
    }
    if (!Array.isArray(parsed.departmentTranslationRules)) {
      throw new Error('departmentTranslationRules must be an array');
    }

    // 最低1個は確保
    for (const key of requiredKeys) {
      if ((parsed as any)[key].length === 0) {
        (parsed as any)[key] = [`${key}の情報が生成されませんでした`];
      }
    }

    // departmentTranslationRules は最低1個は確保
    if (parsed.departmentTranslationRules.length === 0) {
      parsed.departmentTranslationRules = ['部門戦略展開時のルール情報が生成されませんでした'];
    }

    debugInfo.validationSuccess = true;
    console.log('[STAGE3] Bridge object generated successfully', {
      keyThemesCount: parsed.keyThemes.length,
      departmentIssuesCount: parsed.departmentIssues.length,
      kpiCriteriaCount: parsed.kpiCriteria.length,
      commonBehaviorChangesCount: parsed.commonBehaviorChanges.length,
      hasStrategicCore: !!parsed.strategicCore,
      strategicCoreSource: debugInfo.strategicCoreSource,
      departmentTranslationRulesCount: parsed.departmentTranslationRules.length,
      departmentTranslationRulesSource: debugInfo.departmentTranslationRulesSource,
    });
  } catch (e: any) {
    console.error('[STAGE3] JSON parse/validation error:', e?.message);
    console.error('[STAGE3] Full content:', content);
    debugInfo.parseError = e?.message;
    throw new Error(`Failed to parse OpenAI response: ${e?.message}`);
  }

  return { bridge: parsed, debugInfo };
}

export async function POST(request: NextRequest) {
  console.log('[STAGE3] POST /api/stage3/generate-strategy-bridge called');

  try {
    // ★ 修正：既存API と同じ認証方式に統一
    const admin = getSupabaseAdmin();

    // Bearer token authentication
    let userId: string | null;
    try {
      userId = await getAuthUserIdFromBearer(admin, request);
      console.log('[STAGE3] getAuthUserIdFromBearer result:', {
        hasUserId: !!userId,
        userIdLength: userId ? userId.length : 0,
      });
    } catch (e: any) {
      console.error('[STAGE3] Auth check failed:', e?.message);
      return NextResponse.json(
        { error: '認証が必要です', detail: e?.message },
        { status: 401 }
      );
    }

    if (!userId) {
      console.warn('[STAGE3] No userId from auth (userId is null)');
      return NextResponse.json(
        { error: '認証が必要です', detail: 'Authorization header not found or invalid' },
        { status: 401 }
      );
    }

    console.log('[STAGE3] Auth OK, userId obtained');

    // リクエストボディ解析（membership 確認前に必要）
    let body: any;
    try {
      body = await request.json();
      console.log('[STAGE3] Request body received, keys:', Object.keys(body));
    } catch (e: any) {
      console.error('[STAGE3] Failed to parse request body:', e?.message);
      return NextResponse.json(
        { error: 'リクエストボディが不正です', detail: e?.message },
        { status: 400 }
      );
    }

    const { finalStoryFinal, companyId: bodyCompanyId, stage2FinalDocumentEdits } = body;

    if (!bodyCompanyId) {
      console.warn('[STAGE3] companyId not provided in body');
      return NextResponse.json(
        { error: '会社IDが必要です', detail: 'companyId is missing from body' },
        { status: 400 }
      );
    }

    console.log('[STAGE3] Check membership for company:', bodyCompanyId);

    // ★ 修正：body の companyId で membership を検証
    let membership;
    try {
      membership = await requireMembership(admin, userId, bodyCompanyId);
      console.log('[STAGE3] requireMembership result:', {
        hasMembership: !!membership,
        membershipCompanyId: membership?.companyId ? '***' : null,
      });
    } catch (e: any) {
      console.error('[STAGE3] Membership check failed:', e?.message);
      return NextResponse.json(
        { error: 'アクセス権限がありません', detail: e?.message },
        { status: 403 }
      );
    }

    if (!membership) {
      console.warn('[STAGE3] No membership found for this company', {
        bodyCompanyId: bodyCompanyId ? 'provided' : 'missing',
        membershipCheck: 'company not authorized',
      });
      return NextResponse.json(
        { error: 'この会社にアクセス権がありません', detail: 'Company not authorized' },
        { status: 403 }
      );
    }

    // ★ manager以上の権限チェック
    try {
      await assertMinRole(membership, 'manager');
    } catch {
      console.warn('[STAGE3] Insufficient role for this operation');
      return NextResponse.json(
        { error: 'この操作に必要な権限がありません', detail: 'Manager role required' },
        { status: 403 }
      );
    }

    console.log('[STAGE3] Membership OK - company authorized');

    // finalStoryFinal の確認
    console.log('[STAGE3] Check finalStoryFinal:', {
      isArray: Array.isArray(finalStoryFinal),
      length: Array.isArray(finalStoryFinal) ? finalStoryFinal.length : undefined,
      type: typeof finalStoryFinal,
    });

    if (!Array.isArray(finalStoryFinal) || finalStoryFinal.length === 0) {
      console.warn('[STAGE3] finalStoryFinal not provided or empty');
      return NextResponse.json(
        {
          error: 'STAGE2最終ストーリーが確定されていません',
          detail: `finalStoryFinal: ${Array.isArray(finalStoryFinal) ? finalStoryFinal.length : 0} items`,
        },
        { status: 400 }
      );
    }

    console.log('[STAGE3] finalStoryFinal OK, items:', finalStoryFinal.length);

    // ★ 修正：権限確認は frontend authFetchJson で行われているため、ここでは省略
    // 認証済み userId があれば十分（RLS は Supabase にまかせる）

    // AI生成実行
    // ★ membership.companyId が身分で確認された会社ID
    console.log('[STAGE3] Starting generateStrategyBridge', {
      authorizedCompanyId: membership.companyId,
      storyLength: finalStoryFinal.length,
    });

    // 【入力充足度ログ】OpenAI呼び出し直前に観測ログを出力
    const requestId = request.headers.get('x-request-id') || `req_${Date.now()}`;
    const storyContent = finalStoryFinal?.map((s: any) => s?.body || '').join(' ') || '';
    const hasCompanyInfo = !!body.finalStoryFinal;
    const hasStage1Context = !!body.finalStoryFinal;
    const hasStage2Answers = false;
    const hasStage2Story = !!body.finalStoryFinal;
    const hasStage3Context = false;
    const hasStage4Context = false;

    const inputFlags = [hasCompanyInfo, hasStage1Context, hasStage2Answers, hasStage2Story, hasStage3Context, hasStage4Context];
    const meaningfulInputScore = Math.round((inputFlags.filter(Boolean).length / inputFlags.length) * 100);

    const suspiciousKeywords = checkSuspiciousKeywords(storyContent);

    logInputGuard({
      requestId,
      apiName: 'stage3/generate-strategy-bridge',
      companyId: membership.companyId,
      strategyId: bodyCompanyId,
      meaningfulInputScore,
      hasCompanyInfo,
      hasStage1Context,
      hasStage2Answers,
      hasStage2Story,
      hasStage3Context,
      hasStage4Context,
      promptLength: storyContent.length,
      suspiciousKeywordFlags: suspiciousKeywords,
    });

    const { bridge, debugInfo } = await generateStrategyBridge(finalStoryFinal, stage2FinalDocumentEdits);

    console.log('[STAGE3] generateStrategyBridge completed', {
      ...debugInfo,
      authorizedCompanyId: '***',
    });

    // ★ 修正：DB直接更新ではなく、結果のみ返す
    // フロントエンド側で store に setState → autosave で保存される
    // これにより FIELD_MAP による正しい保存・復元パスが実行される

    console.log('[STAGE3] Returning bridge result');
    return NextResponse.json(bridge);
  } catch (error: any) {
    console.error('[STAGE3] Unexpected error in POST handler:', {
      message: error?.message,
      code: error?.code,
      stack: error?.stack?.substring(0, 500),
    });

    // エラーメッセージの詳細化
    let detail = 'Unknown error';
    if (error?.message?.includes('OPENAI_API_KEY')) {
      detail = error.message;
    } else if (error?.message?.includes('OpenAI API failed')) {
      detail = error.message;
    } else if (error?.message?.includes('Failed to parse OpenAI response')) {
      detail = error.message;
    } else {
      detail = error?.message || 'Unknown error occurred';
    }

    return NextResponse.json(
      {
        error: '戦略展開ブリッジの生成に失敗しました',
        detail,
      },
      { status: 500 }
    );
  }
}
