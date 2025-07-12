'use client';

interface Props {
  summary: string;
}

export default function StrategyBlock({ summary }: Props) {
  return (
    <div className="bg-yellow-100 border-l-8 border-yellow-500 rounded-lg shadow-md p-6 w-full max-w-3xl">
      <h2 className="text-lg font-bold text-yellow-700 mb-2">📌 経営戦略（戦略サマリー）</h2>
      <p className="text-gray-800 text-sm whitespace-pre-wrap">{summary || '戦略サマリーが未入力です。'}</p>
    </div>
  );
}
