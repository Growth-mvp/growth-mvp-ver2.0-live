import { z } from 'zod';
import { normalizePathname } from '@/lib/screens/screenContext';
import { findScreenByPathname } from '@/lib/screens/screenRegistry';

const clip = (limit: number) => (s: string) => (s.length > limit ? s.slice(0, limit) : s);

/**
 * 相談の文脈（CEOチャットに渡す、いま見ている画面の入力内容）。
 * 入力中の回答は相談のための材料で、正式データではない。サーバーは長さを切り詰めて受け取る。
 */
export const ConsultFocusSchema = z.object({
  pathname: z.string().min(1).max(200),
  stage: z.number().int().min(1).max(6).optional(),
  departmentName: z.string().trim().min(1).max(200).transform(clip(200)).optional(),
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
});

export type ConsultFocus = z.infer<typeof ConsultFocusSchema>;

/** 画面の入力状況を保持する値（クライアント側の保存単位。戦略IDで照合する） */
export type ConsultFocusEntry = ConsultFocus & { strategyId: string | null };

/** 相談の送信時に、現在の画面・戦略に一致する文脈だけを取り出す。組織変革ルームは対象にしない。 */
export function consultPayloadFor(
  entries: Record<string, ConsultFocusEntry>,
  pathname: string,
  strategyId: string | null,
): ConsultFocus | undefined {
  const normalized = normalizePathname(pathname);
  if (!normalized || findScreenByPathname(normalized)?.area === 'org') return undefined;
  const hit = Object.values(entries).find((e) => e.pathname === normalized && e.strategyId === strategyId);
  if (!hit) return undefined;
  return {
    pathname: hit.pathname,
    stage: hit.stage,
    departmentName: hit.departmentName,
    question: hit.question,
    draft: hit.draft,
  };
}

export function consultPromptBlock(c: ConsultFocus): string {
  const lines = ['【相談の文脈（相談者がいま見ている画面の入力内容）】'];
  if (c.stage) lines.push(`段階：STAGE${c.stage}`);
  if (c.departmentName) lines.push(`対象の部門：${c.departmentName}`);
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
  lines.push(
    '※入力中の回答は相談のための材料です。正式な戦略データではありません。相談の結果として正式データが変わるとは前提にせず、未保存の内容は保存されていないものとして扱ってください。',
  );
  return lines.join('\n');
}

/**
 * サーバー側の照合。画面が一致し、組織変革ルーム以外で、部門名が戦略の部門に実在する場合だけ文脈を使う。
 * 合わない部門名は落とし、文脈の残りは使う。
 */
export function consultBlockFor(
  raw: unknown,
  screen: { pathname: string; area: string } | null,
  departmentNames: ReadonlySet<string>,
): string {
  if (!screen || screen.area === 'org') return '';
  const parsed = ConsultFocusSchema.safeParse(raw);
  if (!parsed.success) return '';
  if (normalizePathname(parsed.data.pathname) !== normalizePathname(screen.pathname)) return '';
  const data = { ...parsed.data };
  if (data.departmentName && !departmentNames.has(data.departmentName)) delete data.departmentName;
  return consultPromptBlock(data);
}
