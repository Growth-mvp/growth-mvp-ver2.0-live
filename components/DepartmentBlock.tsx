'use client';

import { useState } from 'react';
import { Department } from '@/types/strategy';
import ProjectBlock from './ProjectBlock';
import QuestionStepper from './guide/QuestionStepper';
import {
  Plus,
  Trash2,
  ArrowUp,
  ArrowDown,
  Pencil,
  ChevronDown,
} from 'lucide-react';
import { useStrategyStore } from '@/store/strategyStore';

interface Props {
  department: Department;
  index: number; // ✅ 追加
  readOnly: boolean;
  isManager: boolean;
  userDepartment?: string;
}

export default function DepartmentBlock({
  department,
  index,
  readOnly,
  isManager,
  userDepartment,
}: Props) {
  const [isOpen, setIsOpen] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [newName, setNewName] = useState(department.name);

  const {
    editableCascadeResult,
    setEditableCascadeResult,
    addProject,
    deleteProject,
    setNotification,
    updateDepartmentAnswer,
  } = useStrategyStore();

  const canEdit = (): boolean => {
    if (readOnly) return false;
    if (isManager) return userDepartment === department.name;
    return true;
  };

  const handleAddProject = () => {
    const newProject = {
      title: '新規プロジェクト',
      reason: '',
      okrs: [{ objective: '', keyResults: [], owner: '' }],
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

  const handleUpdateAnswer = async (
    chapterIdx: number,
    stepIdx: number,
    answer: string
  ) => {
    await updateDepartmentAnswer(chapterIdx, stepIdx, answer); // ✅ string → number
  };

  return (
    <div className="bg-gray-50 border border-gray-200 rounded-xl p-5 shadow-sm mb-6">
      {/* ヘッダー */}
      <div className="flex justify-between items-center mb-3">
        <div
          className="cursor-pointer font-semibold text-gray-800 flex items-center gap-1"
          onClick={() => setIsOpen(!isOpen)}
        >
          <ChevronDown
            className={`transform transition-transform duration-200 ${
              isOpen ? 'rotate-180' : ''
            }`}
            size={16}
          />
          {department.name}（部門戦略）
        </div>

        {canEdit() && (
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
        )}
      </div>

      {/* 名前編集 */}
      {editingName && canEdit() && (
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

      {/* 展開内容 */}
      {isOpen && (
        <>
          <p className="text-sm text-gray-700 mb-3 whitespace-pre-wrap">
            {department.strategy || '（部門戦略が未入力です）'}
          </p>

          {/* 質問ステッパー（answers2に基づく） */}
          {department.answers2 && department.answers2.length > 0 && (
            <QuestionStepper
              questions={department.answers2[0].steps}
              chapterTitle={`${department.name}の戦略`}
              chapterBody={department.strategy || ''}
              chapterIndex={index} // ✅ number 型で渡す
              onUpdateAnswer={handleUpdateAnswer}
            />
          )}

          {/* プロジェクト一覧 */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {department.projects.map((project, idx) => (
              <ProjectBlock
                key={idx}
                project={project}
                departmentName={department.name}
                projectIndex={idx}
                deleteProject={deleteProject}
                readOnly={!canEdit()}
              />
            ))}
          </div>

          {/* プロジェクト追加 */}
          {canEdit() && (
            <button
              onClick={handleAddProject}
              className="mt-4 inline-flex items-center text-sm text-blue-600 hover:underline"
            >
              <Plus size={16} className="mr-1" />
              プロジェクトを追加
            </button>
          )}
        </>
      )}
    </div>
  );
}
