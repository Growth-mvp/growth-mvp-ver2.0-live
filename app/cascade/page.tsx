// /app/cascade/page.tsx（STEP0たたき台＋AI一括アシスト・シンプル版）
'use client';

import { useEffect, useMemo, useState, useCallback, useRef, memo } from 'react';
import { useStrategyStore } from '@/store/strategyStore';
import { useAccess } from '@/utils/access';
import DepartmentQuestionStepper, {
  type DeptAnswerStep,
  type StepNumber,
  type OKR as DeptOKR,
} from '@/components/guide/QuestionStepper.dept';
import { Button } from '@/components/ui/button';
import { PlusCircle, Save, Sparkles, Building2, FileText, Trash2 } from 'lucide-react';

import { useAutoSave } from '@/hooks/useAutoSave';
import { hardResetForCompanySwitch } from '@/utils/resetAll';
import { loadAndHydrate } from '@/utils/loader';

import type {
  Department as BaseDepartment,
  Project as BaseProject,
  OKR as BaseOKR,
  ChapterAnswers as BaseChapterAnswers,
  AnswerStep as BaseAnswerStep,
} from '@/types/strategy';

import { mapTopToExecIds } from '@/lib/strategyPatterns.map';
import type { TopPatternId } from '@/lib/strategyPatterns.top';

/* =========================
   型（store拡張互換）
========================= */
type Project = BaseProject;
type StoreOKR = BaseOKR;
type StoreAnswerStep = BaseAnswerStep;
type StoreChapterAnswers = BaseChapterAnswers;

type RecommendedPattern = {
  id: string;
  title?: string;
  score?: number;
  why?: string[];
};

type Department = BaseDepartment & {
  mission?: string;
  strategy?: string;
  missionDraft?: string;
  discussionNotes?: string;
  answers2?: StoreChapterAnswers[];
  finalized?: boolean;
  recommendedPatterns?: RecommendedPattern[];
  recommendedExecPatterns?: RecommendedPattern[];
};

/* =========================
   ユーティリティ
========================= */
const escapeHtml = (s: string) =>
  String(s ?? '').replace(/[&<>"']/g, (m) =>
    ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    }[m]!)
  );

const nl2brSafe = (s?: string) => (s ? escapeHtml(s).replace(/\r?\n/g, '<br>') : '');

const safeJsonFromText = <T = any>(raw: string): T | null => {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    const m = raw.match(/\{[\s\S]*\}/m);
    if (m) {
      try {
        return JSON.parse(m[0]) as T;
      } catch {
        // ignore
      }
    }
  }
  return null;
};

const jsonEq = (a: any, b: any) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/* ストーリー変換 */
const isNonEmptyStoryPayload = (v: any): boolean => {
  if (!v) return false;
  if (Array.isArray(v)) return v.some((c) => (c.title ?? '').trim() || (c.body ?? '').trim());
  if (typeof v === 'string') return v.trim().length > 0;
  return false;
};

function getStory(raw: any) {
  if (Array.isArray(raw) && raw.length) {
    const chapters = raw
      .map((c: any, i: number) => ({ title: c?.title?.trim() || `Chapter ${i + 1}`, body: c?.body ?? '' }))
      .filter((c) => c.title.trim() || c.body.trim());
    const text = chapters.map((c, i) => `【第${i + 1}章】${c.title}\n${c.body}`).join('\n\n');
    return { text, chapters };
  }
  if (typeof raw === 'string' && raw.trim()) {
    const text = raw.trim();
    const lines = text.split(/\r?\n/);
    const chunkSize = Math.ceil(lines.length / 4);
    const chunks: string[] = [];
    for (let i = 0; i < lines.length; i += chunkSize) chunks.push(lines.slice(i, i + chunkSize).join('\n'));
    const chapters = chunks.map((body, i) => ({ title: `Chapter ${i + 1}`, body }));
    return { text, chapters };
  }
  return { text: '', chapters: [] };
}

/* 変換 */
const toDeptAnswers = (steps?: StoreAnswerStep[]): DeptAnswerStep[] =>
  (steps ?? []).map((s) => ({
    stepNumber: Number(s.stepNumber) as StepNumber,
    question: s.question ?? '',
    reason: s.reason ?? '',
    answer: s.answer ?? '',
    createdAt: '1970-01-01T00:00:00Z',
  }));

const toStoreSteps = (answers: DeptAnswerStep[]): StoreAnswerStep[] =>
  answers.map((a) => ({ stepNumber: a.stepNumber, question: a.question, reason: a.reason, answer: a.answer }));

const toStoreOKR = (o: DeptOKR): StoreOKR => ({
  objective: (o.objective ?? '').trim(),
  keyResults: o.keyResults?.filter(Boolean) ?? [],
  owner: o.owner?.trim() || undefined,
});

/* スナップショット＆ハッシュ（Dirty判定） */
function makeSaveSnapshot(s: any) {
  const snap: any = {
    strategyId: s?.strategyId ?? undefined,
    story: Array.isArray(s?.story) ? s.story : [],
    finalStory: Array.isArray(s?.finalStory) ? s.finalStory : [],
    answers2: Array.isArray(s?.answers2) ? s.answers2 : [],
    departments: Array.isArray(s?.departments) ? s.departments : [],
    companyName: s?.companyName,
    mission: s?.mission,
    vision: s?.vision,
    value: s?.value,
    thought: s?.thought,
  };
  if (Array.isArray(s?.csvFinanceData)) snap.csvFinanceData = s.csvFinanceData;
  if (Array.isArray(s?.financeSummary)) snap.financeSummary = s.financeSummary;
  if (typeof s?.businessPortfolio !== 'undefined') snap.businessPortfolio = s.businessPortfolio;
  if (typeof s?.simulationResult !== 'undefined') snap.simulationResult = s.simulationResult;
  return snap;
}

function hashSnapshot(obj: any) {
  const s = JSON.stringify(obj ?? {});
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = (h * 33) ^ s.charCodeAt(i);
  return (h >>> 0).toString(16);
}

