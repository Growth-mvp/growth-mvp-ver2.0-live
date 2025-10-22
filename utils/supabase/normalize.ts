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
 * story / finalStory 正規化
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
  const scoreOf = (text: string, keys: string[]) =>
    keys.reduce((acc, k) => acc + (text.includes(k) ? 1 : 0), 0);

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
 * finance / business_portfolio 正規化
 * 重要: 「空」は undefined を返す（＝保存スキップを誘導）
 * ===================================================================== */
function normalizeCsvFinanceDataLoose(input: unknown): any[] | undefined {
  if (input == null) return undefined;
  if (Array.isArray(input)) return (input.length > 0 ? input : undefined) as any[] | undefined;

  const parsed = parseIfJsonString<any>(input);

  if (Array.isArray(parsed)) return (parsed.length > 0 ? parsed : undefined);

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

  // オプション: しきい値や付帯情報も最低限チェック
  const th = bp.threshold || {};
  const validThreshold =
    typeof th.growthBaseline === 'number' && typeof th.profitBaseline === 'number';

  const validMeta =
    typeof bp.currency === 'string' &&
    typeof bp.periodLabel === 'string' &&
    typeof bp.unitType === 'string';

  // 単に {} や構造が未完成のものは undefined（保存スキップ）へ
  if (!validUnits) return undefined;

  // units が妥当であれば、残りは UI/保存側で補完可能なので通す
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

  // 年度をキーに持つ旧形式 { 2023: {...}, 2024: {...} }
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
 * StrategyData 正規化（全体）
 * 重要: 「空」は undefined にして保存スキップを誘導
 * ===================================================================== */
export function normalizeStrategyData(input: StrategyData | unknown | null): StrategyData {
  const src: any = { ...(input ?? {}) };

  const story = normalizeChaptersAny(getEither(src, 'story', 'story'));
  const finalStory = normalizeChaptersAny(getEither(src, 'finalStory', 'final_story'));
  const answers2 = asArr<any>(getEither(src, 'answers2', 'answers2'));
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

  const out: any = {
    ...src,
    story,
    finalStory,
    answers2,
    departments,
    // ⬇ 空は undefined（＝保存スキップ方針）
    ...(csvFinanceData !== undefined ? { csvFinanceData } : {}),
    ...(businessPortfolio !== undefined ? { businessPortfolio } : {}),
    ...(financeSummary !== undefined ? { financeSummary } : {}),
  };

  return out as StrategyData;
}
