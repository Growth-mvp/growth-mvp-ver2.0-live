// /app/execution/page.tsx
'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useStrategyStore } from '@/store/strategyStore';
import ProjectCard from '@/components/execution/ProjectCard';
import { saveProgressLog } from '@/utils/supabase/strategy';
import { buildProgressLogMetadata, embedMetadata } from '@/utils/execution/metadata';
import { supabase } from '@/utils/supabase/client';
import { useUserStore } from '@/store/userStore';
import { X, Stars, Send, Clock, CheckCircle2, BookOpen, Building2 } from 'lucide-react';
import { useAccess } from '@/utils/access';
import { hardResetForCompanySwitch } from '@/utils/resetAll';
import { loadAndHydrate } from '@/utils/loader';
import { useAutoSave } from '@/hooks/useAutoSave';
import type { Department, Project as ProjectStrict, OKR as OKRStrict } from '@/types/strategy';

const DEBUG = process.env.NEXT_PUBLIC_DEBUG_HYDRATE === '1';

type Tone = 'blue' | 'emerald' | 'violet';
const storyTone: Tone = 'blue';
const deptTone = (di: number): Tone => (di % 3 === 0 ? 'blue' : di % 3 === 1 ? 'emerald' : 'violet');

const toneToDot = (t: Tone) => (t === 'blue' ? 'bg-blue-500' : t === 'emerald' ? 'bg-emerald-500' : 'bg-violet-500');
const toneToTint = (t: Tone) => (t === 'blue' ? 'bg-blue-50' : t === 'emerald' ? 'bg-emerald-50' : 'bg-violet-50');
const toneToStroke = (t: Tone) => (t === 'blue' ? 'stroke-blue-300' : t === 'emerald' ? 'stroke-emerald-300' : 'stroke-violet-300');

/* =========================
 * ユーティリティ
 * ======================= */
const toStrictOKR = (okr: any): OKRStrict => ({
  objective: String(okr?.objective ?? ''),
  keyResults: Array.isArray(okr?.keyResults) ? okr.keyResults.map((k: any) => String(k)) : [],
  owner: okr?.owner ? String(okr.owner) : undefined,
});

// okrsV2 を潰さないため、title だけ正規化して残りは元projを活かす
const toStrictProject = (proj: any): ProjectStrict => ({
  title: String(proj?.title ?? proj?.name ?? ''),
  okrs: Array.isArray(proj?.okrs) ? proj.okrs.map(toStrictOKR) : [],
});

// OKRを一意に指す軽量ID（DB主キーではなく"ログ紐づけ用キー"）
const okrKey = (d: number, p: number, o: number, okr?: any) => {
  if (okr && typeof okr.id === 'string' && okr.id.trim()) {
    return okr.id;
  }
  // Fallback only - should be rare after Step 1
  if (process.env.NODE_ENV === 'development') {
    console.warn('[okrKey] Using index fallback for okr:', { d, p, o });
  }
  return `okr-${d}-${p}-${o}`;
};

/** [object Object] を防ぐ：ストーリーが「章オブジェクト配列」でも「文字列」でも描画できるようにする */
const normalizeStoryToText = (input: any): string => {
  if (!input) return '';
  if (typeof input === 'string') return input;

  if (Array.isArray(input)) {
    return input
      .map((x) => {
        if (!x) return '';
        if (typeof x === 'string') return x;

        const title = String(x.title ?? x.chapterTitle ?? x.heading ?? x.name ?? '').trim();
        const body = x.body ?? x.content ?? x.text ?? x.summary ?? x.value ?? '';

        const bodyText =
          typeof body === 'string'
            ? body
            : Array.isArray(body)
              ? body.filter(Boolean).join('\n')
              : body
                ? String(body)
                : '';

        const t = title ? `## ${title}\n` : '';
        return (t + bodyText).trim();
      })
      .filter((s) => s.trim())
      .join('\n\n');
  }

  if (typeof input === 'object') {
    const title = String(input.title ?? input.chapterTitle ?? input.heading ?? input.name ?? '').trim();
    const body = input.body ?? input.content ?? input.text ?? input.summary ?? input.value ?? '';
    const bodyText =
      typeof body === 'string'
        ? body
        : Array.isArray(body)
          ? body.filter(Boolean).join('\n')
          : body
            ? String(body)
            : '';
    return `${title ? `## ${title}\n` : ''}${bodyText}`.trim();
  }

  return String(input);
};

/* =========================
 * progress_logs ロード用型（content 版）
 * ======================= */
type LogRow = {
  id?: string;
  created_at?: string;
  content?: string | null;
  score?: number | null;
  status?: string | null;
};

/* =========================
 * 共通：モーダルシェル（Agent Dock 干渉対策込み）
 * ======================= */
