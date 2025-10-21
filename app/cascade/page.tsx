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
  Save,
  Sparkles,
  Building2,
  FileText,
} from 'lucide-react';

// 依存
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

import { mapTopToExecIds, EXEC_TITLES } from '@/lib/strategyPatterns.map';
import type { TopPatternId } from '@/lib/strategyPatterns.top';

/* =========================================================
   ローカル型（store拡張対応）
========================================================= */
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
const jsonEq = (a: any, b: any) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

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
   簡易スナップショット（Dirty判定用・Store側と同等キーのみ）
========================================================= */
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
  let h = 5381; for (let i = 0; i < s.length; i++) h = (h * 33) ^ s.charCodeAt(i);
  return (h >>> 0).toString(16);
}

/* =========================================================
   シグナル抽出（簡易）
========================================================= */
function extractSignals(params: {
  industry?: string;
  mission?: string;
  answers?: DeptAnswerStep[];
}) {
  const { industry, mission = '', answers = [] } = params;

  const text = [mission, ...answers.map((a) => a.answer || '')]
    .join('\n')
    .toLowerCase();

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

/* =========================================================
   OKR 日本語表示ヘルパ
========================================================= */
function renderOKRJa(okr?: { objective?: string; keyResults?: string[]; owner?: string }) {
  if (!okr) return null;
  const objective = (okr.objective ?? '').trim();
  const krs = (okr.keyResults ?? []).filter(Boolean);
  if (!objective && krs.length === 0) return null;

  return (
    <div className="mt-2">
      {objective && <div className="text-sm font-medium">達成目標：{objective}</div>}
      {krs.length > 0 && (
        <ul className="list-disc pl-5 text-sm mt-1 space-y-1">
          {krs.map((kr, i) => <li key={i}>主要な成果：{kr}</li>)}
        </ul>
      )}
    </div>
  );
}

/* =========================================================
   メインページ
========================================================= */
export default function CascadePage() {
  const s = useStrategyStore() as any;

  // 会社スコープ＆hydration
  const {
    companyId: scopeCompanyId,
    hydrated,
    setCompanyScope,
    refetchFromServer, // store の再取得API
    setHydrated,       // 明示的にhydratedを立てる（互換）
    boot,              // { isHydrating, isHydrated } 想定
    saveStrategyData: saveNow,
    lastServerSnapshot,
  } = useStrategyStore();

  // 権限API
  const access = useAccess();
  const canEditCompany = access.canEditCompany();
  const canEditDept = access.canEditDepartment; // () => boolean を想定

  // companyId 取得（access優先）。安定化のため useMemo。
  const accessCompanyId: string | undefined = useMemo(
    () => ((access as any)?.companyId ?? (s?.companyId as string | undefined)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [(access as any)?.companyId, s?.companyId]
  );

  // 業種
  const industry: string =
    (s?.industry as string) ||
    (s?.company?.industry as string) ||
    '';

  /* ---------------- デバッグログ ---------------- */
  useEffect(() => {
    console.log('[cascade] mount', { hydrated, scopeCompanyId, accessCompanyId });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    console.log('[cascade] 🚧 hydrating...', { hydrated, scopeCompanyId, accessCompanyId, boot });
  }, [hydrated, scopeCompanyId, accessCompanyId, boot]);

  /* =========================================================
     会社スコープ確立（StrictMode対策）
     - 切替時は reset → scope 再適用
     - 同一IDへの再適用は no-op
     - 無限ループ防止：useRef で一度だけ適用
  ========================================================= */
  const lastAppliedCompanyRef = useRef<string | null>(null);
  useEffect(() => {
    if (!accessCompanyId) return;

    if (lastAppliedCompanyRef.current === accessCompanyId) {
      return;
    }

    console.log('[cascade] effect → setCompanyScope', { scopeCompanyId, accessCompanyId });

    if (scopeCompanyId && scopeCompanyId !== accessCompanyId) {
      // 会社切替：必ず hydrated を落としてから、reset → scope 再適用
      setHydrated?.(false);
      hardResetForCompanySwitch(accessCompanyId);
      setCompanyScope(accessCompanyId);
      // ロードガードをリセットして再ロード許可
      loadGuardRef.current = null;
    } else {
      // 初回など：スコープだけ確立
      setCompanyScope(accessCompanyId);
    }

    lastAppliedCompanyRef.current = accessCompanyId;
  }, [accessCompanyId, scopeCompanyId, setCompanyScope, setHydrated]);

  /* =========================================================
     初期ロード（loadAndHydrate + refetch）
     - 同一companyIdに対する多重起動ガード
     - Dirty時はサーバ取得をスキップ（ローカル優先）
     - 7秒フェイルセーフで hydrated を立てる
     - スコープ未セットなら念のため再適用
  ========================================================= */
  const loadGuardRef = useRef<string | null>(null);
  useEffect(() => {
    if (!accessCompanyId) return;

    // 念のため：スコープ未設定なら適用
    if (!scopeCompanyId) {
      setCompanyScope(accessCompanyId);
    }

    // 同一IDかつ既に完了なら再入防止
    if (loadGuardRef.current === accessCompanyId && hydrated && scopeCompanyId === accessCompanyId) {
      return;
    }

    let cancelled = false;

    const run = async () => {
      if (hydrated && scopeCompanyId === accessCompanyId) {
        loadGuardRef.current = accessCompanyId;
        return;
      }

      console.log('[cascade] 🌀 load start', { hydrated, scopeCompanyId });

      // Dirty判定：サーバスナップショットと現在の差分があればローカル優先
      const currentSnap = makeSaveSnapshot(useStrategyStore.getState());
      const currentHash = hashSnapshot(currentSnap);
      const isDirty = !!(lastServerSnapshot && lastServerSnapshot !== currentHash);

      const doLoad = async () => {
        if (!isDirty) {
          // きれいな状態のみサーバから hydrate（= 上書きの危険がない）
          await loadAndHydrate(accessCompanyId);
          try {
            await refetchFromServer?.(); // 差分同期（クリーンな時のみ）
          } catch (e) {
            console.warn('[cascade] refetchFromServer failed (ignored)', e);
          }
          setHydrated?.(true);
        } else {
          // 編集中（Dirty）ならサーバ取得はスキップし、そのままhydratedへ
          console.log('[cascade] ✋ skip server fetch (dirty local)');
          setHydrated?.(true);
        }
      };

      const timer = setTimeout(() => {
        if (!cancelled) {
          console.warn('[cascade] ⚠️ Timeout reached, forcing hydration');
          setHydrated?.(true);
        }
      }, 7000);

      try {
        await doLoad();
        console.log('[cascade] ✅ load done (dirty=%s)', String(isDirty));
        loadGuardRef.current = accessCompanyId;
      } finally {
        clearTimeout(timer);
      }
      if (cancelled) return;
    };

    run();
    return () => { cancelled = true; };
  }, [accessCompanyId, hydrated, scopeCompanyId, refetchFromServer, setHydrated, lastServerSnapshot, setCompanyScope]);

  // useAutoSave は deps 必須（companyIdと部門）
  const [departments, setDepartments] = useState<Department[]>(Array.isArray(s?.departments) ? (s.departments as Department[]) : []);
  const depsRef = useRef(departments);
  useEffect(() => { depsRef.current = departments; }, [departments]);
  useAutoSave([accessCompanyId, departments]); // ← companyIdスコープに紐付け

  // Storeのdepartments変更を画面に同期（外部更新時に追従）→ 差分がある時だけ
  const storeDepartments = useStrategyStore((st) => st.departments) as Department[] | undefined;
  useEffect(() => {
    if (!Array.isArray(storeDepartments)) return;
    setDepartments((prev) => (jsonEq(prev, storeDepartments) ? prev : (storeDepartments as Department[])));
  }, [storeDepartments]);

  // 読み込み状態（boot の状態も見る）
  const isHydrating =
    Boolean(boot?.isHydrating) ||
    !hydrated ||
    (!!accessCompanyId && !!scopeCompanyId && scopeCompanyId !== accessCompanyId);

  const rawStory = useMemo(() => {
    if (isNonEmptyStoryPayload(s?.finalStory)) return s.finalStory;
    if (isNonEmptyStoryPayload(s?.story)) return s.story;
    if (isNonEmptyStoryPayload(s?.strategyStory)) return s.strategyStory;
    return '';
  }, [s?.finalStory, s?.story, s?.strategyStory]);
  const { text: storyText, chapters: storyChapters } = useMemo(
    () => getStory(rawStory),
    [rawStory],
  );

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
    const draft = (inlineEdit[index] ?? d.strategy ?? d.mission ?? '').toString();
    if ((d.mission ?? '') === draft && (d.strategy ?? '') === draft && (d.missionDraft ?? '') === draft) {
      setNotice('（変更なし）');
      return;
    }
    d.mission = draft;
    d.strategy = draft;
    d.missionDraft = draft;
    next[index] = d;
    if (!jsonEq(next, depsRef.current)) {
      pushToStore(next);
      setNotice('✅ 保存しました');
    } else {
      setNotice('（変更なし）');
    }
  };

  const requireStoryOrWarn = (): string | null => {
    if (!storyText.trim()) {
      setNotice('⚠️ 経営ストーリーを作成してください');
      return null;
    }
    return storyText;
  };

  /* ================== 離脱/非表示時に即時保存 ================== */
  useEffect(() => {
    const flush = async () => {
      const st = useStrategyStore.getState();
      if (st.boot?.isHydrating) return;
      const snap = makeSaveSnapshot(st);
      const hash = hashSnapshot(snap);
      if (st.lastServerSnapshot && st.lastServerSnapshot === hash) return; // 変更なし
      try { await saveNow(); } catch (e) { console.warn('[cascade] flush save failed', e); }
    };
    const onBeforeUnload = () => { void flush(); };
    const onPageHide = () => { void flush(); };
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

  /* ================= 推薦API：経営レベル（t系） ================= */
  const handleRecommendPatterns = async (index: number) => {
    const dept = depsRef.current[index];
    if (!dept) return;
    if (!canEditDept()) {
      setNotice('⚠️ 編集権限がありません');
      return;
    }
    const answers: DeptAnswerStep[] = toDeptAnswers(dept.answers2?.[0]?.steps);
    const signals = extractSignals({
      industry,
      mission: dept.strategy ?? dept.mission ?? '',
      answers,
    });

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
      const next = [...depsRef.current];
      const d = { ...next[index] };
      if (!jsonEq(d.recommendedPatterns, data.detail ?? [])) {
        d.recommendedPatterns = data.detail ?? [];
        next[index] = d;
        pushToStore(next);
      }
      setNotice(`✅ ${dept.name} に推奨パターン（t系）を反映しました`);
    } catch (err: any) {
      setNotice(`❌ 推薦に失敗：${err.message}`);
    } finally {
      setLoading((p) => ({ ...p, [index]: { ...(p[index] || {}), recommend: false } }));
    }
  };

  /* ================= 推薦API：実装レベル（e系） ================= */
  const handleRecommendExecPatterns = async (index: number) => {
    const dept = depsRef.current[index];
    if (!dept) return;
    if (!canEditDept()) {
      setNotice('⚠️ 編集権限がありません');
      return;
    }
    const answers: DeptAnswerStep[] = toDeptAnswers(dept.answers2?.[0]?.steps);
    const signals = extractSignals({
      industry,
      mission: dept.strategy ?? dept.mission ?? '',
      answers,
    });

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
      const next = [...depsRef.current];
      const d = { ...next[index] };
      if (!jsonEq(d.recommendedExecPatterns, data.detail ?? [])) {
        d.recommendedExecPatterns = data.detail ?? [];
        next[index] = d;
        pushToStore(next);
      }
      setNotice(`✅ ${dept.name} に実装パターン（e系）を反映しました`);
    } catch (err: any) {
      setNotice(`❌ 実装パターン推薦に失敗：${err.message}`);
    } finally {
      setLoading((p) => ({ ...p, [index]: { ...(p[index] || {}), recommendExec: false } }));
    }
  };

  /* ================= OKR雛形：e系→OKR 自動展開 ================= */
  const handleOKRFromExec = async (index: number) => {
    const dept = depsRef.current[index];
    if (!dept) return;
    if (!canEditDept()) {
      setNotice('⚠️ 編集権限がありません');
      return;
    }

    const execIds: string[] =
      (dept.recommendedExecPatterns?.map((p) => p.id) ?? []).length
        ? dept.recommendedExecPatterns!.map((p) => p.id)
        : mapTopToExecIds(
            (dept.recommendedPatterns ?? [])
              .map((p) => p.id as TopPatternId)
              .filter(Boolean) as TopPatternId[],
          );

    if (!execIds.length) {
      setNotice('⚠️ 実装パターンがありません（先に推薦を実行してください）');
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
          context: {
            departmentName: dept.name,
            industry,
            mission: dept.strategy ?? dept.mission ?? '',
          },
        }),
      });
      const text = await res.text();
      const data = safeJsonFromText<{
        items: { id: string; title: string; okr: { objective: string; keyResults: string[]; owner?: string } }[];
      }>(text) ?? { items: [] };

      if (!data.items?.length) {
        setNotice('⚠️ OKR雛形が生成されませんでした');
        return;
      }

      const next = [...depsRef.current];
      const d = { ...next[index] };
      const projects: Project[] = [...(d.projects ?? [])];

      for (const it of data.items) {
        const title = it.title || 'OKR';
        const okr = it.okr;
        const existIdx = projects.findIndex((p) => (p?.title ?? '') === title);
        if (existIdx >= 0) {
          const exist = { ...projects[existIdx] };
          const existOkrs = [...(exist.okrs ?? [])];
          const candidate = { objective: okr.objective, keyResults: okr.keyResults ?? [], owner: okr.owner };
          // 同一OKRの重複追加を防止
          if (!existOkrs.some((o) => jsonEq(o, candidate))) {
            existOkrs.push(candidate);
            exist.okrs = existOkrs;
            projects[existIdx] = exist;
          }
        } else {
          projects.push({
            title,
            okrs: [
              {
                objective: okr.objective,
                keyResults: okr.keyResults ?? [],
                owner: okr.owner,
              },
            ],
          } as Project);
        }
      }

      if (!jsonEq(projects, d.projects)) {
        d.projects = projects;
        next[index] = d;
        pushToStore(next);
      }
      setNotice(`✅ ${dept.name} に OKR雛形を展開しました（${data.items.length}件）`);
    } catch (e: any) {
      setNotice(`❌ OKR雛形の展開に失敗：${e.message}`);
    } finally {
      setLoading((p) => ({ ...p, [index]: { ...(p[index] || {}), okrGen: false } }));
    }
  };

  /* ================= 要約生成（→自動 t系推薦） ================= */
  const handleGenerateSummary = async (index: number) => {
    const dept = depsRef.current[index];
    if (!dept) return;
    if (!canEditDept()) {
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

    setLoading((p) => ({ ...p, [index]: { ...(p[index] || {}), summary: true } }));
    try {
      const res = await fetch('/api/generate-department-summary', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          departmentName: dept.name,
          story,
          answers: steps,
          industry,
        }),
      });
      const text = await res.text();
      const data = safeJsonFromText<any>(text) ?? {};
      const next = [...depsRef.current];
      const d = { ...next[index] };

      const nextMission = data.mission ?? d.mission ?? '';
      const nextProjects: Project[] = (data.projects ?? []).map((t: string) => ({
        title: t,
        okrs:
          data.okrs && data.okrs[0]
            ? [toStoreOKR(data.okrs[0] as DeptOKR)]
            : [],
      }));

      let changed = false;
      if (!jsonEq(nextMission, d.mission) || !jsonEq(nextMission, d.strategy) || !jsonEq(nextMission, d.missionDraft)) {
        d.mission = nextMission;
        d.strategy = nextMission;
        d.missionDraft = nextMission;
        changed = true;
      }
      if (!jsonEq(nextProjects, d.projects)) {
        d.projects = nextProjects;
        changed = true;
      }

      if (changed) {
        next[index] = d;
        pushToStore(next);
      }
      setNotice(`✅ ${dept.name} の要約を反映しました`);
    } catch (err: any) {
      setNotice(`❌ 要約生成に失敗：${err.message}`);
    } finally {
      setLoading((p) => ({ ...p, [index]: { ...(p[index] || {}), summary: false } }));
    }

    await handleRecommendPatterns(index);
  };

  /* ================= ビジュアルビュー ================= */
  const VisualView = useMemo(() => {
    if (!departments.length)
      return <div className="text-zinc-600">部門がまだ登録されていません。</div>;
    return (
      <div className="grid md:grid-cols-2 gap-6">
        {departments.map((d, i) => (
          <div key={`v-${d.name}-${i}`} className="p-6 rounded-3xl border bg-white/70 backdrop-blur-sm shadow-sm">
            <div className="flex justify-between items-center mb-2">
              <h3 className="font-semibold flex items-center gap-2">
                <Building2 className="w-4 h-4" /> {d.name}
              </h3>
              {d.finalized && (
                <span className="text-xs bg-zinc-900 text-white rounded-full px-2 py-1">確定済み</span>
              )}
            </div>
            <p className="text-sm text-zinc-700 mb-2">{d.strategy ?? d.mission}</p>

            {!!(d.recommendedPatterns?.length) && (
              <div className="mb-2">
                <div className="text-xs text-zinc-500 mb-1">推奨パターン（t系）</div>
                <div className="flex flex-wrap gap-2">
                  {d.recommendedPatterns!.map((p, idx) => (
                    <span
                      key={p.id + idx}
                      className="text-xs px-2 py-1 rounded-full border bg-indigo-50 text-indigo-800"
                      title={(p.why || []).join(' / ')}
                    >
                      {p.title ?? p.id}{p.score != null ? `（${p.score}）` : ''}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {Array.isArray(d.recommendedPatterns) && d.recommendedPatterns.length > 0 && (
              <div className="mb-2">
                <div className="text-xs text-zinc-500 mb-1">関連する実装候補（ブリッジ）</div>
                <div className="flex flex-wrap gap-2">
                  {mapTopToExecIds(
                    d.recommendedPatterns
                      .map((p) => p.id as TopPatternId)
                      .filter(Boolean) as TopPatternId[],
                  ).map((eid, idx) => (
                    <span key={eid + idx} className="text-xs px-2 py-1 rounded-full border bg-sky-50 text-sky-800">
                      {EXEC_TITLES[eid] ?? eid}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {!!(d.recommendedExecPatterns?.length) && (
              <div className="mb-2">
                <div className="text-xs text-zinc-500 mb-1">実装パターン（e系）</div>
                <div className="flex flex-wrap gap-2">
                  {d.recommendedExecPatterns!.map((p, idx) => (
                    <span
                      key={p.id + idx}
                      className="text-xs px-2 py-1 rounded-full border bg-emerald-50 text-emerald-800"
                      title={(p.why || []).join(' / ')}
                    >
                      {p.title ?? p.id}{p.score != null ? `（${p.score}）` : ''}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {d.projects?.length ? (
              <ul className="text-sm text-zinc-800 space-y-3">
                {d.projects.map((p, j) => (
                  <li key={j}>
                    • {p.title}
                    {renderOKRJa(p.okrs?.[0])}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ))}
      </div>
    );
  }, [departments]);

  /* =========================================================
     map 内で Hooks を使わないための一括メモ化（安定参照）
     - Stepper の initialAnswers / projects を安定化
  ========================================================= */
  const answersMemo: DeptAnswerStep[][] = useMemo(
    () => departments.map((d) => toDeptAnswers(d.answers2?.[0]?.steps)),
    [departments]
  );
  const projectsMemo: string[][] = useMemo(
    () => departments.map((d) => (d.projects?.map((p) => p.title) ?? [])),
    [departments]
  );

  /* ================= JSX ================= */
  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      <header className="mb-8">
        <h1 className="text-[28px] font-semibold mb-2">STAGE 3：部門戦略策定</h1>
        <p className="text-zinc-600 text-sm">
          経営ストーリーを基に、質問に答えながら各部門の
          <b>ミッション・プロジェクト・OKR（達成目標/主要な成果）</b>を明確化します。
        </p>
      </header>

      {/* 読み込みインジケータ */}
      {isHydrating && (
        <div className="mb-8 rounded-xl border p-4 text-sm text-muted-foreground">
          サーバーのデータを読み込み中です…
        </div>
      )}

      {/* ストーリー */}
      {!isHydrating && (
        <section className="mb-8">
          {storyChapters.length ? (
            <div className="grid md:grid-cols-2 gap-4">
              {storyChapters.map((ch, i) => (
                <div key={i} className="p-4 border rounded-2xl bg-white/60 backdrop-blur-sm">
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
      )}

      {/* タブ */}
      <div className="flex justify-between items-center mb-6">
        <div className="inline-flex border rounded-full overflow-hidden">
          {['edit', 'visual'].map((t) => (
            <button
              key={t}
              onClick={() => setActiveTab(t as any)}
              className={`px-4 py-2 text-sm ${activeTab === t ? 'bg-zinc-900 text-white' : 'bg-white text-zinc-800'}`}
              disabled={isHydrating}
            >
              {t === 'edit' ? '編集' : 'ビジュアル'}
            </button>
          ))}
        </div>
        {canEditCompany && (
          <Button onClick={() => setShowForm((v) => !v)} className="rounded-full h-9 px-4" disabled={isHydrating}>
            <PlusCircle className="w-4 h-4 mr-1" />
            {showForm ? '閉じる' : '部門追加'}
          </Button>
        )}
      </div>

      {/* 部門追加フォーム */}
      {showForm && canEditCompany && !isHydrating && (
        <div className="p-6 border rounded-3xl bg-white/70 mb-8">
          <div className="grid md:grid-cols-2 gap-4">
            <input value={deptName} onChange={(e) => setDeptName(e.target.value)} placeholder="部門名" className="border rounded-xl px-3 py-2" />
            <input value={deptMission} onChange={(e) => setDeptMission(e.target.value)} placeholder="ミッション" className="border rounded-xl px-3 py-2" />
          </div>
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setShowForm(false)} className="rounded-full h-9 px-4">キャンセル</Button>
            <Button
              onClick={() => {
                if (!deptName.trim()) return setNotice('⚠️ 部門名を入力してください');
                const newDept: Department = {
                  name: deptName.trim(),
                  mission: deptMission.trim(),
                  strategy: deptMission.trim(),
                  missionDraft: deptMission.trim(),
                  discussionNotes: '',
                  projects: [],
                  answers2: [{ chapterIndex: departments.length, chapterTitle: deptName.trim(), steps: [] }],
                  finalized: false,
                  recommendedPatterns: [],
                  recommendedExecPatterns: [],
                };
                const next = [...depsRef.current, newDept];
                pushToStore(next);
                setDeptName(''); setDeptMission(''); setShowForm(false);
              }}
              className="rounded-full h-9 px-4"
            >
              追加
            </Button>
          </div>
        </div>
      )}

      {/* 通知 */}
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

            const answers = answersMemo[index];        // ← 安定化済み
            const projTitles = projectsMemo[index];    // ← 安定化済み
            const allAnswered = answers.length >= 3 && answers.every((a) => (a.answer ?? '').trim().length > 0);

            // 既存 answers2 と今回 onChange 反映の等価判定で無限ループ抑止
            const currentStoreSteps = dept.answers2?.[0]?.steps ?? [];

            return (
              <div key={`e-${dept.name}-${index}`} className="p-6 border rounded-3xl bg-white/70 backdrop-blur-sm shadow-sm">
                <div className="flex justify-between items-center mb-3">
                  <h3 className="font-semibold text-zinc-900 flex items-center gap-2">
                    <Building2 className="w-4 h-4" /> {dept.name}
                  </h3>
                  {dept.finalized && <span className="text-xs bg-zinc-900 text-white rounded-full px-2 py-1">確定済み</span>}
                </div>

                <textarea
                  value={inlineDraft}
                  onChange={(e) => setInlineEdit((p) => ({ ...p, [index]: e.target.value }))}
                  className="w-full border rounded-xl p-2 mb-2 text-sm"
                  readOnly={!editableDept || isHydrating}
                />
                <div className="flex flex-wrap gap-2 mb-3">
                  <Button onClick={() => saveInlineMission(index)} disabled={!editableDept || isHydrating} className="rounded-full h-9 px-4">
                    <Save className="w-4 h-4 mr-1" /> 保存
                  </Button>

                  <Button
                    variant="secondary"
                    onClick={() => handleRecommendPatterns(index)}
                    disabled={!editableDept || !!(L.recommend) || isHydrating}
                    className="rounded-full h-9 px-4"
                    title="回答・ミッションから勝ちパターン（t系）を推薦"
                  >
                    <Sparkles className="w-4 h-4 mr-1" />
                    {L.recommend ? '推薦中…' : '勝ちパターンを推薦'}
                  </Button>

                  <Button
                    variant="secondary"
                    onClick={() => handleRecommendExecPatterns(index)}
                    disabled={!editableDept || !!(L.recommendExec) || isHydrating}
                    className="rounded-full h-9 px-4"
                    title="現場実装パターン（e系）を直接推薦"
                  >
                    <Sparkles className="w-4 h-4 mr-1" />
                    {L.recommendExec ? '実装推薦中…' : '実装パターンを推薦'}
                  </Button>

                  <Button
                    variant="secondary"
                    onClick={() => handleOKRFromExec(index)}
                    disabled={!editableDept || !!(L.okrGen) || isHydrating}
                    className="rounded-full h-9 px-4"
                    title="実装パターンから OKR（達成目標/主要な成果）の雛形を自動生成"
                  >
                    <Sparkles className="w-4 h-4" />
                    <span className="ml-1">{L.okrGen ? 'OKR生成中…' : '実装→OKR雛形（達成目標/主要な成果）'}</span>
                  </Button>
                </div>

                {/* 推奨パターン（t系） */}
                {!!(dept.recommendedPatterns?.length) && (
                  <div className="mb-3">
                    <div className="text-xs text-zinc-500 mb-1">推奨パターン（t系）</div>
                    <div className="flex flex-wrap gap-2">
                      {dept.recommendedPatterns!.map((p, idx) => (
                        <span key={p.id + idx} className="text-xs px-2 py-1 rounded-full border bg-indigo-50 text-indigo-800" title={(p.why || []).join(' / ')}>
                          {p.title ?? p.id}{p.score != null ? `（${p.score}）` : ''}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {/* 関連する実装候補（t→eブリッジ） */}
                {Array.isArray(dept.recommendedPatterns) && dept.recommendedPatterns.length > 0 && (
                  <div className="mb-3">
                    <div className="text-xs text-zinc-500 mb-1">関連する実装候補（ブリッジ）</div>
                    <div className="flex flex-wrap gap-2">
                      {mapTopToExecIds(
                        dept.recommendedPatterns.map((p) => p.id as TopPatternId).filter(Boolean) as TopPatternId[],
                      ).map((eid, idx) => (
                        <span key={eid + idx} className="text-xs px-2 py-1 rounded-full border bg-sky-50 text-sky-800">
                          {EXEC_TITLES[eid] ?? eid}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {/* 実装パターン（e系） */}
                {!!(dept.recommendedExecPatterns?.length) && (
                  <div className="mb-3">
                    <div className="text-xs text-zinc-500 mb-1">実装パターン（e系）</div>
                    <div className="flex flex-wrap gap-2">
                      {dept.recommendedExecPatterns!.map((p, idx) => (
                        <span key={p.id + idx} className="text-xs px-2 py-1 rounded-full border bg-emerald-50 text-emerald-800" title={(p.why || []).join(' / ')}>
                          {p.title ?? p.id}{p.score != null ? `（${p.score}）` : ''}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

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
                    if (jsonEq(nextSteps, currentStoreSteps)) {
                      // 同一内容なら何もしない（無限ループ/再描画抑止）
                      return;
                    }
                    const next = [...depsRef.current];
                    const d = { ...next[index] };
                    d.answers2 = [{ chapterIndex: index, chapterTitle: d.name, steps: nextSteps }];
                    next[index] = d;
                    pushToStore(next);
                  }}
                  onDraftGenerated={({ mission, projects, okrs }) => {
                    if (isHydrating) return;
                    const next = [...depsRef.current];
                    const d = { ...next[index] };
                    const patch: Partial<Department> = {};
                    if (mission && !jsonEq(mission, d.mission) ) {
                      patch.mission = mission; patch.strategy = mission; patch.missionDraft = mission;
                    }
                    if (projects?.length) {
                      const projList = projects.map((t) => ({ title: t, okrs: [] as StoreOKR[] }));
                      if (!jsonEq(projList, d.projects)) patch.projects = projList;
                    }
                    if (okrs?.length) {
                      const add = { title: '初期OKR', okrs: [toStoreOKR(okrs[0])] };
                      const merged = [ ...(patch.projects ?? d.projects ?? []), add ];
                      if (!jsonEq(merged, d.projects)) patch.projects = merged as any;
                    }
                    const changed = Object.keys(patch).length > 0;
                    if (changed) {
                      next[index] = { ...d, ...patch } as Department;
                      pushToStore(next);
                      setNotice(`✅ ${d.name} の案を反映しました`);
                    }
                  }}
                />

                {/* 3問回答完了 → AI要約（→自動t系推薦） */}
                {allAnswered && !isHydrating && (
                  <div className="mt-4 border rounded-2xl bg-blue-50 p-4 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
                    <div className="text-sm text-blue-900 flex items-center gap-2">
                      <Sparkles className="w-4 h-4" />
                      回答から <b>Mission / Projects / OKR（達成目標/主要な成果）</b> を生成できます（生成後に勝ちパターンも推薦）。
                    </div>
                    <Button onClick={() => handleGenerateSummary(index)} disabled={!editableDept || !!(loading[index]?.summary)} className="rounded-full h-9 px-4">
                      <FileText className="w-4 h-4 mr-2" />
                      {loading[index]?.summary ? '生成中…' : 'AI要約を生成'}
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
