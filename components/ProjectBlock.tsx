'use client';

import { useState } from 'react';
import { Project } from '@/store/strategyStore';
import { Trash2, PlusCircle, MoveUp, MoveDown } from 'lucide-react';
import { useStrategyStore } from '@/store/strategyStore';

interface Props {
  project: Project;
  departmentName: string;
  projectIndex: number;
}

export default function ProjectBlock({ project, departmentName, projectIndex }: Props) {
  const [isOpen, setIsOpen] = useState(false);
  const { updateProject } = useStrategyStore();

  const handleObjectiveChange = (value: string) => {
    const updated = { ...project };
    updated.okrs[0].objective = value;
    updateProject(departmentName, projectIndex, updated);
  };

  const handleKRChange = (idx: number, value: string) => {
    const updated = { ...project };
    updated.okrs[0].keyResults[idx] = value;
    updateProject(departmentName, projectIndex, updated);
  };

  const addKR = () => {
    const updated = { ...project };
    updated.okrs[0].keyResults.push('新しいKey Result');
    updateProject(departmentName, projectIndex, updated);
  };

  const deleteKR = (idx: number) => {
    const updated = { ...project };
    updated.okrs[0].keyResults.splice(idx, 1);
    updateProject(departmentName, projectIndex, updated);
  };

  const moveKR = (idx: number, dir: 'up' | 'down') => {
    const updated = { ...project };
    const krs = updated.okrs[0].keyResults;
    const newIndex = dir === 'up' ? idx - 1 : idx + 1;
    if (newIndex < 0 || newIndex >= krs.length) return;
    [krs[idx], krs[newIndex]] = [krs[newIndex], krs[idx]];
    updateProject(departmentName, projectIndex, updated);
  };

  return (
    <div className="bg-green-50 border-l-4 border-green-500 p-3 rounded-lg text-sm">
      <div
        className="cursor-pointer text-green-700 font-semibold"
        onClick={() => setIsOpen(!isOpen)}
      >
        📁 {project.name}（プロジェクト）{isOpen ? '▲' : '▼'}
      </div>

      {isOpen && (
        <div className="mt-2">
          <input
            value={project.okrs[0].objective}
            onChange={(e) => handleObjectiveChange(e.target.value)}
            className="w-full mb-2 border px-2 py-1 rounded"
            placeholder="🎯 Objective"
          />
          {project.okrs[0].keyResults.map((kr, idx) => (
            <div key={idx} className="flex gap-2 items-center mb-1">
              <input
                value={kr}
                onChange={(e) => handleKRChange(idx, e.target.value)}
                className="flex-1 border px-2 py-1 rounded"
                placeholder={`KR ${idx + 1}`}
              />
              <button onClick={() => moveKR(idx, 'up')}><MoveUp size={14} /></button>
              <button onClick={() => moveKR(idx, 'down')}><MoveDown size={14} /></button>
              <button onClick={() => deleteKR(idx)}><Trash2 size={14} /></button>
            </div>
          ))}
          <button
            onClick={addKR}
            className="mt-1 text-purple-600 hover:underline flex items-center"
          >
            <PlusCircle size={14} className="mr-1" /> Key Result を追加
          </button>
        </div>
      )}
    </div>
  );
}
