'use client';

import { useEffect, useState } from 'react';
import { useStrategyStore } from '@/store/strategyStore';
import { useUserStore } from '@/store/userStore';
import Link from 'next/link';

interface DisplayOKR {
  department: string;
  project: string;
  objective: string;
  owner: string;
  progress: number;
}

export default function ExecutionPage() {
  const { user } = useUserStore();
  const currentUserEmail = user?.email || '';

  const { editableCascadeResult } = useStrategyStore();
  const [userOKRs, setUserOKRs] = useState<DisplayOKR[]>([]);

  useEffect(() => {
    const collectedOKRs: DisplayOKR[] = [];

    editableCascadeResult.forEach((dept) => {
      dept.projects.forEach((proj) => {
        proj.okrs.forEach((okr) => {
          if (okr.owner === currentUserEmail) {
            collectedOKRs.push({
              department: dept.name,
              project: proj.name,
              objective: okr.objective,
              owner: okr.owner,
              progress: 0, // 今後 Supabaseから取得可能
            });
          }
        });
      });
    });

    setUserOKRs(collectedOKRs);
  }, [editableCascadeResult, currentUserEmail]);

  return (
    <main className="p-6 min-h-screen bg-gray-50">
      <h1 className="text-xl font-bold mb-4 text-gray-800">🎯 あなたに割当されたOKR一覧</h1>

      {userOKRs.length === 0 ? (
        <p className="text-gray-500">担当OKRが見つかりませんでした。</p>
      ) : (
        <div className="space-y-4">
          {userOKRs.map((okr, idx) => (
            <div
              key={idx}
              className="border border-gray-300 p-4 rounded-md bg-white shadow-sm"
            >
              <p className="text-sm text-gray-600 mb-1">
                📂 {okr.department} / {okr.project}
              </p>
              <p className="text-base font-semibold text-gray-800 mb-2">
                🎯 {okr.objective}
              </p>
              <p className="text-sm text-gray-500 mb-1">担当者: {okr.owner}</p>
              <div className="h-2 w-full bg-gray-200 rounded-full overflow-hidden">
                <div
                  className="bg-blue-500 h-full"
                  style={{ width: `${okr.progress}%` }}
                ></div>
              </div>
              <Link
                href={`/execution/${idx}`}
                className="text-blue-600 text-sm underline mt-2 inline-block"
              >
                ▶ 詳細・進捗記録ページへ
              </Link>
            </div>
          ))}
        </div>
      )}
    </main>
  );
}