/* シグナル抽出（簡易） */
function extractSignals(params: { industry?: string; mission?: string; answers?: DeptAnswerStep[] }) {
  const { industry, mission = '', answers = [] } = params;
  const text = [mission, ...answers.map((a) => a.answer || '')].join('\n').toLowerCase();
  const has = (ks: string[]) => ks.some((k) => text.includes(k.toLowerCase()));

  const goals: string[] = [];
  const pains: string[] = [];
  const funnel: string[] = [];
  const channels: string[] = [];
  const initiatives: string[] = [];

  if (has(['海外', 'グローバル', '越境', '輸出'])) goals.push('海外売上');
  if (has(['dx', 'デジタル', '自動化', '効率'])) goals.push('DX');
  if (has(['顧客価値', 'ltv', '満足', 'cx'])) goals.push('顧客価値');
  if (has(['利益', '粗利', '収益', 'roic', 'fcf'])) goals.push('収益性向上');

  if (has(['解約', '離脱', 'nps低', '満足度低'])) pains.push('解約率高い');
  if (has(['在庫過多', '在庫'])) pains.push('在庫過多');
  if (has(['欠品'])) pains.push('欠品');
  if (has(['リードタイム', 'lt', '納期遅延'])) pains.push('リードタイム長い');
  if (has(['データ活用', '可視化不足', '分析不足', '属人', '手作業'])) pains.push('データ活用不足');
  if (has(['価格が高い', '値引き', '値下げ', '価格抵抗'])) pains.push('価格抵抗');

  if (has(['cvr', 'コンバージョン', '成約率', 'ドロップ'])) funnel.push('CVR低い');
  if (has(['導線', 'ステップが多い', '手続き'])) funnel.push('導線複雑');
  if (has(['稟議', '承認'])) funnel.push('稟議長い');

  if (has(['直販', 'インサイド', 'フィールド'])) channels.push('直販');
  if (has(['代理店', 'パートナー', 'チャネル'])) channels.push('代理店');

  if (has(['値上げ', '価格改定'])) initiatives.push('値上げ');
  if (has(['sop', '標準化', 'プレイブック'])) initiatives.push('SOP');
  if (has(['デモ', '試算', 'poc'])) initiatives.push('デモ/試算');
  if (has(['週次', 'wbr'])) initiatives.push('週次改善');

  return {
    industry,
    goals: Array.from(new Set(goals)),
    pains: Array.from(new Set(pains)),
    funnel: Array.from(new Set(funnel)),
    channels: Array.from(new Set(channels)),
    initiatives: Array.from(new Set(initiatives)),
  };
}

/* OKR 日本語表示（簡素） */
const OKRBlock = memo(function OKRBlock({ okr }: { okr?: { objective?: string; keyResults?: string[]; owner?: string } }) {
  if (!okr) return null;
  const objective = (okr.objective ?? '').trim();
  const krs = (okr.keyResults ?? []).filter(Boolean);
  if (!objective && krs.length === 0) return null;
  return (
    <div className="mt-2">
      {objective && <div className="text-sm font-medium">達成目標：{objective}</div>}
      {krs.length > 0 && (
        <ul className="list-disc pl-5 text-sm mt-1 space-y-1">
          {krs.map((kr, i) => (
            <li key={i}>主要な成果：{kr}</li>
          ))}
        </ul>
      )}
    </div>
  );
});

