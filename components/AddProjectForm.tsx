'use client';

import { useState } from 'react';
import { Project } from '@/store/strategyStore';

interface AddProjectFormProps {
  deptName: string;
  onAdd: (deptName: string, newProject: Project) => void;
}

export default function AddProjectForm({ deptName, onAdd }: AddProjectFormProps) {
  const [projectName, setProjectName] = useState('');
  const [objective, setObjective] = useState('');
  const [keyResults, setKeyResults] = useState<string[]>(['']);

  const handleKRChange = (index: number, value: string) => {
    const updatedKRs = [...keyResults];
    updatedKRs[index] = value;
    setKeyResults(updatedKRs);
  };

  const addKRField = () => {
    setKeyResults([...keyResults, '']);
  };

  const handleSubmit = () => {
    if (!projectName.trim() || !objective.trim()) return;

    const newProject: Project = {
      name: projectName,
      okrs: [
        {
          objective,
          keyResults: keyResults.filter((kr) => kr.trim() !== ''),
        },
      ],
    };

    onAdd(deptName, newProject);

    // 初期化
    setProjectName('');
    setObjective('');
    setKeyResults(['']);
  };

  return (
    <div className="mt-4 p-4 bg-blue-50 rounded border border-blue-200">
      <h3 className="text-sm font-semibold text-blue-700 mb-2">＋ 新規プロジェクトを追加</h3>

      <input
        type="text"
        value={projectName}
        onChange={(e) => setProjectName(e.target.value)}
        placeholder="プロジェクト名"
        className="w-full border border-gray-300 px-2 py-1 mb-2 rounded"
      />

      <input
        type="text"
        value={objective}
        onChange={(e) => setObjective(e.target.value)}
        placeholder="Objective（目的）"
        className="w-full border border-gray-300 px-2 py-1 mb-2 rounded"
      />

      {keyResults.map((kr, index) => (
        <input
          key={index}
          type="text"
          value={kr}
          onChange={(e) => handleKRChange(index, e.target.value)}
          placeholder={`Key Result ${index + 1}`}
          className="w-full ml-2 border border-gray-300 px-2 py-1 mb-1 rounded"
        />
      ))}

      <button
        type="button"
        onClick={addKRField}
        className="text-sm text-blue-600 hover:underline mb-2"
      >
        ＋ KRを追加
      </button>

      <button
        type="button"
        onClick={handleSubmit}
        className="bg-blue-600 text-white px-4 py-2 rounded"
      >
        保存
      </button>
    </div>
  );
}
