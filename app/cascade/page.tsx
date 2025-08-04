'use client';

import { useState } from 'react';
import { useStrategyStore } from '@/store/strategyStore';
import { useUserStore } from '@/store/userStore';
import QuestionStepper from '@/components/guide/QuestionStepper';
import CascadeVisualView from '@/components/CascadeVisualView';
import { PlusCircle, Trash2, CheckCircle2 } from 'lucide-react';

export default function CascadePage() {
  const [activeTab, setActiveTab] = useState<'edit' | 'visual'>('edit');

  const {
    strategySummary,
    story,
    editableCascadeResult,
    setEditableCascadeResult,
    updateDepartmentAnswer,
    notification,
    setNotification,
    regenerateDepartmentMission,
    confirmDepartmentStrategy,
  } = useStrategyStore();

  const { user } = useUserStore();
  const role = user?.role ?? '';
  const departmentName = user?.department ?? '';
  const isAdmin = role === 'admin';

  const handleAddDepartment = () => {
    setEditableCascadeResult([
      ...editableCascadeResult,
      {
        name: `新しい部門${editableCascadeResult.length + 1}`,
        missionDraft: '',
        projects: [],
        answers2: [],
        finalized: false,
      },
    ]);
  };

  const handleDeleteDepartment = (index: number) => {
    setEditableCascadeResult(editableCascadeResult.filter((_, i) => i !== index));
  };

  const handleConfirmDepartment = (index: number) => {
    confirmDepartmentStrategy(index);
    setNotification(`✅ ${editableCascadeResult[index].name} を確定しました`);
  };

  const handleGenerateDepartmentDraft = async (index: number) => {
    const dept = editableCascadeResult[index];
    if (!story || !dept.name) return;

    setNotification(`⏳ ${dept.name}のたたき台を生成中...`);
    try {
      const res = await fetch('/api/generate-department-draft', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ departmentName: dept.name, story }),
      });
      const data = await res.json();
      if (!res.ok || !data) throw new Error(data?.error || '不明なエラー');

      regenerateDepartmentMission(index, data.mission);
      const updated = [...editableCascadeResult];
      updated[index].projects = data.projects.map((title: string) => ({
        title,
        okrs: [{ objective: '', keyResults: [''], owner: '' }],
      }));
      setEditableCascadeResult(updated);
      setNotification(`✅ ${dept.name} のたたき台生成成功`);
    } catch (err) {
      console.error(err);
      setNotification(`❌ ${dept.name} の生成失敗`);
    }
  };

  const handleGenerateInitialQuestion = async (index: number) => {
    const dept = editableCascadeResult[index];
    if (!dept?.missionDraft) return;

    setNotification(`⏳ ${dept.name}の質問生成中...`);
    try {
      const res = await fetch('/api/generate-question', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chapterTitle: dept.name,
          chapterBody: dept.missionDraft,
          previousAnswer: '',
          stepNumber: 1,
        }),
      });

      const data = await res.json();
      if (!res.ok || !data?.step) throw new Error(data?.error || '質問生成に失敗しました');

      const updated = [...editableCascadeResult];
      updated[index].answers2 = [
        {
          chapterIndex: index,
          chapterTitle: dept.name,
          steps: [
            {
              stepNumber: 1,
              question: data.step.question,
              reason: data.step.reason,
              answer: '',
            },
          ],
        },
      ];
      setEditableCascadeResult(updated);
      setNotification(`✅ ${dept.name}の質問生成成功`);
    } catch (err) {
      console.error(err);
      setNotification(`❌ ${dept.name}の質問生成に失敗しました`);
    }
  };

  return (
    <main className="p-8 min-h-screen bg-gradient-to-b from-white to-gray-50">
      <div className="max-w-5xl mx-auto">
        <h1 className="text-2xl font-bold text-gray-800 mb-4">戦略カスケード</h1>

        {strategySummary && (
          <div className="mb-6 p-4 bg-white border rounded shadow">
            <h2 className="font-semibold text-lg mb-2">🧠 戦略サマリー</h2>
            <p className="text-gray-700 whitespace-pre-wrap">{strategySummary}</p>
          </div>
        )}

        {editableCascadeResult.map((dept, index) => (
          <div key={index} className="mb-6 p-4 bg-white border rounded shadow">
            <div className="flex justify-between items-center">
              <h3 className="font-bold text-lg text-gray-800">🏢 {dept.name}</h3>
              <div className="flex gap-2">
                {isAdmin && (
                  <button onClick={() => handleDeleteDepartment(index)} className="text-red-500">
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
                {isAdmin && !dept.finalized && dept.answers2?.[0]?.steps?.every((s) => s.answer) && (
                  <button
                    onClick={() => handleConfirmDepartment(index)}
                    className="text-green-600 hover:underline"
                  >
                    <CheckCircle2 className="inline w-4 h-4 mr-1" /> 確定
                  </button>
                )}
              </div>
            </div>

            <button
              onClick={() => handleGenerateDepartmentDraft(index)}
              className="mt-2 px-4 py-1 bg-blue-600 text-white rounded"
            >
              ✨ AIたたき台生成
            </button>

            {dept.missionDraft && (
              <div className="mt-4">
                <h4 className="font-medium text-sm text-gray-600 mb-1">📌 ミッション</h4>
                <p className="p-2 border rounded bg-gray-50">{dept.missionDraft}</p>
              </div>
            )}

            <div className="mt-4">
              <h4 className="font-medium text-sm text-gray-600 mb-2">📂 プロジェクトとOKR</h4>
              {dept.projects.map((proj, projIndex) => (
                <div key={projIndex} className="mb-4">
                  <p className="font-semibold">{proj.title}</p>
                  <p className="text-sm">🎯 Objective: {proj.okrs?.[0]?.objective || '未入力'}</p>
                  <p className="text-sm">📌 Key Results: {proj.okrs?.[0]?.keyResults?.join(', ') || '未入力'}</p>
                  <p className="text-sm">👤 Owner: {proj.okrs?.[0]?.owner || '未入力'}</p>
                </div>
              ))}
            </div>

            {!dept.answers2 || dept.answers2.length === 0 ? (
              <button
                onClick={() => handleGenerateInitialQuestion(index)}
                className="mt-2 px-4 py-1 bg-purple-600 text-white rounded"
              >
                ❓ 質問を生成
              </button>
            ) : (
              dept.answers2[0]?.steps?.length > 0 && (
                <div className="mt-4">
                  <QuestionStepper
                    questions={dept.answers2[0].steps}
                    chapterTitle={dept.answers2[0].chapterTitle}
                    chapterBody={dept.missionDraft ?? ''}
                    chapterIndex={index}
                    onUpdateAnswer={(chapterIdx, stepIdx, answer) =>
                      updateDepartmentAnswer(index, chapterIdx, stepIdx, answer)
                    }
                  />
                </div>
              )
            )}
          </div>
        ))}

        {isAdmin && (
          <button
            onClick={handleAddDepartment}
            className="flex items-center gap-1 px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-500"
          >
            <PlusCircle className="w-4 h-4" /> 部門を追加
          </button>
        )}
      </div>
    </main>
  );
}
