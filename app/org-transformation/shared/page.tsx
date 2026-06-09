"use client";

import { useMemo, useState, useEffect } from "react";
import { safeGetSession } from "@/utils/supabase/client";

// ===== 型定義 =====
type TopicStatus = "すり合わせ予定" | "すり合わせ中" | "対応方針決定" | "実行中" | "完了";
type Level = "高" | "中" | "低";
type ActionStatus = "未着手" | "対応中" | "完了";
type Stage3Status = "未反映" | "反映候補" | "反映済み";
type Stage4Status = "未反映" | "OKR化候補" | "OKR化済み";

type NextAction = {
  title: string;
  owner: string;
  dueDate: string;
  status: ActionStatus;
};

type StrategyReflection = {
  stage3Status: Stage3Status;
  stage4Status: Stage4Status;
  relatedDepartments: string[];
  generatedProjects: {
    departmentName: string;
    projectTitle: string;
    projectSummary: string;
  }[];
  generatedOkrs: {
    objective: string;
    keyResults: string[];
    owner: string;
    dueDate: string;
  }[];
};

type SharedAlignmentTopic = {
  id: string;
  title: string;
  status: TopicStatus;
  importance: Level;
  urgency: Level;
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
  nextActions: NextAction[];
  strategyReflection: StrategyReflection;
  owner: string;
  nextReviewDate: string;
  updatedAt: string;
};

// ===== ステータスマッピング =====
function mapDbStatusToUiStatus(dbStatus: string): TopicStatus {
  switch (dbStatus) {
    case 'published':
      return 'すり合わせ予定';
    case 'in_alignment':
      return 'すり合わせ中';
    case 'action_planned':
      return '対応方針決定';
    case 'reflected':
      return '実行中';
    case 'closed':
      return '完了';
    default:
      return 'すり合わせ予定';
  }
}

