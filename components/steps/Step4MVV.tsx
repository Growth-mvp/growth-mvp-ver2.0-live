// /components/steps/Step4MVV.tsx
'use client';

import React, { useEffect } from 'react';
import { useStrategyStore } from '@/store/strategyStore';
import StepLayout from '@/components/StepLayout';

/* =========================================================
 * Apple風ミニマル：
 * - 余白広め / 角丸2xl / 超薄ボーダー / subtle shadow
 * - ガラス感（bg-white/60 + backdrop-blur-md）
 * - 見出しは控えめ、フォームはプレーン＆上品
 * ========================================================= */

// セッターが無ければ setState にフォールバックする安全ラッパー
function setFieldSafe(store: any, key: string, value: any) {
  const fnName = 'set' + key.charAt(0).toUpperCase() + key.slice(1); // mission -> setMission
  const setter = store?.[fnName];
  if (typeof setter === 'function') {
    setter(value);
  } else if (typeof (useStrategyStore as any)?.setState === 'function') {
    (useStrategyStore as any).setState({ [key]: value });
  }
}

// Glassカード
function GlassCard({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-black/10 bg-white/60 shadow-sm backdrop-blur-md ring-1 ring-black/5">
      <div className="p-4 md:p-5">
        <div className="mb-2 text-[13px] font-medium text-gray-700 dark:text-gray-200">{title}</div>
        {hint ? <p className="mb-3 text-[12px] text-gray-500 dark:text-gray-400">{hint}</p> : null}
        {children}
      </div>
    </div>
  );
}

export default function Step4MVV() {
  const st = useStrategyStore() as any;

  // 常に制御コンポーネントに（未定義は空文字）
  const mission: string = st?.mission ?? '';
  const vision: string = st?.vision ?? '';
  const value: string = st?.value ?? '';

  // （任意）AI 提案を自動反映できるフック
  const aiSuggestedMVV: any = st?.aiSuggestedMVV ?? null;
  useEffect(() => {
    if (!aiSuggestedMVV) return;
    if (aiSuggestedMVV.mission) setFieldSafe(st, 'mission', aiSuggestedMVV.mission);
    if (aiSuggestedMVV.vision) setFieldSafe(st, 'vision', aiSuggestedMVV.vision);
    if (aiSuggestedMVV.value) setFieldSafe(st, 'value', aiSuggestedMVV.value);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aiSuggestedMVV]);

  return (
    <StepLayout step={4} totalSteps={5} title="STEP 4：MVV（ミッション・ビジョン・バリュー）">
      <div className="space-y-6">
        {/* Mission */}
        <GlassCard title="Mission（ミッション）" hint="会社が存在する理由。短く、覚えやすく。">
          <textarea
            value={mission}
            onChange={(e) => setFieldSafe(st, 'mission', e.target.value)}
            placeholder="例：私たちは〇〇で社会の課題を解決します。"
            className="min-h-[120px] w-full resize-y rounded-xl border border-black/10 bg-white/70 px-3 py-3 text-sm text-gray-800 shadow-inner placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-black/10"
          />
        </GlassCard>

        {/* Vision */}
        <GlassCard title="Vision（ビジョン）" hint="目指す未来像。5〜10年後に到達したい状態。">
          <textarea
            value={vision}
            onChange={(e) => setFieldSafe(st, 'vision', e.target.value)}
            placeholder="例：〇〇領域で最も信頼される企業になる。"
            className="min-h-[120px] w-full resize-y rounded-xl border border-black/10 bg-white/70 px-3 py-3 text-sm text-gray-800 shadow-inner placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-black/10"
          />
        </GlassCard>

        {/* Value */}
        <GlassCard title="Value（バリュー）" hint="日々の意思決定の拠り所。3〜5語で要点を。">
          <textarea
            value={value}
            onChange={(e) => setFieldSafe(st, 'value', e.target.value)}
            placeholder="例：挑戦／誠実／共創"
            className="min-h-[120px] w-full resize-y rounded-xl border border-black/10 bg-white/70 px-3 py-3 text-sm text-gray-800 shadow-inner placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-black/10"
          />
        </GlassCard>
      </div>
    </StepLayout>
  );
}
