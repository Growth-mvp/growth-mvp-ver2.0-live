'use client';

import { useState } from 'react';
import { Department } from '@/store/strategyStore';
import ProjectBlock from './ProjectBlock';
import { PlusCircle, Trash2, MoveUp, MoveDown, Pencil } from 'lucide-react';
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
    setNotification('➕ プロジェクトを追加しました');
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
    <div className="bg-blue-100 border-l-4 border-blue-500 rounded-xl p-4 shadow-md">
      <div className="flex justify-between items-center mb-2">
        <div
          className="cursor-pointer text-blue-800 font-semibold"
          onClick={() => setIsOpen(!isOpen)}
        >
          🏢 {department.name}（部門戦略）{isOpen ? '▲' : '▼'}
        </div>
        <div className="flex gap-2">
          <button onClick={() => setEditingName(true)}><Pencil size={16} /></button>
          <button onClick={() => handleMove('up')}><MoveUp size={16} /></button>
          <button onClick={() => handleMove('down')}><MoveDown size={16} /></button>
          <button onClick={handleDeleteDepartment}><Trash2 size={16} /></button>
        </div>
      </div>

      {editingName && (
        <div className="mb-2 flex gap-2">
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            className="flex-1 border px-2 py-1 rounded text-sm"
          />
          <button
            onClick={handleRename}
            className="bg-blue-600 text-white px-2 rounded text-sm"
          >
            保存
          </button>
        </div>
      )}

      {isOpen && (
        <>
          <p className="text-sm text-gray-700 mb-3 whitespace-pre-wrap">{department.strategy}</p>
          <div className="grid grid-cols-2 gap-2">
            {department.projects.map((project, idx) => (
              <ProjectBlock
                key={idx}
                project={project}
                departmentName={department.name}
                projectIndex={idx}
                deleteProject={deleteProject}  // ✅ 明示的に渡す
              />
            ))}
          </div>
          <button
            onClick={handleAddProject}
            className="mt-3 flex items-center text-sm text-blue-600 hover:underline"
          >
            <PlusCircle size={16} className="mr-1" /> プロジェクトを追加
          </button>
        </>
      )}
    </div>
  );
}
