'use client';

import { useStrategyStore } from '@/store/strategyStore';
import StepLayout from '@/components/StepLayout';

export default function OKRPage() {
  const {
    editableCascadeResult,
    setEditableCascadeResult,
  } = useStrategyStore();

  const handleObjectiveChange = (deptIdx: number, projIdx: number, okrIdx: number, value: string) => {
    const updated = [...editableCascadeResult];
    const okr = updated[deptIdx]?.projects?.[projIdx]?.okrs?.[okrIdx];
    if (okr) {
      okr.objective = value;
      setEditableCascadeResult(updated);
    }
  };

  const handleKeyResultChange = (
    deptIdx: number,
    projIdx: number,
    okrIdx: number,
    krIdx: number,
    value: string
  ) => {
    const updated = [...editableCascadeResult];
    const okr = updated[deptIdx]?.projects?.[projIdx]?.okrs?.[okrIdx];
    if (okr && Array.isArray(okr.keyResults)) {
      okr.keyResults[krIdx] = value;
      setEditableCascadeResult(updated);
    }
  };

  const handleOwnerChange = (deptIdx: number, projIdx: number, okrIdx: number, value: string) => {
    const updated = [...editableCascadeResult];
    const okr = updated[deptIdx]?.projects?.[projIdx]?.okrs?.[okrIdx];
    if (okr) {
      okr.owner = value;
      setEditableCascadeResult(updated);
    }
  };

  const handleAddOKR = (deptIdx: number, projIdx: number) => {
    const updated = [...editableCascadeResult];
    const project = updated[deptIdx]?.projects?.[projIdx];
    if (project) {
      if (!Array.isArray(project.okrs)) project.okrs = [];
      project.okrs.push({
        objective: '',
        keyResults: [''],
        owner: '',
      });
      setEditableCascadeResult(updated);
    }
  };

  const handleDeleteOKR = (deptIdx: number, projIdx: number, okrIdx: number) => {
    const updated = [...editableCascadeResult];
    const okrs = updated[deptIdx]?.projects?.[projIdx]?.okrs;
    if (Array.isArray(okrs)) {
      okrs.splice(okrIdx, 1);
      setEditableCascadeResult(updated);
    }
  };

  const handleAddKeyResult = (deptIdx: number, projIdx: number, okrIdx: number) => {
    const updated = [...editableCascadeResult];
    const okr = updated[deptIdx]?.projects?.[projIdx]?.okrs?.[okrIdx];
    if (okr && Array.isArray(okr.keyResults)) {
      okr.keyResults.push('');
      setEditableCascadeResult(updated);
    }
  };

  const handleDeleteKeyResult = (deptIdx: number, projIdx: number, okrIdx: number, krIdx: number) => {
    const updated = [...editableCascadeResult];
    const okr = updated[deptIdx]?.projects?.[projIdx]?.okrs?.[okrIdx];
    if (okr && Array.isArray(okr.keyResults)) {
      okr.keyResults.splice(krIdx, 1);
      setEditableCascadeResult(updated);
    }
  };

  return (
    <StepLayout step={4} totalSteps={5} title="第4章：物語を行動に落とす（何を達成するのか）">
      <div className="space-y-6">
        <p className="text-gray-700">
          各部門のプロジェクトに対して設定された OKR（Objective & Key Results）を編集・整理しましょう。
        </p>

        {editableCascadeResult?.map((dept, deptIdx) => (
          <div key={deptIdx} className="border rounded-lg p-4 shadow bg-white">
            <h2 className="text-lg font-semibold text-sky-800">【{dept.name}】</h2>

            {dept.projects?.map((proj, projIdx) => (
              <div key={projIdx} className="mt-4 ml-2 border-l-4 border-sky-500 pl-4">
                <h3 className="font-semibold">{proj.title}</h3>

                {proj.okrs?.map((okr, okrIdx) => (
                  <div key={okrIdx} className="mt-2 border p-3 rounded bg-gray-50">
                    <label className="block text-sm font-medium text-gray-700 mb-1">🎯 Objective</label>
                    <input
                      type="text"
                      value={okr.objective ?? ''}
                      onChange={(e) => handleObjectiveChange(deptIdx, projIdx, okrIdx, e.target.value)}
                      className="w-full border rounded px-2 py-1 mb-2"
                    />

                    <label className="block text-sm font-medium text-gray-700 mb-1">📌 Key Results</label>
                    {okr.keyResults?.map((kr, krIdx) => (
                      <div key={krIdx} className="flex items-center gap-2 mb-1">
                        <input
                          type="text"
                          value={kr ?? ''}
                          onChange={(e) =>
                            handleKeyResultChange(deptIdx, projIdx, okrIdx, krIdx, e.target.value)
                          }
                          className="w-full border rounded px-2 py-1"
                        />
                        <button
                          onClick={() => handleDeleteKeyResult(deptIdx, projIdx, okrIdx, krIdx)}
                          className="text-red-500 text-sm"
                        >
                          削除
                        </button>
                      </div>
                    ))}
                    <button
                      onClick={() => handleAddKeyResult(deptIdx, projIdx, okrIdx)}
                      className="text-sm text-blue-600 hover:underline mt-1"
                    >
                      + Key Result を追加
                    </button>

                    <label className="block mt-3 text-sm font-medium text-gray-700 mb-1">👤 Owner</label>
                    <input
                      type="text"
                      value={okr.owner ?? ''}
                      onChange={(e) => handleOwnerChange(deptIdx, projIdx, okrIdx, e.target.value)}
                      className="w-full border rounded px-2 py-1"
                    />

                    <button
                      onClick={() => handleDeleteOKR(deptIdx, projIdx, okrIdx)}
                      className="text-red-600 text-sm mt-2"
                    >
                      このOKRを削除
                    </button>
                  </div>
                ))}

                <button
                  onClick={() => handleAddOKR(deptIdx, projIdx)}
                  className="mt-3 text-blue-600 text-sm hover:underline"
                >
                  + OKRを追加
                </button>
              </div>
            ))}
          </div>
        ))}
      </div>
    </StepLayout>
  );
}
