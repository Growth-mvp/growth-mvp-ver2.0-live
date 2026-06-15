'use client';

import { useRouter } from 'next/navigation';
import { FileText, TrendingUp, BookOpen } from 'lucide-react';

interface ReportItem {
  id: string;
  title: string;
  description: string;
  icon: React.ReactNode;
  href: string;
}

export default function ReportPage() {
  const router = useRouter();

  const reports: ReportItem[] = [
    {
      id: 'midterm-plan',
      title: '中計戦略書',
      description: 'STAGE1～4で策定した統合的な中期計画戦略書です。企業全体の方向性、各段階の成果物を一覧で確認できます。',
      icon: <FileText className="h-6 w-6" />,
      href: '/report/midterm-plan',
    },
    {
      id: 'execution-report',
      title: '戦略実行レポート',
      description: 'STAGE5～6の進捗と業績をまとめたレポートです。戦略の実行状況と成果を可視化します。',
      icon: <TrendingUp className="h-6 w-6" />,
      href: '/report/execution-report',
    },
    {
      id: 'stage2-strategy',
      title: '全社戦略書',
      description: 'STAGE2で策定した全社戦略の成果物です。経営層による全社戦略の方向性と重点テーマを確認できます。',
      icon: <BookOpen className="h-6 w-6" />,
      href: '/report/stage2-strategy',
    },
  ];

  return (
    <div className="min-h-screen bg-neutral-50">
      <div className="mx-auto w-full max-w-4xl px-4 py-12">
        {/* ヘッダー */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-neutral-900">レポート</h1>
          <p className="mt-2 text-base text-neutral-600">
            戦略策定から実行までの各段階の成果物を確認できます。
          </p>
        </div>

        {/* レポート一覧 */}
        <div className="grid gap-4">
          {reports.map((report) => (
            <button
              key={report.id}
              onClick={() => router.push(report.href)}
              className="flex items-start gap-4 rounded-lg border border-neutral-300 bg-white p-6 text-left transition-all hover:border-neutral-400 hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2"
            >
              {/* アイコン */}
              <div className="mt-1 flex-shrink-0 text-neutral-600">
                {report.icon}
              </div>

              {/* コンテンツ */}
              <div className="flex-1">
                <h2 className="text-lg font-semibold text-neutral-900">
                  {report.title}
                </h2>
                <p className="mt-2 text-sm text-neutral-600">
                  {report.description}
                </p>
              </div>

              {/* アロー */}
              <div className="mt-1 flex-shrink-0 text-neutral-400">
                →
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
