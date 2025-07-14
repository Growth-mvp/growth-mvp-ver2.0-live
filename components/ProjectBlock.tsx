'use client';

import { useStrategyStore } from '@/store/strategyStore';
import { Trash2, Save, PlusCircle } from 'lucide-react';
import { useState } from 'react';
import type { Project } from '@/store/strategyStore';

interface Props {
  departmentName: string;
  projectIndex: number;
  project: Project;
  deleteProject: (deptName: string, index: number) => void;
}

export default function ProjectBlock({
  departmentName,
  projectIndex,
  project,
  deleteProject,
}: Props) {
  const { updateProject, setNotification } = useStrategyStore();

  const [name, setName] = useState(project?.name || '');
  const [description, setDescription] = useState(project?.description || '');
  const [okrs, setOkrs] = useState(project?.okrs || []);

  const handleSave = () => {
    if (!name.trim()) {
      setNotification('❗プロジェクト名を入力してください');
      return;
    }
    updateProject(departmentName, projectIndex, {
      name,
      description,
      okrs,
    });
    setNotification('✅ プロジェクトを保存しました');
  };

  const handleDelete = () => {
    deleteProject(departmentName, projectIndex);
    setNotification('🗑️ プロジェクトを削除しました');
  };

  const handleOKRChange = (index: number, field: 'objective' | 'keyResults', value: string) => {
    const updated = [...okrs];
    if (field === 'objective') {
      updated[index].objective = value;
    } else {
      updated[index].keyResults = value.split('\n');
    }
    setOkrs(updated);
  };

  const handleAddOKR = () => {
    setOkrs([...okrs, { objective: '', keyResults: [] }]);
  };

  const handleDeleteOKR = (index: number) => {
    const updated = [...okrs];
    updated.splice(index, 1);
    setOkrs(updated);
  };

  return (
    <div className="bg-white rounded-lg p-4 border shadow-sm mb-4">
      <div className="flex justify-between items-center mb-2">
        <input
          className="text-md font-bold border-b w-full mr-2"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="プロジェクト名"
        />
        <div className="flex gap-2">
          <button onClick={handleSave} title="保存">
            <Save size={18} className="text-green-600 hover:text-green-800" />
          </button>
          <button onClick={handleDelete} title="削除">
            <Trash2 size={18} className="text-red-500 hover:text-red-700" />
          </button>
        </div>
      </div>

      <textarea
        className="w-full text-sm border px-2 py-1 rounded"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        placeholder="プロジェクトの説明"
      />

      <div className="mt-4">
        <h5 className="font-semibold mb-1 text-blue-700">🎯 OKR</h5>
        {okrs.map((okr, i) => (
          <div key={i} className="mb-3 border rounded p-2 bg-gray-50">
            <label className="text-xs text-gray-600">Objective</label>
            <input
              className="w-full border text-sm px-2 py-1 rounded mb-1"
              value={okr.objective}
              onChange={(e) => handleOKRChange(i, 'objective', e.target.value)}
              placeholder="O: 目標を入力"
            />
            <label className="text-xs text-gray-600">Key Results（1行1件）</label>
            <textarea
              className="w-full text-sm border px-2 py-1 rounded"
              value={okr.keyResults.join('\n')}
              onChange={(e) => handleOKRChange(i, 'keyResults', e.target.value)}
              placeholder={'KR1: ...\nKR2: ...'}
            />
            <button
              className="mt-1 text-xs text-red-500 hover:underline"
              onClick={() => handleDeleteOKR(i)}
            >
              🗑 このOKRを削除
            </button>
          </div>
        ))}

        <button
          onClick={handleAddOKR}
          className="mt-2 flex items-center gap-1 text-sm text-blue-600 hover:underline"
        >
          <PlusCircle size={16} /> OKRを追加
        </button>
      </div>
    </div>
  );
}
