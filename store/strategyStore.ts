// /store/strategyStore.ts
'use client';

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { saveStrategyData, getFullStrategyDataByCompany } from '@/utils/supabase/strategy';
import { useUserStore } from './userStore';

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

export type StrategyState = {
  // meta
  strategyId?: string;

  // company profile
  companyName?: string;
  foundationYear?: string;
  location?: string;
  industry?: string;
  revenue?: string;
  employees?: string;
  businessContent?: string;
  customerSegment?: string;

  // narrative inputs
  thought?: string;
  mission?: string;
  vision?: string;
  value?: string;

  // SWOT
  strength?: string;
  weakness?: string;
  opportunity?: string;
  threat?: string;

  // stories
  story: ChapterStory[];       // draft
  finalStory: ChapterStory[];  // final

  // Q&A
  answers2: ChapterAnswers[];

  // 部門→プロジェクト→OKR
  departments: Department[];

  // 財務CSV（配列 or JSON文字列を許容）
  csvFinanceData?: unknown;

  /* ===== actions ===== */
  reset: () => void;
  setStrategyId: (id?: string) => void;

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
  setCSVFinanceData: (data: unknown) => void;

  // 掘り下げQA
  updateAnswerStep: (chapterIdx: number, stepIdx: number, answer: string) => Promise<void>;
  appendQuestionStep: (chapterIdx: number, step: AnswerStep) => Promise<void>;

  // 部門操作
  addDepartment: (name?: string) => Promise<void>;
  updateDepartmentName: (depIndex: number, name: string) => Promise<void>;
  removeDepartment: (depIndex: number) => Promise<void>;

  // プロジェクト操作
  addProject: (depIndex: number, title?: string) => Promise<void>;
  updateProjectTitle: (depIndex: number, projIndex: number, title: string) => Promise<void>;
  removeProject: (depIndex: number, projIndex: number) => Promise<void>;
  moveProject: (depIndex: number, from: number, to: number) => Promise<void>;

  // OKR操作
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

  // サーバーから再取得（← companyId 起点・引数なし）
  refetchFromServer: () => Promise<void>;
};

/* =========================
 *     Initial State
 * =======================*/

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
  | 'refetchFromServer'
> = {
  strategyId: undefined,

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
};

/* =========================
 *     Persist + Migrate
 * =======================*/

const STORE_VERSION = 8; // bump: ステップ番号のローカル整合強化

/** ゆるい JSON 文字列 → 配列 変換（失敗時は undefined） */
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

