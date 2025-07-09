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
    setEditableCascadeResult,
  } = useStrategyStore();

  const [departments, setDepartments] = useState<string[]>(['']);
  const [result, setResult] = useState<CascadeResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const addDepartment = () => {
    if (departments.length < 10) {
      setDepartments([...departments, '']);
    }
  };

  const removeDepartment = (index: number) => {
    setDepartments(departments.filter((_, i) => i !== index));
  };

  const updateDepartment = (index: number, value: string) => {
    const newDepartments = [...departments];
    newDepartments[index] = value;
    setDepartments(newDepartments);
  };

  const generateCascade = async () => {
    if (!story || departments.some((d) => !d.trim())) {
      setError('経営戦略とすべての部門名を入力してください');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/generate-cascade', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
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
          departments: departments.map((name) => ({ name })),
        }),
      });
      const data = await res.json();
      if (data?.departments) {
        setEditableCascadeResult(data.departments);
      }
      setResult(data);
    } catch (err) {
      console.error('❌ カスケード生成エラー:', err);
      setError('カスケード生成に失敗しました');
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="p-8 space-y-6">
      <h1 className="text-2xl font-bold">戦略カスケード</h1>

      {/* 経営戦略表示 */}
      <section className="bg-white p-4 rounded shadow">
        <h2 className="text-lg font-semibold mb-2">経営戦略</h2>
        <p className="text-gray-700 whitespace-pre-line">{story || '未入力です'}</p>
      </section>

      {/* 部門名入力フォーム */}
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
              <button onClick={() => removeDepartment(index)} className="text-red-500">削除</button>
            )}
          </div>
        ))}
        <div className="flex gap-4 mt-2">
          <button onClick={addDepartment} disabled={departments.length >= 10} className="bg-blue-100 px-3 py-1 rounded">
            ＋ 部門を追加
          </button>
          <button onClick={generateCascade} className="bg-blue-600 text-white px-4 py-2 rounded">
            部門戦略生成
          </button>
        </div>
        {error && <p className="text-red-500">{error}</p>}
      </section>

      {/* カスケード結果表示 */}
      {result && (
        <section className="bg-white p-4 rounded shadow">
          <h2 className="text-lg font-semibold mb-2">戦略ピラミッド</h2>
          <p className="font-bold mb-4">{result.strategy.summary}</p>
          <ul className="space-y-4">
            {result.departments.map((dept, i) => (
              <li key={i}>
                <h3 className="font-semibold">{dept.name}：{dept.strategy}</h3>
                <ul className="ml-4 list-disc">
                  {dept.projects.map((proj, j) => (
                    <li key={j}>
                      <strong>{proj.name}</strong>
                      <div className="ml-4 text-sm text-gray-600">{proj.description}</div>
                      <ul className="ml-4 list-square">
                        {proj.okrs.map((okr, k) => (
                          <li key={k}>
                            <em>{okr.objective}</em>
                            <ul className="ml-4 list-decimal text-sm text-gray-600">
                              {okr.keyResults.map((kr, l) => (
                                <li key={l}>{kr}</li>
                              ))}
                            </ul>
                          </li>
                        ))}
                      </ul>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </section>
      )}

      {loading && <p>生成中...</p>}
    </main>
  );
}