function ModalShell(props: {
  open: boolean;
  title: string;
  subtitle?: string;
  icon?: ReactNode;
  width?: string; // CSS width value
  onClose: () => void;
  children: ReactNode;
}) {
  const { open, title, subtitle, icon, width, onClose, children } = props;

  // Agent Dock 右スペースとの干渉対策
  const [agentDockPx, setAgentDockPx] = useState(0);
  useEffect(() => {
    const readVar = () => {
      const v = getComputedStyle(document.documentElement).getPropertyValue('--agent-dock-w').trim();
      const m = v.match(/(\d+(?:\.\d+)?)\s*px/i);
      setAgentDockPx(m ? Number(m[1]) : 0);
    };
    readVar();
    window.addEventListener('resize', readVar);
    const ro = 'ResizeObserver' in window ? new ResizeObserver(readVar) : null;
    ro?.observe(document.documentElement);
    return () => {
      window.removeEventListener('resize', readVar);
      ro?.disconnect();
    };
  }, []);

  if (!open) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed top-0 left-0 bottom-0 right-0 z-40 bg-black/25 backdrop-blur-sm"
        style={{ paddingRight: agentDockPx }}
        onClick={onClose}
      />
      {/* Modal */}
      <div
        role="dialog"
        aria-modal="true"
        className="fixed z-50 overflow-hidden rounded-3xl border border-black/10 bg-white/92 shadow-2xl backdrop-blur-xl"
        style={{
          width: width ?? 'clamp(560px, 60vw, 980px)',
          maxHeight: '88vh',
          left: `calc(50% - ${agentDockPx / 2}px)`,
          top: '50%',
          transform: 'translate(-50%, -50%)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-black/10 bg-white/80 px-6 py-4 backdrop-blur-xl">
          <div className="flex items-center gap-3">
            <div className="grid h-9 w-9 place-items-center rounded-2xl border border-black/10 bg-white shadow-sm">
              {icon}
            </div>
            <div className="space-y-0.5">
              <div className="text-[11px] text-gray-500 tracking-wide">{subtitle ?? ''}</div>
              <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-2xl border border-black/10 bg-white px-2 py-2 text-gray-700 hover:bg-gray-50"
            type="button"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="max-h-[calc(88vh-64px)] overflow-y-auto">{children}</div>
      </div>
    </>
  );
}

/* =========================
 * ExecPanel（実行支援モーダル）
 * ======================= */
function ExecPanel(props: {
  open: boolean;
  onClose: () => void;
  userId?: string;
  deptName: string;
  projectTitle: string;
  objective: string;
  keyResults: string[];
  okrId: string;
  companyId?: string;
  krIds?: string[];
}) {
  const { open, onClose, userId, deptName, projectTitle, objective, keyResults, okrId, companyId, krIds } = props;

  const access = useAccess();
  const canCheckin = !!userId;
  const canFeedback = access.canEditCompany();

  const [tab, setTab] = useState<'checkin' | 'feedback'>('checkin');
  const [progressText, setProgressText] = useState('');
  const [rating, setRating] = useState<number>(0);
  const [helpRequest, setHelpRequest] = useState('');

  const [reviewScore, setReviewScore] = useState<number>(0);
  const [reviewText, setReviewText] = useState('');

  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string>('');
  const [logs, setLogs] = useState<LogRow[]>([]);
  const [loadingLogs, setLoadingLogs] = useState<boolean>(false);

  // 履歴ロード（content / score / status 版）
  useEffect(() => {
    const loadLogs = async () => {
      if (!open || !userId || !okrId) return;
      setLoadingLogs(true);
      try {
        const { data, error } = await supabase
          .from('progress_logs')
          .select('id, created_at, content, score, status')
          .eq('user_id', userId)
          .eq('okr_id', okrId)
          .order('created_at', { ascending: false })
          .limit(50);

        if (error) console.warn('load progress_logs error:', error);
        if (Array.isArray(data)) setLogs(data as LogRow[]);
      } finally {
        setLoadingLogs(false);
      }
    };
    loadLogs();
  }, [open, userId, okrId]);

  // 保存（チェックイン）
  const onSaveCheckin = useCallback(async () => {
    if (!canCheckin || !userId) {
      setNotice('⚠️ ログイン中のみ保存できます。');
      return;
    }
    if (!progressText.trim() && !helpRequest.trim() && !rating) {
      setNotice('⚠️ いずれかを入力してください。');
      return;
    }
    setSaving(true);
    setNotice('');
    try {
      const composed = helpRequest.trim()
        ? `${progressText.trim()}\n\n--- Help ---\n${helpRequest.trim()}`
        : progressText.trim();

      const metadata = buildProgressLogMetadata({
        companyId: companyId ?? 'unknown',
        deptName: deptName ?? '未名',
        projectTitle: projectTitle ?? '未名',
        okrId,
        krIds,
      });

      const { error } = await saveProgressLog({
        userId,
        okrId,
        content: embedMetadata(metadata, composed),
        score: rating || null,
      });
      if (error) throw error;

      setNotice('✅ 記録しました');
      const nowIso = new Date().toISOString();
      setLogs((prev) => [
        { id: 'local-' + nowIso, created_at: nowIso, content: composed, score: rating || null, status: null },
        ...prev,
      ]);
      setProgressText('');
      setHelpRequest('');
      setRating(0);
    } catch (e: any) {
      setNotice('❌ 保存に失敗しました');
      console.warn('save log error', e?.message || e);
    } finally {
      setSaving(false);
      setTimeout(() => setNotice(''), 2000);
    }
  }, [canCheckin, userId, okrId, progressText, rating, helpRequest]);

  // 保存（フィードバック）
  const onSaveFeedback = useCallback(async () => {
    if (!canFeedback || !userId) {
      setNotice('⚠️ 会社管理権限（Admin/Manager）が必要です。');
      return;
    }
    if (!reviewText.trim() && !reviewScore) {
      setNotice('⚠️ いずれかを入力してください。');
      return;
    }
    setSaving(true);
    setNotice('');
    try {
      const fbContent = `[FB]\n${reviewText.trim()}`;

      const metadata = buildProgressLogMetadata({
        companyId: companyId ?? 'unknown',
        deptName: deptName ?? '未名',
        projectTitle: projectTitle ?? '未名',
        okrId,
        krIds,
      });

      const { error } = await saveProgressLog({
        userId,
        okrId,
        content: embedMetadata(metadata, fbContent),
        score: reviewScore || null,
      });
      if (error) throw error;

      setNotice('✅ フィードバックを保存しました');
      const nowIso = new Date().toISOString();
      setLogs((prev) => [
        { id: 'local-' + nowIso, created_at: nowIso, content: fbContent, score: reviewScore || null, status: null },
        ...prev,
      ]);
      setReviewText('');
      setReviewScore(0);
    } catch (e: any) {
      setNotice('❌ 保存に失敗しました');
      console.warn('save feedback error', e?.message || e);
    } finally {
      setSaving(false);
      setTimeout(() => setNotice(''), 2000);
    }
  }, [canFeedback, userId, okrId, reviewText, reviewScore]);

  const StarInput = ({ value, onChange }: { value: number; onChange: (n: number) => void }) => (
    <div className="flex items-center gap-1">
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          onClick={() => onChange(n === value ? 0 : n)}
          className={`rounded p-1 transition-colors ${value >= n ? 'text-amber-500' : 'text-gray-300'} hover:text-amber-600`}
          type="button"
        >
          <Stars className="h-5 w-5" />
        </button>
      ))}
    </div>
  );

  const isFeedback = (row: LogRow) => (row.content || '').startsWith('[FB]');
  const feedbackBody = (row: LogRow) => (row.content || '').replace(/^\[FB]\s*\n?/, '').trim();

  // チェックイン時の「支援依頼」分離表示
  const splitContent = (content: string | null | undefined) => {
    if (!content) return { memo: '', help: '' };
    const [memoPart, helpPart] = content.split('\n\n--- Help ---\n');
    return { memo: (memoPart || '').trim(), help: (helpPart || '').trim() };
  };

  return (
    <ModalShell
      open={open}
      onClose={onClose}
      title="実行支援"
      subtitle={`${deptName} / ${projectTitle}`}
      icon={<CheckCircle2 className="h-5 w-5 text-gray-800" />}
      width="clamp(560px, 60vw, 980px)"
    >
      {/* Tabs */}
      <div className="px-6 pt-5">
        <div className="inline-flex rounded-2xl border border-black/10 bg-white p-1 shadow-sm">
          <button
            className={`px-3 py-1.5 text-sm rounded-xl transition ${
              tab === 'checkin' ? 'bg-gray-900 text-white' : 'text-gray-800 hover:bg-gray-100'
            }`}
            onClick={() => setTab('checkin')}
            type="button"
          >
            チェックイン
          </button>
          <button
            className={`px-3 py-1.5 text-sm rounded-xl transition ${
              tab === 'feedback' ? 'bg-gray-900 text-white' : 'text-gray-800 hover:bg-gray-100'
            }`}
            onClick={() => setTab('feedback')}
            type="button"
          >
            フィードバック
          </button>
        </div>
      </div>

      <div className="space-y-6 p-6">
        {/* OKR概要 */}
        <section className="rounded-3xl border border-black/10 bg-white/70 p-5 shadow-sm">
          <div className="text-xs font-medium text-gray-600 tracking-wide mb-1">達成目標（O）</div>
          <div className="whitespace-pre-wrap text-[15px]">{objective || '（未設定）'}</div>
          {keyResults?.length ? (
            <>
              <div className="mt-4 text-xs font-medium text-gray-600 tracking-wide">主要な成果（KR）</div>
              <ul className="mt-2 list-disc pl-5 text-sm text-gray-800 space-y-1">
                {keyResults.map((k, i) => (
                  <li key={i}>{k}</li>
                ))}
              </ul>
            </>
          ) : null}
        </section>

        {/* チェックイン */}
        {tab === 'checkin' && (
          <>
            <section className="rounded-3xl border border-black/10 bg-white/70 p-5 shadow-sm">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-sm font-semibold tracking-tight">進捗メモ</h3>
                <StarInput value={rating} onChange={setRating} />
              </div>
              <textarea
                className="h-28 w-full rounded-2xl border border-black/10 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-black/10"
                placeholder="例：KR#1 が 60% 達成。◯◯の承認待ち。"
                value={progressText}
                onChange={(e) => setProgressText(e.target.value)}
              />
              <div className="mt-4">
                <label className="mb-1 block text-xs text-gray-600">支援依頼（任意）</label>
                <textarea
                  className="h-20 w-full rounded-2xl border border-black/10 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-black/10"
                  placeholder="例：決裁者向け1枚資料のレビューを依頼。"
                  value={helpRequest}
                  onChange={(e) => setHelpRequest(e.target.value)}
                />
              </div>
            </section>
            <section className="flex items-center gap-3">
              <button
                onClick={onSaveCheckin}
                disabled={saving || !userId}
                className="inline-flex items-center gap-2 rounded-2xl bg-gray-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-black/90 disabled:bg-gray-300 shadow-sm"
                type="button"
              >
                <Send className="h-4 w-4" />
                {saving ? '保存中…' : '保存'}
              </button>
              {notice && <span className="text-sm text-gray-700">{notice}</span>}
            </section>
          </>
        )}

        {/* フィードバック */}
        {tab === 'feedback' && (
          <>
            <section className="rounded-3xl border border-black/10 bg-white/70 p-5 shadow-sm">
              <div className="mb-3 flex items-center justify-between">
                <div className="text-sm font-semibold tracking-tight">フィードバック</div>
                <StarInput value={reviewScore} onChange={setReviewScore} />
              </div>
              <textarea
                className="h-28 w-full rounded-2xl border border-black/10 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-black/10"
                placeholder="例：KR#2 の指標定義を明確化すると計測が安定します。"
                value={reviewText}
                onChange={(e) => setReviewText(e.target.value)}
              />
            </section>
            <section className="flex items-center gap-3">
              <button
                onClick={onSaveFeedback}
                disabled={saving || !userId}
                className="inline-flex items-center gap-2 rounded-2xl bg-gray-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-black/90 disabled:bg-gray-300 shadow-sm"
                type="button"
              >
                <Send className="h-4 w-4" />
                {saving ? '保存中…' : '保存'}
              </button>
              {notice && <span className="text-sm text-gray-700">{notice}</span>}
            </section>
          </>
        )}

        {/* 履歴 */}
        <section className="rounded-3xl border border-black/10 bg-white/70 shadow-sm overflow-hidden">
          <div className="flex items-center gap-2 border-b border-black/10 px-5 py-4 bg-white/70">
            <Clock className="h-4 w-4 text-gray-600" />
            <h3 className="text-sm font-semibold tracking-tight">履歴</h3>
          </div>
          {loadingLogs ? (
            <div className="px-5 py-5 text-sm text-gray-600">読み込み中…</div>
          ) : logs.length === 0 ? (
            <div className="px-5 py-5 text-sm text-gray-600">まだ履歴がありません。</div>
          ) : (
            <ul className="divide-y divide-black/5">
              {logs.map((row, i) => {
                const when = row.created_at ? new Date(row.created_at).toLocaleString() : '';
                const fb = (row.content || '').startsWith('[FB]');
                const body = fb ? feedbackBody(row) : (row.content ?? '');
                const { memo, help } = splitContent(row.content ?? '');
                const score = typeof row.score === 'number' ? row.score : null;

                return (
                  <li key={row.id ?? i} className="px-5 py-4">
                    <div className="mb-2 flex items-center justify-between">
                      <div className="text-xs text-gray-500">{when}</div>
                      <div className="flex items-center gap-2 text-xs text-gray-700">
                        {score && score > 0 && (
                          <span className="inline-flex items-center gap-1">
                            <Stars className="h-3 w-3 text-amber-600" />
                            {score}
                          </span>
                        )}
                        <span className="rounded-full bg-gray-100 px-2 py-0.5">{fb ? 'FB' : 'メモ'}</span>
                      </div>
                    </div>
                    {fb ? (
                      <div className="rounded-2xl bg-gray-50 p-3 text-sm text-gray-900 whitespace-pre-wrap">{body}</div>
                    ) : (
                      <>
                        {memo && <div className="text-[15px] text-gray-900 whitespace-pre-wrap">{memo}</div>}
                        {help && (
                          <div className="mt-2 rounded-2xl bg-gray-50 p-3 text-sm text-gray-800 whitespace-pre-wrap">
                            {help}
                          </div>
                        )}
                      </>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <div className="pb-8" />
      </div>
    </ModalShell>
  );
}

/* =========================
 * ピラミッド（線でつなぐ）表示
 * ======================= */
type Box = { x: number; y: number; w: number; h: number };
const centerY = (b: Box) => b.y + b.h / 2;
const rightX = (b: Box) => b.x + b.w;
const leftX = (b: Box) => b.x;

function makeElbowPath(from: { x: number; y: number }, to: { x: number; y: number }) {
  const midX = (from.x + to.x) / 2;
  return `M ${from.x} ${from.y} L ${midX} ${from.y} L ${midX} ${to.y} L ${to.x} ${to.y}`;
}

function clampText(s: string, max = 34) {
  const t = (s ?? '').trim();
  if (t.length <= max) return t;
  return t.slice(0, max - 1) + '…';
}

/* =========================
 * ページ本体
 * ======================= */
export default function ExecutionPage() {
  const { departments, editableCascadeResult } = useStrategyStore() as any;
  const { companyId: scopeCompanyId, hydrated, setCompanyScope } = useStrategyStore();

  const access = useAccess();
  const accessCompanyId: string | undefined =
    (access as any)?.companyId ?? (useStrategyStore.getState().companyId as string | undefined);

  useEffect(() => {
    if (!accessCompanyId) return;
    if (scopeCompanyId && scopeCompanyId !== accessCompanyId) {
      hardResetForCompanySwitch(accessCompanyId);
    } else {
      setCompanyScope(accessCompanyId);
    }
  }, [accessCompanyId, scopeCompanyId, setCompanyScope]);

  useEffect(() => {
    if (!accessCompanyId) return;
    let cancelled = false;
    const run = async () => {
      if (hydrated && scopeCompanyId === accessCompanyId) return;
      try {
        if (DEBUG) console.log('[execution] 📥 loadAndHydrate 開始', { accessCompanyId });
        await loadAndHydrate(accessCompanyId);
        if (DEBUG) console.log('[execution] ✅ loadAndHydrate 完了');
      } catch (err) {
        const errObj = err as any;
        console.error('[execution] ❌ loadAndHydrate error:', {
          message: errObj?.message || String(err),
          code: errObj?.code,
        });
      } finally {
        if (!cancelled) {
          if (DEBUG) console.log('[execution] 🏁 loadAndHydrate effect 終了');
        }
      }
    };
    run();
    return () => {
      cancelled = true;
    };
  }, [accessCompanyId, hydrated, scopeCompanyId]);

  useAutoSave([scopeCompanyId]);
  const user = useUserStore((s) => s.user);

  const cascade: Department[] = useMemo(() => {
    const base: Department[] = Array.isArray(departments) ? (departments as Department[]) : [];
    const alt: Department[] = Array.isArray(editableCascadeResult) ? (editableCascadeResult as Department[]) : [];

    if (base.length === 0) return alt;

    return base.map((d, i) => {
      const a = alt[i];
      return { ...d, name: d.name ?? a?.name, mission: d.mission ?? a?.mission, strategy: d.strategy ?? a?.strategy };
    });
  }, [editableCascadeResult, departments]);

  const isHydrating = !hydrated || scopeCompanyId !== accessCompanyId;

  // --- ストーリー（draft/edited/final）を安全に取り出す ---
  const storeAny = useStrategyStore() as any;
  const storyViewMode: 'draft' | 'edited' | 'final' = (storeAny?.storyViewMode as any) ?? 'draft';

  const storyBlocks = useMemo(() => {
    const draft = storeAny?.finalStoryDraft ?? storeAny?.finalStoryDraftRaw ?? storeAny?.finalStoryDraftBlocks;
    const edited = storeAny?.finalStoryEdited ?? storeAny?.finalStoryEditedRaw ?? storeAny?.finalStoryEditedBlocks;
    const fin = storeAny?.finalStoryFinal ?? storeAny?.finalStoryFinalRaw ?? storeAny?.finalStoryFinalBlocks;

    if (storyViewMode === 'edited') return edited ?? draft ?? fin ?? null;
    if (storyViewMode === 'final') return fin ?? draft ?? edited ?? null;
    return draft ?? edited ?? fin ?? null;
  }, [storeAny, storyViewMode]);

  const storyText = useMemo(() => normalizeStoryToText(storyBlocks), [storyBlocks]);

  // ===== ピラミッド表示用のデータ（部門 -> プロジェクト）=====
  const pyramid = useMemo(() => {
    return cascade.map((dept, di) => {
      const tone = deptTone(di);
      const projects = (dept?.projects ?? []).map((proj: any, pi: number) => {
        const strictProj = toStrictProject(proj);
        const okrs = Array.isArray(proj?.okrs) ? proj.okrs : [];
        const okrsV2 = Array.isArray((proj as any)?.okrsV2) ? ((proj as any).okrsV2 as any[]) : [];
        const v2Labels = okrsV2.map((k) => String(k?.label ?? '')).filter(Boolean);

        // 実行支援で開く対象（基本は o=0）
        const oIndex = okrs.length > 0 ? 0 : 0;
        const okr = okrs[oIndex];
        const strictO = okr ? toStrictOKR(okr) : null;

        let objective = '';
        let keyResults: string[] = [];

        if (strictO) {
          objective = strictO.objective || (v2Labels.length ? '構造化KRに基づく実行（自動生成）' : '');
          keyResults = [...strictO.keyResults];
        } else if (v2Labels.length) {
          objective = '構造化KRに基づく実行（自動生成）';
          keyResults = [];
        } else {
          objective = '';
          keyResults = [];
        }

        if (v2Labels.length) keyResults = [...keyResults, ...v2Labels];

        return {
          di,
          pi,
          oi: oIndex,
          tone,
          deptName: dept?.name ?? '',
          mission: dept?.mission ?? '',
          title: strictProj.title,
          okrCount: okrs.length > 0 ? okrs.length : v2Labels.length > 0 ? 1 : 0,
          selection: {
            deptName: dept?.name ?? '',
            projectTitle: strictProj.title,
            objective,
            keyResults,
            okrId: okrKey(di, pi, oIndex, okr ?? { id: undefined }),
          },
          projForCard: { ...(proj as any), title: strictProj.title },
        };
      });

      return {
        di,
        tone,
        deptName: dept?.name ?? '',
        mission: dept?.mission ?? '',
        projects,
      };
    });
  }, [cascade]);

  // ===== 選択（実行支援：OKR）=====
  const [selected, setSelected] = useState<{
    deptName: string;
    projectTitle: string;
    objective: string;
    keyResults: string[];
    okrId: string;
    companyId?: string;
    krIds?: string[];
  } | null>(null);

  // モーダル：ストーリー / 部門
  const [storyOpen, setStoryOpen] = useState(false);
  const [deptOpen, setDeptOpen] = useState<{ open: boolean; di: number | null }>({ open: false, di: null });

  const deptModalData = useMemo(() => {
    if (!deptOpen.open || deptOpen.di == null) return null;
    const row = pyramid.find((x) => x.di === deptOpen.di);
    if (!row) return null;
    return row;
  }, [deptOpen, pyramid]);

  // ===== 線描画（SVG）=====
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const storyRef = useRef<HTMLButtonElement | null>(null);
  const deptRefs = useRef<Record<number, HTMLButtonElement | null>>({});
  const projRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  const [boxes, setBoxes] = useState<{
    story?: Box;
    depts: Record<number, Box>;
    projs: Record<string, Box>;
    w: number;
    h: number;
  }>({ depts: {}, projs: {}, w: 0, h: 0 });

  const recomputeLines = useCallback(() => {
    const root = canvasRef.current;
    if (!root) return;

    const rootRect = root.getBoundingClientRect();
    const sx = root.scrollLeft;
    const sy = root.scrollTop;

    const toBox = (el: HTMLElement | null): Box | null => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return {
        x: r.left - rootRect.left + sx,
        y: r.top - rootRect.top + sy,
        w: r.width,
        h: r.height,
      };
    };

    const storyBox = toBox(storyRef.current);
    const deptBoxes: Record<number, Box> = {};
    for (const k of Object.keys(deptRefs.current)) {
      const di = Number(k);
      const b = toBox(deptRefs.current[di]);
      if (b) deptBoxes[di] = b;
    }

    const projBoxes: Record<string, Box> = {};
    for (const k of Object.keys(projRefs.current)) {
      const b = toBox(projRefs.current[k]);
      if (b) projBoxes[k] = b;
    }

    setBoxes({
      story: storyBox ?? undefined,
      depts: deptBoxes,
      projs: projBoxes,
      w: Math.max(root.scrollWidth, root.clientWidth),
      h: Math.max(root.scrollHeight, root.clientHeight),
    });
  }, []);

  useEffect(() => {
    recomputeLines();
  }, [recomputeLines, pyramid.length]);

  useEffect(() => {
    const root = canvasRef.current;
    if (!root) return;

    const onScroll = () => recomputeLines();
    root.addEventListener('scroll', onScroll, { passive: true });

    const ro = 'ResizeObserver' in window ? new ResizeObserver(() => recomputeLines()) : null;
    ro?.observe(root);

    const onWin = () => recomputeLines();
    window.addEventListener('resize', onWin);

    return () => {
      root.removeEventListener('scroll', onScroll as any);
      ro?.disconnect();
      window.removeEventListener('resize', onWin);
    };
  }, [recomputeLines]);

  // ===== モバイルは簡易（既存カードを流用）=====
  const mobileCards = useMemo(() => {
    const items: JSX.Element[] = [];
    cascade.forEach((dept, di) => {
      (dept?.projects ?? []).forEach((proj: any, pi: number) => {
        const strictProj = toStrictProject(proj);
        const okrs = Array.isArray(proj?.okrs) ? proj.okrs : [];
        const okrsV2 = Array.isArray((proj as any)?.okrsV2) ? ((proj as any).okrsV2 as any[]) : [];
        const projForCard = { ...(proj as any), title: strictProj.title };

        if (okrs.length > 0) {
          okrs.forEach((okr: any, oi: number) => {
            items.push(
              <ProjectCard
                key={`${dept?.name ?? 'dept'}-${strictProj.title}-okr-${oi}`}
                deptName={dept?.name ?? ''}
                project={projForCard as any}
                onClick={() => {
                  if (isHydrating) return;
                  const strictO = toStrictOKR(okr);
                  setSelected({
                    deptName: dept?.name ?? '',
                    projectTitle: strictProj.title,
                    objective: strictO.objective,
                    keyResults: strictO.keyResults,
                    okrId: okrKey(di, pi, oi, okr),
                    companyId: scopeCompanyId,
                    krIds: [],
                  });
                }}
              />,
            );
          });
          return;
        }

        if (okrsV2.length > 0) {
          items.push(
            <ProjectCard
              key={`${dept?.name ?? 'dept'}-${strictProj.title}-v2`}
              deptName={dept?.name ?? ''}
              project={projForCard as any}
              onClick={() => {
                if (isHydrating) return;
                setSelected({
                  deptName: dept?.name ?? '',
                  projectTitle: strictProj.title,
                  objective: '構造化KRに基づく実行（自動生成）',
                  keyResults: okrsV2.map((k: any) => String(k?.label ?? '')).filter(Boolean),
                  okrId: okrKey(di, pi, 0, { id: undefined }),
                  companyId: scopeCompanyId,
                  krIds: okrsV2.map((k: any) => k.id).filter(Boolean),
                });
              }}
            />,
          );
          return;
        }

        items.push(
          <ProjectCard key={`${dept?.name ?? 'dept'}-${strictProj.title}-no-okr`} deptName={dept?.name ?? ''} project={projForCard as any} onClick={() => {}} />,
        );
      });
    });
    return items;
  }, [cascade, isHydrating]);

  return (
    <main className="min-h-screen bg-gray-50 avoid-agent-dock">
      {/* Header */}
      <div className="bg-white/90 border-b border-black/10 sticky top-0 z-20 backdrop-blur-xl">
        <div className="px-6 py-4 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">STAGE5 実行計画支援</h1>
            <div className="mt-1 text-xs text-gray-500">画面は「名称（要約）」のみ表示。詳細はクリックでモーダル表示。</div>
            {isHydrating && <div className="mt-2 text-sm text-gray-500">サーバーのデータを読み込み中です…</div>}
          </div>
          {selected ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-3 py-1 text-xs font-medium text-gray-800">
              <CheckCircle2 className="h-3 w-3" />
              実行支援を表示中
            </span>
          ) : null}
        </div>
      </div>

      {/* モバイル */}
      <div className="md:hidden -mx-6 px-6 pt-6">
        <div className="flex gap-4 overflow-x-auto pb-2 snap-x snap-mandatory">
          {mobileCards.length ? (
            mobileCards.map((el, i) => (
              <div key={`m-${i}`} className="min-w-[300px] max-w-[360px] shrink-0 snap-start">
                {el}
              </div>
            ))
          ) : (
            !isHydrating && <div className="text-sm text-gray-600">表示できる実行計画がありません。</div>
          )}
        </div>
      </div>

      {/* md以上：横ピラミッド（線接続） */}
      <div className="hidden md:block p-6">
        <div
          ref={canvasRef}
          className="relative h-[calc(100vh-92px)] overflow-auto rounded-3xl border border-black/10 bg-white shadow-sm"
        >
          {/* SVG lines (under content) */}
          <svg
            className="absolute left-0 top-0 z-0 pointer-events-none"
            width={boxes.w}
            height={boxes.h}
            viewBox={`0 0 ${boxes.w} ${boxes.h}`}
          >
            {/* story -> dept */}
            {boxes.story
              ? Object.entries(boxes.depts).map(([k, db]) => {
                  const di = Number(k);
                  const tone = deptTone(di);
                  const from = { x: rightX(boxes.story!), y: centerY(boxes.story!) };
                  const to = { x: leftX(db), y: centerY(db) };
                  return (
                    <path
                      key={`s-d-${di}`}
                      d={makeElbowPath(from, to)}
                      className={`${toneToStroke(tone)} `}
                      strokeWidth={2}
                      fill="none"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      opacity={0.9}
                    />
                  );
                })
              : null}

            {/* dept -> proj */}
            {Object.entries(boxes.projs).map(([key, pb]) => {
              // key = `${di}:${pi}`
              const [diStr] = key.split(':');
              const di = Number(diStr);
              const db = boxes.depts[di];
              if (!db) return null;
              const tone = deptTone(di);
              const from = { x: rightX(db), y: centerY(db) };
              const to = { x: leftX(pb), y: centerY(pb) };
              return (
                <path
                  key={`d-p-${key}`}
                  d={makeElbowPath(from, to)}
                  className={`${toneToStroke(tone)} `}
                  strokeWidth={2}
                  fill="none"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  opacity={0.75}
                />
              );
            })}
          </svg>

          {/* Content */}
          <div className="relative z-10 min-w-[980px] p-8">
            <div className="flex items-start gap-10">
              {/* Story node */}
              <button
                ref={storyRef}
                type="button"
                onClick={() => setStoryOpen(true)}
                className={`w-[280px] rounded-3xl border border-black/10 ${toneToTint(storyTone)} px-5 py-5 text-left shadow-sm hover:shadow-md transition`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <div className="grid h-9 w-9 place-items-center rounded-2xl border border-black/10 bg-white shadow-sm">
                      <BookOpen className="h-5 w-5 text-gray-800" />
                    </div>
                    <div>
                      <div className="text-xs font-semibold text-gray-700 tracking-wide">経営戦略ストーリー</div>
                      <div className="text-[11px] text-gray-500 mt-0.5">クリックで全文</div>
                    </div>
                  </div>
                  <div className="inline-flex rounded-full border border-black/10 bg-white px-2 py-1 text-[11px] text-gray-600 shadow-sm">
                    {storyViewMode?.toUpperCase?.() ?? 'DRAFT'}
                  </div>
                </div>

                <div className="mt-4 rounded-2xl bg-white/70 border border-black/5 px-3 py-3">
                  <div className="text-[11px] text-gray-500 mb-1">要約</div>
                  <div className="text-sm text-gray-900 leading-relaxed">
                    {storyText?.trim() ? clampText(storyText.replace(/\s+/g, ' '), 64) : '（ストーリー未生成）'}
                  </div>
                </div>

                <div className="mt-3 text-[11px] text-gray-500">
                  ※ 画面は要約のみ。本文・章構造はモーダルで確認。
                </div>
              </button>

              {/* Dept + Projects */}
              <div className="flex-1 space-y-10 pb-10">
                {pyramid.length ? (
                  pyramid.map((dept) => {
                    const tone = dept.tone;
                    const dot = toneToDot(tone);

                    return (
                      <div key={dept.di} className="flex items-start gap-10">
                        {/* Dept node */}
                        <button
                          ref={(el) => {
                            deptRefs.current[dept.di] = el;
                          }}
                          type="button"
                          onClick={() => setDeptOpen({ open: true, di: dept.di })}
                          className={`w-[260px] rounded-3xl border border-black/10 ${toneToTint(tone)} px-5 py-5 text-left shadow-sm hover:shadow-md transition`}
                        >
                          <div className="flex items-center gap-2">
                            <span className={`h-2.5 w-2.5 rounded-full ${dot}`} />
                            <div className="text-sm font-semibold text-gray-900">
                              {dept.deptName?.trim() ? dept.deptName : '（部門名未設定）'}
                            </div>
                          </div>
                          <div className="mt-2 text-[11px] text-gray-600">
                            クリックでミッション/一覧
                          </div>
                        </button>

                        {/* Projects node list */}
                        <div className="flex-1">
                          <div className="text-xs font-semibold text-gray-500 tracking-wide mb-3">プロジェクト</div>
                          <div className="grid grid-cols-1 gap-3">
                            {dept.projects.length ? (
                              dept.projects.map((p) => {
                                const key = `${p.di}:${p.pi}`;
                                return (
                                  <button
                                    key={key}
                                    ref={(el) => {
                                      projRefs.current[key] = el;
                                    }}
                                    type="button"
                                    onClick={() => {
                                      if (isHydrating) return;
                                      // objective が空＝OKR無しの場合は部門モーダルへ誘導
                                      if (!p.selection.objective && (p.selection.keyResults?.length ?? 0) === 0) {
                                        setDeptOpen({ open: true, di: p.di });
                                        return;
                                      }
                                      setSelected(p.selection);
                                    }}
                                    className="rounded-2xl border border-black/10 bg-white px-4 py-3 text-left shadow-sm hover:bg-gray-50 hover:shadow-md transition"
                                  >
                                    <div className="flex items-center justify-between gap-3">
                                      <div className="text-sm font-semibold text-gray-900">{p.title || '（プロジェクト名未設定）'}</div>
                                      <div className="flex items-center gap-2">
                                        {p.okrCount > 0 && (
                                          <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] text-gray-700">
                                            OKR
                                          </span>
                                        )}
                                        <span className="text-[11px] text-gray-400">クリックで実行支援</span>
                                      </div>
                                    </div>
                                  </button>
                                );
                              })
                            ) : (
                              <div className="text-sm text-gray-500">プロジェクトがありません。</div>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })
                ) : (
                  !isHydrating && <div className="text-sm text-gray-600">部門がありません。</div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ストーリー：モーダル（本文） */}
      <ModalShell
        open={storyOpen}
        onClose={() => setStoryOpen(false)}
        title="経営戦略ストーリー"
        subtitle="Stage2 最終ストーリー（Draft/Edited/Final）"
        icon={<BookOpen className="h-5 w-5 text-gray-800" />}
        width="clamp(720px, 70vw, 1100px)"
      >
        <div className="p-6 space-y-4">
          <div className="rounded-3xl border border-black/10 bg-white/70 p-5 shadow-sm">
            <div className="text-xs font-semibold text-gray-500 tracking-wide mb-2">本文</div>
            <div className="whitespace-pre-wrap text-sm leading-relaxed text-gray-900">
              {storyText?.trim() ? storyText : '（ストーリー未生成 / 未設定）'}
            </div>
          </div>
          <div className="text-[11px] text-gray-500">
            ※ もしここが空なら、Stage2 側で最終ストーリー（draft/edited/final）の保存が行われているかを確認してください。
          </div>
        </div>
      </ModalShell>

      {/* 部門：モーダル（ミッション＋プロジェクト一覧） */}
      <ModalShell
        open={!!deptModalData}
        onClose={() => setDeptOpen({ open: false, di: null })}
        title="部門ミッション"
        subtitle={deptModalData?.deptName ?? ''}
        icon={<Building2 className="h-5 w-5 text-gray-800" />}
        width="clamp(640px, 58vw, 980px)"
      >
        <div className="p-6 space-y-5">
          <section className="rounded-3xl border border-black/10 bg-white/70 p-5 shadow-sm">
            <div className="text-xs font-semibold text-gray-500 tracking-wide mb-2">ミッション</div>
            <div className="text-sm text-gray-900 whitespace-pre-wrap leading-relaxed">
              {deptModalData?.mission?.trim() ? deptModalData.mission : '（ミッション未設定）'}
            </div>
          </section>

          <section className="rounded-3xl border border-black/10 bg-white/70 p-5 shadow-sm">
            <div className="text-xs font-semibold text-gray-500 tracking-wide mb-3">プロジェクト</div>
            <div className="grid grid-cols-1 gap-3">
              {deptModalData?.projects?.length ? (
                deptModalData.projects.map((p) => (
                  <button
                    key={`${p.di}:${p.pi}:modal`}
                    type="button"
                    onClick={() => {
                      if (isHydrating) return;
                      if (!p.selection.objective && (p.selection.keyResults?.length ?? 0) === 0) return;
                      setDeptOpen({ open: false, di: null });
                      setSelected(p.selection);
                    }}
                    className="rounded-2xl border border-black/10 bg-white hover:bg-gray-50 p-4 text-left shadow-sm transition"
                  >
                    <div className="text-sm font-semibold text-gray-900">{String(p.title ?? '（無題）')}</div>
                    <div className="text-xs text-gray-500 mt-1">
                      {p.selection.objective || (p.selection.keyResults?.length ?? 0) > 0 ? 'クリックで「実行支援」' : 'OKR未設定'}
                    </div>
                  </button>
                ))
              ) : (
                <div className="text-sm text-gray-600">プロジェクトがありません。</div>
              )}
            </div>
          </section>
        </div>
      </ModalShell>

      {/* 実行支援：モーダル */}
      <ExecPanel
        open={!!selected}
        onClose={() => setSelected(null)}
        userId={user?.id}
        deptName={selected?.deptName ?? ''}
        projectTitle={selected?.projectTitle ?? ''}
        objective={selected?.objective ?? ''}
        keyResults={selected?.keyResults ?? []}
        okrId={selected?.okrId ?? ''}
        companyId={selected?.companyId ?? ''}
        krIds={selected?.krIds ?? []}
      />
    </main>
  );
}
