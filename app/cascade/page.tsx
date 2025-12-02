// /app/cascade/page.tsx（STEP0たたき台＋シンプル版・OKR案編集対応・ボタン整理版）
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
import { PlusCircle, Save, Sparkles, Building2, Trash2 } from 'lucide-react';

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

// ★ 勝ち筋カタログ＆生成エンジン
import {
  generateProjectsForDepartment,
  type IndustryCode,
  type DepartmentKind as PatternDepartmentKind,
  type GrowthLever,
} from '@/lib/strategyPatterns.catalog';

/* =========================
   型（store拡張互換）
========================= */
// プロジェクトの「仮説メタデータ」
type Lever =
  | 'ACQ'
  | 'ARPU'
  | 'CHURN'
  | 'COST'
  | 'EFFICIENCY'
  | 'FUTURE';

type Horizon = 'short' | 'mid' | 'long';

type Kind = 'growth' | 'cost' | 'efficiency' | 'future';

type Project = BaseProject & {
  hypothesis?: string;
  mainLever?: Lever;
  horizon?: Horizon;
  kind?: Kind;
};

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

/* =========================
   レバー/時間軸ラベル
========================= */
const LEVER_LABEL: Record<Lever, string> = {
  ACQ: 'ACQ（顧客数）',
  ARPU: 'ARPU（単価）',
  CHURN: 'CHURN（解約/離脱）',
  COST: 'COST（コスト）',
  EFFICIENCY: 'EFFICIENCY（生産性）',
  FUTURE: 'FUTURE（将来の種）',
};

const HORIZON_LABEL: Record<Horizon, string> = {
  short: '短期（〜1年）',
  mid: '中期（1〜3年）',
  long: '長期（3年以上）',
};

const KIND_LABEL: Record<Kind, string> = {
  growth: '成長（売上/LTV）',
  cost: 'コスト削減',
  efficiency: '業務効率',
  future: '将来への投資',
};

const LEVER_VALUES: Lever[] = ['ACQ', 'ARPU', 'CHURN', 'COST', 'EFFICIENCY', 'FUTURE'];
const HORIZON_VALUES: Horizon[] = ['short', 'mid', 'long'];
const KIND_VALUES: Kind[] = ['growth', 'cost', 'efficiency', 'future'];

const normalizeLever = (v: any): Lever | undefined =>
  LEVER_VALUES.includes(v as Lever) ? (v as Lever) : undefined;

const normalizeHorizon = (v: any): Horizon | undefined =>
  HORIZON_VALUES.includes(v as Horizon) ? (v as Horizon) : undefined;

const normalizeKind = (v: any): Kind | undefined =>
  KIND_VALUES.includes(v as Kind) ? (v as Kind) : undefined;

