'use client';

import { useStrategyStore } from '@/store/strategyStore';
import DepartmentBlock from './DepartmentBlock';
import { Plus, Save, RefreshCw } from 'lucide-react';

interface Props {
  readOnly: boolean;
  isManager: boolean;
  userDepartment: string | undefined;
}

export default function CascadeEditView({
  readOnly,
  isManager,
  userDepartment,
}: Props) {
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
    setNotification('✅ 部門を追加しました');
  };

  const handleSave = async () => {
    await saveToSupabase();
    setNotification('💾 保存しました');
  };

  const handleGenerate = async () => {
    setNotification('🚧 戦略生成機能は今後実装予定です');
  };

  return (
    <div className="p-6 space-y-6 bg-white rounded-lg shadow-sm">
      {/* 操作ボタン：readOnlyでは非表示 */}
      {!readOnly && (
        <div className="flex flex-wrap gap-4">
          <button
            onClick={handleAddDepartment}
            className="flex items-center gap-2 px-4 py-2 bg-gray-900 text-white rounded-md hover:bg-gray-700 transition text-sm"
          >
            <Plus className="w-4 h-4" />
            部門を追加
          </button>

          <button
            onClick={handleGenerate}
            className="flex items-center gap-2 px-4 py-2 bg-gray-200 text-gray-800 rounded-md hover:bg-gray-300 transition text-sm"
          >
            <RefreshCw className="w-4 h-4" />
            戦略を再生成
          </button>

          <button
            onClick={handleSave}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition text-sm"
          >
            <Save className="w-4 h-4" />
            保存
          </button>
        </div>
      )}

      {/* 部門ブロック一覧 */}
      <div className="space-y-6">
        {editableCascadeResult.map((dept, index) => (
          <DepartmentBlock
            key={index}
            department={dept}
            readOnly={readOnly}
            isManager={isManager}
            userDepartment={userDepartment}
          />
        ))}
      </div>
    </div>
  );
}
