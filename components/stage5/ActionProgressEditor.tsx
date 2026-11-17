'use client';

/* STAGE5 の実施事項ごとの進捗と進捗メモを記録する。計画の内容（STAGE4）は変えない。
 * 進捗メモは「成果・課題・次の行動」を1つにまとめた欄（保存は成果の項目）。以前に保存した課題・次の行動は消さず、読み取りで表示する。
 * 保存は1回にまとめ、変更のあった実施事項だけを順に書く。一部が失敗したら、保存できた件と失敗した件を分けて伝える。 */
import { useState } from 'react';

import {
  ACTION_STATUSES,
  ACTION_STATUS_LABEL,
  RESULT_MAX,
  type ActionProgressRecord,
  type ActionStatus,
} from '@/lib/stage5/actionProgress';
import type { StartedPlanAction } from '@/lib/stage5/startedPlans';
import { writeActionProgress } from '@/lib/stage5/actionProgressStore';

export type LinkableKr = { id: string; label: string; target: number | null; unit: string; due: string | null; actual: number | null; asOf: string | null };

type Draft = { status: ActionStatus; memo: string };

const draftOf = (record: ActionProgressRecord | undefined): Draft => ({
  status: record?.status ?? 'NOT_STARTED',
  memo: record?.result ?? '',
});

const sameDraft = (a: Draft, b: Draft) => a.status === b.status && a.memo === b.memo;

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
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);

  const draftFor = (actionKey: string) => drafts[actionKey] ?? draftOf(props.progress[actionKey]);
  const changed = props.actions.filter(
    (a) => a.actionKey !== '' && drafts[a.actionKey] !== undefined && !sameDraft(drafts[a.actionKey], draftOf(props.progress[a.actionKey])),
  );

  const saveAll = async () => {
    if (busy || changed.length === 0) return;
    setBusy(true);
    setMessage(null);
    const savedKeys: string[] = [];
    const failed: Array<{ title: string; reason: string }> = [];
    for (const a of changed) {
      const draft = drafts[a.actionKey];
      const r = await writeActionProgress({
        companyId: props.companyId,
        strategyId: props.strategyId,
        projectId: props.projectId,
        allowedKeys: props.allowedKeys,
        actionKey: a.actionKey,
        patch: { status: draft.status, result: draft.memo },
        userId: props.userId,
      });
      if (r.ok) savedKeys.push(a.actionKey);
      else failed.push({ title: `${a.no}. ${a.title}`, reason: r.message });
    }
    setDrafts((prev) => Object.fromEntries(Object.entries(prev).filter(([key]) => !savedKeys.includes(key))));
    setBusy(false);
    if (failed.length === 0) {
      setMessage({ tone: 'ok', text: `${savedKeys.length}件の進捗を保存しました。` });
    } else {
      setMessage({
        tone: 'error',
        text: `${savedKeys.length}件を保存し、${failed.length}件は保存できませんでした（${failed.map((f) => f.title).join('、')}）。保存できなかった項目は入力を残しています。${failed[0].reason}`,
      });
    }
  };

  return (
    <div className="space-y-3">
      <ol className="mt-1 space-y-3 text-sm text-slate-700">
        {props.actions.map((a) => (
          <ActionRow
            key={a.actionKey || `no-${a.no}`}
            action={a}
            record={props.progress[a.actionKey]}
            draft={a.actionKey ? draftFor(a.actionKey) : draftOf(undefined)}
            krs={props.krs}
            disabled={busy}
            onChange={(next) => a.actionKey && setDrafts((prev) => ({ ...prev, [a.actionKey]: next }))}
          />
        ))}
      </ol>
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          className="rounded-lg bg-slate-800 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
          disabled={busy || changed.length === 0}
          onClick={() => void saveAll()}
        >
          {busy ? '保存中…' : '進捗を保存'}
        </button>
        {changed.length > 0 && !busy && <span className="text-xs text-slate-500">未保存の変更が{changed.length}件あります</span>}
        {message && (
          <span role={message.tone === 'error' ? 'alert' : 'status'} className={`text-xs ${message.tone === 'error' ? 'text-red-700' : 'text-slate-600'}`}>
            {message.text}
          </span>
        )}
      </div>
    </div>
  );
}

function ActionRow(props: {
  action: StartedPlanAction;
  record: ActionProgressRecord | undefined;
  draft: Draft;
  krs: LinkableKr[];
  disabled: boolean;
  onChange: (next: Draft) => void;
}) {
  const { action: a, record, draft } = props;
  const linked = props.krs.filter((k) => (record?.krIds ?? []).includes(k.id));
  const legacyIssue = record?.issue ?? '';
  const legacyNext = record?.nextAction ?? '';

  return (
    <li className="rounded-lg border border-slate-100 px-3 py-2">
      <details>
        <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-x-3 gap-y-1">
          <span className="text-base font-medium text-slate-800">
            {a.no}. {a.title}
          </span>
          <span className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
            <span>{ACTION_STATUS_LABEL[draft.status]}</span>
            <span>担当：{a.owner}</span>
            <span>期限：{a.due}</span>
          </span>
        </summary>
        <div className="mt-2 grid grid-cols-1 gap-2 md:grid-cols-[12rem_1fr]">
          <label className="text-xs text-slate-600">
            進捗
            <select
              aria-label={`${a.no}. の進捗`}
              className="mt-1 w-full rounded border border-slate-300 p-1 text-sm"
              value={draft.status}
              disabled={props.disabled || !a.actionKey}
              onChange={(e) => props.onChange({ ...draft, status: e.target.value as ActionStatus })}
            >
              {ACTION_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {ACTION_STATUS_LABEL[s]}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs text-slate-600">
            進捗メモ（成果・課題・次の行動。{RESULT_MAX}字以内）
            <textarea
              aria-label={`${a.no}. の進捗メモ`}
              className="mt-1 w-full rounded border border-slate-300 p-1 text-sm"
              rows={3}
              maxLength={RESULT_MAX}
              value={draft.memo}
              disabled={props.disabled || !a.actionKey}
              onChange={(e) => props.onChange({ ...draft, memo: e.target.value })}
            />
          </label>
        </div>
        {(legacyIssue || legacyNext) && (
          <div className="mt-2 space-y-1 rounded bg-slate-50 p-2 text-xs text-slate-600">
            <p className="font-medium text-slate-500">以前の記録（保存したまま残しています）</p>
            {legacyIssue && <p>課題：{legacyIssue}</p>}
            {legacyNext && <p>次の行動（旧項目）：{legacyNext}</p>}
          </div>
        )}
        {linked.length > 0 && (
          <p className="mt-2 text-xs text-slate-500">
            紐づくKR：{linked.map((k) => `${k.label}（目標 ${k.target ?? '未設定'}${k.unit}／実績 ${k.actual ?? '未登録'}${k.actual !== null ? k.unit : ''}）`).join('、')}
          </p>
        )}
      </details>
    </li>
  );
}
