// /components/pages/StrategyClient.tsx
'use client';

import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import Step1BasicInfo from '@/components/steps/Step1BasicInfo';
import Step2Portfolio from '@/components/steps/Step2Portfolio';
import Step2SWOT from '@/components/steps/Step2SWOT';
import Step3FinanceUpload from '@/components/steps/Step3FinanceUpload';
import Step4MVV from '@/components/steps/Step4MVV';
import Step5Confirm from '@/components/steps/Step5Confirm';
import { useStrategyStore, refetchFromServer as refetchStrategy } from '@/store/strategyStore';
import { useAccess } from '@/utils/access';
import { useUserStore } from '@/store/userStore';
import { useAutoSave } from '@/hooks/useAutoSave';

/**
 * StrategyClient
 * - 保存安全化:
 *   - finalStory は autosave 対象から除外（StoryProcess 側の即時保存が正）
 *   - hydrated 完了かつ cooldown 後のみ autosave を有効化
 *   - 主要配列が全て空なら autosave をスキップ
 * - 初回 refetch と autosave のレースを回避
 */

/* ==========
 * 安定 stringify（大きなオブジェクトの差分比較用）
 * ========= */
function stableSig(v: unknown): string {
  try {
    return JSON.stringify(v, (k, val) => (val instanceof Date ? val.toISOString() : val));
  } catch {
    return '';
  }
}
const nonEmptyArray = (a: unknown) => Array.isArray(a) && a.length > 0;

