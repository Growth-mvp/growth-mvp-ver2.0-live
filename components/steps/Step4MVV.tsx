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
      <h2 className="text-xl font-bold">STEP4：MVV（経営理念・パーパス）</h2>
      <p className="text-sm text-gray-600">
        経営理念やパーパスを「Mission（使命）」「Vision（目指す姿）」「Value（行動指針）」の観点で記入してください。
      </p>

      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium mb-1">Mission（使命）</label>
          <textarea
            value={mission}
            onChange={(e) => setMission(e.target.value)}
            rows={4}
            className="w-full border rounded p-2"
            placeholder="例：私たちは〇〇を通じて社会課題を解決します"
          />
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">Vision（目指す姿）</label>
          <textarea
            value={vision}
            onChange={(e) => setVision(e.target.value)}
            rows={4}
            className="w-full border rounded p-2"
            placeholder="例：業界No.1の〇〇企業を目指します"
          />
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">Value（行動指針）</label>
          <textarea
            value={value}
            onChange={(e) => setValue(e.target.value)}
            rows={4}
            className="w-full border rounded p-2"
            placeholder="例：挑戦・誠実・スピードを重んじる"
          />
        </div>
      </div>
    </div>
  );
}
