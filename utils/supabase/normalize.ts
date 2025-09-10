// /utils/supabase/normalize.ts
import type { StrategyData, ChapterStory } from '@/types/strategy';

/** GROWTH 固定タイトル */
const GROWTH_TITLES = [
  '第1章：なぜ今（現状の危機と背景）',
  '第2章：どう戦う（選択と集中の戦略）',
  '第3章：どんな未来像（顧客の風景で描く）',
  '第4章：どう行動する（社員一人ひとりの役割と決意）',
];

/* =====================================================================
 * 基本ユーティリティ
 * ===================================================================== */
const asArr = <T = any>(v: any): T[] => (Array.isArray(v) ? v : []);
const toStr = (v: any, fallback = ''): string =>
  typeof v === 'string' ? v : v == null ? fallback : String(v);

function tryParseJson<T = any>(text: string): T | null {
  try { return JSON.parse(text); } catch { return null; }
}

/** camel と snake の両方で来る可能性に備え、camel 優先で取り出す */
function getEither(src: any, camel: string, snake: string) {
  if (src && camel in src) return (src as any)[camel];
  if (src && snake in src) return (src as any)[snake];
  return undefined;
}

/* =====================================================================
 * story / finalStory 正規化
 * ===================================================================== */
function toChapterArray(input: any): ChapterStory[] {
  if (!input) return [];

  if (typeof input === 'string') {
    const parsed = tryParseJson(input);
    if (parsed && typeof parsed === 'object') return toChapterArray(parsed);
    return [];
  }

  if (Array.isArray(input)) {
    const arr: ChapterStory[] = [];
    for (const it of input) {
      if (!it) continue;
      if (typeof it === 'string') {
        arr.push({ title: '', body: it });
      } else if (typeof it === 'object') {
        const t = typeof (it as any).title === 'string' ? (it as any).title : '';
        const b = typeof (it as any).body === 'string' ? (it as any).body : '';
        if (!t && !b) {
          const keys = Object.keys(it || {});
          if (keys.length === 1) {
            const k = keys[0];
            const v = (it as any)[k];
            arr.push({ title: String(k ?? ''), body: typeof v === 'string' ? v : '' });
          }
        } else {
          arr.push({ title: t, body: b });
        }
      }
    }
    return arr;
  }

  if (typeof input === 'object') {
    const arr: ChapterStory[] = [];
    for (const k of Object.keys(input)) {
      const v = (input as any)[k];
      if (v && (typeof v === 'string' || typeof v === 'number')) {
        arr.push({ title: String(k ?? ''), body: String(v ?? '') });
      }
    }
    return arr;
  }

  return [];
}

function uniqChapters(chs: ChapterStory[]): ChapterStory[] {
  const seen = new Set<string>();
  const out: ChapterStory[] = [];
  for (const c of chs || []) {
    const title = typeof c?.title === 'string' ? c.title : '';
    const body  = typeof c?.body  === 'string' ? c.body  : '';
    const key = `${title.trim()}::${body.trim()}`;
    if (!seen.has(key)) {
      seen.add(key);
      out.push({ title, body });
    }
  }
  return out;
}

function alignToGrowthOrder(chs: ChapterStory[] = []): ChapterStory[] {
  const buckets = [
    { keys: ['なぜ今', '現状', '危機', '背景'] },
    { keys: ['どう戦う', '戦略', '選択', '集中', 'トレードオフ'] },
    { keys: ['未来像', '未来', 'どこへ', 'ビジョン', '顧客の風景'] },
    { keys: ['どう行動する', '行動', '社員', '当事者', 'オーナー'] },
  ];
  const used = new Set<number>();
  const ordered: ChapterStory[] = [];
  const scoreOf = (text: string, keys: string[]) =>
    keys.reduce((acc, k) => acc + (text.includes(k) ? 1 : 0), 0);

  for (const b of buckets) {
    let bestIdx = -1; let bestScore = -1;
    chs.forEach((c, idx) => {
      if (used.has(idx)) return;
      const hay = `${c?.title ?? ''}${c?.body ?? ''}`;
      const sc = scoreOf(hay, b.keys);
      if (sc > bestScore) { bestScore = sc; bestIdx = idx; }
    });
    if (bestIdx >= 0) { used.add(bestIdx); ordered.push(chs[bestIdx]); }
    else { ordered.push({ title: '', body: '' }); }
  }

  return ordered.slice(0, 4).map((c, i) => ({
    title: GROWTH_TITLES[i],
    body: (c?.body ?? '').trim(),
  }));
}

