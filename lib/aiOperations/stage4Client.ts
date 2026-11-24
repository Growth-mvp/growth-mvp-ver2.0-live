'use client';

import { supabase } from '@/utils/supabase/client';
import { createRemotePlanOps, createRemotePlanStore, type ApiOptions } from '@/lib/stage4/plan/planClient';
import type { PlanDocActor, PlanDocKey, PlanDocRecord } from '@/lib/stage4/plan/planDocumentStore';
import { actionsOf, currentValueOf, dueYmFrom, goalAfter, goalOf, matchAction, type Stage4Draft, type Stage4Intent, type Stage4Change } from './stage4';
import type { OperationProposal } from './instruction';
import { stableIdOf } from '@/lib/stage4/plan/projectResolver';
import { isProjectActive } from '@/lib/cascade/projectLifecycle';

const API: ApiOptions = {
  baseUrl: '',
  getToken: async () => (await supabase.auth.getSession()).data.session?.access_token ?? null,
};

export const planStore = () => createRemotePlanStore(API);
export const planOps = () => createRemotePlanOps(API);

export type Stage4ProjectRef = { departmentName: string; projectId: string; title: string };

export type Stage4Result =
  | { kind: 'message'; text: string }
  | { kind: 'proposal'; proposal: Extract<OperationProposal, { kind: 'stage4.plan' }> }
  | { kind: 'navigate'; href: string; text: string };

const GENERATE_MESSAGE: Record<string, string> = {
  IN_PROGRESS: '実行計画書を作成中です。完了するまで待ってから、もう一度お試しください。',
  DISABLED: 'この環境では実行計画書を作成できません。',
  UNAVAILABLE: '実行計画書の保存先に接続できませんでした。時間をおいて再度お試しください。',
  NOT_FOUND: '対象の施策が見つかりませんでした。画面を再読み込みしてください。',
  DENIED: 'この会社の実行計画書を作成する権限がありません。',
  MODEL_FAILED: '実行計画書の原案を作れませんでした。時間をおいて再度お試しください。',
  FAILED: '実行計画書の作成に失敗しました。時間をおいて再度お試しください。',
};

/** プロジェクトを、指示の語句か、画面で選んでいる施策で決める。一意に決まらなければ null */
export function pickProject(
  text: string,
  projects: Stage4ProjectRef[],
  selectedProjectId: string | null,
  contextTitle: string | null = null,
): Stage4ProjectRef | null {
  const squashed = text.replace(/[\s　]+/g, '');
  const named = projects.filter((p) => p.title && squashed.includes(p.title.replace(/[\s　]+/g, '')));
  if (named.length === 1) return named[0];
  if (named.length > 1) return null;
  const open = projects.find((p) => contextTitle !== null && p.title === contextTitle);
  if (open) return open;
  const selected = projects.find((p) => p.projectId === selectedProjectId);
  if (selected) return selected;
  return projects.length === 1 ? projects[0] : null;
}

export function changesFor(
  intent: Extract<Stage4Intent, { kind: 'goal' | 'due' }>,
  record: PlanDocRecord,
  now: Date,
): { changes: Stage4Change[]; edits: Record<string, string> } | { message: string } {
  const draft = ((record.aiDraft as { plan?: unknown }).plan ?? record.aiDraft) as Stage4Draft;
  const edits = (record.userEdits ?? {}) as Record<string, unknown>;
  if (intent.kind === 'goal') {
    const before = currentValueOf(draft, edits, 'goal', goalOf(draft));
    const after = goalAfter(before, intent.addition);
    return { changes: [{ itemId: 'goal', label: '目的', before, after }], edits: { goal: after } };
  }
  const actions = actionsOf(draft);
  const hit = matchAction(actions, intent.actionHint);
  if (!hit) return { message: '実施事項がまだありません。計画書の実施事項を作ってから、もう一度指示してください。' };
  if ('ambiguous' in hit) {
    return { message: `どの実施事項の期限か教えてください：${hit.ambiguous.join('、')}` };
  }
  const dueYm = dueYmFrom(intent.dueText, now);
  if (!dueYm) return { message: '期限を読み取れませんでした。「来年3月末」のように年と月を入れてください。' };
  const itemId = `action:${hit.order}:due`;
  const before = currentValueOf(draft, edits, itemId, hit.dueYm);
  if (before === dueYm) return { message: `実施事項「${hit.title}」の期限は、すでに${dueYm}です。` };
  return {
    changes: [{ itemId, label: `実施事項「${hit.title}」の期限`, before, after: dueYm }],
    edits: { [itemId]: dueYm },
  };
}

