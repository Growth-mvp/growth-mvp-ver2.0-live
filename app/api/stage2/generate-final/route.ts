/* eslint-disable @typescript-eslint/no-explicit-any */
import 'server-only';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 90;

import { NextRequest, NextResponse } from 'next/server';
import { openai } from '@/lib/openai';
import { getIndustryLabel as _getIndustryLabel } from '@/utils/industryTemplates';
import type { ChatCompletionCreateParamsNonStreaming } from 'openai/resources/chat/completions';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { getAuthUserIdFromBearer, requireMembership, assertMinRole } from '@/lib/server/rbacGuard';
import { logAuditEvent, extractAuditMetadata } from '@/lib/server/auditLog';
import { logInputGuard, checkSuspiciousKeywords } from '@/lib/inputGuardLogger';

/* =========================
 * モデル設定
 * =======================*/
import { AI_MODELS, getTokenLimitParam, getTemperatureParam, getPenaltyParams } from '@/lib/modelConfig';

const SUPPORTS_JSON_MODE = /^(gpt-4o|gpt-5\.6-luna)($|-)/;

/* =========================
 * 勝ちパターン10選（④連携）
 * =======================*/
type WinningPatternKey =
  | 'priceLeader'
  | 'categoryKing'
  | 'nicheDomination'
  | 'platformPlay'
  | 'subscriptionMoat'
  | 'manufacturingKaizen'
  | 'serviceDelight'
  | 'dataNetwork'
  | 'brandTrust'
  | 'speedOperator';

/* =========================
 * 見出し（固定）
 * =======================*/
const SIMPLE_HEADS = ['なぜ今', 'どう戦う', 'どんな未来', 'どう実行する'] as const;
const TITLE_TEMPLATES = [
  '第1章：なぜ今',
  '第2章：どう戦う',
  '第3章：どんな未来',
  '第4章：どう実行に落とすか（部門戦略・KPI・実行管理）',
] as const;

/* =========================
 * Utils（必要最小限）
 * =======================*/
function sanitize(text: unknown, max = 4000): string {
  const s = text == null ? '' : typeof text === 'string' ? text : String(text);
  return s.replace(/\u0000/g, '').replace(/\s+$/g, '').slice(0, max);
}
function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}
function asText(v: unknown, max = 4000): string {
  return sanitize(v, max).trim();
}
function asArray<T = unknown>(v: unknown): T[] {
  return Array.isArray(v) ? (v as T[]) : [];
}
function pickFirstText(...values: unknown[]): string {
  for (const v of values) {
    const t = asText(v);
    if (t) return t;
  }
  return '';
}
function normalizeNewlines(s = ''): string {
  return s.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}
function safeSerialize(v: unknown): unknown {
  try {
    return JSON.parse(JSON.stringify(v));
  } catch {
    return String(v);
  }
}
function safeGetIndustryLabel(code: string, opts?: { full?: boolean }): string {
  try {
      if (typeof _getIndustryLabel === 'function') return _getIndustryLabel(code, opts);
  } catch {}
  return code || '—';
}
function extractJsonLoose<T = any>(raw: string): T | null {
  if (!raw) return null;
  const tryParse = (s: string) => {
    try {
      return JSON.parse(s) as T;
    } catch {
      return null;
    }
  };
  const direct = tryParse(raw);
  if (direct && (typeof direct === 'object' || Array.isArray(direct))) return direct;
  const fence = raw.match(/```json\s*([\s\S]*?)```/i);
  if (fence?.[1]) {
    const j = tryParse(fence[1]);
    if (j) return j;
  }
  const obj = raw.match(/\{[\s\S]*\}/);
  if (obj?.[0]) {
    const j = tryParse(obj[0]);
    if (j) return j;
  }
  const arr = raw.match(/\[[\s\S]*\]/);
  if (arr?.[0]) {
    const j = tryParse(arr[0]);
    if (j) return j;
  }
  return null;
}

/** 日本語テキストの余計な半角スペースを整理 */
function tidyJa(s: string): string {
  if (!s) return s;
  let out = s;
  // 漢字・ひらがな・カタカナ間の半角スペースを除去
  out = out.replace(
    /([\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}])[ ]+([\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}])/gu,
    '$1$2',
  );
  // 記号前後の余計なスペース
  out = out.replace(/([、。％%！!？?」』）)＞>])[ ]+/gu, '$1');
  out = out.replace(/[ ]+([、。％%！!？?」』）)＞>])/gu, '$1');
  // 数字と％を詰める
  out = out.replace(/(\d)[ ]+％/g, '$1％');
  // 連続スペース縮約
  out = out.replace(/[ ]{2,}/g, ' ');
  return out;
}

/* =========================
 * 財務ミニ要約（スリム版）
 * =======================*/
type FinanceRow = Record<string, unknown>;
type Trend = 'up' | 'flat' | 'down' | null;

