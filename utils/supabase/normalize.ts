import type { StrategyData, ChapterStory } from '@/types/strategy';

/** GROWTH 固定タイトル（章タイトルはUIで固定表示） */
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

function getEither(src: unknown, camel: string, snake: string): unknown {
  const o = src as any;
  if (o && camel in o) return o[camel];
  if (o && snake in o) return o[snake];
  return undefined;
}

function parseIfJsonString<T = unknown>(v: unknown): T | unknown {
  if (typeof v === 'string') {
    const p = tryParseJson<T>(v);
    return p ?? v;
  }
  return v;
}

/* =====================================================================
 * story / finalStory 正規化（非破壊・階層維持）
 * ===================================================================== */

/** 単文文字列も1章として採用。未入力は undefined を返し、保存スキップを誘導 */
function toChapterArraySafe(input: unknown): ChapterStory[] | undefined {
  if (input == null) return undefined;

  // 素直な配列
  if (Array.isArray(input)) {
    const arr: ChapterStory[] = [];
    for (const it of input) {
      if (!it) continue;
      if (typeof it === 'string') {
        const s = it.trim();
        if (s) arr.push({ title: '', body: s });
      } else if (typeof it === 'object') {
        const t = typeof (it as any).title === 'string' ? (it as any).title : '';
        const b = typeof (it as any).body === 'string' ? (it as any).body : '';
        if (t || b) arr.push({ title: t, body: b });
      }
    }
    return arr.length ? arr : undefined;
  }

  // 文字列：JSONなら再帰、JSONでなければ単文として1章
  if (typeof input === 'string') {
    const trimmed = input.trim();
    if (!trimmed) return undefined;

    const parsed = tryParseJson<any>(trimmed);
    if (parsed && typeof parsed === 'object') {
      return toChapterArraySafe(parsed);
    }
    return [{ title: '', body: trimmed }];
  }

  // オブジェクト：key-value を章化
  if (typeof input === 'object') {
    const arr: ChapterStory[] = [];
    for (const k of Object.keys(input as any)) {
      const v = (input as any)[k];
      if (v == null) continue;
      if (typeof v === 'string' || typeof v === 'number') {
        const s = String(v).trim();
        if (s) arr.push({ title: String(k ?? ''), body: s });
      }
    }
    return arr.length ? arr : undefined;
  }

  return undefined;
}

