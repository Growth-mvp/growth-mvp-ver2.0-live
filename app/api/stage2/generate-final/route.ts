/* eslint-disable @typescript-eslint/no-explicit-any */
import 'server-only';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

import { NextRequest, NextResponse } from 'next/server';
import { openai } from '@/lib/openai';
import { getIndustryLabel as _getIndustryLabel } from '@/utils/industryTemplates';
import { saveFinalStory } from '@/utils/supabase';
import type { ChatCompletionCreateParamsNonStreaming } from 'openai/resources/chat/completions';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { getAuthUserIdFromBearer, requireMembership } from '@/lib/server/rbacGuard';

/* =========================
 * モデル選択（簡素化）
 * =======================*/
const MODEL_PRIMARY =
  process.env.OPENAI_MODEL ?? process.env.NEXT_PUBLIC_OPENAI_MODEL ?? 'gpt-4o';
const MODEL_FALLBACK = 'gpt-4o-mini';
const SUPPORTS_JSON_MODE = /^gpt-4o($|-)/;

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
  '第1章：なぜ今（現状の危機と背景）',
  '第2章：どう戦う（選択と集中の戦略）',
  '第3章：どんな未来を実現するか（顧客価値と成果）',
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
 * - 回答は短すぎると議論の結論が落ちるため 240 文字まで保持
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
        const a = sanitize((s.answer || s.reason || '').trim(), 240).trim();
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
      const refs = asArray(t.relatedIssueIds ?? t.linkedIssueIds ?? t.issueIds)
        .map((x) => asText(x, 80))
        .filter(Boolean)
        .join(', ');
      const value = formatTargetValueForStory(valueRaw, unit);
      const parts = [
        name,
        value ? `目標値=${value}` : '',
        year ? `目標年=${year}` : '',
        note ? `補足=${note}` : '',
        refs ? `関連論点=${refs}` : '',
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
      const ans = pickFirstText(a.answer, a.value, a.body, a.text, a.response, a.reason).slice(0, 320);
      const chapter = pickFirstText(a.chapterTitle, a.chapter, a.section, a.category).slice(0, 80);
      return `- ${chapter ? `${chapter} / ` : ''}${q}\n  A: 「${ans || '—'}」`;
    })
    .join('\n');
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
  return [`${name}${selected ? `（ID=${selected}）` : ''}`, desc ? `狙い=${desc}` : '', kpi ? `価値指標=${kpi}` : '']
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
  let raw = formatStoryDraft(storyDraft);
  if (raw === '—') return raw;

  // たたき台の分析メモ・見出し・内部情報を削除
  raw = stripPeopleRelatedNoise(raw);

  // 禁止表現を削除
  raw = raw.replace(/^\s*\d+\)\s*狙う価値ドライバー.*/gim, ''); // 「1) 狙う価値ドライバー」
  raw = raw.replace(/主要戦略\s*[:：]/gim, '');
  raw = raw.replace(/90日アクション\s*[:：]/gim, '');
  raw = raw.replace(/根拠\s*\(\s*SWOT\s*\)\s*[:：]/gim, '');
  raw = raw.replace(/トレードオフ\s*[:：]/gim, '');
  raw = raw.replace(/関連論点\s*=\s*[^\n]*/gim, '');
  raw = raw.replace(/issue-[^\s）)]+/gim, '');
  raw = raw.replace(/目標値\s*=\s*[^\n]*/gim, '');
  raw = raw.replace(/目標年\s*=\s*[^\n]*/gim, '');
  raw = raw.replace(/論点ID\s*[:：]?\s*[^\n]*/gim, '');
  raw = raw.replace(/強み\s*\(\s*S\s*\)\s*[:：]?/gim, '');
  raw = raw.replace(/弱み\s*\(\s*W\s*\)\s*[:：]?/gim, '');
  raw = raw.replace(/機会\s*\(\s*O\s*\)\s*[:：]?/gim, '');
  raw = raw.replace(/脅威\s*\(\s*T\s*\)\s*[:：]?/gim, '');
  raw = raw.replace(/North\s*Star未入力/gim, '');

  return raw.slice(0, 2600) || '—';
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

  // たたき台の分析メモ禁止表現をクリーンアップ
  out = out.replace(/^\s*\d+\)\s*狙う価値ドライバー.*/gim, '');
  out = out.replace(/主要戦略\s*[:：]\s*\n/gim, '\n');
  out = out.replace(/90日アクション\s*[:：]\s*\n/gim, '\n');
  out = out.replace(/根拠\s*\(\s*SWOT\s*\)\s*[:：]\s*[^\n]*/gim, '');
  out = out.replace(/トレードオフ\s*[:：]\s*[^\n]*/gim, '');
  out = out.replace(/関連論点\s*=\s*[^\n]*/gim, '');
  out = out.replace(/issue-[^\s）)]+/gim, '');
  out = out.replace(/目標値\s*=\s*[^\n]*/gim, '');
  out = out.replace(/目標年\s*=\s*[^\n]*/gim, '');
  out = out.replace(/論点ID\s*[:：]?\s*[^\n]*/gim, '');
  out = out.replace(/強み\s*\(\s*S\s*\)\s*[:：]?/gim, '');
  out = out.replace(/弱み\s*\(\s*W\s*\)\s*[:：]?/gim, '');
  out = out.replace(/機会\s*\(\s*O\s*\)\s*[:：]?/gim, '');
  out = out.replace(/脅威\s*\(\s*T\s*\)\s*[:：]?/gim, '');
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
  // 経営戦略文書に不要な演説調・鼓舞表現を抑制する。
  out = out.replace(/皆さん[、，]?/g, '');
  out = out.replace(/私たち[はも]?/g, '当社は');
  out = out.replace(/我々[はも]?/g, '当社は');
  out = out.replace(/一緒に/g, '各部門で');
  out = out.replace(/未来を切り開(?:く|いていきましょう|いていく)/g, '将来の成長基盤をつくる');
  out = out.replace(/挑戦し(?:よう|ましょう)/g, '取り組む');
  out = out.replace(/覚悟を持って/g, '方針を明確にして');
  out = out.replace(/覚悟ある/g, '明確な');
  out = out.replace(/全力/g, '重点的');
  out = out.replace(/邁進(?:していきます|します)?/g, '推進します');
  out = out.replace(/信念/g, '方針');
  out = out.replace(/主役になれる/g, '中核を担う');
  out = out.replace(/誇りとやりがい/g, '成果と納得感');
  out = out.replace(/この選択肢/g, 'この方針');
  out = out.replace(/切り開いていきましょう/g, '具体化していく');
  out = out.replace(/立ち向かわせている/g, '対応を迫っている');
  out = stripPeopleRelatedNoise(out);
  out = out.replace(/[ \t]+\n/g, '\n');
  out = out.replace(/\n{3,}/g, '\n\n').trim();
  return tidyJa(out);
}

