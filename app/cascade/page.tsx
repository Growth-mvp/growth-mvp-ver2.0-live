'use client';

import { useEffect, useState } from 'react';
import { useStrategyStore } from '@/store/strategyStore';

type OKR = {
  objective: string;
  keyResults: string[];
};

type Project = {
  name: string;
  description: string;
  okrs: OKR[];
};

type Department = {
  name: string;
  strategy: string;
  projects: Project[];
};

type CascadeResult = {
  strategy: {
    summary: string;
  };
  departments: Department[];
};

export default function CascadePage() {
  const {
    thought,
    strategySummary,
    story,
    mission,
    vision,
    value,
    industry,
    revenue,
    employees,
    strength,
    weakness,
    opportunity,
    threat,
    csvFinanceData,
    editableCascadeResult,
    setStrategySummary,
    setEditableCascadeResult,
  } = useStrategyStore();

  const [departments, setDepartments] = useState<string[]>(['']);
  const [result, setResult] = useState<CascadeResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (editableCascadeResult.length > 0) {
      console.log('📦 Supabase復元データ:', editableCascadeResult);
      setResult({
        strategy: {
          summary: strategySummary?.trim() || '経営戦略の要約が未入力です',
        },
        departments: editableCascadeResult,
      });
    }
  }, [editableCascadeResult, strategySummary]);

  const addDepartment = () => {
    if (departments.length < 10) {
      setDepartments((prev) => [...prev, '']);
    }
  };

  const removeDepartment = (index: number) => {
    setDepartments((prev) => prev.filter((_, i) => i !== index));
  };

  const updateDepartment = (index: number, value: string) => {
    setDepartments((prev) => {
      const newDeps = [...prev];
      newDeps[index] = value;
      return newDeps;
    });
  };

  const generateCascade = async () => {
    console.log('▶ 部門戦略生成ボタンが押されました');
    console.log('📝 入力状況:', {
      story,
      strategySummary,
      departments,
    });

    if ((!story?.trim() && !strategySummary?.trim()) || departments.some((d) => !d.trim())) {
      console.warn('⛔ 入力エラー: 経営戦略か部門名が未入力です');
      setError('経営戦略（ストーリーまたは要約）とすべての部門名を入力してください');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const res = await fetch('/api/generate-cascade', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          thought,
          story,
          strategySummary,
          mission,
          vision,
          value,
          industry,
          revenue,
          employees,
          strength,
          weakness,
          opportunity,
          threat,
          csvFinanceData,
          departments: departments.map((name) => ({ name })),
        }),
      });

      console.log('📡 fetch結果:', res.status);
      const data = await res.json();
      console.log('📦 API応答:', data);

      if (res.ok && data?.departments) {
        setEditableCascadeResult(data.departments);
        setResult(data);
        setStrategySummary(data.strategy?.summary || '');
      } else {
        setError(data.error || '生成に失敗しました。');
        console.error('❌ 応答エラー:', data.error);
      }
    } catch (err) {
      console.error('❌ カスケード生成中に例外:', err);
      setError('カスケード生成に失敗しました');
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="p-8 space-y-6">
      <h1 className="text-2xl font-bold">戦略カスケード</h1>

      <section className="bg-white p-4 rounded shadow space-y-2">
        <h2 className="text-lg font-semibold">部門名を入力（最大10件）</h2>
        {departments.map((dept, index) => (
          <div key={index} className="flex gap-2 items-center">
            <input
              type="text"
              value={dept}
              onChange={(e) => updateDepartment(index, e.target.value)}
              placeholder={`部門名 ${index + 1}`}
              className="flex-1 border rounded px-2 py-1"
            />
            {departments.length > 1 && (
              <button onClick={() => removeDepartment(index)} className="text-red-500">
                削除
              </button>
            )}
          </div>
        ))}
        <div className="flex gap-4 mt-2">
          <button
            onClick={addDepartment}
            disabled={departments.length >= 10}
            className="bg-blue-100 px-3 py-1 rounded disabled:opacity-50"
          >
            ＋ 部門を追加
          </button>
          <button
            onClick={generateCascade}
            className="bg-blue-600 text-white px-4 py-2 rounded disabled:opacity-50"
            disabled={loading}
          >
            {loading ? '生成中...' : '部門戦略生成'}
          </button>
        </div>
        {error && <p className="text-red-500">{error}</p>}
      </section>

      {result && (
        <section className="bg-white p-4 rounded shadow">
          <h2 className="text-lg font-semibold mb-4">戦略ピラミッド構造</h2>

          <div className="bg-blue-100 text-center font-bold text-lg py-3 rounded mb-8 shadow-md">
            {result.strategy.summary}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
            {result.departments.map((dept, i) => (
              <div key={i} className="bg-gray-50 p-4 rounded-lg shadow border">
                <h3 className="font-semibold text-lg text-blue-900 mb-2">
                  {dept.name}
                </h3>
                <p className="text-sm font-medium text-gray-700 mb-2">
                  {dept.strategy}
                </p>

                {dept.projects.map((proj, j) => (
                  <div key={j} className="mb-4">
                    <h4 className="text-sm font-bold text-blue-700">{proj.name}</h4>
                    <p className="text-xs text-gray-600">{proj.description}</p>
                    <ul className="ml-4 mt-1 list-disc text-sm text-gray-700 space-y-1">
                      {proj.okrs.map((okr, k) => (
                        <li key={k}>
                          <em className="font-medium">{okr.objective}</em>
                          <ul className="ml-5 list-decimal text-xs text-gray-600 space-y-1">
                            {okr.keyResults.map((kr, l) => (
                              <li key={l}>{kr}</li>
                            ))}
                          </ul>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </section>
      )}

      {loading && <p className="text-gray-500 text-sm">生成中...</p>}
    </main>
  );
}
