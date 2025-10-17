// /store/strategyStore.ts
'use client';

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { saveStrategyData as saveStrategyDataApi, getFullStrategyDataByCompany } from '@/utils/supabase/strategy';
import { useUserStore } from './userStore';

import type {
  UnitType,
  BusinessUnit,
  BusinessPortfolio,
  PortfolioThreshold,
} from '@/types/portfolio';

/* =========================
 *        Types
 * =======================*/

export type ChapterStory = { title: string; body: string };

export type AnswerStep = {
  stepNumber: number;
  question: string;
  reason: string;
  answer: string;
};

export type ChapterAnswers = {
  chapterIndex: number;
  chapterTitle: string;
  steps: AnswerStep[];
};

export type OKR = {
  objective: string;
  keyResults: string[];
  owner?: string;
};

export type Project = {
  title: string; // 必須（不足時は normalize で埋める）
  okrs: OKR[];
};

export type Department = {
  id?: string;
  name?: string;
  projects: Project[];
};

export type FinanceSummaryRow = {
  year: number;
  business_unit: string;
  revenue: number;
  operating_income: number;
  operating_margin_pct: number;
  revenue_share_pct: number;
};

/** ★ STAGE5出力を保持（Zustand / Supabase両対応） */
export type SimulationResult = {
  projection: { points: { year: string; sales: number; op: number; opMargin: number }[] };
  finalProb: number; // 0..1
  krsSnapshot?: any[];
  meta?: { label?: string; note?: string } & Record<string, any>;
} | null | undefined;

export type StrategyState = {
  strategyId: string | null;

  companyName?: string;
  foundationYear?: string;
  location?: string;
  industry?: string;
  revenue?: string;
  employees?: string;
  businessContent?: string;
  customerSegment?: string;

  thought?: string;
  mission?: string;
  vision?: string;
  value?: string;

  strength?: string;
  weakness?: string;
  opportunity?: string;
  threat?: string;

  story: ChapterStory[];
  finalStory: ChapterStory[];

  answers2: ChapterAnswers[];

  departments: Department[];

  businessPortfolio?: BusinessPortfolio;

  // ★ optional のまま維持（undefined なら保存しない／空上書きしない）
  csvFinanceData?: unknown;

  // ★ optional のまま維持（undefined なら保存しない／空上書きしない）
  financeSummary?: FinanceSummaryRow[];

  /** ★ STAGE5のシミュレーション結果（undefinedは送信抑止） */
  simulationResult?: SimulationResult;

  /* ===== actions ===== */
  reset: () => void;
  setStrategyId: (id: string | null) => void;

  setStory: (chapters: ChapterStory[]) => void;
  setFinalStory: (chapters: ChapterStory[]) => void;
  setAnswers2: (chapters: ChapterAnswers[]) => void;

  setProfile: (
    patch: Partial<
      Pick<
        StrategyState,
        | 'companyName'
        | 'foundationYear'
        | 'location'
        | 'industry'
        | 'revenue'
        | 'employees'
        | 'businessContent'
        | 'customerSegment'
      >
    >
  ) => void;

  setMVV: (patch: Partial<Pick<StrategyState, 'mission' | 'vision' | 'value' | 'thought'>>) => void;
  setSWOT: (patch: Partial<Pick<StrategyState, 'strength' | 'weakness' | 'opportunity' | 'threat'>>) => void;

  setDepartments: (deps: Department[]) => void;

  // ★ undefined/配列/JSON文字列を許容。undefined を維持すると保存しない
  setCSVFinanceData: (data: unknown) => void;

  // ★ undefined/配列/（明示クリア用に null も可）を許容
  setFinanceSummary: (rows: FinanceSummaryRow[] | undefined | null) => void;

  /** ★ STAGE5出力のセット（nullクリア可／undefinedは送信抑止） */
  setSimulationResult: (r: SimulationResult) => void;

  updateAnswerStep: (chapterIdx: number, stepIdx: number, answer: string) => Promise<void>;
  appendQuestionStep: (chapterIdx: number, step: AnswerStep) => Promise<void>;

  addDepartment: (name?: string) => Promise<void>;
  updateDepartmentName: (depIndex: number, name: string) => Promise<void>;
  removeDepartment: (depIndex: number) => Promise<void>;

  addProject: (depIndex: number, title?: string) => Promise<void>;
  updateProjectTitle: (depIndex: number, projIndex: number, title: string) => Promise<void>;
  removeProject: (depIndex: number, projIndex: number) => Promise<void>;
  moveProject: (depIndex: number, from: number, to: number) => Promise<void>;

  addOKR: (depIndex: number, projIndex: number, okr?: Partial<OKR>) => Promise<void>;
  updateOKR: (
    depIndex: number,
    projIndex: number,
    okrIndex: number,
    patch: Partial<OKR>
  ) => Promise<void>;
  removeOKR: (depIndex: number, projIndex: number, okrIndex: number) => Promise<void>;
  reorderOKRs: (depIndex: number, projIndex: number, from: number, to: number) => Promise<void>;
  setProjectOKRs: (depIndex: number, projIndex: number, okrs: OKR[]) => Promise<void>;

  setBusinessPortfolio: (p: BusinessPortfolio) => void;
  updateBusinessUnit: (id: string, patch: Partial<BusinessUnit>) => void;
  addBusinessUnit: (u?: Partial<BusinessUnit>) => void;
  removeBusinessUnit: (id: string) => void;
  setPortfolioThreshold: (patch: Partial<PortfolioThreshold>) => void;
  setPortfolioUnitType: (t: UnitType) => void;

  saveStrategyData: () => Promise<void>;
  refetchFromServer: () => Promise<void>;
};