/* =========================
 * OpenAI 呼び出し（JSON強制＋フォールバック）
 * =======================*/
type ChatArgs = {
  model: string;
  temperature: number;
  max_tokens: number;
  presence_penalty?: number;
  frequency_penalty?: number;
  system: string;
  user: string;
};

async function callOpenAIChat(args: ChatArgs): Promise<string> {
  const {
    model,
    temperature,
    max_tokens,
    presence_penalty = 0.2,
    frequency_penalty = 0.2,
    system,
    user,
  } = args;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 58_000);

  const base: ChatCompletionCreateParamsNonStreaming = {
    model,
    temperature,
    max_tokens,
    presence_penalty,
    frequency_penalty,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    ...(SUPPORTS_JSON_MODE.test(model)
      ? { response_format: { type: 'json_object' as const } }
      : {}),
  };

  try {
    const resp = await openai.chat.completions.create(base, {
      signal: controller.signal,
    });
    clearTimeout(timer);
    return resp.choices?.[0]?.message?.content?.trim() ?? '';
  } catch (e: any) {
    clearTimeout(timer);
    const status =
      e?.status ?? e?.response?.status ?? (e?.name === 'AbortError' ? 504 : 500);
    // 429/5xx → フォールバック（mini）
    if ((status === 429 || status >= 500) && args.model !== MODEL_FALLBACK) {
      return await callOpenAIChat({ ...args, model: MODEL_FALLBACK });
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

function buildNoPeopleStrategyChapter(args: {
  segmentsText?: string;
  strength?: unknown;
  opportunity?: unknown;
  weakness?: unknown;
  threat?: unknown;
  companyTargetsText?: string;
}): string {
  const segments = asText(args.segmentsText, 500);
  const areas = segments && segments !== '—' ? segments : '成長が見込める事業領域';
  const strength = sanitize(args.strength, 180) || '当社が培ってきた技術・顧客基盤';
  const opportunity = sanitize(args.opportunity, 180);
  const weakness = sanitize(args.weakness, 180);
  const threat = sanitize(args.threat, 180);
  const target = asText(args.companyTargetsText, 500);

  const targetLine = target && target !== '—'
    ? `この方針は、${target.replace(/\n/g, '、')}という到達点に向けた道筋です。`
    : 'この方針は、短期の売上拡大だけでなく、中長期の収益基盤をつくるためのものです。';

  return [
    `自社の勝ち筋：私たちは、${strength}を、${areas}における顧客課題の解決へ広げ、既存事業への依存を下げながら新たな収益基盤をつくります。`,
    `第一に、成長させる領域を明確にします。${areas}を中心に、脱炭素、デジタル化、エネルギー転換などの変化によって生まれる需要を捉えます。${opportunity ? `特に、${opportunity}という機会を事業成長に結びつけます。` : ''}`,
    `第二に、顧客に提供する価値を明確にします。単に既存製品を売り続けるのではなく、顧客の用途、品質、コスト、環境対応の課題を起点に、製品開発と市場開拓を進めます。`,
    `第三に、投資と資源配分の基準を明確にします。財務余力を、将来の成長領域、顧客価値に直結する製品開発、既存依存からの転換に優先して振り向けます。${targetLine}`,
    `同時に、やめることも決めます。成長領域や顧客価値とのつながりが弱い取り組み、収益性の低い商品、目的が曖昧な投資は見直します。${weakness ? `また、${weakness}という弱みに向き合い、` : ''}${threat ? `${threat}という脅威を前提に、` : ''}資源を勝ち筋に集中させます。`,
  ].filter(Boolean).join('\n\n');
}

function normalizeNoPeopleStrategySections(
  sections: { heading: string; body: string }[],
  args: {
    segmentsText?: string;
    strength?: unknown;
    opportunity?: unknown;
    weakness?: unknown;
    threat?: unknown;
    companyTargetsText?: string;
  },
): { heading: string; body: string }[] {
  const out = [...sections];
  const s2 = out[1]?.body || '';
  if (!out[1] || containsPeopleStrategyNoise(s2) || !/自社の勝ち筋/.test(s2)) {
    out[1] = {
      heading: 'どう戦う',
      body: buildNoPeopleStrategyChapter(args),
    };
  }
  return out;
}

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

  const howBullets: string[] = [];
  if (patterns.includes('subscriptionMoat')) {
    howBullets.push('サブスク継続価値の明文化（やめない理由）と先回りCS');
  }
  if (patterns.includes('platformPlay')) {
    howBullets.push('主要SaaS/APIとの接続をテンプレ化し、導入→価値発現を短縮');
  }
  if (patterns.includes('serviceDelight')) {
    howBullets.push('顧客の導入・利用・相談の体験を磨き、継続して選ばれる理由を作る');
  }
  if (patterns.includes('manufacturingKaizen')) {
    howBullets.push('内製ツール×標準作業で欠陥と手戻りを継続削減');
  }
  if (patterns.includes('dataNetwork')) {
    howBullets.push('顧客接点と実績データを蓄積し、提案精度と改善速度を高める');
  }
  if (howBullets.length === 0) {
    howBullets.push('重点セグメント集中と、勝ち筋に沿った投資配分の徹底');
  }

  // ★フォールバック時も第2章冒頭に「自社の勝ち筋：〜」を1行入れる
  const winningLine =
    patterns.length > 0
      ? `自社の勝ち筋：${patterns.join(' / ')}`
      : '自社の勝ち筋：選んだ勝ちパターンに沿って、資源を集中して勝ち切る';

  const s2 = [
    winningLine,
    '資源の再配分：やめることを明確化し、勝ち筋に集中する。',
    ...howBullets.map((b) => `・${b}`),
    'やらないこと：汎用ビルド、カスタム過多、非中核の横展開は抑制。',
    '安易な拡張ではなく、顧客価値と収益性に直結する領域へ資源を集中する。',
  ].join('\n');

  const s3 = [
    '目指す未来は、既存の延長で数字を積み上げるだけの姿ではなく、顧客から重要な課題を解決する専門企業として選ばれる状態である。',
    'その実現には、強みを伸ばす領域と見直す領域を分け、顧客価値に直結する仕事へ人・時間・投資を集中させる必要がある。',
    '収益構造としては、成長領域の売上構成を高め、利益率と資本効率を同時に改善することが重要になる。',
  ].join('\n');

  const s4 = [
    `まずSTAGE3では、顧客価値と業績目標に直結する上位課題を、部門ごとのミッション・重点プロジェクトへ展開する。`,
    `次にSTAGE4では、各プロジェクトに対してKPI、期限、担当、必要投資を設定し、実行計画として管理可能な単位に分解する。`,
    `経営会議では、成長領域への資源配分、低収益領域の見直し、顧客価値に直結するKPIの進捗を確認する。`,
    'この最終ストーリーは、直接の作業指示ではなく、部門戦略・KPI・実行管理へ翻訳するための全社共通の判断基準である。',
  ].join('\n');

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
      'あなたは経営ストーリーのエディターです。構造を壊さずに、経営会議資料に耐える平易さ・具体性・構造を整えます。',
      '出力は JSON のみ。{"sections":[{"heading":"なぜ今","body":"..."},...]} の形式で返す。',
    ].join('\n');

    const user = [
      '【編集方針】',
      '- 誇り・覚悟・信念などの情緒表現は削り、経営判断・資源配分・実行設計の表現に置き換える。',
      '- 現場が腹落ちする具体性（顧客・市場・強み・やること/やめること）を強める。比喩は控えめにする。',
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
      temperature: Math.min(0.55, typeof temperature === 'number' ? temperature : 0.45),
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

/* =========================
 * ルート
 * =======================*/
export async function POST(req: NextRequest) {
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

    // Bearer token authentication and membership validation
    const admin = getSupabaseAdmin();
    const userId = await getAuthUserIdFromBearer(admin, req);
    if (!userId) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }
    const membership = await requireMembership(admin, userId);
    if (!membership) {
      return NextResponse.json({ error: 'forbidden' }, { status: 403 });
    }

    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

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
    const temperature = typeof body.temperature === 'number' ? body.temperature : 0.45;
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
目的は、演説やスローガンではなく、会社が何を目指し、なぜ変わり、どこで勝ち、どう部門戦略・KPI・実行管理に落とすのかを明確に伝えることです。

【最優先】
- 経営層・部門長・現場管理職が同じ判断基準を持てる、落ち着いた経営戦略文書にする。
- 本文は、事実 → 解釈 → 戦略上の意味、の順で書く。
- 抽象語だけで終わらせず、可能な限り「事業領域」「顧客」「用途」「提供価値」「KPI」「資源配分」のいずれかに接続する。
- 第1章は危機認識、第2章は戦略選択、第3章は目指す成果、第4章はSTAGE3/4への展開に限定する。
- 同じ論点を複数章で繰り返さない。
- 人材、採用、育成、能力開発、社員教育、研修を主要戦略として書かない。入力素材に含まれていても、この最終ストーリーでは使わない。
- 90日アクションは第2章に入れない。第4章でも単発施策の羅列ではなく、部門戦略・KPI・実行管理への接続を書く。
- 社員への直接的な呼びかけではなく、組織として何を設計・実行するかを書く。

【たたき台ストーリーの扱い（重要）】
- 【たたき台ストーリー】は参考情報であり、本文にそのまま引用してはいけない。
- たたき台に含まれる分析メモ、見出し、箇条書き、内部ID、SWOT分類、90日アクション、トレードオフは、本文に貼り付けず、経営戦略本文として要約・再構成する。
- 禁止表現：「1) 狙う価値ドライバー」「主要戦略：」「90日アクション：」「根拠（SWOT）：」「トレードオフ：」「関連論点=」「issue-」「目標値=」「強み(S)」「弱み(W)」「機会(O)」「脅威(T)」「North Star未入力」「論点ID」は本文に出さない。

【禁止する文体・表現】
- 「私たち」「皆さん」「一緒に」「挑戦しよう」「未来を切り開く」「覚悟を持って」「賭け」「全力」「邁進」「信念」「主役になれる」「誇りとやりがい」などの演説調・鼓舞表現は使わない。
- 「ハッピーな」「精神集中」「共鳴し合い」「過去のものとして忘れ去られる」などの口語・情緒的表現は使わない。
- 危機感を煽らない。冷静に、経営判断として書く。

【文体】
- 外資系戦略コンサルの報告書に近い、簡潔で構造的な日本語にする。
- 事業環境、顧客価値、競争優位、資源配分、KPI、実行課題との関係を明確にする。
- 断定しすぎず、実現可能性を示唆する表現にする。
- 各章は3〜5段落。各段落は長くしすぎない。
- 数値、事業名、顧客セグメント、競争環境が入力にある場合は、可能な範囲で明示する。

【章ごとの構造】
1. なぜ今：①外部環境の変化、②自社の既存前提が崩れている点、③財務・市場評価上の課題、④だから見直すべき経営論点を書く。

2. どう戦う（固定4段落構成）：
  第1段落：当社の勝ち筋を一文で定義する。
  第2段落：重点事業・重点市場を説明する。事業名は重複させない。
  第3段落：投資配分と見直す領域を説明する。
  第4段落：STAGE3では事業別・部門別の重点テーマを定義し、STAGE4では投資基準とKPIに落とし込む、という接続で締める。

3. どんな未来：①顧客からどう選ばれる会社になるか、②収益構造がどう変わるか、③社会・市場に対する提供価値、④業績目標との接続を書く。

4. どう実行する：①STAGE3で部門戦略に展開する、②STAGE4でKPI・実行計画に落とす、③経営会議で確認する指標・論点、④現場の判断基準として何を変えるかを書く。

【数値・年度の扱い】
- 業績目標の年度・数値・単位は【業績目標】を最優先する。
- fin_json やたたき台ストーリーの年度が【業績目標】と矛盾する場合は、必ず【業績目標】を正とする。
- 入力にない数値は作らない。
- 「入力値」「基準値」「論点ID」などの内部表現は本文に出さない。

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

【現場の声（12問回答：質問＋回答）】
${stripPeopleRelatedNoise(answersRich) || '—'}

【出力仕様】上記の制約・形式を厳守。`.trim();

    /* ---------- OpenAI 呼び出し or ヒューリスティック ---------- */
    let raw = '';
    let usedModel = MODEL_PRIMARY;
    let usedHeuristic = false;

    try {
      raw = await callOpenAIChat({
        model: MODEL_PRIMARY,
        temperature:
          typeof temperature === 'number' && Number.isFinite(temperature)
            ? Math.min(temperature as number, 0.55)
            : 0.45,
        max_tokens: 2300,
        presence_penalty: 0.2,
        frequency_penalty: 0.2,
        system: systemPrompt,
        user: userPrompt,
      });
    } catch (_detail: any) {
      usedHeuristic = true;
      usedModel = 'heuristic-fallback';
    }

    let finalStory, longform, sections: { heading: string; body: string }[];

    if (!usedHeuristic && raw) {
      type GenOut = { sections?: Array<{ heading?: string; body?: string }> };
      const parsed = extractJsonLoose<GenOut>(raw);

      sections =
        Array.isArray(parsed?.sections) && parsed!.sections!.length >= 4
          ? coerceToSimpleHeads(parsed!.sections!)
          : coerceToSimpleHeads(parsed?.sections || []);

      // 二段階目のエモーショナル補正は、熱量過多・ラベル混入を避けるため既定OFF。
      const doEnhance = enhanceEmotion === true;
      sections = await enhanceEmotionIfNeeded(
        sections,
        thought,
        patternsLine,
        typeof temperature === 'number' ? Math.min(temperature, 0.55) : 0.45,
        MODEL_PRIMARY,
        doEnhance,
      );

      sections = ensureBridges(sections);
      sections = sections.map((s) => ({ ...s, body: cleanFinalStoryArtifacts(s.body) }));
      sections = normalizeNoPeopleStrategySections(sections, {
        segmentsText,
        strength,
        opportunity,
        weakness,
        threat,
        companyTargetsText,
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
    }

    // 最終品質ガード：内部メモ・誤生成・不自然表現を本文から除去
    sections = sections.map((s) => ({ ...s, body: cleanFinalStoryArtifacts(s.body) }));
    sections = normalizeNoPeopleStrategySections(sections, {
      segmentsText,
      strength,
      opportunity,
      weakness,
      threat,
      companyTargetsText,
    });
    sections = sections.map((s) => ({ ...s, body: cleanFinalStoryArtifacts(s.body) }));
    longform = sections
      .map((s) => `【${s.heading}】\n${sanitize(normalizeNewlines(s.body), 4000)}`)
      .join('\n\n');
    finalStory = TITLE_TEMPLATES.map((title, i) => ({
      title,
      body: sections[i]?.body || '（この章は未生成です）',
    }));

    /* ---------- ★STEP6: 中計設計（midtermStrategy）の第2パス生成 ----------
     * - 既存の4章ストーリー生成には一切手を入れない（プロンプト・トークン配分とも独立）
     * - この呼び出しが失敗/タイムアウトしても catch で握り、midtermStrategy なしで
     *   従来どおりのレスポンスを返す（既存STAGE2生成を壊さない）
     * - ヒューリスティックフォールバック時はスキップ（素材の信頼度が低いため） */
    let midtermStrategy: Record<string, unknown> | undefined;
    if (!usedHeuristic) {
      try {
        const midtermSystem = [
          'あなたは中期経営計画の設計を支援する経営戦略コンサルタントです。',
          '確定済みの全社戦略ストーリーと入力情報をもとに、中計全体の設計サマリーをJSONのみで返します。',
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
          '  "managementMeetingIssues": ["経営会議で確認すべき論点（2〜4個）"]',
          '}',
        ].join('\n');

        const midtermUser = [
          '【確定済み全社戦略ストーリー】',
          sanitize(longform, 4000) || '—',
          '',
          `【業績目標】\n${companyTargetsText}`,
          `【事業ポートフォリオ】${portfolioSummary}`,
          `【勝ちパターン】${patternsLine}`,
          `【SWOT】S=${sanitize(strength, 300) || '—'}／W=${sanitize(weakness, 300) || '—'}／O=${sanitize(opportunity, 300) || '—'}／T=${sanitize(threat, 300) || '—'}`,
          `【事業・セグメント】${segmentsText}`,
          '',
          '上記と矛盾しない範囲で、スキーマどおりのJSONのみを返してください。',
        ].join('\n');

        const midtermRaw = await callOpenAIChat({
          model: MODEL_PRIMARY,
          temperature: 0.4,
          max_tokens: 1100,
          system: midtermSystem,
          user: midtermUser,
        });

        const parsedMid = extractJsonLoose<Record<string, any>>(midtermRaw);
        if (parsedMid && typeof parsedMid === 'object' && !Array.isArray(parsedMid)) {
          const str = (v: unknown) => (typeof v === 'string' && v.trim() ? sanitize(v, 400) : undefined);
          const strArr = (v: unknown, max: number) => {
            const arr = Array.isArray(v)
              ? v.filter((x) => typeof x === 'string' && x.trim()).slice(0, max).map((x) => sanitize(x, 200))
              : [];
            return arr.length > 0 ? arr : undefined;
          };
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
          };
          const compact = Object.fromEntries(
            Object.entries(candidate).filter(([, v]) => v !== undefined),
          );
          if (Object.keys(compact).length > 0) midtermStrategy = compact;
        }
      } catch (e: any) {
        console.warn('⚠️ 中計設計（midtermStrategy）の生成をスキップ（続行）:', e?.message || e);
      }
    }

    // 任意保存（存在すれば実行）
    if (typeof userId === 'string' && userId && typeof saveFinalStory === 'function') {
      try {
        await saveFinalStory(userId, finalStory as any, {});
      } catch (e: any) {
        console.warn('⚠️ final_stories 保存に失敗（続行）:', e?.message || e);
      }
    }

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
