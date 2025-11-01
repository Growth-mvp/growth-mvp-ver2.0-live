// /components/steps/Step4MVV.tsx
'use client';

import React, { useEffect } from 'react';
import { useStrategyStore } from '@/store/strategyStore';
import StepLayout from '@/components/StepLayout';

/* Glassカード */
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
  // ✅ 正式セッターを取得
  const setMVV = useStrategyStore((s) => s.setMVV);

  // ✅ 値は常に文字列で
  const mission = useStrategyStore((s) => s.mission ?? '');
  const vision = useStrategyStore((s) => s.vision ?? '');
  const value = useStrategyStore((s) => s.value ?? '');

  // （任意）AI 提案の自動反映
  const aiSuggestedMVV = useStrategyStore((s: any) => s.aiSuggestedMVV ?? null);
  useEffect(() => {
    if (!aiSuggestedMVV) return;
    const patch: Parameters<typeof setMVV>[0] = {};
    if (aiSuggestedMVV.mission) patch.mission = String(aiSuggestedMVV.mission);
    if (aiSuggestedMVV.vision) patch.vision = String(aiSuggestedMVV.vision);
    if (aiSuggestedMVV.value) patch.value = String(aiSuggestedMVV.value);
    if (Object.keys(patch).length) setMVV(patch);
  }, [aiSuggestedMVV, setMVV]);

  return (
    <StepLayout step={4} totalSteps={5} title="STEP 4：MVV（ミッション・ビジョン・バリュー）">
      <div className="space-y-6">
        {/* Mission */}
        <GlassCard title="Mission（ミッション）" hint="会社が存在する理由。短く、覚えやすく。">
          <textarea
            value={mission}
            onChange={(e) => setMVV({ mission: e.target.value })}
            placeholder="例：私たちは〇〇で社会の課題を解決します。"
            className="min-h-[120px] w-full resize-y rounded-xl border border-black/10 bg-white/70 px-3 py-3 text-sm text-gray-800 shadow-inner placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-black/10"
          />
        </GlassCard>

        {/* Vision */}
        <GlassCard title="Vision（ビジョン）" hint="目指す未来像。5〜10年後に到達したい状態。">
          <textarea
            value={vision}
            onChange={(e) => setMVV({ vision: e.target.value })}
            placeholder="例：〇〇領域で最も信頼される企業になる。"
            className="min-h-[120px] w-full resize-y rounded-xl border border-black/10 bg-white/70 px-3 py-3 text-sm text-gray-800 shadow-inner placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-black/10"
          />
        </GlassCard>

        {/* Value */}
        <GlassCard title="Value（バリュー）" hint="日々の意思決定の拠り所。3〜5語で要点を。">
          <textarea
            value={value}
            onChange={(e) => setMVV({ value: e.target.value })}
            placeholder="例：挑戦／誠実／共創"
            className="min-h-[120px] w-full resize-y rounded-xl border border-black/10 bg-white/70 px-3 py-3 text-sm text-gray-800 shadow-inner placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-black/10"
          />
        </GlassCard>
      </div>
    </StepLayout>
  );
}
