// /app/cascade/page.tsx
'use client';

import { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import { useStrategyStore } from '@/store/strategyStore';
import { useAccess } from '@/utils/access';

// 部門用ステッパー
import DepartmentQuestionStepper, {
  type DeptAnswerStep,
  type StepNumber,
  type OKR as DeptOKR,
} from '@/components/guide/QuestionStepper.dept';

import { Button } from '@/components/ui/button';
import {
  PlusCircle,
  Trash2,
  CheckCircle2,
  RefreshCw,
  FolderOpen,
  FileText,
  PencilLine,
  Save,
  Sparkles,
  Building2,
} from 'lucide-react';

/* ======================= 型は types/strategy に統一 ======================= */
import type {
  Department as BaseDepartment,
  Project as BaseProject,
  OKR as BaseOKR,
  ChapterAnswers as BaseChapterAnswers,
  AnswerStep as BaseAnswerStep,
} from '@/types/strategy';

/* ======================= ローカル型（ストア型を拡張） ======================= */
type Project = BaseProject;
type StoreOKR = BaseOKR;
type StoreAnswerStep = BaseAnswerStep;
type StoreChapterAnswers = BaseChapterAnswers;

type Department = BaseDepartment & {
  mission?: string;
  strategy?: string;
  missionDraft?: string;
  discussionNotes?: string;
  answers2?: StoreChapterAnswers[]; // 部門ごとのQ/A（ローカル拡張）
  finalized?: boolean;
};

/* ======================= 共通ヘルパ ======================= */
function escapeHtml(s: string) {
  return String(s ?? '').replace(
    /[&<>"']/g,
    (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]!)
  );
}
function nl2brSafe(s?: string) {
  if (!s) return '';
  return escapeHtml(s).replace(/\r?\n/g, '<br>');
}
function isNonEmptyStoryPayload(v: any): boolean {
  if (!v) return false;
  if (Array.isArray(v)) {
    return v.some((c) => {
      const t = typeof c?.title === 'string' ? c.title.trim() : '';
      const b = typeof c?.body === 'string' ? c.body.trim() : '';
      return t.length > 0 || b.length > 0;
    });
  }
  if (typeof v === 'string') return v.trim().length > 0;
  return false;
}
function getStory(raw: any): { text: string; chapters: Array<{ title: string; body: string }> } {
  if (Array.isArray(raw) && raw.length) {
    const chapters = raw
      .map((c: any, i: number) => ({
        title:
          typeof c?.title === 'string' && c.title.trim() ? c.title.trim() : `Chapter ${i + 1}`,
        body: typeof c?.body === 'string' ? c.body : '',
      }))
      .filter((c: any) => c.title?.trim()?.length || c.body?.trim()?.length);
    const text = chapters.map((c, i) => `【第${i + 1}章】${c.title}\n${c.body}`).join('\n\n');
    return { text, chapters };
  }
  if (typeof raw === 'string' && raw.trim()) {
    const text = raw.trim();
    const lines = text.split(/\r?\n/);
    const chunkSize = Math.max(1, Math.ceil(lines.length / 4));
    const chunks: string[] = [];
    for (let i = 0; i < lines.length; i += chunkSize)
      chunks.push(lines.slice(i, i + chunkSize).join('\n'));
    const chapters = chunks.map((body, i) => ({ title: `Chapter ${i + 1}`, body }));
    return { text, chapters };
  }
  return { text: '', chapters: [] };
}

/** JSON安全パース（空や途中切れも吸収） */
function safeJsonFromText<T = any>(raw: string): T | null {
  if (!raw || typeof raw !== 'string') return null;
  try {
    return JSON.parse(raw) as T;
  } catch {}
  const m = raw.match(/\{[\s\S]*\}/m);
  if (m) {
    try {
      return JSON.parse(m[0]) as T;
    } catch {}
  }
  return null;
}

/* ======================= 配列・オブジェクト比較 ======================= */
function stepsEqual(a: StoreAnswerStep[] | undefined, b: StoreAnswerStep[] | undefined) {
  if (a === b) return true;
  if (!a || !b) return false;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const x: any = a[i],
      y: any = b[i];
    if (
      x.stepNumber !== y.stepNumber ||
      (x.question ?? '') !== (y.question ?? '') ||
      (x.reason ?? '') !== (y.reason ?? '') ||
      (x.answer ?? '') !== (y.answer ?? '')
    )
      return false;
  }
  return true;
}

