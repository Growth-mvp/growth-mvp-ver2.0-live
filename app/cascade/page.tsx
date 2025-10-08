// /app/cascade/page.tsx
'use client';

import { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import { useStrategyStore } from '@/store/strategyStore';
import { useAccess } from '@/utils/access';
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

import type {
  Department as BaseDepartment,
  Project as BaseProject,
  OKR as BaseOKR,
  ChapterAnswers as BaseChapterAnswers,
  AnswerStep as BaseAnswerStep,
} from '@/types/strategy';

/* =========================================================
   ローカル型（store拡張対応）
========================================================= */
type Project = BaseProject;
type StoreOKR = BaseOKR;
type StoreAnswerStep = BaseAnswerStep;
type StoreChapterAnswers = BaseChapterAnswers;
type Department = BaseDepartment & {
  mission?: string;
  strategy?: string;
  missionDraft?: string;
  discussionNotes?: string;
  answers2?: StoreChapterAnswers[];
  finalized?: boolean;
};

/* =========================================================
   共通ヘルパ
========================================================= */
function escapeHtml(s: string) {
  return String(s ?? '').replace(
    /[&<>"']/g,
    (m) =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
      }[m]!),
  );
}
function nl2brSafe(s?: string) {
  return s ? escapeHtml(s).replace(/\r?\n/g, '<br>') : '';
}
function safeJsonFromText<T = any>(raw: string): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    const m = raw.match(/\{[\s\S]*\}/m);
    if (m) {
      try {
        return JSON.parse(m[0]) as T;
      } catch {}
    }
  }
  return null;
}

/* =========================================================
   ストーリー変換
========================================================= */
function isNonEmptyStoryPayload(v: any): boolean {
  if (!v) return false;
  if (Array.isArray(v))
    return v.some((c) => (c.title ?? '').trim() || (c.body ?? '').trim());
  if (typeof v === 'string') return v.trim().length > 0;
  return false;
}

function getStory(raw: any) {
  if (Array.isArray(raw) && raw.length) {
    const chapters = raw
      .map((c: any, i: number) => ({
        title: c?.title?.trim() || `Chapter ${i + 1}`,
        body: c?.body ?? '',
      }))
      .filter((c) => c.title.trim() || c.body.trim());
    const text = chapters
      .map((c, i) => `【第${i + 1}章】${c.title}\n${c.body}`)
      .join('\n\n');
    return { text, chapters };
  }
  if (typeof raw === 'string' && raw.trim()) {
    const text = raw.trim();
    const lines = text.split(/\r?\n/);
    const chunkSize = Math.ceil(lines.length / 4);
    const chunks: string[] = [];
    for (let i = 0; i < lines.length; i += chunkSize)
      chunks.push(lines.slice(i, i + chunkSize).join('\n'));
    const chapters = chunks.map((body, i) => ({
      title: `Chapter ${i + 1}`,
      body,
    }));
    return { text, chapters };
  }
  return { text: '', chapters: [] };
}

/* =========================================================
   配列比較
========================================================= */
function stepsEqual(
  a: StoreAnswerStep[] | undefined,
  b: StoreAnswerStep[] | undefined,
) {
  if (a === b) return true;
  if (!a || !b || a.length !== b.length) return false;
  return a.every(
    (x, i) =>
      x.stepNumber === b[i].stepNumber &&
      x.question === b[i].question &&
      x.reason === b[i].reason &&
      x.answer === b[i].answer,
  );
}

/* =========================================================
   変換関数
========================================================= */
function toDeptAnswers(steps: StoreAnswerStep[] | undefined): DeptAnswerStep[] {
  const STABLE_TS = '1970-01-01T00:00:00Z';
  return (
    steps?.map((s) => ({
      stepNumber: Number(s.stepNumber) as StepNumber,
      question: s.question ?? '',
      reason: s.reason ?? '',
      answer: s.answer ?? '',
      createdAt: STABLE_TS,
    })) ?? []
  );
}

function toStoreSteps(answers: DeptAnswerStep[]): StoreAnswerStep[] {
  return answers.map((a) => ({
    stepNumber: a.stepNumber,
    question: a.question,
    reason: a.reason,
    answer: a.answer,
  }));
}

function toStoreOKR(o: DeptOKR): StoreOKR {
  return {
    objective: (o.objective ?? '').trim(),
    keyResults: o.keyResults?.filter(Boolean) ?? [],
    owner: o.owner?.trim() || undefined,
  };
}

