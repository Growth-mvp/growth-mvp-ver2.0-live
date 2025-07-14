'use client';

import { useStrategyStore } from '@/store/strategyStore';
import { Trash2, Save, Plus } from 'lucide-react';
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
    updateProject(departmentName, projectIndex, { name, description, okrs });
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
    <div className="bg-white border border-gray-200 rounded-xl p-4 shadow-sm space-y-4">
      {/* タイトルと操作ボタン */}
      <div className="flex justify-between items-center">
        <input
          className="text-md font-semibold text-gray-800 border-b border-gray-300 focus:outline-none focus:border-blue-500 flex-1 mr-2"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="プロジェクト名"
        />
        <div className="flex items-center gap-2 text-gray-500">
          <button onClick={handleSave} title="保存">
            <Save size={18} className="hover:text-green-600" />
          </button>
          <button onClick={handleDelete} title="削除">
            <Trash2 size={18} className="hover:text-red-500" />
          </button>
        </div>
      </div>

      {/* 説明エリア */}
      <textarea
        className="w-full text-sm border border-gray-300 px-3 py-2 rounded focus:outline-none focus:ring-1 focus:ring-blue-400"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        placeholder="プロジェクトの説明"
      />

      {/* OKRエリア */}
      <div>
        <h5 className="font-semibold text-gray-700 mb-2">OKR</h5>
        {okrs.map((okr, i) => (
          <div key={i} className="border border-gray-200 rounded-md p-3 mb-3 bg-gray-50 space-y-2">
            <div>
              <label className="text-xs text-gray-500">Objective</label>
              <input
                className="w-full text-sm border border-gray-300 px-2 py-1 rounded focus:outline-none focus:ring-1 focus:ring-blue-400"
                value={okr.objective}
                onChange={(e) => handleOKRChange(i, 'objective', e.target.value)}
                placeholder="O: 目標を入力"
              />
            </div>
            <div>
              <label className="text-xs text-gray-500">Key Results（1行ごと）</label>
              <textarea
                className="w-full text-sm border border-gray-300 px-2 py-1 rounded focus:outline-none focus:ring-1 focus:ring-blue-400"
                value={okr.keyResults.join('\n')}
                onChange={(e) => handleOKRChange(i, 'keyResults', e.target.value)}
                placeholder={'KR1: ...\nKR2: ...'}
              />
            </div>
            <button
              className="text-xs text-red-500 hover:underline"
              onClick={() => handleDeleteOKR(i)}
            >
              このOKRを削除
            </button>
          </div>
        ))}

        <button
          onClick={handleAddOKR}
          className="mt-2 inline-flex items-center gap-1 text-sm text-blue-600 hover:underline"
        >
          <Plus size={16} />
          OKRを追加
        </button>
      </div>
    </div>
  );
}
