"use client";

import { useState } from "react";

// ===== 型定義 =====
type SharedAlignmentTopic = {
  id: string;
  title: string;
  status: "すり合わせ予定" | "すり合わせ中" | "対応方針決定" | "実行中" | "完了";
  importance: "高" | "中" | "低";
  urgency: "高" | "中" | "低";
  category: string;
  priorityScore: number;
  aiSummary: string;
  relatedCaseCount: number;
  impactScope: string;
  targetDepartments: string[];
  summary: string;
  background: string;
  recognitionGap: {
    fieldView: string;
    companyView: string;
    gapEssence: string;
  };
  companyAxis: string;
  sessionType: string;
  alignmentResult: string;
  changedThings: string[];
  unchangedThings: string[];
  nextActions: {
    title: string;
    owner: string;
    dueDate: string;
    status: "未着手" | "対応中" | "完了";
  }[];
  owner: string;
  nextReviewDate: string;
  updatedAt: string;
};

// ===== 仮データ =====
const mockTopics: SharedAlignmentTopic[] = [
  {
    id: "topic-001",
    title: "評価基準と現場貢献のズレ",
    status: "対応方針決定",
    importance: "高",
    urgency: "中",
    category: "評価・顧客価値",
    priorityScore: 86,
    aiSummary:
      "評価に関する不満の中でも、短期売上以外の顧客価値行動が評価されにくいという声が多く、全社的な制度改善論点として集約されています。",
    relatedCaseCount: 38,
    impactScope: "全社",
    targetDepartments: ["営業", "CS", "人事"],
    summary:
      "複数部門から、短期売上以外の貢献が評価されにくいという声が出ています。",
    background:
      "現場では、顧客との長期的な関係構築、トラブルを未然に防ぐ対応、部門間の調整などに時間を使っている一方で、評価面談では売上数値が中心になっていると感じている社員が多い状況です。",
    recognitionGap: {
      fieldView:
        "現場は、顧客継続・改善提案・部門連携も重要な貢献だと認識している。",
      companyView:
        "会社は、今期の売上責任を重要な評価軸として重視している。",
      gapEssence:
        "短期成果と中長期貢献を、評価基準の中でどう扱うかが曖昧になっている。",
    },
    companyAxis:
      "売上責任を維持しながら、顧客価値・改善提案・部門連携も会社の成長に必要な貢献として扱う。",
    sessionType: "制度改善会議",
    alignmentResult:
      "今期は売上責任を重視する方針を維持します。一方で、顧客継続・改善提案・部門連携も評価補助項目として明文化する方針となりました。",
    changedThings: [
      "評価面談で確認する補助項目を整理する",
      "顧客継続・改善提案・部門連携を評価補助項目に含める",
      "管理職向けに評価観点を説明する",
    ],
    unchangedThings: [
      "今期の売上責任は引き続き主要な評価軸とする",
      "最終評価は部門成果と個人成果の両面から判断する",
    ],
    nextActions: [
      {
        title: "評価補助項目案を作成する",
        owner: "人事部",
        dueDate: "2026-06-15",
        status: "対応中",
      },
      {
        title: "管理職向け説明会を実施する",
        owner: "人事部・営業本部",
        dueDate: "2026-06-30",
        status: "未着手",
      },
    ],
    owner: "人事部・営業本部",
    nextReviewDate: "2026-06-30",
    updatedAt: "2026-05-29",
  },
  {
    id: "topic-002",
    title: "顧客価値と短期利益の優先順位のズレ",
    status: "すり合わせ中",
    importance: "高",
    urgency: "高",
    category: "顧客価値・収益性",
    priorityScore: 91,
    aiSummary:
      "短期利益を重視する会社方針と、顧客価値を守りたい現場感覚のズレが複数部門で確認されています。",
    relatedCaseCount: 24,
    impactScope: "複数部門",
    targetDepartments: ["営業", "CS", "財務", "経営"],
    summary:
      "現場では、会社が目先の利益を優先し、お客様を大事にしていないのではないかという不安が出ています。",
    background:
      "短期利益を重視する方針が現場に伝わる一方で、なぜ今それが必要なのか、顧客価値をどう守るのかが十分に説明されていませんでした。",
    recognitionGap: {
      fieldView:
        "現場は、短期利益の追求によって顧客価値が損なわれているのではないかと感じている。",
      companyView:
        "経営は、収益性を改善しなければ将来投資やサービス品質の維持が難しいと認識している。",
      gapEssence:
        "短期利益改善と顧客価値維持をどう両立するかの判断基準が共有されていない。",
    },
    companyAxis:
      "収益性改善と顧客価値維持を対立させず、継続率・解約率・顧客満足を見ながら両立を図る。",
    sessionType: "経営説明・対話会",
    alignmentResult:
      "現在、経営・財務・営業・CSで、利益率改善と顧客価値維持を両立する判断基準を整理しています。",
    changedThings: [
      "利益改善施策の判断時に顧客影響を確認する",
      "解約率・継続率・顧客満足度をあわせて確認する",
    ],
    unchangedThings: ["収益性改善は今期の重要方針として継続する"],
    nextActions: [
      {
        title: "利益率改善と顧客価値維持の判断基準を整理する",
        owner: "経営・財務",
        dueDate: "2026-06-20",
        status: "対応中",
      },
      {
        title: "全社員向けに方針説明を行う",
        owner: "経営",
        dueDate: "2026-07-05",
        status: "未着手",
      },
    ],
    owner: "経営・財務",
    nextReviewDate: "2026-07-05",
    updatedAt: "2026-05-29",
  },
  {
    id: "topic-003",
    title: "部門間の責任範囲のズレ",
    status: "実行中",
    importance: "中",
    urgency: "高",
    category: "部門間連携・責任範囲",
    priorityScore: 78,
    aiSummary:
      "営業・開発・CS間で、顧客要望への対応基準や責任範囲が曖昧になっている声が集約されています。",
    relatedCaseCount: 19,
    impactScope: "部門横断",
    targetDepartments: ["営業", "開発", "CS"],
    summary:
      "営業・開発・CSの間で、顧客要望への対応責任が曖昧になっています。",
    background:
      "受注前の判断、仕様変更の可否、納品後のサポート範囲が明確に整理されておらず、一部の部署にしわ寄せが来ているという声が出ています。",
    recognitionGap: {
      fieldView:
        "各部門は、自部門だけでは判断できない対応を抱え込んでいると感じている。",
      companyView:
        "会社としては、顧客要望に柔軟に対応しつつ、収益性と開発負荷も管理したいと考えている。",
      gapEssence:
        "顧客要望を受ける基準、断る基準、追加費用を求める基準が部門間で揃っていない。",
    },
    companyAxis:
      "顧客対応力を維持しながら、受注前判断・仕様変更・サポート範囲の基準を明確にする。",
    sessionType: "部門横断すり合わせ",
    alignmentResult:
      "顧客要望を「標準対応できるもの」「個別見積・個別判断が必要なもの」「現時点では対応しないもの」に分けて判断する方針となりました。",
    changedThings: [
      "受注前チェックリストを作成する",
      "営業・開発・CSで確認すべき項目を共通化する",
    ],
    unchangedThings: [
      "重要顧客への柔軟対応は継続する",
      "ただし個別対応の判断基準を明確にする",
    ],
    nextActions: [
      {
        title: "受注前チェックリストを作成する",
        owner: "営業企画",
        dueDate: "2026-06-10",
        status: "対応中",
      },
      {
        title: "開発・CSと試験運用を開始する",
        owner: "営業企画・開発・CS",
        dueDate: "2026-06-25",
        status: "未着手",
      },
    ],
    owner: "営業企画",
    nextReviewDate: "2026-06-25",
    updatedAt: "2026-05-28",
  },
  {
    id: "topic-004",
    title: "新施策の目的理解のズレ",
    status: "すり合わせ予定",
    importance: "中",
    urgency: "中",
    category: "新施策・DX・目的理解",
    priorityScore: 69,
    aiSummary:
      "新施策の目的や期待効果が現場に十分伝わっておらず、追加業務として受け止められている声が集約されています。",
    relatedCaseCount: 15,
    impactScope: "全社",
    targetDepartments: ["経営企画", "管理職", "現場"],
    summary:
      "新しい施策やDX施策について、現場から「なぜやるのか分からない」「業務が増えるだけに感じる」という声が出ています。",
    background:
      "会社としては業務効率化と顧客対応品質の向上を目的にしていますが、現場には追加作業として受け止められており、施策の目的と現場の実感にズレがあります。",
    recognitionGap: {
      fieldView: "現場は、新施策を業務負荷の増加として受け止めている。",
      companyView:
        "会社は、将来の業務効率化や顧客品質向上のために必要な施策だと考えている。",
      gapEssence:
        "新施策によって何を減らし、何を改善するのかが十分に説明されていない。",
    },
    companyAxis:
      "施策の目的、期待効果、現場負荷、やめる業務をセットで説明する。",
    sessionType: "部門内すり合わせ",
    alignmentResult:
      "今後の新施策については、開始前に目的・期待効果・現場の負荷・やめる業務をセットで説明する方針とします。",
    changedThings: [
      "新施策開始前の説明項目を標準化する",
      "やめる業務・減らす業務を明示する",
    ],
    unchangedThings: ["業務効率化と顧客対応品質向上のためのDX施策は継続する"],
    nextActions: [
      {
        title: "新施策説明テンプレートを作成する",
        owner: "経営企画",
        dueDate: "2026-06-18",
        status: "未着手",
      },
    ],
    owner: "経営企画",
    nextReviewDate: "2026-06-18",
    updatedAt: "2026-05-27",
  },
  {
    id: "topic-005",
    title: "業務量と人員配置のズレ",
    status: "すり合わせ予定",
    importance: "高",
    urgency: "高",
    category: "業務量・人員配置",
    priorityScore: 88,
    aiSummary:
      "業務量増加と人員配置のズレに関する声が複数部門から出ており、離職・品質低下リスクの観点から優先度が高い論点として整理されています。",
    relatedCaseCount: 31,
    impactScope: "複数部門",
    targetDepartments: ["現場部門", "人事", "部門長"],
    summary:
      "一部の部署で業務量が増え続けており、今の人数では品質を維持できないという声が出ています。",
    background:
      "売上拡大や新施策の増加に伴い、現場の業務量が増えている一方で、人員配置や業務の優先順位見直しが追いついていません。",
    recognitionGap: {
      fieldView:
        "現場は、現在の業務量では品質低下や離職につながると感じている。",
      companyView:
        "会社は、限られた人員の中で成長施策を進める必要があると考えている。",
      gapEssence:
        "増やす業務、やめる業務、任せる業務、自動化する業務の整理が追いついていない。",
    },
    companyAxis:
      "成長施策を進めながら、業務棚卸し・優先順位見直し・人員配置の調整を行う。",
    sessionType: "制度改善会議",
    alignmentResult:
      "まずは業務量の実態を確認し、継続すべき業務・やめる業務・自動化できる業務を整理する方針となりました。",
    changedThings: [
      "各部門で業務棚卸しを実施する",
      "高負荷部署を優先して人員配置と業務優先順位を見直す",
    ],
    unchangedThings: [
      "成長施策そのものは継続する",
      "ただし現場負荷を見ながら進め方を調整する",
    ],
    nextActions: [
      {
        title: "各部門で業務棚卸しを実施する",
        owner: "各部門長",
        dueDate: "2026-06-20",
        status: "未着手",
      },
      {
        title: "高負荷部署の対応方針を検討する",
        owner: "人事・部門長",
        dueDate: "2026-06-30",
        status: "未着手",
      },
    ],
    owner: "人事・部門長",
    nextReviewDate: "2026-06-30",
    updatedAt: "2026-05-27",
  },
];

