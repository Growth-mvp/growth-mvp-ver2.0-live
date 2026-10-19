'use client';

import React from 'react';
import Link from 'next/link';

/**
 * 計画書の元データが無い・読み込めないときの案内（読み込み中は表示しない）
 */
export default function PlanSourceNotice({
  status,
  message,
}: {
  status: 'missing' | 'error';
  message?: string;
}) {
  const isError = status === 'error';
  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <div
        className={`bg-white rounded-lg p-8 max-w-md border ${isError ? 'border-red-300' : 'border-amber-300'}`}
      >
        <h1 className={`text-xl font-bold mb-4 ${isError ? 'text-red-600' : 'text-amber-700'}`}>
          {isError ? 'エラー' : '会社データが見つかりません'}
        </h1>
        <p className="text-gray-700 mb-6">
          {isError
            ? message ?? '計画書の読み込みに失敗しました。'
            : '計画書を作成するには、会社情報（STAGE0・STAGE1）の入力が必要です。入力後に、もう一度このページを開いてください。'}
        </p>
        <div className="flex gap-3">
          {!isError && (
            <Link
              href="/stage1"
              className="inline-block bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded"
            >
              STAGE1へ
            </Link>
          )}
          <Link
            href="/report"
            className="inline-block border border-gray-300 hover:bg-gray-50 text-gray-800 px-4 py-2 rounded"
          >
            戻る
          </Link>
        </div>
      </div>
    </div>
  );
}
