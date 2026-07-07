"use client";

import { useMemo, useState, useEffect, type ReactNode } from "react";
import { safeGetSession } from "@/utils/supabase/client";

// ===== 型定義 =====
type TopicStatus = "すり合わせ予定" | "すり合わせ中" | "対応方針決定";
type Level = "高" | "中" | "低";
type ActionStatus = "未着手" | "対応中" | "完了";
type Stage3Status = "未反映" | "反映候補" | "STAGE3確認済み";
type Stage4Status = "未反映" | "実行計画への反映候補" | "STAGE4確認済み";

type NextAction = {
  title: string;
  owner: string;
  dueDate: string;
  status: ActionStatus;
};

type TopicEditablePatch = Partial<
  Pick<
    SharedAlignmentTopic,
    | "alignmentResult"
    | "changedThings"
    | "unchangedThings"
    | "nextActions"
    | "strategyReflection"
    | "status"
    | "updatedAt"
  >
>;

type StrategyReflection = {
  stage3Status: Stage3Status;
  stage4Status: Stage4Status;
  stage3Confirmed?: boolean;
  stage4Confirmed?: boolean;
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
  announcement_text?: string;
  announcement_updated_at?: string;
};

// ===== ステータスマッピング（3状態に簡素化） =====
function mapDbStatusToUiStatus(dbStatus: string): TopicStatus {
  // DB値は既存のまま、UI表示だけ3状態に統合
  if (['draft', 'published', 'open'].includes(dbStatus)) {
    return 'すり合わせ予定';
  } else if (dbStatus === 'in_alignment') {
    return 'すり合わせ中';
  } else if (['action_planned', 'reflected', 'closed', 'resolved'].includes(dbStatus)) {
    return '対応方針決定';
  }
  return 'すり合わせ予定';
}

function mapUiStatusToDbStatus(uiStatus: TopicStatus): string {
  // UI表示から DB値へのマッピング（既存DB値を保持）
  switch (uiStatus) {
    case "すり合わせ予定":
      return "published";
    case "すり合わせ中":
      return "in_alignment";
    case "対応方針決定":
      return "action_planned";
    default:
      return "published";
  }
}

const filters: (TopicStatus | "すべて")[] = [
  "すべて",
  "すり合わせ予定",
  "すり合わせ中",
  "対応方針決定",
];