/* =========================
 *     Initial State
 * =======================*/

// ★ financeSummary を undefined（送らない＝上書きしない）に変更
const emptyData: Omit<
  StrategyState,
  | 'reset'
  | 'setStrategyId'
  | 'setStory'
  | 'setFinalStory'
  | 'setAnswers2'
  | 'setProfile'
  | 'setMVV'
  | 'setSWOT'
  | 'setDepartments'
  | 'setCSVFinanceData'
  | 'setFinanceSummary'
  | 'setSimulationResult'
  | 'updateAnswerStep'
  | 'appendQuestionStep'
  | 'addDepartment'
  | 'updateDepartmentName'
  | 'removeDepartment'
  | 'addProject'
  | 'updateProjectTitle'
  | 'removeProject'
  | 'moveProject'
  | 'addOKR'
  | 'updateOKR'
  | 'removeOKR'
  | 'reorderOKRs'
  | 'setProjectOKRs'
  | 'setBusinessPortfolio'
  | 'updateBusinessUnit'
  | 'addBusinessUnit'
  | 'removeBusinessUnit'
  | 'setPortfolioThreshold'
  | 'setPortfolioUnitType'
  | 'saveStrategyData'
  | 'refetchFromServer'
> = {
  strategyId: null,

  companyName: '',
  foundationYear: '',
  location: '',
  industry: '',
  revenue: '',
  employees: '',
  businessContent: '',
  customerSegment: '',

  thought: '',
  mission: '',
  vision: '',
  value: '',

  strength: '',
  weakness: '',
  opportunity: '',
  threat: '',

  story: [],
  finalStory: [],
  answers2: [],

  departments: [],
  csvFinanceData: undefined,
  financeSummary: undefined,    // ★ ここを undefined に
  businessPortfolio: undefined,

  /** ★ STAGE5の結果は未設定（undefined は送信抑止） */
  simulationResult: undefined,
};

/* =========================
 *     Persist + Migrate
 * =======================*/

const STORE_VERSION = 12; // ★ version bump（simulationResult 追加）

function tryParseArrayString(v: unknown): any[] | undefined {
  if (Array.isArray(v)) return v;
  if (typeof v === 'string') {
    try {
      const j = JSON.parse(v);
      return Array.isArray(j) ? j : undefined;
    } catch {
      return undefined;
    }
  }
  return undefined;
}

