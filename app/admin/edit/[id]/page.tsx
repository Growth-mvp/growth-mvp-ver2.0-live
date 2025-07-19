'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { supabase } from '@/lib/supabaseClient';
import { Department } from '@/types/strategy';

export default function AdminEditPage() {
  const params = useParams();
  const id = params?.id as string;

  const [companyName, setCompanyName] = useState('');
  const [mission, setMission] = useState('');
  const [vision, setVision] = useState('');
  const [value, setValue] = useState('');
  const [strength, setStrength] = useState('');
  const [weakness, setWeakness] = useState('');
  const [opportunity, setOpportunity] = useState('');
  const [threat, setThreat] = useState('');
  const [editableCascadeResult, setEditableCascadeResult] = useState<Department[]>([]);

  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      const { data, error } = await supabase
        .from('strategy_data')
        .select('*')
        .eq('id', id)
        .single();

      if (data) {
        setCompanyName(data.companyName || '');
        setMission(data.mission || '');
        setVision(data.vision || '');
        setValue(data.value || '');
        setStrength(data.strength || '');
        setWeakness(data.weakness || '');
        setOpportunity(data.opportunity || '');
        setThreat(data.threat || '');
        setEditableCascadeResult(data.editableCascadeResult || []);
      } else {
        setMessage('データ取得に失敗しました');
      }
      setLoading(false);
    };

    if (id) fetchData();
  }, [id]);

  const handleSave = async () => {
    setLoading(true);
    const { error } = await supabase
      .from('strategy_data')
      .update({
        companyName,
        mission,
        vision,
        value,
        strength,
        weakness,
        opportunity,
        threat,
        editableCascadeResult,
      })
      .eq('id', id);

    setLoading(false);
    if (error) {
      setMessage('保存に失敗しました');
    } else {
      setMessage('保存しました');
    }
  };

  const handleRegenerateCascade = async () => {
    setLoading(true);
    setMessage('AIによる再生成中...');

    try {
      const response = await fetch('/api/generate-cascade', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mission,
          vision,
          value,
          strength,
          weakness,
          opportunity,
          threat,
        }),
      });

      const result = await response.json();

      if (result && result.departments) {
        setEditableCascadeResult(result.departments);
        setMessage('✅ AIによる再生成が完了しました');
      } else {
        setMessage('❌ 再生成に失敗しました');
      }
    } catch (error) {
      console.error(error);
      setMessage('❌ エラーが発生しました');
    }

    setLoading(false);
  };

  const addDepartment = () => {
    setEditableCascadeResult([
      ...editableCascadeResult,
      {
        name: '新しい部門',
        strategy: '',
        projects: [],
      },
    ]);
  };

  const deleteDepartment = (deptIndex: number) => {
    const updated = [...editableCascadeResult];
    updated.splice(deptIndex, 1);
    setEditableCascadeResult(updated);
  };

  const addProject = (deptIndex: number) => {
    const updated = [...editableCascadeResult];
    updated[deptIndex].projects.push({
      name: '新しいプロジェクト',
      description: '',
      okrs: [],
    });
    setEditableCascadeResult(updated);
  };

  const deleteProject = (deptIndex: number, projIndex: number) => {
    const updated = [...editableCascadeResult];
    updated[deptIndex].projects.splice(projIndex, 1);
    setEditableCascadeResult(updated);
  };

  const addOKR = (deptIndex: number, projIndex: number) => {
    const updated = [...editableCascadeResult];
    updated[deptIndex].projects[projIndex].okrs.push({
      objective: '',
      keyResults: [],
    });
    setEditableCascadeResult(updated);
  };

  const deleteOKR = (deptIndex: number, projIndex: number, okrIndex: number) => {
    const updated = [...editableCascadeResult];
    updated[deptIndex].projects[projIndex].okrs.splice(okrIndex, 1);
    setEditableCascadeResult(updated);
  };

  const deleteKeyResult = (
    deptIndex: number,
    projIndex: number,
    okrIndex: number,
    krIndex: number
  ) => {
    const updated = [...editableCascadeResult];
    updated[deptIndex].projects[projIndex].okrs[okrIndex].keyResults.splice(krIndex, 1);
    setEditableCascadeResult(updated);
  };

  const addKeyResult = (deptIndex: number, projIndex: number, okrIndex: number) => {
    const updated = [...editableCascadeResult];
    updated[deptIndex].projects[projIndex].okrs[okrIndex].keyResults.push('');
    setEditableCascadeResult(updated);
  };

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <h1 className="text-2xl font-bold">戦略情報の編集</h1>
      {loading && <p className="text-gray-600">読み込み中...</p>}
      {message && <p className="text-green-600">{message}</p>}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* MVV・SWOT入力（省略せず） */}
        {/* ...略...（前と同様） */}
      </div>

      <div className="mt-6 space-y-4">
        <h2 className="text-xl font-bold text-gray-800">カスケード構造（部門・PJ・OKR）</h2>
        {editableCascadeResult.map((dept, deptIndex) => (
          <div key={deptIndex} className="bg-gray-50 p-4 rounded border relative">
            <button
              onClick={() => deleteDepartment(deptIndex)}
              className="absolute top-2 right-2 text-red-500 text-sm"
            >
              🗑️
            </button>
            <input
              className="border p-2 mb-2 w-full rounded font-bold"
              value={dept.name}
              onChange={(e) => {
                const updated = [...editableCascadeResult];
                updated[deptIndex].name = e.target.value;
                setEditableCascadeResult(updated);
              }}
              placeholder="部門名"
            />
            <textarea
              className="border p-2 mb-4 w-full rounded"
              value={dept.strategy}
              onChange={(e) => {
                const updated = [...editableCascadeResult];
                updated[deptIndex].strategy = e.target.value;
                setEditableCascadeResult(updated);
              }}
              placeholder="部門戦略"
            />
            {dept.projects.map((proj, projIndex) => (
              <div key={projIndex} className="ml-4 mb-4 pl-4 border-l border-gray-300 relative">
                <button
                  onClick={() => deleteProject(deptIndex, projIndex)}
                  className="absolute top-2 right-2 text-red-500 text-sm"
                >
                  🗑️
                </button>
                <input
                  className="border p-2 mb-2 w-full rounded font-semibold"
                  value={proj.name}
                  onChange={(e) => {
                    const updated = [...editableCascadeResult];
                    updated[deptIndex].projects[projIndex].name = e.target.value;
                    setEditableCascadeResult(updated);
                  }}
                  placeholder="プロジェクト名"
                />
                <textarea
                  className="border p-2 w-full rounded"
                  value={proj.description}
                  onChange={(e) => {
                    const updated = [...editableCascadeResult];
                    updated[deptIndex].projects[projIndex].description = e.target.value;
                    setEditableCascadeResult(updated);
                  }}
                  placeholder="プロジェクト説明"
                />
                {proj.okrs.map((okr, okrIndex) => (
                  <div key={okrIndex} className="mt-4 p-2 bg-white border rounded relative">
                    <button
                      onClick={() => deleteOKR(deptIndex, projIndex, okrIndex)}
                      className="absolute top-2 right-2 text-red-500 text-sm"
                    >
                      🗑️
                    </button>
                    <input
                      className="border p-2 w-full mb-2 rounded font-medium"
                      value={okr.objective}
                      onChange={(e) => {
                        const updated = [...editableCascadeResult];
                        updated[deptIndex].projects[projIndex].okrs[okrIndex].objective =
                          e.target.value;
                        setEditableCascadeResult(updated);
                      }}
                      placeholder="Objective（目標）"
                    />
                    {okr.keyResults.map((kr, krIndex) => (
                      <div key={krIndex} className="flex gap-2 mb-1">
                        <input
                          className="border p-2 w-full rounded"
                          value={kr}
                          onChange={(e) => {
                            const updated = [...editableCascadeResult];
                            updated[deptIndex].projects[projIndex].okrs[okrIndex].keyResults[
                              krIndex
                            ] = e.target.value;
                            setEditableCascadeResult(updated);
                          }}
                          placeholder={`Key Result ${krIndex + 1}`}
                        />
                        <button
                          type="button"
                          onClick={() =>
                            deleteKeyResult(deptIndex, projIndex, okrIndex, krIndex)
                          }
                          className="text-red-500 text-sm"
                        >
                          🗑️
                        </button>
                      </div>
                    ))}
                    <button
                      type="button"
                      onClick={() => addKeyResult(deptIndex, projIndex, okrIndex)}
                      className="text-sm text-blue-600 underline mt-1"
                    >
                      + KRを追加
                    </button>
                  </div>
                ))}
                <button
                  onClick={() => addOKR(deptIndex, projIndex)}
                  className="text-sm text-blue-600 underline mt-2"
                >
                  + OKRを追加
                </button>
              </div>
            ))}
            <button
              onClick={() => addProject(deptIndex)}
              className="text-sm text-blue-600 underline"
            >
              + プロジェクトを追加
            </button>
          </div>
        ))}
        <button onClick={addDepartment} className="mt-4 text-sm text-blue-600 underline">
          + 部門を追加
        </button>
      </div>

      {/* ✅ 保存・再生成ボタン */}
      <div className="flex gap-4 mt-6">
        <button
          onClick={handleRegenerateCascade}
          className="bg-purple-600 text-white px-4 py-2 rounded hover:bg-purple-700"
        >
          🤖 AIで再生成
        </button>
        <button
          onClick={handleSave}
          className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700"
        >
          保存する
        </button>
      </div>
    </div>
  );
}
