'use client';

import { useStrategyStore } from '../../store/strategyStore';

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
    <div className="space-y-6">
      <h2 className="text-xl font-bold text-gray-800">ミッション・ビジョン・バリュー（MVV）の入力</h2>

      <div>
        <label className="block font-semibold mb-1">🎯 ミッション（Mission）</label>
        <textarea
          value={mission}
          onChange={(e) => setMission(e.target.value)}
          placeholder="例：私たちは、〇〇を通じて、世界に貢献します。"
          className="w-full border border-gray-300 rounded px-3 py-2 min-h-[100px]"
        />
      </div>

      <div>
        <label className="block font-semibold mb-1">🌟 ビジョン（Vision）</label>
        <textarea
          value={vision}
          onChange={(e) => setVision(e.target.value)}
          placeholder="例：〇〇の分野で世界No.1になることを目指します。"
          className="w-full border border-gray-300 rounded px-3 py-2 min-h-[100px]"
        />
      </div>

      <div>
        <label className="block font-semibold mb-1">💎 バリュー（Value）</label>
        <textarea
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="例：挑戦・誠実・共創"
          className="w-full border border-gray-300 rounded px-3 py-2 min-h-[100px]"
        />
      </div>
    </div>
  );
}