/* =========================
   ユーティリティ
========================= */
const escapeHtml = (s: string) =>
  String(s ?? '').replace(
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
      .map((c: any, i: number) => ({
        title: c?.title?.trim() || `Chapter ${i + 1}`,
        body: c?.body ?? '',
      }))
      .filter((c) => c.title.trim() || c.body.trim());
    const text = chapters.map((c, i) => `【第${i + 1}章】${c.title}\n${c.body}`).join('\n\n');
    return { text, chapters };
  }
  if (typeof raw === 'string' && raw.trim()) {
    const text = raw.trim();
    const lines = text.split(/\r?\n/);
    const chunkSize = Math.ceil(lines.length / 4);
    const chunks: string[] = [];
    for (let i = 0; i < lines.length; i += chunkSize)
      chunks.push(lines.slice(i, i + chunkSize).join('\n'));
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
  answers.map((a) => ({
    stepNumber: a.stepNumber,
    question: a.question,
    reason: a.reason,
    answer: a.answer,
  }));

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

/* =========================
   勝ち筋系ヘルパー
========================= */

// 業種文字列 → IndustryCode
const detectIndustryCode = (raw: string | undefined): IndustryCode => {
  const t = (raw ?? '').toLowerCase();
  if (t.includes('saas') || t.includes('software') || t.includes('it')) return 'SAAS';
  if (t.includes('製造') || t.includes('メーカー')) return 'MANUFACTURING';
  if (t.includes('小売') || t.includes('retail')) return 'RETAIL';
  if (t.includes('金融') || t.includes('bank') || t.includes('証券')) return 'FINANCE';
  if (t.includes('サービス')) return 'SERVICE';
  return 'OTHER';
};

// 部門名 → DepartmentKind
const detectDepartmentKind = (name: string): PatternDepartmentKind => {
  const n = name.toLowerCase();
  if (/営業|sales/.test(name)) return 'SALES';
  if (/マーケ|市場|marketing|宣伝|広報/.test(name)) return 'MARKETING';
  if (/カスタマー|cs|サクセス|サポート/.test(name)) return 'CUSTOMER_SUCCESS';
  if (/人事|hr/.test(name)) return 'HR';
  if (/総務|コーポ|管理本部|管理部/.test(name)) return 'GENERAL_AFFAIRS';
  if (/生産|製造|工場/.test(name)) return 'PRODUCTION';
  if (/経理|財務|アカウンティング/.test(name)) return 'FINANCE_DEPT';
  if (/情報システム|情シス|it|システム/.test(name)) return 'IT';
  if (/経営企画|企画|戦略|社長室/.test(name)) return 'CORPORATE';
  // 最後に英語も軽く見る
  if (n.includes('sales')) return 'SALES';
  if (n.includes('marketing')) return 'MARKETING';
  if (n.includes('customer success')) return 'CUSTOMER_SUCCESS';
  if (n.includes('hr') || n.includes('human resource')) return 'HR';
  if (n.includes('corporate') || n.includes('strategy')) return 'CORPORATE';
  return 'OTHER';
};

// ストーリー＆ミッション → GrowthLever優先度（最大2つ）
const detectLeverPriority = (mission: string, story: string, dept: string): GrowthLever[] => {
  const text = `${mission}\n${story}\n${dept}`.toLowerCase();
  const result: GrowthLever[] = [];
  const add = (l: GrowthLever) => {
    if (!result.includes(l)) result.push(l);
  };

  if (/(新規|開拓|リード|商談|見込み|獲得|アポイント)/.test(text)) add('ACQ');
  if (/(単価|アップセル|クロスセル|客単価|l tv|ltv|高付加価値)/i.test(text)) add('ARPU');
  if (/(解約|離脱|継続|維持|チャーン|churn|ロイヤルティ|ロイヤリティ)/i.test(text)) add('CHURN');
  if (/(コスト|費用|原価|削減|効率|生産性|固定費|変動費)/.test(text)) add('COST');
  if (/(投資|新規事業|研究開発|r&d|イノベーション|将来|未来|種まき)/i.test(text))
    add('INVEST');
  if (/(連携|横串|シナジー|コラボ|横断)/.test(text)) add('SYNERGY');

  // 何も引っかからない場合は、部門名ベースでざっくり決める
  if (result.length === 0) {
    if (/(営業|sales)/.test(dept.toLowerCase())) {
      add('ACQ');
      add('ARPU');
    } else if (/(人事|hr)/.test(dept.toLowerCase())) {
      add('ACQ'); // 採用支援としてACQ寄り
      add('SYNERGY');
    } else if (/(総務|コーポ|管理|finance|経理|財務)/i.test(dept)) {
      add('COST');
      add('SYNERGY');
    } else if (/(生産|製造|工場)/.test(dept)) {
      add('COST');
      add('SYNERGY');
    } else {
      add('ACQ');
      add('COST');
    }
  }

  return result.slice(0, 2);
};

// GrowthLever → 画面側Leverへのマッピング
const mapGrowthLeverToLever = (lever: GrowthLever): Lever | undefined => {
  switch (lever) {
    case 'ACQ':
    case 'ARPU':
    case 'CHURN':
    case 'COST':
      return lever;
    case 'INVEST':
      return 'FUTURE';
    case 'SYNERGY':
      return 'EFFICIENCY';
    default:
      return undefined;
  }
};

// GrowthLever → Kind推定
const mapLeverToKind = (lever: Lever | undefined): Kind | undefined => {
  if (!lever) return undefined;
  if (lever === 'COST') return 'cost';
  if (lever === 'EFFICIENCY') return 'efficiency';
  if (lever === 'FUTURE') return 'future';
  return 'growth';
};

/* ビジュアルカード（部門戦略の全体像をシンプル表示） */
const VisualCard = memo(function VisualCard({ d }: { d: Department }) {
  const mission = (d.strategy ?? d.mission ?? '').trim();
  const projects = (d.projects ?? []) as Project[];

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

      {/* ミッション */}
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

                  {/* 仮説とタグ（簡易表示） */}
                  {(p.hypothesis || p.mainLever || p.horizon || p.kind) && (
                    <div className="mt-1">
                      {p.hypothesis && (
                        <p className="text-[11px] text-zinc-600 whitespace-pre-wrap">
                          仮説：{p.hypothesis}
                        </p>
                      )}
                      <div className="mt-1 flex flex-wrap gap-1 text-[10px] text-zinc-500">
                        {p.kind && (
                          <span className="px-2 py-0.5 rounded-full bg-zinc-50 border border-zinc-100">
                            {KIND_LABEL[p.kind]}
                          </span>
                        )}
                        {p.mainLever && (
                          <span className="px-2 py-0.5 rounded-full bg-zinc-50 border border-zinc-100">
                            {LEVER_LABEL[p.mainLever]}
                          </span>
                        )}
                        {p.horizon && (
                          <span className="px-2 py-0.5 rounded-full bg-zinc-50 border border-zinc-100">
                            {HORIZON_LABEL[p.horizon]}
                          </span>
                        )}
                      </div>
                    </div>
                  )}

                  {okr?.objective && (
                    <div className="mt-2 text-xs text-zinc-700">
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

  const industry: string =
    (s?.industry as string) || (s?.company?.industry as string) || '';

  /* ---- 初回ログだけ ---- */
  useEffect(() => {
    console.log('[cascade] mount', { hydrated, scopeCompanyId, accessCompanyId });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ===== 会社スコープ確立（StrictMode耐性）===== */
  const lastAppliedCompanyRef = useRef<string | null>(null);
  useEffect(() => {
    if (!accessCompanyId) return;
    if (lastAppliedCompanyRef.current === accessCompanyId && scopeCompanyId === accessCompanyId)
      return;

    if (scopeCompanyId && scopeCompanyId !== accessCompanyId) {
      setHydrated?.(false);
      hardResetForCompanySwitch(accessCompanyId);
      setCompanyScope(accessCompanyId);
    } else if (!scopeCompanyId) {
      setCompanyScope(accessCompanyId);
    }
    lastAppliedCompanyRef.current = accessCompanyId;
  }, [accessCompanyId, scopeCompanyId, setCompanyScope, setHydrated]);

  /* ===== 初期ロード ===== */
  const loadGuardRef = useRef<string | null>(null);
  useEffect(() => {
    if (!accessCompanyId) return;
    if (!scopeCompanyId) setCompanyScope(accessCompanyId);
    if (loadGuardRef.current === accessCompanyId && hydrated && scopeCompanyId === accessCompanyId)
      return;

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
  }, [
    accessCompanyId,
    hydrated,
    scopeCompanyId,
    refetchFromServer,
    setHydrated,
    lastServerSnapshot,
    setCompanyScope,
  ]);

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
    (st) =>
      ((st.departments as Department[] | undefined) ?? []) as Department[],
  );

  // hydrated 後のみオートセーブ対象
  useAutoSave(hydrated && !boot?.isHydrating ? [accessCompanyId, departments] : []);

  const mismatch = !!(accessCompanyId && scopeCompanyId && scopeCompanyId !== accessCompanyId);
  const isHydrating = (Boolean(boot?.isHydrating) && !hydrated) || mismatch || !hydrated;

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

  const [notice, setNotice] = useState('');
  const [isCascadeGenerating, setIsCascadeGenerating] = useState(false);

  /* ===== 部門配列更新ヘルパー ===== */
  const pushToStore = useCallback(
    (next: Department[] | ((prev: Department[]) => Department[])) => {
      const prev =
        ((useStrategyStore.getState().departments as Department[] | undefined) ??
          []) as Department[];
      const resolved =
        typeof next === 'function'
          ? (next as (p: Department[]) => Department[])(prev)
          : next;
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

  /* ===== その場保存（部門ミッション） ===== */
  const saveInlineMission = async (index: number) => {
    let changed = false;

    pushToStore((prev) => {
      const current = [...prev];
      const d = current[index];
      if (!d) return prev;

      const draft = (inlineEdit[index] ?? d.strategy ?? d.mission ?? '').toString();
      if (
        (d.mission ?? '') === draft &&
        (d.strategy ?? '') === draft &&
        (d.missionDraft ?? '') === draft
      ) {
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
      setNotice('（変更はありません）');
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
      setNotice('⚠️ 経営ストーリーを先に作成してください（STAGE 2 の完了が必要です）');
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

  /* ===== プロジェクト削除 ===== */
  const handleDeleteProject = async (deptIndex: number, projectIndex: number) => {
    const current =
      (useStrategyStore.getState().departments as Department[] | undefined) ?? [];
    const dept = current[deptIndex];
    if (!dept) return;
    if (!canEditDept()) return setNotice('⚠️ プロジェクト削除の権限がありません');

    const targetProject = (dept.projects as Project[] | undefined)?.[projectIndex];
    if (!targetProject) return;

    const ok = window.confirm(
      `プロジェクト「${targetProject.title || '無題'}」を削除しますか？`,
    );
    if (!ok) return;

    pushToStore((prev) => {
      const list = [...prev];
      const d = list[deptIndex];
      if (!d) return prev;
      const projects = [...((d.projects as Project[] | undefined) ?? [])];
      projects.splice(projectIndex, 1);
      list[deptIndex] = { ...d, projects };
      return list;
    });

    setNotice(`🗑 プロジェクト「${targetProject.title || '無題'}」を削除しました`);

    if (saveNow) {
      try {
        await saveNow();
        setNotice(
          `🗑 プロジェクト「${targetProject.title || '無題'}」を削除しました（サーバーにも反映済み）`,
        );
      } catch {
        setNotice(
          `⚠️ プロジェクト削除をサーバーに保存できませんでした（画面上は削除済み）`,
        );
      }
    }
  };

  /* ===== プロジェクト追加（手入力／OKR画面で詳細編集する前提） ===== */
  const handleAddProject = async (deptIndex: number) => {
    const current =
      (useStrategyStore.getState().departments as Department[] | undefined) ?? [];
    const dept = current[deptIndex];
    if (!dept) return;
    if (!canEditDept()) return setNotice('⚠️ プロジェクト追加の権限がありません');

    const existingProjects = (dept.projects as Project[] | undefined) ?? [];
    const baseTitle = '新しいプロジェクト';
    const existing = new Set(existingProjects.map((p) => p.title || ''));
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

      const projects: Project[] = [
        ...((d.projects as Project[] | undefined) ?? []),
        {
          title,
          okrs: [] as StoreOKR[],
        } as Project,
      ];

      list[deptIndex] = { ...d, projects };
      return list;
    });

    setNotice(`✅ プロジェクト「${title}」を追加しました`);

    if (saveNow) {
      try {
        await saveNow();
        setNotice(`✅ プロジェクト「${title}」を追加しました（サーバーにも反映済み）`);
      } catch {
        setNotice(
          `⚠️ プロジェクト「${title}」の追加は画面上のみ反映されました（サーバー保存に失敗）`,
        );
      }
    }
  };

  /* ===== 部門削除 ===== */
  const handleDeleteDepartment = async (index: number) => {
    if (!canEditCompany) {
      setNotice('⚠️ 部門削除は管理者のみ可能です');
      return;
    }

    const current =
      (useStrategyStore.getState().departments as Department[] | undefined) ?? [];
    const target = current[index];
    if (!target) return;

    const ok = window.confirm(
      `「${target.name}」を削除しますか？\nこの操作は元に戻せません。`,
    );
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
        setNotice(
          `⚠️ ${target.name} の削除をサーバーに保存できませんでした（画面上は削除済み）`,
        );
      }
    }
  };

  /* ===== /api/generate-cascade を使った全社一括生成（従来ロジック維持） ===== */
  const handleCascadeGenerateAll = async () => {
    if (!canEditDept()) {
      setNotice('⚠️ AI一括生成は編集権限があるユーザーのみ実行できます');
      return;
    }
    if (!departments.length) {
      setNotice('⚠️ 部門が登録されていません');
      return;
    }

    const storyOrWarn = requireStoryOrWarn();
    if (!storyOrWarn) return;

    setIsCascadeGenerating(true);
    setNotice(
      '✨ 全社の部門戦略案（ミッション・プロジェクト・OKR案）をAIが生成しています…',
    );

    try {
      const payload: any = {
        thought: s?.thought ?? '',
        vision: s?.vision ?? '',
        mission: s?.mission ?? '',
        industry,
        revenue: s?.revenue ?? s?.company?.revenue,
        employees: s?.employees ?? s?.company?.employees,
        value: s?.value ?? '',
        strength: s?.strength ?? '',
        weakness: s?.weakness ?? '',
        opportunity: s?.opportunity ?? '',
        threat: s?.threat ?? '',
        story: rawStory,
        strategySummary: s?.strategySummary ?? '',
        departments: departments.map((d) => ({
          name: d.name,
          missionDraft: d.mission ?? d.strategy ?? d.missionDraft ?? '',
          projects: (d.projects as Project[] | undefined)?.map((p) => p.title) ?? [],
          okrs:
            (d.projects as Project[] | undefined)
              ?.flatMap((p) => p.okrs ?? [])
              .map((o) => ({
                objective: o.objective ?? '',
                keyResults: (o.keyResults ?? []).slice(),
                owner: o.owner ?? '',
              })) ?? [],
          direction: (d as any).direction,
          expectations: (d as any).expectations,
          focusThemes: (d as any).focusThemes,
          answers: d.answers2?.[0]?.steps ?? [],
        })),
        csvFinanceData: s?.csvFinanceData ?? [],
        financeSummary: s?.financeSummary,
        businessPortfolio: s?.businessPortfolio,
      };

      const res = await fetch('/api/generate-cascade', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const text = await res.text();
      const data = safeJsonFromText<any>(text);

      if (!res.ok || !data) {
        setNotice(`❌ 一括生成に失敗しました：${data?.error ?? res.statusText}`);
        return;
      }

      const resultDepts: any[] = Array.isArray(data.departments)
        ? data.departments
        : [];

      pushToStore((prev) => {
        const list = [...prev];

        for (const rd of resultDepts) {
          const name = (rd?.name ?? '').trim();
          if (!name) continue;
          const idx = list.findIndex((d) => d.name === name);
          if (idx < 0) continue;

          const d = list[idx];
          const existingProjects = (d.projects as Project[] | undefined) ?? [];
          const patch: Partial<Department> = {};

          const missionDraft = (rd.missionDraft ?? '').trim();
          if (
            missionDraft &&
            (!jsonEq(missionDraft, d.mission) ||
              !jsonEq(missionDraft, d.strategy) ||
              !jsonEq(missionDraft, d.missionDraft))
          ) {
            patch.mission = missionDraft;
            patch.strategy = missionDraft;
            patch.missionDraft = missionDraft;
          }

          const projectsDraft: any[] = Array.isArray(rd.projects) ? rd.projects : [];
          const okrDraft: any[] = Array.isArray(rd.okrDraft) ? rd.okrDraft : [];

          let projects: Project[] = [...existingProjects];

          if (projectsDraft.length) {
            for (const pd of projectsDraft) {
              const title = (pd?.title ?? '').trim();
              if (!title) continue;

              const okrsForProj: StoreOKR[] = okrDraft.map((o) =>
                toStoreOKR({
                  objective: o?.objective ?? '',
                  keyResults: Array.isArray(o?.keyResults) ? o.keyResults : [],
                  owner: o?.owner ?? '',
                } as DeptOKR),
              );

              const newProjBase: Project = {
                title,
                hypothesis:
                  typeof pd?.hypothesis === 'string' ? pd.hypothesis.trim() : undefined,
                mainLever: normalizeLever(pd?.mainLever),
                horizon: normalizeHorizon(pd?.horizon),
                kind: normalizeKind(pd?.kind),
                okrs: okrsForProj,
              };

              const existIdx = projects.findIndex((p) => (p.title ?? '') === title);
              if (existIdx >= 0) {
                const existing = { ...projects[existIdx] } as Project;
                const existingOkrs: StoreOKR[] = [...(existing.okrs ?? [])];

                for (const o of okrsForProj) {
                  if (!existingOkrs.some((eo) => jsonEq(eo, o))) {
                    existingOkrs.push(o);
                  }
                }

                // 仮説メタ情報は、新しい値があれば上書き（なければ既存を維持）
                const merged: Project = {
                  ...existing,
                  okrs: existingOkrs,
                  hypothesis: newProjBase.hypothesis || existing.hypothesis,
                  mainLever: newProjBase.mainLever || existing.mainLever,
                  horizon: newProjBase.horizon || existing.horizon,
                  kind: newProjBase.kind || existing.kind,
                };

                projects[existIdx] = merged;
              } else {
                projects.push(newProjBase);
              }
            }
          }

          if (!jsonEq(projects, existingProjects)) {
            patch.projects = projects;
          }

          if (Object.keys(patch).length > 0) {
            list[idx] = { ...d, ...patch } as Department;
          }
        }

        return list;
      });

      setNotice(
        '✅ 全社の部門ミッション・プロジェクト案・OKR案をAIで更新しました（既存データはできるだけ尊重してマージしています）',
      );

      if (saveNow) {
        try {
          await saveNow();
          setNotice('✅ 全社の部門戦略案を更新し、サーバーにも保存しました');
        } catch {
          setNotice('⚠️ 画面上の更新は完了しましたが、サーバー保存に失敗しました');
        }
      }
    } catch (e: any) {
      setNotice(
        `❌ 一括生成中にエラーが発生しました：${e?.message ?? '不明なエラー'}`,
      );
    } finally {
      setIsCascadeGenerating(false);
    }
  };

  /* ===== この部門だけ：/api/generate-cascade を使ったたたき台生成（従来ロジック） ===== */
  const handleDeptCascadeDraft = async (index: number) => {
    const story = requireStoryOrWarn();
    if (!story) return;
    if (!canEditDept()) return setNotice('⚠️ 編集権限がありません');

    const current =
      (useStrategyStore.getState().departments as Department[] | undefined) ?? [];
    const dept = current[index];
    if (!dept) return;

    setLoading((p) => ({ ...p, [index]: { ...(p[index] || {}), deptDraft: true } }));

    try {
      const payload: any = {
        thought: s?.thought ?? '',
        vision: s?.vision ?? '',
        mission: s?.mission ?? '',
        industry,
        revenue: s?.revenue ?? s?.company?.revenue,
        employees: s?.employees ?? s?.company?.employees,
        value: s?.value ?? '',
        strength: s?.strength ?? '',
        weakness: s?.weakness ?? '',
        opportunity: s?.opportunity ?? '',
        threat: s?.threat ?? '',
        story: rawStory,
        strategySummary: s?.strategySummary ?? '',
        departments: [
          {
            name: dept.name,
            missionDraft: dept.mission ?? dept.strategy ?? dept.missionDraft ?? '',
            projects: ((dept.projects as Project[] | undefined) ?? []).map((p) => p.title),
            okrs:
              ((dept.projects as Project[] | undefined) ?? [])
                .flatMap((p) => p.okrs ?? [])
                .map((o) => ({
                  objective: o.objective ?? '',
                  keyResults: (o.keyResults ?? []).slice(),
                  owner: o.owner ?? '',
                })) ?? [],
            direction: (dept as any).direction,
            expectations: (dept as any).expectations,
            focusThemes: (dept as any).focusThemes,
            answers: dept.answers2?.[0]?.steps ?? [],
          },
        ],
        csvFinanceData: s?.csvFinanceData ?? [],
        financeSummary: s?.financeSummary,
        businessPortfolio: s?.businessPortfolio,
      };

      const res = await fetch('/api/generate-cascade', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const text = await res.text();
      const data = safeJsonFromText<any>(text);

      if (!res.ok || !data) {
        setNotice(
          `❌ 部門のたたき台生成に失敗しました：${data?.error ?? res.statusText}`,
        );
        return;
      }

      const rd = Array.isArray(data.departments) ? data.departments[0] : null;
      if (!rd) {
        setNotice('⚠️ この部門のたたき台が取得できませんでした');
        return;
      }

      pushToStore((prev) => {
        const list = [...prev];
        const d = list[index];
        if (!d) return prev;

        const existingProjects = (d.projects as Project[] | undefined) ?? [];
        const patch: Partial<Department> = {};

        // ミッション
        const missionDraft = (rd.missionDraft ?? '').trim();
        if (
          missionDraft &&
          (!jsonEq(missionDraft, d.mission) ||
            !jsonEq(missionDraft, d.strategy) ||
            !jsonEq(missionDraft, d.missionDraft))
        ) {
          patch.mission = missionDraft;
          patch.strategy = missionDraft;
          patch.missionDraft = missionDraft;
        }

        // プロジェクト + OKR
        const projectsDraft: any[] = Array.isArray(rd.projects) ? rd.projects : [];
        const okrDraft: any[] = Array.isArray(rd.okrDraft) ? rd.okrDraft : [];
        let projects: Project[] = [...existingProjects];

        if (projectsDraft.length) {
          for (const pd of projectsDraft) {
            const title = (pd?.title ?? '').trim();
            if (!title) continue;

            const okrsForProj: StoreOKR[] = okrDraft.map((o) =>
              toStoreOKR({
                objective: o?.objective ?? '',
                keyResults: Array.isArray(o?.keyResults) ? o.keyResults : [],
                owner: o?.owner ?? '',
              } as DeptOKR),
            );

            const newProjBase: Project = {
              title,
              hypothesis:
                typeof pd?.hypothesis === 'string' ? pd.hypothesis.trim() : undefined,
              mainLever: normalizeLever(pd?.mainLever),
              horizon: normalizeHorizon(pd?.horizon),
              kind: normalizeKind(pd?.kind),
              okrs: okrsForProj,
            };

            const existIdx = projects.findIndex((p) => (p.title ?? '') === title);
            if (existIdx >= 0) {
              const existing = { ...projects[existIdx] } as Project;
              const existingOkrs: StoreOKR[] = [...(existing.okrs ?? [])];

              for (const o of okrsForProj) {
                if (!existingOkrs.some((eo) => jsonEq(eo, o))) {
                  existingOkrs.push(o);
                }
              }

              const merged: Project = {
                ...existing,
                okrs: existingOkrs,
                hypothesis: newProjBase.hypothesis || existing.hypothesis,
                mainLever: newProjBase.mainLever || existing.mainLever,
                horizon: newProjBase.horizon || existing.horizon,
                kind: newProjBase.kind || existing.kind,
              };
              projects[existIdx] = merged;
            } else {
              projects.push(newProjBase);
            }
          }
        }

        if (!jsonEq(projects, existingProjects)) {
          patch.projects = projects;
        }

        if (Object.keys(patch).length > 0) {
          list[index] = { ...d, ...patch } as Department;
        }

        return list;
      });

      setNotice(`✅ ${dept.name} のミッション・プロジェクト・OKR案を更新しました`);
      if (saveNow) {
        try {
          await saveNow();
          setNotice(`✅ ${dept.name} のたたき台を更新し、サーバーにも保存しました`);
        } catch {
          setNotice('⚠️ 画面上の更新は完了しましたが、サーバー保存に失敗しました');
        }
      }
    } catch (e: any) {
      setNotice(
        `❌ 部門のたたき台生成中にエラーが発生しました：${e?.message ?? '不明なエラー'}`,
      );
    } finally {
      setLoading((p) => ({ ...p, [index]: { ...(p[index] || {}), deptDraft: false } }));
    }
  };

  /* ===== 勝ち筋カタログベース：この部門のプロジェクト＆OKR案を生成 ===== */
  const handleDeptWinPatternGenerate = async (index: number) => {
    if (!canEditDept()) {
      setNotice('⚠️ プロジェクト＆OKR案の生成は編集権限があるユーザーのみ実行できます');
      return;
    }

    const story = requireStoryOrWarn();
    if (!story) return;

    const current =
      (useStrategyStore.getState().departments as Department[] | undefined) ?? [];
    const dept = current[index];
    if (!dept) return;

    const missionText = (dept.strategy ?? dept.mission ?? '').trim();

    const industryCode = detectIndustryCode(industry);
    const deptKind = detectDepartmentKind(dept.name);
    const leverPriority = detectLeverPriority(missionText, storyText, dept.name);

    setLoading((p) => ({ ...p, [index]: { ...(p[index] || {}), winPattern: true } }));
    setNotice(
      `✨ ${dept.name} のプロジェクト＆OKR案を「勝ち筋カタログ」から生成しています…`,
    );

    try {
      const generated = generateProjectsForDepartment({
        industry: industryCode,
        departmentKind: deptKind,
        leverPriority,
        missionText,
        storyText,
        maxProjects: 3,
      });

      if (!generated.length) {
        setNotice(
          `⚠️ ${dept.name} に対して、勝ち筋カタログから該当するパターンが見つかりませんでした（業種・部門名の表現を見直すとマッチしやすくなります）`,
        );
        return;
      }

      pushToStore((prev) => {
        const list = [...prev];
        const d = list[index];
        if (!d) return prev;

        const existingProjects = (d.projects as Project[] | undefined) ?? [];
        let projects: Project[] = [...existingProjects];

        for (const gp of generated) {
          const title = gp.title || '無題のプロジェクト';
          const mappedLever = mapGrowthLeverToLever(gp.lever);
          const kind = mapLeverToKind(mappedLever);

          const okr: StoreOKR | null =
            gp.objective || (gp.keyResults && gp.keyResults.length)
              ? {
                  objective: gp.objective || '',
                  keyResults: gp.keyResults ?? [],
                  owner: undefined,
                }
              : null;

          const existIdx = projects.findIndex((p) => (p.title ?? '') === title);

          if (existIdx >= 0) {
            // 既存プロジェクトがある場合はOKRとメタ情報をマージ
            const existing = { ...(projects[existIdx] as Project) };
            const baseOkrs: StoreOKR[] = [...(existing.okrs ?? [])];

            if (okr) {
              if (!baseOkrs[0]) {
                baseOkrs[0] = okr;
              } else if (
                !(
                  baseOkrs[0].objective === okr.objective &&
                  jsonEq(baseOkrs[0].keyResults, okr.keyResults)
                )
              ) {
                baseOkrs.push(okr);
              }
            }

            projects[existIdx] = {
              ...existing,
              okrs: baseOkrs,
              hypothesis: existing.hypothesis || gp.description || '',
              mainLever: existing.mainLever || mappedLever,
              kind: existing.kind || kind,
              // horizonはここでは決めない（ユーザーが後から決める）
            };
          } else {
            projects.push({
              title,
              hypothesis: gp.description || '',
              mainLever: mappedLever,
              kind,
              okrs: okr ? [okr] : [],
            } as Project);
          }
        }

        if (jsonEq(projects, existingProjects)) return prev;
        list[index] = { ...d, projects };
        return list;
      });

      setNotice(
        `✅ ${dept.name} のプロジェクト＆OKR案を「勝ち筋カタログ」ベースで追加しました（詳細はOKR画面で詰めてください）`,
      );

      if (saveNow) {
        try {
          await saveNow();
          setNotice(
            `✅ ${dept.name} の勝ち筋ドリブンなプロジェクト＆OKR案を追加し、サーバーにも保存しました`,
          );
        } catch {
          setNotice(
            `⚠️ ${dept.name} の勝ち筋ドリブン案は画面上には反映されていますが、サーバー保存に失敗しました`,
          );
        }
      }
    } catch (e: any) {
      setNotice(
        `❌ ${dept.name} の勝ち筋カタログ生成中にエラーが発生しました：${
          e?.message ?? '不明なエラー'
        }`,
      );
    } finally {
      setLoading((p) => ({ ...p, [index]: { ...(p[index] || {}), winPattern: false } }));
    }
  };

  /* ===== ビジュアルビュー ===== */
  const VisualView = useMemo(() => {
    if (!departments.length)
      return <div className="text-zinc-600">部門がまだ登録されていません。</div>;
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
    () => departments.map((d) => ((d.projects as Project[] | undefined) ?? []).map((p) => p.title)),
    [departments],
  );

  /* ===== JSX ===== */
  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      <header className="mb-8">
        <h1 className="text-[28px] font-semibold mb-2">STAGE 3：部門戦略（カスケード）</h1>
        <p className="text-zinc-600 text-sm">
          経営ストーリーを基に、質問に答えながら各部門の
          <b>ミッション・プロジェクト案・OKR案（目標と主要な成果）</b>
          を明確化します。
        </p>
      </header>

      {/* 読み込みインジケータ */}
      {isHydrating && (
        <div className="mb-8 rounded-xl border p-4 text-sm text-muted-foreground flex items-center justify-between">
          <span>サーバーからデータを読み込んでいます…</span>
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

      {/* ストーリー概要 */}
      {!isHydrating && (
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
              経営ストーリーが未設定です。先に STAGE 2 で「経営ストーリー」を作成してください。
            </div>
          )}
        </section>
      )}

      {/* タブ＋追加ボタン＋全体保存＋一括AI */}
      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3 mb-6">
        <div className="inline-flex border rounded-full overflow-hidden">
          {(['edit', 'visual'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setActiveTab(t)}
              className={`px-4 py-2 text-sm ${
                activeTab === t ? 'bg-zinc-900 text-white' : 'bg-white text-zinc-800'
              }`}
              disabled={isHydrating}
            >
              {t === 'edit' ? '編集ビュー' : 'ビジュアルビュー'}
            </button>
          ))}
        </div>

        <div className="flex gap-2 justify-end flex-wrap">
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

          {/* 全社一括AI生成（ミッション・プロジェクト・OKR案） */}
          {departments.length > 0 && (
            <Button
              variant="outline"
              className="rounded-full h-9 px-4"
              disabled={isHydrating || isCascadeGenerating}
              onClick={handleCascadeGenerateAll}
              title="全ての部門について、ミッション・プロジェクト案・OKR案を一括生成します"
            >
              <Sparkles className="w-4 h-4 mr-1" />
              {isCascadeGenerating
                ? 'AIが全社のたたき台を生成中…'
                : 'AIで全社のたたき台（ミッション・プロジェクト・OKR案）'}
            </Button>
          )}

          {canEditCompany && (
            <Button
              onClick={() => setShowForm((v) => !v)}
              className="rounded-full h-9 px-4"
              disabled={isHydrating}
            >
              <PlusCircle className="w-4 h-4 mr-1" />
              {showForm ? '閉じる' : '部門を追加'}
            </Button>
          )}
        </div>
      </div>

      {/* 追加フォーム */}
      {showForm && canEditCompany && !isHydrating && (
        <div className="p-6 border rounded-3xl bg-white/70 mb-8">
          <div className="grid md:grid-cols-2 gap-4">
            <input
              value={deptName}
              onChange={(e) => setDeptName(e.target.value)}
              placeholder="部門名（例：営業部、人事部、生産本部など）"
              className="border rounded-xl px-3 py-2 text-sm"
            />
            <input
              value={deptMission}
              onChange={(e) => setDeptMission(e.target.value)}
              placeholder="（任意）ミッションのメモ"
              className="border rounded-xl px-3 py-2 text-sm"
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
              onClick={async () => {
                if (!deptName.trim())
                  return setNotice('⚠️ 部門名を入力してください');
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
                    answers2: [
                      { chapterIndex: current.length, chapterTitle: baseName, steps: [] },
                    ],
                    finalized: false,
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
                    setNotice(
                      `✅ ${baseName} を追加しました（サーバーにも反映済み）`,
                    );
                  } catch {
                    setNotice(
                      `⚠️ ${baseName} の追加は画面上は反映されていますが、サーバー保存に失敗しました`,
                    );
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
            const editableDept = canEditDept();
            const L = loading[index] ?? {};
            const inlineDraft = (
              inlineEdit[index] ??
              dept.strategy ??
              dept.mission ??
              ''
            ).toString();

            const answers = answersMemo[index];
            const projTitles = projectsMemo[index];
            const currentStoreSteps = dept.answers2?.[0]?.steps ?? [];

            const deptMissionText = (dept.strategy ?? dept.mission ?? '').trim();
            const deptProjects = (dept.projects as Project[] | undefined) ?? [];

            return (
              <div
                key={`e-${dept.name}-${index}`}
                className="p-6 border rounded-3xl bg-white/70 backdrop-blur-sm shadow-sm"
              >
                <div className="flex justify-between items-center mb-3">
                  <h3 className="font-semibold text-zinc-900 flex items-center gap-2">
                    <Building2 className="w-4 h-4" /> {dept.name}
                  </h3>
                  <div className="flex items-center gap-2">
                    {dept.finalized && (
                      <span className="text-xs bg-zinc-900 text-white rounded-full px-2 py-1">
                        確定済み
                      </span>
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
                  onChange={(e) =>
                    setInlineEdit((p) => ({ ...p, [index]: e.target.value }))
                  }
                  className="w-full border rounded-xl p-2 mb-2 text-sm"
                  readOnly={!editableDept || isHydrating}
                  placeholder="この部門の役割やミッションのイメージを記入してください（AIたたき台の修正もここで行います）"
                />

                {/* 保存＋AIたたき台（この部門だけ）＋勝ち筋カタログ生成 */}
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
                    onClick={() => handleDeptCascadeDraft(index)}
                    disabled={!editableDept || !!L.deptDraft || isHydrating}
                    className="rounded-full h-9 px-4"
                    title="この部門のミッション・プロジェクト案・OKR案をAIが提案します"
                  >
                    <Sparkles className="w-4 h-4 mr-1" />
                    {L.deptDraft
                      ? 'たたき台を生成中…'
                      : 'AIでこの部門のたたき台（ミッション・プロジェクト・OKR案）'}
                  </Button>

                  <Button
                    variant="outline"
                    onClick={() => handleDeptWinPatternGenerate(index)}
                    disabled={!editableDept || !!L.winPattern || isHydrating}
                    className="rounded-full h-9 px-4"
                    title="勝ち筋カタログに基づき、この部門のプロジェクト＆OKR案を生成します"
                  >
                    <Sparkles className="w-4 h-4 mr-1" />
                    {L.winPattern
                      ? '勝ち筋から生成中…'
                      : '勝ち筋カタログからプロジェクト＆OKR案'}
                  </Button>
                </div>
                <p className="text-xs text-zinc-500 mb-3">
                  ※ 「AIでこの部門のたたき台」はミッションも含めて生成します。/
                  「勝ち筋カタログからプロジェクト＆OKR案」は、経営ストーリーと部門名・ミッションから
                  <b>勝ち筋ドリブンなプロジェクト＆OKR案</b>だけを追加生成します。
                  詳細な数値や構造化は「OKR設定」画面で詰めてください。
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
                        answers2: [
                          { chapterIndex: index, chapterTitle: d.name, steps: nextSteps },
                        ],
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
                        const projList: Project[] = projects.map((t) => ({
                          title: t,
                          okrs: [] as StoreOKR[],
                        }));
                        if (!jsonEq(projList, d.projects)) patch.projects = projList;
                      }
                      if (okrs?.length) {
                        const add: Project = {
                          title: '初期OKR案',
                          okrs: [toStoreOKR(okrs[0])],
                        };

                        const baseProjects: Project[] =
                          (patch.projects as Project[] | undefined) ??
                          ((d.projects as Project[] | undefined) ?? []);
                        const merged: Project[] = [...baseProjects, add];

                        if (!jsonEq(merged, d.projects)) {
                          patch.projects = merged;
                        }
                      }
                      const changed = Object.keys(patch).length > 0;
                      if (!changed) return prev;

                      const updated: Department = { ...d, ...patch };
                      list[index] = updated;
                      return list;
                    });

                    setNotice(`✅ ${dept.name} のたたき台を反映しました`);
                  }}
                />

                {/* プロジェクト一覧（追加・削除・タイトル編集・OKR案の編集） */}
                {deptProjects && deptProjects.length > 0 && (
                  <div className="mt-5 border-t pt-4">
                    {/* 部門ミッションの再掲示 */}
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
                      <h4 className="text-sm font-semibold text-zinc-800">
                        プロジェクト案とOKR案
                      </h4>
                      <div className="flex items-center gap-2">
                        <span className="text-[11px] text-zinc-500 hidden sm:inline">
                          ※ 詳細な編集や構造化は「OKR設定」画面で行えます。
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
                            プロジェクトを追加
                          </Button>
                        )}
                      </div>
                    </div>
                    <p className="sm:hidden text-[11px] text-zinc-500 mb-2">
                      ※ 詳細な編集や構造化は「OKR設定」画面で行えます。
                    </p>

                    <ul className="space-y-2">
                      {deptProjects.map((p, pi) => {
                        const primaryOKR = p.okrs?.[0];
                        const primaryObjective = primaryOKR?.objective ?? '';
                        const krs = (primaryOKR?.keyResults ?? []).filter(
                          (kr) => typeof kr === 'string',
                        );
                        const owner = primaryOKR?.owner ?? '';

                        return (
                          <li
                            key={`${dept.name}-proj-${pi}`}
                            className="flex flex-col gap-2 rounded-2xl border px-3 py-2 bg-white/70"
                          >
                            {/* 1行目：プロジェクト名＋削除 */}
                            <div className="flex items-start justify-between gap-3">
                              <div className="flex-1">
                                <div className="flex items-center gap-2">
                                  <span className="text-sm text-zinc-500">•</span>
                                  <input
                                    className="flex-1 text-sm font-medium text-zinc-900 bg-transparent border-b border-dashed border-zinc-300 focus:outline-none focus:border-zinc-500"
                                    value={p.title || ''}
                                    placeholder="プロジェクト名を入力（例：新規顧客開拓の強化、人事評価制度の見直し など）"
                                    readOnly={!editableDept || isHydrating}
                                    onChange={(e) => {
                                      if (!editableDept || isHydrating) return;
                                      const val = e.target.value;
                                      pushToStore((prev) => {
                                        const list = [...prev];
                                        const d = list[index];
                                        if (!d) return prev;
                                        const projects = [...((d.projects as Project[]) ?? [])];
                                        const proj: Project = {
                                          ...(projects[pi] ?? { title: '' }),
                                        } as Project;
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
                                {editableDept && (
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
                                )}
                              </div>
                            </div>

                            {/* 仮説とタグ（閲覧用） */}
                            {(p.hypothesis || p.mainLever || p.horizon || p.kind) && (
                              <div className="pl-5 mt-1">
                                {p.hypothesis && (
                                  <p className="text-[11px] text-zinc-600 whitespace-pre-wrap">
                                    仮説：{p.hypothesis}
                                  </p>
                                )}
                                <div className="mt-1 flex flex-wrap gap-1 text-[10px] text-zinc-500">
                                  {p.kind && (
                                    <span className="px-2 py-0.5 rounded-full bg-zinc-50 border border-zinc-100">
                                      {KIND_LABEL[p.kind]}
                                    </span>
                                  )}
                                  {p.mainLever && (
                                    <span className="px-2 py-0.5 rounded-full bg-zinc-50 border border-zinc-100">
                                      {LEVER_LABEL[p.mainLever]}
                                    </span>
                                  )}
                                  {p.horizon && (
                                    <span className="px-2 py-0.5 rounded-full bg-zinc-50 border border-zinc-100">
                                      {HORIZON_LABEL[p.horizon]}
                                    </span>
                                  )}
                                </div>
                              </div>
                            )}

                            {/* Objective（O） */}
                            <div className="pl-5 mt-2">
                              <div className="text-[11px] text-zinc-500 mb-1">
                                このプロジェクトで実現したい状態（Objective／目標）
                              </div>
                              <input
                                className="w-full text-xs text-zinc-800 bg-white border border-zinc-200 rounded-lg px-2 py-1 focus:outline-none focus:ring-1 focus:ring-zinc-400"
                                value={primaryObjective}
                                placeholder="例）このプロジェクトを通じて、●●事業の売上を〇〇％成長させる／離職率を△△％改善する など"
                                readOnly={!editableDept || isHydrating}
                                onChange={(e) => {
                                  if (!editableDept || isHydrating) return;
                                  const val = e.target.value;
                                  pushToStore((prev) => {
                                    const list = [...prev];
                                    const d = list[index];
                                    if (!d) return prev;
                                    const projects = [...((d.projects as Project[]) ?? [])];
                                    const proj: Project = {
                                      ...(projects[pi] ?? { title: '' }),
                                    } as Project;

                                    const okrs: StoreOKR[] = [...(proj.okrs ?? [])];
                                    if (!okrs[0]) {
                                      okrs[0] = {
                                        objective: '',
                                        keyResults: [],
                                        owner: undefined,
                                      };
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

                            {/* KR（主要な成果）の編集 */}
                            <div className="pl-5 mt-3 space-y-2">
                              <div className="flex items-center justify-between gap-2">
                                <div className="text-[11px] text-zinc-500">
                                  このプロジェクトの主要な成果指標（KR案）
                                </div>
                                {editableDept && (
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    className="h-7 px-2 rounded-full text-[11px]"
                                    disabled={isHydrating}
                                    onClick={() => {
                                      if (!editableDept || isHydrating) return;
                                      pushToStore((prev) => {
                                        const list = [...prev];
                                        const d = list[index];
                                        if (!d) return prev;
                                        const projects = [...((d.projects as Project[]) ?? [])];
                                        const proj: Project = {
                                          ...(projects[pi] ?? { title: '' }),
                                        } as Project;
                                        const okrs: StoreOKR[] = [...(proj.okrs ?? [])];
                                        if (!okrs[0]) {
                                          okrs[0] = {
                                            objective: '',
                                            keyResults: [],
                                            owner: undefined,
                                          };
                                        }
                                        const nextKrs = [...(okrs[0].keyResults ?? [])];
                                        nextKrs.push('');
                                        okrs[0] = { ...okrs[0], keyResults: nextKrs };
                                        proj.okrs = okrs;
                                        projects[pi] = proj;
                                        list[index] = { ...d, projects };
                                        return list;
                                      });
                                    }}
                                  >
                                    <PlusCircle className="w-3 h-3 mr-1" />
                                    KR行を追加
                                  </Button>
                                )}
                              </div>

                              {krs.length === 0 && (
                                <p className="text-[11px] text-zinc-400">
                                  まだKR案がありません。必要に応じて「KR行を追加」から入力してください。
                                </p>
                              )}

                              {krs.map((kr, ki) => (
                                <div key={ki} className="flex items-center gap-2">
                                  <span className="text-[11px] text-zinc-400 whitespace-nowrap">
                                    KR{ki + 1}
                                  </span>
                                  <input
                                    className="flex-1 text-xs text-zinc-800 bg-white border border-zinc-200 rounded-lg px-2 py-1 focus:outline-none focus:ring-1 focus:ring-zinc-400"
                                    value={kr}
                                    placeholder="例）新規顧客◯◯社を獲得／既存顧客へのアップセル売上◯◯百万円／離職率を◯◯％まで改善 など"
                                    readOnly={!editableDept || isHydrating}
                                    onChange={(e) => {
                                      if (!editableDept || isHydrating) return;
                                      const val = e.target.value;
                                      pushToStore((prev) => {
                                        const list = [...prev];
                                        const d = list[index];
                                        if (!d) return prev;
                                        const projects = [...((d.projects as Project[]) ?? [])];
                                        const proj: Project = {
                                          ...(projects[pi] ?? { title: '' }),
                                        } as Project;
                                        const okrs: StoreOKR[] = [...(proj.okrs ?? [])];
                                        if (!okrs[0]) {
                                          okrs[0] = {
                                            objective: '',
                                            keyResults: [],
                                            owner: undefined,
                                          };
                                        }
                                        const nextKrs = [...(okrs[0].keyResults ?? [])];
                                        nextKrs[ki] = val;
                                        okrs[0] = { ...okrs[0], keyResults: nextKrs };
                                        proj.okrs = okrs;
                                        projects[pi] = proj;
                                        list[index] = { ...d, projects };
                                        return list;
                                      });
                                    }}
                                  />
                                  {editableDept && (
                                    <Button
                                      variant="outline"
                                      size="sm"
                                      className="h-7 px-2 rounded-full text-[11px] border-red-400 text-red-600 hover:bg-red-50"
                                      disabled={isHydrating}
                                      onClick={() => {
                                        if (!editableDept || isHydrating) return;
                                        pushToStore((prev) => {
                                          const list = [...prev];
                                          const d = list[index];
                                          if (!d) return prev;
                                          const projects = [...((d.projects as Project[]) ?? [])];
                                          const proj: Project = {
                                            ...(projects[pi] ?? { title: '' }),
                                          } as Project;
                                          const okrs: StoreOKR[] = [...(proj.okrs ?? [])];
                                          if (!okrs[0]) return prev;
                                          const nextKrs = [...(okrs[0].keyResults ?? [])];
                                          nextKrs.splice(ki, 1);
                                          okrs[0] = { ...okrs[0], keyResults: nextKrs };
                                          proj.okrs = okrs;
                                          projects[pi] = proj;
                                          list[index] = { ...d, projects };
                                          return list;
                                        });
                                      }}
                                    >
                                      削除
                                    </Button>
                                  )}
                                </div>
                              ))}
                            </div>

                            {/* Owner（主な担当） */}
                            <div className="pl-5 mt-2">
                              <div className="text-[11px] text-zinc-500 mb-1">
                                主な担当（Owner）
                              </div>
                              <input
                                className="w-full text-xs text-zinc-800 bg-white border border-zinc-200 rounded-lg px-2 py-1 focus:outline-none focus:ring-1 focus:ring-zinc-400"
                                value={owner}
                                placeholder="例）営業部長、人事部マネジャー、工場長 など"
                                readOnly={!editableDept || isHydrating}
                                onChange={(e) => {
                                  if (!editableDept || isHydrating) return;
                                  const val = e.target.value;
                                  pushToStore((prev) => {
                                    const list = [...prev];
                                    const d = list[index];
                                    if (!d) return prev;
                                    const projects = [...((d.projects as Project[]) ?? [])];
                                    const proj: Project = {
                                      ...(projects[pi] ?? { title: '' }),
                                    } as Project;
                                    const okrs: StoreOKR[] = [...(proj.okrs ?? [])];
                                    if (!okrs[0]) {
                                      okrs[0] = {
                                        objective: '',
                                        keyResults: [],
                                        owner: undefined,
                                      };
                                    }
                                    okrs[0] = { ...okrs[0], owner: val || undefined };
                                    proj.okrs = okrs;
                                    projects[pi] = proj;
                                    list[index] = { ...d, projects };
                                    return list;
                                  });
                                }}
                              />
                            </div>

                            {/* OKR案クリア */}
                            {(primaryObjective || krs.length > 0 || owner) && editableDept && (
                              <div className="pl-5 mt-2">
                                <Button
                                  variant="outline"
                                  size="sm"
                                  className="h-7 px-3 rounded-full text-[11px] border-zinc-300 text-zinc-600 hover:bg-zinc-50"
                                  disabled={isHydrating}
                                  onClick={() => {
                                    if (!editableDept || isHydrating) return;
                                    const ok = window.confirm(
                                      'このプロジェクトのOKR案（目標・KR・Owner）をすべてクリアしますか？',
                                    );
                                    if (!ok) return;
                                    pushToStore((prev) => {
                                      const list = [...prev];
                                      const d = list[index];
                                      if (!d) return prev;
                                      const projects = [...((d.projects as Project[]) ?? [])];
                                      const proj: Project = {
                                        ...(projects[pi] ?? { title: '' }),
                                      } as Project;
                                      proj.okrs = [];
                                      projects[pi] = proj;
                                      list[index] = { ...d, projects };
                                      return list;
                                    });
                                    setNotice('🗑 このプロジェクトのOKR案をクリアしました');
                                  }}
                                >
                                  OKR案をすべてクリア
                                </Button>
                              </div>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                )}

                {/* プロジェクトがまだない場合も追加ボタンだけ出す */}
                {(!deptProjects || deptProjects.length === 0) && editableDept && (
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