// ===== ヘルパー関数 =====
const getStatusColor = (status: string) => {
  switch (status) {
    case "すり合わせ予定":
      return "bg-slate-100 text-slate-700";
    case "すり合わせ中":
      return "bg-yellow-100 text-yellow-700";
    case "対応方針決定":
      return "bg-blue-100 text-blue-700";
    case "実行中":
      return "bg-green-100 text-green-700";
    case "完了":
      return "bg-slate-200 text-slate-700";
    default:
      return "bg-slate-100 text-slate-700";
  }
};

const getImportanceColor = (importance: string) => {
  switch (importance) {
    case "高":
      return "bg-red-50 text-red-600";
    case "中":
      return "bg-orange-50 text-orange-600";
    case "低":
      return "bg-slate-50 text-slate-600";
    default:
      return "bg-slate-50 text-slate-600";
  }
};

const getUrgencyColor = (urgency: string) => {
  switch (urgency) {
    case "高":
      return "bg-red-50 text-red-600";
    case "中":
      return "bg-orange-50 text-orange-600";
    case "低":
      return "bg-slate-50 text-slate-600";
    default:
      return "bg-slate-50 text-slate-600";
  }
};

const getPriorityColor = (score: number) => {
  if (score >= 85) return "bg-slate-200 text-slate-900";
  if (score >= 75) return "bg-slate-100 text-slate-800";
  return "bg-slate-50 text-slate-700";
};