/** 指示を、計画書の変更案・採用・保存などの結果にする。保存はしない（承認はカードで行う） */
export async function requestStage4(args: {
  intent: Stage4Intent;
  text: string;
  companyId: string;
  strategyId: string;
  actor: PlanDocActor;
  projects: Stage4ProjectRef[];
  excludedTitles: string[];
  selectedProjectId: string | null;
  contextTitle: string | null;
  now: Date;
  pathnameNow: string;
  hasPendingStage4: boolean;
}): Promise<Stage4Result> {
  const { intent } = args;
  if (intent.kind === 'action-add') {
    return { kind: 'message', text: '実施事項の追加は、この画面では扱えません。計画書の「実施事項」から追加してください。実施事項の期限や目的の変更は、ここで指示できます。' };
  }
  if (intent.kind === 'save') {
    return {
      kind: 'message',
      text: args.hasPendingStage4
        ? '入力案の内容を確かめて、表示された「承認して保存」を押してください。承認するまで保存されません。'
        : '保存する変更案がありません。先に「目的に〇〇を追加して」などと指示してください。',
    };
  }
  const squashed = args.text.replace(/[\s　]+/g, '');
  const excluded = args.excludedTitles.find((t) => t && squashed.includes(t.replace(/[\s　]+/g, '')));
  if (excluded) {
    return { kind: 'message', text: `「${excluded}」は中止・除外されているため、操作の対象にできません。` };
  }
  const project = pickProject(args.text, args.projects, args.selectedProjectId, args.contextTitle);
  if (!project) {
    return { kind: 'message', text: 'どの施策の実行計画書か教えてください（施策の名前を含めて指示してください）。' };
  }
  const key: PlanDocKey = { companyId: args.companyId, strategyId: args.strategyId, projectId: project.projectId };
  const href = `/okr?dept=${encodeURIComponent(project.departmentName)}&project=${encodeURIComponent(project.title)}`;

  if (intent.kind === 'generate') {
    const r = await planOps().generate(key);
    if (r.status === 'CREATED' || r.status === 'EXISTS') {
      return {
        kind: 'navigate',
        href,
        text:
          r.status === 'CREATED'
            ? `「${project.title}」の実行計画書の原案を作りました。まだ保存された計画ではありません。STAGE4の画面で内容を確認し、修正できます。`
            : `「${project.title}」の実行計画書は、すでにあります。STAGE4の画面で確認できます。`,
      };
    }
    if (r.status === 'INVALID') {
      return { kind: 'message', text: `実行計画書の原案を作るための条件がそろっていません：${r.messages.join('、')}` };
    }
    if (r.status === 'MODEL_FAILED') return { kind: 'message', text: GENERATE_MESSAGE.MODEL_FAILED };
    if (r.status === 'UNAVAILABLE') return { kind: 'message', text: r.message || GENERATE_MESSAGE.UNAVAILABLE };
    return { kind: 'message', text: GENERATE_MESSAGE[r.status] ?? GENERATE_MESSAGE.FAILED };
  }

  const loaded = await planStore().load(args.actor, key);
  if (loaded.status === 'NONE') {
    return { kind: 'message', text: `「${project.title}」の実行計画書はまだありません。「実行計画書を作って」と頼んでから、もう一度指示してください。` };
  }
  if (loaded.status !== 'FOUND') {
    return { kind: 'message', text: '実行計画書を読み込めませんでした。時間をおいて再度お試しください。' };
  }
  const built = changesFor(intent, loaded.record, args.now);
  if ('message' in built) return { kind: 'message', text: built.message };
  return {
    kind: 'proposal',
    proposal: {
      kind: 'stage4.plan',
      pathname: '/okr',
      companyId: args.companyId,
      strategyId: args.strategyId,
      projectId: project.projectId,
      departmentName: project.departmentName,
      projectTitle: project.title,
      expectedVersion: loaded.record.version,
      changes: built.changes,
      edits: built.edits,
    },
  };
}

/** 施策の一覧（番号が付いていて、中止・除外されていないもの） */
export function stage4ProjectRefs(departments: unknown): Stage4ProjectRef[] {
  const out: Stage4ProjectRef[] = [];
  for (const d of (departments as Array<{ name?: unknown; projects?: unknown }> | undefined) ?? []) {
    for (const p of (Array.isArray(d.projects) ? d.projects : []) as Array<Record<string, unknown>>) {
      const projectId = stableIdOf(p);
      const title = String(p.title ?? '').trim();
      if (projectId && title && isProjectActive(p)) out.push({ departmentName: String(d.name ?? ''), projectId, title });
    }
  }
  return out;
}

/** 中止・除外済みの施策の名前（操作の対象から外し、指示に含まれていたら案内する） */
export function stage4ExcludedTitles(departments: unknown): string[] {
  const out: string[] = [];
  for (const d of (departments as Array<{ projects?: unknown }> | undefined) ?? []) {
    for (const p of (Array.isArray(d.projects) ? d.projects : []) as Array<Record<string, unknown>>) {
      const title = String(p.title ?? '').trim();
      if (title && !isProjectActive(p)) out.push(title);
    }
  }
  return out;
}