// ===== 仮データ（フォールバック用） =====
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
    strategyReflection: {
      stage3Status: "反映候補",
      stage4Status: "OKR化候補",
      relatedDepartments: ["人事", "営業", "CS"],
      generatedProjects: [
        {
          departmentName: "人事",
          projectTitle: "顧客価値行動を反映した評価補助項目の設計",
          projectSummary:
            "短期売上だけでなく、顧客継続・改善提案・部門連携を評価補助項目として明文化する。",
        },
        {
          departmentName: "営業",
          projectTitle: "短期売上と顧客継続を両立する営業行動基準の整備",
          projectSummary:
            "売上責任を維持しながら、顧客継続や改善提案につながる行動を営業活動基準に反映する。",
        },
        {
          departmentName: "CS",
          projectTitle: "顧客継続・改善提案の貢献可視化",
          projectSummary:
            "CS部門の顧客継続・改善提案・部門連携の貢献を可視化し、評価補助項目へ接続する。",
        },
      ],
      generatedOkrs: [
        {
          objective:
            "顧客価値につながる現場貢献が正しく評価される状態をつくる",
          keyResults: [
            "評価補助項目案を6月末までに作成する",
            "管理職向け説明会を対象者100%に実施する",
            "評価面談で補助項目を試行導入する部門を3部門選定する",
          ],
          owner: "人事部・営業本部・CS責任者",
          dueDate: "2026-09-30",
        },
      ],
    },
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
    strategyReflection: {
      stage3Status: "反映候補",
      stage4Status: "OKR化候補",
      relatedDepartments: ["経営", "財務", "営業", "CS"],
      generatedProjects: [
        {
          departmentName: "経営",
          projectTitle: "収益性改善と顧客価値維持の判断基準整備",
          projectSummary:
            "利益率改善施策を進める際に、顧客価値・継続率・解約率を同時に確認する判断基準を整備する。",
        },
        {
          departmentName: "営業",
          projectTitle: "顧客価値を損なわない収益改善提案プロセスの整備",
          projectSummary:
            "値引き・価格改定・契約条件変更などの場面で、顧客影響を確認しながら収益性を改善する。",
        },
      ],
      generatedOkrs: [
        {
          objective:
            "収益性改善と顧客価値維持を両立する判断基準を全社で共有する",
          keyResults: [
            "利益改善施策の顧客影響チェック項目を6月末までに作成する",
            "主要顧客の解約率・継続率・満足度を月次で確認する",
            "全社員向け方針説明会を7月上旬までに実施する",
          ],
          owner: "経営・財務・営業責任者",
          dueDate: "2026-09-30",
        },
      ],
    },
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
      "顧客要望を『標準対応できるもの』『個別見積・個別判断が必要なもの』『現時点では対応しないもの』に分けて判断する方針となりました。",
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
    strategyReflection: {
      stage3Status: "反映済み",
      stage4Status: "OKR化候補",
      relatedDepartments: ["営業", "開発", "CS"],
      generatedProjects: [
        {
          departmentName: "営業企画",
          projectTitle: "受注前チェックリストの整備",
          projectSummary:
            "顧客要望の受注前確認項目を標準化し、営業・開発・CSの判断基準を揃える。",
        },
        {
          departmentName: "開発",
          projectTitle: "仕様変更判断基準の明文化",
          projectSummary:
            "標準対応・個別見積・対応対象外の判断基準を整理し、現場で迷わない運用にする。",
        },
      ],
      generatedOkrs: [
        {
          objective:
            "営業・開発・CSが共通基準で顧客要望を判断できる状態をつくる",
          keyResults: [
            "受注前チェックリストを6月10日までに作成する",
            "営業・開発・CSで試験運用する案件を10件選定する",
            "顧客要望対応の差し戻し件数を20%削減する",
          ],
          owner: "営業企画・開発・CS責任者",
          dueDate: "2026-09-30",
        },
      ],
    },
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
      "新しい施策やDX施策について、現場から『なぜやるのか分からない』『業務が増えるだけに感じる』という声が出ています。",
    background:
      "会社としては業務効率化と顧客対応品質の向上を目的にしていますが、現場には追加作業として受け止められており、施策の目的と現場の実感にズレがあります。",
    recognitionGap: {
      fieldView:
        "現場は、新施策を業務負荷の増加として受け止めている。",
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
    strategyReflection: {
      stage3Status: "反映候補",
      stage4Status: "未反映",
      relatedDepartments: ["経営企画", "管理職", "現場部門"],
      generatedProjects: [
        {
          departmentName: "経営企画",
          projectTitle: "新施策説明テンプレートの整備",
          projectSummary:
            "施策開始前に目的・期待効果・現場負荷・やめる業務を明示する標準テンプレートを作成する。",
        },
      ],
      generatedOkrs: [
        {
          objective:
            "新施策の目的と現場負荷が事前に共有される状態をつくる",
          keyResults: [
            "新施策説明テンプレートを6月18日までに作成する",
            "新規施策の説明資料で『やめる業務』を100%明記する",
            "施策開始前アンケートで目的理解度80%以上を達成する",
          ],
          owner: "経営企画",
          dueDate: "2026-09-30",
        },
      ],
    },
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
    strategyReflection: {
      stage3Status: "反映候補",
      stage4Status: "OKR化候補",
      relatedDepartments: ["現場部門", "人事", "部門長"],
      generatedProjects: [
        {
          departmentName: "人事",
          projectTitle: "高負荷部署の業務棚卸しと人員配置見直し",
          projectSummary:
            "業務量の実態を確認し、継続すべき業務・やめる業務・自動化できる業務を整理する。",
        },
        {
          departmentName: "現場部門",
          projectTitle: "業務優先順位の再設計",
          projectSummary:
            "成長施策を進めるために、現場業務の優先順位と削減対象を明確化する。",
        },
      ],
      generatedOkrs: [
        {
          objective:
            "成長施策を進めながら現場負荷を適正化する",
          keyResults: [
            "全対象部門で業務棚卸しを6月20日までに実施する",
            "高負荷部署の対応方針を6月末までに決定する",
            "自動化・廃止候補業務を10件以上特定する",
          ],
          owner: "人事・各部門長",
          dueDate: "2026-09-30",
        },
      ],
    },
    owner: "人事・部門長",
    nextReviewDate: "2026-06-30",
    updatedAt: "2026-05-27",
  },
];

const filters: (TopicStatus | "すべて")[] = [
  "すべて",
  "すり合わせ予定",
  "すり合わせ中",
  "対応方針決定",
  "実行中",
  "完了",
];