// ===== AI集計カードコンポーネント =====
function AiMetricCard({
  label,
  value,
  description,
}: {
  label: string;
  value: string;
  description: string;
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <p className="text-xs font-semibold tracking-wide text-slate-500">{label}</p>
      <p className="mt-2 text-3xl font-bold text-slate-950">{value}</p>
      <p className="mt-2 text-xs leading-5 text-slate-600">{description}</p>
    </div>
  );
}

// ===== プロセスカードコンポーネント =====
function ProcessStep({
  number,
  title,
  description,
}: {
  number: number;
  title: string;
  description: string;
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-center gap-3">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-950 text-sm font-bold text-white">
          {number}
        </div>
        <h3 className="text-sm font-bold text-slate-950">{title}</h3>
      </div>
      <p className="mt-3 text-xs leading-6 text-slate-600">{description}</p>
    </div>
  );
}

// ===== サマリーカードコンポーネント =====
function SummaryCard({
  label,
  count,
  description,
}: {
  label: string;
  count: number;
  description: string;
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <p className="text-sm font-semibold text-slate-500">{label}</p>
      <p className="mt-2 text-4xl font-bold text-slate-950">{count}</p>
      <p className="mt-3 text-xs leading-5 text-slate-600">{description}</p>
    </div>
  );
}