function shallowEqualDepartments(a: Department[], b: Department[]) {
  if (a === b) return true;
  if (!a || !b) return false;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const da = a[i] as any,
      db = b[i] as any;
    if (da === db) continue;
    if (
      (da?.name ?? '') !== (db?.name ?? '') ||
      (da?.mission ?? '') !== (db?.mission ?? '') ||
      (da?.strategy ?? '') !== (db?.strategy ?? '') ||
      (da?.missionDraft ?? '') !== (db?.missionDraft ?? '') ||
      (da?.finalized ?? false) !== (db?.finalized ?? false)
    )
      return false;

    const pa = (da?.projects ?? []) as Project[];
    const pb = (db?.projects ?? []) as Project[];
    if (pa.length !== pb.length) return false;
    for (let j = 0; j < pa.length; j++) {
      if ((pa[j]?.title ?? '') !== (pb[j]?.title ?? '')) return false;
      const oa = (pa[j]?.okrs ?? []).length;
      const ob = (pb[j]?.okrs ?? []).length;
      if (oa !== ob) return false;
    }

    const ca = (da?.answers2?.[0]?.steps ?? []) as StoreAnswerStep[];
    const cb = (db?.answers2?.[0]?.steps ?? []) as StoreAnswerStep[];
    if (!stepsEqual(ca, cb)) return false;
  }
  return true;
}

/* ======================= DeptAnswerStep ↔ StoreAnswerStep 変換 ======================= */
function toDeptAnswers(steps: StoreAnswerStep[] | undefined): DeptAnswerStep[] {
  if (!Array.isArray(steps)) return [];
  // Hydration差分を避ける固定値
  const STABLE_TS = '1970-01-01T00:00:00.000Z';
  return steps
    .filter((s) => s && s.stepNumber && s.question != null)
    .map((s) => ({
      stepNumber: Number(s.stepNumber) as StepNumber,
      question: s.question ?? '',
      reason: s.reason ?? '',
      answer: s.answer ?? '',
      createdAt: STABLE_TS,
    }))
    .sort((a, b) => a.stepNumber - b.stepNumber);
}
function toStoreSteps(answers: DeptAnswerStep[]): StoreAnswerStep[] {
  return (answers ?? [])
    .map((a) => ({
      stepNumber: a.stepNumber as any,
      question: a.question,
      reason: a.reason,
      answer: a.answer,
    }))
    .sort((a, b) => Number(a.stepNumber) - Number(b.stepNumber));
}

/* ======================= DeptOKR → StoreOKR 正規化 ======================= */
function toStoreOKR(o: DeptOKR): StoreOKR {
  return {
    objective: (o?.objective ?? '').trim(),
    keyResults: Array.isArray(o?.keyResults) ? o.keyResults.filter(Boolean) : [],
    owner: o?.owner?.trim() || undefined,
  };
}

