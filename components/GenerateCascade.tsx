'use client';

import { useState } from 'react';
import { StrategyNode, StrategyBlock } from './StrategyBlock';

export default function GenerateCascade() {
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<StrategyNode | null>(null);
  const [error, setError] = useState('');

  const generate = async () => {
    if (!input.trim()) {
      setError('経営戦略を入力してください。');
      return;
    }

    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/generate-cascade', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ strategy: input }),
      });
      const data = await res.json();
      setResult(data);
    } catch (err) {
      console.error(err);
      setError('生成中にエラーが発生しました。');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      <textarea
        className="w-full p-3 border rounded resize-none"
        rows={4}
        placeholder="例：売上を2倍にするための全社的な変革を進める"
        value={input}
        onChange={(e) => setInput(e.target.value)}
      />
      <button
        className="px-4 py-2 bg-blue-600 text-white rounded"
        onClick={generate}
        disabled={loading}
      >
        {loading ? '生成中...' : 'カスケード生成'}
      </button>
      {error && <p className="text-red-500">{error}</p>}
      {result && <StrategyBlock node={result} />}
    </div>
  );
}