export function normalizeChaptersAny(input: any): ChapterStory[] {
  const arr  = toChapterArray(input);
  const uniq = uniqChapters(arr);
  return alignToGrowthOrder(uniq);
}

/* =====================================================================
 * departments 正規化
 * ===================================================================== */
type AnyOKR =
  | { objective?: any; keyResults?: any; owner?: any }
  | null | undefined;

type AnyProject =
  | { title?: any; name?: any; okrs?: any; objective?: any; keyResults?: any; owner?: any }
  | null | undefined;

type AnyDepartment =
  | { id?: any; name?: any; title?: any; projects?: any }
  | null | undefined;

function normalizeOKR(input: AnyOKR) {
  const o = input || {};
  const objective = typeof (o as any).objective === 'string' ? (o as any).objective : '';
  const keyResults = Array.isArray((o as any).keyResults)
    ? (o as any).keyResults.map((k: any) => String(k))
    : [];
  const owner =
    (o as any).owner !== undefined && (o as any).owner !== null && String((o as any).owner) !== ''
      ? String((o as any).owner)
      : undefined;
  return { objective, keyResults, owner };
}

function normalizeProject(p: AnyProject) {
  const title =
    typeof (p as any)?.title === 'string' ? (p as any).title :
    typeof (p as any)?.name  === 'string' ? (p as any).name  : '';
  const okrsRaw = Array.isArray((p as any)?.okrs) ? (p as any).okrs : [];

  // レガシー互換（objective/keyResults/owner を単一OKRとして包む）
  const legacy =
    (p as any)?.objective || (p as any)?.keyResults || (p as any)?.owner
      ? [{
          objective: String((p as any)?.objective ?? ''),
          keyResults: Array.isArray((p as any)?.keyResults)
            ? (p as any).keyResults.map((k: any) => String(k))
            : [],
          owner: (p as any)?.owner ? String((p as any).owner) : '',
        }]
      : [];

  const okrs = [...legacy, ...okrsRaw].map(normalizeOKR);
  return { title, okrs };
}

function normalizeDepartment(d: AnyDepartment) {
  const id = (d as any)?.id ?? undefined;
  const name =
    typeof (d as any)?.name  === 'string' ? (d as any).name  :
    typeof (d as any)?.title === 'string' ? (d as any).title : '';
  const projectsRaw = Array.isArray((d as any)?.projects) ? (d as any).projects : [];
  const projects = projectsRaw.map(normalizeProject);
  return { id, name, projects };
}

export function normalizeDepartmentsAny(input: any) {
  if (!input) return [];
  let src = input;
  if (typeof src === 'string') {
    const parsed = tryParseJson(src);
    if (parsed && typeof parsed === 'object') return normalizeDepartmentsAny(parsed);
    return [];
  }
  if (Array.isArray(src)) return src.map(normalizeDepartment);
  if (typeof src === 'object' && Array.isArray((src as any).departments))
    return (src as any).departments.map(normalizeDepartment);
  return [];
}

/* =====================================================================
 * csv_finance_data 正規化
 * - 多様な形を「Record<string,string> の配列」に寄せる
 * ===================================================================== */
function normalizeCsvFinanceData(input: any): Array<Record<string, string>> {
  if (!input) return [];

  if (typeof input === 'string') {
    const parsed = tryParseJson(input);
    return normalizeCsvFinanceData(parsed);
  }

  if (Array.isArray(input)) {
    return input.map((row) => {
      if (row && typeof row === 'object' && !Array.isArray(row)) {
        const rec: Record<string, string> = {};
        for (const [k, v] of Object.entries(row)) {
          rec[String(k)] = toStr(v, '');
        }
        return rec;
      }
      return { value: toStr(row, '') };
    });
  }

  if (typeof input === 'object') {
    const rec: Record<string, string> = {};
    for (const [k, v] of Object.entries(input)) {
      rec[String(k)] = toStr(v, '');
    }
    return [rec];
  }

  return [];
}