// 旧データを現行スキーマへ正規化
function normalizeState(raw: any): StrategyState {
  const s: any = { ...raw };

  // 配列の土台
  s.story = Array.isArray(s.story) ? s.story : [];
  s.finalStory = Array.isArray(s.finalStory) ? s.finalStory : [];
  s.answers2 = Array.isArray(s.answers2) ? s.answers2 : [];
  s.departments = Array.isArray(s.departments) ? s.departments : [];

  // 章
  s.story = s.story.map((c: any) => ({
    title: String(c?.title ?? ''),
    body: String(c?.body ?? ''),
  }));
  s.finalStory = s.finalStory.map((c: any) => ({
    title: String(c?.title ?? ''),
    body: String(c?.body ?? ''),
  }));

  // Q&A
  s.answers2 = s.answers2.map((c: any, i: number) => ({
    chapterIndex: typeof c?.chapterIndex === 'number' ? c.chapterIndex : i,
    chapterTitle: String(c?.chapterTitle ?? `Chapter ${i + 1}`),
    steps: Array.isArray(c?.steps)
      ? c.steps
          .map((st: any, j: number) => ({
            stepNumber: typeof st?.stepNumber === 'number' ? clamp1to3(st.stepNumber) : clamp1to3(j + 1),
            question: String(st?.question ?? ''),
            reason: String(st?.reason ?? ''),
            answer: String(st?.answer ?? ''),
          }))
          .sort((a: AnswerStep, b: AnswerStep) => a.stepNumber - b.stepNumber)
      : [],
  }));

  // Departments/Projects/OKR 正規化（name/title の揺れや旧フィールドを吸収）
  s.departments = s.departments.map((d: any) => ([
    {
      id: d?.id ?? undefined,
      name: String(d?.name ?? d?.title ?? ''),
      projects: Array.isArray(d?.projects)
        ? d.projects.map((p: any) => {
            const okrs = Array.isArray(p?.okrs) ? p.okrs : [];

            // レガシーフィールド（objective/keyResults/owner）をOKR 1件として吸収
            const legacyOKR =
              p?.objective || p?.keyResults || p?.owner
                ? [
                    {
                      objective: String(p?.objective ?? ''),
                      keyResults: Array.isArray(p?.keyResults)
                        ? p.keyResults.map((k: any) => String(k))
                        : [],
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
        : [],
    }
  ][0]));

  // ID
  s.strategyId = s.strategyId ?? undefined;

  // csvFinanceData は配列 or 文字列(JSON)に対応
  const parsed = tryParseArrayString(s.csvFinanceData);
  s.csvFinanceData = typeof parsed !== 'undefined' ? parsed : s.csvFinanceData ?? undefined;

  return s as StrategyState;
}

/* =========================
 *       Helpers
 * =======================*/

function clamp1to3(n: number) {
  return Math.max(1, Math.min(3, Number.isFinite(n) ? n : 1));
}

/** saveStrategyData 用のペイロード整形 */
function buildSavePayload(s: StrategyState) {
  return {
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
    csvFinanceData: s.csvFinanceData,
  } as any;
}

/** 共通：現在のストア内容を Supabase へ保存（既存：同期 await 保存） */
async function commitSave(get: () => StrategyState) {
  const userId = useUserStore.getState().user?.id;
  const companyId = useUserStore.getState().companyId; // ★ 明示パス
  if (!userId) return;
  try {
    const r = await saveStrategyData(buildSavePayload(get()), userId, companyId);
    if (r?.error) {
      // strategy.ts 側で詳細ログは出るが、ここでも軽く補足
      console.warn('saveStrategyData returned error (see console above for details):', r.error);
    }
  } catch (e) {
    console.warn('commitSave failed', e);
  }
}

/** 🔄 保存をまとめて非同期実行（QAで使用：UIをブロックしない） */
let saveTimer: ReturnType<typeof setTimeout> | null = null;
let saving = false;
let lastSnapshot: any = null;

function scheduleSave(get: () => StrategyState, delayMs = 600) {
  lastSnapshot = buildSavePayload(get());
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(runSave, delayMs);
}

async function runSave() {
  if (saving) return; // 連続呼び出しを束ねる
  saving = true;
  const userId = useUserStore.getState().user?.id;
  const companyId = useUserStore.getState().companyId; // ★ 明示パス
  if (!userId) { saving = false; return; }

  const payload = lastSnapshot;
  const timeout = new Promise<void>((resolve) => setTimeout(resolve, 5000)); // ⏱ 最長5秒で見切る

  try {
    const r: any = await Promise.race([
      saveStrategyData(payload, userId, companyId),
      timeout,
    ]);
    if (r?.error) {
      console.warn('debounced saveStrategyData error (see detailed log above):', r.error);
    }
  } catch (e) {
    console.warn('scheduleSave failed', e);
  } finally {
    saving = false;
  }
}

/** 配列の要素入替（範囲外は安全に無視） */
function arrayMove<T>(arr: T[], from: number, to: number): T[] {
  const copy = [...arr];
  if (from < 0 || from >= copy.length || to < 0 || to >= copy.length) return copy;
  const [item] = copy.splice(from, 1);
  copy.splice(to, 0, item);
  return copy;
}

/* =========================
 *         Store
 * =======================*/

export const useStrategyStore = create<StrategyState>()(
  persist(
    (set, get) => ({
      ...emptyData,

      reset: () => set(() => ({ ...emptyData })),

      setStrategyId: (id?: string) => set(() => ({ strategyId: id })),

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

      setCSVFinanceData: (data) =>
        set(() => {
          const parsed = tryParseArrayString(data);
          return { csvFinanceData: typeof parsed !== 'undefined' ? parsed : data };
        }),

      /* ---------- 掘り下げQA（保存をノンブロッキング化） ---------- */

      async appendQuestionStep(chapterIdx, step) {
        const st = get();
        const answers2: ChapterAnswers[] = Array.isArray(st.answers2)
          ? ([...st.answers2] as ChapterAnswers[])
          : ([] as ChapterAnswers[]);
        let chapter: ChapterAnswers | undefined = answers2.find(
          (c: ChapterAnswers) => c.chapterIndex === chapterIdx
        );

        if (!chapter) {
          const title =
            st.story?.[chapterIdx]?.title ??
            st.finalStory?.[chapterIdx]?.title ??
            `Chapter ${chapterIdx + 1}`;
          chapter = { chapterIndex: chapterIdx, chapterTitle: String(title || ''), steps: [] };
          answers2.push(chapter);
        }

        const steps: AnswerStep[] = Array.isArray(chapter.steps) ? [...chapter.steps] : [];

        // 既存の step 番号と衝突したら 1→3 の空きを割当
        const used = new Set(steps.map((s) => clamp1to3(s.stepNumber)));
        let finalNo = clamp1to3(step.stepNumber);
        if (used.has(finalNo)) {
          let assigned = false;
          for (let n = 1; n <= 3; n++) {
            if (!used.has(n)) { finalNo = n; assigned = true; break; }
          }
          if (!assigned) {
            // 3枠すべて埋まっている場合は上書きせずリターン（念のため）
            set({ answers2 }); // 状態は変えないが UI を止めない
            return;
          }
        }

        const nextStep: AnswerStep = {
          stepNumber: finalNo,
          question: String(step.question ?? ''),
          reason: String(step.reason ?? ''),
          answer: String(step.answer ?? ''),
        };

        // 既存同番号があれば置換、無ければ追加
        const idxSame = steps.findIndex((s) => s.stepNumber === finalNo);
        if (idxSame >= 0) steps[idxSame] = nextStep;
        else steps.push(nextStep);

        // stepNumber 昇順で整列
        steps.sort((a, b) => a.stepNumber - b.stepNumber);

        // 不変更新
        const chapterIdxInArray = answers2.findIndex((c) => c.chapterIndex === chapterIdx);
        const nextChapter: ChapterAnswers = { ...chapter, steps };
        if (chapterIdxInArray >= 0) answers2[chapterIdxInArray] = nextChapter;
        else answers2.push(nextChapter);

        set({ answers2 });
        // ✅ 保存はバックグラウンド：次の質問生成をブロックしない
        scheduleSave(get);
      },

      async updateAnswerStep(chapterIdx, stepIdx, answer) {
        const st = get();
        const answers2: ChapterAnswers[] = Array.isArray(st.answers2)
          ? ([...st.answers2] as ChapterAnswers[])
          : ([] as ChapterAnswers[]);
        let chapter: ChapterAnswers | undefined = answers2.find(
          (c: ChapterAnswers) => c.chapterIndex === chapterIdx
        );

        if (!chapter) {
          const title =
            st.story?.[chapterIdx]?.title ??
            st.finalStory?.[chapterIdx]?.title ??
            `Chapter ${chapterIdx + 1}`;
          chapter = { chapterIndex: chapterIdx, chapterTitle: String(title || ''), steps: [] };
          answers2.push(chapter);
        }

        let steps: AnswerStep[] = Array.isArray(chapter.steps)
          ? ([...chapter.steps] as AnswerStep[])
          : ([] as AnswerStep[]);

        // 空スロット補充（衝突しない stepNumber を割当）
        if (!steps[stepIdx]) {
          const used = new Set(steps.map((s) => clamp1to3(s.stepNumber)));
          let assign = clamp1to3(stepIdx + 1);
          if (used.has(assign)) {
            for (let n = 1; n <= 3; n++) {
              if (!used.has(n)) { assign = n; break; }
            }
          }
          steps[stepIdx] = {
            stepNumber: assign,
            question: '',
            reason: '',
            answer: '',
          };
        }

        steps[stepIdx] = { ...steps[stepIdx], answer: String(answer ?? '') };
        steps = steps.sort((a, b) => a.stepNumber - b.stepNumber);

        const idx = answers2.findIndex((c: ChapterAnswers) => c.chapterIndex === chapterIdx);
        const nextChapter: ChapterAnswers = { ...chapter, steps };
        if (idx >= 0) answers2[idx] = nextChapter; else answers2.push(nextChapter);

        set({ answers2 });

        // ✅ 保存はバックグラウンド：次の質問生成をブロックしない
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
        if (!projects[projIndex]) return;

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

      /* ---------- サーバ再取得（companyId 起点） ---------- */

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

          // 受け取った形の揺れを吸収（将来の snake_case などに備えた保険）
          const incoming: any = {
            strategyId: (data as any)?.strategyId ?? (data as any)?.id ?? (data as any)?.strategy_id,

            companyName: (data as any)?.companyName ?? (data as any)?.company_name ?? '',
            foundationYear:
              (data as any)?.foundationYear ?? (data as any)?.foundation_year ?? '',
            location: (data as any)?.location ?? '',
            industry: (data as any)?.industry ?? '',
            revenue: (data as any)?.revenue ?? '',
            employees: (data as any)?.employees ?? '',
            businessContent:
              (data as any)?.businessContent ?? (data as any)?.business_content ?? '',
            customerSegment:
              (data as any)?.customerSegment ?? (data as any)?.customer_segment ?? '',

            thought: (data as any)?.thought ?? '',
            mission: (data as any)?.mission ?? '',
            vision: (data as any)?.vision ?? '',
            value: (data as any)?.value ?? '',

            strength: (data as any)?.strength ?? '',
            weakness: (data as any)?.weakness ?? '',
            opportunity: (data as any)?.opportunity ?? '',
            threat: (data as any)?.threat ?? '',

            story: (data as any)?.story ?? [],
            finalStory:
              (data as any)?.finalStory ??
              (data as any)?.finalstory ?? // snake互換
              [],
            answers2: (data as any)?.answers2 ?? [],
            departments: (data as any)?.departments ?? [],

            csvFinanceData:
              (data as any)?.csvFinanceData ?? (data as any)?.csv_finance_data ?? undefined,
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
        csvFinanceData: s.csvFinanceData, // 永続対象
      }),

      storage: createJSONStorage(() => localStorage),
      onRehydrateStorage: () => (state, error) => {
        if (error) {
          console.warn('rehydration error, resetting to emptyData', error);
        } else if (state) {
          // 文字列で入っている csvFinanceData を配列に戻す（保険）
          const cur = (state as any).csvFinanceData;
          const parsed = tryParseArrayString(cur);
          if (typeof parsed !== 'undefined') {
            (state as any).csvFinanceData = parsed;
          }
        }
      },
    }
  )
);

/** 外から直接呼べるラッパ（ページ側で使うと楽） */
export async function refetchFromServer() {
  return useStrategyStore.getState().refetchFromServer();
}