function normalizeState(raw: any): StrategyState {
  const s: any = { ...raw };

  s.story = Array.isArray(s.story) ? s.story : [];
  s.finalStory = Array.isArray(s.finalStory) ? s.finalStory : [];
  s.answers2 = Array.isArray(s.answers2) ? s.answers2 : [];
  s.departments = Array.isArray(s.departments) ? s.departments : [];

  s.story = s.story.map((c: any) => ({ title: String(c?.title ?? ''), body: String(c?.body ?? '') }));
  s.finalStory = s.finalStory.map((c: any) => ({ title: String(c?.title ?? ''), body: String(c?.body ?? '') }));

  s.answers2 = s.answers2.map((c: any, i: number) => ({
    chapterIndex: typeof c?.chapterIndex === 'number' ? c.chapterIndex : i,
    chapterTitle: String(c?.chapterTitle ?? `Chapter ${i + 1}`),
    steps: Array.isArray(c?.steps)
      ? c.steps
          .map((st: any, j: number) => ({
            stepNumber: typeof st?.stepNumber === 'number' ? st.stepNumber : j + 1,
            question: String(st?.question ?? ''),
            reason: String(st?.reason ?? ''),
            answer: String(st?.answer ?? ''),
          }))
          .sort((a: AnswerStep, b: AnswerStep) => a.stepNumber - b.stepNumber)
      : [],
  }));

  s.departments = s.departments.map((d: any) => {
    const okDeps = Array.isArray(d?.projects)
      ? d.projects.map((p: any) => {
          const okrs = Array.isArray(p?.okrs) ? p.okrs : [];
          const legacyOKR =
            p?.objective || p?.keyResults || p?.owner
              ? [
                  {
                    objective: String(p?.objective ?? ''),
                    keyResults: Array.isArray(p?.keyResults) ? p.keyResults.map((k: any) => String(k)) : [],
                    owner: p?.owner ? String(p.owner) : '',
                  },
                ]
              : [];
          return {
            title: String(p?.title ?? p?.name ?? ''),
            okrs: [...legacyOKR, ...okrs].map((o: any) => ({
              objective: String(o?.objective ?? ''),
              keyResults: Array.isArray(o?.keyResults) ? o.keyResults.map((k: any) => String(k)) : [],
              owner: o?.owner ? String(o.owner) : undefined,
            })),
          } as Project;
        })
      : [];
    return {
      id: d?.id ?? undefined,
      name: String(d?.name ?? d?.title ?? ''),
      projects: okDeps,
    } as Department;
  });

  s.strategyId = s.strategyId ? String(s.strategyId) : null;

  const parsed = tryParseArrayString(s.csvFinanceData);
  s.csvFinanceData = typeof parsed !== 'undefined' ? parsed : s.csvFinanceData ?? undefined;

  // businessPortfolio（snake互換）
  const bp = (raw?.businessPortfolio ?? raw?.business_portfolio) as any;
  if (bp && typeof bp === 'object') {
    const units = Array.isArray(bp.units)
      ? bp.units.map((u: any, i: number) => ({
          id: String(u?.id ?? `${i}`),
          name: String(u?.name ?? `Unit ${i + 1}`),
          revenueShare: Number.isFinite(+u?.revenueShare) ? +u.revenueShare : 0,
          growthRate: Number.isFinite(+u?.growthRate) ? +u.growthRate : 0,
          profitMargin: Number.isFinite(+u?.profitMargin) ? +u.profitMargin : 0,
          stage: u?.stage,
          note: u?.note ? String(u.note) : undefined,
          color: u?.color ? String(u.color) : undefined,
        }))
      : [];

    const threshold = {
      growthBaseline: Number.isFinite(+bp?.threshold?.growthBaseline) ? +bp.threshold.growthBaseline : 5,
      profitBaseline: Number.isFinite(+bp?.threshold?.profitBaseline) ? +bp.threshold.profitBaseline : 10,
    };

    s.businessPortfolio = {
      units,
      threshold,
      currency: (bp?.currency === 'USD' || bp?.currency === 'EUR') ? bp.currency : 'JPY',
      periodLabel: String(bp?.periodLabel ?? 'FY2025'),
      unitType: (bp?.unitType === 'product' || bp?.unitType === 'service') ? bp.unitType : 'business',
    } as BusinessPortfolio;
  } else if (typeof s.businessPortfolio === 'undefined' && typeof raw?.business_portfolio === 'undefined') {
    s.businessPortfolio = undefined;
  }

  // financeSummary（snake互換）
  const fs = (raw?.financeSummary ?? raw?.finance_summary) as any;
  if (Array.isArray(fs)) {
    s.financeSummary = fs.map((r: any) => ({
      year: Number.isFinite(Number(r?.year)) ? Number(r?.year) : 0,
      business_unit: String(r?.business_unit ?? r?.businessUnit ?? r?.bu ?? ''),
      revenue: Number.isFinite(Number(r?.revenue)) ? Math.round(Number(r?.revenue)) : 0,
      operating_income: Number.isFinite(Number(r?.operating_income ?? r?.operatingIncome)) ? Math.round(Number(r?.operating_income ?? r?.operatingIncome)) : 0,
      operating_margin_pct: Number.isFinite(Number(r?.operating_margin_pct ?? r?.operatingMarginPct)) ? Number(Number(r?.operating_margin_pct ?? r?.operatingMarginPct).toFixed(1)) : 0,
      revenue_share_pct: Number.isFinite(Number(r?.revenue_share_pct ?? r?.revenueSharePct)) ? Number(Number(r?.revenue_share_pct ?? r?.revenueSharePct).toFixed(1)) : 0,
    })) as FinanceSummaryRow[];
  } else if (typeof s.financeSummary === 'undefined') {
    s.financeSummary = undefined; // ★ 未取得なら未定義のまま
  }

  // ★ simulationResult（snake互換）：object 以外は未設定扱い
  const sim = (raw?.simulationResult ?? raw?.simulation_result) as any;
  if (sim && typeof sim === 'object') {
    try {
      const points = Array.isArray(sim?.projection?.points) ? sim.projection.points : [];
      s.simulationResult = {
        projection: {
          points: points.map((p: any) => ({
            year: String(p?.year ?? ''),
            sales: Math.round(Number(p?.sales ?? 0)),
            op: Math.round(Number(p?.op ?? 0)),
            opMargin: Number.isFinite(Number(p?.opMargin)) ? Number(Number(p?.opMargin).toFixed(4)) : 0,
          })),
        },
        finalProb: Number.isFinite(Number(sim?.finalProb)) ? Number(sim.finalProb) : 0,
        krsSnapshot: Array.isArray(sim?.krsSnapshot) ? sim.krsSnapshot : undefined,
        meta: sim?.meta && typeof sim.meta === 'object' ? sim.meta : undefined,
      } as SimulationResult;
    } catch {
      s.simulationResult = undefined;
    }
  } else if (typeof s.simulationResult === 'undefined') {
    s.simulationResult = undefined;
  }

  return s as StrategyState;
}

/* =========================
 *       Helpers
 * =======================*/

function clamp1to3(n: number) {
  return Math.max(1, Math.min(3, Number.isFinite(n) ? n : 1));
}

/** saveStrategyData 用のペイロード整形（“条件付きで送る”） */
function buildSavePayload(s: StrategyState) {
  const base: any = {
    strategyId: s.strategyId,
    companyName: s.companyName,
    foundationYear: s.foundationYear,
    location: s.location,
    industry: s.industry,
    revenue: s.revenue,
    employees: s.employees,
    businessContent: s.businessContent,
    customerSegment: s.customerSegment,
    thought: s.thought,
    mission: s.mission,
    vision: s.vision,
    value: s.value,
    strength: s.strength,
    weakness: s.weakness,
    opportunity: s.opportunity,
    threat: s.threat,
    story: s.story,
    finalStory: s.finalStory,
    answers2: s.answers2,
    departments: s.departments,
  };

  // ★ businessPortfolio：undefined なら送らない／null は消去意図でそのまま送る
  if (typeof s.businessPortfolio !== 'undefined') base.businessPortfolio = s.businessPortfolio;

  // ★ csvFinanceData：配列なら送る。null は明示クリア、undefined は送らない
  if (s.csvFinanceData === null) base.csvFinanceData = null;
  else if (Array.isArray(s.csvFinanceData)) base.csvFinanceData = s.csvFinanceData;

  // ★ financeSummary：配列(>0)なら送る。null は明示クリア、undefined は送らない
  if (s.financeSummary === null) base.financeSummary = null;
  else if (Array.isArray(s.financeSummary) && s.financeSummary.length > 0) base.financeSummary = s.financeSummary;

  // ★ simulationResult：null は明示クリア、object なら送る、undefined は送らない
  if (s.simulationResult === null) base.simulationResult = null;
  else if (s.simulationResult && typeof s.simulationResult === 'object') base.simulationResult = s.simulationResult;

  return base;
}

