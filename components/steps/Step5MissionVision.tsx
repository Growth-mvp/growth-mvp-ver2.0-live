'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useStrategyStore } from '@/store/strategyStore';

export default function Step5MissionVision() {
  const router = useRouter();
  const {
    mission,
    visionStatement,
    value,
    setMission,
    setVisionStatement,
    setValue,
  } = useStrategyStore();

  const [localMission, setLocalMission] = useState(mission);
  const [localVision, setLocalVision] = useState(visionStatement);
  const [localValue, setLocalValue] = useState(value);

  useEffect(() => {
    console.log('🔥 MVV状態：', { mission, visionStatement, value });
  }, [mission, visionStatement, value]);

  const handleNext = () => {
    if (!localMission.trim() || !localVision.trim() || !localValue.trim()) {
      alert('すべての項目を入力してください。');
      return;
    }

    // Zustandに保存
    setMission(localMission);
    setVisionStatement(localVision);
    setValue(localValue);

    // 次のステップへ遷移
    router.push('/story');
  };

  return (
    <div className="space-y-6">
      <h2 className="text-lg font-semibold">STEP5: MVV（ミッション・ビジョン・バリュー）</h2>

      <div>
        <label className="block text-sm font-medium mb-1">ミッション（Mission）</label>
        <textarea
          value={localMission}
          onChange={(e) => setLocalMission(e.target.value)}
          className="w-full border rounded px-3 py-2 text-sm"
          rows={3}
          placeholder="例）人と社会を豊かにする"
        />
      </div>

      <div>
        <label className="block text-sm font-medium mb-1">ビジョン（Vision）</label>
        <textarea
          value={localVision}
          onChange={(e) => setLocalVision(e.target.value)}
          className="w-full border rounded px-3 py-2 text-sm"
          rows={3}
          placeholder="例）日本でNo.1の〇〇になる"
        />
      </div>

      <div>
        <label className="block text-sm font-medium mb-1">バリュー（Value）</label>
        <textarea
          value={localValue}
          onChange={(e) => setLocalValue(e.target.value)}
          className="w-full border rounded px-3 py-2 text-sm"
          rows={3}
          placeholder="例）挑戦・誠実・共創"
        />
      </div>

      <button
        onClick={handleNext}
        className="mt-6 bg-blue-600 text-white px-6 py-2 rounded hover:bg-blue-700"
      >
        戦略ストーリーを生成する
      </button>
    </div>
  );
}
