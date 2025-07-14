// components/CascadeEditView.tsx
'use client';

import { useStrategyStore } from '@/store/strategyStore';
import DepartmentBlock from './DepartmentBlock';
import { PlusCircle, Save, Wand2 } from 'lucide-react';

export default function CascadeEditView() {
  const {
    editableCascadeResult,
    setEditableCascadeResult,
    setNotification,
    saveToSupabase,
  } = useStrategyStore();

  const handleAddDepartment = () => {
    const newDeptName = `新規部門${editableCascadeResult.length + 1}`;
    const newDept = {
      name: newDeptName,
      strategy: 'ここに部門戦略を記入',
      projects: [],
    };
    setEditableCascadeResult([...editableCascadeResult, newDept]);
    setNotification('🏢 部門を追加しました');
  };

  const handleSave = async () => {
    await saveToSupabase();
  };

  const handleGenerate = async () => {
    setNotification('🚧 戦略生成機能は今後実装されます');
  };

  return (
    <div className="p-4 space-y-4">
      <div className="flex gap-3 mb-4">
        <button
          onClick={handleAddDepartment}
          className="flex items-center gap-1 bg-blue-100 hover:bg-blue-200 text-blue-800 px-3 py-1 rounded shadow"
        >
          <PlusCircle size={16} /> 部門を追加
        </button>

        <button
          onClick={handleGenerate}
          className="flex items-center gap-1 bg-green-100 hover:bg-green-200 text-green-800 px-3 py-1 rounded shadow"
        >
          <Wand2 size={16} /> 戦略を再生成
        </button>

        <button
          onClick={handleSave}
          className="flex items-center gap-1 bg-yellow-100 hover:bg-yellow-200 text-yellow-800 px-3 py-1 rounded shadow"
        >
          <Save size={16} /> 保存
        </button>
      </div>

      <div className="space-y-4">
        {editableCascadeResult.map((dept, index) => (
          <DepartmentBlock key={index} department={dept} />
        ))}
      </div>
    </div>
  );
}