/* =====================================================================
 * StrategyData 全体の正規化入口（入出力は camelCase）
 * - 入力: Supabase の行（camel/snake 混在可）
 * - 出力: StrategyData（camel）
 * ===================================================================== */
export function normalizeStrategyData(input: StrategyData | any | null): StrategyData | null {
  if (!input) return null;
  const src: any = { ...(input as any) };

  let storyRaw       = getEither(src, 'story', 'story');
  let finalStoryRaw  = getEither(src, 'finalStory', 'final_story');
  let answers2Raw    = getEither(src, 'answers2', 'answers2');
  let departmentsRaw = getEither(src, 'departments', 'departments');
  let financeRaw     = getEither(src, 'csvFinanceData', 'csv_finance_data');

  if (typeof storyRaw === 'string')       { const p = tryParseJson(storyRaw);       if (p) storyRaw = p; }
  if (typeof finalStoryRaw === 'string')  { const p = tryParseJson(finalStoryRaw);  if (p) finalStoryRaw = p; }
  if (typeof answers2Raw === 'string')    { const p = tryParseJson(answers2Raw);    if (p) answers2Raw = p; }
  if (typeof departmentsRaw === 'string') { const p = tryParseJson(departmentsRaw); if (p) departmentsRaw = p; }
  if (typeof financeRaw === 'string')     { const p = tryParseJson(financeRaw);     if (p) financeRaw = p; }

  const story       = normalizeChaptersAny(storyRaw);
  const finalStory  = normalizeChaptersAny(finalStoryRaw);
  const answers2    = asArr<any>(answers2Raw);
  const departments = normalizeDepartmentsAny(departmentsRaw);
  const csvFinanceData = normalizeCsvFinanceData(financeRaw);

  const companyName     = toStr(getEither(src, 'companyName', 'company_name'));
  const foundationYear  = toStr(getEither(src, 'foundationYear', 'foundation_year'));
  const location        = toStr(getEither(src, 'location', 'location'));
  const industry        = toStr(getEither(src, 'industry', 'industry'));
  const revenue         = toStr(getEither(src, 'revenue', 'revenue'));
  const employees       = toStr(getEither(src, 'employees', 'employees'));
  const businessContent = toStr(getEither(src, 'businessContent', 'business_content'));
  const customerSegment = toStr(getEither(src, 'customerSegment', 'customer_segment'));
  const thought         = toStr(getEither(src, 'thought', 'thought'));
  const mission         = toStr(getEither(src, 'mission', 'mission'));
  const vision          = toStr(getEither(src, 'vision', 'vision'));
  const value           = toStr(getEither(src, 'value', 'value'));
  const strength        = toStr(getEither(src, 'strength', 'strength'));
  const weakness        = toStr(getEither(src, 'weakness', 'weakness'));
  const opportunity     = toStr(getEither(src, 'opportunity', 'opportunity'));
  const threat          = toStr(getEither(src, 'threat', 'threat'));

  const strategySummary       = toStr(getEither(src, 'strategySummary', 'strategy_summary'));
  const editableCascadeResult = normalizeDepartmentsAny(
    getEither(src, 'editableCascadeResult', 'editable_cascade_result')
  );

  const out = {
    companyName,
    foundationYear,
    location,
    industry,
    revenue,
    employees,
    businessContent,
    customerSegment,
    thought,
    mission,
    vision,
    value,
    strength,
    weakness,
    opportunity,
    threat,
    csvFinanceData,
    story,
    finalStory,
    strategySummary,
    questions: [],
    reasons: [],
    questions2: [],
    reasons2: [],
    answers: [],
    answers2,
    editableCascadeResult,
    notification: '',
    role: 'member',
    departments,
  };

  return out as unknown as StrategyData;
}