export default function StrategyClient() {
  /* ===== フックは無条件に先頭で呼ぶ ===== */
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const metas = [
    { title: 'STEP 1：経営基本情報', subtitle: '企業規模・業種・体制などの基本情報' },
    { title: 'STEP 2：事業ポートフォリオ', subtitle: '成長率 × 利益率 × 構成比で可視化' },
    { title: 'STEP 3：SWOT分析', subtitle: '強み・弱み・機会・脅威を整理' },
    { title: 'STEP 4：財務データ', subtitle: 'CSVで売上・利益・継続率などを可視化' },
    { title: 'STEP 5：MVV', subtitle: 'Mission / Vision / Value' },
    { title: 'STEP 6：確認・送信', subtitle: '入力内容の最終チェック' },
  ] as const;

  const [step, setStep] = useState<number>(1);
  const totalSteps = metas.length;
  const meta = metas[step - 1];

  // ✅ 主要領域のみ subscribe（finalStory は autosave 対象から外す）
  const story        = useStrategyStore((s) => s.story);
  const answers2     = useStrategyStore((s) => s.answers2);
  const departments  = useStrategyStore((s) => s.departments);
  const setCompanyScope = useStrategyStore((s) => s.setCompanyScope);

  const { canView, canEditCompany } = useAccess();
  const canEdit = canEditCompany();

  // 会社/ユーザー
  const companyId = useUserStore((s) => s.companyId);
  const userId = useUserStore((s) => s.user?.id ?? null);

  // 初回同期ガード
  const [hydrated, setHydrated] = useState(false);
  const [loading, setLoading] = useState(false);
  const fetchedFor = useRef<string | null>(null);

  // 初回 refetch → autosave のレース回避用クールダウン
  const [readyToAutosave, setReadyToAutosave] = useState(false);
  useEffect(() => {
    if (!hydrated) return;
    const t = setTimeout(() => setReadyToAutosave(true), 600); // 600ms クールダウン
    return () => clearTimeout(t);
  }, [hydrated]);

  // ★ 初期ロード（依存から hydrated を外す -> 二重実行抑止）
  useEffect(() => {
    let aborted = false;

    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

    const run = async () => {
      // companyId 未確定でも UI は開ける（閲覧モード想定）
      if (!companyId) {
        if (!aborted) {
          setHydrated(true);
          setLoading(false);
        }
        return;
      }

      // 同一 companyId への二重ロード抑止
      if (fetchedFor.current === companyId) {
        if (!aborted && !hydrated) setHydrated(true);
        return;
      }
      fetchedFor.current = companyId;

      setLoading(true);

      try {
        // ★ store スコープに companyId を反映（必ず副作用内で！）
        if (setCompanyScope) setCompanyScope(companyId);

        // ★ サーバーの最新状態を store へ反映（7秒でタイムアウト）
        await Promise.race([
          (async () => { await refetchStrategy(); })(),
          sleep(7000),
        ]);
      } catch (e) {
        // 失敗しても UI は開ける
        console.error('StrategyClient: initial refetch failed:', e);
      } finally {
        if (!aborted) {
          setHydrated(true);
          setLoading(false);
        }
      }
    };

    void run();
    return () => { aborted = true; };
  }, [companyId, userId, setCompanyScope]);

  // ステップ移動
  const goBack = useCallback(() => setStep((s) => Math.max(1, s - 1)), []);
  const goNext = useCallback(() => setStep((s) => Math.min(totalSteps, s + 1)), [totalSteps]);

  // ステップ変更時はトップへ
  useEffect(() => {
    if (typeof window !== 'undefined') {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }, [step]);

  // ← → キーで移動
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') setStep((s) => Math.min(totalSteps, s + 1));
      if (e.key === 'ArrowLeft') setStep((s) => Math.max(1, s - 1));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [totalSteps]);

  /**
   * ===== 保存の安全化 =====
   * - finalStory は autosave 対象から外す
   * - hydrated && readyToAutosave && companyId が揃うまで autosave を無効化
   * - 全部空（story / answers2 / departments）ならスキップ
   * - useAutoSave には “軽いシグネチャ” だけ渡す（巨大参照での無限発火を回避）
   */
  const hasMeaningfulData = useMemo(() => {
    return nonEmptyArray(story) || nonEmptyArray(answers2) || nonEmptyArray(departments);
  }, [story, answers2, departments]);

  // 軽量化した依存（長さ＋安定 JSON で十分）
  const storySig   = useMemo(() => (Array.isArray(story) ? `${story.length}:${stableSig(story)}` : stableSig(story)), [story]);
  const answersSig = useMemo(() => (Array.isArray(answers2) ? `${answers2.length}:${stableSig(answers2)}` : stableSig(answers2)), [answers2]);
  const deptSig    = useMemo(() => (Array.isArray(departments) ? `${departments.length}:${stableSig(departments)}` : stableSig(departments)), [departments]);

  const autosaveEnabled = hydrated && readyToAutosave && !!companyId && hasMeaningfulData;

  // ✅ useAutoSave は 1引数（deps: any[]）で軽いシグネチャのみ渡す
  useAutoSave(autosaveEnabled ? [companyId, storySig, answersSig, deptSig] : []);

  const canBack = step > 1;
  const canNext = step < totalSteps;

  const stepView = useMemo(() => {
    if (!hydrated) {
      return (
        <div className="mx-auto max-w-5xl space-y-6 px-0 pt-2">
          <div className="animate-pulse space-y-4">
            <div className="h-6 w-2/3 rounded bg-black/10" />
            <div className="h-4 w-1/2 rounded bg-black/10" />
            <div className="h-28 w-full rounded bg-black/10" />
          </div>
        </div>
      );
    }

    switch (step) {
      case 1:
        return <Step1BasicInfo /* readOnly={!canEdit} */ />;
      case 2:
        return <Step2Portfolio onPrev={goBack} onNext={goNext} onSkip={goNext} />;
      case 3:
        return <Step2SWOT /* readOnly={!canEdit} */ />;
      case 4:
        return <Step3FinanceUpload /* readOnly={!canEdit} */ />;
      case 5:
        return <Step4MVV /* readOnly={!canEdit} */ />;
      case 6:
        return <Step5Confirm /* readOnly={!canEdit} */ />;
      default:
        return null;
    }
  }, [step, goBack, goNext, canEdit, hydrated]);

  const containerRef = useRef<HTMLDivElement>(null);
  const [footerPos, setFooterPos] = useState<{ left: number; width: number }>({ left: 0, width: 0 });

  useEffect(() => {
    let rafId = 0;
    const measure = () => {
      const el = containerRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      setFooterPos({ left: rect.left, width: rect.width });
    };
    measure();

    const RO: typeof ResizeObserver | undefined =
      typeof window !== 'undefined' ? (window as any).ResizeObserver : undefined;

    let ro: ResizeObserver | null = null;
    if (RO) {
      ro = new RO(() => {
        cancelAnimationFrame(rafId);
        rafId = requestAnimationFrame(measure);
      });
      if (containerRef.current) ro.observe(containerRef.current);
    }

    const onResize = () => {
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(measure);
    };
    const onScroll = () => {
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(measure);
    };

    window.addEventListener('resize', onResize);
    window.addEventListener('scroll', onScroll, { passive: true });
    const t = setTimeout(measure, 60);

    return () => {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('scroll', onScroll);
      clearTimeout(t);
      cancelAnimationFrame(rafId);
      if (ro && containerRef.current) ro.unobserve(containerRef.current);
      ro?.disconnect?.();
    };
  }, []);

  /* ===== UI分岐 ===== */

  if (!canView()) {
    return (
      <div className="mx-auto max-w-5xl px-4 md:px-0 pt-10">
        <div className="rounded-2xl border border-rose-200 bg-rose-50 p-6 text-rose-900">
          閲覧権限がありません。
        </div>
      </div>
    );
  }

  if (!mounted) {
    return (
      <div className="mx-auto max-w-5xl space-y-6 px-4 md:px-0 pt-6 pb-40 md:pb-44">
        <div className="animate-pulse space-y-4">
          <div className="h-6 w-2/3 rounded bg-black/10" />
          <div className="h-4 w-1/2 rounded bg-black/10" />
          <div className="h-28 w-full rounded bg-black/10" />
        </div>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="mx-auto max-w-5xl space-y-6 px-4 md:px-0 pt-6 pb-40 md:pb-44">
      {/* ヘッダ */}
      <header className="space-y-3">
        <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-[28px] font-semibold tracking-tight text-zinc-900">
              STAGE１ 経営情報入力
            </h1>
            <p className="text-[13px] text-zinc-500">
              基本情報・ポートフォリオ・SWOT・財務・MVVを順に入力し、最後に確認・送信します。
            </p>
          </div>
          {!canEdit && (
            <div
              className="inline-flex items-center gap-2 rounded-full border border-amber-300 bg-amber-50 px-3 py-1 text-xs font-medium text-amber-900"
              title="このページの編集は管理者（Admin）のみ可能です。今は閲覧モードです。"
            >
              閲覧モード（Adminのみ編集可）
            </div>
          )}
        </div>
      </header>

      {/* ステップヘッダー */}
      <div className="sticky top-0 z-40 -mx-4 border-b border-black/10 bg-white/70 px-4 py-3 backdrop-blur supports-[backdrop-filter]:bg-white/50">
        <div className="mx-auto max-w-5xl">
          <h2 className="text-base font-semibold text-gray-900">{meta.title}</h2>
          <p className="mt-0.5 text-sm text-gray-500">{meta.subtitle}</p>

          <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-black/5">
            <div
              className="h-full rounded-full bg-black/20 transition-all"
              style={{ width: `${(step / totalSteps) * 100}%` }}
            />
          </div>

          <div className="mt-2 flex gap-1.5">
            {Array.from({ length: totalSteps }).map((_, i) => (
              <span
                key={i}
                aria-hidden
                className={`inline-block h-1.5 w-1.5 rounded-full ${
                  i + 1 <= step ? 'bg-black/60' : 'bg-black/15'
                }`}
              />
            ))}
          </div>
        </div>
      </div>

      {/* 本文 */}
      <div className="space-y-6">
        {loading && !hydrated ? (
          <div className="text-xs text-gray-500">サーバーのデータを読み込み中…</div>
        ) : null}
        {stepView}
      </div>

      {/* フッターナビ */}
      <FooterNav
        left={footerPos.left}
        width={footerPos.width}
        canBack={step > 1}
        canNext={step < totalSteps && hydrated /* 初回同期前は進行抑制 */}
        onBack={goBack}
        onNext={goNext}
      />
    </div>
  );
}

/* 小さな分離：フッター */
function FooterNav({
  left,
  width,
  canBack,
  canNext,
  onBack,
  onNext,
}: {
  left: number;
  width: number;
  canBack: boolean;
  canNext: boolean;
  onBack: () => void;
  onNext: () => void;
}) {
  return (
    <div
      className="fixed z-50"
      style={{ left: `${left}px`, width: `${width}px`, bottom: '1rem' }}
    >
      <div
        className="pointer-events-auto rounded-2xl border border-black/10 bg-white/80 shadow-lg backdrop-blur supports-[backdrop-filter]:bg-white/60"
        role="region"
        aria-label="ステップ操作"
      >
        <div className="px-4 py-2.5 md:py-3">
          <div className="flex items-center justify-between gap-3">
            <button
              onClick={onBack}
              disabled={!canBack}
              className={`inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-medium transition focus:outline-none focus:ring-2 focus:ring-black/10 ${
                canBack
                  ? 'border-black/10 bg-white/80 text-gray-800 shadow-sm hover:bg-white'
                  : 'cursor-not-allowed border-black/10 bg-white/60 text-gray-400'
              }`}
              aria-label="前のステップへ戻る"
            >
              ← 戻る
            </button>

            <div className="select-none text-xs text-gray-600 md:text-sm" />

            <button
              onClick={onNext}
              disabled={!canNext}
              className={`inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium transition focus:outline-none focus:ring-2 focus:ring-black/10 ${
                canNext ? 'bg-black text-white shadow-sm hover:bg-black/90' : 'cursor-not-allowed bg-black/10 text-gray-400'
              }`}
              aria-label="次のステップへ進む"
            >
              次へ →
            </button>
          </div>
        </div>
        <div className="pb-[env(safe-area-inset-bottom)]" />
      </div>
    </div>
  );
}
