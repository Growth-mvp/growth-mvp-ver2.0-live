import { z } from 'zod';
import { normalizePathname } from '@/lib/screens/screenContext';
import { findScreenByPathname } from '@/lib/screens/screenRegistry';

const clip = (limit: number) => (s: string) => (s.length > limit ? s.slice(0, limit) : s);

/**
 * 相談の文脈（CEOチャットに渡す、いま見ている画面の入力内容）。
 * 入力中の内容は相談のための材料で、正式データではない。saved で保存済みと編集中を区別する。
 * サーバーは長さを切り詰めて受け取る。戦略内に実在する部門・計画だけを使う（照合は consultBlockFor）。
 */
export const ConsultFocusSchema = z.object({
  pathname: z.string().min(1).max(200),
  stage: z.number().int().min(1).max(6).optional(),
  section: z.string().trim().min(1).max(80).transform(clip(80)).optional(),
  departmentName: z.string().trim().min(1).max(200).transform(clip(200)).optional(),
  projectId: z.string().min(1).max(200).optional(),
  projectTitle: z.string().trim().min(1).max(300).transform(clip(300)).optional(),
  question: z
    .object({
      id: z.string().max(64).optional(),
      title: z.string().trim().min(1).max(300).transform(clip(300)),
      text: z.string().max(600).transform(clip(600)).optional(),
      intent: z.string().max(600).transform(clip(600)).optional(),
    })
    .optional(),
  draft: z
    .object({
      text: z.string().max(4000).transform(clip(1200)),
      saved: z.boolean(),
    })
    .optional(),
  items: z
    .array(
      z.object({
        label: z.string().trim().min(1).max(80).transform(clip(80)),
        value: z.string().max(1000).transform(clip(600)),
        saved: z.boolean(),
      }),
    )
    .max(12)
    .optional(),
});

export type ConsultFocus = z.infer<typeof ConsultFocusSchema>;

/** 画面の入力状況を保持する値（クライアント側の保存単位。戦略IDで照合する） */
export type ConsultFocusEntry = ConsultFocus & { strategyId: string | null };

/** 戦略に実在する部門名・計画IDの一覧（相談文脈の照合に使う） */
export type ConsultRefs = { departmentNames: ReadonlySet<string>; projectIds: ReadonlySet<string> };

const MAX_ITEMS = 12;

/**
 * 同じ画面に複数の登録（例: 部門の戦略書と6問）がある場合の統合。
 * 単一の値（質問・編集中の文章・部門・計画）は最初の登録を使い、項目は未保存を先頭にして上限まで残す。
 */
function mergeEntries(list: ConsultFocusEntry[]): ConsultFocus {
  const first = <K extends keyof ConsultFocus>(key: K) => list.find((e) => e[key] !== undefined)?.[key];
  const sections = [...new Set(list.map((e) => e.section).filter((s): s is string => !!s))];
  const items = list
    .flatMap((e) => e.items ?? [])
    .sort((a, b) => Number(a.saved) - Number(b.saved))
    .slice(0, MAX_ITEMS);
  return {
    pathname: list[0].pathname,
    stage: first('stage'),
    section: sections.length > 0 ? clip(80)(sections.join(' / ')) : undefined,
    departmentName: first('departmentName'),
    projectId: first('projectId'),
    projectTitle: first('projectTitle'),
    question: first('question'),
    draft: first('draft'),
    items: items.length > 0 ? items : undefined,
  };
}

/** 相談の送信時に、現在の画面・戦略に一致する文脈だけを取り出す。組織変革ルームは対象にしない。 */
export function consultPayloadFor(
  entries: Record<string, ConsultFocusEntry>,
  pathname: string,
  strategyId: string | null,
): ConsultFocus | undefined {
  const normalized = normalizePathname(pathname);
  if (!normalized || findScreenByPathname(normalized)?.area === 'org') return undefined;
  const hits = Object.values(entries).filter((e) => e.pathname === normalized && e.strategyId === strategyId);
  if (hits.length === 0) return undefined;
  return mergeEntries(hits);
}

export function consultPromptBlock(c: ConsultFocus): string {
  const lines = ['【相談の文脈（相談者がいま見ている画面の入力内容）】'];
  if (c.stage) lines.push(`段階：STAGE${c.stage}`);
  if (c.section) lines.push(`表示中の内容：${c.section}`);
  if (c.departmentName) lines.push(`対象の部門：${c.departmentName}`);
  if (c.projectTitle) lines.push(`対象の計画：${c.projectTitle}`);
  if (c.question) {
    lines.push(`質問：${c.question.title}`);
    if (c.question.text) lines.push(`質問の問い：${c.question.text}`);
    if (c.question.intent) lines.push(`質問の意図：${c.question.intent}`);
  }
  const draft = c.draft?.text.trim();
  if (c.draft && draft) {
    lines.push(`入力中の回答（${c.draft.saved ? '保存済み' : '未保存'}）：`);
    lines.push(`<入力中の回答>\n${draft}\n</入力中の回答>`);
  }
  if (c.items && c.items.length > 0) {
    lines.push('画面の項目（保存状態つき）：');
    for (const item of c.items) {
      const value = item.value.trim() || '（未入力）';
      lines.push(`・${item.label}（${item.saved ? '保存済み' : '未保存'}）：${value}`);
    }
  }
  lines.push(
    '※画面の入力内容は相談のための材料です。正式な戦略データではありません。相談の結果として正式データが変わるとは前提にせず、未保存の内容は保存されていないものとして扱ってください。',
  );
  return lines.join('\n');
}

/**
 * サーバー側の照合。画面が一致し、組織変革ルーム以外で、部門名・計画IDが戦略に実在する場合だけ使う。
 * 合わない部門名・計画IDは落とし、文脈の残りは使う。
 */
export function consultBlockFor(raw: unknown, screen: { pathname: string; area: string } | null, refs: ConsultRefs): string {
  if (!screen || screen.area === 'org') return '';
  const parsed = ConsultFocusSchema.safeParse(raw);
  if (!parsed.success) return '';
  if (normalizePathname(parsed.data.pathname) !== normalizePathname(screen.pathname)) return '';
  const data = { ...parsed.data };
  if (data.departmentName && !refs.departmentNames.has(data.departmentName)) delete data.departmentName;
  if (data.projectId && !refs.projectIds.has(data.projectId)) {
    delete data.projectId;
    delete data.projectTitle;
  }
  return consultPromptBlock(data);
}
