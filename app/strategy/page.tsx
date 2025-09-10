// /app/strategy/page.tsx
'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import Step1BasicInfo from '@/components/steps/Step1BasicInfo';
import Step2SWOT from '@/components/steps/Step2SWOT';
import Step3FinanceUpload from '@/components/steps/Step3FinanceUpload';
import Step4MVV from '@/components/steps/Step4MVV';
import Step5Confirm from '@/components/steps/Step5Confirm';
import { useStrategyStore } from '@/store/strategyStore';
import { useAccess } from '@/utils/access'; // Cookie/会員情報ベースの閲覧・編集判定
import { useUserStore } from '@/store/userStore';

/* =========================================================
 * 外側のラッパー：マウント完了まで何も描画しない
 *  - SSRと初回クライアント描画のHTML差分を無くすため
 * ========================================================= */
export default function StrategyPage() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return null; // 空描画でハイドレーション不一致を防止
  return <StrategyInner />;
}

/* =========================================================
 * 内側の実処理
 * ========================================================= */
function StrategyInner() {
  const [step, setStep] = useState(1);
  const totalSteps = 5;

  // ストアに触れておく（バリデーションなどで使用可）
  useStrategyStore();

  // 所属・権限
  const { canView, canEditCompany } = useAccess();
  const canEdit = canEditCompany(); // Admin のみ true

  // 会社ID/ユーザーID（データ再取得トリガ用）
  const companyId = useUserStore((s) => s.companyId);
  const userId = useUserStore((s) => s.user?.id ?? null);

  // companyId（と必要なら userId）が確定したらサーバから再取得
  useEffect(() => {
    if (!companyId) return;

    // 両対応：新(引数なし) / 旧(userId引数) のどちらの store 実装でも動かす
    const store: any = useStrategyStore.getState();
    const fn: any = store?.refetchFromServer;
    if (typeof fn === 'function') {
      try {
        // 関数の引数個数（旧実装は 1、最新は 0）で分岐
        if (fn.length >= 1) {
          if (userId) fn(userId);
        } else {
          fn();
        }
      } catch (e) {
        console.warn('refetchFromServer call failed', e);
      }
    }
  }, [companyId, userId]);

  const goBack = () => step > 1 && setStep((s) => s - 1);
  const goNext = () => step < totalSteps && setStep((s) => s + 1);

  // ステップ変更時に上へスクロール
  useEffect(() => {
    if (typeof window !== 'undefined') {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }, [step]);

  const meta = useMemo(() => {
    const list = [
      { title: 'STEP 1：経営基本情報', subtitle: '経営情報を入力する' },
      { title: 'STEP 2：SWOT分析', subtitle: '強み・弱み・機会・脅威を整理' },
      { title: 'STEP 3：財務データ', subtitle: 'CSVをアップロードして可視化' },
      { title: 'STEP 4：MVV', subtitle: 'Mission / Vision / Value を定義' },
      { title: 'STEP 5：確認', subtitle: '入力内容を最終チェック' },
    ];
    return list[step - 1];
  }, [step]);

  const canBack = step > 1;
  const canNext = step < totalSteps;

  const renderStepContent = () => {
    switch (step) {
      case 1:
        return <Step1BasicInfo /* readOnly={!canEdit} */ />;
      case 2:
        return <Step2SWOT /* readOnly={!canEdit} */ />;
      case 3:
        return <Step3FinanceUpload /* readOnly={!canEdit} */ />;
      case 4:
        return <Step4MVV /* readOnly={!canEdit} */ />;
      case 5:
        return <Step5Confirm /* readOnly={!canEdit} */ />;
      default:
        return null;
    }
  };

  /* ====== 中央カラムの実座標を監視してフッターを揃える ====== */
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

    const RO: typeof ResizeObserver | undefined = (window as any).ResizeObserver;
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

  /* ===================== Render ===================== */
  // 閲覧不可（middleware でも弾いているが保険）
  if (!canView()) {
    return (
      <div className="mx-auto max-w-5xl px-4 md:px-0 pt-10">
        <div className="rounded-2xl border border-rose-200 bg-rose-50 p-6 text-rose-900">
          閲覧権限がありません。
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
              STAGE１ 経営基本情報
            </h1>
            <p className="text-[13px] text-zinc-500">
              経営基本情報・SWOT・財務データ・MVVを入力してください。
            </p>
          </div>

          {/* 編集ガード（非Adminのときにバッジ表示） */}
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

      {/* ステップヘッダー（sticky） */}
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
        {/* Step に readOnly を渡す場合は上の canEdit を利用 */}
        {renderStepContent()}
      </div>

      {/* フッターナビ（中央カラムの座標に追従） */}
      <div
        className="fixed z-50"
        style={{
          left: `${footerPos.left}px`,
          width: `${footerPos.width}px`,
          bottom: '1rem',
        }}
      >
        <div
          className="
            pointer-events-auto rounded-2xl border border-black/10
            bg-white/80 shadow-lg backdrop-blur
            supports-[backdrop-filter]:bg-white/60
          "
          role="region"
          aria-label="ステップ操作"
        >
          <div className="px-4 py-2.5 md:py-3">
            <div className="flex items-center justify-between gap-3">
              <button
                onClick={goBack}
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

              <div className="select-none text-xs text-gray-600 md:text-sm">
                Step {step} / {totalSteps}
              </div>

              <button
                onClick={goNext}
                disabled={!canNext}
                className={`inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium transition focus:outline-none focus:ring-2 focus:ring-black/10 ${
                  canNext
                    ? 'bg-black text-white shadow-sm hover:bg-black/90'
                    : 'cursor-not-allowed bg-black/10 text-gray-400'
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
    </div>
  );
}