// ===== ヘルパー関数 =====
const getStatusColor = (status: TopicStatus | ActionStatus | Stage3Status | Stage4Status) => {
  switch (status) {
    case "すり合わせ予定":
    case "反映候補":
    case "OKR化候補":
      return "bg-slate-100 text-slate-700 ring-1 ring-slate-200";
    case "すり合わせ中":
    case "対応中":
      return "bg-amber-50 text-amber-700 ring-1 ring-amber-100";
    case "対応方針決定":
    case "反映済み":
    case "OKR化済み":
      return "bg-blue-50 text-blue-700 ring-1 ring-blue-100";
    case "実行中":
      return "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100";
    case "完了":
      return "bg-slate-200 text-slate-700 ring-1 ring-slate-300";
    case "未反映":
    case "未着手":
      return "bg-white text-slate-600 ring-1 ring-slate-200";
    default:
      return "bg-slate-100 text-slate-700 ring-1 ring-slate-200";
  }
};

const getLevelColor = (level: Level) => {
  switch (level) {
    case "高":
      return "bg-rose-50 text-rose-700 ring-1 ring-rose-100";
    case "中":
      return "bg-orange-50 text-orange-700 ring-1 ring-orange-100";
    case "低":
      return "bg-slate-50 text-slate-600 ring-1 ring-slate-200";
    default:
      return "bg-slate-50 text-slate-600 ring-1 ring-slate-200";
  }
};

const getPriorityColor = (score: number) => {
  if (score >= 85) return "bg-slate-900 text-white";
  if (score >= 75) return "bg-slate-200 text-slate-900";
  return "bg-slate-100 text-slate-700";
};

function handleDemoAction(message: string) {
  window.alert(`${message}\n※デモ画面のため、保存処理は未実装です。`);
}

// ===== 共通コンポーネント =====
function MetricCard({ label, value, description }: { label: string; value: string; description: string }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <p className="text-xs font-semibold tracking-wide text-slate-500">{label}</p>
      <p className="mt-2 text-3xl font-bold text-slate-950">{value}</p>
      <p className="mt-2 text-xs leading-5 text-slate-600">{description}</p>
    </div>
  );
}

