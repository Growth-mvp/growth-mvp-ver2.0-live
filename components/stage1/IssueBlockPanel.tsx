// /components/stage1/IssueBlockPanel.tsx
'use client';

import type { ChangeEvent } from 'react';
import { useCallback } from 'react';
import { useStrategyStore } from '@/store/strategyStore';
import type { Stage1IssueBlock } from '@/store/strategyStore';

/* ===============================
 * 定数
 * =============================== */

const METRIC_OPTIONS = [
  { key: 'operatingMargin', label: '営業利益率' },
  { key: 'revenueCAGR', label: '売上成長率' },
  { key: 'debtEquityRatio', label: 'D/Eレシオ' },
  { key: 'roic', label: 'ROIC' },
  { key: 'pbr', label: 'PBR' },
] as const;

type MetricKey = (typeof METRIC_OPTIONS)[number]['key'];

/* ===============================
 * コンポーネント
 * =============================== */

export default function IssueBlockPanel() {
  // store から stage1Issues を取得（リロードで消えない）
  const issues = useStrategyStore((s) => (Array.isArray(s.stage1Issues) ? s.stage1Issues : []));
  const setStage1Issues = useStrategyStore((s) => s.setStage1Issues);

  const addIssue = useCallback(() => {
    if (issues.length >= 5) return;

    const next: Stage1IssueBlock[] = [
      ...issues,
      {
        title: '',
        description: '',
        linkedMetrics: [],
        scope: 'company',
      },
    ];
    setStage1Issues(next);
  }, [issues, setStage1Issues]);

  const updateIssue = useCallback(
    (index: number, patch: Partial<Stage1IssueBlock>) => {
      const next = [...issues];
      next[index] = { ...next[index], ...patch };
      setStage1Issues(next);
    },
    [issues, setStage1Issues]
  );

  const removeIssue = useCallback(
    (index: number) => {
      const next = issues.filter((_, i) => i !== index);
      setStage1Issues(next);
    },
    [issues, setStage1Issues]
  );

  return (
    <section>
      <h2 className="text-xl font-semibold mb-4">④ 論点整理（STAGE2への接続点）</h2>

      <p className="text-sm text-gray-600 mb-6">
        財務指標を踏まえ、経営として向き合うべき論点を整理します。解決策や戦略はここでは書かず、
        「何が論点か」を明確にしてください。
      </p>

      <div className="space-y-6">
        {issues.map((issue, index) => (
          <IssueEditor
            key={index}
            index={index}
            issue={issue}
            onChange={(patch) => updateIssue(index, patch)}
            onRemove={() => removeIssue(index)}
          />
        ))}
      </div>

      <div className="mt-6 flex items-center gap-3">
        <button
          onClick={addIssue}
          disabled={issues.length >= 5}
          className="border px-4 py-2 rounded disabled:opacity-50 disabled:cursor-not-allowed"
        >
          論点を追加
        </button>
        <div className="text-sm text-gray-500">
          {issues.length}/5
        </div>
      </div>
    </section>
  );
}

/* ===============================
 * Issue 編集ブロック
 * =============================== */

function IssueEditor({
  index,
  issue,
  onChange,
  onRemove,
}: {
  index: number;
  issue: Stage1IssueBlock;
  onChange: (patch: Partial<Stage1IssueBlock>) => void;
  onRemove: () => void;
}) {
  return (
    <div className="border rounded p-4 space-y-4">
      <div className="flex justify-between items-center">
        <h3 className="font-semibold">論点 {index + 1}</h3>
        <button className="text-sm text-red-500" onClick={onRemove}>
          削除
        </button>
      </div>

      {/* タイトル */}
      <div>
        <label className="block text-sm font-medium">論点タイトル</label>
        <input
          className="border px-3 py-2 w-full"
          placeholder="例：収益性が業界水準を下回っている"
          value={issue.title}
          onChange={(e) => onChange({ title: e.target.value })}
        />
      </div>

      {/* 説明 */}
      <div>
        <label className="block text-sm font-medium">論点の説明</label>
        <textarea
          className="border px-3 py-2 w-full"
          rows={3}
          placeholder="どの指標が、どのような状態にあるため論点と考えるか"
          value={issue.description}
          onChange={(e) => onChange({ description: e.target.value })}
        />
      </div>

      {/* 根拠指標 */}
      <div>
        <label className="block text-sm font-medium mb-2">根拠となる指標</label>
        <div className="flex flex-wrap gap-3">
          {METRIC_OPTIONS.map((m) => {
            const checked = Array.isArray(issue.linkedMetrics) && issue.linkedMetrics.includes(m.key);
            return (
              <label key={m.key} className="text-sm flex gap-1 items-center">
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={(e: ChangeEvent<HTMLInputElement>) => {
                    const current = Array.isArray(issue.linkedMetrics) ? issue.linkedMetrics : [];
                    const next: MetricKey[] = e.target.checked
                      ? ([...current, m.key] as MetricKey[])
                      : (current.filter((k) => k !== m.key) as MetricKey[]);
                    onChange({ linkedMetrics: next });
                  }}
                />
                {m.label}
              </label>
            );
          })}
        </div>
      </div>

      {/* スコープ */}
      <div>
        <label className="block text-sm font-medium mb-1">対象範囲</label>
        <select
          className="border px-3 py-2"
          value={issue.scope}
          onChange={(e) => onChange({ scope: e.target.value as Stage1IssueBlock['scope'] })}
        >
          <option value="company">全社</option>
          <option value="business">事業</option>
        </select>
      </div>
    </div>
  );
}