/** 共通：現在のストア内容を Supabase へ保存 */
async function commitSave(get: () => StrategyState) {
  const userId = useUserStore.getState().user?.id;
  const companyId = useUserStore.getState().companyId;
  if (!userId) return;
  try {
    const r = await saveStrategyDataApi(buildSavePayload(get()), userId, companyId);
    if (r?.error) console.warn('saveStrategyData returned error (see console above for details):', r.error);
  } catch (e) {
    console.warn('commitSave failed', e);
  }
}

/** 🔄 デバウンス保存 */
let saveTimer: ReturnType<typeof setTimeout> | null = null;
let saving = false;
let lastSnapshot: any = null;

function scheduleSave(get: () => StrategyState, delayMs = 600) {
  lastSnapshot = buildSavePayload(get());
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(runSave, delayMs);
}

async function runSave() {
  if (saving) return;
  saving = true;
  const userId = useUserStore.getState().user?.id;
  const companyId = useUserStore.getState().companyId;
  if (!userId) { saving = false; return; }

  const payload = lastSnapshot;
  const timeout = new Promise<void>((resolve) => setTimeout(resolve, 5000));

  try {
    const r: any = await Promise.race([
      saveStrategyDataApi(payload, userId, companyId),
      timeout,
    ]);
    if (r?.error) console.warn('debounced saveStrategyData error (see detailed log above):', r.error);
  } catch (e) {
    console.warn('scheduleSave failed', e);
  } finally {
    saving = false;
  }
}

function arrayMove<T>(arr: T[], from: number, to: number): T[] {
  const copy = [...arr];
  if (from < 0 || from >= copy.length || to < 0 || to >= copy.length) return copy;
  const [item] = copy.splice(from, 1);
  copy.splice(to, 0, item);
  return copy;
}

const BP_COLORS = ['#4f46e5','#059669','#dc2626','#d97706','#2563eb','#16a34a','#ea580c','#7c3aed'];

function cryptoRandomId() {
  try {
    const arr = new Uint32Array(4);
    crypto.getRandomValues(arr);
    return Array.from(arr).map(n => n.toString(16).padStart(8, '0')).join('');
  } catch {
    return Math.random().toString(36).slice(2);
  }
}

/* =========================
 *         Store
 * =======================*/

