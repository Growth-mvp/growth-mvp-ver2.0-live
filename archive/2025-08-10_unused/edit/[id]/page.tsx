'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { supabase } from '@/lib/supabaseClient';
import { Department } from '@/types/strategy';
import { useUserStore } from '@/store/userStore';

export default function AdminEditPage() {
  const params = useParams();
  const id = params?.id as string;
  const { user } = useUserStore();

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

  const readOnly = user?.role !== 'admin';

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
        body: JSON.stringify({ mission, vision, value, strength, weakness, opportunity, threat }),
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
    if (readOnly) return;
    setEditableCascadeResult([...editableCascadeResult, { name: '新しい部門', strategy: '', projects: [] }]);
  };

  const deleteDepartment = (deptIndex: number) => {
    if (readOnly) return;
    const updated = [...editableCascadeResult];
    updated.splice(deptIndex, 1);
    setEditableCascadeResult(updated);
  };

  const addProject = (deptIndex: number) => {
    if (readOnly) return;
    const updated = [...editableCascadeResult];
    updated[deptIndex].projects.push({ name: '新しいプロジェクト', description: '', okrs: [] });
    setEditableCascadeResult(updated);
  };

  const deleteProject = (deptIndex: number, projIndex: number) => {
    if (readOnly) return;
    const updated = [...editableCascadeResult];
    updated[deptIndex].projects.splice(projIndex, 1);
    setEditableCascadeResult(updated);
  };

  const addOKR = (deptIndex: number, projIndex: number) => {
    if (readOnly) return;
    const updated = [...editableCascadeResult];
    updated[deptIndex].projects[projIndex].okrs.push({ objective: '', keyResults: [] });
    setEditableCascadeResult(updated);
  };

  const deleteOKR = (deptIndex: number, projIndex: number, okrIndex: number) => {
    if (readOnly) return;
    const updated = [...editableCascadeResult];
    updated[deptIndex].projects[projIndex].okrs.splice(okrIndex, 1);
    setEditableCascadeResult(updated);
  };

  const deleteKeyResult = (deptIndex: number, projIndex: number, okrIndex: number, krIndex: number) => {
    if (readOnly) return;
    const updated = [...editableCascadeResult];
    updated[deptIndex].projects[projIndex].okrs[okrIndex].keyResults.splice(krIndex, 1);
    setEditableCascadeResult(updated);
  };

  const addKeyResult = (deptIndex: number, projIndex: number, okrIndex: number) => {
    if (readOnly) return;
    const updated = [...editableCascadeResult];
    updated[deptIndex].projects[projIndex].okrs[okrIndex].keyResults.push('');
    setEditableCascadeResult(updated);
  };

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <h1 className="text-2xl font-bold">戦略情報の編集</h1>
      {loading && <p className="text-gray-600">読み込み中...</p>}
      {message && <p className="text-green-600">{message}</p>}
      {/* 編集フォームとカスケード構造のレンダリングがここに続きます */}
      <div className="space-y-4">
  {/* 基本情報 */}
  <div>
    <label className="block font-semibold">会社名</label>
    <input
      type="text"
      value={companyName}
      onChange={(e) => setCompanyName(e.target.value)}
      disabled={readOnly}
      className="w-full border rounded p-2"
    />
  </div>

  {/* MVV */}
  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
    <div>
      <label className="block font-semibold">Mission</label>
      <textarea
        value={mission}
        onChange={(e) => setMission(e.target.value)}
        disabled={readOnly}
        className="w-full border rounded p-2"
      />
    </div>
    <div>
      <label className="block font-semibold">Vision</label>
      <textarea
        value={vision}
        onChange={(e) => setVision(e.target.value)}
        disabled={readOnly}
        className="w-full border rounded p-2"
      />
    </div>
    <div>
      <label className="block font-semibold">Value</label>
      <textarea
        value={value}
        onChange={(e) => setValue(e.target.value)}
        disabled={readOnly}
        className="w-full border rounded p-2"
      />
    </div>
  </div>

  {/* SWOT */}
  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
    <div>
      <label className="block font-semibold">Strength</label>
      <textarea
        value={strength}
        onChange={(e) => setStrength(e.target.value)}
        disabled={readOnly}
        className="w-full border rounded p-2"
      />
    </div>
    <div>
      <label className="block font-semibold">Weakness</label>
      <textarea
        value={weakness}
        onChange={(e) => setWeakness(e.target.value)}
        disabled={readOnly}
        className="w-full border rounded p-2"
      />
    </div>
    <div>
      <label className="block font-semibold">Opportunity</label>
      <textarea
        value={opportunity}
        onChange={(e) => setOpportunity(e.target.value)}
        disabled={readOnly}
        className="w-full border rounded p-2"
      />
    </div>
    <div>
      <label className="block font-semibold">Threat</label>
      <textarea
        value={threat}
        onChange={(e) => setThreat(e.target.value)}
        disabled={readOnly}
        className="w-full border rounded p-2"
      />
    </div>
  </div>

  {/* カスケード構造の表示 */}
  <div className="space-y-4">
    <h2 className="text-lg font-semibold">部門構造</h2>
    {!readOnly && (
      <button onClick={addDepartment} className="bg-blue-600 text-white px-3 py-1 rounded">
        ＋ 部門を追加
      </button>
    )}
    {editableCascadeResult.map((dept, deptIndex) => (
      <div key={deptIndex} className="border p-4 rounded bg-white space-y-2">
        <div className="flex items-center justify-between">
          <input
            type="text"
            value={dept.name}
            onChange={(e) => {
              const updated = [...editableCascadeResult];
              updated[deptIndex].name = e.target.value;
              setEditableCascadeResult(updated);
            }}
            disabled={readOnly}
            className="font-bold text-lg border-b w-full"
          />
          {!readOnly && (
            <button onClick={() => deleteDepartment(deptIndex)} className="text-red-600 ml-2">
              削除
            </button>
          )}
        </div>

        <textarea
          value={dept.strategy}
          onChange={(e) => {
            const updated = [...editableCascadeResult];
            updated[deptIndex].strategy = e.target.value;
            setEditableCascadeResult(updated);
          }}
          disabled={readOnly}
          className="w-full border rounded p-2"
        />

        {/* プロジェクト表示 */}
        {dept.projects.map((proj, projIndex) => (
          <div key={projIndex} className="border p-2 rounded bg-gray-50 space-y-2 ml-4">
            <input
              type="text"
              value={proj.name}
              onChange={(e) => {
                const updated = [...editableCascadeResult];
                updated[deptIndex].projects[projIndex].name = e.target.value;
                setEditableCascadeResult(updated);
              }}
              disabled={readOnly}
              className="w-full border-b"
            />
            <textarea
              value={proj.description}
              onChange={(e) => {
                const updated = [...editableCascadeResult];
                updated[deptIndex].projects[projIndex].description = e.target.value;
                setEditableCascadeResult(updated);
              }}
              disabled={readOnly}
              className="w-full border rounded p-2"
            />
            {!readOnly && (
              <button
                onClick={() => deleteProject(deptIndex, projIndex)}
                className="text-red-500 text-sm"
              >
                プロジェクト削除
              </button>
            )}

            {/* OKR表示 */}
            {proj.okrs.map((okr, okrIndex) => (
              <div key={okrIndex} className="bg-white p-2 rounded border space-y-1 ml-4">
                <input
                  type="text"
                  value={okr.objective}
                  onChange={(e) => {
                    const updated = [...editableCascadeResult];
                    updated[deptIndex].projects[projIndex].okrs[okrIndex].objective =
                      e.target.value;
                    setEditableCascadeResult(updated);
                  }}
                  disabled={readOnly}
                  placeholder="Objective"
                  className="w-full border-b"
                />
                {okr.keyResults.map((kr, krIndex) => (
                  <div key={krIndex} className="flex gap-2 items-center">
                    <input
                      type="text"
                      value={kr}
                      onChange={(e) => {
                        const updated = [...editableCascadeResult];
                        updated[deptIndex].projects[projIndex].okrs[okrIndex].keyResults[krIndex] =
                          e.target.value;
                        setEditableCascadeResult(updated);
                      }}
                      disabled={readOnly}
                      className="w-full border-b"
                    />
                    {!readOnly && (
                      <button
                        onClick={() =>
                          deleteKeyResult(deptIndex, projIndex, okrIndex, krIndex)
                        }
                        className="text-red-500"
                      >
                        ✕
                      </button>
                    )}
                  </div>
                ))}
                {!readOnly && (
                  <button
                    onClick={() => addKeyResult(deptIndex, projIndex, okrIndex)}
                    className="text-blue-500 text-sm"
                  >
                    ＋ KRを追加
                  </button>
                )}
                {!readOnly && (
                  <button
                    onClick={() => deleteOKR(deptIndex, projIndex, okrIndex)}
                    className="text-red-500 text-sm"
                  >
                    OKR削除
                  </button>
                )}
              </div>
            ))}

            {!readOnly && (
              <button
                onClick={() => addOKR(deptIndex, projIndex)}
                className="text-blue-500 text-sm"
              >
                ＋ OKRを追加
              </button>
            )}
          </div>
        ))}

        {!readOnly && (
          <button
            onClick={() => addProject(deptIndex)}
            className="bg-gray-200 px-2 py-1 rounded text-sm"
          >
            ＋ プロジェクト追加
          </button>
        )}
      </div>
    ))}
  </div>

  {/* アクションボタン */}
  <div className="flex gap-4 mt-6">
    {!readOnly && (
      <>
        <button onClick={handleSave} className="bg-green-600 text-white px-4 py-2 rounded">
          💾 保存
        </button>
        <button
          onClick={handleRegenerateCascade}
          className="bg-purple-600 text-white px-4 py-2 rounded"
        >
          ♻ AIで再生成
        </button>
      </>
    )}
  </div>
</div>

    </div>
  );
}