function ProcessStep({ number, title, description }: { number: number; title: string; description: string }) {
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

function PrincipleCard({ number, title, description }: { number: number; title: string; description: string }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
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

function TopicBarChart({ topics }: { topics: SharedAlignmentTopic[] }) {
  const maxCount = Math.max(...topics.map((topic) => topic.relatedCaseCount));

  return (
    <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="flex flex-col gap-1 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-xs font-semibold tracking-[0.22em] text-slate-500">VOICE DISTRIBUTION</p>
          <h3 className="mt-2 text-xl font-bold text-slate-950">論点別・関連する声の分布</h3>
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
                <div className="h-full rounded-full bg-slate-800" style={{ width: `${width}%` }} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function StatusChart({ topics }: { topics: SharedAlignmentTopic[] }) {
  const statuses: TopicStatus[] = ["すり合わせ予定", "すり合わせ中", "対応方針決定", "実行中", "完了"];

  return (
    <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
      <p className="text-xs font-semibold tracking-[0.22em] text-slate-500">STATUS SUMMARY</p>
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

function TopicSummaryTable({ topics }: { topics: SharedAlignmentTopic[] }) {
  return (
    <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-100 p-6">
        <p className="text-xs font-semibold tracking-[0.22em] text-slate-500">TOPIC DASHBOARD</p>
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
              <th className="px-5 py-3">STAGE3</th>
              <th className="px-5 py-3">STAGE4</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 bg-white">
            {topics.map((topic) => (
              <tr key={topic.id} className="align-top">
                <td className="max-w-xs px-5 py-4 font-semibold text-slate-950">{topic.title}</td>
                <td className="px-5 py-4 font-bold text-slate-950">{topic.relatedCaseCount}</td>
                <td className="px-5 py-4 text-slate-700">{topic.impactScope}</td>
                <td className="px-5 py-4">
                  <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${getLevelColor(topic.urgency)}`}>
                    {topic.urgency}
                  </span>
                </td>
                <td className="px-5 py-4">
                  <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${getLevelColor(topic.importance)}`}>
                    {topic.importance}
                  </span>
                </td>
                <td className="px-5 py-4 text-slate-700">{topic.targetDepartments.join("・")}</td>
                <td className="px-5 py-4">
                  <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${getStatusColor(topic.status)}`}>
                    {topic.status}
                  </span>
                </td>
                <td className="px-5 py-4">
                  <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${getStatusColor(topic.strategyReflection.stage3Status)}`}>
                    {topic.strategyReflection.stage3Status}
                  </span>
                </td>
                <td className="px-5 py-4">
                  <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${getStatusColor(topic.strategyReflection.stage4Status)}`}>
                    {topic.strategyReflection.stage4Status}
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

function StrategyReflectionSection({ topic }: { topic: SharedAlignmentTopic }) {
  const reflection = topic.strategyReflection;
  return (
    <section className="rounded-3xl border border-slate-200 bg-slate-50 p-5 md:p-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div>
          <p className="text-xs font-semibold tracking-[0.18em] text-slate-500">STAGE REFLECTION</p>
          <h4 className="mt-2 text-lg font-bold text-slate-950">戦略・実行計画への反映</h4>
          <p className="mt-2 text-sm leading-7 text-slate-700">
            この論点は、すり合わせ結果をもとに、STAGE3の部門戦略・STAGE4の実行計画への反映候補として整理されています。
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <span className={`rounded-full px-3 py-1 text-xs font-semibold ${getStatusColor(reflection.stage3Status)}`}>
            STAGE3：{reflection.stage3Status}
          </span>
          <span className={`rounded-full px-3 py-1 text-xs font-semibold ${getStatusColor(reflection.stage4Status)}`}>
            STAGE4：{reflection.stage4Status}
          </span>
        </div>
      </div>

      <div className="mt-5 rounded-2xl border border-slate-200 bg-white p-4">
        <p className="text-sm font-bold text-slate-950">関係部門</p>
        <div className="mt-3 flex flex-wrap gap-2">
          {reflection.relatedDepartments.map((department) => (
            <span key={department} className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700">
              {department}
            </span>
          ))}
        </div>
      </div>

      <div className="mt-5 grid gap-4 lg:grid-cols-2">
        <div className="rounded-2xl border border-slate-200 bg-white p-4">
          <h5 className="text-sm font-bold text-slate-950">生成候補プロジェクト</h5>
          <div className="mt-4 space-y-3">
            {reflection.generatedProjects.map((project, index) => (
              <div key={`${project.departmentName}-${project.projectTitle}`} className="rounded-xl bg-slate-50 p-3">
                <p className="text-xs font-semibold text-slate-500">
                  {index + 1}. {project.departmentName}
                </p>
                <p className="mt-1 text-sm font-bold text-slate-950">{project.projectTitle}</p>
                <p className="mt-1 text-xs leading-5 text-slate-600">{project.projectSummary}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-4">
          <h5 className="text-sm font-bold text-slate-950">生成候補OKR</h5>
          <div className="mt-4 space-y-4">
            {reflection.generatedOkrs.map((okr) => (
              <div key={okr.objective} className="rounded-xl bg-slate-50 p-3">
                <p className="text-xs font-semibold text-slate-500">Objective</p>
                <p className="mt-1 text-sm font-bold text-slate-950">{okr.objective}</p>
                <p className="mt-3 text-xs font-semibold text-slate-500">Key Results</p>
                <ul className="mt-2 list-disc space-y-1 pl-5 text-xs leading-5 text-slate-700">
                  {okr.keyResults.map((kr) => (
                    <li key={kr}>{kr}</li>
                  ))}
                </ul>
                <p className="mt-3 text-xs leading-5 text-slate-600">
                  Owner：{okr.owner} ／ 期限：{okr.dueDate}
                </p>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="mt-5 flex flex-col gap-3 md:flex-row">
        <button
          type="button"
          onClick={() => handleDemoAction(`${topic.title}をSTAGE3の部門戦略へ反映します。`)}
          className="rounded-xl bg-slate-950 px-5 py-3 text-sm font-semibold text-white transition hover:bg-slate-800"
        >
          STAGE3 部門戦略へ反映する
        </button>
        <button
          type="button"
          onClick={() => handleDemoAction(`${topic.title}をSTAGE4で実行計画・OKR化します。`)}
          className="rounded-xl border border-slate-300 bg-white px-5 py-3 text-sm font-semibold text-slate-800 transition hover:bg-slate-100"
        >
          STAGE4 実行計画・OKR化する
        </button>
      </div>
    </section>
  );
}

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
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="p-6">
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <span className={`rounded-full px-3 py-1 text-xs font-semibold ${getStatusColor(topic.status)}`}>{topic.status}</span>
          <span className={`rounded-full px-3 py-1 text-xs font-semibold ${getLevelColor(topic.importance)}`}>重要度：{topic.importance}</span>
          <span className={`rounded-full px-3 py-1 text-xs font-semibold ${getLevelColor(topic.urgency)}`}>緊急度：{topic.urgency}</span>
          <span className={`rounded-full px-3 py-1 text-xs font-semibold ${getPriorityColor(topic.priorityScore)}`}>優先度：{topic.priorityScore}</span>
          <span className={`rounded-full px-3 py-1 text-xs font-semibold ${getStatusColor(topic.strategyReflection.stage3Status)}`}>STAGE3：{topic.strategyReflection.stage3Status}</span>
          <span className={`rounded-full px-3 py-1 text-xs font-semibold ${getStatusColor(topic.strategyReflection.stage4Status)}`}>STAGE4：{topic.strategyReflection.stage4Status}</span>
        </div>

        <h3 className="text-lg font-bold text-slate-950">{topic.title}</h3>
        <p className="mt-3 text-sm leading-7 text-slate-700">{topic.summary}</p>

        <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-white px-3 py-1 text-xs font-semibold text-slate-700 ring-1 ring-slate-200">AI集計結果</span>
            <span className="rounded-full bg-white px-3 py-1 text-xs font-semibold text-slate-700 ring-1 ring-slate-200">{topic.category}</span>
            <span className="rounded-full bg-white px-3 py-1 text-xs font-semibold text-slate-700 ring-1 ring-slate-200">関連する声：{topic.relatedCaseCount}件</span>
            <span className="rounded-full bg-white px-3 py-1 text-xs font-semibold text-slate-700 ring-1 ring-slate-200">推奨：{topic.sessionType}</span>
          </div>
          <p className="mt-3 text-xs leading-6 text-slate-600">{topic.aiSummary}</p>
        </div>

        <div className="mt-5 grid gap-3 text-sm md:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-xl bg-slate-50 p-3">
            <p className="text-xs font-semibold text-slate-500">影響範囲</p>
            <p className="mt-1 font-bold text-slate-900">{topic.impactScope}</p>
          </div>
          <div className="rounded-xl bg-slate-50 p-3">
            <p className="text-xs font-semibold text-slate-500">対象部門</p>
            <p className="mt-1 font-bold text-slate-900">{topic.targetDepartments.join("・")}</p>
          </div>
          <div className="rounded-xl bg-slate-50 p-3">
            <p className="text-xs font-semibold text-slate-500">次回確認日</p>
            <p className="mt-1 font-bold text-slate-900">{topic.nextReviewDate}</p>
          </div>
          <div className="rounded-xl bg-slate-50 p-3">
            <p className="text-xs font-semibold text-slate-500">更新日</p>
            <p className="mt-1 font-bold text-slate-900">{topic.updatedAt}</p>
          </div>
        </div>

        <button
          type="button"
          onClick={onExpandClick}
          className="mt-5 rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-800 transition hover:bg-slate-50"
        >
          {isExpanded ? "詳細を閉じる" : "詳細を見る"}
        </button>
      </div>

      {isExpanded && (
        <div className="border-t border-slate-200 bg-white p-6">
          <div className="space-y-6">
            <section>
              <h4 className="font-bold text-slate-950">背景</h4>
              <p className="mt-2 text-sm leading-7 text-slate-700">{topic.background}</p>
            </section>

            <section className="grid gap-4 md:grid-cols-3">
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <p className="text-xs font-semibold text-slate-500">現場の認識</p>
                <p className="mt-2 text-sm leading-7 text-slate-700">{topic.recognitionGap.fieldView}</p>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <p className="text-xs font-semibold text-slate-500">会社側の認識</p>
                <p className="mt-2 text-sm leading-7 text-slate-700">{topic.recognitionGap.companyView}</p>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <p className="text-xs font-semibold text-slate-500">ズレの本質</p>
                <p className="mt-2 text-sm leading-7 text-slate-700">{topic.recognitionGap.gapEssence}</p>
              </div>
            </section>

            <section className="rounded-2xl border border-slate-200 bg-white p-4">
              <h4 className="font-bold text-slate-950">会社としての判断軸</h4>
              <p className="mt-2 text-sm leading-7 text-slate-700">{topic.companyAxis}</p>
            </section>

            <section className="rounded-2xl border border-slate-200 bg-white p-4">
              <h4 className="font-bold text-slate-950">すり合わせ結果</h4>
              <p className="mt-2 text-sm leading-7 text-slate-700">{topic.alignmentResult}</p>
            </section>

            <div className="grid gap-4 md:grid-cols-2">
              <section className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <h4 className="font-bold text-slate-950">変えること</h4>
                <ul className="mt-3 list-disc space-y-2 pl-5 text-sm leading-6 text-slate-700">
                  {topic.changedThings.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </section>
              <section className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <h4 className="font-bold text-slate-950">変えないこと</h4>
                <ul className="mt-3 list-disc space-y-2 pl-5 text-sm leading-6 text-slate-700">
                  {topic.unchangedThings.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </section>
            </div>

            <section className="rounded-2xl border border-slate-200 bg-white p-4">
              <h4 className="font-bold text-slate-950">次の対応</h4>
              <div className="mt-3 space-y-3">
                {topic.nextActions.map((action) => (
                  <div key={`${action.title}-${action.owner}`} className="rounded-xl bg-slate-50 p-3">
                    <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                      <p className="font-semibold text-slate-950">{action.title}</p>
                      <span className={`w-fit rounded-full px-3 py-1 text-xs font-semibold ${getStatusColor(action.status)}`}>
                        {action.status}
                      </span>
                    </div>
                    <p className="mt-2 text-xs leading-5 text-slate-600">
                      担当：{action.owner} ／ 期限：{action.dueDate}
                    </p>
                  </div>
                ))}
              </div>
            </section>

            <StrategyReflectionSection topic={topic} />
          </div>
        </div>
      )}
    </div>
  );
}

export default function OrganizationSharedRoomPage() {
  const [selectedFilter, setSelectedFilter] = useState<TopicStatus | "すべて">("すべて");
  const [expandedTopicId, setExpandedTopicId] = useState<string | null>(null);
  const [topics, setTopics] = useState<SharedAlignmentTopic[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>("");

  // ===== データ取得 =====
  useEffect(() => {
    fetchTopics();
  }, []);

  const fetchTopics = async () => {
    setLoading(true);
    setError("");

    try {
      const { ok, data: sessionData } = await safeGetSession();
      if (!ok || !sessionData?.session?.access_token) {
        console.log("Not authenticated or session expired, using demo data");
        setTopics(mockTopics);
        setLoading(false);
        return;
      }

      const res = await fetch("/api/org-alignment/shared/topics", {
        method: "GET",
        headers: {
          Authorization: `Bearer ${sessionData.session.access_token}`,
        },
      });

      if (!res.ok) {
        console.warn(`Failed to fetch topics: ${res.status}, using demo data`);
        setTopics(mockTopics);
        setLoading(false);
        return;
      }

      const resData = await res.json();
      if (resData.topics && Array.isArray(resData.topics) && resData.topics.length > 0) {
        // APIから取得したデータを変換して使用
        const convertedTopics: SharedAlignmentTopic[] = resData.topics.map((topic: any) => ({
          id: topic.id,
          title: topic.title,
          status: mapDbStatusToUiStatus(topic.status),
          importance: topic.importance || "中",
          urgency: topic.urgency || "中",
          category: topic.related_issue_types?.[0] || "組織課題",
          priorityScore: topic.priority_score || 50,
          aiSummary: topic.summary || "",
          relatedCaseCount: topic.related_case_count ?? 0,
          impactScope: topic.impact_scope || "全社",
          targetDepartments: topic.affected_departments || [],
          summary: topic.summary || "",
          background: "", // APIからは取得しないため空
          recognitionGap: topic.recognition_gap || {
            fieldView: "",
            companyView: "",
            gapEssence: "",
          },
          companyAxis: topic.company_axis || "",
          sessionType: topic.session_type || "",
          alignmentResult: "", // APIからは取得しないため空
          changedThings: [], // APIからは取得しないため空
          unchangedThings: [], // APIからは取得しないため空
          nextActions: topic.next_actions || [],
          strategyReflection: topic.strategy_reflection || {
            stage3Status: "未反映",
            stage4Status: "未反映",
            relatedDepartments: [],
            generatedProjects: [],
            generatedOkrs: [],
          },
          owner: topic.published_by || "",
          nextReviewDate: topic.published_at?.split("T")[0] || "",
          updatedAt: topic.updated_at?.split("T")[0] || "",
        }));

        setTopics(convertedTopics);
      } else {
        // データなしの場合はモックデータを使用
        setTopics(mockTopics);
      }
    } catch (err) {
      console.error("fetchTopics error:", err);
      setError("データ取得に失敗しました。デモデータを表示しています。");
      setTopics(mockTopics);
    } finally {
      setLoading(false);
    }
  };

  const filteredTopics = useMemo(() => {
    if (selectedFilter === "すべて") return topics;
    return topics.filter((topic) => topic.status === selectedFilter);
  }, [selectedFilter, topics]);

  const summaryData = useMemo(() => {
    return {
      aiTargetVoices: topics.reduce((sum, topic) => sum + topic.relatedCaseCount, 0),
      topics: topics.length,
      alignmentTargets: topics.filter((topic) => topic.status !== "完了").length,
      explanationNeeded: 1,
      inProgress: topics.filter((topic) => topic.status === "すり合わせ中").length,
      decided: topics.filter((topic) => topic.status === "対応方針決定").length,
      executing: topics.filter((topic) => topic.status === "実行中").length,
      stage3Targets: topics.filter((topic) => topic.strategyReflection.stage3Status !== "未反映").length,
      stage4Targets: topics.filter((topic) => topic.strategyReflection.stage4Status !== "未反映").length,
    };
  }, [topics]);

  return (
    <main className="min-h-screen bg-slate-50 px-6 py-16 text-slate-950 md:px-10 lg:px-16">
      <div className="mx-auto max-w-6xl space-y-12">
        <header className="space-y-6">
          <p className="text-xs font-semibold tracking-[0.35em] text-slate-500">ORGANIZATION SHARED ROOM</p>
          <div className="space-y-4">
            <h1 className="text-4xl font-bold tracking-tight text-slate-950 md:text-5xl">
              組織変革・全社共有ルーム
            </h1>
            <p className="text-2xl font-bold text-slate-950">現場の違和感を、組織の課題解決につなぐ。</p>
          </div>
          <div className="max-w-4xl space-y-4 text-sm leading-8 text-slate-700">
            <p>
              社員から寄せられた違和感やモヤモヤは、会社として向き合うべき認識のズレとして整理され、原則として全社で共有されます。
              個人が特定されない形で、判断基準・役割・優先順位のズレを可視化し、組織全体ですり合わせと実行に取り組みます。
            </p>
            <p>
              目的は、誰かを責めることではありません。会社が目指す方向に向けて、認識のズレを整え、全社の行動につなげることです。
              管理者は必要に応じて表現の編集や保留、非公開化を行いますが、基本的には「隠すこと」ではなく「会社として扱える論点に整えること」に注力します。
            </p>
          </div>
          <div className="max-w-4xl rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <p className="text-sm font-semibold leading-7 text-slate-900">
              見えた組織課題は、共有して終わりではありません。必要に応じてSTAGE3の部門戦略やSTAGE4の実行計画へ還流し、具体的なプロジェクト・OKRとして推進します。
            </p>
          </div>
        </header>

        <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm md:p-8">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
            <div className="max-w-3xl">
              <p className="text-xs font-semibold tracking-[0.22em] text-slate-500">AI AGGREGATION SUMMARY</p>
              <h2 className="mt-2 text-2xl font-bold text-slate-950">AI集計サマリー</h2>
              <p className="mt-4 text-sm leading-8 text-slate-700">
                社員から寄せられた違和感やもやもやは、個別の不満としてそのまま公開するのではなく、AIが類似する声を分類・集約し、会社として向き合うべき共通論点に整理します。
              </p>
              <p className="mt-3 text-sm leading-8 text-slate-700">
                個人名や個別投稿本文は公開せず、認識のズレ・影響範囲・重要度・緊急度・推奨されるすり合わせの場を可視化します。
              </p>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700 lg:w-72">
              <p className="text-xs font-semibold tracking-wide text-slate-500">表示データ</p>
              <p className="mt-2 font-bold text-slate-950">
                {topics.length === mockTopics.length && JSON.stringify(topics) === JSON.stringify(mockTopics)
                  ? "デモ用AI集計結果"
                  : "実運用データ"}
              </p>
              <p className="mt-2 text-xs leading-5 text-slate-600">
                {topics.length === mockTopics.length && JSON.stringify(topics) === JSON.stringify(mockTopics)
                  ? "デモ用仮データです。"
                  : `投稿データから自動集計した${topics.length}件の論点を表示しています。`}
              </p>
              {error && <p className="mt-2 text-xs text-orange-600">{error}</p>}
            </div>
          </div>

          <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
            <MetricCard label="集計対象の声" value={`${summaryData.aiTargetVoices}件`} description="個人が特定されない形で集計された声" />
            <MetricCard label="抽出された共通論点" value={`${summaryData.topics}件`} description="AIが類似する声を束ねた論点" />
            <MetricCard label="すり合わせ対象" value={`${summaryData.alignmentTargets}件`} description="関係者ですり合わせるべき論点" />
            <MetricCard label="説明対応が必要な論点" value={`${summaryData.explanationNeeded}件`} description="会社方針や判断理由の説明が必要な論点" />
          </div>
        </section>

        <section className="grid gap-6 lg:grid-cols-2">
          <TopicBarChart topics={topics} />
          <StatusChart topics={topics} />
        </section>

        <TopicSummaryTable topics={topics} />

        <section className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
          <MetricCard label="共有中の論点" value={`${summaryData.topics}件`} description="全社に公開されている組織論点" />
          <MetricCard label="すり合わせ中" value={`${summaryData.inProgress}件`} description="現在話し合いが進行中" />
          <MetricCard label="STAGE3反映候補" value={`${summaryData.stage3Targets}件`} description="部門戦略への反映対象" />
          <MetricCard label="STAGE4 OKR化候補" value={`${summaryData.stage4Targets}件`} description="実行計画・OKR化の対象" />
        </section>

        <section className="space-y-5">
          <div>
            <h2 className="text-2xl font-bold text-slate-950">声が論点になるまで</h2>
            <p className="mt-3 leading-8 text-slate-700">
              全社共有ルームでは、個別の声をそのまま並べるのではなく、AI集計によって会社として扱うべき共通論点に変換し、すり合わせと結果共有までつなげます。
            </p>
          </div>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            <ProcessStep number={1} title="社員が違和感を入力" description="日々のもやもやや違和感を、個人が特定されない形で蓄積します。" />
            <ProcessStep number={2} title="AIが認識のズレを整理" description="感情や不満を、判断基準・役割・優先順位のズレとして構造化します。" />
            <ProcessStep number={3} title="共通論点へ集約" description="類似する声を束ね、会社として扱うべき論点に変換します。" />
            <ProcessStep number={4} title="優先順位を判定" description="件数、影響範囲、緊急性、顧客影響、離職リスクなどで整理します。" />
            <ProcessStep number={5} title="関係者ですり合わせ" description="論点に応じて、個別・部門内・部門横断・経営対話の場を設定します。" />
            <ProcessStep number={6} title="結果を全社共有" description="会社としての判断、変えること、変えないこと、次の対応を共有します。" />
          </div>
        </section>

        <section className="space-y-5">
          <div>
            <h2 className="text-2xl font-bold text-slate-950">すり合わせの5原則</h2>
            <p className="mt-3 leading-8 text-slate-700">
              全社共有ルームでは、個人や部門を責めるのではなく、会社が目指す方向に向けて認識のズレを整えることを目的とします。
            </p>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <PrincipleCard number={1} title="人や組織を悪者にしない" description="個人や部門を責めず、判断基準・役割・優先順位のズレとして扱う。" />
            <PrincipleCard number={2} title="認識のズレをすり合わせる" description="それぞれの立場で見えている事実、前提、期待値を確認する。" />
            <PrincipleCard number={3} title="会社の目指す方向性に沿う結論にする" description="最終判断は、会社の戦略・顧客価値・業績改善・組織のあるべき姿に照らして行う。" />
            <PrincipleCard number={4} title="変えること・変えないことを明確にする" description="改善すること、説明すること、今は変えないことを分ける。" />
            <PrincipleCard number={5} title="結果を共有し、次の行動につなげる" description="会社としての判断、次アクション、担当、期限を残す。" />
          </div>
        </section>

        <section className="space-y-5">
          <div>
            <h2 className="text-2xl font-bold text-slate-950">全社論点一覧</h2>
            <p className="mt-2 text-slate-600">
              社員から寄せられた違和感のAI集計結果と、会社としてのすり合わせ状況を確認できます。
            </p>
          </div>

          <div className="flex flex-wrap gap-3">
            {filters.map((filter) => (
              <button
                key={filter}
                type="button"
                onClick={() => setSelectedFilter(filter)}
                className={`rounded-full px-4 py-2 text-sm font-semibold transition-colors ${
                  selectedFilter === filter
                    ? "bg-slate-900 text-white shadow"
                    : "border border-slate-300 bg-white text-slate-800 hover:bg-slate-50"
                }`}
              >
                {filter}
              </button>
            ))}
          </div>

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
                  onExpandClick={() => setExpandedTopicId(expandedTopicId === topic.id ? null : topic.id)}
                  isExpanded={expandedTopicId === topic.id}
                />
              ))
            )}
          </div>
        </section>

        <section className="py-8">
          <div className="rounded-3xl border border-slate-200 bg-white p-8 text-center shadow-sm">
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
    </main>
  );
}
