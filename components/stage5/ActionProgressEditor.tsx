'use client';

/* STAGE5 の実施事項ごとの進捗・成果・紐づくKRを記録する。計画の内容（STAGE4）は変えない。
 * KRとの紐づけは利用者が選んだものだけを保存する（AIの推測では紐づけない）。 */
import { useState } from 'react';

import {
  ACTION_STATUSES,
  ACTION_STATUS_LABEL,
  NOTE_MAX,
  RESULT_MAX,
  type ActionProgressRecord,
  type ActionStatus,
} from '@/lib/stage5/actionProgress';
import type { StartedPlanAction } from '@/lib/stage5/startedPlans';
import { writeActionProgress } from '@/lib/stage5/actionProgressStore';

export type LinkableKr = { id: string; label: string; target: number | null; unit: string; due: string | null; actual: number | null; asOf: string | null };

const shortUser = (id: string) => (id ? `…${id.slice(-4)}` : '不明');
const dateText = (iso: string) => {
  const d = new Date(iso);
  return Number.isFinite(d.getTime()) ? d.toLocaleDateString('ja-JP') : '';
};

export function ActionProgressEditor(props: {
  companyId: string;
  strategyId: string;
  projectId: string;
  userId: string;
  actions: StartedPlanAction[];
  allowedKeys: string[];
  progress: Record<string, ActionProgressRecord>;
  krs: LinkableKr[];
}) {
  return (
    <ol className="mt-1 space-y-3 text-sm text-slate-700">
      {props.actions.map((a) => (
        <ActionRow key={a.actionKey || `no-${a.no}`} {...props} action={a} record={props.progress[a.actionKey]} />
      ))}
    </ol>
  );
}

function ActionRow(props: Parameters<typeof ActionProgressEditor>[0] & { action: StartedPlanAction; record: ActionProgressRecord | undefined }) {
  const { action: a, record } = props;
  const [status, setStatus] = useState<ActionStatus>(record?.status ?? 'NOT_STARTED');
  const [result, setResult] = useState<string>(record?.result ?? '');
  const [issue, setIssue] = useState<string>(record?.issue ?? '');
  const [nextAction, setNextAction] = useState<string>(record?.nextAction ?? '');
  const [krIds, setKrIds] = useState<string[]>(record?.krIds ?? []);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const linked = props.krs.filter((k) => (record?.krIds ?? []).includes(k.id));

  const save = async () => {
    setBusy(true);
    setMessage(null);
    const r = await writeActionProgress({
      companyId: props.companyId,
      strategyId: props.strategyId,
      projectId: props.projectId,
      allowedKeys: props.allowedKeys,
      actionKey: a.actionKey,
      patch: { status, result, issue, nextAction, krIds },
      userId: props.userId,
    });
    setBusy(false);
    setMessage(r.ok ? (r.changed ? '保存しました。' : '変更はありません。') : r.message);
  };

  return (
    <li className="rounded-lg border border-slate-100 px-3 py-2">
      <details>
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3">
          <span className="text-base font-medium text-slate-800">
            {a.no}. {a.title}
          </span>
          <span className="flex shrink-0 items-center gap-2 text-xs text-slate-500">
            <span>{ACTION_STATUS_LABEL[status]}</span>
            <span>期限：{a.due}</span>
          </span>
        </summary>
        <div className="mt-2 text-xs text-slate-500">担当：{a.owner}</div>
      {record && (
        <div className="mt-1 text-xs text-slate-500">
          最終更新：{dateText(record.updatedAt)}　記録者：{shortUser(record.updatedBy)}
        </div>
      )}
      <div className="mt-2 grid grid-cols-1 gap-2 md:grid-cols-2">
        <label className="text-xs text-slate-600">
          進捗
          <select
            aria-label={`${a.no}. の進捗`}
            className="mt-1 w-full rounded border border-slate-300 p-1 text-sm"
            value={status}
            disabled={busy}
            onChange={(e) => setStatus(e.target.value as ActionStatus)}
          >
            {ACTION_STATUSES.map((s) => (
              <option key={s} value={s}>
                {ACTION_STATUS_LABEL[s]}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs text-slate-600">
          成果（{RESULT_MAX}字以内）
          <textarea
            aria-label={`${a.no}. の成果`}
            className="mt-1 w-full rounded border border-slate-300 p-1 text-sm"
            rows={2}
            maxLength={RESULT_MAX}
            value={result}
            disabled={busy}
            onChange={(e) => setResult(e.target.value)}
          />
        </label>
        <label className="text-xs text-slate-600">
          課題（{NOTE_MAX}字以内）
          <textarea
            aria-label={`${a.no}. の課題`}
            className="mt-1 w-full rounded border border-slate-300 p-1 text-sm"
            rows={2}
            maxLength={NOTE_MAX}
            value={issue}
            disabled={busy}
            onChange={(e) => setIssue(e.target.value)}
          />
        </label>
        <label className="text-xs text-slate-600">
          次の行動（{NOTE_MAX}字以内）
          <textarea
            aria-label={`${a.no}. の次の行動`}
            className="mt-1 w-full rounded border border-slate-300 p-1 text-sm"
            rows={2}
            maxLength={NOTE_MAX}
            value={nextAction}
            disabled={busy}
            onChange={(e) => setNextAction(e.target.value)}
          />
        </label>
      </div>
      {props.krs.length > 0 && (
        <fieldset className="mt-2 text-xs text-slate-600">
          <legend>関連するKR（利用者が選んだものだけ紐づけます）</legend>
          <div className="mt-1 flex flex-wrap gap-3">
            {props.krs.map((k) => (
              <label key={k.id} className="flex items-center gap-1">
                <input
                  type="checkbox"
                  aria-label={`${a.no}. と「${k.label}」を紐づける`}
                  checked={krIds.includes(k.id)}
                  disabled={busy}
                  onChange={(e) => setKrIds((prev) => (e.target.checked ? [...prev, k.id] : prev.filter((x) => x !== k.id)))}
                />
                {k.label}
              </label>
            ))}
          </div>
        </fieldset>
      )}
      {linked.length > 0 && (
        <p className="mt-1 text-xs text-slate-500">
          紐づくKR：{linked.map((k) => `${k.label}（目標 ${k.target ?? '未設定'}${k.unit}／実績 ${k.actual ?? '未登録'}${k.actual !== null ? k.unit : ''}）`).join('、')}
        </p>
      )}
      <div className="mt-2 flex items-center gap-3">
        <button type="button" className="rounded-lg bg-slate-800 px-3 py-1 text-xs font-semibold text-white disabled:opacity-50" disabled={busy} onClick={save}>
          進捗を保存
        </button>
        {message && <span role="status" className="text-xs text-slate-600">{message}</span>}
      </div>
      </details>
    </li>
  );
}
