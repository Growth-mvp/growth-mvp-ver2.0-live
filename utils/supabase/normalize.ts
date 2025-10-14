// /utils/supabase/normalize.ts
import type { StrategyData, ChapterStory } from '@/types/strategy';

/** GROWTH 固定タイトル */
const GROWTH_TITLES = [
  '第1章：なぜ今（現状の危機と背景）',
  '第2章：どう戦う（選択と集中の戦略）',
  '第3章：どんな未来像（顧客の風景で描く）',
  '第4章：どう行動する（社員一人ひとりの役割と決意）',
] as const;

/* =====================================================================
 * 基本ユーティリティ
 * ===================================================================== */
const asArr = <T = any>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
const toStr = (v: unknown, fallback = ''): string =>
  typeof v === 'string' ? v : v == null ? fallback : String(v);

function tryParseJson<T = unknown>(text: string): T | null {
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

/** camel と snake の両方で来る可能性に備え、camel 優先で取り出す */
function getEither(src: unknown, camel: string, snake: string): unknown {
  const o = src as any;
  if (o && camel in o) return o[camel];
  if (o && snake in o) return o[snake];
  return undefined;
}

/** string なら JSON.parse を試す。失敗したらそのまま返す */
function parseIfJsonString<T = unknown>(v: unknown): T | unknown {
  if (typeof v === 'string') {
    const p = tryParseJson<T>(v);
    return p ?? v;
  }
  return v;
}

/* =====================================================================
 * story / finalStory 正規化（非破壊）
 * ===================================================================== */
function toChapterArray(input: unknown): ChapterStory[] {
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
    for (const k of Object.keys(input as any)) {
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
    const body = typeof c?.body === 'string' ? c.body : '';
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
  const scoreOf = (text: string, keys: string[]) => keys.reduce((acc, k) => acc + (text.includes(k) ? 1 : 0), 0);

  for (const b of buckets) {
    let bestIdx = -1;
    let bestScore = -1;
    chs.forEach((c, idx) => {
      if (used.has(idx)) return;
      const hay = `${c?.title ?? ''}${c?.body ?? ''}`;
      const sc = scoreOf(hay, b.keys);
      if (sc > bestScore) {
        bestScore = sc;
        bestIdx = idx;
      }
    });
    if (bestIdx >= 0) {
      used.add(bestIdx);
      ordered.push(chs[bestIdx]);
    } else {
      ordered.push({ title: '', body: '' });
    }
  }

  return ordered.slice(0, 4).map((c, i) => ({
    title: GROWTH_TITLES[i],
    body: (c?.body ?? '').trim(),
  }));
}

export function normalizeChaptersAny(input: unknown): ChapterStory[] {
  const arr = toChapterArray(input);
  const uniq = uniqChapters(arr);
  return alignToGrowthOrder(uniq);
}

/* =====================================================================
 * departments 正規化
 * ===================================================================== */
type AnyOKR =
  | { objective?: unknown; keyResults?: unknown; owner?: unknown }
  | null
  | undefined;

type AnyProject =
  | { title?: unknown; name?: unknown; okrs?: unknown; objective?: unknown; keyResults?: unknown; owner?: unknown }
  | null
  | undefined;

type AnyDepartment = { id?: unknown; name?: unknown; title?: unknown; projects?: unknown } | null | undefined;

type NormalizedOKR = { objective: string; keyResults: string[]; owner?: string };
type NormalizedProject = { title: string; okrs: NormalizedOKR[] };
type NormalizedDepartment = { id?: unknown; name: string; projects: NormalizedProject[] };

function normalizeOKR(input: AnyOKR): NormalizedOKR {
  const o = (input || {}) as any;
  const objective = typeof o.objective === 'string' ? o.objective : '';
  const keyResults = Array.isArray(o.keyResults) ? o.keyResults.map((k: any) => String(k)) : [];
  const owner =
    o.owner !== undefined && o.owner !== null && String(o.owner) !== '' ? String(o.owner) : undefined;
  return { objective, keyResults, owner };
}

function normalizeProject(p: AnyProject): NormalizedProject {
  const obj = (p || {}) as any;
  const title =
    typeof obj.title === 'string' ? obj.title : typeof obj.name === 'string' ? obj.name : '';
  const okrsRaw = Array.isArray(obj.okrs) ? obj.okrs : [];

  // レガシー互換（objective/keyResults/owner を単一OKRとして包む）
  const legacy =
    obj.objective || obj.keyResults || obj.owner
      ? [
          {
            objective: String(obj.objective ?? ''),
            keyResults: Array.isArray(obj.keyResults) ? obj.keyResults.map((k: any) => String(k)) : [],
            owner: obj.owner ? String(obj.owner) : '',
          },
        ]
      : [];

  const okrs = [...legacy, ...okrsRaw].map(normalizeOKR);
  return { title, okrs };
}

// 引数 unknown を安全に整形
function normalizeDepartment(d: unknown): NormalizedDepartment {
  const obj = (d || {}) as any;
  const id = obj.id ?? undefined;
  const name = typeof obj.name === 'string' ? obj.name : typeof obj.title === 'string' ? obj.title : '';
  const projectsRaw = Array.isArray(obj.projects) ? obj.projects : [];
  const projects = projectsRaw.map(normalizeProject);
  return { id, name, projects };
}

export function normalizeDepartmentsAny(input: unknown): NormalizedDepartment[] {
  if (!input) return [];
  let src: unknown = input;
  if (typeof src === 'string') {
    const parsed = tryParseJson(src);
    if (parsed && typeof parsed === 'object') return normalizeDepartmentsAny(parsed);
    return [];
  }
  if (Array.isArray(src)) return (src as unknown[]).map(normalizeDepartment);
  if (typeof src === 'object' && Array.isArray((src as any).departments))
    return (src as any).departments.map(normalizeDepartment);
  return [];
}

/* =====================================================================
 * csv_finance_data 正規化（非破壊）
 * - UI互換のため配列はそのまま通す
 * - 文字列なら JSON.parse を試し、失敗したら行単位CSVをざっくり配列化
 * ===================================================================== */
function normalizeCsvFinanceDataLoose(input: unknown): any[] | undefined {
  if (input == null) return undefined;
  if (Array.isArray(input)) return input as any[];
  const parsed = parseIfJsonString<any>(input);
  if (Array.isArray(parsed)) return parsed;

  // 簡易CSV（行ごとにカンマ区切り→配列化）
  if (typeof input === 'string') {
    const text = input.trim();
    if (!text) return [];
    const rows = text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => line.split(',').map((cell) => cell.trim()));
    return rows;
  }
  // オブジェクトなら 1 レコード配列として返す（後方互換）
  if (typeof parsed === 'object' && parsed) return [parsed];
  return undefined;
}

/* =====================================================================
 * business_portfolio / finance_summary 正規化（非破壊）
 * ===================================================================== */
function normalizeBusinessPortfolio(input: unknown): Record<string, any> | undefined {
  if (input == null) return undefined;
  const p = parseIfJsonString<Record<string, any>>(input);
  return p && typeof p === 'object' && !Array.isArray(p) ? p : undefined;
}

/** finance_summary は {items:Array} or Array を受け取り、UIには配列で返す */
function normalizeFinanceSummaryToArray(input: unknown): any[] | undefined {
  if (input == null) return undefined;
  const p = parseIfJsonString<any>(input);
  if (Array.isArray(p)) return p;
  if (p && typeof p === 'object' && !Array.isArray(p) && Array.isArray((p as any).items)) {
    return (p as any).items;
  }
  return undefined;
}

/* =====================================================================
 * StrategyData 全体の正規化入口（入出力は camelCase、非破壊）
 * ===================================================================== */
export function normalizeStrategyData(input: StrategyData | unknown | null): StrategyData | null {
  if (!input) return null;
  const src: any = { ...(input as any) };

  // --- 基本文面系 ---
  let storyRaw = getEither(src, 'story', 'story');
  let finalStoryRaw = getEither(src, 'finalStory', 'final_story');
  let answers2Raw = getEither(src, 'answers2', 'answers2');
  let departmentsRaw = getEither(src, 'departments', 'departments');
  let financeRaw = getEither(src, 'csvFinanceData', 'csv_finance_data');

  if (typeof storyRaw === 'string') { const p = tryParseJson(storyRaw); if (p) storyRaw = p; }
  if (typeof finalStoryRaw === 'string') { const p = tryParseJson(finalStoryRaw); if (p) finalStoryRaw = p; }
  if (typeof answers2Raw === 'string') { const p = tryParseJson(answers2Raw); if (p) answers2Raw = p; }
  if (typeof departmentsRaw === 'string') { const p = tryParseJson(departmentsRaw); if (p) departmentsRaw = p; }
  if (typeof financeRaw === 'string') { const p = tryParseJson(financeRaw); if (p) financeRaw = p; }

  const story = normalizeChaptersAny(storyRaw);
  const finalStory = normalizeChaptersAny(finalStoryRaw);
  const answers2 = asArr<any>(answers2Raw);
  const departments = normalizeDepartmentsAny(departmentsRaw);

  // --- 3カラム（非破壊に保持）---
  const csvFinanceData = normalizeCsvFinanceDataLoose(financeRaw); // Array | undefined（UI側で ?? [] してOK）
  const businessPortfolio = normalizeBusinessPortfolio(getEither(src, 'businessPortfolio', 'business_portfolio'));
  const financeSummary = normalizeFinanceSummaryToArray(getEither(src, 'financeSummary', 'finance_summary'));

  // --- その他 ---
  const companyName = toStr(getEither(src, 'companyName', 'company_name'));
  const foundationYear = toStr(getEither(src, 'foundationYear', 'foundation_year'));
  const location = toStr(getEither(src, 'location', 'location'));
  const industry = toStr(getEither(src, 'industry', 'industry'));
  const revenue = toStr(getEither(src, 'revenue', 'revenue'));
  const employees = toStr(getEither(src, 'employees', 'employees'));
  const businessContent = toStr(getEither(src, 'businessContent', 'business_content'));
  const customerSegment = toStr(getEither(src, 'customerSegment', 'customer_segment'));
  const thought = toStr(getEither(src, 'thought', 'thought'));
  const mission = toStr(getEither(src, 'mission', 'mission'));
  const vision = toStr(getEither(src, 'vision', 'vision'));
  const value = toStr(getEither(src, 'value', 'value'));
  const strength = toStr(getEither(src, 'strength', 'strength'));
  const weakness = toStr(getEither(src, 'weakness', 'weakness'));
  const opportunity = toStr(getEither(src, 'opportunity', 'opportunity'));
  const threat = toStr(getEither(src, 'threat', 'threat'));

  // strategy_summary / editable_cascade / editable_cascade_result は非破壊で
  const strategySummaryRaw = parseIfJsonString<any>(getEither(src, 'strategySummary', 'strategy_summary'));
  const strategySummary =
    Array.isArray(strategySummaryRaw) || (strategySummaryRaw && typeof strategySummaryRaw === 'object')
      ? strategySummaryRaw
      : undefined;

  const editableCascadeRaw = parseIfJsonString<any>(getEither(src, 'editableCascade', 'editable_cascade'));
  const editableCascade =
    Array.isArray(editableCascadeRaw) || (editableCascadeRaw && typeof editableCascadeRaw === 'object')
      ? editableCascadeRaw
      : undefined;

  const editableCascadeResult = normalizeDepartmentsAny(
    getEither(src, 'editableCascadeResult', 'editable_cascade_result')
  );

  const out: any = {
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

    // 3カラム＋関連：存在すればそのまま（UI側で ?? する）
    csvFinanceData,
    businessPortfolio,
    financeSummary,

    story,
    finalStory,
    strategySummary,
    editableCascade,
    editableCascadeResult,

    // 既存項目（維持）
    questions: [],
    reasons: [],
    questions2: [],
    reasons2: [],
    answers: [],
    answers2,
    notification: '',
    role: 'member',
    departments,
  };

  return out as StrategyData;
}
