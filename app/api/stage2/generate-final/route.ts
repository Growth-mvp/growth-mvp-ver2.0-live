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
    /自動車排ガス浄化用セラミックス\s*[:：]/,
    /電力用ガイシ\s*[:：]/,
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

  const hasEnv = names.some((n) => /エンバイロメント/.test(n));
  const hasDigital = names.some((n) => /デジタルソサエティ/.test(n));
  const hasEnergy = names.some((n) => /エネルギー|インダストリー/.test(n));

  const businessParagraph = (() => {
    if (hasEnv || hasDigital || hasEnergy) {
      const parts: string[] = [];
      if (hasEnv) parts.push('エンバイロメント事業では、既存収益を守るだけでなく、脱炭素・環境対応の需要変化を捉え、新用途・新市場への展開を進める。');
      if (hasDigital) parts.push('デジタルソサエティ事業では、高収益性の源泉を重点顧客・重点用途に分解し、成長テーマを絞り込む。');
      if (hasEnergy) parts.push('エネルギー＆インダストリー事業では、価格、原価、提供価値を見直し、成長性と収益性の両面から事業の質を高める。');
      return parts.join('');
    }
    if (names.length) {
      return `${names.join('、')}について、成長余地、収益性、顧客価値とのつながりを見極め、伸ばす領域と見直す領域を分けて資源配分を再設計する。`;
    }
    return '各事業では、成長余地、収益性、顧客価値とのつながりを見極め、伸ばす領域と見直す領域を分けて資源配分を再設計する。';
  })();

  return [
    '当社が選ぶべき戦い方は、既存製品の延長で売上を積み増すことではない。強みであるセラミックス技術を、脱炭素、デジタル化、エネルギー転換によって生まれる顧客課題に結びつけ、顧客の用途・品質・環境対応・安定供給に対する要求へ提供価値を広げることである。',
    'そのためには、既存の自動車排ガス浄化領域への依存を段階的に下げ、成長余地のある市場・用途・顧客へ事業の軸足を移す必要がある。単に新規領域を増やすのではなく、当社の技術が顧客の重要課題を解決でき、かつ収益性と資本効率を高められる領域に経営資源を集中する。',
    businessParagraph,
    '同時に、成長領域とのつながりが弱い商品、目的が曖昧な投資、収益性の低い活動は見直す。財務余力は、将来の収益基盤につながる開発テーマ、市場開拓、顧客価値向上に優先配分し、投資の判断基準を明確にする。',
    'この方針に基づき、STAGE3では事業別・部門別の重点テーマを定義し、STAGE4では投資基準、KPI、実行計画に落とし込む。第2章の役割は、何を伸ばすかだけでなく、何を見直し、どこに資源を集中するかを全社の判断基準として明確にすることである。',
  ].join('\n\n');
}

function buildStoryLikeChapter1Body(args: {
  finMini?: { opm?: number | null } | null;
  strategySignalDigest?: string;
}): string {
  return [
    '当社が直面している課題は、足元の業績だけでは捉えきれない。これまで収益を支えてきた既存市場の前提が、脱炭素、EVシフト、デジタル化、エネルギー転換によって変わり始めている。既存の延長で事業を積み上げるだけでは、次の成長機会を十分に取り切れない局面に入っている。',
    '財務面では、ROICがWACCを上回り、一定の価値創造力と再投資余地は残されている。さらに財務余力もあるため、成長領域へ踏み出す余地はある。しかし、PBRが低位にとどまっていることは、市場が将来成長、資本効率、事業構造転換の実現性にまだ十分な確信を持てていないことを示している。',
    'つまり、問題は「投資できないこと」ではなく、「どこに投資し、何を伸ばし、何を見直すのか」がまだ経営ストーリーとして明確に示し切れていないことにある。成長率が鈍化している事業、収益性を高めるべき事業、将来の成長を担う事業を分けて捉え、資源配分の考え方を再設計する必要がある。',
    'したがって本計画では、既存市場依存を前提とした成長モデルを見直し、成長余地のある市場・顧客・技術領域へ資源を移すことを経営上の主要論点とする。第1章の結論は、危機を強調することではなく、財務余力がある今こそ、次の成長に向けた選択と集中を明確にする必要があるということである。',
  ].join('\n\n');
}