function tryParseJsonLocal<T = any>(text: string): T | null {
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

function coerceFinanceArray(src: unknown): FinanceRow[] | undefined {
  if (Array.isArray(src)) return src as FinanceRow[];
  if (typeof src !== 'string') return undefined;
  const j = tryParseJsonLocal(src);
  if (Array.isArray(j)) return j as FinanceRow[];
  const lines = src.trim().split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return undefined;
  const headers = lines[0].split(',').map((h) => h.trim()).filter(Boolean);
  if (!headers.length) return undefined;
  const rows = lines.slice(1).map((ln) => {
    const cols = ln.split(',');
    const obj: Record<string, string> = {};
    headers.forEach((h, i) => {
      obj[h] = (cols[i] ?? '').trim();
    });
    return obj as FinanceRow;
  });
  return rows;
}
function toNum(v: unknown): number | null {
  if (v == null) return null;
  const s = String(v).replace(/[,\s％%]/g, '');
  if (!s || s.toLowerCase() === 'nan' || s.toLowerCase() === 'null') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}
function normKey(k: string): string {
  return k.toLowerCase().replace(/\s+|[_\-（）()]/g, '');
}
function pickField(row: FinanceRow, keys: string[]): number | null {
  const map = new Map<string, string>();
  for (const kk of Object.keys(row)) map.set(normKey(kk), kk);
  for (const k of keys) {
    const found = map.get(normKey(k));
    if (found) {
      const n = toNum((row as any)[found]);
      if (n != null) return n;
    }
  }
  for (const k of keys) {
    const nk = normKey(k);
    const maybe = [...map.keys()].find((kk) => kk.startsWith(nk));
    if (maybe) {
      const orig = map.get(maybe)!;
      const n = toNum((row as any)[orig]);
      if (n != null) return n;
    }
  }
  return null;
}
function getYear(row: FinanceRow): number | null {
  const keys = ['year', '年度', '決算年度', '会計年度', 'fiscalyear', '期'];
  for (const k of keys) {
    const m = Object.keys(row).find((kk) => normKey(kk) === normKey(k));
    if (m) {
      const val = (row as any)[m];
      const y = String(val).match(/(20\d{2}|19\d{2})/);
      if (y) return Number(y[1]);
      const n = toNum(val);
      if (n != null) return n;
    }
  }
  for (const v of Object.values(row))
    if (typeof v === 'string') {
      const y = v.match(/(20\d{2}|19\d{2})/);
      if (y) return Number(y[1]);
    }
  return null;
}
type FinanceSummary = {
  rowsUsed: number;
  latestYear?: number;
  latestSales?: number;
  latestOpMargin?: number | null;
  revCagrPct?: number | null;
  trend?: Trend;
};
function buildFinanceSummary(csvFinanceData: unknown): FinanceSummary | null {
  const arr =
    coerceFinanceArray(csvFinanceData) ??
    (Array.isArray(csvFinanceData) ? (csvFinanceData as FinanceRow[]) : undefined);
  if (!Array.isArray(arr) || arr.length === 0) return null;

  const normalized = arr
    .map((r) => {
      const year = getYear(r);
      const sales =
        pickField(r, ['sales', 'revenue', '売上', '売上高', '売上(百万円)', '売上高(百万円)']) ??
        (pickField(r, ['売上高(万円)', '売上(万円)']) != null
          ? ((pickField(r, ['売上高(万円)', '売上(万円)']) as number) ?? 0) * 0.1
          : null);
      const opProfit = pickField(r, ['operatingprofit', '営業利益', '営業利益(百万円)']);
      let opMargin = pickField(r, ['operatingmargin', '営業利益率']);
      if (opMargin == null && opProfit != null && sales != null && sales !== 0) {
        opMargin = (opProfit / sales) * 100;
      }
      return { year, sales, opMargin };
    })
    .filter((x) => x.year != null || x.sales != null);

  if (normalized.length === 0) return null;

  normalized.sort((a, b) => (b.year ?? 0) - (a.year ?? 0));
  const latest = normalized[0];

  const revPoints = normalized
    .filter((r) => r.year != null && r.sales != null)
    .slice()
    .sort((a, b) => (a.year as number) - (b.year as number));

  let revCagrPct: number | null = null;
  if (revPoints.length >= 2) {
    const first = revPoints[0];
    const last = revPoints[revPoints.length - 1];
    const years = (last.year! - first.year!) || 1;
    if ((first.sales! as number) > 0 && years > 0) {
      const cagr = Math.pow((last.sales! as number) / (first.sales! as number), 1 / years) - 1;
      revCagrPct = cagr * 100;
    }
  }

  let trend: Trend = null;
  if (revPoints.length >= 2) {
    const diffs = revPoints
      .slice(1)
      .map((p, i) => (p.sales! as number) - (revPoints[i].sales! as number));
    const up = diffs.every((d) => d >= 0);
    const down = diffs.every((d) => d <= 0);
    trend = up ? 'up' : down ? 'down' : 'flat';
  }

  return {
    rowsUsed: arr.length,
    latestYear: latest.year ?? undefined,
    latestSales: latest.sales ?? undefined,
    latestOpMargin: latest.opMargin ?? null,
    revCagrPct,
    trend,
  };
}

/* =========================
 * Q&A（12問：質問＋回答を引用）
 * =======================*/
type AnswerStep = { stepNumber: number; question: string; reason: string; answer: string };
type ChapterAnswers = { chapterIndex: number; chapterTitle: string; steps: AnswerStep[] };

function maxStepsForChapter(chapterIndex: number): number {
  switch (chapterIndex | 0) {
    case 0:
      return 2; // 第1章
    case 1:
      return 6; // 第2章
    case 2:
      return 2; // 第3章
    case 3:
      return 2; // 第4章
    default:
      return 2;
  }
}

/**
 * 12問（章別ステップ）を「質問＋回答」セットでプロンプトへ渡す。
 * - 章ごとの最大ステップ数（2/6/2/2）に合わせて抽出
 * - 12問回答は経営層の意思決定材料なので、要点が落ちないよう長めに保持
 * - 質問文が無い場合も耐える
 */
function buildAnswersRich(a2: ChapterAnswers[] = []): string {
  const blocks: string[] = [];
  const by = [...a2]
    .sort((a, b) => (a.chapterIndex ?? 0) - (b.chapterIndex ?? 0))
    .slice(0, 4);

  for (const chap of by) {
    const chapIdx = chap.chapterIndex ?? 0;
    const maxSteps = maxStepsForChapter(chapIdx);
    const steps = (chap.steps ?? []).slice(-maxSteps);

    const lines = steps
      .map((s) => {
        const q = sanitize(s.question, 140).trim();
        const a = sanitize((s.answer || s.reason || '').trim(), 1200).trim();
        if (!q && !a) return '';
        return `  - Q${s.stepNumber ?? ''}${q ? `: ${q}` : ''}\n    A: 「${a || '—'}」`;
      })
      .filter(Boolean);

    if (lines.length) {
      blocks.push(
        `- ${chap.chapterTitle || `第${chapIdx + 1}章`}（議論の要点/12問）:\n${lines.join('\n')}`,
      );
    }
  }

  return blocks.join('\n');
}

/** 12問回答から、業種を固定しない経営意思ダイジェストを抽出する。 */
function extractStrategicIntentDigest(answers12: unknown): Record<string, unknown> | null {
  const arr = asArray<Record<string, unknown>>(answers12);
  if (!arr.length) return null;

  const digest: Record<string, unknown> = {};

  // 危機認識（第0章）
  const crisis = arr.slice(0, 2).map((a) => asText(a.answer, 300)).filter(Boolean).join('。');
  if (crisis) digest.coreCrisis = sanitize(crisis, 500);

  // 喪失機会（第0章Q2）
  const lostOpp = asText(arr[1]?.answer, 500);
  if (lostOpp) digest.lostOpportunity = sanitize(lostOpp, 500);

  // 市場変化（第1章Q1）
  const mktShift = asText(arr[2]?.answer, 500);
  if (mktShift) digest.marketShift = sanitize(mktShift, 500);

  // 価値再定義（第1章Q2）
  const valRedef = asText(arr[3]?.answer, 500);
  if (valRedef) digest.companyRedefinition = sanitize(valRedef, 500);

  // 強み再定義（第1章Q3）
  const strRedef = asText(arr[4]?.answer, 500);
  if (strRedef) digest.strengthRedefinition = sanitize(strRedef, 500);

  // やめること（第1章Q6）
  const stopDoing = asText(arr[7]?.answer, 300);
  if (stopDoing) digest.stopDoing = stopDoing.split(/[、。\n]+/).filter(Boolean).slice(0, 5);

  // 重点市場・重点顧客・重点領域は、固定キーワードで作らず、該当設問の回答本文を素材として渡す。
  const priorityMarketSource = [arr[2]?.answer, arr[3]?.answer, arr[8]?.answer, arr[9]?.answer]
    .filter(Boolean)
    .map((a) => asText(a, 350))
    .join('。');
  if (priorityMarketSource) digest.priorityMarketSource = sanitize(priorityMarketSource, 900);

  // 資源配分変化（第1章Q5→Q6）
  const resShift = [arr[5]?.answer, arr[7]?.answer].filter(Boolean).map((a) => asText(a, 300)).join('。');
  if (resShift) digest.resourceShift = sanitize(resShift, 500);

  const kpiShift = [arr[9]?.answer, arr[10]?.answer]
    .filter(Boolean)
    .map((a) => asText(a, 300))
    .join('。');
  if (kpiShift) digest.kpiShift = sanitize(kpiShift, 600);

  const employeeBehavior = asText(arr[11]?.answer, 500);
  if (employeeBehavior) digest.employeeBehavior = sanitize(employeeBehavior, 600);

  return Object.keys(digest).length > 0 ? digest : null;
}

/* =========================
 * 事業ポートフォリオ正規化
 * =======================*/
type NormalizedBusiness = {
  name: string;
  revenueShare?: number;
  growth?: number;
  margin?: number;
};
type NormalizedPortfolio = {
  businesses?: NormalizedBusiness[];
  focus?: string;
};

function normalizePortfolioInput(
  portfolio: unknown,
  businessPortfolio: unknown,
): NormalizedPortfolio | null {
  // ① 旧形式 { businesses: [...], focus?: string } が来ている場合
  const p = portfolio as any;
  if (p && Array.isArray(p.businesses)) {
    const businesses: NormalizedBusiness[] = (p.businesses as any[]).map((b) => ({
      name:
        b?.name ??
        b?.businessName ??
        b?.segmentName ??
        b?.title ??
        '（名称未設定の事業）',
      revenueShare:
        typeof b?.revenueShare === 'number'
          ? b.revenueShare
          : typeof b?.salesShare === 'number'
          ? b.salesShare
          : typeof b?.share === 'number'
          ? b.share
          : undefined,
      growth:
        typeof b?.growthRate === 'number'
          ? b.growthRate
          : typeof b?.growth === 'number'
          ? b.growth
          : undefined,
      margin:
        typeof b?.profitMargin === 'number'
          ? b.profitMargin
          : typeof b?.margin === 'number'
          ? b.margin
          : undefined,
    }));
    return { businesses, focus: p?.focus };
  }

  // ② 新形式 businessPortfolio: BusinessPortfolioItem[] 想定
  if (Array.isArray(businessPortfolio) && businessPortfolio.length) {
    const businesses: NormalizedBusiness[] = (businessPortfolio as any[]).map((b) => ({
      name:
        b?.name ??
        b?.businessName ??
        b?.segmentName ??
        b?.title ??
        '（名称未設定の事業）',
      revenueShare:
        typeof b?.revenueShare === 'number'
          ? b.revenueShare
          : typeof b?.salesShare === 'number'
          ? b.salesShare
          : typeof b?.share === 'number'
          ? b.share
          : undefined,
      growth:
        typeof b?.growthRate === 'number'
          ? b.growthRate
          : typeof b?.growth === 'number'
          ? b.growth
          : undefined,
      margin:
        typeof b?.profitMargin === 'number'
          ? b.profitMargin
          : typeof b?.margin === 'number'
          ? b.margin
          : undefined,
    }));
    return { businesses };
  }


  return null;
}

/**
 * 事業ポートフォリオを「個別事業の羅列」ではなく、成長シフトの統合価値として扱うためのガイド。
 * 特定企業の固定ロジックにはせず、入力されたセグメント名・事業名から役割を推定する。
 */
function buildPortfolioIntegrationGuide(args: {
  portfolio?: NormalizedPortfolio | null;
  segmentsText?: string;
  businessSegments?: unknown;
  mustKeepTerms?: string[];
}): string {
  const portfolioNames = (args.portfolio?.businesses || [])
    .map((b) => asText(b.name, 80))
    .filter(Boolean);
  const segmentNamesFromText = getUniqueSegmentNames(args.segmentsText);
  const segmentNamesFromObjects = asArray<Record<string, unknown>>(args.businessSegments)
    .map((x) => pickFirstText(x.name, x.title, x.segmentName, x.businessName))
    .filter(Boolean);
  const names = Array.from(new Set([...portfolioNames, ...segmentNamesFromText, ...segmentNamesFromObjects])).slice(0, 8);
  const hasManySegments = names.length >= 4;
  const joined = names.join('、');

  const importantTerms = (args.mustKeepTerms || []).slice(0, 5).join('、') || '入力された重点市場・用途・技術・顧客価値';

  if (!names.length) {
    return [
      '- 事業セグメントが未入力の場合も、既存事業の個別改善ではなく、入力回答にある市場・用途・技術・顧客価値を束ねた成長シフト仮説として書く。',
      '- 第2章では「どの強みを組み合わせ、どの顧客価値へ変えるのか」を必ず明示する。',
    ].join('\n');
  }

  const base = [
    `- 入力された事業・セグメント：${joined}`,
    '- これらを単独事業の羅列で終わらせない。各事業の役割を分けたうえで、成長市場に向けた統合価値として再構成する。',
    '- 第2章では、少なくとも1段落で「複数事業を組み合わせて顧客価値を高める戦い方」を書く。',
    '- 4事業以上ある場合、3分類に無理に押し込まず、「成長牽引軸」「収益改善軸」「基盤技術軸」「高付加価値化軸」「ソリューション化軸」などの補助軸を使い、全事業名を落とさない。',
    '- 部品・システム・加工・装置系の事業は、単なる縮小対象にせず、他事業を支える基盤技術・高付加価値化・ソリューション化の役割を検討する。',
    `- 重点市場・用途・技術・顧客価値は、${importantTerms} を中心に、入力にある語だけで具体化する。`,
  ];

  return base.join('\n');
}

/* =========================
 * STAGE2 入力素材フォーマット（互換対応）
 * =======================*/
function parseFiniteNumberLocal(v: unknown): number | null {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const n = Number(String(v).replace(/[,，\s]/g, ''));
  return Number.isFinite(n) ? n : null;
}

function normalizeTargetYear(v: unknown): string {
  const s = asText(v, 80);
  if (!s) return '';
  const m = s.match(/(20\d{2}|19\d{2})/);
  return m ? `${m[1]}年度` : s;
}

function formatTargetValueForStory(valueRaw: unknown, unitRaw: unknown): string {
  const unit = asText(unitRaw, 40);
  const n = parseFiniteNumberLocal(valueRaw);
  const raw = asText(valueRaw, 80);
  if (n == null) return raw ? `${raw}${unit}` : '';

  // STAGE2の業績目標UIは「百万円」を標準単位にしている。
  // そのまま 90000百万円 と渡すと本文に 90000 と出やすいため、社員向けには億円へ正規化する。
  if (unit === '百万円' || unit.toLowerCase() === 'million yen') {
    const oku = n / 100;
    const okuText = Number.isInteger(oku) ? String(oku) : oku.toFixed(1).replace(/\.0$/, '');
    return `${okuText}億円`;
  }
  if (unit === '万円') {
    const oku = n / 10000;
    if (oku >= 1) {
      const okuText = Number.isInteger(oku) ? String(oku) : oku.toFixed(1).replace(/\.0$/, '');
      return `${okuText}億円`;
    }
  }
  return `${n}${unit}`;
}

function formatCompanyTargets(targets: unknown): string {
  const arr = asArray<Record<string, unknown>>(targets);
  if (!arr.length) return '—';
  const lines = arr
    .map((t, i) => {
      const name = pickFirstText(t.name, t.title, t.label, t.metricName, t.metric, t.kpi, t.item) || `目標${i + 1}`;
      // companyTargets UIでは base が「目標値」。targetValue/value等がある場合のみそちらを優先。
      const valueRaw = t.targetValue ?? t.value ?? t.amount ?? t.target ?? t.goal ?? t.numericValue ?? t.base;
      const unit = pickFirstText(t.unit, t.unitLabel, t.currency);
      const year = normalizeTargetYear(t.dueYear ?? t.targetYear ?? t.year ?? t.fiscalYear ?? t.deadline);
      const note = pickFirstText(t.rationale, t.note, t.memo, t.description, t.reason);
      // 内部ID（issue-...等）は最終本文に混入しやすいため、プロンプトには渡さない。
      const value = formatTargetValueForStory(valueRaw, unit);
      const parts = [
        name,
        value ? `${value}` : '',
        year ? `${year}` : '',
        note ? `${note}` : '',
      ].filter(Boolean);
      return `- ${parts.join('／')}`;
    })
    .filter(Boolean);
  return lines.length ? lines.join('\n') : '—';
}

function formatGenericList(title: string, value: unknown, maxChars = 2800): string {
  const arr = asArray<Record<string, unknown>>(value);
  if (!arr.length) return `${title}: —`;
  const lines = arr.slice(0, 12).map((item, i) => {
    const name = pickFirstText(item.title, item.name, item.label, item.question, item.key) || `${title}${i + 1}`;
    const desc = pickFirstText(item.description, item.body, item.summary, item.answer, item.value, item.reason, item.content, item.text).slice(0, 500);
    return `- ${name}${desc ? `：${desc}` : ''}`;
  });
  return `${title}:\n${lines.join('\n')}`.slice(0, maxChars);
}

function formatAnswers12(answers12: unknown): string {
  const arr = asArray<Record<string, unknown>>(answers12);
  if (!arr.length) return '—';
  return arr
    .slice(0, 20)
    .map((a, i) => {
      const q = pickFirstText(a.question, a.title, a.label, a.prompt) || `Q${i + 1}`;
      const ans = pickFirstText(a.answer, a.value, a.body, a.text, a.response, a.reason).slice(0, 1500);
      const chapter = pickFirstText(a.chapterTitle, a.chapter, a.section, a.category).slice(0, 80);
      return `- ${chapter ? `${chapter} / ` : ''}${q}\n  A: 「${ans || '—'}」`;
    })
    .join('\n');
}

function collectAnswerText(answers12: unknown, maxChars = 16000): string {
  return asArray<Record<string, unknown>>(answers12)
    .map((a) => pickFirstText(a.answer, a.value, a.body, a.text, a.response, a.reason))
    .filter(Boolean)
    .join('\n')
    .slice(0, maxChars);
}

function normalizeTermForKey(term: string): string {
  return normalizeNewlines(term)
    .replace(/[「」『』"“”'`*_#\[\]（）()【】]/g, '')
    .replace(/\s+/g, '')
    .trim()
    .toLowerCase();
}

function cleanMustKeepTerm(term: string): string {
  return tidyJa(
    normalizeNewlines(term)
      .replace(/^[\s・\-−、。:：]+/g, '')
      .replace(/[\s・\-−、。:：]+$/g, '')
      .replace(/[「」『』"“”*_#\[\]【】]/g, '')
      .replace(/\s+/g, ' ')
      .trim(),
  );
}

function isGoodMustKeepTerm(term: string): boolean {
  const t = cleanMustKeepTerm(term);
  const key = normalizeTermForKey(t);
  if (!t || key.length < 3 || key.length > 42) return false;
  if (/^(当社|会社|顧客|市場|事業|技術|製品|部品|品質|コスト|納期|成長領域|新市場|重点市場|強み|価値|課題|KPI|AI)$/i.test(t)) return false;
  if (/[。！？\n]/.test(t)) return false;
  if (/^(これ|それ|ため|こと|もの|よう|必要|具体的|以下|次の|特に)$/u.test(t)) return false;
  return /[A-Za-zＡ-Ｚａ-ｚ0-9０-９ァ-ヶー]/u.test(t) || /・|×|／|\/|向け|時代|ユニット|ソリューション|モジュール|システム|市場|領域|用途|顧客価値/u.test(t);
}

function addTermCandidate(target: string[], term: string) {
  const cleaned = cleanMustKeepTerm(term);
  if (!isGoodMustKeepTerm(cleaned)) return;
  const key = normalizeTermForKey(cleaned);
  if (target.some((v) => normalizeTermForKey(v) === key)) return;
  target.push(cleaned);
}

/**
 * 12問回答から、その会社固有の戦略語を汎用的に抽出する。
 * 特定企業・特定業界の単語は固定しない。引用、強調、頻出する複合語、英字/カタカナ混じりの語を優先する。
 */
function extractMustKeepTerms(answers12: unknown, max = 10): string[] {
  const source = collectAnswerText(answers12);
  if (!source) return [];

  const terms: string[] = [];
  const sourceLines = normalizeNewlines(source)
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  // ユーザーが引用符・強調で示した表現は、戦略上のこだわりである可能性が高い。
  const quotedPatterns = [
    /「([^」]{3,60})」/g,
    /『([^』]{3,60})』/g,
    /\*\*([^*]{3,60})\*\*/g,
  ];
  for (const pattern of quotedPatterns) {
    for (const match of source.matchAll(pattern)) addTermCandidate(terms, match[1]);
  }

  // 英字・数字・カタカナを含む複合語、用途名、技術名、市場名を拾う。
  const compoundPatterns = [
    /[A-Za-z][A-Za-z0-9・\-／\/]*[一-龠ぁ-んァ-ヶーA-Za-z0-9・\-／\/]{1,32}/g,
    /[ァ-ヶーA-Za-z0-9・\-／\/]{2,30}(?:市場|領域|用途|向け|技術|ユニット|ソリューション|モジュール|システム|機器|部品|基盤)/g,
    /[一-龠ぁ-んァ-ヶーA-Za-z0-9・\-／\/]{2,30}(?:時代|市場|領域|用途|向け|技術|ユニット|ソリューション|モジュール|システム|基盤)/g,
    /[一-龠ぁ-んァ-ヶーA-Za-z0-9]{1,20}[・×／\/][一-龠ぁ-んァ-ヶーA-Za-z0-9・×／\/]{1,28}/g,
  ];
  for (const pattern of compoundPatterns) {
    for (const match of source.matchAll(pattern)) addTermCandidate(terms, match[0]);
  }

  // 「AではなくB」「AからBへ」のB側は、目指す姿・転換先になりやすい。
  for (const line of sourceLines) {
    const contrast = line.match(/ではなく、?\s*([^。！？\n]{3,50})/);
    if (contrast?.[1]) addTermCandidate(terms, contrast[1]);
    const shift = line.match(/から「?([^」。\n]{3,50})」?\s*へ/);
    if (shift?.[1]) addTermCandidate(terms, shift[1]);
  }

  // 似た短語が長語に含まれる場合は長語を優先する。
  return terms
    .filter((term, index, arr) => {
      const key = normalizeTermForKey(term);
      return !arr.some((other, otherIndex) => otherIndex !== index && normalizeTermForKey(other).includes(key) && normalizeTermForKey(other).length > key.length);
    })
    .slice(0, max);
}

function formatStrategicSpineForPrompt(mustKeepTerms: string[]): string {
  if (!mustKeepTerms.length) {
    return [
      '- 入力回答で強調された市場・用途・技術・顧客価値を、戦略の主語として扱う。',
      '- 「既存事業から成長領域へ」の一般論で終わらせず、入力回答にある転換先を明確にする。',
    ].join('\n');
  }

  const primary = mustKeepTerms.slice(0, 5).join('、');
  const required = mustKeepTerms.slice(0, 3).join('、');
  return [
    `- 戦略の主語候補：${primary}`,
    `- 必須保持語：${required}`,
    '- これらは単なる装飾語ではなく、「当社が何者へ転換するのか」「顧客が何を理由に選ぶのか」を定義する材料として使う。',
    '- 必須保持語のうち少なくとも1つは、結論相当の転換文、第2章の戦略選択、または中計コンセプトのいずれかで、戦略の主語として使う。',
    '- 第1章または第2章の早い段落で、既存の競争軸から新しい提供価値への転換を明確に書く。',
    '- 第2章では、重要語を重点市場・用途・技術・顧客価値・資源配分の判断基準に接続する。',
    '- 第3章では、重要語が実現されたときの顧客からの評価や成果指標に接続する。',
  ].join('\n');
}

function formatStoryDraft(storyDraft: unknown): string {
  const arr = asArray<Record<string, unknown>>(storyDraft);
  if (!arr.length) return asText(storyDraft, 2000) || '—';
  return arr
    .slice(0, 4)
    .map((s, i) => {
      const title = pickFirstText(s.title, s.heading, s.chapterTitle) || TITLE_TEMPLATES[i] || `章${i + 1}`;
      const body = pickFirstText(s.body, s.content, s.text, s.summary).slice(0, 700);
      return `【${title}】\n${body || '—'}`;
    })
    .join('\n\n');
}

function formatSelectedWinPattern(candidates: unknown, selectedId: unknown): string {
  const arr = asArray<Record<string, unknown>>(candidates);
  const selected = asText(selectedId, 120);
  if (!arr.length) return '—';
  const hit =
    arr.find((x) => [x.id, x.key, x.patternId, x.value].some((v) => asText(v, 120) === selected)) ??
    arr.find((x) => x.selected === true || x.isSelected === true) ??
    arr[0];
  const name = pickFirstText(hit.title, hit.name, hit.label, hit.patternName) || '選択候補';
  const desc = pickFirstText(hit.description, hit.summary, hit.reason, hit.body).slice(0, 700);
  const kpi = asArray(hit.valueDriverKPIs ?? hit.kpis ?? hit.metrics)
    .map((x) => (typeof x === 'string' ? x : pickFirstText((x as any)?.name, (x as any)?.title, (x as any)?.label)))
    .filter(Boolean)
    .join('、');
  return [`${name}`, desc ? `狙い=${desc}` : '', kpi ? `価値指標=${kpi}` : '']
    .filter(Boolean)
    .join('\n');
}

function formatUnknownForPrompt(value: unknown, maxChars = 2200): string {
  if (value == null) return '—';
  if (typeof value === 'string') return asText(value, maxChars) || '—';
  try {
    return JSON.stringify(safeSerialize(value), null, 2).slice(0, maxChars);
  } catch {
    return asText(value, maxChars) || '—';
  }
}


function stripPeopleRelatedNoise(text: string): string {
  if (!text) return text;
  let out = normalizeNewlines(text);

  // 今回の最終ストーリーでは、人材・採用・育成を戦略の中心に見せないため、
  // 入力素材から該当文を一旦落とす。STAGE3/4で必要に応じて扱う前提。
  const peopleKeywords = /(採用|育成|人材|人員|人財|能力開発|社員教育|教育訓練|研修|OJT|リスキリング|スキルアップ|能力を最大限|能力向上|優秀な人材|人的資本)/;

  out = out
    .split(/(?<=[。！？!?\n])/)
    .filter((sentence) => !peopleKeywords.test(sentence))
    .join('');

  // 箇条書き行にも残りやすいため、行単位でも除去する。
  out = out
    .split('\n')
    .filter((line) => !peopleKeywords.test(line))
    .join('\n');

  return out.replace(/\n{3,}/g, '\n\n').trim();
}

function compactStrategicDraftForPrompt(storyDraft: unknown): string {
  const raw = formatStoryDraft(storyDraft);
  if (raw === '—') return raw;
  return stripPeopleRelatedNoise(raw).slice(0, 2600) || '—';
}

function cleanFinalStoryArtifacts(text: string): string {
  if (!text) return text;
  let out = normalizeNewlines(text);
  out = out.replace(/^.*North\s*Star未入力.*$/gim, '');
  out = out.replace(/^.*ノーススター未入力.*$/gim, '');
  out = out.replace(/【DEBUG】[^\n]*/g, '');
  out = out.replace(/\[DEBUG\][^\n]*/gi, '');
  out = out.replace(/debug[:：][^\n]*/gi, '');
  out = out.replace(/\(?fact-seg-?\d+\)?/gi, '');
  out = out.replace(/論点ID[:：]?\s*issue-[^\s）)]+/gi, '');
  out = out.replace(/。。。+/g, '。');
  out = out.replace(/。{2,}/g, '。');
  out = out.replace(/！{2,}/g, '！');
  out = out.replace(/？{2,}/g, '？');
  out = out.replace(/■\s*社員への直接的な呼びかけ[:：]?\s*/g, '');
  out = out.replace(/■\s*経営としての意思宣言[:：]?\s*/g, '');
  out = out.replace(/社員への直接的な呼びかけ[:：]?\s*/g, '');
  out = out.replace(/経営としての意思宣言[:：]?\s*/g, '');
  out = out.replace(/となりますんだ/g, 'となります');
  out = out.replace(/なりますんだ/g, 'なります');
  out = out.replace(/ですんだ/g, 'です');
  out = out.replace(/無二無三/g, '一人ひとりの役割を持ち寄る');
  out = out.replace(/全力投球いたします/g, '必要な資源と支援を集中します');
  out = out.replace(/必死で取り組み続けます/g, '継続して取り組みます');
  out = out.replace(/変革運動/g, '変革');
  out = out.replace(/賭け/g, '選択');
  out = out.replace(/必ず成功(?:へ導いてみせます|します|できる)?/g, '実現に向けて進みます');
  out = out.replace(/一緒に(?:この挑戦に)?立ち向か(?:いましょう|おう)/g, '各部門で具体化していきましょう');
  out = out.replace(/一緒について来てください/g, '各部門で具体化していきましょう');
  out = out.replace(/全力で取り組みます/g, '必要な資源を集中します');
  out = out.replace(/全力で進んでいきましょう/g, '着実に進めていきましょう');
  out = out.replace(/全力で舵取りを行います/g, '方向性を明確に示します');
  out = out.replace(/希望だと信じています/g, '次の成長につながります');
  out = out.replace(/営業利益(?:の)?基準値\s*([0-9,，]+)\s*（期限[:：][^)）]+）/g, '営業利益目標');
  out = out.replace(/最初の?90日間?で(?:着手|実施|行う|進める)べき施策としては、?/g, '実行初期に具体化すべき論点は、');
  out = out.replace(/90日(?:間)?アクション/g, '初期実行テーマ');
  out = out.replace(/90日(?:間)?/g, '実行初期');
  // ★ prompt.txt指示：追加置換ルール
  out = out.replace(/フィジカルあAI/g, 'フィジカルAI');
  out = out.replace(/\b我々\b/g, '当社');
  out = out.replace(/の?夢(?!の市場|を実現)/g, '将来像');
  out = out.replace(/誇りとやりがい/g, '仕事の意味や顧客価値への接続');
  out = out.replace(/誇りややりがい/g, '仕事の意味や顧客価値への接続');
  out = out.replace(/仕事への誇りややりがい/g, '仕事の意味や顧客価値への接続');
  out = out.replace(/挑戦を恐れず/g, '重点市場への行動変化');
  out = stripPeopleRelatedNoise(out);
  out = out.replace(/[ \t]+\n/g, '\n');
  out = out.replace(/\n{3,}/g, '\n\n').trim();
  return tidyJa(out);
}

function evaluateStrategicIntentCoverage(text: string, mustKeepTerms: string[] = []): {
  covered: number;
  total: number;
  missing: string[];
  missingMustKeepTerms: string[];
  missingSpineTerms: string[];
} {
  const source = normalizeNewlines(text || '');
  const sourceKey = normalizeTermForKey(source);
  const strategicFrontText = source.slice(0, Math.max(1200, Math.floor(source.length * 0.45)));
  const strategicFrontKey = normalizeTermForKey(strategicFrontText);
  const checks: Array<{ key: string; patterns: RegExp[] }> = [
    {
      key: '危機認識',
      patterns: [/危機/, /リスク/, /変化/, /失う/, /取り残される/, /競争/],
    },
    {
      key: '失うもの・放置した場合の影響',
      patterns: [/失う/, /損なう/, /低下/, /機会/, /関係性/, /収益/, /利益/],
    },
    {
      key: '市場・顧客・環境変化',
      patterns: [/市場/, /顧客/, /環境/, /需要/, /業界/, /変化/],
    },
    {
      key: '自社を選ぶ理由・提供価値',
      patterns: [/価値/, /選ばれる/, /強み/, /提供/, /顧客価値/, /差別化/],
    },
    {
      key: '重点領域・重点市場・重点顧客',
      patterns: [/重点/, /成長領域/, /注力/, /集中/, /市場/, /顧客/],
    },
    {
      key: '強みの再定義',
      patterns: [/再定義/, /強み/, /能力/, /技術/, /資産/, /基盤/],
    },
    {
      key: 'やめること・見直すこと',
      patterns: [/やめる/, /見直し/, /選別/, /縮小/, /撤退/, /整理/, /低採算/],
    },
    {
      key: '資源配分・評価基準・KPIの変更',
      patterns: [/資源配分/, /評価基準/, /KPI/, /予算/, /投資/],
    },
  ];

  const missing = checks
    .filter((check) => !check.patterns.some((pattern) => pattern.test(source)))
    .map((check) => check.key);
  const missingMustKeepTerms = mustKeepTerms
    .filter((term) => !sourceKey.includes(normalizeTermForKey(term)))
    .slice(0, 8);
  const missingSpineTerms = mustKeepTerms
    .slice(0, 3)
    .filter((term) => !strategicFrontKey.includes(normalizeTermForKey(term)))
    .slice(0, 3);

  return {
    covered: checks.length - missing.length,
    total: checks.length,
    missing,
    missingMustKeepTerms,
    missingSpineTerms,
  };
}

function evaluateExecutiveStoryQuality(sections: { heading: string; body: string }[]): {
  minBodyLength: number;
  bodyLengths: number[];
  tooShortIndexes: number[];
  genericWeakPhraseCount: number;
  hasGenericWeaknessRisk: boolean;
} {
  const bodyLengths = sections.map((section) => Array.from(section.body || '').length);
  const joined = sections.map((section) => section.body || '').join('\n');
  const count = (pattern: RegExp) => (joined.match(pattern) || []).length;
  const genericWeakPhraseCount = count(/新技術の導入|製品ラインナップの拡充|生産プロセスの最適化|市場調査|プロジェクトチームを編成|ターゲット顧客を特定|競争環境を把握/g);

  return {
    minBodyLength: Math.min(...bodyLengths),
    bodyLengths,
    tooShortIndexes: bodyLengths
      .map((len, index) => ({ len, index }))
      .filter((item) => item.len < 700)
      .map((item) => item.index),
    genericWeakPhraseCount,
    hasGenericWeaknessRisk: genericWeakPhraseCount >= 2,
  };
}

/** ★ prompt.txt指示：生成後チェック関数 */
function containsBadTone(text: string): { hasBadTone: boolean; found: string[] } {
  if (!text) return { hasBadTone: false, found: [] };
  const badPatterns = [
    { pattern: /\b我々\b/g, label: '我々' },
    { pattern: /(?<!\S)夢(?!\S)/g, label: '夢' },
    { pattern: /誇り/g, label: '誇り' },
    { pattern: /やりがい/g, label: 'やりがい' },
    { pattern: /挑戦/g, label: '挑戦' },
    { pattern: /全社員が/g, label: '全社員が' },
  ];
  const found: string[] = [];
  for (const { pattern, label } of badPatterns) {
    if (pattern.test(text)) found.push(label);
  }
  return { hasBadTone: found.length > 0, found };
}

function containsTypo(text: string): { hasTypo: boolean; found: string[] } {
  if (!text) return { hasTypo: false, found: [] };
  const typos = [
    { pattern: /フィジカルあAI/g, label: 'フィジカルあAI' },
  ];
  const found: string[] = [];
  for (const { pattern, label } of typos) {
    if (pattern.test(text)) found.push(label);
  }
  return { hasTypo: found.length > 0, found };
}

/* =========================
 * OpenAI 呼び出し（JSON強制＋条件付きフォールバック）
 * =======================*/
type ChatArgs = {
  model: string;
  temperature: number;
  max_tokens: number;
  timeoutMs?: number;
  presence_penalty?: number;
  frequency_penalty?: number;
  system: string;
  user: string;
  allowFallback?: boolean;
};

async function callOpenAIChat(args: ChatArgs): Promise<string> {
  const {
    model,
    temperature,
    max_tokens,
    timeoutMs = 52_000,
    presence_penalty = 0.2,
    frequency_penalty = 0.2,
    system,
    user,
    allowFallback = false,
  } = args;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  const base: ChatCompletionCreateParamsNonStreaming = {
    model,
    ...getTemperatureParam(model, temperature),
    ...getTokenLimitParam(model, max_tokens),
    ...getPenaltyParams(model, presence_penalty, frequency_penalty),
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    ...(SUPPORTS_JSON_MODE.test(model)
      ? { response_format: { type: 'json_object' as const } }
      : {}),
    ...(model.startsWith('gpt-5.6') ? { reasoning_effort: 'low' } : {}),
  };

  try {
    const resp = await openai.chat.completions.create(base, {
      signal: controller.signal,
    });
    clearTimeout(timer);
    return resp.choices?.[0]?.message?.content?.trim() ?? '';
  } catch (e: any) {
    clearTimeout(timer);
    const isAbort = e?.name === 'AbortError';
    const status =
      e?.status ?? e?.response?.status ?? (isAbort ? 504 : 500);
    // 429/5xx かつ allowFallback === true の場合のみfallback
    // AbortError は本番 maxDuration を超えやすいため再試行しない。
    if (!isAbort && (status === 429 || status >= 500) && allowFallback) {
      const fallbackModel = AI_MODELS.lightweight;
      if (model !== fallbackModel) {
        return await callOpenAIChat({
          ...args,
          model: fallbackModel,
          allowFallback: false,
          timeoutMs: Math.min(timeoutMs, 24_000),
        });
      }
    }
    throw {
      status,
      message: e?.message || 'OpenAI error',
      type: 'openai_error',
      raw: safeSerialize(e),
    };
  }
}

/* =========================
 * 軽い正規化＆ブリッジ補助
 * =======================*/
type SectionLike = { heading?: string; body?: string };

function coerceToSimpleHeads(
  sections: SectionLike[],
): { heading: string; body: string }[] {
  const arr = Array.isArray(sections) ? sections : [];
  const out: { heading: string; body: string }[] = [];
  for (let i = 0; i < 4; i++) {
    const src = arr[i] || {};
    out.push({
      heading: SIMPLE_HEADS[i],
      body: sanitize(src.body || '', 4000) || '（この章は未生成です）',
    });
  }
  return out;
}

const ENABLE_BRIDGES = false; // 将来 true にすれば復活できる

function ensureBridges(
  sections: { heading: string; body: string }[],
): { heading: string; body: string }[] {
  // 章間ブリッジを差し込まないバージョン
  return sections;
}


function containsPeopleStrategyNoise(text: string): boolean {
  return /(採用|育成|人材|人員|人財|能力開発|社員教育|教育訓練|研修|OJT|リスキリング|スキルアップ|能力を最大限|能力向上|優秀な人材|人的資本)/.test(text || '');
}

function getUniqueSegmentNames(segmentsText?: string): string[] {
  const raw = asText(segmentsText, 800);
  if (!raw || raw === '—') return [];
  const seen = new Set<string>();
  return raw
    .split(/[、・,，/／\n]+/)
    .map((x) => x.trim())
    .filter((x) => x && x !== '—')
    .filter((x) => {
      if (seen.has(x)) return false;
      seen.add(x);
      return true;
    })
    .slice(0, 6);
}

function containsChapter2MaterialLeak(text: string): boolean {
  const t = normalizeNewlines(text || '');
  if (!t.trim()) return true;
  const prohibited = [
    /自社の勝ち筋[:：]/,
    /当社の勝ち筋は、?\s*\d+\./,
    /\n\s*\d+\.\s*(圧倒的|高い研究|特定事業)/,
    /ガイシ（?碍子）?/,
    /特定製品領域\s*[:：]/,
    /特定インフラ領域\s*[:：]/,
    /根拠（SWOT）/,
    /強み\(S\)|弱み\(W\)|機会\(O\)|脅威\(T\)/,
    /90日アクション/,
    /トレードオフ/,
    /関連論点\s*=/,
    /issue-[\w\-ぁ-んァ-ヶ一-龠（）()]+/i,
    /目標値\s*=/,
    /目標年\s*=/,
    /-\s*売上[／/]/,
    /-\s*営業利益[／/]/,
    /North\s*Star未入力/,
    /論点ID/,
    /SWOT/,
    /\*\*[^\n]+\*\*/,
  ];
  if (prohibited.some((re) => re.test(t))) return true;

  const names = ['エンバイロメント事業', 'デジタルソサエティ事業', 'エネルギー＆インダストリー事業'];
  for (const name of names) {
    const count = (t.match(new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length;
    if (count > 2) return true;
  }

  // 箇条書き素材が本文として流入している場合の検出
  const bulletLikeLines = t.split('\n').filter((line) => /^\s*[-・]\s+/.test(line)).length;
  return bulletLikeLines >= 3;
}

function buildStrategicChapter2Body(args: {
  segmentsText?: string;
  portfolio?: NormalizedPortfolio | null;
  companyTargetsText?: string;
  answersText?: string;
}): string {
  const segmentNames = getUniqueSegmentNames(args.segmentsText);
  const portfolioNames = (args.portfolio?.businesses || [])
    .map((b) => asText(b.name, 80))
    .filter(Boolean);
  const names = Array.from(new Set([...portfolioNames, ...segmentNames])).slice(0, 6);
  const guide = buildPortfolioIntegrationGuide({
    portfolio: args.portfolio,
    segmentsText: args.segmentsText,
    mustKeepTerms: extractMustKeepTerms(args.answersText || ''),
  });

  const hasNames = names.length > 0;
  const namesText = hasNames ? names.join('、') : '各事業';
  const roleText = hasNames
    ? `${namesText}を、成長牽引、収益改善、基盤技術、高付加価値化、選別対象のいずれかに位置づける。`
    : '各事業を、成長牽引、収益改善、基盤技術、高付加価値化、選別対象のいずれかに位置づける。';

  return [
    '当社が選ぶべき戦い方は、既存事業を個別に改善し続けることではない。入力された強みを束ね、顧客が次に必要とする用途・機能・提供価値へ組み替えることで、成長市場に入り込む理由をつくることである。',
    `${roleText}ただし、分類そのものが目的ではない。各事業に分散している技術、顧客接点、開発・生産能力を組み合わせ、単品提供から統合価値の提供へ移すことが戦略の中心になる。`,
    '成長領域には、重点顧客、開発テーマ、投資配分、投資回収KPIを明確にして資源を寄せる。一方で、成長領域との接続が弱い商品、目的が曖昧な投資、収益性の低い活動は見直す。財務余力は、将来の収益基盤につながる用途開発、市場開拓、顧客価値向上に優先配分する。',
    'この戦い方では、既存の売上構成や部門別実績だけで判断しない。どの事業がどの成長市場で顧客価値を生み、どの技術を組み合わせれば競争条件を変えられるかを判断基準にする。これにより、既存事業を守る計画ではなく、成長シフトを実現する計画に変える。',
    `事業統合の前提は次の通りである。${guide.replace(/\n-/g, ' ').replace(/^-\s*/, '')}`,
    'この方針に基づき、STAGE3では事業別・部門別の役割を定義し、STAGE4では重点顧客、開発テーマ、投資基準、KPI、撤退基準に落とし込む。第2章の役割は、何を伸ばすかだけでなく、何を組み合わせ、何を見直し、どこに資源を集中するかを全社の判断基準として明確にすることである。',
  ].join('\n\n');
}

function buildStoryLikeChapter1Body(args: {
  finMini?: { opm?: number | null } | null;
  strategySignalDigest?: string;
}): string {
  return [
    '当社が直面している課題は、足元の業績だけでは捉えきれない。これまで収益を支えてきた市場、顧客、競争環境、提供価値の前提が変わり始めている。既存の延長で事業を積み上げるだけでは、次の成長機会を十分に取り切れない局面に入っている。',
    '財務面では、ROICがWACCを上回り、一定の価値創造力と再投資余地は残されている。さらに財務余力もあるため、成長領域へ踏み出す余地はある。しかし、PBRが低位にとどまっていることは、市場が将来成長、資本効率、事業構造転換の実現性にまだ十分な確信を持てていないことを示している。',
    'つまり、問題は「投資できないこと」ではなく、「どこに投資し、何を伸ばし、何を見直すのか」がまだ経営ストーリーとして明確に示し切れていないことにある。成長率が鈍化している事業、収益性を高めるべき事業、将来の成長を担う事業を分けて捉え、資源配分の考え方を再設計する必要がある。',
    'したがって本計画では、従来の前提に依存した成長モデルを見直し、市場、顧客、提供価値の観点から資源配分を再設計することを経営上の主要論点とする。第1章の結論は、危機を強調することではなく、財務余力がある今こそ、次の成長に向けた選択と集中を明確にする必要があるということである。',
  ].join('\n\n');
}

function buildStoryLikeChapter3Body(): string {
  return [
    '目指す未来は、売上・利益目標を達成するだけの姿ではない。顧客が事業環境の変化に向き合う中で、当社が重要な課題を任せられる存在として選ばれる状態をつくることである。ここで重要なのは、製品やサービス単体の強さではなく、顧客の変化に合わせて用途、品質、提供体制、継続的な支援価値を明確にすることである。',
    'この未来が実現すれば、成長は一時的な売上増ではなく、収益構造の転換として現れる。重点顧客・重点用途での採用が広がり、開発テーマと市場開拓が結びつき、営業利益率や資本効率の改善につながる。結果として、売上高や営業利益の目標は、単なる数値目標ではなく、顧客価値を起点にした成長の到達点として意味を持つ。',
    'また、市場評価を高めるためには、将来成長の説明可能性が必要である。どの顧客課題を解決し、どの用途で競争優位を築き、どのKPIで成長を測るのかが明確になれば、資本市場に対しても、既存依存から次の収益基盤へ移行する道筋を示すことができる。',
    'したがって第3章では、目指す未来を「顧客から選ばれる理由」「競争優位の源泉」「成長を測るKPI」として具体化する。この未来像を明確にすることで、次のSTAGE3では各事業・部門が担うべき役割を定義し、STAGE4では顧客価値と成果を結ぶ実行指標に落とし込む。',
  ].join('\n\n');
}

function buildStoryLikeChapter4Body(): string {
  return [
    '全社戦略は、方針として示すだけでは成果につながらない。第2章で定めた重点領域と資源配分方針を、STAGE3で事業別・部門別の役割と重点テーマへ展開する必要がある。各部門は、成長領域への貢献、既存依存の見直し、顧客価値向上に対して何を担うのかを明確にする。',
    'その際、部門戦略は単なる活動一覧ではなく、全社戦略との接続が分かる形で設計する。たとえば、既存収益を守る領域、新用途を開拓する領域、収益性を改善する領域を分け、それぞれに重点顧客、重点用途、見直す活動を設定する。これにより、部門ごとの判断が全社の成長ストーリーとずれないようにする。',
    'STAGE4では、重点テーマをKPI、投資、期限、担当、実行計画に落とし込む。売上成長率、営業利益率、重点顧客・重点用途の開拓、投資回収基準など、戦略の進捗を測る指標を設計し、成長投資と収益改善の両面から実行計画を具体化する。',
    'STAGE5では、経営会議や部門レビューを通じて進捗を確認し、戦略と実行のズレを修正する。これにより、全社戦略を方針文書で終わらせず、部門の判断基準、KPI、実行管理へ接続し、経営が継続的に成果への道筋を確認できる状態をつくる。',
  ].join('\n\n');
}

function normalizeStrategicStorySections(
  sections: { heading: string; body: string }[],
  args: {
    segmentsText?: string;
    portfolio?: NormalizedPortfolio | null;
    companyTargetsText?: string;
    answersText?: string;
  },
): { heading: string; body: string }[] {
  const out = [...sections];

  // AI生成本文を固定文で上書きしない。空章だけ、業種非依存の汎用文で補完する。
  if (!asText(out[0]?.body)) out[0] = { heading: 'なぜ今', body: buildStoryLikeChapter1Body({}) };
  if (!asText(out[1]?.body)) out[1] = { heading: 'どう戦う', body: buildStrategicChapter2Body(args) };
  if (!asText(out[2]?.body)) out[2] = { heading: 'どんな未来', body: buildStoryLikeChapter3Body() };
  if (!asText(out[3]?.body)) out[3] = { heading: 'どう実行する', body: buildStoryLikeChapter4Body() };

  return out.map((s) => ({ ...s, body: cleanFinalStoryArtifacts(s.body) }));
}

/* =========================
 * 429/5xx 時のヒューリスティック最終ストーリー生成
 * =======================*/
/* =========================
 * 429/5xx 時のヒューリスティック最終ストーリー生成
 * =======================*/
function heuristicFinal(
  args: {
    industryJp: string;
    revenue?: unknown;
    employees?: unknown;
    mission?: unknown;
    vision?: unknown;
    value?: unknown;
    strength?: unknown;
    weakness?: unknown;
    opportunity?: unknown;
    threat?: unknown;
    finMini: {
      year?: number;
      sales?: number;
      opm?: number | null;
      rev_cagr?: number | null;
      trend?: Trend | null;
    } | null;
    patterns: string[];
    thought?: unknown;
    portfolio?: {
      businesses?: Array<{ name: string; revenueShare?: number; margin?: number; growth?: number }>;
      focus?: string;
    } | null;
  },
) {
  const {
    industryJp,
    revenue,
    employees,
    mission,
    vision,
    value,
    strength,
    weakness,
    opportunity,
    threat,
    finMini,
    patterns,
    thought,
    portfolio,
  } = args;

  const header = `業種=${industryJp || '—'}／売上=${revenue ? `${revenue}百万円` : '—'}／人数=${employees ? `${employees}人` : '—'}`;
  const finLine =
    finMini
      ? `（財務）最新年度=${finMini.year ?? '—'}／売上=${finMini.sales ?? '—'}／営業利益率=${finMini.opm ?? '—'}％／CAGR=${finMini.rev_cagr == null ? '—' : `${(finMini.rev_cagr as number).toFixed(1)}％`}／トレンド=${finMini.trend ?? '—'}`
      : '（財務）—';

  const pat = patterns.length ? `【勝ちパターン】${patterns.join(', ')}` : '【勝ちパターン】—';

  const portfolioLine = (() => {
    const pf = portfolio as any;
    if (!pf?.businesses?.length) return '';
    const focus = pf?.focus ? `／注力=${pf.focus}` : '';
    const list = (pf.businesses as any[])
      .slice(0, 6)
      .map((b) => b?.name)
      .filter(Boolean)
      .join('・');
    return `\n【事業ポートフォリオ】${list || '—'}${focus}`;
  })();

  const s1 = [
    header,
    `M=${sanitize(mission, 200) || '—'}／V=${sanitize(vision, 200) || '—'}／Val=${sanitize(value, 200) || '—'}`,
    `S=${sanitize(strength, 200) || '—'}／W=${sanitize(weakness, 200) || '—'}／O=${sanitize(opportunity, 200) || '—'}／T=${sanitize(threat, 200) || '—'}`,
    finLine,
    pat + portfolioLine,
  ].join('\n');

  void patterns;

  const s2 = buildStrategicChapter2Body({
    segmentsText: portfolio?.businesses?.map((b) => b.name).filter(Boolean).join('、') || '',
    portfolio: portfolio as NormalizedPortfolio | null,
  });

  const s3 = buildStoryLikeChapter3Body();
  const s4 = buildStoryLikeChapter4Body();

  let sections = [
    { heading: 'なぜ今', body: s1 },
    { heading: 'どう戦う', body: s2 },
    { heading: 'どんな未来', body: s3 },
    { heading: 'どう実行する', body: s4 },
  ];

  sections = ensureBridges(sections);
  sections = sections.map((s) => ({ ...s, body: cleanFinalStoryArtifacts(s.body) }));

  const longform = sections
    .map((s) => `【${s.heading}】\n${sanitize(normalizeNewlines(s.body), 4000)}`)
    .join('\n\n');

  const bodies = sections.map((s) => s.body);
  const finalStory = TITLE_TEMPLATES.map((title, i) => ({
    title,
    body: bodies[i] || '（この章は未生成です）',
  }));

  return { finalStory, longform, sections };
}

/* =========================
 * 二段階目：感情エディット（任意）
 * =======================*/
async function enhanceEmotionIfNeeded(
  sections: { heading: string; body: string }[],
  thought: unknown,
  patternsLine: string,
  temperature: number,
  model: string,
  enable: boolean,
): Promise<{ heading: string; body: string }[]> {
  if (!enable) return sections;

  try {
    const system = [
      'あなたは経営ストーリーのエディターです。構造を壊さずに、経営会議資料として読める具体性・一貫性・接続性を整えます。',
      '出力は JSON のみ。{"sections":[{"heading":"なぜ今","body":"..."},...]} の形式で返す。',
    ].join('\n');

    const user = [
      '【編集方針】',
      '- 誇り・覚悟・信念は、必要な場合のみ自然に残す。精神論や大げさな表現にしない。',
      '- 顧客・市場・強み・やること/やめることを、社員向けメッセージではなく経営判断の表現として整える。',
      '- 文量は各章2〜4段落、長すぎるときは圧縮。',
      '',
      `【勝ちパターン】${patternsLine || '—'}`,
      `【経営者の思い（断片）】${sanitize(thought, 600) || '—'}`,
      '',
      '【対象JSON】',
      JSON.stringify({ sections }).slice(0, 7000),
      '',
      '【出力形式（厳守）】',
      '{"sections":[{"heading":"なぜ今","body":"..."}]} のみ。',
    ].join('\n');

    const base: ChatCompletionCreateParamsNonStreaming = {
      model,
      temperature: Math.min(0.45, typeof temperature === 'number' ? temperature : 0.4),
      max_tokens: 1200,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      ...(SUPPORTS_JSON_MODE.test(model)
        ? { response_format: { type: 'json_object' as const } }
        : {}),
    };

    const r = await openai.chat.completions.create(base);
    const raw = r.choices?.[0]?.message?.content?.trim() || '';
    const parsed = extractJsonLoose<{ sections?: { heading?: string; body?: string }[] }>(raw);
    const enhanced = Array.isArray(parsed?.sections) ? parsed!.sections! : null;
    if (!enhanced || enhanced.length < 4) return sections;

    let fixed = coerceToSimpleHeads(enhanced);
    fixed = ensureBridges(fixed).map((s) => ({ ...s, body: cleanFinalStoryArtifacts(s.body) }));
    return fixed;
  } catch {
    return sections;
  }
}

async function repairExecutiveStoryIfNeeded(args: {
  sections: { heading: string; body: string }[];
  answersRich: string;
  model: string;
  timeoutMs?: number;
  maxTokens?: number;
  coverage: ReturnType<typeof evaluateStrategicIntentCoverage>;
  quality: ReturnType<typeof evaluateExecutiveStoryQuality>;
  mustKeepTerms?: string[];
  portfolioIntegrationGuide?: string;
}): Promise<{ heading: string; body: string }[]> {
  const shouldRepair =
    args.quality.tooShortIndexes.length > 0 ||
    args.quality.hasGenericWeaknessRisk ||
    args.coverage.missing.length >= 2 ||
    args.coverage.missingMustKeepTerms.length > 0 ||
    args.coverage.missingSpineTerms.length > 0;

  if (!shouldRepair) return args.sections;

  try {
    const system = [
      'あなたは中期経営計画の戦略ストーリーを、役員会議でそのまま議論できる水準に引き上げる経営戦略エディターです。',
      '出力はJSONのみ。{"sections":[{"heading":"なぜ今","body":"..."},...]} の形式で返す。',
      '既存の4章構成は維持し、各章を3〜5段落、最低700字、できれば900〜1200字程度の厚みで書き直す。',
      '特定の業種・市場・技術名を固定で追加しない。入力された12問回答に含まれる固有語だけを使い、その会社固有の戦略に引き上げる。',
    ].join('\n');

    const user = [
      '【補正理由】',
      `- 反映不足: ${args.coverage.missing.join('、') || 'なし'}`,
      `- 重要語の欠落: ${args.coverage.missingMustKeepTerms.join('、') || 'なし'}`,
      `- 戦略前半で弱い重要語: ${args.coverage.missingSpineTerms.join('、') || 'なし'}`,
      `- 短すぎる章index: ${args.quality.tooShortIndexes.join(', ') || 'なし'}`,
      `- 一般論に戻るリスク: ${args.quality.hasGenericWeaknessRisk ? 'あり' : 'なし'}`,
      '',
      '【必ず強化する観点】',
      '- 入力された危機認識を、放置した場合に失うものまで具体化する',
      '- 入力された市場・顧客・環境変化を、次の成長領域や重点顧客として整理する',
      '- 入力された自社の強みを、次の市場で選ばれる理由として再定義する',
      '- 入力された「やめること」「見直すこと」を、資源配分の判断基準として明確にする',
      '- 経営層がスローガンではなく、人・予算・投資・評価基準・KPIをどう変えるかを書く',
      '- 部門・現場が日々の業務で何を判断基準にすべきかを、入力回答に沿って具体化する',
      '- 重要語は企業固有の経営意思として扱い、同義の一般語へ丸めすぎない',
      '- 重要語を、単なる装飾語ではなく「何者へ転換するのか」を示す戦略の主語として使う',
      '- 複数事業がある場合、事業別方針の羅列ではなく、事業間の組み合わせによって生まれる統合価値を第2章・第3章に入れる',
      '- 第4章は意識改革ではなく、STAGE3/4/5へ接続する重点顧客、開発テーマ、投資回収KPI、撤退基準、経営会議で見る指標として書く',
      '- 上位の重要語は、結論相当の転換文または第2章の戦略選択で必ず使う',
      '',
      '【事業統合・成長シフト仮説】',
      args.portfolioIntegrationGuide || '—',
      '',
      '【重要語（入力から自動抽出。本文内で自然に保持する）】',
      (args.mustKeepTerms ?? []).length ? (args.mustKeepTerms ?? []).map((term) => `- ${term}`).join('\n') : '—',
      '',
      '【戦略の背骨（重要語をどう使うか）】',
      formatStrategicSpineForPrompt(args.mustKeepTerms ?? []),
      '',
      '【禁止】',
      '- 90日、90日間、90日アクションという表現は禁止',
      '- 入力にない業種・市場・技術・製品名を追加しない',
      '- 「新技術導入」「製品ラインナップ拡充」「生産プロセス最適化」「市場調査」「プロジェクトチームを編成」「ターゲット顧客を特定」を中心に書かない',
      '- 精神論、訓示調、一般論にしない',
      '',
      '【経営意思（12問回答）】',
      sanitize(args.answersRich, 12000) || '—',
      '',
      '【現在の生成結果JSON】',
      JSON.stringify({ sections: args.sections }).slice(0, 12000),
      '',
      '【出力形式】',
      '{"sections":[{"heading":"なぜ今","body":"..."}]} のみ。',
    ].join('\n');

    const raw = await callOpenAIChat({
      model: args.model,
      temperature: 0.35,
      max_tokens: args.maxTokens ?? 3600,
      timeoutMs: args.timeoutMs ?? 18_000,
      presence_penalty: 0.1,
      frequency_penalty: 0.1,
      system,
      user,
    });
    const parsed = extractJsonLoose<{ sections?: { heading?: string; body?: string }[] }>(raw);
    const repaired = Array.isArray(parsed?.sections) ? parsed!.sections! : null;
    if (!repaired || repaired.length < 4) return args.sections;

    return coerceToSimpleHeads(repaired).map((section) => ({
      ...section,
      body: cleanFinalStoryArtifacts(section.body),
    }));
  } catch {
    return args.sections;
  }
}

/* =========================
 * ルート
 * =======================*/
export async function POST(req: NextRequest) {
  const startedAt = Date.now();
  const elapsedMs = () => Date.now() - startedAt;
  const hasBudget = (reserveMs: number) => elapsedMs() < 88_000 - reserveMs;

  try {
    if (!process.env.OPENAI_API_KEY) {
      return new NextResponse(
        JSON.stringify({ error: 'OPENAI_API_KEY is missing' }),
        {
          status: 500,
          headers: { 'content-type': 'application/json; charset=utf-8' },
        },
      );
    }

    // Bearer token authentication
    const admin = getSupabaseAdmin();
    const userId = await getAuthUserIdFromBearer(admin, req);
    if (!userId) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }

    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

    // ★ strategyDataId を取得・必須チェック
    const requestedStrategyDataId = pickFirstText(
      body.strategyDataId,
      body.strategy_data_id,
      body.strategyId,
      body.strategy_id,
    );

    if (!requestedStrategyDataId) {
      return NextResponse.json(
        {
          error: 'missing_strategy_data_id',
          message: 'STAGE2 final story generation requires strategyDataId.',
        },
        { status: 400 }
      );
    }

    // ★ strategy_data.company_id を取得
    const { data: strategyRecord, error: strategyError } = await admin
      .from('strategy_data')
      .select('company_id')
      .eq('id', requestedStrategyDataId)
      .maybeSingle();

    if (strategyError || !strategyRecord || !strategyRecord.company_id) {
      return NextResponse.json(
        { error: 'strategy_data_not_found', message: 'strategyDataId does not exist' },
        { status: 404 }
      );
    }

    const strategyCompanyId = strategyRecord.company_id;

    // ★ strategyCompanyId を明示指定して membership を検証
    const membership = await requireMembership(admin, userId, strategyCompanyId);
    if (!membership) {
      return NextResponse.json({ error: 'not_a_member', message: 'User is not a member of this company' }, { status: 403 });
    }

    // ★ Role チェック: manager 以上のみ許可
    try {
      await assertMinRole(membership, 'manager');
    } catch {
      return NextResponse.json({ error: 'insufficient_role' }, { status: 403 });
    }

    const requestedCompanyId = strategyCompanyId;

    const mvv = asRecord(body.mvv);
    const swot = asRecord(body.swot);

    // 旧形式（トップレベル）と現行STAGE2画面形式（mvv/swot/companyTargets等）の両方を受け取る。
    const thought = body.thought ?? mvv.thought;
    const mission = body.mission ?? mvv.mission;
    const vision = body.vision ?? mvv.vision;
    const value = body.value ?? mvv.value;
    const industry = body.industry;
    const revenue = body.revenue;
    const employees = body.employees;
    const strength = body.strength ?? swot.strength;
    const weakness = body.weakness ?? swot.weakness;
    const opportunity = body.opportunity ?? swot.opportunity;
    const threat = body.threat ?? swot.threat;
    const csvFinanceData = body.csvFinanceData;
    const answers2 = body.answers2;
    const answers12 = body.answers12;
    const companyTargets = body.companyTargets ?? body.performanceGoals ?? body.targetMetrics ?? body.businessTargets;
    const northStar = body.northStar ?? body.northStarMetric ?? body.finalGoal;
    const storyDraft = body.storyDraft;
    const winPatternsCandidate = body.winPatternsCandidate;
    const selectedWinPatternId = body.selectedWinPatternId;
    const issueBlocks = body.issueBlocks;
    const metricsSummary = body.metricsSummary;
    const segments = body.segments;
    const businessSegments = body.businessSegments;
    const temperature = typeof body.temperature === 'number' ? Math.min(0.45, Math.max(0.25, body.temperature)) : 0.4;
    const budgets = body.budgets; // 互換のため残置
    const patterns = body.patterns; // string[] | WinningPatternKey[]
    const portfolio = body.portfolio; // 旧形式 { businesses: [...], focus?: string }
    const businessPortfolio = body.businessPortfolio; // 新形式 BusinessPortfolioItem[]（任意）
    const enhanceEmotion = body.enhanceEmotion; // true/false（未指定はtrue）

    const fin = buildFinanceSummary(csvFinanceData);
    const industryJp = safeGetIndustryLabel(
      typeof industry === 'string' ? industry : '',
      { full: true },
    );

    const finMini =
      fin != null
        ? {
            year: fin.latestYear,
            sales: fin.latestSales,
            opm: fin.latestOpMargin,
            rev_cagr: fin.revCagrPct,
            trend: fin.trend,
          }
        : null;

    const patternsArr: string[] = Array.isArray(patterns)
      ? (patterns as Array<string | WinningPatternKey>).map((p) => String(p))
      : [];
    const patternsLine = patternsArr.length ? patternsArr.join(', ') : '—';

    // 旧 portfolio / 新 businessPortfolio を統合して正規化
    const normalizedPortfolio = normalizePortfolioInput(portfolio, businessPortfolio);

    void budgets; // 未使用（互換のため残置）

    /* ---------- System ---------- */
    const systemPrompt = `
あなたは、経営者の考えを「経営会議資料・中期経営計画資料に掲載できる戦略ストーリー」に整える編集者です。
目的は、演説やスローガンではなく、会社がなぜ変わり、どこで勝ち、どのような顧客価値を実現し、どう部門戦略・KPI・実行管理へ落とすのかを明確に伝えることです。

【最優先】
- 本文は、経営層・部門長・現場管理職が同じ判断基準を持つための戦略文書として書く。
- 各章は、状況 → 解釈 → 戦略上の意味 → 経営判断 → 次工程への接続、の流れで、経営層が読み応えを感じる3〜5段落の戦略本文にする。
- 各章の本文は最低700字、できれば900〜1200字程度を目安にする。短い要約、1段落だけの本文、抽象的なスローガンで終わらせない。
- 各章には、必ず「なぜその判断が必要か」「何を選び、何を見直すか」「部門や社員の判断基準がどう変わるか」を含める。
- 12問回答は、経営層が何を危機と見て、何を選び、何をやめ、どのように会社を変えたいかを示す最優先の経営意思である。
- たたき台、SWOT、MVV、CEO意図、財務情報は補助素材である。12問回答と補助素材がずれる場合は、12問回答の危機認識・重点市場・価値提供・資源配分・やめることを優先する。
- ただし、12問回答の文言をそのまま貼り付けるのではなく、経営会議資料に載せられる戦略本文として再構成する。
- 第2章は、勝ち筋・重点事業・重点市場・資源配分・やめること・STAGE3/4接続に限定する。
- 最終ストーリーの芯は、個別事業の方針整理ではなく、既存事業に分散する強みをどの成長市場・顧客価値へ統合するかである。
- 事業ポートフォリオが複数ある場合、各事業を単独で並べるだけで終わらせず、事業間の組み合わせによって生まれる統合価値を必ず書く。
- 「改善力がない」「実行力がない」と断定しない。入力上、実行管理・改善力がある企業では、課題を「成長市場への事業化・統合価値化・資源配分の不足」として表現する。
- 入力にない業種・市場・技術・製品名を追加しない。固有語は12問回答、経営意思ダイジェスト、事業ポートフォリオ、SWOT、業績目標に含まれるものだけを使う。
- 特定市場への依存、特定技術への転換など、入力にない前提を作らない。
- 人材、採用、育成、能力開発、社員教育、研修、モチベーション、職場環境を主要戦略として書かない。
- 90日アクション、分析メモ、箇条書き素材、内部IDは本文に出さない。

【第2章の厳守事項】
- 「自社の勝ち筋：」というラベルは使わない。
- 「1. 圧倒的な」「2. 高い研究」など、入力素材の見出しを本文に出さない。
- 「根拠（SWOT）」「90日アクション」「トレードオフ」「強み(S)」「弱み(W)」「機会(O)」「脅威(T)」を本文に出さない。
- 事業名は重複させない。
- 入力された強み、顧客課題、重点市場、資源配分、投資基準を軸に、経営判断の流れが分かる4〜5段落で書く。
- 第2章には、入力された自社の強みを、次の市場で選ばれる理由としてどう再定義するかを必ず入れる。
- 第2章には、入力された顧客価値に対して、提供価値・商品サービス・営業開発・オペレーションをどう進化させるかを必ず入れる。

【成長シフト型ストーリーの厳守事項】
- 最終ストーリーは「事業別方針の整理」ではなく、「どの既存能力を束ね、どの成長市場・顧客価値へ転換するか」を示す成長シフト仮説として書く。
- 第1章では、赤字危機だけでなく、売上成長の停滞、主力事業依存、成長テーマの事業化不足、次世代顧客の設計初期段階に入り込めないリスクを扱う。
- 第2章では、複数事業を別々に改善するのではなく、入力された各事業・技術・顧客接点の強みを組み合わせて提供価値を高める方向を必ず書く。
- 第3章では「顧客から選ばれる専門企業」などの一般表現で終わらせず、入力された顧客・用途の現場で、どの課題を任される企業になるのかを書く。
- 第4章では、意識改革や本気度の表明ではなく、STAGE3/4/5に接続する重点顧客、開発テーマ、投資回収KPI、撤退基準、経営会議で見る指標を書けるようにする。

【12問回答の扱い】
- 12問回答は、危機感、重点市場、重点顧客、強み、価値提供、やめること、資源配分、KPI、進捗管理論点として必ず本文に反映する。
- 各章のKey Message相当の結論は、12問回答の意味から導く。一般的な中計表現や業界一般論で置き換えない。
- 重点市場・技術・顧客価値・やめること・経営行動・社員行動に関する固有表現は、抽象化しすぎず残す。
- 入力から抽出された重要語は、特定企業向けの固定語ではなく、そのユーザーが強調した経営意思である。本文内で自然に保持し、一般語へ丸めすぎない。
- 重要語を無理に連呼しない。ただし上位の重要語は、結論相当の転換文または第2章の戦略選択で必ず使う。
- 重要語は単に本文中に登場させるだけでは不十分である。重要語を使って「既存の何から、どの顧客価値・市場・用途・技術領域へ転換するのか」を明確にする。
- 第1章または第2章の早い段落で、入力回答に基づく転換の一文を必ず書く。例示ではなく、当該企業の戦略の主語として書く。
- 質問文、回答者の口調、「第1問」などの表現は本文に出さない。

【12問から抽出すべき経営意思】
- 危機の本質は、12問回答に書かれた顧客・業界・競争・技術・社会変化から導く。
- 失うものは、売上だけでなく、12問回答に書かれた顧客接点、利益率、主導権、人材、ブランド、資本効率、成長機会などから具体化する。
- 市場変化は、入力された市場・顧客・用途・技術・規制・競争環境に基づいて書く。
- 重点領域は、入力された重点市場・重点顧客・重点用途・重点商品サービスに限定する。
- 顧客価値は、入力された「顧客が本当に求める価値」と「自社を選ぶ理由」から再構成する。
- 自社の強みは、入力された技術、顧客基盤、業務知見、ブランド、データ、オペレーション、組織能力などを、次の市場で選ばれる理由として再定義する。
- 克服すべき課題は、入力された致命的な課題、壁、抵抗、事業ポートフォリオ上の曖昧さから具体化する。
- やめることは、入力された低採算案件、将来性の薄い活動、顧客価値につながらない仕事、横並び投資、過去延長のKPIなどから整理する。
- 経営層が示すべき本気度は、スローガンではなく、重点領域の明示、人・予算・投資・評価基準・KPIの変更として書く。
- 社員に求める行動変化は、入力された「明日から変えてほしい行動」をもとに具体化する。

【禁止する文体・表現】
- 「私たち」「我々」「皆さん」「あなたたち」「一緒に」「挑戦」「努力」「誇り」「覚悟」「邁進」「全社一丸」「夢」「しましょう」などの社員向け・訓示調表現は使わない。
- 「私たち」「我々」の代わりに「当社」で統一する。
- 「入力値」「基準値」「論点ID」「issue-」「関連論点=」「目標値=」「目標年=」「North Star未入力」などの内部表現は使わない。
- 「90日」「90日間」「90日アクション」「最初の90日間」は使わない。
- 「新技術の導入」「製品ラインナップの拡充」「生産プロセスの最適化」「市場調査」「プロジェクトチームを編成」「ターゲット顧客を特定」などの汎用施策を中心に書かない。必要な場合も、戦略の中心ではなく実行手段として短く扱う。
- 精神論や情緒的な締めくくりで章を終わらせない。必ず経営判断、資源配分の変化、実行への接続を書く。
- 「顧客から選ばれる専門企業」「持続可能な成長を実現する」「高品質かつ競争力のある製品」「社員に本気度を示す」「意識改革を進める」は、具体的な市場・顧客・技術・KPI・提供価値が伴わない限り使わない。

【章ごとの役割】
1. なぜ今：入力された顧客・業界・競争・技術・社会変化をもとに、現在の延長では何が危ういのかを書く。失うものは売上だけでなく、12問回答に基づく成長機会、顧客関係、利益率、主導権、組織能力などとして明確にする。
2. どう戦う：入力された自社の強みを、次の市場で選ばれる理由として再定義する。重点領域に経営資源を寄せ、見直す領域を選別する。既存事業を「成長領域・収益改善・技術基盤・選別」などの役割に分け、各分類の意味を明確にする。
3. どんな未来：入力された顧客価値を起点に、顧客が何を理由に当社を選ぶのかを書く。業績面では、12問回答や業績目標に含まれる利益率、成長領域比率、重点開発案件数、量産移行率、重点顧客比率などの指標に結びつける。入力にない指標は無理に作らない。
4. どう実行する：STAGE3で事業別・部門別の役割を定義し、STAGE4で投資基準・KPI・実行計画に落とし込み、STAGE5で実行管理サイクルを回すことを書く。経営層は、入力された重点領域を明示し、人・予算・投資・評価基準・KPIを変える。社員には、12問回答に書かれた日々の判断基準を具体化する。経営会議や部門レビューを通じて進捗を継続的に確認し、戦略と実行のズレを修正する仕組みを明記する。

【文章の深さ】
- 経営者が「この会社のための戦略だ」と感じる具体性を優先する。
- 各章は、単なる施策列挙ではなく、経営判断の背景、選択の痛み、資源配分の変化、現場行動への影響まで書く。
- 既存市場を否定するだけでなく、既存事業を「稼ぐ事業」「技術基盤」「選別対象」に分け、未来市場への橋渡しとして扱う。
- 最終本文は、経営会議でそのまま読み上げられる水準の密度にする。

【出力】
JSONのみ。スキーマ：
{
  "sections":[
    {"heading":"なぜ今","body":"..."},
    {"heading":"どう戦う","body":"..."},
    {"heading":"どんな未来","body":"..."},
    {"heading":"どう実行する","body":"..."}
  ]
}
`.trim();

    /* ---------- User（素材） ---------- */
    // ★ prompt.txt指示：strategicIntentDigest を12問回答から抽出（最優先素材として渡す）
    const strategicIntentDigest = extractStrategicIntentDigest(answers12);

    const answersRichFromAnswers2 = buildAnswersRich(
      Array.isArray(answers2) ? (answers2 as ChapterAnswers[]) : []
    );
    const answersRichFromAnswers12 = formatAnswers12(answers12);
    const answersRich = [
      answersRichFromAnswers2,
      answersRichFromAnswers12 !== '—' ? answersRichFromAnswers12 : '',
    ]
      .filter(Boolean)
      .join('\n');
    const mustKeepTerms = extractMustKeepTerms(answers12);
    const strategicSpineText = formatStrategicSpineForPrompt(mustKeepTerms);

    const companyTargetsText = formatCompanyTargets(companyTargets);
    const selectedWinPatternText = formatSelectedWinPattern(winPatternsCandidate, selectedWinPatternId);
    const storyDraftText = compactStrategicDraftForPrompt(storyDraft);
    const issueBlocksText = stripPeopleRelatedNoise(formatGenericList('STAGE1論点', issueBlocks));
    const metricsSummaryText = stripPeopleRelatedNoise(formatUnknownForPrompt(metricsSummary, 2200));
    const segmentsText = [
      ...asArray(segments).map((x) => asText(x, 80)).filter(Boolean),
      ...asArray<Record<string, unknown>>(businessSegments).map((x) => pickFirstText(x.name, x.title, x.segmentName)).filter(Boolean),
    ]
      .slice(0, 12)
      .join('、') || '—';

    const portfolioSummary = (() => {
      const p = normalizedPortfolio as any;
      if (!p?.businesses?.length) return '—';
      const list = (p.businesses as any[])
        .slice(0, 8)
        .map((b) => {
          const name = b?.name ?? '（名称未設定の事業）';
          const bits: string[] = [];
          if (typeof b?.revenueShare === 'number')
            bits.push(`売上比${b.revenueShare}%`);
          if (typeof b?.growth === 'number')
            bits.push(`成長${b.growth}%`);
          if (typeof b?.margin === 'number')
            bits.push(`利益率${b.margin}%`);
          return bits.length ? `${name}（${bits.join(' / ')}）` : name;
        })
        .filter(Boolean)
        .join('・');
      const focus = p?.focus ? `（注力=${p.focus}）` : '';
      return list ? `${list}${focus}` : '—';
    })();

    const portfolioIntegrationGuide = buildPortfolioIntegrationGuide({
      portfolio: normalizedPortfolio,
      segmentsText,
      businessSegments,
      mustKeepTerms,
    });

    const userPrompt = `
【会社】業種=${industryJp || (typeof industry === 'string' ? industry : '—')}／売上=${revenue ? `${revenue}百万円` : '—'}／人数=${employees ? `${employees}人` : '—'}
【MVV】M=${sanitize(mission, 300) || '—'}／V=${sanitize(vision, 300) || '—'}／Val=${sanitize(value, 300) || '—'}
【North Star】${sanitize(northStar, 500) || '—'}
【SWOT】S=${sanitize(strength, 400) || '—'}／W=${sanitize(weakness, 400) || '—'}／O=${sanitize(opportunity, 400) || '—'}／T=${sanitize(threat, 400) || '—'}
【事業・セグメント】${segmentsText}
【勝ちパターン】${patternsLine}
【選択された勝ち筋候補】
${selectedWinPatternText}
【事業ポートフォリオ】${portfolioSummary}
【事業統合・成長シフト仮説】
${portfolioIntegrationGuide}
【業績目標（最優先。年度・数値・単位を改変禁止）】
${companyTargetsText}
【経営者の思い(断片)】${sanitize(thought, 1000) || '—'}

【fin_json】
${JSON.stringify(finMini)}

【metricsSummary】
${metricsSummaryText}

【STAGE1論点】
${issueBlocksText}

【たたき台ストーリー】
${storyDraftText}

【経営意思ダイジェスト（12問回答から抽出：最優先）】
${strategicIntentDigest ? JSON.stringify(strategicIntentDigest, null, 2) : '—'}

【重要語（12問回答から自動抽出：一般語に丸めず保持）】
${mustKeepTerms.length ? mustKeepTerms.map((term) => `- ${term}`).join('\n') : '—'}

【戦略の背骨（重要語をどう使うか）】
${strategicSpineText}

【経営意思（12問回答：最優先で反映する質問＋回答）】
${stripPeopleRelatedNoise(answersRich) || '—'}

【出力仕様】上記の制約・形式を厳守。`.trim();

    /* ---------- OpenAI 呼び出し or ヒューリスティック ---------- */
    let raw = '';
    let usedModel = AI_MODELS.reasoning;
    let usedHeuristic = false;

    // ★ ログ記録（データ混入デバッグ用）
    console.log('[stage2/generate-final] OpenAI call info', {
      requestId: req.headers.get('x-request-id') || 'unknown',
      userId: userId?.slice(0, 8),
      companyId: requestedCompanyId?.slice(0, 8),
      strategyDataId: requestedStrategyDataId?.slice(0, 8),
      answers2Count: Array.isArray(answers2) ? answers2.length : 0,
      answers12Count: Array.isArray(answers12) ? answers12.length : 0,
      answersRichLength: answersRich.length,
      mustKeepTermsCount: mustKeepTerms.length,
      portfolioIntegrationGuideLength: portfolioIntegrationGuide.length,
      hasStoryDraft: !!storyDraft,
      hasFinanceData: !!fin,
      suspiciousKeywordFlags: checkSuspiciousKeywords(userPrompt),
      promptLength: userPrompt.length,
    });

    // 【入力充足度ログ】OpenAI呼び出し直前に観測ログを出力
    const requestId = req.headers.get('x-request-id') || `req_${Date.now()}`;
    const hasCompanyInfo = !!(mission || vision || value);
    const hasStage1Context = !!(northStar || mission);
    const hasStage2Answers =
      (Array.isArray(answers2) && answers2.length > 0) ||
      (Array.isArray(answers12) && answers12.length > 0);
    const hasStage2Story = !!storyDraft;

    // ★ STAGE2では部門情報は必須ではないため、businessSegments から判定
    const hasStage3Context = Array.isArray(businessSegments) && businessSegments.length > 0;
    const hasStage4Context = (normalizedPortfolio?.businesses?.length ?? 0) > 0;

    // meaningfulInputScore（0-100）：データ充足度を簡易スコア化
    const inputFlags = [hasCompanyInfo, hasStage1Context, hasStage2Answers, hasStage2Story, hasStage3Context, hasStage4Context];
    const meaningfulInputScore = Math.round((inputFlags.filter(Boolean).length / inputFlags.length) * 100);

    const suspiciousKeywords = checkSuspiciousKeywords(userPrompt);

    logInputGuard({
      requestId,
      apiName: 'stage2/generate-final',
      companyId: requestedCompanyId,
      strategyId: requestedStrategyDataId,
      meaningfulInputScore,
      hasCompanyInfo,
      hasStage1Context,
      hasStage2Answers,
      hasStage2Story,
      hasStage3Context,
      hasStage4Context,
      promptLength: userPrompt.length,
      suspiciousKeywordFlags: suspiciousKeywords,
    });

    try {
      if (process.env.NODE_ENV === 'development' || process.env.DEBUG_AI_MODELS === '1') {
        console.log(`[AI] stage2-final-strategy → ${AI_MODELS.reasoning}`);
      }
      raw = await callOpenAIChat({
        model: AI_MODELS.reasoning,
        temperature:
          typeof temperature === 'number' && Number.isFinite(temperature)
            ? (temperature as number)
            : 0.4,
        max_tokens: 5200,
        timeoutMs: 52_000,
        presence_penalty: 0.2,
        frequency_penalty: 0.2,
        system: systemPrompt,
        user: userPrompt,
      });

      // ★ 診断：Luna raw response の確認
      console.log('[stage2-final] ★LUNA RAW RESPONSE DIAGNOSTIC★', {
        rawLength: raw?.length ?? 0,
      });
    } catch (_detail: any) {
      // ★ 診断：なぜ heuristic fallback に落ちたか
      console.error('[stage2-final] ★OPENAI CALL FAILED - FALLBACK TO HEURISTIC★', {
        errorName: _detail?.name,
        errorMessage: _detail?.message || String(_detail),
        errorStatus: _detail?.status,
        errorCode: _detail?.code,
      });
      usedHeuristic = true;
      usedModel = 'heuristic-fallback';
    }

    let finalStory, longform, sections: { heading: string; body: string }[];

    if (!usedHeuristic && raw) {
      type GenOut = { sections?: Array<{ heading?: string; body?: string }> };
      const parsed = extractJsonLoose<GenOut>(raw);

      // ★ 診断：parse後の sections を確認
      console.log('[stage2-final] ★PARSED SECTIONS DIAGNOSTIC★', {
        hasSections: Array.isArray(parsed?.sections),
        sectionsCount: Array.isArray(parsed?.sections) ? parsed.sections.length : 0,
        section0_heading: parsed?.sections?.[0]?.heading?.slice(0, 50) ?? 'null',
        section0_bodyStart: parsed?.sections?.[0]?.body?.slice(0, 150) ?? 'null',
      });

      sections =
        Array.isArray(parsed?.sections) && parsed!.sections!.length >= 4
          ? coerceToSimpleHeads(parsed!.sections!)
          : coerceToSimpleHeads(parsed?.sections || []);

      // 二段階目のエモーショナル補正は、熱量過多・ラベル混入を避けるため既定OFF。
      const doEnhance = enhanceEmotion === true;
      if (doEnhance && (process.env.NODE_ENV === 'development' || process.env.DEBUG_AI_MODELS === '1')) {
        console.log(`[AI] stage2-emotion-edit → ${AI_MODELS.lightweight}`);
      }
      sections = await enhanceEmotionIfNeeded(
        sections,
        thought,
        patternsLine,
        typeof temperature === 'number' ? Math.min(0.45, Math.max(0.25, temperature)) : 0.4,
        AI_MODELS.lightweight,
        doEnhance,
      );

      console.log('[stage2-final] ★AFTER ENHANCE EMOTION★', {
        sectionsCount: sections?.length ?? 0,
      });

      sections = ensureBridges(sections);
      sections = sections.map((s) => ({ ...s, body: cleanFinalStoryArtifacts(s.body) }));

      console.log('[stage2-final] ★BEFORE NORMALIZE STRATEGIC★', {
        sectionsCount: sections?.length ?? 0,
      });

      sections = normalizeStrategicStorySections(sections, {
        segmentsText,
        portfolio: normalizedPortfolio,
        companyTargetsText,
        answersText: answersRich,
      });

      console.log('[stage2-final] ★AFTER NORMALIZE STRATEGIC★', {
        sectionsCount: sections?.length ?? 0,
      });

      longform = sections
        .map((s) => `【${s.heading}】\n${sanitize(normalizeNewlines(s.body), 4000)}`)
        .join('\n\n');

      const bodies = sections.map((s) => s.body);
      finalStory = TITLE_TEMPLATES.map((title, i) => ({
        title,
        body: bodies[i] || '（この章は未生成です）',
      }));
    } else {
      console.log('[stage2-final] ★USING HEURISTIC FINAL (NO OPENAI)★', {
        usedHeuristic,
        rawLength: raw?.length ?? 0,
        reason: usedHeuristic ? 'openai-error' : 'raw-empty',
      });
      const h = heuristicFinal({
        industryJp,
        revenue,
        employees,
        mission,
        vision,
        value,
        strength,
        weakness,
        opportunity,
        threat,
        finMini,
        patterns: patternsArr,
        thought,
        portfolio: (normalizedPortfolio as any) ?? null,
      });
      finalStory = h.finalStory;
      longform = h.longform;
      sections = h.sections;
      console.log('[stage2-final] ★HEURISTIC FINAL OUTPUT★', {
        finalStoryCount: finalStory?.length ?? 0,
      });
    }

    // 最終品質ガード：内部メモ・誤生成・不自然表現を本文から除去
    sections = sections.map((s) => ({ ...s, body: cleanFinalStoryArtifacts(s.body) }));
    sections = normalizeStrategicStorySections(sections, {
      segmentsText,
      portfolio: normalizedPortfolio,
      companyTargetsText,
      answersText: answersRich,
    });
    sections = sections.map((s) => ({ ...s, body: cleanFinalStoryArtifacts(s.body) }));
    longform = sections
      .map((s) => `【${s.heading}】\n${sanitize(normalizeNewlines(s.body), 4000)}`)
      .join('\n\n');
    finalStory = TITLE_TEMPLATES.map((title, i) => ({
      title,
      body: sections[i]?.body || '（この章は未生成です）',
    }));

    let strategicIntentCoverage = evaluateStrategicIntentCoverage(longform, mustKeepTerms);
    let executiveStoryQuality = evaluateExecutiveStoryQuality(sections);

    // ★ prompt.txt指示：生成後チェック（bad tone, typo）
    const badToneCheck = containsBadTone(longform);
    const typoCheck = containsTypo(longform);
    if (badToneCheck.hasBadTone || typoCheck.hasTypo) {
      console.warn('[stage2/generate-final] ⚠️ Quality check failed (bad tone/typo):', {
        requestId,
        badTone: badToneCheck.found.length > 0 ? badToneCheck.found : null,
        typo: typoCheck.found.length > 0 ? typoCheck.found : null,
      });
    }

    if (!usedHeuristic && hasBudget(22_000)) {
      if (process.env.NODE_ENV === 'development' || process.env.DEBUG_AI_MODELS === '1') {
        console.log(`[AI] stage2-repair → ${AI_MODELS.reasoning}`);
      }
      const repairedSections = await repairExecutiveStoryIfNeeded({
        sections,
        answersRich,
        model: AI_MODELS.reasoning,
        timeoutMs: 18_000,
        maxTokens: 3600,
        coverage: strategicIntentCoverage,
        quality: executiveStoryQuality,
        mustKeepTerms,
        portfolioIntegrationGuide,
      });
      if (repairedSections !== sections) {
        sections = repairedSections.map((s) => ({ ...s, body: cleanFinalStoryArtifacts(s.body) }));
        sections = normalizeStrategicStorySections(sections, {
          segmentsText,
          portfolio: normalizedPortfolio,
          companyTargetsText,
          answersText: answersRich,
        });
        sections = sections.map((s) => ({ ...s, body: cleanFinalStoryArtifacts(s.body) }));
        longform = sections
          .map((s) => `【${s.heading}】\n${sanitize(normalizeNewlines(s.body), 4000)}`)
          .join('\n\n');
        finalStory = TITLE_TEMPLATES.map((title, i) => ({
          title,
          body: sections[i]?.body || '（この章は未生成です）',
        }));
        strategicIntentCoverage = evaluateStrategicIntentCoverage(longform, mustKeepTerms);
        executiveStoryQuality = evaluateExecutiveStoryQuality(sections);
      }
    } else if (!usedHeuristic) {
      console.warn('[stage2/generate-final] repair skipped due to time budget:', {
        requestId,
        elapsedMs: elapsedMs(),
      });
    }

    if (
      strategicIntentCoverage.missing.length > 0 ||
      strategicIntentCoverage.missingMustKeepTerms.length > 0 ||
      strategicIntentCoverage.missingSpineTerms.length > 0
    ) {
      console.warn('[stage2/generate-final] strategic intent coverage missing:', {
        requestId,
        companyId: requestedCompanyId?.slice(0, 8),
        strategyDataId: requestedStrategyDataId?.slice(0, 8),
        covered: strategicIntentCoverage.covered,
        total: strategicIntentCoverage.total,
        missing: strategicIntentCoverage.missing,
        missingMustKeepTerms: strategicIntentCoverage.missingMustKeepTerms,
        missingSpineTerms: strategicIntentCoverage.missingSpineTerms,
      });
    }
    if (
      executiveStoryQuality.tooShortIndexes.length > 0 ||
      executiveStoryQuality.hasGenericWeaknessRisk
    ) {
      console.warn('[stage2/generate-final] executive story quality warning:', {
        requestId,
        companyId: requestedCompanyId?.slice(0, 8),
        strategyDataId: requestedStrategyDataId?.slice(0, 8),
        ...executiveStoryQuality,
      });
    }

    /* ---------- ★STEP6: 中計設計（midtermStrategy）の第2パス生成 ----------
     * - 既存の4章ストーリー生成には一切手を入れない（プロンプト・トークン配分とも独立）
     * - この呼び出しが失敗/タイムアウトしても catch で握り、midtermStrategy なしで
     *   従来どおりのレスポンスを返す（既存STAGE2生成を壊さない）
     * - ヒューリスティックフォールバック時はスキップ（素材の信頼度が低いため） */
    let midtermStrategy: Record<string, unknown> | undefined;
    if (!usedHeuristic && hasBudget(16_000)) {
      try {
        const midtermSystem = [
          'あなたは中期経営計画の設計を支援する経営戦略コンサルタントです。',
          '確定済みの全社戦略ストーリーと入力情報をもとに、中計全体の設計サマリーをJSONのみで返します。',
          '12問回答は経営層の意思を示す最優先入力です。確定済みストーリーと12問回答に差がある場合は、12問回答の危機認識、重点市場、価値提供、資源配分、やめることを優先して中計設計に反映してください。',
          '入力にない数値・固有名詞は作らない。根拠が不足する項目はキーごと省略する（空文字・空配列は出力しない）。',
          '出力スキーマ（すべて任意キー）：',
          '{',
          '  "midtermConcept": "中計の基本コンセプト（1〜2文）",',
          '  "targetVisionForMidterm": "全社の目指す姿（1〜2文）",',
          '  "priorityStrategicThemes": ["重点戦略テーマ（2〜4個）"],',
          '  "growthStrategy": "成長戦略（1〜2文）",',
          '  "profitImprovementStrategy": "収益改善戦略（1〜2文）",',
          '  "portfolioPolicy": "事業ポートフォリオ方針（1〜2文）",',
          '  "companyWideDecisionCriteria": ["全社共通の判断基準（2〜4個）"],',
          '  "deploymentPrinciplesForUnits": ["事業・部門へ展開する際の基本軸（2〜4個）"],',
          '  "managementMeetingIssues": ["経営会議で確認すべき論点（2〜4個）"],',
          '  "strategicCore": {',
          '    "primaryShift": "既存の何から、どの方向へ転換するのか（1文）",',
          '    "concreteDomains": ["入力に出てきた重点市場・用途・顧客領域・技術領域（3〜8個）"],',
          '    "customerValue": "顧客が選ぶ理由・提供価値（1文）",',
          '    "coreCapabilities": ["戦略実現の源泉となる強み・能力（3〜8個）"],',
          '    "portfolioShift": "経営資源や事業ポートフォリオをどう移すか（1文）",',
          '    "behaviorChange": "社員・部門に求める行動変化（1文）",',
          '    "nonNegotiableThemes": ["STAGE3以降で一般語に丸めず保持するテーマ（3〜8個）"]',
          '  }',
          '}',
          'strategicCore は、12問回答・SWOT・確定済みストーリーに実際に含まれる具体語だけで作ること。',
          '「成長領域」「新市場」「高付加価値」などの抽象語だけに丸めず、入力にある市場名・用途名・技術名・顧客価値を保持すること。',
          '重要語が提示されている場合は、そのユーザーが強調した経営意思として strategicCore.nonNegotiableThemes に自然な形で保持すること。',
          'midtermConcept と strategicCore.primaryShift では、重要語を使って「既存の何から、どの顧客価値・市場・用途・技術領域へ転換するのか」を1文で明確にすること。',
          '上位の重要語が提示されている場合、少なくとも1語は midtermConcept または strategicCore.primaryShift に含めること。',
          'priorityStrategicThemes は「新技術の導入」「生産効率向上」などの汎用施策で終わらせず、入力にある重点市場・用途・顧客価値・中核能力に接続すること。',
          '事業ポートフォリオが複数ある場合、事業別方針を並べるだけでなく、各事業の技術・顧客接点・開発/生産能力をどう組み合わせて統合価値を作るかを portfolioPolicy または strategicCore.portfolioShift に必ず含めること。',
          '第4章へ接続する中計設計では、意識改革ではなく、重点顧客、開発テーマ、投資回収KPI、撤退基準、経営会議で見る指標へ落とし込める表現にすること。',
          'ただし、入力にない固有市場名・技術名・製品名は絶対に追加しないこと。',
        ].join('\n');

        const midtermUser = [
          '【確定済み全社戦略ストーリー】',
          sanitize(longform, 4000) || '—',
          '',
          `【業績目標】\n${companyTargetsText}`,
          `【事業ポートフォリオ】${portfolioSummary}`,
          `【事業統合・成長シフト仮説】\n${portfolioIntegrationGuide}`,
          `【勝ちパターン】${patternsLine}`,
          `【SWOT】S=${sanitize(strength, 300) || '—'}／W=${sanitize(weakness, 300) || '—'}／O=${sanitize(opportunity, 300) || '—'}／T=${sanitize(threat, 300) || '—'}`,
          `【事業・セグメント】${segmentsText}`,
          '',
          '【重要語（12問回答から自動抽出：一般語に丸めず保持）】',
          mustKeepTerms.length ? mustKeepTerms.map((term) => `- ${term}`).join('\n') : '—',
          '',
          '【戦略の背骨（重要語をどう使うか）】',
          strategicSpineText,
          '',
          '【経営意思（12問回答：最優先）】',
          sanitize(stripPeopleRelatedNoise(answersRich), 6000) || '—',
          '',
          '上記と矛盾しない範囲で、スキーマどおりのJSONのみを返してください。',
        ].join('\n');

        if (process.env.NODE_ENV === 'development' || process.env.DEBUG_AI_MODELS === '1') {
          console.log(`[AI] stage2-midterm-design → ${AI_MODELS.reasoning}`);
        }
        const midtermRaw = await callOpenAIChat({
          model: AI_MODELS.reasoning,
          temperature: 0.4,
          max_tokens: 1100,
          timeoutMs: 12_000,
          system: midtermSystem,
          user: midtermUser,
        });

        const parsedMid = extractJsonLoose<Record<string, any>>(midtermRaw);
        if (parsedMid && typeof parsedMid === 'object' && !Array.isArray(parsedMid)) {
          const str = (v: unknown) => (typeof v === 'string' && v.trim() ? sanitize(v, 400) : undefined);
          const mergeTerms = (base: string[] | undefined, terms: string[], max: number) => {
            const merged: string[] = [];
            for (const item of [...(base ?? []), ...terms]) {
              const cleaned = cleanMustKeepTerm(item);
              const key = normalizeTermForKey(cleaned);
              if (!cleaned || merged.some((v) => normalizeTermForKey(v) === key)) continue;
              merged.push(sanitize(cleaned, 200));
              if (merged.length >= max) break;
            }
            return merged.length > 0 ? merged : undefined;
          };
          const strArr = (v: unknown, max: number) => {
            const arr = Array.isArray(v)
              ? v.filter((x) => typeof x === 'string' && x.trim()).slice(0, max).map((x) => sanitize(x, 200))
              : [];
            return arr.length > 0 ? arr : undefined;
          };
          const strategicCoreCandidate =
            parsedMid.strategicCore && typeof parsedMid.strategicCore === 'object' && !Array.isArray(parsedMid.strategicCore)
              ? Object.fromEntries(
                  Object.entries({
                    primaryShift: str(parsedMid.strategicCore.primaryShift),
                    concreteDomains: strArr(parsedMid.strategicCore.concreteDomains, 8),
                    customerValue: str(parsedMid.strategicCore.customerValue),
                    coreCapabilities: strArr(parsedMid.strategicCore.coreCapabilities, 8),
                    portfolioShift: str(parsedMid.strategicCore.portfolioShift),
                    behaviorChange: str(parsedMid.strategicCore.behaviorChange),
                    nonNegotiableThemes: mergeTerms(strArr(parsedMid.strategicCore.nonNegotiableThemes, 8), mustKeepTerms, 8),
                  }).filter(([, v]) => v !== undefined),
                )
              : undefined;

          const candidate = {
            midtermConcept: str(parsedMid.midtermConcept),
            targetVisionForMidterm: str(parsedMid.targetVisionForMidterm),
            priorityStrategicThemes: strArr(parsedMid.priorityStrategicThemes, 4),
            growthStrategy: str(parsedMid.growthStrategy),
            profitImprovementStrategy: str(parsedMid.profitImprovementStrategy),
            portfolioPolicy: str(parsedMid.portfolioPolicy),
            companyWideDecisionCriteria: strArr(parsedMid.companyWideDecisionCriteria, 4),
            deploymentPrinciplesForUnits: strArr(parsedMid.deploymentPrinciplesForUnits, 4),
            managementMeetingIssues: strArr(parsedMid.managementMeetingIssues, 4),
            strategicCore:
              strategicCoreCandidate && Object.keys(strategicCoreCandidate).length > 0
                ? strategicCoreCandidate
                : undefined,
          };
          const compact = Object.fromEntries(
            Object.entries(candidate).filter(([, v]) => v !== undefined),
          );
          if (Object.keys(compact).length > 0) midtermStrategy = compact;
        }
      } catch (e: any) {
        console.warn('⚠️ 中計設計（midtermStrategy）の生成をスキップ（続行）:', e?.message || e);
      }
    } else if (!usedHeuristic) {
      console.warn('[stage2/generate-final] midtermStrategy skipped due to time budget:', {
        requestId,
        elapsedMs: elapsedMs(),
      });
    }

    // ★ CRITICAL FIX: リロード復元元である strategy_data.final_story_draft にも必ず保存する。
    // これが入らないと、生成直後は画面stateに表示されても、リロード時に古い story が復活する。
    // 保存後に select で再取得し、更新0件・保存失敗をログで検出できるようにする。
    if (requestedCompanyId && requestedStrategyDataId) {
      try {
        const finalStoryDraftPayload = safeSerialize(finalStory);
        const updatePayload = {
          final_story_draft: finalStoryDraftPayload,
          updated_at: new Date().toISOString(),
        };

        // ★ strategyDataId + companyId の両方で絞る
        const { data: savedRows, error: saveDraftError } = await admin
          .from('strategy_data')
          .update(updatePayload)
          .eq('id', requestedStrategyDataId)
          .eq('company_id', requestedCompanyId)
          .select('id, company_id, final_story_draft, updated_at');

        if (saveDraftError) {
          console.error('[stage2/generate-final] strategy_data.final_story_draft save failed:', {
            companyId: requestedCompanyId || null,
            strategyDataId: requestedStrategyDataId || null,
            error: saveDraftError.message,
          });
        } else if (!Array.isArray(savedRows) || savedRows.length === 0) {
          console.error('[stage2/generate-final] strategy_data.final_story_draft save updated 0 rows:', {
            companyId: requestedCompanyId || null,
            strategyDataId: requestedStrategyDataId || null,
            finalStoryLen: Array.isArray(finalStory) ? finalStory.length : null,
          });
        } else {
          const saved = savedRows[0] as Record<string, unknown>;
          console.log('[stage2/generate-final] strategy_data.final_story_draft saved:', {
            strategyDataId: saved.id,
            companyId: saved.company_id,
            finalStoryLen: Array.isArray(finalStory) ? finalStory.length : null,
            savedDraftLen: Array.isArray(saved.final_story_draft) ? saved.final_story_draft.length : null,
          });
        }
      } catch (e: any) {
        console.error('[stage2/generate-final] strategy_data.final_story_draft save error:', e?.message || e);
      }
    } else {
      console.warn('[stage2/generate-final] strategy_data.final_story_draft save skipped: companyId/strategyDataId missing');
    }

    // ★ 監査ログ記録
    if (typeof requestedCompanyId === 'string' && typeof userId === 'string') {
      try {
        await logAuditEvent({
          companyId: requestedCompanyId,
          actorUserId: userId,
          action: 'stage2_generate_final',
          targetType: 'strategy_data',
          metadata: {
            finalStoryCount: Array.isArray(finalStory) ? finalStory.length : 0,
            hasMidtermStrategy: !!midtermStrategy,
            model: usedModel,
            patternCount: patternsArr?.length || 0,
            enhanceEmotion: enhanceEmotion === true,
          },
          ...extractAuditMetadata(req),
        });
      } catch (auditErr) {
        console.warn('[stage2/generate-final] audit log failed (non-blocking):', auditErr);
      }
    }

    // ★ 診断：API response直前の finalStory を確認
    console.log('[stage2-final] ★FINAL STORY BEFORE RESPONSE★', {
      count: Array.isArray(finalStory) ? finalStory.length : 0,
      story0_title: finalStory?.[0]?.title ?? 'null',
    });

    return new NextResponse(
      JSON.stringify({
        finalStory,
        longform,
        sections,
        // ★STEP6: 中計設計（生成できた場合のみ含める。既存クライアントは未参照でも無害）
        ...(midtermStrategy ? { midtermStrategy } : {}),
        _debug: {
          model: usedModel,
          patterns: patternsArr,
          heuristic: usedHeuristic,
          enhanced: enhanceEmotion === true,
          hasCompanyTargets: companyTargetsText !== '—',
          hasNorthStar: Boolean(asText(northStar)),
          answers12Count: Array.isArray(answers12) ? answers12.length : 0,
          answersRichLength: answersRich.length,
          strategicIntentCoverage,
          executiveStoryQuality,
          // ★ prompt.txt指示：生成後チェック結果
          badToneCheck,
          typoCheck,
          hasStrategicIntentDigest: !!strategicIntentDigest,
        },
      }),
      {
        headers: {
          'cache-control': 'no-store',
          'content-type': 'application/json; charset=utf-8',
          'x-fallback-used': String(usedHeuristic),
        },
        status: 200,
      },
    );
  } catch (error: any) {
    console.error('❌ 最終ストーリー生成エラー:', error?.message || error);
    const status = error?.name === 'AbortError' ? 504 : 500;
    return new NextResponse(
      JSON.stringify({
        error: '最終ストーリーの生成に失敗しました',
        detail: String(error),
      }),
      { status, headers: { 'content-type': 'application/json; charset=utf-8' } },
    );
  }
}
