'use client';

import React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import StrategyGuard from '@/app/StrategyGuard';

/**
 * /app/report/stakeholder-select/page.tsx
 *
 * ステークホルダー別計画書の3種類選択画面
 * - 銀行向け経営改善・事業計画書
 * - 株主向け中期経営計画書
 * - 社員向け経営方針・実行計画書
 */

export default function StakeholderSelectPage() {
  const router = useRouter();

  const options = [
    {
      audience: 'bank' as const,
      title: '銀行向け経営改善・事業計画書',
      description:
        '経営課題の分析、改善方針、実行計画、財務予測、返済計画を含む融資判定用の経営計画書',
      icon: '🏦',
      color: 'blue',
      href: '/report/bank-plan',
    },
    {
      audience: 'shareholder' as const,
      title: '株主向け中期経営計画書',
      description:
        '成長戦略、中期財務目標、経営資源配分、株主価値創造施策を中心としたIR資料',
      icon: '📈',
      color: 'green',
      href: '/report/shareholder-plan',
    },
    {
      audience: 'employee' as const,
      title: '社員向け経営方針・実行計画書',
      description:
        'ビジョン・ミッション、全社目標、部門別戦略、個人の役割と育成計画を含む社内向け計画書',
      icon: '👥',
      color: 'purple',
      href: '/report/employee-plan',
    },
  ];

  const colorClasses: Record<string, string> = {
    blue: 'border-blue-200 bg-blue-50 hover:bg-blue-100',
    green: 'border-green-200 bg-green-50 hover:bg-green-100',
    purple: 'border-purple-200 bg-purple-50 hover:bg-purple-100',
  };

  const buttonColorClasses: Record<string, string> = {
    blue: 'bg-blue-600 hover:bg-blue-700 text-white',
    green: 'bg-green-600 hover:bg-green-700 text-white',
    purple: 'bg-purple-600 hover:bg-purple-700 text-white',
  };

  return (
    <StrategyGuard>
      <div className="min-h-screen bg-gradient-to-b from-gray-50 to-gray-100">
        {/* ヘッダー */}
        <div className="bg-white border-b">
          <div className="max-w-6xl mx-auto px-6 py-8">
            <div className="flex items-center justify-between">
              <div>
                <h1 className="text-3xl font-bold text-gray-900">
                  ステークホルダー別経営計画書
                </h1>
                <p className="text-gray-600 mt-2">
                  対象とする利害関係者を選択してください
                </p>
              </div>
              <Link
                href="/report"
                className="text-gray-600 hover:text-gray-900 underline text-sm"
              >
                ← レポート一覧に戻る
              </Link>
            </div>
          </div>
        </div>

        {/* メインコンテンツ */}
        <div className="max-w-6xl mx-auto px-6 py-12">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {options.map((option) => (
              <div
                key={option.audience}
                className={`border-2 rounded-lg p-6 transition-all duration-200 cursor-pointer ${
                  colorClasses[option.color]
                }`}
              >
                {/* アイコン・タイトル */}
                <div className="text-4xl mb-4">{option.icon}</div>
                <h2 className="text-xl font-bold text-gray-900 mb-2">
                  {option.title}
                </h2>

                {/* 説明 */}
                <p className="text-sm text-gray-700 mb-6 min-h-[60px]">
                  {option.description}
                </p>

                {/* 特徴 */}
                <div className="mb-6 space-y-2 text-sm text-gray-700">
                  {option.audience === 'bank' && (
                    <>
                      <div>✓ 経営課題の詳細分析</div>
                      <div>✓ 改善施策と数値計画</div>
                      <div>✓ キャッシュフロー・返済計画</div>
                    </>
                  )}
                  {option.audience === 'shareholder' && (
                    <>
                      <div>✓ 成長戦略と中期目標</div>
                      <div>✓ 財務予測と投資計画</div>
                      <div>✓ 株主価値創造シナリオ</div>
                    </>
                  )}
                  {option.audience === 'employee' && (
                    <>
                      <div>✓ ビジョン・ミッション・目標</div>
                      <div>✓ 部門別戦略と個人OKR</div>
                      <div>✓ 実行スケジュール・育成計画</div>
                    </>
                  )}
                </div>

                {/* ボタン */}
                <Link
                  href={option.href}
                  className={`block w-full py-3 px-4 rounded-lg font-semibold text-center transition-colors ${
                    buttonColorClasses[option.color]
                  }`}
                >
                  計画書を生成
                </Link>
              </div>
            ))}
          </div>

          {/* 情報パネル */}
          <div className="mt-12 bg-white border-l-4 border-blue-500 p-6 rounded">
            <h3 className="font-bold text-gray-900 mb-2">ℹ️ 計画書について</h3>
            <ul className="text-sm text-gray-700 space-y-1">
              <li>
                • 計画書はSTAGE1～6の既存データから自動生成されます
              </li>
              <li>
                • 各ステークホルダーの観点で、異なる章構成・内容で表示されます
              </li>
              <li>
                • プレビュー表示後、PDFダウンロードが可能です
              </li>
              <li>
                • 不足情報は画面に表示されます
              </li>
            </ul>
          </div>
        </div>
      </div>
    </StrategyGuard>
  );
}