// ===== 簡易横棒グラフ =====
function TopicBarChart({ topics }: { topics: SharedAlignmentTopic[] }) {
  const maxCount = Math.max(...topics.map((topic) => topic.relatedCaseCount));

  return (
    <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="flex flex-col gap-1 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-xs font-semibold tracking-[0.22em] text-slate-500">
            VOICE DISTRIBUTION
          </p>
          <h3 className="mt-2 text-xl font-bold text-slate-950">
            論点別・関連する声の分布
          </h3>
        </div>
        <p className="text-xs text-slate-500">件数が多い論点ほど、横棒が長く表示されます。</p>
      </div>

      <div className="mt-6 space-y-4">
        {topics.map((topic) => {
          const width = Math.max(12, Math.round((topic.relatedCaseCount / maxCount) * 100));
          return (
            <div key={topic.id}>
              <div className="mb-2 flex items-center justify-between gap-4">
                <p className="truncate text-sm font-semibold text-slate-800">{topic.title}</p>
                <p className="shrink-0 text-sm font-bold text-slate-950">{topic.relatedCaseCount}件</p>
              </div>
              <div className="h-3 overflow-hidden rounded-full bg-slate-100">
                <div
                  className="h-full rounded-full bg-slate-800"
                  style={{ width: `${width}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ===== ステータス集計グラフ =====
function StatusChart({ topics }: { topics: SharedAlignmentTopic[] }) {
  const statuses: SharedAlignmentTopic["status"][] = [
    "すり合わせ予定",
    "すり合わせ中",
    "対応方針決定",
    "実行中",
    "完了",
  ];

  return (
    <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
      <p className="text-xs font-semibold tracking-[0.22em] text-slate-500">
        STATUS SUMMARY
      </p>
      <h3 className="mt-2 text-xl font-bold text-slate-950">対応状況の内訳</h3>
      <div className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-5">
        {statuses.map((status) => {
          const count = topics.filter((topic) => topic.status === status).length;
          return (
            <div key={status} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <p className="text-xs font-semibold text-slate-500">{status}</p>
              <p className="mt-2 text-3xl font-bold text-slate-950">{count}</p>
              <p className="mt-1 text-xs text-slate-500">件</p>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ===== 全社論点テーブル =====
function TopicSummaryTable({ topics }: { topics: SharedAlignmentTopic[] }) {
  return (
    <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-100 p-6">
        <p className="text-xs font-semibold tracking-[0.22em] text-slate-500">
          TOPIC DASHBOARD
        </p>
        <h3 className="mt-2 text-xl font-bold text-slate-950">全社論点ダッシュボード</h3>
        <p className="mt-2 text-sm leading-6 text-slate-600">
          AIが集約した論点を、件数・影響範囲・緊急性・重要度・状態で一覧化します。
        </p>
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-slate-100 text-sm">
          <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-5 py-3">論点</th>
              <th className="px-5 py-3">件数</th>
              <th className="px-5 py-3">影響範囲</th>
              <th className="px-5 py-3">緊急性</th>
              <th className="px-5 py-3">重要度</th>
              <th className="px-5 py-3">対象部門</th>
              <th className="px-5 py-3">状態</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 bg-white">
            {topics.map((topic) => (
              <tr key={topic.id} className="align-top">
                <td className="max-w-xs px-5 py-4 font-semibold text-slate-950">{topic.title}</td>
                <td className="px-5 py-4 font-bold text-slate-950">{topic.relatedCaseCount}</td>
                <td className="px-5 py-4 text-slate-700">{topic.impactScope}</td>
                <td className="px-5 py-4">
                  <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${getUrgencyColor(topic.urgency)}`}>
                    {topic.urgency}
                  </span>
                </td>
                <td className="px-5 py-4">
                  <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${getImportanceColor(topic.importance)}`}>
                    {topic.importance}
                  </span>
                </td>
                <td className="px-5 py-4 text-slate-700">{topic.targetDepartments.join("・")}</td>
                <td className="px-5 py-4">
                  <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${getStatusColor(topic.status)}`}>
                    {topic.status}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ===== 5原則カード =====
function PrincipleCard({
  number,
  title,
  description,
}: {
  number: number;
  title: string;
  description: string;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex items-start gap-3">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-100">
          <span className="text-sm font-bold text-slate-700">{number}</span>
        </div>
        <div>
          <h4 className="font-semibold text-slate-950">{title}</h4>
          <p className="mt-1 text-sm leading-6 text-slate-600">{description}</p>
        </div>
      </div>
    </div>
  );
}

// ===== トピックカード =====
function TopicCard({
  topic,
  onExpandClick,
  isExpanded,
}: {
  topic: SharedAlignmentTopic;
  onExpandClick: () => void;
  isExpanded: boolean;
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
      {/* カード上部 */}
      <div className="p-6">
        <div className="flex flex-wrap items-center gap-2 mb-4">
          <span className={`rounded-full px-3 py-1 text-xs font-semibold ${getStatusColor(topic.status)}`}>
            {topic.status}
          </span>
          <span className={`rounded-full px-3 py-1 text-xs font-semibold ${getImportanceColor(topic.importance)}`}>
            重要度: {topic.importance}
          </span>
          <span className={`rounded-full px-3 py-1 text-xs font-semibold ${getUrgencyColor(topic.urgency)}`}>
            緊急度: {topic.urgency}
          </span>
          <span className={`rounded-full px-3 py-1 text-xs font-semibold ${getPriorityColor(topic.priorityScore)}`}>
            優先度: {topic.priorityScore}
          </span>
        </div>

        <h3 className="text-lg font-bold text-slate-950">{topic.title}</h3>

        <p className="mt-3 text-sm leading-7 text-slate-700">{topic.summary}</p>

        <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-white px-3 py-1 text-xs font-semibold text-slate-700 ring-1 ring-slate-200">
              AI集計結果
            </span>
            <span className="rounded-full bg-white px-3 py-1 text-xs font-semibold text-slate-700 ring-1 ring-slate-200">
              {topic.category}
            </span>
          </div>
          <p className="mt-3 text-sm leading-7 text-slate-700">{topic.aiSummary}</p>
        </div>

        <div className="mt-5 grid grid-cols-2 gap-4 md:grid-cols-5">
          <div>
            <p className="text-xs font-semibold text-slate-400">関連する声</p>
            <p className="mt-1 text-lg font-bold text-slate-950">
              {topic.relatedCaseCount}件
            </p>
          </div>
          <div>
            <p className="text-xs font-semibold text-slate-400">優先度</p>
            <p className="mt-1 text-lg font-bold text-slate-950">
              {topic.priorityScore}
            </p>
          </div>
          <div>
            <p className="text-xs font-semibold text-slate-400">影響範囲</p>
            <p className="mt-1 text-sm font-semibold text-slate-950">
              {topic.impactScope}
            </p>
          </div>
          <div>
            <p className="text-xs font-semibold text-slate-400">対象部門</p>
            <p className="mt-1 text-sm font-semibold text-slate-950">
              {topic.targetDepartments.slice(0, 2).join("、")}
              {topic.targetDepartments.length > 2 ? "他" : ""}
            </p>
          </div>
          <div>
            <p className="text-xs font-semibold text-slate-400">すり合わせ種別</p>
            <p className="mt-1 text-sm font-semibold text-slate-950">
              {topic.sessionType}
            </p>
          </div>
        </div>

        <div className="mt-5 flex flex-col gap-2 text-xs text-slate-500 md:flex-row md:gap-6">
          <p>次回確認日: {topic.nextReviewDate}</p>
          <p>更新日: {topic.updatedAt}</p>
        </div>
      </div>

      {/* 展開セクション */}
      {isExpanded && (
        <div className="border-t border-slate-100 bg-slate-50/50 px-6 py-6 space-y-6">
          <div className="rounded-2xl border border-slate-200 bg-white p-5">
            <p className="text-xs font-semibold text-slate-400">AIによる論点集約</p>
            <div className="mt-3 grid gap-3 md:grid-cols-3">
              <div>
                <p className="text-xs font-semibold text-slate-400">主なカテゴリ</p>
                <p className="mt-1 text-sm font-semibold text-slate-950">{topic.category}</p>
              </div>
              <div>
                <p className="text-xs font-semibold text-slate-400">関連する声</p>
                <p className="mt-1 text-sm font-semibold text-slate-950">{topic.relatedCaseCount}件</p>
              </div>
              <div>
                <p className="text-xs font-semibold text-slate-400">推奨される場</p>
                <p className="mt-1 text-sm font-semibold text-slate-950">{topic.sessionType}</p>
              </div>
            </div>
            <p className="mt-4 text-sm leading-7 text-slate-700">{topic.aiSummary}</p>
          </div>

          <div>
            <p className="text-xs font-semibold text-slate-400">背景</p>
            <p className="mt-2 text-sm leading-7 text-slate-700">
              {topic.background}
            </p>
          </div>

          <div className="space-y-4">
            <p className="text-xs font-semibold text-slate-400">認識のズレ</p>
            <div className="grid gap-4 md:grid-cols-3">
              <div className="rounded-lg bg-white border border-slate-200 p-4">
                <p className="text-xs font-semibold text-slate-600 mb-2">
                  現場の認識
                </p>
                <p className="text-sm leading-6 text-slate-700">
                  {topic.recognitionGap.fieldView}
                </p>
              </div>
              <div className="rounded-lg bg-white border border-slate-200 p-4">
                <p className="text-xs font-semibold text-slate-600 mb-2">
                  会社側の認識
                </p>
                <p className="text-sm leading-6 text-slate-700">
                  {topic.recognitionGap.companyView}
                </p>
              </div>
              <div className="rounded-lg bg-white border border-slate-200 p-4">
                <p className="text-xs font-semibold text-slate-600 mb-2">
                  ズレの本質
                </p>
                <p className="text-sm leading-6 text-slate-700">
                  {topic.recognitionGap.gapEssence}
                </p>
              </div>
            </div>
          </div>

          <div>
            <p className="text-xs font-semibold text-slate-400">
              会社としての判断軸
            </p>
            <p className="mt-2 text-sm leading-7 text-slate-700">
              {topic.companyAxis}
            </p>
          </div>

          <div>
            <p className="text-xs font-semibold text-slate-400">
              すり合わせ結果
            </p>
            <p className="mt-2 text-sm leading-7 text-slate-700">
              {topic.alignmentResult}
            </p>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <p className="text-xs font-semibold text-slate-400 mb-3">
                変えること
              </p>
              <ul className="space-y-2">
                {topic.changedThings.map((thing, idx) => (
                  <li
                    key={idx}
                    className="flex gap-2 text-sm leading-6 text-slate-700"
                  >
                    <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-green-500" />
                    {thing}
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <p className="text-xs font-semibold text-slate-400 mb-3">
                変えないこと
              </p>
              <ul className="space-y-2">
                {topic.unchangedThings.map((thing, idx) => (
                  <li
                    key={idx}
                    className="flex gap-2 text-sm leading-6 text-slate-700"
                  >
                    <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-slate-400" />
                    {thing}
                  </li>
                ))}
              </ul>
            </div>
          </div>

          <div>
            <p className="text-xs font-semibold text-slate-400 mb-3">
              次の対応
            </p>
            <div className="space-y-3">
              {topic.nextActions.map((action, idx) => (
                <div key={idx} className="rounded-lg bg-white border border-slate-200 p-4">
                  <p className="font-semibold text-slate-950">{action.title}</p>
                  <div className="mt-2 grid gap-2 text-xs text-slate-600 md:grid-cols-3">
                    <p>担当: {action.owner}</p>
                    <p>期限: {action.dueDate}</p>
                    <p className={`inline-block rounded px-2 py-1 font-semibold ${
                      action.status === "未着手"
                        ? "bg-slate-100 text-slate-700"
                        : action.status === "対応中"
                          ? "bg-yellow-100 text-yellow-700"
                          : "bg-green-100 text-green-700"
                    }`}>
                      {action.status}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="text-xs text-slate-500 pt-4 border-t border-slate-200">
            <p>担当: {topic.owner}</p>
            <p>次回確認日: {topic.nextReviewDate}</p>
          </div>
        </div>
      )}

      {/* カード下部ボタン */}
      <div className="border-t border-slate-100 bg-white px-6 py-4">
        <button
          onClick={onExpandClick}
          className="w-full rounded-xl border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-800 transition-colors hover:bg-slate-100"
        >
          {isExpanded ? "閉じる" : "詳細を見る"}
        </button>
      </div>
    </div>
  );
}

// ===== メインページコンポーネント =====
export default function OrgTransformationSharedPage() {
  const [selectedFilter, setSelectedFilter] = useState<string>("すべて");
  const [expandedTopicId, setExpandedTopicId] = useState<string | null>(null);

  // フィルタリング
  const filteredTopics =
    selectedFilter === "すべて"
      ? mockTopics
      : mockTopics.filter((t) => t.status === selectedFilter);

  // サマリー集計
  const summaryData = {
    shared: mockTopics.length,
    inProgress: mockTopics.filter((t) => t.status === "すり合わせ中").length,
    decided: mockTopics.filter((t) => t.status === "対応方針決定").length,
    executing: mockTopics.filter((t) => t.status === "実行中").length,
  };

  const aiAggregateSummary = {
    totalVoices: mockTopics.reduce((sum, topic) => sum + topic.relatedCaseCount, 0),
    extractedTopics: mockTopics.length,
    alignmentTargets: mockTopics.filter((topic) => topic.status !== "完了").length,
    explanationTargets: mockTopics.filter((topic) => topic.sessionType.includes("説明")).length,
  };

  const processSteps = [
    {
      title: "社員が違和感を入力",
      description: "日々のもやもやや違和感を、個人が特定されない形で蓄積します。",
    },
    {
      title: "AIが認識のズレを整理",
      description: "感情や不満を、判断基準・役割・優先順位のズレとして構造化します。",
    },
    {
      title: "共通論点へ集約",
      description: "類似する声を束ね、会社として扱うべき論点に変換します。",
    },
    {
      title: "優先順位を判定",
      description: "件数、影響範囲、緊急性、顧客影響、離職リスクなどで整理します。",
    },
    {
      title: "関係者ですり合わせ",
      description: "論点に応じて、個別・部門内・部門横断・経営対話の場を設定します。",
    },
    {
      title: "結果を全社共有",
      description: "会社としての判断、変えること、変えないこと、次の対応を共有します。",
    },
  ];

  return (
    <div className="min-h-screen bg-slate-50 px-6 py-8 md:px-8">
      <div className="mx-auto max-w-6xl space-y-12">
        {/* ===== ページヘッダー ===== */}
        <header className="px-1 py-8 md:py-12">
          <p className="mb-3 text-xs font-semibold tracking-[0.28em] text-slate-500">
            ORGANIZATION SHARED ROOM
          </p>

          <h1 className="text-3xl font-bold tracking-tight text-slate-950 md:text-5xl">
            組織変革・全社共有ルーム
          </h1>

          <p className="mt-7 max-w-4xl text-2xl font-semibold leading-relaxed text-slate-950 md:text-3xl">
            現場の声を、会社を前に進める論点へ。
          </p>

          <div className="mt-6 max-w-5xl space-y-4 text-base leading-8 text-slate-700 md:text-lg">
            <p>
              社員から寄せられた違和感やもやもやを、個人が特定されない形で共通論点に整理し、会社としてのすり合わせ状況・判断・対応方針を共有します。
            </p>
            <p>
              目的は、誰かを責めることではありません。
              <br />
              会社が目指す方向に向けて、判断基準・役割・優先順位のズレを整えることです。
            </p>
          </div>
        </header>

        {/* ===== AI集計サマリー ===== */}
        <section className="space-y-6">
          <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm md:p-8">
            <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
              <div className="max-w-3xl">
                <p className="mb-3 text-xs font-semibold tracking-[0.24em] text-slate-500">
                  AI AGGREGATION SUMMARY
                </p>
                <h2 className="text-2xl font-bold text-slate-950">AI集計サマリー</h2>
                <p className="mt-3 text-base leading-8 text-slate-700">
                  社員から寄せられた違和感やもやもやは、個別の不満としてそのまま公開するのではなく、AIが類似する声を分類・集約し、会社として向き合うべき共通論点に整理します。
                </p>
                <p className="mt-2 text-sm leading-7 text-slate-600">
                  個人名や個別投稿本文は公開せず、認識のズレ・影響範囲・重要度・緊急度・推奨されるすり合わせの場を可視化します。
                </p>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-slate-50 px-5 py-4">
                <p className="text-xs font-semibold tracking-wide text-slate-500">表示データ</p>
                <p className="mt-1 text-sm font-bold text-slate-900">デモ用AI集計結果</p>
                <p className="mt-2 text-xs leading-5 text-slate-600">実API接続前の仮データです。将来は投稿データから自動集計します。</p>
              </div>
            </div>

            <div className="mt-6 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
              <AiMetricCard
                label="集計対象の声"
                value={`${aiAggregateSummary.totalVoices}件`}
                description="個人が特定されない形で集計された声"
              />
              <AiMetricCard
                label="抽出された共通論点"
                value={`${aiAggregateSummary.extractedTopics}件`}
                description="AIが類似する声を束ねた論点"
              />
              <AiMetricCard
                label="すり合わせ対象"
                value={`${aiAggregateSummary.alignmentTargets}件`}
                description="関係者ですり合わせるべき論点"
              />
              <AiMetricCard
                label="説明対応が必要な論点"
                value={`${aiAggregateSummary.explanationTargets}件`}
                description="会社方針や判断理由の説明が必要な論点"
              />
            </div>
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <TopicBarChart topics={mockTopics} />
            <StatusChart topics={mockTopics} />
          </div>
        </section>

        {/* ===== 声が論点になるまで ===== */}
        <section className="space-y-5">
          <div>
            <h2 className="text-2xl font-bold text-slate-950">声が論点になるまで</h2>
            <p className="mt-3 leading-8 text-slate-700">
              全社共有ルームでは、個別の声をそのまま並べるのではなく、AI集計によって会社として扱うべき共通論点に変換し、すり合わせと結果共有までつなげます。
            </p>
          </div>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {processSteps.map((step, index) => (
              <ProcessStep
                key={step.title}
                number={index + 1}
                title={step.title}
                description={step.description}
              />
            ))}
          </div>
        </section>

        {/* ===== サマリーカード ===== */}
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
          <SummaryCard
            label="共有中の論点"
            count={summaryData.shared}
            description="全社に公開されている組織論点"
          />
          <SummaryCard
            label="すり合わせ中"
            count={summaryData.inProgress}
            description="現在話し合いが進行中"
          />
          <SummaryCard
            label="対応方針決定"
            count={summaryData.decided}
            description="会社の方針が確定した論点"
          />
          <SummaryCard
            label="実行中の対応"
            count={summaryData.executing}
            description="決定方針を実行中"
          />
        </div>

        {/* ===== すり合わせの5原則 ===== */}
        <section className="space-y-5">
          <div>
            <h2 className="text-2xl font-bold text-slate-950">
              すり合わせの5原則
            </h2>
            <p className="mt-3 leading-8 text-slate-700">
              全社共有ルームでは、個人や部門を責めるのではなく、会社が目指す方向に向けて認識のズレを整えることを目的とします。
            </p>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <PrincipleCard
              number={1}
              title="人や組織を悪者にしない"
              description="個人や部門を責めず、判断基準・役割・優先順位のズレとして扱う。"
            />
            <PrincipleCard
              number={2}
              title="認識のズレをすり合わせる"
              description="それぞれの立場で見えている事実、前提、期待値を確認する。"
            />
            <PrincipleCard
              number={3}
              title="会社の目指す方向性に沿う結論にする"
              description="最終判断は、会社の戦略・顧客価値・業績改善・組織のあるべき姿に照らして行う。"
            />
            <PrincipleCard
              number={4}
              title="変えること・変えないことを明確にする"
              description="改善すること、説明すること、今は変えないことを分ける。"
            />
            <PrincipleCard
              number={5}
              title="結果を共有し、次の行動につなげる"
              description="会社としての判断、次アクション、担当、期限を残す。"
            />
          </div>
        </section>

        {/* ===== 全社論点ダッシュボード表 ===== */}
        <TopicSummaryTable topics={mockTopics} />

        {/* ===== フィルターUI ===== */}
        <section className="space-y-5">
          <div>
            <h2 className="text-2xl font-bold text-slate-950">全社論点一覧</h2>
            <p className="mt-2 text-slate-600">
              社員から寄せられた違和感の整理結果と、会社としてのすり合わせ状況を確認できます。
            </p>
          </div>

          <div className="flex flex-wrap gap-3">
            {[
              "すべて",
              "すり合わせ予定",
              "すり合わせ中",
              "対応方針決定",
              "実行中",
              "完了",
            ].map((filter) => (
              <button
                key={filter}
                onClick={() => setSelectedFilter(filter)}
                className={`rounded-full px-4 py-2 text-sm font-semibold transition-colors ${
                  selectedFilter === filter
                    ? "bg-slate-900 text-white shadow"
                    : "bg-white text-slate-800 border border-slate-300 hover:bg-slate-50"
                }`}
              >
                {filter}
              </button>
            ))}
          </div>
        </section>

        {/* ===== 論点カード一覧 ===== */}
        <div className="space-y-6">
          {filteredTopics.length === 0 ? (
            <div className="rounded-2xl border border-slate-200 bg-white p-6 text-center text-slate-600">
              該当する論点はありません。
            </div>
          ) : (
            filteredTopics.map((topic) => (
              <TopicCard
                key={topic.id}
                topic={topic}
                onExpandClick={() =>
                  setExpandedTopicId(
                    expandedTopicId === topic.id ? null : topic.id
                  )
                }
                isExpanded={expandedTopicId === topic.id}
              />
            ))
          )}
        </div>

        {/* ===== 導線セクション ===== */}
        <section className="space-y-5 py-8">
          <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center">
            <p className="text-lg leading-8 text-slate-700">
              あなたが感じている違和感も、会社を前に進める論点になるかもしれません。
            </p>
            <a
              href="/org-transformation"
              className="mt-6 inline-block rounded-xl border border-slate-300 bg-white px-6 py-3 text-base font-semibold text-slate-800 transition-colors hover:bg-slate-100"
            >
              違和感を整理する
            </a>
          </div>
        </section>
      </div>
    </div>
  );
}
