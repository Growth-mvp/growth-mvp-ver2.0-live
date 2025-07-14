'use client';

import { useState } from 'react';
import { Department } from '@/store/strategyStore';
import ProjectBlock from './ProjectBlock';
import { Plus, Trash2, ArrowUp, ArrowDown, Pencil } from 'lucide-react';
import { useStrategyStore } from '@/store/strategyStore';

interface Props {
  department: Department;
}

export default function DepartmentBlock({ department }: Props) {
  const [isOpen, setIsOpen] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [newName, setNewName] = useState(department.name);

  const {
    editableCascadeResult,
    setEditableCascadeResult,
    addProject,
    deleteProject,
    setNotification,
  } = useStrategyStore();

  const handleAddProject = () => {
    const newProject = {
      name: '新規プロジェクト',
      description: '',
      okrs: [{ objective: '', keyResults: [] }],
    };
    addProject(department.name, newProject);
    setNotification('✅ プロジェクトを追加しました');
  };

  const handleDeleteDepartment = () => {
    const updated = editableCascadeResult.filter((d) => d.name !== department.name);
    setEditableCascadeResult(updated);
    setNotification('🗑 部門を削除しました');
  };

  const handleMove = (direction: 'up' | 'down') => {
    const index = editableCascadeResult.findIndex((d) => d.name === department.name);
    const newIndex = direction === 'up' ? index - 1 : index + 1;
    if (newIndex < 0 || newIndex >= editableCascadeResult.length) return;
    const updated = [...editableCascadeResult];
    const temp = updated[index];
    updated[index] = updated[newIndex];
    updated[newIndex] = temp;
    setEditableCascadeResult(updated);
  };

  const handleRename = () => {
    const updated = editableCascadeResult.map((d) =>
      d.name === department.name ? { ...d, name: newName } : d
    );
    setEditableCascadeResult(updated);
    setEditingName(false);
    setNotification('✏️ 部門名を更新しました');
  };

  return (
    <div className="bg-gray-50 border border-gray-200 rounded-xl p-5 shadow-sm">
      {/* ヘッダー部分 */}
      <div className="flex justify-between items-center mb-3">
        <div
          className="cursor-pointer font-semibold text-gray-800"
          onClick={() => setIsOpen(!isOpen)}
        >
          ▸ {department.name}（部門戦略）
        </div>

        <div className="flex items-center gap-2 text-gray-500">
          <button onClick={() => setEditingName(true)} title="部門名変更">
            <Pencil size={16} />
          </button>
          <button onClick={() => handleMove('up')} title="上に移動">
            <ArrowUp size={16} />
          </button>
          <button onClick={() => handleMove('down')} title="下に移動">
            <ArrowDown size={16} />
          </button>
          <button onClick={handleDeleteDepartment} title="部門を削除">
            <Trash2 size={16} />
          </button>
        </div>
      </div>

      {/* 名前編集 */}
      {editingName && (
        <div className="mb-3 flex gap-2">
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            className="flex-1 border border-gray-300 px-2 py-1 rounded text-sm"
          />
          <button
            onClick={handleRename}
            className="px-3 py-1 text-sm bg-gray-800 text-white rounded hover:bg-gray-700"
          >
            保存
          </button>
        </div>
      )}

      {/* コンテンツ展開部分 */}
      {isOpen && (
        <>
          <p className="text-sm text-gray-700 mb-3 whitespace-pre-wrap">{department.strategy}</p>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {department.projects.map((project, idx) => (
              <ProjectBlock
                key={idx}
                project={project}
                departmentName={department.name}
                projectIndex={idx}
                deleteProject={deleteProject}
              />
            ))}
          </div>

          <button
            onClick={handleAddProject}
            className="mt-4 inline-flex items-center text-sm text-blue-600 hover:underline"
          >
            <Plus size={16} className="mr-1" />
            プロジェクトを追加
          </button>
        </>
      )}
    </div>
  );
}
