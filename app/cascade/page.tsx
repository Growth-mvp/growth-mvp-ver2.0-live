'use client';

import { useState } from 'react';
import { useStrategyStore } from '@/store/strategyStore';
import { useUserStore } from '@/store/userStore';
import QuestionStepper from '@/components/guide/QuestionStepper';
import CascadeVisualView from '@/components/CascadeVisualView';
import { Wand2, Edit3, LayoutPanelTop, PlusCircle, Trash2 } from 'lucide-react';

export default function CascadePage() {
  const [activeTab, setActiveTab] = useState<'edit' | 'visual'>('edit');
  const {
    story,
    strategySummary,
    thought,
    vision,
    mission,
    industry,
    revenue,
    employees,
    value,
    strength,
    weakness,
    opportunity,
    threat,
    csvFinanceData,
    editableCascadeResult,
    setEditableCascadeResult,
    updateDepartmentAnswer,
    notification,
    setNotification,
  } = useStrategyStore();
  const { user } = useUserStore();
  const role = user?.role;
  const departmentName = user?.department;
  const readOnly = !user || (role !== 'admin' && role !== 'manager');
  const isAdmin = role === 'admin';

  const handleGenerateCascade = async () => {
    if (!user || readOnly) {
      setNotification('⚠️ カスケードの生成権限がありません');
      return;
    }
    setNotification('⏳ カスケード生成中...');
    try {
      const res = await fetch('/api/generate-cascade', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          story, strategySummary, thought, vision, mission,
          industry, revenue, employees, value,
          strength, weakness, opportunity, threat,
          csvFinanceData, departments: editableCascadeResult,
        }),
      });
      const data = await res.json();
      if (res.ok && data.departments) {
        setEditableCascadeResult(data.departments);
        setNotification('✅ カスケード生成に成功しました');
      } else {
        setNotification(`❌ 生成失敗: ${data.error || '不明なエラー'}`);
      }
    } catch {
      setNotification('❌ 通信エラーが発生しました');
    }
  };

  const handleDiscussionChange = (i: number, val: string) => {
    const updated = [...editableCascadeResult];
    updated[i].discussionNotes = val;
    setEditableCascadeResult(updated);
  };

  const handleAddDepartment = () => {
    setEditableCascadeResult([
      ...editableCascadeResult,
      {
        name: `新しい部門${editableCascadeResult.length + 1}`,
        discussionNotes: '',
        missionDraft: '',
        projects: [],
        answers2: [],
      },
    ]);
  };

  const handleDeleteDepartment = (i: number) => {
    const updated = editableCascadeResult.filter((_, idx) => idx !== i);
    setEditableCascadeResult(updated);
  };

  const handleGenerateFirstQuestion = async (index: number) => {
    const dept = editableCascadeResult[index];

    try {
      const res = await fetch('/api/generate-question', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chapterTitle: dept.name,
          chapterBody: dept.missionDraft || '',
          previousAnswer: '',
          stepNumber: 1,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        setNotification(`❌ 質問生成失敗: ${data.error || '不明なエラー'}`);
        return;
      }

      const newStep = {
        stepNumber: 1,
        question: data.step.question,
        reason: data.step.reason,
        answer: '',
      };

      const updated = [...editableCascadeResult];
      updated[index].answers2 = [{
        chapterIndex: index,
        chapterTitle: dept.name,
        steps: [newStep],
      }];
      setEditableCascadeResult(updated);
      setNotification('');
    } catch (err) {
      setNotification('❌ 通信エラーが発生しました');
    }
  };

  return (
    <main className="p-8 min-h-screen bg-gradient-to-b from-white to-gray-50">
      <h1 className="text-2xl font-semibold text-center text-gray-800 mb-4">戦略カスケード</h1>

      {strategySummary && (
        <div className="bg-white border-l-4 border-blue-600 rounded-md shadow p-4 mb-6 max-w-4xl mx-auto">
          <h2 className="text-blue-700 font-semibold text-sm mb-2">経営戦略の要約</h2>
          <p className="text-gray-800 text-sm whitespace-pre-wrap">{strategySummary}</p>
        </div>
      )}

      {!readOnly && (
        <div className="flex justify-center gap-4 mb-6 flex-wrap">
          <button onClick={handleGenerateCascade} className="flex items-center gap-2 px-5 py-2.5 bg-gray-900 text-white rounded hover:bg-gray-700 text-sm">
            <Wand2 className="w-4 h-4" /> カスケードを生成
          </button>
          <button onClick={handleAddDepartment} className="flex items-center gap-2 px-5 py-2.5 bg-blue-600 text-white rounded hover:bg-blue-500 text-sm">
            <PlusCircle className="w-4 h-4" /> 新しい部門を追加
          </button>
        </div>
      )}

      <div className="flex justify-center gap-4 mb-6">
        <button onClick={() => setActiveTab('edit')} className={`flex items-center gap-2 px-4 py-2 text-sm font-medium border rounded transition ${activeTab === 'edit' ? 'bg-gray-900 text-white' : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-100'}`}>
          <Edit3 className="w-4 h-4" /> 編集ビュー
        </button>
        <button onClick={() => setActiveTab('visual')} className={`flex items-center gap-2 px-4 py-2 text-sm font-medium border rounded transition ${activeTab === 'visual' ? 'bg-gray-900 text-white' : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-100'}`}>
          <LayoutPanelTop className="w-4 h-4" /> 構造ビュー
        </button>
      </div>

      {notification && <div className="text-center text-sm text-gray-600 mb-4">{notification}</div>}

      {activeTab === 'edit' ? (
        <div className="space-y-6 max-w-5xl mx-auto">
          {editableCascadeResult.map((dept, index) => {
            const isOwnDept = dept.name === departmentName || isAdmin;
            return (
              <div key={index} className="relative border rounded p-4 bg-white shadow">
                {isAdmin && (
                  <button
                    onClick={() => handleDeleteDepartment(index)}
                    className="absolute top-2 right-2 text-red-600 hover:text-red-800"
                    title="部門を削除"
                  >
                    <Trash2 className="w-5 h-5" />
                  </button>
                )}

                <h2 className="font-semibold text-lg text-gray-800">{dept.name}</h2>

                <div className="mt-2">
                  <label className="block text-sm font-medium text-gray-600 mb-1">部門内議論メモ</label>
                  <textarea
                    value={dept.discussionNotes || ''}
                    onChange={(e) => handleDiscussionChange(index, e.target.value)}
                    readOnly={!isOwnDept || role === 'member'}
                    className="w-full border rounded px-3 py-2 text-sm"
                    rows={3}
                  />
                </div>

                {dept.missionDraft && (
                  <div className="mt-4 text-sm text-gray-800">
                    <div className="font-medium text-blue-600">AIミッション案：</div>
                    <p className="mt-1 whitespace-pre-wrap">{dept.missionDraft}</p>
                  </div>
                )}
                {dept.projects?.length > 0 && (
                  <div className="mt-2 text-sm text-gray-800">
                    <div className="font-medium text-blue-600">AIプロジェクト案：</div>
                    <ul className="list-disc ml-5 mt-1">
                      {dept.projects.map((p, i) => (
                        <li key={i}>{p.title}</li>
                      ))}
                    </ul>
                  </div>
                )}

                <div className="mt-4">
                  {Array.isArray(dept.answers2) && dept.answers2.length > 0 ? (
                    <QuestionStepper
                      questions={dept.answers2[0].steps}
                      chapterTitle={dept.name}
                      chapterBody={dept.missionDraft || ''}
                      chapterIndex={index}
                      onUpdateAnswer={updateDepartmentAnswer}
                    />
                  ) : (
                    isOwnDept && (
                      <button
                        onClick={() => handleGenerateFirstQuestion(index)}
                        className="mt-2 text-sm px-4 py-2 bg-indigo-600 text-white rounded hover:bg-indigo-500"
                      >
                        質問を生成
                      </button>
                    )
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <CascadeVisualView />
      )}
    </main>
  );
}
