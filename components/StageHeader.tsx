// /components/StageHeader.tsx - Unified header for STAGE1-6

import React from 'react';

export interface StageHeaderProps {
  stageNum: string; // e.g., "STAGE1", "STAGE2"
  mainTitle: string; // e.g., "会社の現状はどうか"
  subTitle: string; // e.g., "企業価値分析"
  description: string; // e.g., "業績・財務・事業の現状から、変えるべき課題を明らかにします。"
  specialMessage?: string; // STAGE3固有: "そのKPIは、会社を成長へシフトさせているか。"
  children?: React.ReactNode; // For PDF export button, etc.
}

export default function StageHeader({
  stageNum,
  mainTitle,
  subTitle,
  description,
  specialMessage,
  children,
}: StageHeaderProps) {
  return (
    <header className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
      <div className="min-w-0 flex-1">
        {/* 主見出し */}
        <h1 className="text-2xl font-bold tracking-tight text-gray-900">
          {stageNum}｜{mainTitle}
        </h1>

        {/* 副見出し */}
        <div className="mt-1 text-sm font-medium text-gray-700">
          {subTitle}
        </div>

        {/* 説明文 */}
        <p className="mt-2 text-sm text-gray-600">
          {description}
        </p>

        {/* STAGE3固有メッセージ */}
        {specialMessage && (
          <div className="mt-3 text-sm font-semibold text-blue-900 bg-blue-50 border border-blue-200 rounded px-3 py-2">
            {specialMessage}
          </div>
        )}
      </div>

      {/* 右側ボタンエリア */}
      {children && (
        <div className="flex flex-col items-stretch sm:items-end gap-2 sm:gap-3 sm:shrink-0">
          {children}
        </div>
      )}
    </header>
  );
}