function buildStoryLikeChapter3Body(): string {
  return [
    '目指す未来は、売上・利益目標を達成するだけの姿ではない。顧客が脱炭素、デジタル化、エネルギー転換に向き合う中で、当社が「重要な技術課題を任せられる専門企業」として選ばれる状態をつくることである。ここで重要なのは、製品単体の強さではなく、顧客の事業変化に合わせて用途、品質、環境対応、安定供給を支える提供価値を明確にすることである。',
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

  // 第2章は入力素材が最も多く破綻しやすいため、原則として安全本文に固定する。
  // 12問回答やたたき台は、本文への貼り付けではなく、STAGE3/4で具体化する前提の判断軸として扱う。
  out[1] = {
    heading: 'どう戦う',
    body: buildStrategicChapter2Body(args),
  };

  // 経営層向けに読み応えのある章本文へ整えるため、4章すべてを戦略ストーリー型の本文に正規化する。
  // AI生成本文は入力素材の反映判断に使い、最終表示本文は「状況→解釈→戦略上の意味→次工程」の流れに統一する。
  out[0] = { heading: 'なぜ今', body: buildStoryLikeChapter1Body({}) };
  out[2] = { heading: 'どんな未来', body: buildStoryLikeChapter3Body() };
  out[3] = { heading: 'どう実行する', body: buildStoryLikeChapter4Body() };

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
- 各章は、状況 → 解釈 → 戦略上の意味 → 次工程への接続、の流れで、経営層が読み応えを感じる4段落程度の戦略本文にする。
- たたき台、SWOT、MVV、CEO意図、12問回答は参考素材であり、本文にそのまま引用しない。
- 第2章は、勝ち筋・重点事業・資源配分・やめること・STAGE3/4接続に限定する。
- 人材、採用、育成、能力開発、社員教育、研修、モチベーション、職場環境を主要戦略として書かない。
- 90日アクション、分析メモ、箇条書き素材、内部IDは本文に出さない。

【第2章の厳守事項】
- 「自社の勝ち筋：」というラベルは使わない。
- 「1. 圧倒的な」「2. 高い研究」など、入力素材の見出しを本文に出さない。
- 「根拠（SWOT）」「90日アクション」「トレードオフ」「強み(S)」「弱み(W)」「機会(O)」「脅威(T)」を本文に出さない。
- 事業名は重複させない。
- セラミックス技術、脱炭素、デジタル化、エネルギー転換、顧客課題、資源配分、投資基準を軸に、経営判断の流れが分かる4〜5段落で書く。

【12問回答の扱い】
- 12問回答は、危機感、重点市場、重点顧客、強み、価値提供、やめること、KPI、進捗管理論点として要約反映する。
- 質問文、回答者の口調、「第1問」などの表現は本文に出さない。

【禁止する文体・表現】
- 「私たち」「皆さん」「あなたたち」「一緒に」「挑戦」「努力」「誇り」「覚悟」「邁進」「全社一丸」「しましょう」などの社員向け・訓示調表現は使わない。
- 「入力値」「基準値」「論点ID」「issue-」「関連論点=」「目標値=」「目標年=」「North Star未入力」などの内部表現は使わない。

【章ごとの役割】
1. なぜ今：既存事業の前提変化、財務余力、市場評価の課題を、危機認識の流れとして書く。
2. どう戦う：勝ち筋、重点事業・重点市場、投資配分、見直す領域を示す。
3. どんな未来：顧客から選ばれる理由、顧客価値、収益構造、成長KPIへつながる未来像を書く。
4. どう実行する：STAGE3の部門戦略、STAGE4のKPI・実行計画、STAGE5の実行管理へ接続する。

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
            ? (temperature as number)
            : 0.4,
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
        typeof temperature === 'number' ? Math.min(0.45, Math.max(0.25, temperature)) : 0.4,
        MODEL_PRIMARY,
        doEnhance,
      );

      sections = ensureBridges(sections);
      sections = sections.map((s) => ({ ...s, body: cleanFinalStoryArtifacts(s.body) }));
      sections = normalizeStrategicStorySections(sections, {
        segmentsText,
        portfolio: normalizedPortfolio,
        companyTargetsText,
        answersText: answersRich,
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