function uniqChapters(chs?: ChapterStory[]): ChapterStory[] {
  if (!chs || !chs.length) return [];
  const seen = new Set<string>();
  const out: ChapterStory[] = [];
  for (const c of chs) {
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

/** 入力があるときだけGROWTH順で並べ替え。4章すべて空なら undefined */
function alignToGrowthOrderSafe(chs?: ChapterStory[]): ChapterStory[] | undefined {
  const base = uniqChapters(chs);
  if (!base.length) return undefined;

  const buckets = [
    { keys: ['なぜ今', '現状', '危機', '背景'] },
    { keys: ['どう戦う', '戦略', '選択', '集中', 'トレードオフ'] },
    { keys: ['未来像', '未来', 'どこへ', 'ビジョン', '顧客の風景'] },
    { keys: ['どう行動する', '行動', '社員', '当事者', 'オーナー'] },
  ];
  const used = new Set<number>();
  const scoreOf = (text: string, keys: string[]) =>
    keys.reduce((acc, k) => acc + (text.includes(k) ? 1 : 0), 0);

  const ordered: ChapterStory[] = [];
  for (const b of buckets) {
    let bestIdx = -1;
    let bestScore = -1;
    base.forEach((c, idx) => {
      if (used.has(idx)) return;
      const hay = `${c?.title ?? ''}${c?.body ?? ''}`;
      const sc = scoreOf(hay, b.keys);
      if (sc > bestScore) { bestScore = sc; bestIdx = idx; }
    });
    ordered.push(bestIdx >= 0 ? (used.add(bestIdx), base[bestIdx]) && base[bestIdx] : { title: '', body: '' });
  }

  const final = ordered.slice(0, 4).map((c, i) => ({
    title: GROWTH_TITLES[i],
    body: (c?.body ?? '').trim(),
  }));

  if (final.every(c => !c.body)) return undefined;
  return final;
}

export function normalizeChaptersAnyNonDestructive(input: unknown): ChapterStory[] | undefined {
  const arr = toChapterArraySafe(input);
  return alignToGrowthOrderSafe(arr);
}

/* =====================================================================
 * departments 正規化（非破壊）
 * ===================================================================== */
type AnyOKR =
  | { objective?: unknown; keyResults?: unknown; owner?: unknown }
  | null
  | undefined;

type AnyProject =
  | {
      title?: unknown;
      name?: unknown;
      okrs?: unknown;
      objective?: unknown;
      keyResults?: unknown;
      owner?: unknown;
    }
  | null
  | undefined;

type AnyDepartment =
  | { id?: unknown; name?: unknown; title?: unknown; projects?: unknown }
  | null
  | undefined;

type NormalizedOKR = { objective: string; keyResults: string[]; owner?: string };
type NormalizedProject = { title: string; okrs: NormalizedOKR[] };
type NormalizedDepartment = { id?: unknown; name: string; projects: NormalizedProject[] };

function normalizeOKR(input: AnyOKR): NormalizedOKR {
  const o = (input || {}) as any;
  const objective = typeof o.objective === 'string' ? o.objective : '';
  const keyResults = Array.isArray(o.keyResults)
    ? o.keyResults.map((k: any) => String(k))
    : [];
  const owner =
    o.owner !== undefined && o.owner !== null && String(o.owner) !== ''
      ? String(o.owner)
      : undefined;
  return { objective, keyResults, owner };
}

function normalizeProject(p: AnyProject): NormalizedProject {
  const obj = (p || {}) as any;
  const title =
    typeof obj.title === 'string'
      ? obj.title
      : typeof obj.name === 'string'
      ? obj.name
      : '';
  const okrsRaw = Array.isArray(obj.okrs) ? obj.okrs : [];

  const legacy =
    obj.objective || obj.keyResults || obj.owner
      ? [
          {
            objective: String(obj.objective ?? ''),
            keyResults: Array.isArray(obj.keyResults)
              ? obj.keyResults.map((k: any) => String(k))
              : [],
            owner: obj.owner ? String(obj.owner) : '',
          },
        ]
      : [];

  const okrs = [...legacy, ...okrsRaw].map(normalizeOKR);
  return { title, okrs };
}

function normalizeDepartment(d: unknown): NormalizedDepartment {
  const obj = (d || {}) as any;
  const id = obj.id ?? undefined;
  const name =
    typeof obj.name === 'string'
      ? obj.name
      : typeof obj.title === 'string'
      ? obj.title
      : '';
  const projectsRaw = Array.isArray(obj.projects) ? obj.projects : [];
  const projects = projectsRaw.map(normalizeProject);
  return { id, name, projects };
}

export function normalizeDepartmentsAny(input: unknown): NormalizedDepartment[] | undefined {
  if (!input) return undefined;
  let src: unknown = input;
  if (typeof src === 'string') {
    const parsed = tryParseJson(src);
    if (parsed && typeof parsed === 'object') return normalizeDepartmentsAny(parsed);
    return undefined;
  }
  if (Array.isArray(src)) {
    const arr = (src as unknown[]).map(normalizeDepartment);
    return arr.length ? arr : undefined;
  }
  if (typeof src === 'object' && Array.isArray((src as any).departments)) {
    const arr = (src as any).departments.map(normalizeDepartment);
    return arr.length ? arr : undefined;
  }
  return undefined;
}

/* =====================================================================
 * finance / business_portfolio 正規化
 * 重要: 「空」は undefined を返す（＝保存スキップを誘導）
 * ===================================================================== */
function normalizeCsvFinanceDataLoose(input: unknown): any[] | undefined {
  if (input == null) return undefined;
  if (Array.isArray(input)) return (input.length > 0 ? input : undefined) as any[] | undefined;

  const parsed = parseIfJsonString<any>(input);
  if (Array.isArray(parsed)) return parsed.length > 0 ? parsed : undefined;

  if (typeof input === 'string') {
    const text = input.trim();
    if (!text) return undefined;
    const rows = text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => line.split(',').map((cell) => cell.trim()));
    return rows.length > 0 ? rows : undefined;
  }

  if (typeof parsed === 'object' && parsed) return [parsed]; // 1行だけだった場合に配列化
  return undefined;
}

type PortfolioLike = {
  units?: unknown;
  threshold?: { growthBaseline?: unknown; profitBaseline?: unknown };
  currency?: unknown;
  periodLabel?: unknown;
  unitType?: unknown;
};

function normalizeBusinessPortfolio(input: unknown): Record<string, any> | undefined {
  if (input == null) return undefined;
  const p = parseIfJsonString<Record<string, any>>(input);
  if (!p || typeof p !== 'object' || Array.isArray(p)) return undefined;

  const bp = p as PortfolioLike;

  // 最低限の妥当性: units 配列が存在し、中身が1件以上ある
  const validUnits = Array.isArray(bp.units) && bp.units.length > 0;
  if (!validUnits) return undefined;

  return p;
}

/**
 * finance_summary 正規化
 * 返り値:
 *  - 有効配列: 配列 (items/年度Key形式を配列化)
 *  - 空または無効: undefined（保存スキップ）
 */
function normalizeFinanceSummaryObject(input: unknown): any[] | undefined {
  if (input == null) return undefined;
  const p = parseIfJsonString<any>(input);

  // 既に配列
  if (Array.isArray(p)) return p.length > 0 ? p : undefined;

  // 旧仕様: { items: [...] }
  if (p && typeof p === 'object' && Array.isArray((p as any).items)) {
    const arr = (p as any).items;
    return arr.length > 0 ? arr : undefined;
  }

  // 年度キー形式 { 2023: {...}, 2024: {...} }
  if (p && typeof p === 'object') {
    const entries = Object.entries(p as Record<string, any>);
    if (entries.length > 0 && entries.every(([, v]) => typeof v === 'object')) {
      const arr = entries.map(([year, data]) => ({ year: Number(year), ...data }));
      return arr.length > 0 ? arr : undefined;
    }
  }

  return undefined;
}

/* =====================================================================
 * StrategyData 正規化（全体・非破壊）
 * 重要: 「空」は undefined にして保存スキップを誘導
 * ===================================================================== */
export function normalizeStrategyData(input: StrategyData | unknown | null): StrategyData {
  const src: any = { ...(input ?? {}) };

  // 互換読み：まず新スキーマ優先（story.{draft,final,answers2}）、なければ旧トップレベル
  const storyObj = (src.story && typeof src.story === 'object') ? src.story : {};
  const storyDraftIn =
    getEither(storyObj, 'draft', 'draft') ?? getEither(src, 'story', 'story');
  const storyFinalIn =
    getEither(storyObj, 'final', 'final') ?? getEither(src, 'finalStory', 'final_story');
  const answers2In =
    getEither(storyObj, 'answers2', 'answers2') ?? getEither(src, 'answers2', 'answers2');

  const draft = normalizeChaptersAnyNonDestructive(storyDraftIn);
  const final = normalizeChaptersAnyNonDestructive(storyFinalIn);

  const answers2 =
    Array.isArray(answers2In) && answers2In.length > 0
      ? answers2In
      : undefined; // 空はundefined→保存スキップ

  const departments = normalizeDepartmentsAny(getEither(src, 'departments', 'departments'));

  const csvFinanceData = normalizeCsvFinanceDataLoose(
    getEither(src, 'csvFinanceData', 'csv_finance_data')
  );

  const businessPortfolio = normalizeBusinessPortfolio(
    getEither(src, 'businessPortfolio', 'business_portfolio')
  );

  const financeSummary = normalizeFinanceSummaryObject(
    getEither(src, 'financeSummary', 'finance_summary')
  );

  const out: any = { ...src };

  // ★ 重要：storyは階層を維持し、実体があるものだけ詰める（空配列で潰さない）
  out.story = {
    ...(storyObj || {}),
    ...(draft ? { draft } : {}),
    ...(final ? { final } : {}),
    ...(answers2 ? { answers2 } : {}),
  };

  // departments は実体が無ければ触らない（空配列で潰さない）
  if (departments && departments.length > 0) out.departments = departments;

  if (csvFinanceData !== undefined) out.csvFinanceData = csvFinanceData;
  if (businessPortfolio !== undefined) out.businessPortfolio = businessPortfolio;
  if (financeSummary !== undefined) out.financeSummary = financeSummary;

  return out as StrategyData;
}