/* ビジュアルカード（部門戦略の全体像をシンプル表示） */
const VisualCard = memo(function VisualCard({ d }: { d: Department }) {
  const mission = (d.strategy ?? d.mission ?? '').trim();
  const projects = d.projects ?? [];

  const shortSummary = mission.length > 32 ? mission.slice(0, 32) + '…' : mission;

  return (
    <div className="p-6 rounded-3xl border bg-white/70 backdrop-blur-sm shadow-sm">
      {/* ヘッダー */}
      <div className="flex justify-between items-start mb-3 gap-2">
        <div>
          <h3 className="font-semibold flex items-center gap-2 text-zinc-900">
            <Building2 className="w-4 h-4" />
            {d.name}
          </h3>
          {mission && (
            <p className="mt-1 text-xs text-zinc-500 line-clamp-2">
              {shortSummary}
            </p>
          )}
        </div>
        {d.finalized && (
          <span className="text-xs bg-zinc-900 text-white rounded-full px-2 py-1">
            確定済み
          </span>
        )}
      </div>

      {/* ミッション（ラベル無しで本文のみ） */}
      {mission && (
        <div className="mb-4">
          <p className="text-sm text-zinc-800 whitespace-pre-wrap">
            {mission}
          </p>
        </div>
      )}

      {/* プロジェクト一覧 */}
      {projects.length > 0 ? (
        <div>
          <div className="text-xs font-semibold text-zinc-500 mb-1">
            主なプロジェクトと目標
          </div>
          <ul className="space-y-3">
            {projects.map((p, i) => {
              const okr = p.okrs?.[0];
              const krs = okr?.keyResults?.filter(Boolean) ?? [];
              return (
                <li key={i} className="rounded-2xl border bg-white/80 px-3 py-2">
                  <div className="text-sm font-medium text-zinc-900">
                    • {p.title || '無題のプロジェクト'}
                  </div>
                  {okr?.objective && (
                    <div className="mt-1 text-xs text-zinc-700">
                      目標：{okr.objective}
                    </div>
                  )}
                  {krs.length > 0 && (
                    <ul className="mt-1 pl-4 space-y-1 list-disc text-xs text-zinc-700">
                      {krs.slice(0, 3).map((kr, idx) => (
                        <li key={idx}>{kr}</li>
                      ))}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      ) : (
        <p className="text-xs text-zinc-500">
          まだプロジェクトが設定されていません。「編集」タブから追加してください。
        </p>
      )}
    </div>
  );
});

/* =========================
   メイン
========================= */
export default function CascadePage() {
  const s = useStrategyStore() as any;

  const {
    companyId: scopeCompanyId,
    hydrated,
    setCompanyScope,
    refetchFromServer,
    setHydrated,
    boot,
    saveStrategyData: saveNow,
    lastServerSnapshot,
    setDepartments: setDepartmentsInStore,
  } = useStrategyStore();

  const access = useAccess();
  const canEditCompany = access.canEditCompany();
  const canEditDept = access.canEditDepartment;

  const accessCompanyId: string | undefined = useMemo(
    () => ((access as any)?.companyId ?? (s?.companyId as string | undefined)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [(access as any)?.companyId, s?.companyId],
  );

  const industry: string = (s?.industry as string) || (s?.company?.industry as string) || '';

  /* ---- 初回ログだけ ---- */
  useEffect(() => {
    console.log('[cascade] mount', { hydrated, scopeCompanyId, accessCompanyId });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ===== 会社スコープ確立（StrictMode耐性）===== */
  const lastAppliedCompanyRef = useRef<string | null>(null);
  useEffect(() => {
    if (!accessCompanyId) return;
    if (lastAppliedCompanyRef.current === accessCompanyId && scopeCompanyId === accessCompanyId) return;

    if (scopeCompanyId && scopeCompanyId !== accessCompanyId) {
      setHydrated?.(false);
      hardResetForCompanySwitch(accessCompanyId);
      setCompanyScope(accessCompanyId);
    } else if (!scopeCompanyId) {
      setCompanyScope(accessCompanyId);
    }
    lastAppliedCompanyRef.current = accessCompanyId;
  }, [accessCompanyId, scopeCompanyId, setCompanyScope, setHydrated]);

  /* ===== 初期ロード（Dirty回避＋フェイルセーフ） ===== */
  const loadGuardRef = useRef<string | null>(null);
  useEffect(() => {
    if (!accessCompanyId) return;
    if (!scopeCompanyId) setCompanyScope(accessCompanyId);
    if (loadGuardRef.current === accessCompanyId && hydrated && scopeCompanyId === accessCompanyId) return;

    let cancelled = false;
    const run = async () => {
      if (hydrated && scopeCompanyId === accessCompanyId) {
        loadGuardRef.current = accessCompanyId;
        return;
      }

      const currentSnap = makeSaveSnapshot(useStrategyStore.getState());
      const currentHash = hashSnapshot(currentSnap);
      const isDirty = !!(lastServerSnapshot && lastServerSnapshot !== currentHash);

      const timer = setTimeout(() => !cancelled && setHydrated?.(true), 7000);
      try {
        if (!isDirty) {
          await loadAndHydrate(accessCompanyId);
          try {
            await refetchFromServer?.();
          } catch {
            // ignore
          }
          setHydrated?.(true);
        } else {
          setHydrated?.(true);
        }
        loadGuardRef.current = accessCompanyId;
      } finally {
        clearTimeout(timer);
      }
      if (cancelled) return;
    };
    run();
    return () => {
      cancelled = true;
    };
  }, [accessCompanyId, hydrated, scopeCompanyId, refetchFromServer, setHydrated, lastServerSnapshot, setCompanyScope]);

  /* ===== ハイドレーション・ウォッチドッグ ===== */
  const hydrateStartRef = useRef<number | null>(null);
  useEffect(() => {
    const mismatch = !!(accessCompanyId && scopeCompanyId && scopeCompanyId !== accessCompanyId);
    const nowHydrating = (boot?.isHydrating && !hydrated) || mismatch;

    if (nowHydrating) {
      if (hydrateStartRef.current == null) hydrateStartRef.current = Date.now();
    } else {
      hydrateStartRef.current = null;
    }

    const id = setInterval(() => {
      if (hydrateStartRef.current != null && Date.now() - hydrateStartRef.current > 5000) {
        setHydrated?.(true);
        hydrateStartRef.current = null;
      }
    }, 1000);
    return () => clearInterval(id);
  }, [boot?.isHydrating, hydrated, accessCompanyId, scopeCompanyId, setHydrated]);

  /* ===== departments（store を唯一のソースに） ===== */
  const departments = useStrategyStore(
    (st) => ((st.departments as Department[] | undefined) ?? []) as Department[],
  );

  // hydrated 後のみオートセーブ対象にする
  useAutoSave(hydrated && !boot?.isHydrating ? [accessCompanyId, departments] : []);

  const mismatch = !!(accessCompanyId && scopeCompanyId && scopeCompanyId !== accessCompanyId);
  const isHydrating = (Boolean(boot?.isHydrating) && !hydrated) || mismatch || !hydrated;

  const rawStory = useMemo(() => {
    if (isNonEmptyStoryPayload(s?.finalStory)) return s.finalStory;
    if (isNonEmptyStoryPayload(s?.story)) return s.story;
    if (isNonEmptyStoryPayload(s?.strategyStory)) return s.strategyStory;
    return '';
  }, [s?.finalStory, s?.story, s?.strategyStory]);
  const { text: storyText, chapters: storyChapters } = useMemo(() => getStory(rawStory), [rawStory]);

  const [notice, setNotice] = useState('');

  /* ===== 部門配列更新ヘルパー（常に最新 state を基準） ===== */
  const pushToStore = useCallback(
    (next: Department[] | ((prev: Department[]) => Department[])) => {
      const prev = ((useStrategyStore.getState().departments as Department[] | undefined) ?? []) as Department[];
      const resolved = typeof next === 'function' ? (next as (p: Department[]) => Department[])(prev) : next;
      if (!jsonEq(prev, resolved)) {
        setDepartmentsInStore?.(resolved);
      }
    },
    [setDepartmentsInStore],
  );

  const [activeTab, setActiveTab] = useState<'edit' | 'visual'>('edit');
  const [showForm, setShowForm] = useState(false);
  const [deptName, setDeptName] = useState('');
  const [deptMission, setDeptMission] = useState('');
  const [inlineEdit, setInlineEdit] = useState<Record<number, string>>({});
  const [loading, setLoading] = useState<Record<number, any>>({});

  /* ===== 部門の増減に応じてインライン編集状態をリセット ===== */
  useEffect(() => {
    setInlineEdit({});
  }, [departments.length]);

  /* ===== その場保存 ===== */
  const saveInlineMission = async (index: number) => {
    let changed = false;

    pushToStore((prev) => {
      const current = [...prev];
      const d = current[index];
      if (!d) return prev;

      const draft = (inlineEdit[index] ?? d.strategy ?? d.mission ?? '').toString();
      if ((d.mission ?? '') === draft && (d.strategy ?? '') === draft && (d.missionDraft ?? '') === draft) {
        return prev;
      }

      const updated: Department = {
        ...d,
        mission: draft,
        strategy: draft,
        missionDraft: draft,
      };
      current[index] = updated;
      changed = true;
      return current;
    });

    if (!changed) {
      setNotice('（変更なし）');
      return;
    }

    setNotice('✅ 保存しました');

    if (saveNow) {
      try {
        await saveNow();
        setNotice('✅ 保存しました（サーバーにも反映済み）');
      } catch {
        setNotice('⚠️ ローカル保存は完了しましたが、サーバー保存に失敗しました');
      }
    }
  };

  const requireStoryOrWarn = (): string | null => {
    if (!storyText.trim()) {
      setNotice('⚠️ 経営ストーリーを作成してください');
      return null;
    }
    return storyText;
  };

  /* ===== 離脱/非表示時の即時保存 ===== */
  useEffect(() => {
    const flush = async () => {
      const st = useStrategyStore.getState();
      if (st.boot?.isHydrating || !st.boot?.isHydrated) return;
      const snap = makeSaveSnapshot(st);
      const hash = hashSnapshot(snap);
      if (st.lastServerSnapshot && st.lastServerSnapshot === hash) return;
      try {
        await saveNow?.();
      } catch {
        // ignore
      }
    };
    const onBeforeUnload = () => void flush();
    const onPageHide = () => void flush();
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') void flush();
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    window.addEventListener('pagehide', onPageHide);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload);
      window.removeEventListener('pagehide', onPageHide);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [saveNow]);

  /* ===== 推薦API（t系） ===== */
  const handleRecommendPatterns = async (index: number) => {
    const current = (useStrategyStore.getState().departments as Department[] | undefined) ?? [];
    const dept = current[index];
    if (!dept) return;
    if (!canEditDept()) return setNotice('⚠️ 編集権限がありません');

    const answers: DeptAnswerStep[] = toDeptAnswers(dept.answers2?.[0]?.steps);
    const signals = extractSignals({ industry, mission: dept.strategy ?? dept.mission ?? '', answers });

    setLoading((p) => ({ ...p, [index]: { ...(p[index] || {}), recommend: true } }));
    try {
      const res = await fetch('/api/recommend-top-patterns', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ signals, k: 3 }),
      });
      const text = await res.text();
      const data = safeJsonFromText<{ detail?: RecommendedPattern[] }>(text) ?? {};

      pushToStore((prev) => {
        const list = [...prev];
        const d = list[index];
        if (!d) return prev;
        const nextPatterns = data.detail ?? [];
        if (jsonEq(d.recommendedPatterns, nextPatterns)) return prev;
        list[index] = { ...d, recommendedPatterns: nextPatterns };
        return list;
      });

      setNotice(`✅ ${dept.name} にAIの推奨パターンを反映しました`);
    } catch (err: any) {
      setNotice(`❌ 推薦に失敗：${err.message}`);
      throw err;
    } finally {
      setLoading((p) => ({ ...p, [index]: { ...(p[index] || {}), recommend: false } }));
    }
  };

  /* ===== 推薦API（e系）===== */
  const handleRecommendExecPatterns = async (index: number) => {
    const current = (useStrategyStore.getState().departments as Department[] | undefined) ?? [];
    const dept = current[index];
    if (!dept) return;
    if (!canEditDept()) return setNotice('⚠️ 編集権限がありません');

    const answers: DeptAnswerStep[] = toDeptAnswers(dept.answers2?.[0]?.steps);
    const signals = extractSignals({ industry, mission: dept.strategy ?? dept.mission ?? '', answers });

    setLoading((p) => ({ ...p, [index]: { ...(p[index] || {}), recommendExec: true } }));
    try {
      const res = await fetch('/api/recommend-exec-patterns', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ signals, k: 3 }),
      });
      const text = await res.text();
      const data = safeJsonFromText<{ detail?: RecommendedPattern[] }>(text) ?? {};

      pushToStore((prev) => {
        const list = [...prev];
        const d = list[index];
        if (!d) return prev;
        const nextPatterns = data.detail ?? [];
        if (jsonEq(d.recommendedExecPatterns, nextPatterns)) return prev;
        list[index] = { ...d, recommendedExecPatterns: nextPatterns };
        return list;
      });

      setNotice(`✅ ${dept.name} にAIの実行パターン候補を反映しました`);
    } catch (err: any) {
      setNotice(`❌ 実行パターン推薦に失敗：${err.message}`);
      throw err;
    } finally {
      setLoading((p) => ({ ...p, [index]: { ...(p[index] || {}), recommendExec: false } }));
    }
  };

  /* ===== e系→OKR 雛形 ===== */
  const handleOKRFromExec = async (index: number) => {
    const current = (useStrategyStore.getState().departments as Department[] | undefined) ?? [];
    const dept = current[index];
    if (!dept) return;
    if (!canEditDept()) return setNotice('⚠️ OKR生成の権限がありません');

    const execIds: string[] =
      (dept.recommendedExecPatterns?.map((p) => p.id) ?? []).length
        ? dept.recommendedExecPatterns!.map((p) => p.id)
        : mapTopToExecIds(
            (dept.recommendedPatterns ?? [])
              .map((p) => p.id as TopPatternId)
              .filter(Boolean) as TopPatternId[],
          );

    if (!execIds.length) {
      setNotice('⚠️ 実行パターンがありません（先にAIの推薦を行ってください）');
      return;
    }

    setLoading((p) => ({ ...p, [index]: { ...(p[index] || {}), okrGen: true } }));
    try {
      const res = await fetch('/api/okr-from-exec', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          execIds,
          context: { departmentName: dept.name, industry, mission: dept.strategy ?? dept.mission ?? '' },
        }),
      });
      const text = await res.text();
      const data =
        safeJsonFromText<{
          items: { id: string; title: string; okr: { objective: string; keyResults: string[]; owner?: string } }[];
        }>(text) ?? { items: [] };

      if (!data.items?.length) {
        setNotice('⚠️ OKR雛形が生成されませんでした');
        return;
      }

      pushToStore((prev) => {
        const list = [...prev];
        const d = list[index];
        if (!d) return prev;
        const projects: Project[] = [...(d.projects ?? [])];

        for (const it of data.items) {
          const title = it.title || 'OKR';
          const okr = it.okr;
          const existIdx = projects.findIndex((p) => (p?.title ?? '') === title);
          if (existIdx >= 0) {
            const exist = { ...projects[existIdx] };
            const existOkrs = [...(exist.okrs ?? [])];
            const candidate = { objective: okr.objective, keyResults: okr.keyResults ?? [], owner: okr.owner };
            if (!existOkrs.some((o) => jsonEq(o, candidate))) {
              existOkrs.push(candidate);
              exist.okrs = existOkrs;
              projects[existIdx] = exist;
            }
          } else {
            projects.push({
              title,
              okrs: [{ objective: okr.objective, keyResults: okr.keyResults ?? [], owner: okr.owner }],
            } as Project);
          }
        }

        if (jsonEq(projects, d.projects)) return prev;
        list[index] = { ...d, projects };
        return list;
      });

      setNotice(`✅ ${dept.name} に OKR雛形を追加しました（${data.items.length}件）`);
    } catch (e: any) {
      setNotice(`❌ OKR雛形の展開に失敗：${e.message}`);
      throw e;
    } finally {
      setLoading((p) => ({ ...p, [index]: { ...(p[index] || {}), okrGen: false } }));
    }
  };

  /* ===== 内部用：回答＋ストーリーから Mission / Projects / OKR を整理 ===== */
  const generateSummaryAndPatch = async (index: number) => {
    const current = (useStrategyStore.getState().departments as Department[] | undefined) ?? [];
    const dept = current[index];
    if (!dept) return;
    if (!canEditDept()) {
      setNotice('⚠️ 編集権限がありません');
      return;
    }

    const steps = dept.answers2?.[0]?.steps && dept.answers2[0].steps.length > 0 ? dept.answers2[0].steps : [];
    const story = requireStoryOrWarn();
    if (!story) return;

    try {
      const res = await fetch('/api/generate-department-summary', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ departmentName: dept.name, story, answers: steps, industry }),
      });
      const text = await res.text();
      const data = safeJsonFromText<any>(text) ?? {};

      pushToStore((prev) => {
        const list = [...prev];
        const d = list[index];
        if (!d) return prev;

        const nextMission = data.mission ?? d.mission ?? '';
        const nextProjects: Project[] = (data.projects ?? []).map((t: string) => ({
          title: t,
          okrs: data.okrs && data.okrs[0] ? [toStoreOKR(data.okrs[0] as DeptOKR)] : [],
        }));

        let changed = false;
        const patch: Partial<Department> = {};

        if (
          nextMission &&
          (!jsonEq(nextMission, d.mission) || !jsonEq(nextMission, d.strategy) || !jsonEq(nextMission, d.missionDraft))
        ) {
          patch.mission = nextMission;
          patch.strategy = nextMission;
          patch.missionDraft = nextMission;
          changed = true;
        }
        if (nextProjects.length && !jsonEq(nextProjects, d.projects)) {
          patch.projects = nextProjects;
          changed = true;
        }

        if (!changed) return prev;
        list[index] = { ...d, ...patch } as Department;
        return list;
      });
    } catch (err) {
      setNotice('❌ 回答からの部門戦略要約に失敗しました');
      throw err;
    }
  };

  /* ===== STEP0用：ミッション＋プロジェクトたたき台生成 ===== */
  const handleInitialDraft = async (index: number) => {
    const current = (useStrategyStore.getState().departments as Department[] | undefined) ?? [];
    const dept = current[index];
    if (!dept) return;
    if (!canEditDept()) return setNotice('⚠️ 編集権限がありません');

    const story = requireStoryOrWarn();
    if (!story) return;

    setLoading((p) => ({ ...p, [index]: { ...(p[index] || {}), initialDraft: true } }));
    try {
      const res = await fetch('/api/generate-department-summary', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          departmentName: dept.name,
          story,
          answers: [], // STEP0なので回答なしでたたき台だけ生成
          industry,
        }),
      });
      const text = await res.text();
      const data = safeJsonFromText<any>(text) ?? {};

      const nextMission = data.mission ?? '';
      const nextProjectsRaw: string[] = data.projects ?? [];

      if (!nextMission && (!nextProjectsRaw || nextProjectsRaw.length === 0)) {
        setNotice('⚠️ ミッション / プロジェクト案が生成されませんでした（経営ストーリーや部門名を見直してください）');
        return;
      }

      pushToStore((prev) => {
        const list = [...prev];
        const d = list[index];
        if (!d) return prev;

        const nextProjects: Project[] = nextProjectsRaw.map((t: string) => ({
          title: t,
          okrs: [],
        }));

        let changed = false;
        const patch: Partial<Department> = {};

        if (
          nextMission &&
          (!jsonEq(nextMission, d.mission) || !jsonEq(nextMission, d.strategy) || !jsonEq(nextMission, d.missionDraft))
        ) {
          patch.mission = nextMission;
          patch.strategy = nextMission;
          patch.missionDraft = nextMission;
          changed = true;
        }
        if (nextProjects.length && !jsonEq(nextProjects, d.projects)) {
          patch.projects = nextProjects;
          changed = true;
        }

        if (!changed) return prev;
        list[index] = { ...d, ...patch } as Department;
        return list;
      });

      setNotice(`✅ ${dept.name} のミッションとプロジェクト案を反映しました`);
    } catch (err: any) {
      setNotice(`❌ ミッション/プロジェクト案の生成に失敗：${err.message}`);
    } finally {
      setLoading((p) => ({ ...p, [index]: { ...(p[index] || {}), initialDraft: false } }));
    }
  };

  /* ===== AI一括アシスト：部門戦略案（ミッション・プロジェクト・目標）生成 ===== */
  const handleFullAssist = async (index: number) => {
    const current = (useStrategyStore.getState().departments as Department[] | undefined) ?? [];
    const dept = current[index];
    if (!dept) return;
    if (!canEditDept()) return setNotice('⚠️ 編集権限がありません');

    // 回答状況チェック（3問すべて回答済み前提）
    const steps = dept.answers2?.[0]?.steps && dept.answers2[0].steps.length > 0 ? dept.answers2[0].steps : [];
    if (steps.length < 3 || steps.some((s) => !(s.answer ?? '').trim())) {
      return setNotice('⚠️ まず 3つの質問にすべて回答してください');
    }

    setLoading((p) => ({ ...p, [index]: { ...(p[index] || {}), fullAssist: true } }));
    try {
      // 1. 回答＋ストーリーから Mission / Projects / OKR を整理
      await generateSummaryAndPatch(index);
      // 2. 勝ちパターン推薦（t系）（画面には出さないが内部で利用）
      await handleRecommendPatterns(index);
      // 3. 実装パターン推薦（e系）（画面には出さないが内部で利用）
      await handleRecommendExecPatterns(index);
      // 4. 実装パターン → OKR雛形生成
      await handleOKRFromExec(index);

      setNotice(
        `✅ ${dept.name} の部門戦略案をAIで整理しました（ミッション・プロジェクト・目標のたたき台を追加しています）`,
      );
    } catch (e: any) {
      if (!e?.silenced) {
        setNotice(`❌ 部門戦略案の生成に失敗しました：${e?.message ?? '不明なエラー'}`);
      }
    } finally {
      setLoading((p) => ({ ...p, [index]: { ...(p[index] || {}), fullAssist: false } }));
    }
  };

  /* ===== プロジェクト削除 ===== */
  const handleDeleteProject = async (deptIndex: number, projectIndex: number) => {
    const current = (useStrategyStore.getState().departments as Department[] | undefined) ?? [];
    const dept = current[deptIndex];
    if (!dept) return;
    if (!canEditDept()) return setNotice('⚠️ プロジェクト削除の権限がありません');

    const targetProject = dept.projects?.[projectIndex];
    if (!targetProject) return;

    const ok = window.confirm(`プロジェクト「${targetProject.title || '無題'}」を削除しますか？`);
    if (!ok) return;

    pushToStore((prev) => {
      const list = [...prev];
      const d = list[deptIndex];
      if (!d) return prev;
      const projects = [...(d.projects ?? [])];
      projects.splice(projectIndex, 1);
      list[deptIndex] = { ...d, projects };
      return list;
    });

    setNotice(`🗑 プロジェクト「${targetProject.title || '無題'}」を削除しました`);

    if (saveNow) {
      try {
        await saveNow();
        setNotice(`🗑 プロジェクト「${targetProject.title || '無題'}」を削除しました（サーバーにも反映済み）`);
      } catch {
        setNotice(`⚠️ プロジェクト削除をサーバーに保存できませんでした（画面上は削除済み）`);
      }
    }
  };

  /* ===== プロジェクト追加 ===== */
  const handleAddProject = async (deptIndex: number) => {
    const current = (useStrategyStore.getState().departments as Department[] | undefined) ?? [];
    const dept = current[deptIndex];
    if (!dept) return;
    if (!canEditDept()) return setNotice('⚠️ プロジェクト追加の権限がありません');

    const baseTitle = '新しいプロジェクト';
    const existing = new Set((dept.projects ?? []).map((p) => p.title || ''));
    let title = baseTitle;
    let n = 2;
    while (existing.has(title)) {
      title = `${baseTitle} ${n}`;
      n += 1;
    }

    pushToStore((prev) => {
      const list = [...prev];
      const d = list[deptIndex];
      if (!d) return prev;
      const projects: Project[] = [...(d.projects ?? []), { title, okrs: [] as StoreOKR[] } as Project];
      list[deptIndex] = { ...d, projects };
      return list;
    });

    setNotice(`✅ プロジェクト「${title}」を追加しました`);

    if (saveNow) {
      try {
        await saveNow();
        setNotice(`✅ プロジェクト「${title}」を追加しました（サーバーにも反映済み）`);
      } catch {
        setNotice(`⚠️ プロジェクト「${title}」の追加は画面上のみ反映されました（サーバー保存に失敗）`);
      }
    }
  };

  /* ===== 部門削除 ===== */
  const handleDeleteDepartment = async (index: number) => {
    if (!canEditCompany) {
      setNotice('⚠️ 部門削除は管理者のみ可能です');
      return;
    }

    const current = (useStrategyStore.getState().departments as Department[] | undefined) ?? [];
    const target = current[index];
    if (!target) return;

    const ok = window.confirm(`「${target.name}」を削除しますか？\nこの操作は元に戻せません。`);
    if (!ok) return;

    pushToStore((prev) => {
      const raw = prev.filter((_, i) => i !== index);
      const next: Department[] = raw.map((d, i) => ({
        ...d,
        answers2: (d.answers2 ?? []).map((ch) => ({
          ...ch,
          chapterIndex: i,
          chapterTitle: d.name,
        })),
      }));
      return next;
    });

    setNotice(`🗑 ${target.name} を削除しました`);

    if (saveNow) {
      try {
        await saveNow();
        setNotice(`🗑 ${target.name} を削除しました（サーバーにも反映済み）`);
      } catch {
        setNotice(`⚠️ ${target.name} の削除をサーバーに保存できませんでした（画面上は削除済み）`);
      }
    }
  };

  /* ===== ビジュアルビュー ===== */
  const VisualView = useMemo(() => {
    if (!departments.length) return <div className="text-zinc-600">部門がまだ登録されていません。</div>;
    return (
      <div className="grid md:grid-cols-2 gap-6">
        {departments.map((d, i) => (
          <VisualCard key={`v-${d.name}-${i}`} d={d} />
        ))}
      </div>
    );
  }, [departments]);

  /* map内 hooks 回避のためのメモ */
  const answersMemo: DeptAnswerStep[][] = useMemo(
    () => departments.map((d) => toDeptAnswers(d.answers2?.[0]?.steps)),
    [departments],
  );
  const projectsMemo: string[][] = useMemo(
    () => departments.map((d) => d.projects?.map((p) => p.title) ?? []),
    [departments],
  );

  /* ===== JSX ===== */
  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      <header className="mb-8">
        <h1 className="text-[28px] font-semibold mb-2">STAGE 3：部門戦略策定</h1>
        <p className="text-zinc-600 text-sm">
          経営ストーリーを基に、質問に答えながら各部門の<b>ミッション・プロジェクト・OKR（達成目標/主要な成果）</b>を明確化します。
        </p>
      </header>

      {/* 読み込みインジケータ（簡素） */}
      {isHydrating && (
        <div className="mb-8 rounded-xl border p-4 text-sm text-muted-foreground flex items-center justify-between">
          <span>読み込み中…</span>
          <Button
            variant="secondary"
            className="h-8 rounded-full px-3"
            onClick={() => setHydrated?.(true)}
            title="強制的に読み込み完了にします"
          >
            手動で続行
          </Button>
        </div>
      )}

      {/* ストーリー（簡素） */}
      {!isHydrating && (
        <section className="mb-8">
          {storyChapters.length ? (
            <div className="grid md:grid-cols-2 gap-4">
              {storyChapters.map((ch, i) => (
                <div key={i} className="p-4 border rounded-2xl bg白/60 backdrop-blur-sm">
                  <h3 className="font-semibold">{ch.title}</h3>
                  <div dangerouslySetInnerHTML={{ __html: nl2brSafe(ch.body) }} className="text-sm text-zinc-700 mt-1" />
                </div>
              ))}
            </div>
          ) : (
            <div className="p-4 bg-yellow-50 text-yellow-800 text-sm rounded-xl border border-yellow-200">
              経営ストーリーが未設定です。
            </div>
          )}
        </section>
      )}

      {/* タブ＋追加ボタン＋全体保存 */}
      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3 mb-6">
        <div className="inline-flex border rounded-full overflow-hidden">
          {(['edit', 'visual'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setActiveTab(t)}
              className={`px-4 py-2 text-sm ${activeTab === t ? 'bg-zinc-900 text-white' : 'bg-white text-zinc-800'}`}
              disabled={isHydrating}
            >
              {t === 'edit' ? '編集' : 'ビジュアル'}
            </button>
          ))}
        </div>

        <div className="flex gap-2 justify-end">
          {/* 明示的な全体保存ボタン */}
          <Button
            variant="outline"
            className="rounded-full h-9 px-4"
            disabled={isHydrating}
            onClick={async () => {
              if (!saveNow) return;
              try {
                setNotice('💾 保存中です…');
                await saveNow();
                setNotice('✅ 全体を保存しました（サーバーにも反映済み）');
              } catch (e: any) {
                setNotice(`❌ 保存に失敗しました：${e?.message ?? '不明なエラー'}`);
              }
            }}
          >
            <Save className="w-4 h-4 mr-1" />
            全体保存
          </Button>

          {canEditCompany && (
            <Button onClick={() => setShowForm((v) => !v)} className="rounded-full h-9 px-4" disabled={isHydrating}>
              <PlusCircle className="w-4 h-4 mr-1" />
              {showForm ? '閉じる' : '部門追加'}
            </Button>
          )}
        </div>
      </div>

      {/* 追加フォーム（簡素） */}
      {showForm && canEditCompany && !isHydrating && (
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
              placeholder="（任意）ミッションのメモ"
              className="border rounded-xl px-3 py-2"
            />
          </div>
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setShowForm(false)} className="rounded-full h-9 px-4">
              キャンセル
            </Button>
            <Button
              onClick={async () => {
                if (!deptName.trim()) return setNotice('⚠️ 部門名を入力してください');
                const baseName = deptName.trim();
                const baseMission = deptMission.trim();

                let nextLength = 0;
                pushToStore((prev) => {
                  const current = [...prev];
                  const newDept: Department = {
                    name: baseName,
                    mission: baseMission,
                    strategy: baseMission,
                    missionDraft: baseMission,
                    discussionNotes: '',
                    projects: [],
                    answers2: [{ chapterIndex: current.length, chapterTitle: baseName, steps: [] }],
                    finalized: false,
                    recommendedPatterns: [],
                    recommendedExecPatterns: [],
                  };
                  current.push(newDept);
                  nextLength = current.length;
                  return current;
                });

                setDeptName('');
                setDeptMission('');
                setShowForm(false);
                setNotice(`✅ ${baseName} を追加しました（部門数: ${nextLength}）`);

                if (saveNow) {
                  try {
                    await saveNow();
                    setNotice(`✅ ${baseName} を追加しました（サーバーにも反映済み）`);
                  } catch {
                    setNotice(`⚠️ ${baseName} の追加は画面上は反映されていますが、サーバー保存に失敗しました`);
                  }
                }
              }}
              className="rounded-full h-9 px-4"
            >
              追加
            </Button>
          </div>
        </div>
      )}

      {/* 通知（簡素） */}
      {notice && <div className="mb-6 text-sm p-3 rounded-xl border bg-emerald-50 text-emerald-800">{notice}</div>}

      {/* 本体 */}
      {activeTab === 'visual' ? (
        <section>{VisualView}</section>
      ) : (
        <section className="space-y-6">
          {departments.map((dept, index) => {
            const editableDept = canEditDept();
            const L = loading[index] ?? {};
            const inlineDraft = (inlineEdit[index] ?? dept.strategy ?? dept.mission ?? '').toString();

            const answers = answersMemo[index];
            const projTitles = projectsMemo[index];
            const allAnswered = answers.length >= 3 && answers.every((a) => (a.answer ?? '').trim().length > 0);
            const currentStoreSteps = dept.answers2?.[0]?.steps ?? [];

            const deptMissionText = (dept.strategy ?? dept.mission ?? '').trim();

            return (
              <div key={`e-${dept.name}-${index}`} className="p-6 border rounded-3xl bg-white/70 backdrop-blur-sm shadow-sm">
                <div className="flex justify-between items-center mb-3">
                  <h3 className="font-semibold text-zinc-900 flex items-center gap-2">
                    <Building2 className="w-4 h-4" /> {dept.name}
                  </h3>
                  <div className="flex items-center gap-2">
                    {dept.finalized && (
                      <span className="text-xs bg-zinc-900 text-white rounded-full px-2 py-1">確定済み</span>
                    )}
                    {canEditCompany && (
                      <Button
                        variant="outline"
                        className="h-8 px-3 rounded-full border-red-500 text-red-600 hover:bg-red-50 flex items-center gap-1"
                        disabled={isHydrating}
                        onClick={() => handleDeleteDepartment(index)}
                        title="この部門を削除"
                      >
                        <Trash2 className="w-4 h-4" />
                        <span className="text-xs">削除</span>
                      </Button>
                    )}
                  </div>
                </div>

                {/* 部門ミッション（AIたたき台＋手修正用） */}
                <textarea
                  value={inlineDraft}
                  onChange={(e) => setInlineEdit((p) => ({ ...p, [index]: e.target.value }))}
                  className="w-full border rounded-xl p-2 mb-2 text-sm"
                  readOnly={!editableDept || isHydrating}
                  placeholder="この部門の役割やミッションのイメージを記入してください（AIたたき台の修正もここで行います）"
                />

                {/* 保存＋AIたたき台（STEP0） */}
                <div className="flex flex-wrap gap-2 mb-1">
                  <Button
                    onClick={() => void saveInlineMission(index)}
                    disabled={!editableDept || isHydrating}
                    className="rounded-full h-9 px-4"
                  >
                    <Save className="w-4 h-4 mr-1" /> 保存
                  </Button>

                  <Button
                    variant="outline"
                    onClick={() => handleInitialDraft(index)}
                    disabled={!editableDept || !!L.initialDraft || isHydrating}
                    className="rounded-full h-9 px-4"
                    title="AIがミッションとプロジェクトのたたき台を提案します"
                  >
                    <Sparkles className="w-4 h-4 mr-1" />
                    {L.initialDraft ? 'たたき台を生成中…' : 'AIでミッションとプロジェクト案'}
                  </Button>
                </div>
                <p className="text-xs text-zinc-500 mb-3">
                  ※ 「AIでミッションとプロジェクト案」を押すと、経営ストーリーと部門名から、
                  <b>ミッションとプロジェクトのたたき台</b> をAIが提案します。
                  <br />
                  ※ 3つの質問に回答すると、この下部に「AIで部門戦略案を生成」ボタンが表示され、
                  <b>部門戦略（ミッション・プロジェクト・目標）のたたき台</b> を一括で整理できます。
                </p>

                {/* 掘り下げ質問（3問） */}
                <DepartmentQuestionStepper
                  departmentName={dept.name}
                  mission={dept.strategy ?? dept.mission}
                  projects={projTitles}
                  okrs={[]}
                  initialStep={1}
                  initialAnswers={answers}
                  onChange={({ answers }) => {
                    if (!editableDept || isHydrating) return;
                    const nextSteps = toStoreSteps(answers);
                    if (jsonEq(nextSteps, currentStoreSteps)) return;

                    pushToStore((prev) => {
                      const list = [...prev];
                      const d = list[index];
                      if (!d) return prev;
                      const updated: Department = {
                        ...d,
                        answers2: [{ chapterIndex: index, chapterTitle: d.name, steps: nextSteps }],
                      };
                      list[index] = updated;
                      return list;
                    });
                  }}
                  onDraftGenerated={({ mission, projects, okrs }) => {
                    if (isHydrating) return;

                    pushToStore((prev) => {
                      const list = [...prev];
                      const d = list[index];
                      if (!d) return prev;

                      const patch: Partial<Department> = {};
                      if (mission && !jsonEq(mission, d.mission)) {
                        patch.mission = mission;
                        patch.strategy = mission;
                        patch.missionDraft = mission;
                      }
                      if (projects?.length) {
                        const projList = projects.map((t) => ({ title: t, okrs: [] as StoreOKR[] }));
                        if (!jsonEq(projList, d.projects)) patch.projects = projList;
                      }
                      if (okrs?.length) {
                        const add = { title: '初期OKR', okrs: [toStoreOKR(okrs[0])] };
                        const merged = [...(patch.projects ?? d.projects ?? []), add];
                        if (!jsonEq(merged, d.projects)) patch.projects = merged as any;
                      }
                      const changed = Object.keys(patch).length > 0;
                      if (!changed) return prev;

                      const updated: Department = { ...d, ...patch };
                      list[index] = updated;
                      return list;
                    });

                    setNotice(`✅ ${dept.name} の案を反映しました`);
                  }}
                />

                {/* 3問回答完了 → AI一括アシスト */}
                {allAnswered && !isHydrating && (
                  <div className="mt-4 border rounded-2xl bg-blue-50 p-4 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
                    <div className="text-sm text-blue-900 flex flex-col gap-1">
                      <div className="flex items-center gap-2">
                        <Sparkles className="w-4 h-4" />
                        <span>
                          3つの質問への回答をもとに、
                          <b>部門戦略（ミッション・プロジェクト・目標）のたたき台</b> をAIが整理します。
                        </span>
                      </div>
                      <span className="text-[11px] text-blue-800">
                        ※ 部門の戦い方や実行アイデアを踏まえた OKR のたたき台も合わせて生成されます。生成後は自由に編集・削除できます。
                      </span>
                    </div>
                    <Button
                      onClick={() => handleFullAssist(index)}
                      disabled={!editableDept || !!loading[index]?.fullAssist}
                      className="rounded-full h-9 px-4"
                    >
                      <FileText className="w-4 h-4 mr-2" />
                      {loading[index]?.fullAssist ? '部門戦略案を生成中…' : 'AIで部門戦略案を生成'}
                    </Button>
                  </div>
                )}

                {/* プロジェクト一覧（追加・削除・タイトル編集・Objective編集） */}
                {dept.projects && dept.projects.length > 0 && (
                  <div className="mt-5 border-t pt-4">
                    {/* 部門ミッションの再掲示（プロジェクト一覧の上） */}
                    {deptMissionText && (
                      <div className="mb-3 rounded-2xl border bg-zinc-50 px-3 py-2">
                        <div className="text-[11px] text-zinc-500 mb-1">
                          この部門のミッション
                        </div>
                        <div className="text-sm text-zinc-800 whitespace-pre-wrap">
                          {deptMissionText}
                        </div>
                      </div>
                    )}

                    <div className="flex items-center justify-between mb-2 gap-2">
                      <h4 className="text-sm font-semibold text-zinc-800">プロジェクト一覧</h4>
                      <div className="flex items-center gap-2">
                        <span className="text-[11px] text-zinc-500 hidden sm:inline">
                          ※ 詳細な目標（KR）の編集は「OKR設定」画面で行えます。
                        </span>
                        {editableDept && (
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-7 px-3 rounded-full text-[11px]"
                            disabled={isHydrating}
                            onClick={() => handleAddProject(index)}
                          >
                            <PlusCircle className="w-3 h-3 mr-1" />
                            プロジェクト追加
                          </Button>
                        )}
                      </div>
                    </div>
                    <p className="sm:hidden text-[11px] text-zinc-500 mb-2">
                      ※ 詳細な目標（KR）の編集は「OKR設定」画面で行えます。
                    </p>
                    <ul className="space-y-2">
                      {dept.projects.map((p, pi) => {
                        const primaryObjective = p.okrs?.[0]?.objective ?? '';

                        return (
                          <li
                            key={`${dept.name}-proj-${pi}`}
                            className="flex flex-col gap-2 rounded-2xl border px-3 py-2 bg-white/70"
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div className="flex-1">
                                <div className="flex items-center gap-2">
                                  <span className="text-sm text-zinc-500">•</span>
                                  {/* プロジェクト名（編集可能） */}
                                  <input
                                    className="flex-1 text-sm font-medium text-zinc-900 bg-transparent border-b border-dashed border-zinc-300 focus:outline-none focus:border-zinc-500"
                                    value={p.title || ''}
                                    placeholder="プロジェクト名を入力"
                                    readOnly={!editableDept || isHydrating}
                                    onChange={(e) => {
                                      if (!editableDept || isHydrating) return;
                                      const val = e.target.value;
                                      pushToStore((prev) => {
                                        const list = [...prev];
                                        const d = list[index];
                                        if (!d) return prev;
                                        const projects = [...(d.projects ?? [])];
                                        const proj: Project = { ...(projects[pi] ?? { title: '' }) } as Project;
                                        proj.title = val;
                                        projects[pi] = proj;
                                        list[index] = { ...d, projects };
                                        return list;
                                      });
                                    }}
                                  />
                                </div>
                              </div>
                              <div className="flex flex-col items-end gap-1">
                                <Button
                                  variant="outline"
                                  size="sm"
                                  className="h-7 px-2 rounded-full border-red-500 text-red-600 hover:bg-red-50 text-[11px]"
                                  disabled={!editableDept || isHydrating}
                                  onClick={() => handleDeleteProject(index, pi)}
                                >
                                  <Trash2 className="w-3 h-3 mr-1" />
                                  削除
                                </Button>
                              </div>
                            </div>

                            {/* (O) 目標（Objective）の編集欄 */}
                            <div className="pl-5">
                              <div className="text-[11px] text-zinc-500 mb-1">このプロジェクトの目標（Objective）</div>
                              <input
                                className="w-full text-xs text-zinc-800 bg-white border border-zinc-200 rounded-lg px-2 py-1 focus:outline-none focus:ring-1 focus:ring-zinc-400"
                                value={primaryObjective}
                                placeholder="例）●●を通じて、売上〇〇％成長 / 離職率△△％改善 など"
                                readOnly={!editableDept || isHydrating}
                                onChange={(e) => {
                                  if (!editableDept || isHydrating) return;
                                  const val = e.target.value;
                                  pushToStore((prev) => {
                                    const list = [...prev];
                                    const d = list[index];
                                    if (!d) return prev;
                                    const projects = [...(d.projects ?? [])];
                                    const proj: Project = { ...(projects[pi] ?? { title: '' }) } as Project;

                                    const okrs: StoreOKR[] = [...(proj.okrs ?? [])];
                                    if (!okrs[0]) {
                                      okrs[0] = { objective: '', keyResults: [], owner: undefined };
                                    }
                                    okrs[0] = { ...okrs[0], objective: val };
                                    proj.okrs = okrs;

                                    projects[pi] = proj;
                                    list[index] = { ...d, projects };
                                    return list;
                                  });
                                }}
                              />
                            </div>

                            {/* KR のサマリ表示（編集はOKR画面で） */}
                            {p.okrs && p.okrs[0]?.keyResults && p.okrs[0].keyResults.length > 0 && (
                              <div className="pl-5 mt-1 text-[11px] text-zinc-600">
                                主要な成果（KR）：{p.okrs[0].keyResults.slice(0, 2).join(' ／ ')}
                                {p.okrs[0].keyResults.length > 2 && ' ほか'}
                              </div>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                )}

                {/* プロジェクトがまだない場合も追加ボタンだけ出す */}
                {(!dept.projects || dept.projects.length === 0) && editableDept && (
                  <div className="mt-4">
                    {deptMissionText && (
                      <div className="mb-3 rounded-2xl border bg-zinc-50 px-3 py-2">
                        <div className="text-[11px] text-zinc-500 mb-1">
                          この部門のミッション
                        </div>
                        <div className="text-sm text-zinc-800 whitespace-pre-wrap">
                          {deptMissionText}
                        </div>
                      </div>
                    )}
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 px-3 rounded-full text-[12px]"
                      disabled={isHydrating}
                      onClick={() => handleAddProject(index)}
                    >
                      <PlusCircle className="w-3 h-3 mr-1" />
                      プロジェクトを追加
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
