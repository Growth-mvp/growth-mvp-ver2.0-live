'use client';

import { useState } from 'react';
import { Department } from '@/store/strategyStore';
import ProjectBlock from './ProjectBlock';
import { PlusCircle } from 'lucide-react';
import { useStrategyStore } from '@/store/strategyStore';

interface Props {
  department: Department;
}

export default function DepartmentBlock({ department }: Props) {
  const [isOpen, setIsOpen] = useState(false);
  const { addProject } = useStrategyStore();

  const handleAddProject = () => {
    const newProject = {
      name: '新規プロジェクト',
      description: '',
      okrs: [{ objective: '', keyResults: [] }],
    };
    addProject(department.name, newProject);
  };

  return (
    <div className="bg-blue-100 border-l-4 border-blue-500 rounded-xl p-4 shadow-md">
      <div
        className="cursor-pointer text-blue-800 font-semibold mb-2"
        onClick={() => setIsOpen(!isOpen)}
      >
        🏢 {department.name}（部門戦略）{isOpen ? '▲' : '▼'}
      </div>

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
