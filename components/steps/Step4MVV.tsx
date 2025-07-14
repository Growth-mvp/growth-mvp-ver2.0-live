'use client';

import { useStrategyStore } from '@/store/strategyStore';
import StepLayout from '@/components/StepLayout';

export default function Step4MVV() {
  const {
    mission,
    vision,
    value,
    setMission,
    setVision,
    setValue,
  } = useStrategyStore();

  return (
    <StepLayout step={4} totalSteps={5} title="MVV（ミッション・ビジョン・バリュー）の入力">
      <div className="space-y-6">
        <div>
          <label className="block text-sm font-semibold text-gray-700 mb-1">
            🎯 ミッション（Mission）
          </label>
          <textarea
            value={mission}
            onChange={(e) => setMission(e.target.value)}
            placeholder="例：私たちは、〇〇を通じて、世界に貢献します。"
            className="w-full border border-gray-300 rounded px-3 py-2 min-h-[100px] focus:outline-none focus:ring-2 focus:ring-blue-400"
          />
        </div>

        <div>
          <label className="block text-sm font-semibold text-gray-700 mb-1">
            🌟 ビジョン（Vision）
          </label>
          <textarea
            value={vision}
            onChange={(e) => setVision(e.target.value)}
            placeholder="例：〇〇の分野で世界No.1になることを目指します。"
            className="w-full border border-gray-300 rounded px-3 py-2 min-h-[100px] focus:outline-none focus:ring-2 focus:ring-blue-400"
          />
        </div>

        <div>
          <label className="block text-sm font-semibold text-gray-700 mb-1">
            💎 バリュー（Value）
          </label>
          <textarea
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="例：挑戦・誠実・共創"
            className="w-full border border-gray-300 rounded px-3 py-2 min-h-[100px] focus:outline-none focus:ring-2 focus:ring-blue-400"
          />
        </div>
      </div>
    </StepLayout>
  );
}