// ===== ヘルパー関数 =====
const getStatusColor = (status: TopicStatus | ActionStatus | Stage3Status | Stage4Status) => {
  switch (status) {
    case "すり合わせ予定":
    case "反映候補":
    case "実行計画への反映候補":
      return "bg-slate-100 text-slate-700 ring-1 ring-slate-200";
    case "すり合わせ中":
    case "対応中":
      return "bg-amber-50 text-amber-700 ring-1 ring-amber-100";
    case "対応方針決定":
    case "STAGE3確認済み":
    case "STAGE4確認済み":
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

const getTodayString = () => new Date().toISOString().split("T")[0];

const normalizeTextList = (text: string) =>
  text
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter(Boolean);

const formatTextList = (items: string[]) => items.join("\n");

const emptyAction = (): NextAction => ({
  title: "",
  owner: "",
  dueDate: getTodayString(),
  status: "未着手",
});

const buildReflectionCandidate = (
  topic: SharedAlignmentTopic,
  target: "stage3" | "stage4",
): StrategyReflection => {
  const relatedDepartments = topic.targetDepartments.length > 0 ? topic.targetDepartments : topic.strategyReflection.relatedDepartments;
  const summaryBase =
    topic.alignmentResult ||
    [topic.companyAxis, ...topic.changedThings].filter(Boolean).join("。") ||
    topic.summary;

  const generatedProjects =
    target === "stage3" && topic.strategyReflection.generatedProjects.length === 0
      ? relatedDepartments.slice(0, Math.max(1, relatedDepartments.length)).map((departmentName) => ({
          departmentName,
          projectTitle: `${topic.title}への対応方針の具体化`,
          projectSummary: summaryBase || "すり合わせ結果をもとに、部門として取り組む対応方針を具体化する。",
        }))
      : topic.strategyReflection.generatedProjects;

  const generatedOkrs =
    target === "stage4" && topic.strategyReflection.generatedOkrs.length === 0
      ? [
          {
            objective: `${topic.title}に関する認識のズレを解消し、実行につなげる`,
            keyResults:
              topic.nextActions.length > 0
                ? topic.nextActions.map((action) => action.title).filter(Boolean)
                : [
                    "すり合わせ結果を関係者に共有する",
                    "変えること・変えないことを明確化する",
                    "次の対応の担当者と期限を決める",
                  ],
            owner: topic.owner || relatedDepartments.join("・") || "担当部門",
            dueDate: topic.nextReviewDate || getTodayString(),
          },
        ]
      : topic.strategyReflection.generatedOkrs;

  return {
    ...topic.strategyReflection,
    stage3Status: target === "stage3" ? "反映候補" : topic.strategyReflection.stage3Status,
    stage4Status: target === "stage4" ? "実行計画への反映候補" : topic.strategyReflection.stage4Status,
    stage3Confirmed: target === "stage3" ? false : topic.strategyReflection.stage3Confirmed,
    stage4Confirmed: target === "stage4" ? false : topic.strategyReflection.stage4Confirmed,
    relatedDepartments,
    generatedProjects,
    generatedOkrs,
  };
};

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

function getStageDisplayName(status: string): string {
  switch (status) {
    case "反映候補":
      return "候補";
    case "STAGE3確認済み":
    case "STAGE4確認済み":
      return "済み";
    default:
      return status;
  }
}

function TopicSummaryTable({ topics }: { topics: SharedAlignmentTopic[] }) {
  return (
    <div className="rounded-3xl border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-100 p-6">
        <p className="text-xs font-semibold tracking-[0.22em] text-slate-500">TOPIC DASHBOARD</p>
        <h3 className="mt-2 text-xl font-bold text-slate-950">全社論点ダッシュボード</h3>
        <p className="mt-2 text-sm leading-6 text-slate-600">
          AIが集約した論点を、件数・影響範囲・対象部門・状態で一覧化します。
        </p>
      </div>
      <div className="grid grid-cols-1 gap-3 p-6 md:grid-cols-2 lg:grid-cols-2">
        {topics.map((topic) => (
          <div key={topic.id} className="rounded-xl border border-slate-200 bg-slate-50 p-4 hover:bg-slate-100 transition">
            <div className="space-y-3">
              {/* 論点名 */}
              <div>
                <h4 className="font-bold text-slate-950 line-clamp-2">{topic.title}</h4>
              </div>

              {/* 基本情報グリッド */}
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="rounded-lg bg-white p-2">
                  <div className="text-[11px] font-medium text-slate-500">関連する声</div>
                  <div className="mt-0.5 font-bold text-slate-900">{topic.relatedCaseCount}件</div>
                </div>
                <div className="rounded-lg bg-white p-2">
                  <div className="text-[11px] font-medium text-slate-500">影響範囲</div>
                  <div className="mt-0.5 font-semibold text-slate-900">{topic.impactScope}</div>
                </div>
              </div>

              {/* 対象部門 */}
              <div className="rounded-lg bg-white p-2">
                <div className="text-[11px] font-medium text-slate-500">対象部門</div>
                <div className="mt-1 flex flex-wrap gap-1">
                  {topic.targetDepartments.map((dept) => (
                    <span key={dept} className="rounded-full bg-slate-200 px-2 py-1 text-[11px] font-medium text-slate-800">
                      {dept}
                    </span>
                  ))}
                </div>
              </div>

              {/* ステータス */}
              <div className="grid grid-cols-3 gap-2 text-xs">
                <div className="rounded-lg bg-white p-2">
                  <div className="text-[11px] font-medium text-slate-500">状態</div>
                  <div className="mt-0.5">
                    <span className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold ${getStatusColor(topic.status)}`}>
                      {topic.status}
                    </span>
                  </div>
                </div>
                <div className="rounded-lg bg-white p-2">
                  <div className="text-[11px] font-medium text-slate-500">STAGE3</div>
                  <div className="mt-0.5">
                    <span className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold ${getStatusColor(topic.strategyReflection.stage3Status)}`}>
                      {getStageDisplayName(topic.strategyReflection.stage3Status)}
                    </span>
                  </div>
                </div>
                <div className="rounded-lg bg-white p-2">
                  <div className="text-[11px] font-medium text-slate-500">STAGE4</div>
                  <div className="mt-0.5">
                    <span className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold ${getStatusColor(topic.strategyReflection.stage4Status)}`}>
                      {getStageDisplayName(topic.strategyReflection.stage4Status)}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function EmptyState({ children }: { children: ReactNode }) {
  return <p className="mt-2 text-sm leading-7 text-slate-400">{children}</p>;
}

function EditableTextSection({
  title,
  value,
  placeholder,
  onSave,
  onClear,
}: {
  title: string;
  value: string;
  placeholder: string;
  onSave: (value: string) => void;
  onClear: () => void;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState(value);

  useEffect(() => {
    if (!isEditing) setDraft(value);
  }, [isEditing, value]);

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <h4 className="font-bold text-slate-950">{title}</h4>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setIsEditing(true)}
            className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-50"
          >
            編集
          </button>
          <button
            type="button"
            onClick={onClear}
            className="rounded-lg border border-rose-200 bg-white px-3 py-1.5 text-xs font-semibold text-rose-700 transition hover:bg-rose-50"
          >
            削除
          </button>
        </div>
      </div>

      {isEditing ? (
        <div className="mt-3 space-y-3">
          <textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            rows={5}
            placeholder={placeholder}
            className="w-full rounded-xl border border-slate-300 bg-white px-3 py-3 text-sm leading-7 text-slate-800 outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-100"
          />
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => {
                onSave(draft.trim());
                setIsEditing(false);
              }}
              className="rounded-lg bg-slate-950 px-4 py-2 text-xs font-semibold text-white transition hover:bg-slate-800"
            >
              保存
            </button>
            <button
              type="button"
              onClick={() => {
                setDraft(value);
                setIsEditing(false);
              }}
              className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-50"
            >
              キャンセル
            </button>
          </div>
        </div>
      ) : value.trim() ? (
        <p className="mt-2 whitespace-pre-wrap text-sm leading-7 text-slate-700">{value}</p>
      ) : (
        <EmptyState>未入力です。編集ボタンから入力してください。</EmptyState>
      )}
    </section>
  );
}

function EditableListSection({
  title,
  items,
  placeholder,
  onSave,
  onClear,
}: {
  title: string;
  items: string[];
  placeholder: string;
  onSave: (items: string[]) => void;
  onClear: () => void;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState(formatTextList(items));

  useEffect(() => {
    if (!isEditing) setDraft(formatTextList(items));
  }, [isEditing, items]);

  return (
    <section className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <h4 className="font-bold text-slate-950">{title}</h4>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setIsEditing(true)}
            className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-50"
          >
            編集
          </button>
          <button
            type="button"
            onClick={onClear}
            className="rounded-lg border border-rose-200 bg-white px-3 py-1.5 text-xs font-semibold text-rose-700 transition hover:bg-rose-50"
          >
            削除
          </button>
        </div>
      </div>

      {isEditing ? (
        <div className="mt-3 space-y-3">
          <textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            rows={6}
            placeholder={placeholder}
            className="w-full rounded-xl border border-slate-300 bg-white px-3 py-3 text-sm leading-7 text-slate-800 outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-100"
          />
          <p className="text-xs text-slate-500">1行につき1項目として保存されます。</p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => {
                onSave(normalizeTextList(draft));
                setIsEditing(false);
              }}
              className="rounded-lg bg-slate-950 px-4 py-2 text-xs font-semibold text-white transition hover:bg-slate-800"
            >
              保存
            </button>
            <button
              type="button"
              onClick={() => {
                setDraft(formatTextList(items));
                setIsEditing(false);
              }}
              className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-50"
            >
              キャンセル
            </button>
          </div>
        </div>
      ) : items.length > 0 ? (
        <ul className="mt-3 list-disc space-y-2 pl-5 text-sm leading-6 text-slate-700">
          {items.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      ) : (
        <EmptyState>未入力です。編集ボタンから入力してください。</EmptyState>
      )}
    </section>
  );
}

function NextActionsSection({
  actions,
  onSave,
  onClear,
}: {
  actions: NextAction[];
  onSave: (actions: NextAction[]) => void;
  onClear: () => void;
}) {
  const [editingIndex, setEditingIndex] = useState<number | "new" | null>(null);
  const [draft, setDraft] = useState<NextAction>(emptyAction());

  const startEdit = (index: number) => {
    setEditingIndex(index);
    setDraft(actions[index]);
  };

  const startNew = () => {
    setEditingIndex("new");
    setDraft(emptyAction());
  };

  const saveDraft = () => {
    if (!draft.title.trim()) return;
    const cleaned: NextAction = {
      title: draft.title.trim(),
      owner: draft.owner.trim() || "未設定",
      dueDate: draft.dueDate || getTodayString(),
      status: draft.status,
    };

    if (editingIndex === "new") {
      onSave([...actions, cleaned]);
    } else if (typeof editingIndex === "number") {
      onSave(actions.map((action, index) => (index === editingIndex ? cleaned : action)));
    }

    setEditingIndex(null);
    setDraft(emptyAction());
  };

  const deleteAction = (index: number) => {
    onSave(actions.filter((_, actionIndex) => actionIndex !== index));
    if (editingIndex === index) setEditingIndex(null);
  };

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <h4 className="font-bold text-slate-950">次の対応</h4>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={startNew}
            className="rounded-lg bg-slate-950 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-slate-800"
          >
            追加
          </button>
          <button
            type="button"
            onClick={onClear}
            className="rounded-lg border border-rose-200 bg-white px-3 py-1.5 text-xs font-semibold text-rose-700 transition hover:bg-rose-50"
          >
            全削除
          </button>
        </div>
      </div>

      <div className="mt-3 space-y-3">
        {actions.length === 0 && editingIndex === null ? (
          <EmptyState>未入力です。追加ボタンから次の対応を登録してください。</EmptyState>
        ) : (
          actions.map((action, index) => (
            <div key={`${action.title}-${action.owner}-${index}`} className="rounded-xl bg-slate-50 p-3">
              <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                <p className="font-semibold text-slate-950">{action.title}</p>
                <span className={`w-fit rounded-full px-3 py-1 text-xs font-semibold ${getStatusColor(action.status)}`}>
                  {action.status}
                </span>
              </div>
              <p className="mt-2 text-xs leading-5 text-slate-600">
                担当：{action.owner} ／ 期限：{action.dueDate}
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => startEdit(index)}
                  className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-50"
                >
                  編集
                </button>
                <button
                  type="button"
                  onClick={() => deleteAction(index)}
                  className="rounded-lg border border-rose-200 bg-white px-3 py-1.5 text-xs font-semibold text-rose-700 transition hover:bg-rose-50"
                >
                  削除
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      {editingIndex !== null && (
        <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-4">
          <p className="text-sm font-bold text-slate-950">{editingIndex === "new" ? "次の対応を追加" : "次の対応を編集"}</p>
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            <label className="space-y-1 text-xs font-semibold text-slate-600 md:col-span-2">
              対応内容
              <input
                value={draft.title}
                onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))}
                className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-normal text-slate-800 outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-100"
                placeholder="例：営業部門との定期的なコミュニケーションを実施する"
              />
            </label>
            <label className="space-y-1 text-xs font-semibold text-slate-600">
              担当
              <input
                value={draft.owner}
                onChange={(event) => setDraft((current) => ({ ...current, owner: event.target.value }))}
                className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-normal text-slate-800 outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-100"
                placeholder="例：経営企画"
              />
            </label>
            <label className="space-y-1 text-xs font-semibold text-slate-600">
              期限
              <input
                type="date"
                value={draft.dueDate}
                onChange={(event) => setDraft((current) => ({ ...current, dueDate: event.target.value }))}
                className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-normal text-slate-800 outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-100"
              />
            </label>
            <label className="space-y-1 text-xs font-semibold text-slate-600">
              状態
              <select
                value={draft.status}
                onChange={(event) => setDraft((current) => ({ ...current, status: event.target.value as ActionStatus }))}
                className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-normal text-slate-800 outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-100"
              >
                <option value="未着手">未着手</option>
                <option value="対応中">対応中</option>
                <option value="完了">完了</option>
              </select>
            </label>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={saveDraft}
              disabled={!draft.title.trim()}
              className="rounded-lg bg-slate-950 px-4 py-2 text-xs font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-300"
            >
              保存
            </button>
            <button
              type="button"
              onClick={() => {
                setEditingIndex(null);
                setDraft(emptyAction());
              }}
              className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-50"
            >
              キャンセル
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

function StrategyReflectionSection({
  topic,
  onCreateStage3Candidate,
  onCreateStage4Candidate,
  onResetReflection,
}: {
  topic: SharedAlignmentTopic;
  onCreateStage3Candidate: () => void;
  onCreateStage4Candidate: () => void;
  onResetReflection: (topicId: string) => void;
}) {
  const reflection = topic.strategyReflection;
  const [showResetConfirm, setShowResetConfirm] = useState(false);

  const hasAnyCandidates = reflection.generatedProjects.length > 0 || reflection.generatedOkrs.length > 0;

  const handleResetClick = () => {
    console.log("[StrategyReflectionSection] handleResetClick called, hasAnyCandidates:", hasAnyCandidates);
    if (hasAnyCandidates) {
      console.log("[StrategyReflectionSection] Showing confirmation dialog");
      setShowResetConfirm(true);
    }
  };

  const handleConfirmReset = () => {
    console.log("[StrategyReflectionSection] handleConfirmReset called, calling onResetReflection for topic:", topic.id);
    setShowResetConfirm(false);
    onResetReflection(topic.id);
  };
  return (
    <section className="rounded-3xl border border-slate-200 bg-slate-50 p-5 md:p-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div>
          <p className="text-xs font-semibold tracking-[0.18em] text-slate-500">STAGE REFLECTION</p>
          <h4 className="mt-2 text-lg font-bold text-slate-950">戦略・実行計画への反映</h4>
          <p className="mt-2 text-sm leading-7 text-slate-700">
            この論点は、すり合わせ結果をもとに、STAGE3の事業・部門別戦略・STAGE4の実行計画への反映候補として整理されています。
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
          <h5 className="text-sm font-bold text-slate-950">生成候補実行計画</h5>
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

      <div className="mt-5 flex flex-col gap-3 md:flex-row md:items-center">
        <div className="flex flex-col gap-3 md:flex-row flex-1">
          {reflection.stage3Status === "未反映" ? (
            <button
              type="button"
              onClick={onCreateStage3Candidate}
              className="rounded-xl bg-slate-950 px-5 py-3 text-sm font-semibold text-white transition hover:bg-slate-800"
            >
              STAGE3 事業・部門別戦略への反映候補を作成
            </button>
          ) : (
            <a
              href="/cascade"
              className="rounded-xl bg-blue-600 px-5 py-3 text-sm font-semibold text-white transition hover:bg-blue-700 inline-block text-center"
            >
              STAGE3で候補を確認する{reflection.stage3Confirmed ?? false ? " ✓" : ""}
            </a>
          )}

          {reflection.stage4Status === "未反映" ? (
            <button
              type="button"
              onClick={onCreateStage4Candidate}
              className="rounded-xl border border-slate-300 bg-white px-5 py-3 text-sm font-semibold text-slate-800 transition hover:bg-slate-100"
            >
              STAGE4 実行計画への反映候補を作成
            </button>
          ) : (
            <a
              href="/okr"
              className="rounded-xl bg-green-600 px-5 py-3 text-sm font-semibold text-white transition hover:bg-green-700 inline-block text-center"
            >
              STAGE4で候補を確認する{reflection.stage4Confirmed ?? false ? " ✓" : ""}
            </a>
          )}
        </div>

        {hasAnyCandidates && (
          <div className="flex flex-col gap-2">
            <button
              type="button"
              onClick={handleResetClick}
              className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs font-semibold text-gray-700 transition hover:bg-gray-50 whitespace-nowrap"
            >
              反映状態をリセット
            </button>
            <p className="text-xs text-gray-600">
              すり合わせ内容を変更した場合や、STAGE3・STAGE4で再確認したい場合は、反映状態をリセットできます。
            </p>
          </div>
        )}
      </div>

      {showResetConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="rounded-2xl bg-white p-6 shadow-lg max-w-sm">
            <h3 className="text-base font-bold text-slate-950">反映状態のリセット</h3>
            <p className="mt-3 text-sm text-slate-700">
              STAGE3・STAGE4への反映状態をリセットしますか？削除済みの候補は復活しません。
            </p>
            <div className="mt-6 flex gap-3 justify-end">
              <button
                type="button"
                onClick={() => setShowResetConfirm(false)}
                className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-semibold text-gray-700 transition hover:bg-gray-50"
              >
                キャンセル
              </button>
              <button
                type="button"
                onClick={handleConfirmReset}
                className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-700"
              >
                リセットする
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

function TopicCard({
  topic,
  onExpandClick,
  isExpanded,
  onUpdateTopic,
  onCreateStage3Candidate,
  onCreateStage4Candidate,
  onResetReflection,
  isAdmin = false,
}: {
  topic: SharedAlignmentTopic;
  onExpandClick: () => void;
  isExpanded: boolean;
  onUpdateTopic: (topicId: string, patch: TopicEditablePatch) => void;
  onCreateStage3Candidate: (topic: SharedAlignmentTopic) => void;
  onCreateStage4Candidate: (topic: SharedAlignmentTopic) => void;
  onResetReflection: (topicId: string) => void;
  isAdmin?: boolean;
}) {
  const updateTopic = (patch: TopicEditablePatch) => onUpdateTopic(topic.id, patch);

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
            {/* 運営からのお知らせ */}
            {topic.announcement_text && (
              <div className="rounded-xl border border-blue-200 bg-blue-50 p-4">
                <p className="text-xs font-semibold text-blue-900 mb-2">
                  運営からのお知らせ
                </p>
                <p className="text-sm leading-6 text-blue-800">
                  {topic.announcement_text}
                </p>
                {topic.announcement_updated_at && (
                  <p className="mt-2 text-xs text-blue-600">
                    更新: {new Date(topic.announcement_updated_at).toLocaleString('ja-JP')}
                  </p>
                )}
              </div>
            )}

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

            {isAdmin && (
              <>
                <EditableTextSection
                  title="すり合わせ結果"
                  value={topic.alignmentResult}
                  placeholder="例：営業部門は経営からの支援が不足していると感じていたが、経営側は現場課題を十分に把握できていなかった。今後は月次で課題を共有し、支援方針を明確にすることで合意した。"
                  onSave={(alignmentResult) => updateTopic({ alignmentResult, status: alignmentResult ? "対応方針決定" : topic.status })}
                  onClear={() => updateTopic({ alignmentResult: "" })}
                />

                <div className="grid gap-4 md:grid-cols-2">
                  <EditableListSection
                    title="変えること"
                    items={topic.changedThings}
                    placeholder={"例：\n営業部門から経営への月次フィードバックの場を設ける\n重点案件・失注要因・現場課題を経営会議で共有する"}
                    onSave={(changedThings) => updateTopic({ changedThings })}
                    onClear={() => updateTopic({ changedThings: [] })}
                  />
                  <EditableListSection
                    title="変えないこと"
                    items={topic.unchangedThings}
                    placeholder={"例：\n営業部門が自律的に案件管理・顧客対応を行う責任は維持する\n経営がすべての案件に個別介入する運用にはしない"}
                    onSave={(unchangedThings) => updateTopic({ unchangedThings })}
                    onClear={() => updateTopic({ unchangedThings: [] })}
                  />
                </div>

                <NextActionsSection
                  actions={topic.nextActions}
                  onSave={(nextActions) => updateTopic({ nextActions, status: nextActions.length > 0 ? "実行中" : topic.status })}
                  onClear={() => updateTopic({ nextActions: [] })}
                />

                <StrategyReflectionSection
                  topic={topic}
                  onCreateStage3Candidate={() => onCreateStage3Candidate(topic)}
                  onCreateStage4Candidate={() => onCreateStage4Candidate(topic)}
                  onResetReflection={onResetReflection}
                />
              </>
            )}

            {!isAdmin && (
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <p className="text-sm text-slate-700">詳細は管理者のみ編集・確認できます。</p>
              </div>
            )}
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
  const [saveNotice, setSaveNotice] = useState<string>("");
  const [isAdmin, setIsAdmin] = useState(false);
  const [showHowToModal, setShowHowToModal] = useState(false);

  // ===== データ取得 =====
  useEffect(() => {
    fetchTopics();
    checkAdminRole();
  }, []);

  const checkAdminRole = async () => {
    try {
      const { ok, data: sessionData } = await safeGetSession();
      if (!ok || !sessionData?.session?.access_token) {
        setIsAdmin(false);
        return;
      }

      const res = await fetch("/api/auth/me", {
        method: "GET",
        headers: {
          Authorization: `Bearer ${sessionData.session.access_token}`,
        },
      });

      if (!res.ok) {
        setIsAdmin(false);
        return;
      }

      const data = await res.json();
      setIsAdmin(data.user?.role === "admin" || data.user?.memberships?.[0]?.role === "admin");
    } catch (err) {
      console.error("checkAdminRole error:", err);
      setIsAdmin(false);
    }
  };

  const fetchTopics = async () => {
    setLoading(true);
    setError("");

    try {
      const { ok, data: sessionData } = await safeGetSession();
      if (!ok || !sessionData?.session?.access_token) {
        setError("ログインしてください。");
        setTopics([]);
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
        setError("全社論点を取得できませんでした。時間をおいて再度お試しください。");
        setTopics([]);
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
          alignmentResult: topic.alignment_result || "",
          changedThings: topic.changed_things || topic.change_items || [],
          unchangedThings: topic.unchanged_things || topic.keep_items || [],
          nextActions: topic.next_actions || [],
          strategyReflection: topic.strategy_reflection || {
            stage3Status: "未反映",
            stage4Status: "未反映",
            stage3Confirmed: false,
            stage4Confirmed: false,
            relatedDepartments: [],
            generatedProjects: [],
            generatedOkrs: [],
          },
          owner: topic.published_by || "",
          nextReviewDate: topic.published_at?.split("T")[0] || "",
          updatedAt: topic.updated_at?.split("T")[0] || "",
          announcement_text: topic.announcement_text,
          announcement_updated_at: topic.announcement_updated_at,
        }));

        setTopics(convertedTopics);
      } else {
        // データなしの場合
        setTopics([]);
      }
    } catch (err) {
      console.error("fetchTopics error:", err);
      setError("全社論点を取得できませんでした。時間をおいて再度お試しください。");
      setTopics([]);
    } finally {
      setLoading(false);
    }
  };

  const persistTopicPatch = async (topicId: string, patch: TopicEditablePatch) => {
    try {
      const { ok, data: sessionData } = await safeGetSession();
      if (!ok || !sessionData?.session?.access_token) {
        setSaveNotice("画面上に反映しました。ログイン後の環境では保存APIにも送信されます。");
        return;
      }

      const res = await fetch(`/api/org-alignment/shared/topics/${topicId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${sessionData.session.access_token}`,
        },
        body: JSON.stringify({
          alignment_result: patch.alignmentResult,
          changed_things: patch.changedThings,
          unchanged_things: patch.unchangedThings,
          next_actions: patch.nextActions,
          strategy_reflection: patch.strategyReflection,
          status: patch.status ? mapUiStatusToDbStatus(patch.status) : undefined,
        }),
      });

      if (!res.ok) {
        setSaveNotice("画面上に反映しました。保存APIが未対応の場合は、API側のPATCH実装を追加してください。");
        return;
      }

      setSaveNotice("保存しました。");
    } catch (err) {
      console.error("persistTopicPatch error:", err);
      setSaveNotice("画面上に反映しました。サーバー保存は確認できませんでした。");
    }
  };

  const handleUpdateTopic = (topicId: string, patch: TopicEditablePatch) => {
    const nextPatch = {
      ...patch,
      updatedAt: getTodayString(),
    };

    setTopics((currentTopics) =>
      currentTopics.map((topic) =>
        topic.id === topicId
          ? {
              ...topic,
              ...nextPatch,
            }
          : topic,
      ),
    );

    void persistTopicPatch(topicId, nextPatch);
  };

  const handleCreateStage3Candidate = async (topic: SharedAlignmentTopic) => {
    try {
      const { ok, data: sessionData } = await safeGetSession();
      if (!ok || !sessionData?.session?.access_token) {
        setSaveNotice("ログインしてください。");
        return;
      }

      // 1. strategy_reflection を生成
      const strategyReflection = buildReflectionCandidate(topic, "stage3");

      // 2. トピック側の strategy_reflection を更新
      const patchRes = await fetch(`/api/org-alignment/shared/topics/${topic.id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${sessionData.session.access_token}`,
        },
        body: JSON.stringify({
          strategy_reflection: strategyReflection,
        }),
      });

      if (!patchRes.ok) {
        setSaveNotice("STAGE3反映候補の作成に失敗しました。");
        return;
      }

      // 3. 反映候補テーブルに登録
      const res = await fetch(`/api/org-alignment/shared/topics/${topic.id}/reflection-candidates`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${sessionData.session.access_token}`,
        },
        body: JSON.stringify({ target_stage: "stage3" }),
      });

      if (!res.ok) {
        setSaveNotice("STAGE3反映候補の登録に失敗しました。");
        return;
      }

      const data = await res.json();
      if (data.topic) {
        setTopics((currentTopics) =>
          currentTopics.map((t) => (t.id === topic.id ? { ...t, strategyReflection: data.topic.strategy_reflection } : t))
        );
        setSaveNotice(`✅ STAGE3への反映候補を作成しました。「${topic.title}」のプロジェクト候補がSTAGE3で確認できます。`);
      }
    } catch (err) {
      console.error("handleCreateStage3Candidate error:", err);
      setSaveNotice("❌ STAGE3反映候補の作成に失敗しました。");
    }
  };

  const handleCreateStage4Candidate = async (topic: SharedAlignmentTopic) => {
    try {
      const { ok, data: sessionData } = await safeGetSession();
      if (!ok || !sessionData?.session?.access_token) {
        setSaveNotice("❌ ログインしてください。");
        return;
      }

      // 1. strategy_reflection を生成
      const strategyReflection = buildReflectionCandidate(topic, "stage4");

      // 2. トピック側の strategy_reflection を更新
      const patchRes = await fetch(`/api/org-alignment/shared/topics/${topic.id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${sessionData.session.access_token}`,
        },
        body: JSON.stringify({
          strategy_reflection: strategyReflection,
        }),
      });

      if (!patchRes.ok) {
        setSaveNotice("❌ STAGE4反映候補の作成に失敗しました。");
        return;
      }

      // 3. 反映候補テーブルに登録
      const res = await fetch(`/api/org-alignment/shared/topics/${topic.id}/reflection-candidates`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${sessionData.session.access_token}`,
        },
        body: JSON.stringify({ target_stage: "stage4" }),
      });

      if (!res.ok) {
        setSaveNotice("❌ STAGE4反映候補の登録に失敗しました。");
        return;
      }

      const data = await res.json();
      if (data.topic) {
        setTopics((currentTopics) =>
          currentTopics.map((t) => (t.id === topic.id ? { ...t, strategyReflection: data.topic.strategy_reflection } : t))
        );
        setSaveNotice(`✅ STAGE4への実行計画候補を作成しました。「${topic.title}」の実行計画候補がSTAGE4で確認できます。`);
      }
    } catch (err) {
      console.error("handleCreateStage4Candidate error:", err);
      setSaveNotice("❌ STAGE4反映候補の作成に失敗しました。");
    }
  };

  const handleResetReflection = async (topicId: string) => {
    try {
      console.log("[handleResetReflection] Starting reset for topicId:", topicId);
      const { ok, data: sessionData } = await safeGetSession();
      if (!ok || !sessionData?.session?.access_token) {
        console.warn("[handleResetReflection] Not authenticated");
        setSaveNotice("ログインしてください。");
        return;
      }

      const res = await fetch('/api/org-alignment/shared/topics/reset-reflection', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${sessionData.session.access_token}`,
        },
        body: JSON.stringify({ shared_topic_id: topicId }),
      });

      console.log("[handleResetReflection] API response status:", res.status);
      const resData = await res.json();
      console.log("[handleResetReflection] API response data:", resData);

      if (!res.ok) {
        console.error("[handleResetReflection] API error:", resData);
        setSaveNotice(`❌ 反映状態のリセットに失敗しました。(${res.status})`);
        return;
      }

      // トピックの strategyReflection を更新（状態を「未反映」に戻す）
      setTopics((currentTopics) => {
        console.log("[handleResetReflection] Resetting to未反映 state");
        return currentTopics.map((t) => {
          if (t.id === topicId) {
            const newStatus = {
              stage3Status: "未反映" as Stage3Status,
              stage4Status: "未反映" as Stage4Status,
              stage3Confirmed: false,
              stage4Confirmed: false,
            };
            console.log("[handleResetReflection] New status:", newStatus);

            return {
              ...t,
              strategyReflection: {
                ...t.strategyReflection,
                ...newStatus,
              },
            };
          }
          return t;
        });
      });

      setSaveNotice("✅ 反映状態をリセットしました。");
    } catch (err) {
      console.error("[handleResetReflection] Caught error:", err);
      setSaveNotice("❌ 反映状態のリセットに失敗しました。");
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
      alignmentTargets: topics.filter((topic) => topic.status !== "対応方針決定").length,
      explanationNeeded: 1,
      inProgress: topics.filter((topic) => topic.status === "すり合わせ中").length,
      decided: topics.filter((topic) => topic.status === "対応方針決定").length,
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
              組織変革・全社すり合わせルーム
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
              見えた組織課題は、共有して終わりではありません。必要に応じてSTAGE3の事業・部門別戦略やSTAGE4の実行計画へ還流し、具体的なプロジェクト・OKRとして推進します。
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
              {error ? (
                <>
                  <p className="mt-2 font-bold text-slate-950">データ取得エラー</p>
                  <p className="mt-2 text-xs leading-5 text-orange-600">{error}</p>
                </>
              ) : topics.length === 0 ? (
                <>
                  <p className="mt-2 font-bold text-slate-950">公開中の論点なし</p>
                  <p className="mt-2 text-xs leading-5 text-slate-600">現在、公開されている全社論点はありません。</p>
                </>
              ) : (
                <>
                  <p className="mt-2 font-bold text-slate-950">実運用データ</p>
                  <p className="mt-2 text-xs leading-5 text-slate-600">投稿データから自動集計した{topics.length}件の論点を表示しています。</p>
                </>
              )}
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
          <MetricCard label="STAGE3反映候補" value={`${summaryData.stage3Targets}件`} description="事業・部門別戦略への反映対象" />
          <MetricCard label="STAGE4実行計画への反映候補" value={`${summaryData.stage4Targets}件`} description="実行計画への反映対象" />
        </section>

        <section className="space-y-5">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-2xl font-bold text-slate-950">全社論点一覧</h2>
              <p className="mt-2 text-slate-600">
                社員から寄せられた違和感のAI集計結果と、会社としてのすり合わせ状況を確認できます。
              </p>
            </div>
            <button
              type="button"
              onClick={() => setShowHowToModal(true)}
              className="shrink-0 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-800 transition hover:bg-slate-50"
            >
              このルームの使い方
            </button>
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

          {saveNotice && (
            <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-700 shadow-sm">
              {saveNotice}
            </div>
          )}

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
                  onUpdateTopic={handleUpdateTopic}
                  onCreateStage3Candidate={handleCreateStage3Candidate}
                  onCreateStage4Candidate={handleCreateStage4Candidate}
                  onResetReflection={handleResetReflection}
                  isAdmin={isAdmin}
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

      {/* このルームの使い方 モーダル */}
      {showHowToModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="max-h-[90vh] max-w-2xl overflow-y-auto rounded-3xl bg-white shadow-2xl">
            <div className="space-y-6 p-8">
              <div className="flex items-center justify-between">
                <h2 className="text-2xl font-bold text-slate-950">このルームの使い方</h2>
                <button
                  onClick={() => setShowHowToModal(false)}
                  className="text-slate-500 hover:text-slate-700"
                >
                  ✕
                </button>
              </div>

              <div className="space-y-6">
                <div>
                  <h3 className="text-lg font-bold text-slate-950">声が論点になるまで</h3>
                  <p className="mt-2 leading-7 text-slate-700">
                    全社すり合わせルームでは、個別の声をそのまま並べるのではなく、AI集計によって会社として扱うべき共通論点に変換し、すり合わせと結果共有までつなげます。
                  </p>
                  <div className="mt-4 grid gap-3 md:grid-cols-2 lg:grid-cols-3">
                    <div className="rounded-lg bg-slate-50 p-3">
                      <div className="text-sm font-semibold text-slate-900">1. 社員が違和感を入力</div>
                      <p className="mt-1 text-xs text-slate-600">日々のもやもやや違和感を、個人が特定されない形で蓄積します。</p>
                    </div>
                    <div className="rounded-lg bg-slate-50 p-3">
                      <div className="text-sm font-semibold text-slate-900">2. AIが認識のズレを整理</div>
                      <p className="mt-1 text-xs text-slate-600">感情や不満を、判断基準・役割・優先順位のズレとして構造化します。</p>
                    </div>
                    <div className="rounded-lg bg-slate-50 p-3">
                      <div className="text-sm font-semibold text-slate-900">3. 共通論点へ集約</div>
                      <p className="mt-1 text-xs text-slate-600">類似する声を束ね、会社として扱うべき論点に変換します。</p>
                    </div>
                    <div className="rounded-lg bg-slate-50 p-3">
                      <div className="text-sm font-semibold text-slate-900">4. 優先順位を判定</div>
                      <p className="mt-1 text-xs text-slate-600">件数、影響範囲、緊急性、顧客影響、離職リスクなどで整理します。</p>
                    </div>
                    <div className="rounded-lg bg-slate-50 p-3">
                      <div className="text-sm font-semibold text-slate-900">5. 関係者ですり合わせ</div>
                      <p className="mt-1 text-xs text-slate-600">論点に応じて、個別・部門内・部門横断・経営対話の場を設定します。</p>
                    </div>
                    <div className="rounded-lg bg-slate-50 p-3">
                      <div className="text-sm font-semibold text-slate-900">6. 結果を全社共有</div>
                      <p className="mt-1 text-xs text-slate-600">会社としての判断、変えること、変えないこと、次の対応を共有します。</p>
                    </div>
                  </div>
                </div>

                <div className="border-t border-slate-200 pt-6">
                  <h3 className="text-lg font-bold text-slate-950">すり合わせの5原則</h3>
                  <p className="mt-2 leading-7 text-slate-700">
                    全社すり合わせルームでは、個人や部門を責めるのではなく、会社が目指す方向に向けて認識のズレを整えることを目的とします。
                  </p>
                  <div className="mt-4 space-y-3">
                    <div className="rounded-lg bg-blue-50 p-3">
                      <div className="text-sm font-semibold text-blue-900">1. 人や組織を悪者にしない</div>
                      <p className="mt-1 text-xs text-blue-700">個人や部門を責めず、判断基準・役割・優先順位のズレとして扱う。</p>
                    </div>
                    <div className="rounded-lg bg-blue-50 p-3">
                      <div className="text-sm font-semibold text-blue-900">2. 認識のズレをすり合わせる</div>
                      <p className="mt-1 text-xs text-blue-700">それぞれの立場で見えている事実、前提、期待値を確認する。</p>
                    </div>
                    <div className="rounded-lg bg-blue-50 p-3">
                      <div className="text-sm font-semibold text-blue-900">3. 会社の目指す方向性に沿う結論にする</div>
                      <p className="mt-1 text-xs text-blue-700">最終判断は、会社の戦略・顧客価値・業績改善・組織のあるべき姿に照らして行う。</p>
                    </div>
                    <div className="rounded-lg bg-blue-50 p-3">
                      <div className="text-sm font-semibold text-blue-900">4. 変えること・変えないことを明確にする</div>
                      <p className="mt-1 text-xs text-blue-700">改善すること、説明すること、今は変えないことを分ける。</p>
                    </div>
                    <div className="rounded-lg bg-blue-50 p-3">
                      <div className="text-sm font-semibold text-blue-900">5. 結果を共有し、次の行動につなげる</div>
                      <p className="mt-1 text-xs text-blue-700">会社としての判断、次アクション、担当、期限を残す。</p>
                    </div>
                  </div>
                </div>
              </div>

              <button
                onClick={() => setShowHowToModal(false)}
                className="w-full rounded-lg border border-slate-300 bg-white px-4 py-3 text-sm font-semibold text-slate-800 transition hover:bg-slate-50"
              >
                閉じる
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
