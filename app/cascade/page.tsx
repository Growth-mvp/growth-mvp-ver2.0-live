// ✅ /app/cascade/page.tsx（OKR並び替え＋ビジュアル強化＋段階グリッド対応）

'use client';

import { useEffect, useState } from 'react';
import { useStrategyStore } from '@/store/strategyStore';
import { ArrowUp, ArrowDown, Plus, Trash2 } from 'lucide-react';

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
    updateDepartmentStrategy,
    updateProject,
    addProject,
    saveToSupabase,
    notification,
  } = useStrategyStore();

  const [departments, setDepartments] = useState<string[]>(['']);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (editableCascadeResult.length > 0) {
      setDepartments(editableCascadeResult.map((d) => d.name));
    }
  }, [editableCascadeResult]);

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
    if ((!story?.trim() && !strategySummary?.trim()) || departments.some((d) => !d.trim())) {
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

      const data = await res.json();
      if (res.ok && data?.departments) {
        setEditableCascadeResult(data.departments);
        setStrategySummary(data.strategy?.summary || '');
      } else {
        setError(data.error || '生成に失敗しました。');
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

      {editableCascadeResult.length > 0 && (
        <section className="bg-white p-4 rounded shadow">
          <h2 className="text-lg font-semibold mb-4">戦略ピラミッド構造（編集可能）</h2>

          <div className="bg-blue-100 text-center font-bold text-lg py-3 rounded mb-8 shadow-md">
            {strategySummary || '経営戦略の要約が表示されます'}
          </div>

          <div className="space-y-10">
            {editableCascadeResult.map((dept, i) => (
              <div key={i} className="bg-gray-50 p-4 rounded-xl shadow border">
                <h3 className="font-semibold text-lg text-blue-900 mb-2">{dept.name}</h3>
                <textarea
                  defaultValue={dept.strategy}
                  onChange={(e) => updateDepartmentStrategy(dept.name, e.target.value)}
                  className="w-full border rounded p-2 mb-4 text-sm"
                  rows={4}
                />

                <button
                  onClick={() =>
                    addProject(dept.name, {
                      name: '新プロジェクト',
                      description: '',
                      okrs: [],
                    })
                  }
                  className="text-sm text-blue-600 mb-4"
                >
                  ＋ プロジェクトを追加
                </button>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {dept.projects.map((proj, j) => (
                    <div key={j} className="bg-white border rounded-xl p-4 shadow-md">
                      <input
                        type="text"
                        value={proj.name}
                        onChange={(e) => updateProject(dept.name, j, { ...proj, name: e.target.value })}
                        className="w-full border rounded p-2 text-sm font-bold mb-2"
                        placeholder="プロジェクト名"
                      />
                      <textarea
                        value={proj.description}
                        onChange={(e) => updateProject(dept.name, j, { ...proj, description: e.target.value })}
                        className="w-full border rounded p-2 text-sm mb-2"
                        placeholder="プロジェクト説明"
                        rows={2}
                      />

                      <button
                        onClick={() => {
                          const updatedOkrs = [
                            ...proj.okrs,
                            { objective: '新しいObjective', keyResults: [] },
                          ];
                          updateProject(dept.name, j, { ...proj, okrs: updatedOkrs });
                        }}
                        className="text-blue-600 text-sm mb-2"
                      >
                        ＋ Objective を追加
                      </button>

                      {proj.okrs.map((okr, okrIndex) => (
                        <div key={okrIndex} className="mb-4 bg-gray-100 p-3 rounded">
                          <div className="flex items-center gap-2 mb-1">
                            <input
                              type="text"
                              value={okr.objective}
                              onChange={(e) => {
                                const updatedOkrs = [...proj.okrs];
                                updatedOkrs[okrIndex] = { ...okr, objective: e.target.value };
                                updateProject(dept.name, j, { ...proj, okrs: updatedOkrs });
                              }}
                              className="flex-1 border rounded p-2 text-sm"
                              placeholder="Objective"
                            />
                            <button
                              onClick={() => {
                                const updatedOkrs = proj.okrs.filter((_, i) => i !== okrIndex);
                                updateProject(dept.name, j, { ...proj, okrs: updatedOkrs });
                              }}
                              className="text-red-500"
                            >
                              <Trash2 size={16} />
                            </button>
                            <button
                              disabled={okrIndex === 0}
                              onClick={() => {
                                const updated = [...proj.okrs];
                                const temp = updated[okrIndex];
                                updated[okrIndex] = updated[okrIndex - 1];
                                updated[okrIndex - 1] = temp;
                                updateProject(dept.name, j, { ...proj, okrs: updated });
                              }}
                              className="text-gray-500"
                            >
                              <ArrowUp size={16} />
                            </button>
                            <button
                              disabled={okrIndex === proj.okrs.length - 1}
                              onClick={() => {
                                const updated = [...proj.okrs];
                                const temp = updated[okrIndex];
                                updated[okrIndex] = updated[okrIndex + 1];
                                updated[okrIndex + 1] = temp;
                                updateProject(dept.name, j, { ...proj, okrs: updated });
                              }}
                              className="text-gray-500"
                            >
                              <ArrowDown size={16} />
                            </button>
                          </div>

                          {okr.keyResults.map((kr, krIndex) => (
                            <div key={krIndex} className="flex items-center gap-2 mb-1">
                              <input
                                type="text"
                                value={kr}
                                onChange={(e) => {
                                  const updatedKRs = [...okr.keyResults];
                                  updatedKRs[krIndex] = e.target.value;
                                  const updatedOkrs = [...proj.okrs];
                                  updatedOkrs[okrIndex] = { ...okr, keyResults: updatedKRs };
                                  updateProject(dept.name, j, { ...proj, okrs: updatedOkrs });
                                }}
                                className="flex-1 border rounded px-2 py-1 text-sm"
                                placeholder="Key Result"
                              />
                              <button
                                onClick={() => {
                                  const updatedKRs = okr.keyResults.filter((_, i) => i !== krIndex);
                                  const updatedOkrs = [...proj.okrs];
                                  updatedOkrs[okrIndex] = { ...okr, keyResults: updatedKRs };
                                  updateProject(dept.name, j, { ...proj, okrs: updatedOkrs });
                                }}
                                className="text-red-500 text-sm"
                              >
                                削除
                              </button>
                            </div>
                          ))}

                          <button
                            onClick={() => {
                              const updatedOkrs = [...proj.okrs];
                              updatedOkrs[okrIndex] = {
                                ...okr,
                                keyResults: [...okr.keyResults, ''],
                              };
                              updateProject(dept.name, j, { ...proj, okrs: updatedOkrs });
                            }}
                            className="text-blue-600 text-sm mt-1"
                          >
                            ＋ Key Result を追加
                          </button>
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>

          <div className="flex justify-end mt-6">
            <button
              onClick={saveToSupabase}
              className="bg-green-600 text-white px-4 py-2 rounded hover:bg-green-700"
            >
              編集内容を保存する
            </button>
          </div>
          {notification && (
            <p className="text-sm mt-2 text-right text-blue-600">{notification}</p>
          )}
        </section>
      )}

      {loading && <p className="text-gray-500 text-sm">生成中...</p>}
    </main>
  );
}
