import { findScreenById } from '@/lib/screens/screenRegistry';

export type VoiceDepartment = {
  name: string;
  projects?: ReadonlyArray<{ title?: string }>;
};

export type VoiceNavigation =
  | { kind: 'navigate'; href: string; screenLabel: string; departmentName?: string; projectTitle?: string }
  | { kind: 'clarify'; message: string };

type VoiceScreenId = 'stage1' | 'stage2' | 'stage3' | 'stage4';

const OPEN_VERB = /(開いて|開く|開け|開きたい|見せて|見たい|表示して|表示したい|移動して|行きたい|分析したい|入力したい|考えたい)/;
const NON_NAVIGATION_CUE = /(作って|作成|生成|追加|変更|反映|保存|削除|登録|にして|書いて|まとめて|教えて|何|どう|ですか|[?？])/;
const GENERIC_SCREEN_WORD = /(画面|ページ)/;
const OUT_OF_SCOPE_STAGE = /STAGE\s*[56]|ステージ\s*[56]/i;
const PLAN_WORD = /(実行計画|OKR|KPI)/i;

const SCREEN_PATTERNS: ReadonlyArray<{ screenId: VoiceScreenId; pattern: RegExp }> = [
  { screenId: 'stage1', pattern: /STAGE\s*1|ステージ\s*1|会社の現状|企業価値|企業情報|論点/i },
  { screenId: 'stage2', pattern: /STAGE\s*2|ステージ\s*2|全社戦略|経営者の思い|MVV|SWOT|12の問い/i },
  { screenId: 'stage3', pattern: /STAGE\s*3|ステージ\s*3|部門戦略|6つの問い|戦略書/i },
  { screenId: 'stage4', pattern: /STAGE\s*4|ステージ\s*4|実行計画/i },
];

const SCREEN_OPTIONS_TEXT = 'STAGE1（会社の現状）、STAGE2（全社戦略）、STAGE3（部門戦略）、STAGE4（実行計画）';

function squash(text: string): string {
  return text.replace(/[\s　]+/g, '').toLowerCase();
}

function mentions(text: string, name: string): boolean {
  const key = squash(name);
  return key.length >= 2 && squash(text).includes(key);
}

function pathnameOf(screenId: VoiceScreenId): string {
  return findScreenById(screenId)?.pathname ?? '/';
}

function buildHref(screenId: VoiceScreenId, params: Record<string, string>): string {
  const base = pathnameOf(screenId);
  const entries = Object.entries(params).filter(([, v]) => v.length > 0);
  if (entries.length === 0) return base;
  return `${base}?${entries.map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&')}`;
}

/**
 * 音声・文字の指示が「既存の画面を開く」だけの依頼かを判定する。
 * 該当しない場合は null を返し、通常のAI相談として扱う（保存・生成・編集の指示は対象外）。
 */
export function resolveVoiceNavigation(text: string, departments: readonly VoiceDepartment[] = []): VoiceNavigation | null {
  const trimmed = text.trim();
  if (!trimmed || !OPEN_VERB.test(trimmed) || NON_NAVIGATION_CUE.test(trimmed) || OUT_OF_SCOPE_STAGE.test(trimmed)) {
    return null;
  }

  const explicit = SCREEN_PATTERNS.filter((s) => s.pattern.test(trimmed)).map((s) => s.screenId);
  if (explicit.length > 1) {
    return { kind: 'clarify', message: `どの画面を開くか確認させてください。${SCREEN_OPTIONS_TEXT}のどれでしょうか。` };
  }

  const deptMatches = departments.filter((d) => mentions(trimmed, d.name));
  const projectMatches: Array<{ departmentName: string; projectTitle: string }> = [];
  const deptScope = deptMatches.length > 0 ? deptMatches : departments;
  for (const dept of deptScope) {
    for (const project of dept.projects ?? []) {
      const title = String(project.title ?? '').trim();
      if (title && mentions(trimmed, title)) projectMatches.push({ departmentName: dept.name, projectTitle: title });
    }
  }
  const uniqueProjects = [...new Map(projectMatches.map((p) => [`${p.departmentName}::${p.projectTitle}`, p])).values()];
  if (uniqueProjects.length > 1) {
    const names = uniqueProjects.map((p) => `${p.departmentName}「${p.projectTitle}」`).join('、');
    return { kind: 'clarify', message: `対象が複数あります。どちらを開くか指定してください：${names}` };
  }
  if (uniqueProjects.length === 0 && deptMatches.length > 1) {
    const names = deptMatches.map((d) => `「${d.name}」`).join('、');
    return { kind: 'clarify', message: `対象の部門が複数あります。どちらを開くか指定してください：${names}` };
  }

  const target = uniqueProjects[0] ?? (deptMatches.length === 1 ? { departmentName: deptMatches[0].name, projectTitle: '' } : null);

  let screenId: VoiceScreenId | null = explicit[0] ?? null;
  if (!screenId && target) {
    screenId = PLAN_WORD.test(trimmed) ? 'stage4' : 'stage3';
  }

  if (!screenId) {
    if (GENERIC_SCREEN_WORD.test(trimmed)) {
      return { kind: 'clarify', message: `開きたい画面を教えてください。${SCREEN_OPTIONS_TEXT}のどれでしょうか。` };
    }
    return null;
  }

  const isDepartmentScreen = screenId === 'stage3' || screenId === 'stage4';
  const departmentName = isDepartmentScreen ? target?.departmentName : undefined;
  const projectTitle = isDepartmentScreen && target?.projectTitle ? target.projectTitle : undefined;

  return {
    kind: 'navigate',
    href: buildHref(screenId, {
      ...(departmentName ? { dept: departmentName } : {}),
      ...(projectTitle ? { project: projectTitle } : {}),
    }),
    screenLabel: findScreenById(screenId)?.label ?? '',
    ...(departmentName ? { departmentName } : {}),
    ...(projectTitle ? { projectTitle } : {}),
  };
}