/* =========================================================
   メインページ
========================================================= */
export default function CascadePage() {
  const s = useStrategyStore() as any;
  const access = useAccess();
  const canEditCompany = access.canEditCompany();
  const canEditDept = (deptId?: string) => access.canEditDepartment(deptId);
  const canEditProj = (deptId?: string) => access.canEditProject(deptId);

  // 業種コンテキスト
  const industry: string =
    (s?.industry as string) ||
    (s?.company?.industry as string) ||
    '';

  const rawStory = useMemo(() => {
    if (isNonEmptyStoryPayload(s?.finalStory)) return s.finalStory;
    if (isNonEmptyStoryPayload(s?.story)) return s.story;
    if (isNonEmptyStoryPayload(s?.strategyStory)) return s.strategyStory;
    return '';
  }, [s]);
  const { text: storyText, chapters: storyChapters } = useMemo(
    () => getStory(rawStory),
    [rawStory],
  );

  const [departments, setDepartments] = useState<Department[]>(
    s?.departments ?? [],
  );
  const depsRef = useRef(departments);
  useEffect(() => {
    depsRef.current = departments;
  }, [departments]);

  const pushToStore = useCallback((next: Department[]) => {
    setDepartments(next);
    useStrategyStore.setState((prev: any) => ({
      ...prev,
      departments: next,
    }));
  }, []);

  const [activeTab, setActiveTab] = useState<'edit' | 'visual'>('edit');
  const [notice, setNotice] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [deptName, setDeptName] = useState('');
  const [deptMission, setDeptMission] = useState('');
  const [inlineEdit, setInlineEdit] = useState<Record<number, string>>({});
  const [loading, setLoading] = useState<Record<number, any>>({});

  /* ================= 保存 ================= */
  const saveInlineMission = (index: number) => {
    const next = [...depsRef.current];
    const d = { ...next[index] };
    d.mission = inlineEdit[index];
    d.strategy = inlineEdit[index];
    d.missionDraft = inlineEdit[index];
    next[index] = d;
    pushToStore(next);
    setNotice('✅ 保存しました');
  };

  const requireStoryOrWarn = (): string | null => {
    if (!storyText.trim()) {
      setNotice('⚠️ 経営ストーリーを作成してください');
      return null;
    }
    return storyText;
  };

  /* ================= 要約生成 ================= */
  const handleGenerateSummary = async (index: number) => {
    const dept = depsRef.current[index];
    if (!dept) return;
    if (!canEditDept((dept as any)?.id)) {
      setNotice('⚠️ 編集権限がありません');
      return;
    }
    const steps =
      dept.answers2?.[0]?.steps && dept.answers2[0].steps.length > 0
        ? dept.answers2[0].steps
        : [];
    if (steps.length < 3 || steps.some((s) => !(s.answer ?? '').trim())) {
      setNotice('⚠️ 3問すべて回答してください');
      return;
    }
    const story = requireStoryOrWarn();
    if (!story) return;
    setLoading((p) => ({ ...p, [index]: { ...p[index], summary: true } }));
    try {
      const res = await fetch('/api/generate-department-summary', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          departmentName: dept.name,
          story,
          answers: steps,
          industry, // ★業種追加
        }),
      });
      const text = await res.text();
      const data = safeJsonFromText<any>(text) ?? {};
      const next = [...depsRef.current];
      const d = { ...next[index] };
      d.mission = data.mission ?? d.mission;
      d.strategy = data.mission ?? d.strategy;
      d.missionDraft = data.mission ?? d.missionDraft;
      d.projects = (data.projects ?? []).map((t: string) => ({
        title: t,
        okrs:
          data.okrs && data.okrs[0]
            ? [toStoreOKR(data.okrs[0] as DeptOKR)]
            : [],
      }));
      next[index] = d;
      pushToStore(next);
      setNotice(`✅ ${dept.name} の要約を反映しました`);
    } catch (err: any) {
      setNotice(`❌ 要約生成に失敗：${err.message}`);
    } finally {
      setLoading((p) => ({ ...p, [index]: { ...p[index], summary: false } }));
    }
  };

  /* ================= ビジュアルビュー ================= */
  const VisualView = useMemo(() => {
    if (!departments.length)
      return (
        <div className="text-zinc-600">部門がまだ登録されていません。</div>
      );
    return (
      <div className="grid md:grid-cols-2 gap-6">
        {departments.map((d, i) => (
          <div
            key={i}
            className="p-6 rounded-3xl border bg-white/70 backdrop-blur-sm shadow-sm"
          >
            <div className="flex justify-between items-center mb-2">
              <h3 className="font-semibold flex items-center gap-2">
                <Building2 className="w-4 h-4" /> {d.name}
              </h3>
              {d.finalized && (
                <span className="text-xs bg-zinc-900 text-white rounded-full px-2 py-1">
                  確定済み
                </span>
              )}
            </div>
            <p className="text-sm text-zinc-700 mb-2">
              {d.strategy ?? d.mission}
            </p>
            {d.projects?.length ? (
              <ul className="text-sm text-zinc-800 space-y-1">
                {d.projects.map((p, j) => (
                  <li key={j}>
                    • {p.title}
                    {p.okrs?.[0] && (
                      <ul className="ml-5 list-disc">
                        {p.okrs[0].keyResults.map((kr, k) => (
                          <li key={k}>{kr}</li>
                        ))}
                      </ul>
                    )}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ))}
      </div>
    );
  }, [departments]);

  /* ================= JSX ================= */
  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      <header className="mb-8">
        <h1 className="text-[28px] font-semibold mb-2">
          STAGE 3：部門戦略策定
        </h1>
        <p className="text-zinc-600 text-sm">
          経営ストーリーを基に、質問に答えながら各部門の
          <b>ミッション・プロジェクト・OKR</b>を明確化します。
        </p>
      </header>

      {/* ストーリー */}
      <section className="mb-8">
        {storyChapters.length ? (
          <div className="grid md:grid-cols-2 gap-4">
            {storyChapters.map((ch, i) => (
              <div
                key={i}
                className="p-4 border rounded-2xl bg-white/60 backdrop-blur-sm"
              >
                <h3 className="font-semibold">{ch.title}</h3>
                <div
                  dangerouslySetInnerHTML={{ __html: nl2brSafe(ch.body) }}
                  className="text-sm text-zinc-700 mt-1"
                />
              </div>
            ))}
          </div>
        ) : (
          <div className="p-4 bg-yellow-50 text-yellow-800 text-sm rounded-xl border border-yellow-200">
            経営ストーリーが未設定です。
          </div>
        )}
      </section>

      {/* タブ */}
      <div className="flex justify-between items-center mb-6">
        <div className="inline-flex border rounded-full overflow-hidden">
          {['edit', 'visual'].map((t) => (
            <button
              key={t}
              onClick={() => setActiveTab(t as any)}
              className={`px-4 py-2 text-sm ${
                activeTab === t
                  ? 'bg-zinc-900 text-white'
                  : 'bg-white text-zinc-800'
              }`}
            >
              {t === 'edit' ? '編集' : 'ビジュアル'}
            </button>
          ))}
        </div>
        {canEditCompany && (
          <Button
            onClick={() => setShowForm((v) => !v)}
            className="rounded-full h-9 px-4"
          >
            <PlusCircle className="w-4 h-4 mr-1" />
            {showForm ? '閉じる' : '部門追加'}
          </Button>
        )}
      </div>

      {/* 部門追加フォーム */}
      {showForm && canEditCompany && (
        <div className="p-6 border rounded-3xl bg-white/70 mb-8">
          <div className="grid md:grid-cols-2 gap-4">
            <input
              value={deptName}
              onChange={(e) => setDeptName(e.target.value)}
              placeholder="部門名"
              className="border rounded-xl px-3 py-2"
            />
            <input
              value={deptMission}
              onChange={(e) => setDeptMission(e.target.value)}
              placeholder="ミッション"
              className="border rounded-xl px-3 py-2"
            />
          </div>
          <div className="mt-4 flex justify-end gap-2">
            <Button
              variant="secondary"
              onClick={() => setShowForm(false)}
              className="rounded-full h-9 px-4"
            >
              キャンセル
            </Button>
            <Button
              onClick={() => {
                if (!deptName.trim())
                  return setNotice('⚠️ 部門名を入力してください');
                const newDept: Department = {
                  name: deptName.trim(),
                  mission: deptMission.trim(),
                  strategy: deptMission.trim(),
                  missionDraft: deptMission.trim(),
                  discussionNotes: '',
                  projects: [],
                  answers2: [
                    {
                      chapterIndex: departments.length,
                      chapterTitle: deptName.trim(),
                      steps: [],
                    },
                  ],
                  finalized: false,
                };
                pushToStore([...depsRef.current, newDept]);
                setDeptName('');
                setDeptMission('');
                setShowForm(false);
              }}
              className="rounded-full h-9 px-4"
            >
              追加
            </Button>
          </div>
        </div>
      )}

      {/* 通知 */}
      {notice && (
        <div className="mb-6 text-sm p-3 rounded-xl border bg-emerald-50 text-emerald-800">
          {notice}
        </div>
      )}

      {/* 本体 */}
      {activeTab === 'visual' ? (
        <section>{VisualView}</section>
      ) : (
        <section className="space-y-6">
          {departments.map((dept, index) => {
            const editableDept = canEditDept((dept as any)?.id);
            const L = loading[index] ?? {};
            const inlineDraft = inlineEdit[index] ?? dept.strategy ?? '';
            const answers: DeptAnswerStep[] = toDeptAnswers(
              dept.answers2?.[0]?.steps,
            );
            const allAnswered =
              answers.length >= 3 &&
              answers.every((a) => (a.answer ?? '').trim().length > 0);

            return (
              <div
                key={index}
                className="p-6 border rounded-3xl bg-white/70 backdrop-blur-sm shadow-sm"
              >
                <div className="flex justify-between items-center mb-3">
                  <h3 className="font-semibold text-zinc-900 flex items-center gap-2">
                    <Building2 className="w-4 h-4" /> {dept.name}
                  </h3>
                  {dept.finalized && (
                    <span className="text-xs bg-zinc-900 text-white rounded-full px-2 py-1">
                      確定済み
                    </span>
                  )}
                </div>

                <textarea
                  value={inlineDraft}
                  onChange={(e) =>
                    setInlineEdit((p) => ({ ...p, [index]: e.target.value }))
                  }
                  className="w-full border rounded-xl p-2 mb-2 text-sm"
                  readOnly={!editableDept}
                />
                <Button
                  onClick={() => saveInlineMission(index)}
                  disabled={!editableDept}
                  className="rounded-full h-9 px-4 mb-2"
                >
                  <Save className="w-4 h-4 mr-1" /> 保存
                </Button>

                <DepartmentQuestionStepper
                  departmentName={dept.name}
                  mission={dept.strategy ?? dept.mission}
                  projects={dept.projects?.map((p) => p.title) ?? []}
                  okrs={[]}
                  initialStep={1}
                  initialAnswers={answers}
                  onChange={({ answers }) => {
                    if (!editableDept) return;
                    const next = [...depsRef.current];
                    const d = { ...next[index] };
                    d.answers2 = [
                      {
                        chapterIndex: index,
                        chapterTitle: d.name,
                        steps: toStoreSteps(answers),
                      },
                    ];
                    next[index] = d;
                    pushToStore(next);
                  }}
                  onDraftGenerated={({ mission, projects, okrs }) => {
                    const next = [...depsRef.current];
                    const d = { ...next[index] };
                    if (mission) {
                      d.mission = mission;
                      d.strategy = mission;
                      d.missionDraft = mission;
                    }
                    if (projects?.length)
                      d.projects = projects.map((t) => ({ title: t, okrs: [] }));
                    if (okrs?.length)
                      d.projects = [
                        ...(d.projects ?? []),
                        { title: '初期OKR', okrs: [toStoreOKR(okrs[0])] },
                      ];
                    next[index] = d;
                    pushToStore(next);
                    setNotice(`✅ ${d.name} の案を反映しました`);
                  }}
                />

                {allAnswered && (
                  <div className="mt-4 border rounded-2xl bg-blue-50 p-4 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
                    <div className="text-sm text-blue-900 flex items-center gap-2">
                      <Sparkles className="w-4 h-4" />
                      回答から <b>Mission / Projects / OKR</b> を生成できます。
                    </div>
                    <Button
                      onClick={() => handleGenerateSummary(index)}
                      disabled={!editableDept || !!L.summary}
                      className="rounded-full h-9 px-4"
                    >
                      <FileText className="w-4 h-4 mr-2" />
                      {L.summary ? '生成中…' : 'AI要約を生成'}
                    </Button>
                  </div>
                )}
              </div>
            );
          })}
        </section>
      )}
    </div>
  );
}