/* ======================= ページ ======================= */
export default function CascadePage() {
  const s = useStrategyStore() as any;

  // アクセス制御（閲覧は全員OK、編集はロールで制御）
  const access = useAccess();
  const canEditCompany = access.canEditCompany();
  const canEditDept = (deptId?: string) => access.canEditDepartment(deptId);
  const canEditProj = (deptId?: string) => access.canEditProject(deptId);

  // ストーリーの表示用（final → story → strategyStory の優先）
  const rawStory = useMemo(() => {
    if (isNonEmptyStoryPayload(s?.finalStory)) return s.finalStory;
    if (isNonEmptyStoryPayload(s?.story)) return s.story;
    if (isNonEmptyStoryPayload(s?.strategyStory)) return s.strategyStory;
    return '';
  }, [s?.finalStory, s?.story, s?.strategyStory]);

  const { text: storyText, chapters: storyChapters } = useMemo(
    () => getStory(rawStory),
    [rawStory]
  );

  const initialDepartments: Department[] = Array.isArray(s?.departments)
    ? (s.departments as Department[])
    : [];
  const [departments, setDepartments] = useState<Department[]>(initialDepartments);

  // 最新departments参照
  const depsRef = useRef<Department[]>(initialDepartments);
  useEffect(() => {
    depsRef.current = departments;
  }, [departments]);

  // idempotent push（store 側にはそのまま保存：persist の JSON に載る）
  const pushToStore = useCallback((next: Department[]) => {
    setDepartments((prev) => (shallowEqualDepartments(prev, next) ? prev : next));
    (useStrategyStore as any).setState((prev: any) => {
      const prevDeps: Department[] = prev?.departments ?? [];
      if (shallowEqualDepartments(prevDeps, next)) return prev;
      return { ...prev, departments: next };
    });
  }, []);

  // 追加ボタンは会社編集権限がある人のみ
  const canShowAddButton = canEditCompany;

  const [activeTab, setActiveTab] = useState<'edit' | 'visual'>('edit');
  const [notice, setNotice] = useState<string>('');

  const [showForm, setShowForm] = useState(false);
  const [deptName, setDeptName] = useState('');
  const [deptMission, setDeptMission] = useState('');

  type DeptLoad = {
    draft?: boolean;
    regen?: boolean;
    projOnly?: boolean;
    summary?: boolean;
    saveMission?: boolean;
  };
  const [loading, setLoading] = useState<Record<number, DeptLoad>>({});
  const setDeptLoading = (idx: number, patch: DeptLoad) =>
    setLoading((prev) => ({ ...prev, [idx]: { ...(prev[idx] ?? {}), ...patch } }));

  const [inlineEdit, setInlineEdit] = useState<Record<number, string>>({});

  /* ========== インライン保存（編集権限チェック） ========== */
  const saveInlineMission = async (index: number) => {
    const dept = depsRef.current?.[index];
    if (!dept) return;
    if (!canEditDept((dept as any)?.id)) {
      setNotice('⚠️ 編集権限がありません。');
      return;
    }
    const draft = (inlineEdit[index] ?? '').trim();
    setDeptLoading(index, { saveMission: true });
    try {
      const next = [...depsRef.current];
      const d = { ...(next[index] || {}) } as Department;
      d.mission = draft;
      d.strategy = draft;
      d.missionDraft = draft;
      next[index] = d;
      pushToStore(next);
      setNotice('✅ ミッション/戦略を保存しました');
    } finally {
      setDeptLoading(index, { saveMission: false });
    }
  };

  /* ========== ストーリー必須チェック ========== */
  const requireStoryOrWarn = (): string | null => {
    const payload = storyText;
    if (!payload.trim()) {
      setNotice(
        '⚠️ 経営ストーリーが未入力のため、この操作はできません。先にストーリーを作成してください。'
      );
      return null;
    }
    return payload;
  };

  /* ========== 叩き台（任意：ストーリー起点） ========== */
  const handleGenerateDepartmentDraft = async (index: number) => {
    const dept = depsRef.current?.[index];
    if (!dept || !dept.name) return;
    if (!canEditDept((dept as any)?.id)) {
      setNotice('⚠️ 編集権限がありません。');
      return;
    }

    const payloadStory = requireStoryOrWarn();
    if (!payloadStory) return;

    setDeptLoading(index, { draft: true });
    setNotice(`⏳ ${dept.name}のたたき台を生成中...`);
    try {
      const res = await fetch('/api/generate-department-draft', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ departmentName: dept.name, story: payloadStory }),
      });
      const text = await res.text();
      const data = safeJsonFromText<any>(text) ?? {};
      if (!res.ok) throw new Error(data?.error || '不明なエラー');

      const updated = [...depsRef.current];
      updated[index] = {
        ...updated[index],
        mission: data.mission ?? updated[index].mission,
        strategy: data.mission ?? updated[index].strategy,
        missionDraft: data.mission ?? updated[index].missionDraft,
        projects: Array.isArray(data.projects)
          ? data.projects.map((title: string): Project => ({ title, okrs: [] }))
          : updated[index].projects,
      };
      pushToStore(updated);
      setInlineEdit((prev) => ({ ...prev, [index]: data?.mission ?? '' }));
      setNotice(`✅ ${dept.name} のたたき台生成成功`);
    } catch (err: any) {
      console.error(err);
      setNotice(`❌ ${dept.name} の生成失敗：${err?.message ?? '不明なエラー'}`);
    } finally {
      setDeptLoading(index, { draft: false });
    }
  };

  /* ========== 再生成（ストーリー起点） ========== */
  const handleRegenerateDepartmentStrategy = async (index: number) => {
    const dept = depsRef.current?.[index];
    if (!dept || !dept.name) return;
    if (!canEditDept((dept as any)?.id)) {
      setNotice('⚠️ 編集権限がありません。');
      return;
    }

    const payloadStory = requireStoryOrWarn();
    if (!payloadStory) return;

    setDeptLoading(index, { regen: true });
    setNotice(`⏳ ${dept.name}の戦略再生成中...`);
    try {
      const res = await fetch('/api/generate-department-draft', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ departmentName: dept.name, story: payloadStory }),
      });
      const text = await res.text();
      const data = safeJsonFromText<any>(text) ?? {};
      if (!res.ok) throw new Error(data?.error || 'エラー');

      const updated = [...depsRef.current];
      updated[index] = {
        ...updated[index],
        mission: data.mission ?? updated[index].mission,
        strategy: data.mission ?? updated[index].strategy,
        missionDraft: data.mission ?? updated[index].missionDraft,
        projects: Array.isArray(data.projects)
          ? data.projects.map((title: string): Project => ({ title, okrs: [] }))
          : updated[index].projects,
      };
      pushToStore(updated);
      setInlineEdit((prev) => ({ ...prev, [index]: data?.mission ?? '' }));
      setNotice(`✅ ${dept.name} の戦略再生成完了`);
    } catch (err: any) {
      console.error(err);
      setNotice(`❌ ${dept.name} の戦略再生成失敗：${err?.message ?? '不明なエラー'}`);
    } finally {
      setDeptLoading(index, { regen: false });
    }
  };

  /* ========== プロジェクトのみ再生成（ストーリー起点） ========== */
  const handleRegenerateProjectsOnly = async (index: number) => {
    const dept = depsRef.current?.[index];
    if (!dept?.name || !canEditProj((dept as any)?.id)) {
      if (dept && !canEditProj((dept as any)?.id)) setNotice('⚠️ 編集権限がありません。');
      if (!dept?.name) setNotice('⚠️ まず部門を追加してください。');
      return;
    }

    const missionOrStrategy = (dept?.strategy ?? dept?.mission ?? '').trim();
    if (!missionOrStrategy) {
      setNotice('⚠️ まず部門のミッション/戦略を入力または生成してください。');
      return;
    }

    const payloadStory = requireStoryOrWarn();
    if (!payloadStory) return;

    setDeptLoading(index, { projOnly: true });
    setNotice(`⏳ ${dept.name}のプロジェクト再生成中...`);
    try {
      const res = await fetch('/api/generate-projects-only', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' }, // ← 修正点
        body: JSON.stringify({
          departmentName: dept.name,
          mission: missionOrStrategy,
          story: payloadStory,
        }),
      });
      const text = await res.text();
      const data = safeJsonFromText<any>(text) ?? {};
      if (!res.ok || !data?.projects) throw new Error(data?.error || 'プロジェクト再生成に失敗');

      const updated = [...depsRef.current];
      updated[index] = {
        ...updated[index],
        projects: (data.projects || []).map((title: string): Project => ({ title, okrs: [] })),
      };
      pushToStore(updated);
      setNotice(`✅ ${dept.name} のプロジェクト再生成成功`);
    } catch (err: any) {
      console.error(err);
      setNotice(`❌ ${dept.name} のプロジェクト再生成失敗：${err?.message ?? '不明なエラー'}`);
    } finally {
      setDeptLoading(index, { projOnly: false });
    }
  };

  /* ========== 要約（3問回答→Mission/Projects/OKR） ========== */
  const handleGenerateSummary = async (index: number) => {
    const dept = depsRef.current?.[index];
    if (!dept) return;
    if (!canEditDept((dept as any)?.id)) {
      setNotice('⚠️ 編集権限がありません。');
      return;
    }

    const steps = (() => {
      if (!dept.answers2 || dept.answers2.length === 0) return [] as StoreAnswerStep[];
      return (dept.answers2[0]?.steps ?? []) as StoreAnswerStep[];
    })();

    if (steps.length < 3 || steps.some((s) => !(s?.answer || '').trim())) {
      setNotice('⚠️ 3問すべてに回答してください');
      return;
    }

    const payloadStory = requireStoryOrWarn();
    if (!payloadStory) return;

    setDeptLoading(index, { summary: true });
    setNotice(`⏳ ${dept.name}の要約（Mission/Projects/OKR）を生成中...`);
    try {
      const res = await fetch('/api/generate-department-summary', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          departmentName: dept.name,
          story: payloadStory,
          answers: steps.slice(0, 3),
        }),
      });
      const text = await res.text();
      const data = safeJsonFromText<any>(text) ?? {};
      if (!res.ok) throw new Error(data?.error || '要約生成に失敗');

      const next = [...depsRef.current];
      const d = { ...(next[index] || {}) } as Department;
      d.mission = data?.mission || d.mission;
      d.strategy = data?.mission || d.strategy;
      d.missionDraft = data?.mission || d.missionDraft;

      d.projects = (Array.isArray(data?.projects) ? data.projects : []).map(
        (title: string) => ({
          title,
          okrs:
            Array.isArray(data?.okrs) && data?.okrs[0]
              ? [toStoreOKR(data.okrs[0] as DeptOKR)]
              : [],
        })
      );

      next[index] = d;
      pushToStore(next);
      setInlineEdit((prev) => ({ ...prev, [index]: data?.mission ?? '' }));

      setNotice(`✅ ${dept.name} の要約を反映しました（Mission/Projects/OKR）`);
    } catch (e: any) {
      console.error(e);
      setNotice(`❌ 要約生成に失敗：${e?.message ?? '不明なエラー'}`);
    } finally {
      setDeptLoading(index, { summary: false });
    }
  };

  /* ========== ビジュアルタブ ========== */
  const VisualView = useMemo(() => {
    if (!departments?.length) {
      return (
        <div className="rounded-2xl border border-zinc-200 bg-white/70 backdrop-blur-sm p-8 text-zinc-600 shadow-sm">
          部門がありません。編集タブで追加してください。
        </div>
      );
    }
    return (
      <div className="grid gap-6 md:grid-cols-2">
        {departments.map((dept, i) => (
          <div
            key={i}
            className="rounded-3xl border border-zinc-200 bg-white/60 backdrop-blur-sm p-6 shadow-sm hover:shadow-md transition-shadow"
          >
            <div className="flex items-center justify-between mb-2">
              <div className="font-semibold text-zinc-900 tracking-tight inline-flex items-center gap-2">
                <Building2 className="w-4 h-4 shrink-0" />
                {dept.name}
              </div>
              {dept.finalized && (
                <span className="inline-flex items-center h-6 px-2.5 rounded-full bg-zinc-900 text-white text-xs font-semibold">
                  確定済み
                </span>
              )}
            </div>
            <div className="text-[11px] uppercase tracking-wide text-zinc-500 font-medium mb-1">
              Mission / Strategy
            </div>
            <p className="text-zinc-800 whitespace-pre-wrap leading-7">
              {dept.strategy ?? dept.mission ?? ''}
            </p>
            {dept.projects?.length ? (
              <>
                <div className="text-[11px] uppercase tracking-wide text-zinc-500 font-medium mt-5 mb-2">
                  Projects
                </div>
                <ul className="space-y-2">
                  {dept.projects.map((p, j) => (
                    <li key={j} className="text-zinc-800 leading-7">
                      • {p.title}
                      {/* OKR（Objective/Key Results）の表示 */}
                      {p.okrs?.[0] && (
                        <div className="ml-5 mt-1 text-zinc-700 text-sm">
                          <div>
                            <span className="font-medium">Objective:</span> {p.okrs[0].objective}
                          </div>
                          {Array.isArray(p.okrs[0].keyResults) && p.okrs[0].keyResults.length > 0 && (
                            <ul className="list-disc ml-5 mt-1">
                              {p.okrs[0].keyResults.map((kr, k) => (
                                <li key={k} className="leading-6">
                                  {kr}
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              </>
            ) : null}
          </div>
        ))}
      </div>
    );
  }, [departments]);

  /* ========== 初期同期 ========== */
  useEffect(() => {
    if (Array.isArray(s?.departments) && !shallowEqualDepartments(s.departments, departments)) {
      setDepartments(s.departments as Department[]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      {/* ヘッダ */}
      <header className="mb-8">
        <div className="mb-2">
          <h1 className="text-[28px] font-semibold tracking-tight text-zinc-900">
            STAGE 3：部門戦略策定
          </h1>
        </div>
        <p className="text-zinc-600">
          経営ストーリーをベースに、質問に答えながら各部門のミッション・プロジェクト・OKRを固めていきます。
        </p>
        <div className="mt-6 h-px bg-gradient-to-r from-transparent via-zinc-200 to-transparent" />
      </header>

      {/* 最終ストーリー（2×2） */}
      <section className="mb-8">
        {storyChapters.length > 0 ? (
          <div className="rounded-3xl border border-zinc-200 bg-white/60 backdrop-blur-sm p-6 shadow-sm">
            <h2 className="text-[17px] font-semibold text-zinc-900 mb-4 tracking-tight">最終ストーリー</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              {storyChapters.slice(0, 4).map((ch, i) => (
                <div
                  key={i}
                  className="rounded-2xl border border-zinc-200 bg-zinc-50/70 p-5 hover:bg-zinc-50 transition-colors"
                >
                  <div className="text-[11px] uppercase tracking-wide text-zinc-500 font-medium mb-1">{`Chapter ${
                    i + 1
                  }`}</div>
                  <h3 className="font-semibold text-zinc-900 mb-2 tracking-tight">
                    {ch?.title ?? `Chapter ${i + 1}`}
                  </h3>
                  <div
                    className="text-zinc-800 text-[15px] leading-7"
                    dangerouslySetInnerHTML={{ __html: nl2brSafe(ch?.body ?? '') }}
                  />
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="rounded-3xl border border-yellow-200 bg-yellow-50 p-5 text-yellow-900 text-[15px]">
            最終ストーリーがまだありません。まず <b>経営ストーリー</b> を作成してください。
          </div>
        )}
      </section>

      {/* タブ切替 */}
      <section className="mb-8 flex items-center justify-between">
        <div
          className="inline-flex items-center gap-1 rounded-full border border-zinc-200 bg-white/60 backdrop-blur-sm p-1 shadow-sm"
          role="tablist"
        >
          <button
            role="tab"
            aria-selected={activeTab === 'edit'}
            className={`px-4 py-2 rounded-full text-[14px] transition ${
              activeTab === 'edit' ? 'bg-zinc-900 text-white shadow-sm' : 'text-zinc-800 hover:bg-zinc-100'
            }`}
            onClick={() => setActiveTab('edit')}
          >
            編集
          </button>
          <button
            role="tab"
            aria-selected={activeTab === 'visual'}
            className={`px-4 py-2 rounded-full text-[14px] transition ${
              activeTab === 'visual' ? 'bg-zinc-900 text-white shadow-sm' : 'text-zinc-800 hover:bg-zinc-100'
            }`}
            onClick={() => setActiveTab('visual')}
          >
            ビジュアル
          </button>
        </div>

        {canShowAddButton && (
          <Button onClick={() => setShowForm((v) => !v)} className="shadow-sm rounded-full h-10 px-5 text-[14px]">
            <PlusCircle className="w-4 h-4 mr-2 shrink-0" />
            {showForm ? 'フォームを閉じる' : '部門を追加'}
          </Button>
        )}
      </section>

      {/* 追加フォーム（編集権限者のみ表示） */}
      {canShowAddButton && showForm && (
        <section className="mb-10 rounded-3xl border border-zinc-200 bg-white/60 backdrop-blur-sm p-6 shadow-sm">
          <div className="grid gap-6 md:grid-cols-2">
            <div>
              <label className="block text-[13px] text-zinc-700 mb-2">部門名</label>
              <input
                className="w-full border border-zinc-200 rounded-xl px-3 py-2.5 bg-white/90 focus:outline-none focus:ring-4 focus:ring-zinc-200 transition"
                placeholder="例：営業部"
                value={deptName}
                onChange={(e) => setDeptName(e.target.value)}
              />
            </div>
            <div>
              <label className="block text-[13px] text-zinc-700 mb-2">部門ミッション（任意）</label>
              <textarea
                className="w-full border border-zinc-200 rounded-xl px-3 py-2.5 bg-white/90 focus:outline-none focus:ring-4 focus:ring-zinc-200 transition"
                rows={2}
                placeholder="例：顧客価値の最大化と収益成長の両立"
                value={deptMission}
                onChange={(e) => setDeptMission(e.target.value)}
              />
            </div>
          </div>
          <div className="flex justify-end gap-3 mt-6">
            <Button
              variant="secondary"
              onClick={() => setShowForm(false)}
              className="rounded-full h-10 px-5 text-[14px]"
            >
              キャンセル
            </Button>
            <Button
              onClick={() => {
                if (!deptName.trim()) {
                  setNotice('⚠️ 部門名を入力してください');
                  return;
                }
                const newDept: Department = {
                  name: deptName.trim(),
                  mission: (deptMission ?? '').trim(),
                  strategy: (deptMission ?? '').trim(),
                  missionDraft: (deptMission ?? '').trim(),
                  discussionNotes: '',
                  projects: [],
                  answers2: [],
                  finalized: false,
                };
                const next = [...depsRef.current, newDept];
                pushToStore(next);
                setInlineEdit((prev) => ({ ...prev, [next.length - 1]: (deptMission ?? '').trim() }));
                setDeptName('');
                setDeptMission('');
                setShowForm(false);
                setNotice('✅ 部門を追加しました');
              }}
              className="rounded-full h-10 px-5 text-[14px]"
            >
              追加
            </Button>
          </div>
        </section>
      )}

      {/* 通知 */}
      {notice && (
        <section
          role="alert"
          className={`mb-8 rounded-3xl border p-4 shadow-sm text-[14px] ${
            notice.includes('削除')
              ? 'bg-rose-50 border-rose-200 text-rose-800'
              : 'bg-emerald-50 border-emerald-200 text-emerald-800'
          }`}
        >
          {notice}
        </section>
      )}

      {/* 本体 */}
      {activeTab === 'visual' ? (
        <section>{VisualView}</section>
      ) : (
        <section className="space-y-6">
          {(departments ?? []).map((dept, index) => {
            const strategyText = dept.strategy ?? dept.mission ?? '';
            const allAnswered = (() => {
              const steps = dept.answers2?.[0]?.steps;
              return Array.isArray(steps) && steps.length >= 3 && steps.every((s) => (s?.answer ?? '').trim().length > 0);
            })();

            const L = loading[index] ?? {};
            const inlineDraft = inlineEdit[index] ?? strategyText;

            const initialAnswers: DeptAnswerStep[] = toDeptAnswers(
              dept.answers2?.[0]?.steps as StoreAnswerStep[]
            );

            // 部門単位の編集権限
            const editableDept = canEditDept((dept as any)?.id);
            const editableProj = canEditProj((dept as any)?.id);

            return (
              <div
                key={index}
                className="rounded-3xl border border-zinc-200 bg-white/60 backdrop-blur-sm p-6 shadow-sm hover:shadow-md transition-shadow"
              >
                {/* ヘッダー */}
                <div className="flex justify-between items-center mb-4">
                  <div className="flex items-center gap-2">
                    <span className="inline-flex items-center justify-center h-6 px-2.5 rounded-full bg-zinc-900 text-white text-[12px] font-medium">
                      DEPT {index + 1}
                    </span>
                    <h3 className="font-semibold text-zinc-900 tracking-tight inline-flex items-center gap-2">
                      <Building2 className="w-4 h-4 shrink-0" />
                      {dept.name}
                    </h3>
                    {dept.finalized && (
                      <span className="inline-flex items-center h-6 px-2.5 rounded-full bg-zinc-900 text-white text-[12px] font-semibold">
                        確定済み
                      </span>
                    )}
                  </div>

                  <div className="flex gap-2 items-center">
                    {allAnswered && (
                      <Button
                        onClick={() =>
                          editableDept ? handleGenerateSummary(index) : setNotice('⚠️ 編集権限がありません。')
                        }
                        className="hidden sm:inline-flex rounded-full h-9 px-4 text-[13px]"
                        title="AI要約（Mission/Projects/OKR）を反映"
                        disabled={!!L.summary || !editableDept}
                      >
                        <FileText className="w-4 h-4 mr-1 shrink-0" />
                        {L.summary ? '要約中…' : 'AI要約を生成'}
                      </Button>
                    )}
                    {!dept.finalized && allAnswered && (
                      <Button
                        variant="secondary"
                        onClick={() => {
                          if (!editableDept) {
                            setNotice('⚠️ 編集権限がありません。');
                            return;
                          }
                          const updated = [...depsRef.current];
                          if (!updated[index]) return;
                          updated[index] = { ...updated[index], finalized: true };
                          pushToStore(updated);
                          setNotice(`✅ ${updated[index].name} を確定しました`);
                        }}
                        className="hidden sm:inline-flex rounded-full h-9 px-4 text-[13px]"
                        title="確定"
                        disabled={!editableDept}
                      >
                        <CheckCircle2 className="w-4 h-4 mr-1 shrink-0" /> 確定
                      </Button>
                    )}
                    <Button
                      variant="secondary"
                      onClick={() => {
                        if (!editableDept) {
                          setNotice('⚠️ 編集権限がありません。');
                          return;
                        }
                        const next = depsRef.current.filter((_, i) => i !== index);
                        pushToStore(next);
                        setNotice('🗑️ 部門を削除しました');
                      }}
                      title="削除"
                      className="rounded-full h-9 px-4 text-[13px]"
                      disabled={!editableDept}
                    >
                      <Trash2 className="w-4 h-4 mr-1 shrink-0" /> 削除
                    </Button>
                  </div>
                </div>

                {/* ミッション/戦略ブロック */}
                <div className="rounded-2xl border border-zinc-200 bg-zinc-50/70 p-5">
                  <div className="flex items-center justify-between mb-2">
                    <div className="text-[11px] uppercase tracking-wide text-zinc-500 font-medium">
                      Mission / Strategy
                    </div>
                    <div className="flex items-center gap-2">
                      <PencilLine className="w-4 h-4 text-zinc-500" aria-hidden />
                      <span className="text-xs text-zinc-500">{editableDept ? '編集可' : '閲覧のみ'}</span>
                    </div>
                  </div>

                  <textarea
                    className="w-full border border-zinc-200 rounded-xl px-3 py-2.5 bg-white focus:outline-none focus:ring-4 focus:ring-zinc-200 transition text-[15px]"
                    rows={3}
                    placeholder="ここに部門のミッション/戦略を書いてください（空のままでも質問生成は可能）"
                    value={inlineDraft}
                    onChange={(e) => setInlineEdit((prev) => ({ ...prev, [index]: e.target.value }))}
                    readOnly={!editableDept}
                  />

                  <div className="flex flex-wrap gap-2 mt-3">
                    <Button
                      onClick={() => saveInlineMission(index)}
                      disabled={!!L.saveMission || !editableDept}
                      className="shadow-sm rounded-full h-9 px-4 text-[13px]"
                      title="ミッション/戦略を保存"
                    >
                      <Save className="w-4 h-4 mr-2 shrink-0" />
                      {L.saveMission ? '保存中…' : '保存'}
                    </Button>

                    {(dept.strategy ?? dept.mission)?.trim() ? (
                      <>
                        <Button
                          variant="secondary"
                          onClick={() =>
                            editableDept
                              ? handleRegenerateDepartmentStrategy(index)
                              : setNotice('⚠️ 編集権限がありません。')
                          }
                          className="shadow-sm rounded-full h-9 px-4 text-[13px]"
                          disabled={!!L.regen || !editableDept}
                        >
                          <RefreshCw className="w-4 h-4 mr-2 shrink-0" />
                          {L.regen ? '再生成中…' : '部門戦略を再生成'}
                        </Button>
                        <Button
                          variant="secondary"
                          onClick={() =>
                            editableProj
                              ? handleRegenerateProjectsOnly(index)
                              : setNotice('⚠️ 編集権限がありません。')
                          }
                          className="shadow-sm rounded-full h-9 px-4 text-[13px]"
                          disabled={!!L.projOnly || !editableProj}
                        >
                          <FolderOpen className="w-4 h-4 mr-2 shrink-0" />
                          {L.projOnly ? '再生成中…' : 'プロジェクトのみ再生成'}
                        </Button>
                      </>
                    ) : null}
                  </div>

                  {/* 空状態ガイダンス */}
                  {!(dept.answers2 && dept.answers2.length > 0) && (
                    <div className="mt-3 text-[13px] text-zinc-600">
                      ミッション/戦略が空でも、まずは質問に答えながら考えることができます。
                      <span className="ml-1">下のステッパーから始めてください。</span>
                    </div>
                  )}
                </div>

                {/* 質問ステッパー（部門専用） */}
                <div className="mt-5">
                  <DepartmentQuestionStepper
                    departmentName={((dept.name ?? '').trim() || `DEPT ${index + 1}`)}
                    mission={(dept.strategy ?? dept.mission ?? '').trim() || undefined}
                    projects={(dept.projects || []).map((p) => p?.title || '').filter(Boolean)}
                    okrs={[]}
                    initialStep={1}
                    initialAnswers={initialAnswers}
                    onChange={({ answers }) => {
                      if (!editableDept) {
                        return; // 回答保存も編集権限者のみ
                      }
                      const newSteps = toStoreSteps(answers);
                      const next = [...depsRef.current];
                      const d = { ...(next[index] || {}) } as Department;
                      const oldSteps = (d.answers2?.[0]?.steps ?? []) as StoreAnswerStep[];
                      if (stepsEqual(oldSteps, newSteps)) return;

                      const chapter: StoreChapterAnswers = {
                        chapterIndex: index,
                        chapterTitle: d.name || `DEPT ${index + 1}`,
                        steps: newSteps,
                      };
                      d.answers2 = [chapter];
                      next[index] = d;
                      pushToStore(next);
                    }}
                    onDraftGenerated={({ mission, projects, okrs }) => {
                      if (!editableDept) {
                        setNotice('⚠️ 編集権限がありません。');
                        return;
                      }
                      const next = [...depsRef.current];
                      const d = { ...(next[index] || {}) } as Department;

                      if (mission) {
                        d.mission = mission;
                        d.strategy = mission;
                        d.missionDraft = mission;
                        setInlineEdit((prev) => ({ ...prev, [index]: mission }));
                      }
                      if (Array.isArray(projects)) {
                        d.projects = projects.map(
                          (title: string): Project => ({ title, okrs: [] })
                        );
                      }
                      if (Array.isArray(okrs) && okrs.length > 0) {
                        const first: StoreOKR = toStoreOKR(okrs[0] as DeptOKR);
                        if (!d.projects || d.projects.length === 0) {
                          d.projects = [{ title: '初期OKR', okrs: [first] }];
                        } else {
                          d.projects = d.projects.map((p, i) =>
                            i === 0 ? { ...p, okrs: [first] } : p
                          );
                        }
                      }
                      next[index] = d;
                      pushToStore(next);
                      setNotice(`✅ ${d.name} の部門ミッション案を反映しました`);
                    }}
                  />
                </div>

                {/* 3問完了後の大きなCTA */}
                {allAnswered && (
                  <div className="mt-5 rounded-2xl border border-blue-200 bg-blue-50/70 p-5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                    <div className="text-sm text-blue-900 flex items-center gap-2">
                      <Sparkles className="w-4 h-4" />
                      3つの回答から <b>部門ミッション / プロジェクト / OKR（初期案）</b> を生成できます。
                    </div>
                    <div className="flex gap-2">
                      <Button
                        onClick={() =>
                          editableDept ? handleGenerateSummary(index) : setNotice('⚠️ 編集権限がありません。')
                        }
                        disabled={!!L.summary || !editableDept}
                        className="rounded-full h-9 px-4 text-[13px]"
                        title="AI要約（Mission/Projects/OKR）を反映"
                      >
                        <FileText className="w-4 h-4 mr-2 shrink-0" />
                        {L.summary ? '生成中…' : '部門ミッションを生成'}
                      </Button>
                    </div>
                  </div>
                )}

                {/* プロジェクト案 */}
                {dept.projects?.length ? (
                  <div className="mt-5">
                    <div className="text-[11px] uppercase tracking-wide text-zinc-500 font-medium mb-2">
                      Projects
                    </div>
                    <ul className="space-y-2">
                      {dept.projects.map((proj, i) => (
                        <li key={i} className="text-zinc-800 leading-7">
                          • {proj.title}
                          {/* OKR 表示（編集ビュー側にも） */}
                          {proj.okrs?.[0] && (
                            <div className="ml-5 mt-1 text-zinc-700 text-sm">
                              <div>
                                <span className="font-medium">Objective:</span> {proj.okrs[0].objective}
                              </div>
                              {Array.isArray(proj.okrs[0].keyResults) &&
                                proj.okrs[0].keyResults.length > 0 && (
                                  <ul className="list-disc ml-5 mt-1">
                                    {proj.okrs[0].keyResults.map((kr, k) => (
                                      <li key={k} className="leading-6">
                                        {kr}
                                      </li>
                                    ))}
                                  </ul>
                                )}
                            </div>
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </div>
            );
          })}
        </section>
      )}
    </div>
  );
}
