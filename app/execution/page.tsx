'use client';

import { useEffect, useMemo, useState } from 'react';
import { useStrategyStore } from '@/store/strategyStore';
import { useUserStore } from '@/store/userStore';
import { saveProgressLog } from '@/utils/supabase';
import { supabase } from '@/lib/supabaseClient';

export default function ExecutionPage() {
  const { editableCascadeResult, strategySummary, story } = useStrategyStore();
  const { user } = useUserStore();

  const [progressNotes, setProgressNotes] = useState<{ [key: string]: string }>({});
  const [progressHistory, setProgressHistory] = useState<{ [key: string]: string[] }>({});
  const [message, setMessage] = useState('');

  const userId = useMemo(() => user?.id ?? '', [user]);

  useEffect(() => {
    if (!userId) return;
    loadProgressLogs(userId);
  }, [userId]);

  const loadProgressLogs = async (userId: string) => {
    const { data, error } = await supabase
      .from('progress_logs')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('❌ 進捗履歴の取得に失敗:', error.message);
      return;
    }

    const historyMap: { [key: string]: string[] } = {};
    data.forEach((log) => {
      if (!historyMap[log.okr_id]) historyMap[log.okr_id] = [];
      historyMap[log.okr_id].push(
        `${log.progress_text}（${new Date(log.created_at).toLocaleString()}）`
      );
    });

    setProgressHistory(historyMap);
  };

  const handleChange = (okrId: string, value: string) => {
    setProgressNotes((prev) => ({ ...prev, [okrId]: value }));
  };

  const handleSave = async (okrId: string) => {
    if (!userId) {
      setMessage('❌ ユーザーが未ログインです');
      return;
    }

    const text = progressNotes[okrId];
    if (!text || !text.trim()) {
      alert('進捗内容を入力してください');
      return;
    }

    const error = await saveProgressLog(userId, okrId, text);
    if (error) {
      alert(`❌ 保存失敗: ${okrId}`);
      return;
    }

    setMessage(`✅ 保存しました（${okrId}）`);
    await loadProgressLogs(userId);
  };

  const canEdit = (deptName: string, okrOwner: string | undefined): boolean => {
    if (!user) return false;
    if (user.role === 'admin') return true;
    if (user.role === 'manager') return user.department === deptName;
    if (user.role === 'member') return user.name === (okrOwner ?? '');
    return false;
  };

  return (
    <main className="p-6 bg-gradient-to-b from-gray-50 to-white min-h-screen">
      <h1 className="text-2xl font-bold mb-6 text-gray-800">🛠 OKR実行支援画面</h1>

      {story && Array.isArray(story) && story.length > 0 && (
        <div className="mb-6 bg-white border-l-4 border-blue-600 p-4 rounded shadow-sm">
          <h2 className="text-blue-700 text-sm font-semibold mb-2">経営ストーリー</h2>
          {story.map((chapter, idx) => (
            <section key={idx} className="mb-4">
              <h3 className="text-md font-bold text-blue-800 mb-1">{chapter.title}</h3>
              <p className="text-sm text-gray-800 whitespace-pre-wrap">{chapter.body}</p>
            </section>
          ))}
        </div>
      )}

      {strategySummary && (
        <div className="mb-6 bg-white border-l-4 border-green-600 p-4 rounded shadow-sm">
          <h2 className="text-green-700 text-sm font-semibold mb-2">戦略要約</h2>
          <p className="text-sm text-gray-800 whitespace-pre-wrap">{strategySummary}</p>
        </div>
      )}

      {message && <p className="mb-4 text-green-600 font-semibold">{message}</p>}

      {editableCascadeResult.map((dept) => (
        <div key={dept.name} className="mb-8 border p-4 rounded-lg bg-white shadow">
          <h2 className="text-lg font-semibold text-blue-700 mb-2">{dept.name}</h2>

          {dept.projects.map((proj, i) => (
            <div key={i} className="ml-4 mb-4">
              <h3 className="font-semibold text-gray-700">{proj.name}</h3>

              {proj.okrs.map((okr, j) => {
                const okrId = `${dept.name}-${proj.name}-${j}`;
                const editable = canEdit(dept.name, okr.owner);

                return (
                  <div key={okrId} className="mt-3 ml-4 border rounded p-3 bg-gray-50">
                    <p className="font-medium mb-1">🎯 {okr.objective}</p>

                    <textarea
                      className={`mt-1 w-full border rounded p-2 text-sm ${
                        !editable ? 'bg-gray-100 text-gray-500' : 'bg-white'
                      }`}
                      rows={3}
                      placeholder="進捗状況や課題を入力"
                      value={progressNotes[okrId] || ''}
                      onChange={(e) => handleChange(okrId, e.target.value)}
                      readOnly={!editable}
                    />

                    {editable && (
                      <div className="text-right mt-2">
                        <button
                          className="px-4 py-1 bg-blue-600 text-white rounded hover:bg-blue-700 text-sm"
                          onClick={() => handleSave(okrId)}
                        >
                          💾 保存
                        </button>
                      </div>
                    )}

                    {progressHistory[okrId] && (
                      <div className="mt-3 text-sm text-gray-600">
                        <p className="font-semibold mb-1">📜 保存履歴:</p>
                        <ul className="list-disc list-inside space-y-1">
                          {progressHistory[okrId].map((entry, idx) => (
                            <li key={idx}>{entry}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      ))}
    </main>
  );
}