export const useStrategyStore = create<StrategyState>()(
  persist(
    (set, get) => ({
      ...emptyData,

      reset: () => set(() => ({ ...emptyData })),

      setStrategyId: (id: string | null) => set(() => ({ strategyId: id ?? null })),

      setStory: (chapters: ChapterStory[]) => set(() => ({ story: [...chapters] })),

      setFinalStory: (chapters: ChapterStory[]) => set(() => ({ finalStory: [...chapters] })),

      setAnswers2: (chapters: ChapterAnswers[]) =>
        set(() => ({
          answers2: [...chapters].map((c) => ({
            ...c,
            steps: [...(c.steps ?? [])].sort((a, b) => a.stepNumber - b.stepNumber),
          })),
        })),

      setProfile: (patch) => set((s) => ({ ...s, ...patch })),

      setMVV: (patch) => set((s) => ({ ...s, ...patch })),

      setSWOT: (patch) => set((s) => ({ ...s, ...patch })),

      setDepartments: (deps) => set(() => ({ departments: [...deps] })),

      // ★ 保存をデバウンスで走らせる＆undefined を維持
      setCSVFinanceData: (data) =>
        set((state) => {
          const parsed = tryParseArrayString(data);
          const next = typeof parsed !== 'undefined' ? parsed : data;
          const out = { ...state, csvFinanceData: next };
          scheduleSave(get);
          return out;
        }),

      // ★ 保存をデバウンスで走らせる＆null で明示クリア可
      setFinanceSummary: (rows) =>
        set((state) => {
          let next: FinanceSummaryRow[] | undefined | null = rows as any;
          if (Array.isArray(rows)) {
            next = rows.map((r) => ({
              year: Number.isFinite(+r?.year) ? +r.year : 0,
              business_unit: String((r as any)?.business_unit ?? ''),
              revenue: Number.isFinite(+r?.revenue) ? Math.round(+r.revenue) : 0,
              operating_income: Number.isFinite(+r?.operating_income) ? Math.round(+r.operating_income) : 0,
              operating_margin_pct: Number.isFinite(+r?.operating_margin_pct) ? Number((+r.operating_margin_pct).toFixed(1)) : 0,
              revenue_share_pct: Number.isFinite(+r?.revenue_share_pct) ? Number((+r.revenue_share_pct).toFixed(1)) : 0,
            }));
          }
          const out = { ...state, financeSummary: next as any };
          scheduleSave(get);
          return out;
        }),

      /** ★ STAGE5結果の設定：nullで明示クリア、undefinedなら送信抑止のまま */
      setSimulationResult: (r) =>
        set((state) => {
          const next = r === null ? null : (r && typeof r === 'object' ? r : undefined);
          const out = { ...state, simulationResult: next as SimulationResult };
          scheduleSave(get);
          return out;
        }),

      async appendQuestionStep(chapterIdx, step) {
        const st = get();
        const answers2: ChapterAnswers[] = Array.isArray(st.answers2) ? [...st.answers2] : [];
        let chapter = answers2.find((c) => c.chapterIndex === chapterIdx);

        if (!chapter) {
          const title =
            st.story?.[chapterIdx]?.title ??
            st.finalStory?.[chapterIdx]?.title ??
            `Chapter ${chapterIdx + 1}`;
          chapter = { chapterIndex: chapterIdx, chapterTitle: String(title || ''), steps: [] };
          answers2.push(chapter);
        }

        const steps: AnswerStep[] = Array.isArray(chapter.steps) ? [...chapter.steps] : [];
        const used = new Set(steps.map((s) => clamp1to3(s.stepNumber)));
        let finalNo = clamp1to3(step.stepNumber);
        if (used.has(finalNo)) {
          for (let n = 1; n <= 3; n++) {
            if (!used.has(n)) { finalNo = n; break; }
          }
        }

        const nextStep: AnswerStep = {
          stepNumber: finalNo,
          question: String(step.question ?? ''),
          reason: String(step.reason ?? ''),
          answer: String(step.answer ?? ''),
        };

        const idxSame = steps.findIndex((s) => s.stepNumber === finalNo);
        if (idxSame >= 0) steps[idxSame] = nextStep; else steps.push(nextStep);
        steps.sort((a, b) => a.stepNumber - b.stepNumber);

        const chapterIdxInArray = answers2.findIndex((c) => c.chapterIndex === chapterIdx);
        const nextChapter: ChapterAnswers = { ...chapter, steps };
        if (chapterIdxInArray >= 0) answers2[chapterIdxInArray] = nextChapter;
        else answers2.push(nextChapter);

        set({ answers2 });
        scheduleSave(get);
      },

      async updateAnswerStep(chapterIdx, stepIdx, answer) {
        const st = get();
        const answers2: ChapterAnswers[] = Array.isArray(st.answers2) ? [...st.answers2] : [];
        let chapter = answers2.find((c) => c.chapterIndex === chapterIdx);

        if (!chapter) {
          const title =
            st.story?.[chapterIdx]?.title ??
            st.finalStory?.[chapterIdx]?.title ??
            `Chapter ${chapterIdx + 1}`;
          chapter = { chapterIndex: chapterIdx, chapterTitle: String(title || ''), steps: [] };
          answers2.push(chapter);
        }

        let steps: AnswerStep[] = Array.isArray(chapter.steps) ? [...chapter.steps] : [];
        if (!steps[stepIdx]) {
          const used = new Set(steps.map((s) => clamp1to3(s.stepNumber)));
          let assign = clamp1to3(stepIdx + 1);
          if (used.has(assign)) {
            for (let n = 1; n <= 3; n++) { if (!used.has(n)) { assign = n; break; } }
          }
          steps[stepIdx] = { stepNumber: assign, question: '', reason: '', answer: '' };
        }

        steps[stepIdx] = { ...steps[stepIdx], answer: String(answer ?? '') };
        steps = steps.sort((a, b) => a.stepNumber - b.stepNumber);

        const idx = answers2.findIndex((c) => c.chapterIndex === chapterIdx);
        const nextChapter: ChapterAnswers = { ...chapter, steps };
        if (idx >= 0) answers2[idx] = nextChapter; else answers2.push(nextChapter);

        set({ answers2 });
        scheduleSave(get);
      },

      /* ---------- 部門 ---------- */

      async addDepartment(name) {
        const deps = [...(get().departments ?? [])];
        deps.push({ name: name ?? '', projects: [] });
        set({ departments: deps });
        await commitSave(get);
      },

      async updateDepartmentName(depIndex, name) {
        const deps = [...(get().departments ?? [])];
        if (!deps[depIndex]) return;
        deps[depIndex] = { ...(deps[depIndex] ?? {}), name: String(name ?? '') };
        set({ departments: deps });
        await commitSave(get);
      },

      async removeDepartment(depIndex) {
        const deps = [...(get().departments ?? [])];
        if (depIndex < 0 || depIndex >= deps.length) return;
        deps.splice(depIndex, 1);
        set({ departments: deps });
        await commitSave(get);
      },

      /* ---------- プロジェクト ---------- */

      async addProject(depIndex, title) {
        const deps = [...(get().departments ?? [])];
        if (!deps[depIndex]) return;
        const projects = [...(deps[depIndex].projects ?? [])];
        projects.push({ title: String(title ?? ''), okrs: [] });
        deps[depIndex] = { ...(deps[depIndex] ?? {}), projects };
        set({ departments: deps });
        await commitSave(get);
      },

      async updateProjectTitle(depIndex, projIndex, title) {
        const deps = [...(get().departments ?? [])];
        if (!deps[depIndex]) return;
        const projects = [...(deps[depIndex].projects ?? [])];
        if (!projects[projIndex]) return;
        projects[projIndex] = { ...(projects[projIndex] ?? { okrs: [] }), title: String(title ?? '') };
        deps[depIndex] = { ...(deps[depIndex] ?? {}), projects };
        set({ departments: deps });
        await commitSave(get);
      },

      async removeProject(depIndex, projIndex) {
        const deps = [...(get().departments ?? [])];
        if (!deps[depIndex]) return;
        const projects = [...(deps[depIndex].projects ?? [])];
        if (projIndex < 0 || projIndex >= projects.length) return;
        projects.splice(projIndex, 1);
        deps[depIndex] = { ...(deps[depIndex] ?? {}), projects };
        set({ departments: deps });
        await commitSave(get);
      },

      async moveProject(depIndex, from, to) {
        const deps = [...(get().departments ?? [])];
        if (!deps[depIndex]) return;
        const projects = [...(deps[depIndex].projects ?? [])];
        const moved = arrayMove(projects, from, to);
        deps[depIndex] = { ...(deps[depIndex] ?? {}), projects: moved };
        set({ departments: deps });
        await commitSave(get);
      },

      /* ---------- OKR ---------- */

      async addOKR(depIndex, projIndex, okr) {
        const deps = [...(get().departments ?? [])];
        if (!deps[depIndex]) return;
        const projects = [...(deps[depIndex].projects ?? [])];
        if (!projects[projIndex]) return;
        const okrs = [...(projects[projIndex].okrs ?? [])];
        okrs.push({
          objective: String(okr?.objective ?? ''),
          keyResults: Array.isArray(okr?.keyResults) ? okr!.keyResults.map((k) => String(k)) : [],
          owner: okr?.owner ? String(okr.owner) : undefined,
        });
        projects[projIndex] = { ...(projects[projIndex] ?? { title: '' }), okrs };
        deps[depIndex] = { ...(deps[depIndex] ?? {}), projects };
        set({ departments: deps });
        await commitSave(get);
      },

      async updateOKR(depIndex, projIndex, okrIndex, patch) {
        const deps = [...(get().departments ?? [])];
        if (!deps[depIndex]) return;
        const projects = [...(deps[depIndex].projects ?? [])];
        if (!projects[projIndex]) return;
        const okrs = [...(projects[projIndex].okrs ?? [])];
        if (!okrs[okrIndex]) return;

        const next: OKR = {
          objective: patch.objective !== undefined ? String(patch.objective) : String(okrs[okrIndex].objective ?? ''),
          keyResults:
            patch.keyResults !== undefined
              ? Array.isArray(patch.keyResults)
                ? patch.keyResults.map((k) => String(k))
                : []
              : Array.isArray(okrs[okrIndex].keyResults)
              ? okrs[okrIndex].keyResults.map((k) => String(k))
              : [],
          owner:
            patch.owner !== undefined
              ? (patch.owner ? String(patch.owner) : undefined)
              : okrs[okrIndex].owner,
        };

        okrs[okrIndex] = next;
        projects[projIndex] = { ...(projects[projIndex] ?? { title: '' }), okrs };
        deps[depIndex] = { ...(deps[depIndex] ?? {}), projects };
        set({ departments: deps });
        await commitSave(get);
      },

      async removeOKR(depIndex, projIndex, okrIndex) {
        const deps = [...(get().departments ?? [])];
        if (!deps[depIndex]) return;
        const projects = [...(deps[depIndex].projects ?? [])];
        if (!projects[projIndex]) return;
        const okrs = [...(projects[projIndex].okrs ?? [])];
        if (okrIndex < 0 || okrIndex >= okrs.length) return;

        okrs.splice(okrIndex, 1);
        projects[projIndex] = { ...(projects[projIndex] ?? { title: '' }), okrs };
        deps[depIndex] = { ...(deps[depIndex] ?? {}), projects };
        set({ departments: deps });
        await commitSave(get);
      },

      async reorderOKRs(depIndex, projIndex, from, to) {
        const deps = [...(get().departments ?? [])];
        if (!deps[depIndex]) return;
        const projects = [...(deps[depIndex].projects ?? [])];
        if (!projects[projIndex]) return;
        const okrs = [...(projects[projIndex].okrs ?? [])];

        const moved = arrayMove(okrs, from, to);
        projects[projIndex] = { ...(projects[projIndex] ?? { title: '' }), okrs: moved };
        deps[depIndex] = { ...(deps[depIndex] ?? {}), projects };
        set({ departments: deps });
        await commitSave(get);
      },

      async setProjectOKRs(depIndex, projIndex, okrs) {
        const deps = [...(get().departments ?? [])];
        if (!deps[depIndex]) return;
        const projects = [...(deps[depIndex].projects ?? [])];

        const safe = Array.isArray(okrs)
          ? okrs.map((o) => ({
              objective: String(o?.objective ?? ''),
              keyResults: Array.isArray(o?.keyResults) ? o.keyResults.map((k) => String(k)) : [],
              owner: o?.owner ? String(o.owner) : undefined,
            }))
          : [];

        projects[projIndex] = { ...(projects[projIndex] ?? { title: '' }), okrs: safe };
        deps[depIndex] = { ...(deps[depIndex] ?? {}), projects };
        set({ departments: deps });
        await commitSave(get);
      },

      /* ---------- 事業ポートフォリオ（保存はデバウンス） ---------- */

      setBusinessPortfolio: (p) => {
        const safeUnits = Array.isArray(p?.units)
          ? p.units.map((u, i) => ({
              id: String(u?.id ?? cryptoRandomId()),
              name: String(u?.name ?? `Unit ${i + 1}`),
              revenueShare: Number.isFinite(+u?.revenueShare) ? +u.revenueShare : 0,
              growthRate: Number.isFinite(+u?.growthRate) ? +u.growthRate : 0,
              profitMargin: Number.isFinite(+u?.profitMargin) ? +u.profitMargin : 0,
              stage: u?.stage,
              note: u?.note,
              color: u?.color ?? BP_COLORS[i % BP_COLORS.length],
            }))
          : [];
        const safe: BusinessPortfolio = {
          units: safeUnits,
          threshold: {
            growthBaseline: Number.isFinite(+p?.threshold?.growthBaseline) ? +p!.threshold!.growthBaseline : 5,
            profitBaseline: Number.isFinite(+p?.threshold?.profitBaseline) ? +p!.threshold!.profitBaseline : 10,
          },
          currency: (p?.currency === 'USD' || p?.currency === 'EUR') ? p!.currency : 'JPY',
          periodLabel: String(p?.periodLabel ?? 'FY2025'),
          unitType: (p?.unitType === 'product' || p?.unitType === 'service') ? p!.unitType : 'business',
        };
        set({ businessPortfolio: safe });
        scheduleSave(get);
      },

      updateBusinessUnit: (id, patch) => {
        const cur = get().businessPortfolio;
        if (!cur) return;
        const units = cur.units.map(u => u.id === id ? {
          ...u,
          ...(patch.name !== undefined ? { name: String(patch.name) } : {}),
          ...(patch.revenueShare !== undefined ? { revenueShare: Number(patch.revenueShare) } : {}),
          ...(patch.growthRate !== undefined ? { growthRate: Number(patch.growthRate) } : {}),
          ...(patch.profitMargin !== undefined ? { profitMargin: Number(patch.profitMargin) } : {}),
          ...(patch.note !== undefined ? { note: patch.note } : {}),
          ...(patch.color !== undefined ? { color: patch.color } : {}),
          ...(patch.stage !== undefined ? { stage: patch.stage } : {}),
        } : u);
        set({ businessPortfolio: { ...cur, units } });
        scheduleSave(get);
      },

      addBusinessUnit: (u) => {
        const cur = get().businessPortfolio ?? {
          units: [],
          threshold: { growthBaseline: 5, profitBaseline: 10 },
          currency: 'JPY' as const,
          periodLabel: 'FY2025',
          unitType: 'business' as const,
        };
        const idx = cur.units.length;
        const nu: BusinessUnit = {
          id: cryptoRandomId(),
          name: String(u?.name ?? `Unit ${idx + 1}`),
          revenueShare: Number.isFinite(+u?.revenueShare!) ? +u!.revenueShare! : 10,
          growthRate: Number.isFinite(+u?.growthRate!) ? +u!.growthRate! : 0,
          profitMargin: Number.isFinite(+u?.profitMargin!) ? +u!.profitMargin! : 0,
          note: u?.note,
          color: u?.color ?? BP_COLORS[idx % BP_COLORS.length],
        };
        set({ businessPortfolio: { ...cur, units: [...cur.units, nu] } });
        scheduleSave(get);
      },

      removeBusinessUnit: (id) => {
        const cur = get().businessPortfolio;
        if (!cur) return;
        const units = cur.units.filter(u => u.id !== id);
        set({ businessPortfolio: { ...cur, units } });
        scheduleSave(get);
      },

      setPortfolioThreshold: (patch) => {
        const cur = get().businessPortfolio;
        if (!cur) return;
        const th = {
          growthBaseline: Number.isFinite(+patch.growthBaseline!) ? +patch.growthBaseline! : cur.threshold.growthBaseline,
          profitBaseline: Number.isFinite(+patch.profitBaseline!) ? +patch.profitBaseline! : cur.threshold.profitBaseline,
        };
        set({ businessPortfolio: { ...cur, threshold: th } });
        scheduleSave(get);
      },

      setPortfolioUnitType: (t) => {
        const cur = get().businessPortfolio;
        const type: UnitType = (t === 'product' || t === 'service') ? t : 'business';
        if (!cur) {
          set({
            businessPortfolio: {
              units: [],
              threshold: { growthBaseline: 5, profitBaseline: 10 },
              currency: 'JPY',
              periodLabel: 'FY2025',
              unitType: type,
            },
          });
        } else {
          set({ businessPortfolio: { ...cur, unitType: type } });
        }
        scheduleSave(get);
      },

      /* ---------- 明示保存 ---------- */
      async saveStrategyData() {
        const st = get();
        const userId = useUserStore.getState().user?.id;
        const companyId = useUserStore.getState().companyId;
        if (!userId) throw new Error('userId が未設定です');

        const res = await saveStrategyDataApi(buildSavePayload(st), userId, companyId);
        if (res?.error) {
          console.error('saveStrategyData error:', res.error);
          throw res.error;
        }
      },

      /* ---------- サーバ再取得 ---------- */
      refetchFromServer: async () => {
        try {
          const companyId = useUserStore.getState().companyId;
          if (!companyId) {
            console.info('refetchFromServer: companyId is not set yet');
            return;
          }

          const { data, error } = await getFullStrategyDataByCompany(companyId);
          if (error) throw error;

          if (!data) {
            console.info('refetchFromServer: no server record found for company', companyId);
            return;
          }

          const incoming: any = {
            strategyId: (data as any)?.strategyId ?? (data as any)?.id ?? (data as any)?.strategy_id,

            companyName: (data as any)?.companyName ?? (data as any)?.company_name ?? '',
            foundationYear: (data as any)?.foundationYear ?? (data as any)?.foundation_year ?? '',
            location: (data as any)?.location ?? '',
            industry: (data as any)?.industry ?? '',
            revenue: (data as any)?.revenue ?? '',
            employees: (data as any)?.employees ?? '',
            businessContent: (data as any)?.businessContent ?? (data as any)?.business_content ?? '',
            customerSegment: (data as any)?.customerSegment ?? (data as any)?.customer_segment ?? '',

            thought: (data as any)?.thought ?? '',
            mission: (data as any)?.mission ?? '',
            vision: (data as any)?.vision ?? '',
            value: (data as any)?.value ?? '',

            strength: (data as any)?.strength ?? '',
            weakness: (data as any)?.weakness ?? '',
            opportunity: (data as any)?.opportunity ?? '',
            threat: (data as any)?.threat ?? '',

            story: (data as any)?.story ?? [],
            finalStory: (data as any)?.finalStory ?? (data as any)?.finalstory ?? [],
            answers2: (data as any)?.answers2 ?? [],
            departments: (data as any)?.departments ?? [],

            // ★ 取得できなければ undefined のまま（[] で埋めない）
            csvFinanceData: (data as any)?.csvFinanceData ?? (data as any)?.csv_finance_data ?? undefined,
            businessPortfolio: (data as any)?.businessPortfolio ?? (data as any)?.business_portfolio ?? undefined,
            financeSummary: (data as any)?.financeSummary ?? (data as any)?.finance_summary ?? undefined,

            // ★ simulation_result（snake互換）
            simulationResult: (data as any)?.simulationResult ?? (data as any)?.simulation_result ?? undefined,
          };

          const normalized = normalizeState(incoming);
          set((s) => ({ ...s, ...normalized }));
        } catch (e: any) {
          const msg = e?.message || e?.details || e?.hint || String(e);
          console.error('refetchFromServer failed:', msg);
        }
      },
    }),
    {
      name: 'strategy-store',
      version: STORE_VERSION,

      migrate: (persisted: any) => {
        try {
          const normalized = normalizeState(persisted ?? {});
          return { ...emptyData, ...normalized };
        } catch (e) {
          console.warn('migrate failed, fallback to emptyData', e);
          return { ...emptyData };
        }
      },

      partialize: (s) => ({
        strategyId: s.strategyId,
        companyName: s.companyName,
        foundationYear: s.foundationYear,
        location: s.location,
        industry: s.industry,
        revenue: s.revenue,
        employees: s.employees,
        businessContent: s.businessContent,
        customerSegment: s.customerSegment,
        thought: s.thought,
        mission: s.mission,
        vision: s.vision,
        value: s.value,
        strength: s.strength,
        weakness: s.weakness,
        opportunity: s.opportunity,
        threat: s.threat,
        story: s.story,
        finalStory: s.finalStory,
        answers2: s.answers2,
        departments: s.departments,
        csvFinanceData: s.csvFinanceData,       // 永続
        businessPortfolio: s.businessPortfolio, // 永続
        financeSummary: s.financeSummary,       // 永続（undefined なら書かれない）
        simulationResult: s.simulationResult,   // ★ 永続（undefinedなら書かれない）
      }),

      storage: createJSONStorage(() => localStorage),
      onRehydrateStorage: () => (state, error) => {
        if (error) {
          console.warn('rehydration error, resetting to emptyData', error);
        } else if (state) {
          const cur = (state as any).csvFinanceData;
          const parsed = tryParseArrayString(cur);
          if (typeof parsed !== 'undefined') (state as any).csvFinanceData = parsed;

          if (typeof (state as any).strategyId === 'undefined') {
            (state as any).strategyId = null;
          }

          // ★ financeSummary は存在時のみ整形。無ければ undefined のまま
          if (Array.isArray((state as any).financeSummary)) {
            (state as any).financeSummary = (state as any).financeSummary.map((r: any) => ({
              year: Number.isFinite(+r?.year) ? +r.year : 0,
              business_unit: String(r?.business_unit ?? ''),
              revenue: Number.isFinite(+r?.revenue) ? Math.round(+r.revenue) : 0,
              operating_income: Number.isFinite(+r?.operating_income) ? Math.round(+r.operating_income) : 0,
              operating_margin_pct: Number.isFinite(+r?.operating_margin_pct) ? Number((+r.operating_margin_pct).toFixed(1)) : 0,
              revenue_share_pct: Number.isFinite(+r?.revenue_share_pct) ? Number((+r.revenue_share_pct).toFixed(1)) : 0,
            })) as FinanceSummaryRow[];
          }

          // ★ simulationResult は object のみ保持（その他は未設定扱い）
          const sim = (state as any).simulationResult;
          if (sim && typeof sim === 'object') {
            try {
              const points = Array.isArray(sim?.projection?.points) ? sim.projection.points : [];
              (state as any).simulationResult = {
                projection: {
                  points: points.map((p: any) => ({
                    year: String(p?.year ?? ''),
                    sales: Math.round(Number(p?.sales ?? 0)),
                    op: Math.round(Number(p?.op ?? 0)),
                    opMargin: Number.isFinite(Number(p?.opMargin)) ? Number(Number(p?.opMargin).toFixed(4)) : 0,
                  })),
                },
                finalProb: Number.isFinite(Number(sim?.finalProb)) ? Number(sim.finalProb) : 0,
                krsSnapshot: Array.isArray(sim?.krsSnapshot) ? sim.krsSnapshot : undefined,
                meta: sim?.meta && typeof sim.meta === 'object' ? sim.meta : undefined,
              } as SimulationResult;
            } catch {
              (state as any).simulationResult = undefined;
            }
          } else if (typeof sim !== 'undefined' && sim !== null && typeof sim !== 'object') {
            (state as any).simulationResult = undefined;
          }
        }
      },
    }
  )
);

export async function refetchFromServer() {
  return useStrategyStore.getState().refetchFromServer();
}
