import { z } from 'zod';

/* 右側のAI経営コンサルタントとの相談から作る、STAGE5の入力案。
 * 会話全文は含めず、利用者が確認して反映した入力案だけを扱う。 */

const ITEM_MAX = 200;
const LIST_MAX = 5;

const itemList = z
  .array(z.string().trim().min(1).max(ITEM_MAX))
  .max(LIST_MAX);

export const consultDraftSchema = z.object({
  issues: itemList,
  examined: itemList,
  nextActions: itemList,
});

export type ConsultDraft = z.infer<typeof consultDraftSchema>;

export function parseConsultDraft(raw: unknown): ConsultDraft | null {
  const parsed = consultDraftSchema.safeParse(raw);
  if (!parsed.success) return null;
  const d = parsed.data;
  if (d.issues.length + d.examined.length + d.nextActions.length === 0) return null;
  return d;
}

export function formatConsultDraft(d: ConsultDraft): string {
  const section = (title: string, items: string[]) =>
    items.length > 0 ? [`【${title}】`, ...items.map((i) => `・${i}`)].join('\n') : '';
  return [
    section('課題', d.issues),
    section('検討したこと', d.examined),
    section('次の行動（未実施）', d.nextActions),
  ]
    .filter(Boolean)
    .join('\n\n');
}

/** 入力中の文字を消さないよう、空でなければ区切りを入れて末尾に追記する */
export function appendDraftText(current: string, draft: string): string {
  const base = current.replace(/\s+$/, '');
  if (base.trim() === '') return draft;
  return `${base}\n\n${draft}`;
}

export type DraftTarget = {
  companyId: string;
  strategyId: string;
  departmentId: string;
  projectId: string;
};

/** 反映先（選んでいる案件）と、回答を得た相談の対象が同じか */
export function isSameDraftTarget(a: DraftTarget | null | undefined, b: DraftTarget | null | undefined): boolean {
  if (!a || !b) return false;
  return (
    a.companyId === b.companyId &&
    a.strategyId === b.strategyId &&
    a.departmentId === b.departmentId &&
    a.projectId === b.projectId
  );
}
