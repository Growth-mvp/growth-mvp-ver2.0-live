/* STAGE1の経営課題（保存済みの stage1Issues）を、相談の根拠として渡す要約。古い issueBlocks の値は読まない。 */
export const STAGE1_ISSUES_MAX = 5;
const DESCRIPTION_MAX = 160;
const SCOPE_LABEL: Record<string, string> = { company: '会社全体', business: '事業' };

type IssueLike = { title?: unknown; description?: unknown; linkedMetrics?: unknown; scope?: unknown };

export function buildStage1IssuesBlock(stage1Issues: unknown): string {
  const named = (Array.isArray(stage1Issues) ? stage1Issues : [])
    .filter((x): x is IssueLike => !!x && typeof x === 'object')
    .filter((x) => typeof x.title === 'string' && x.title.trim() !== '');
  if (named.length === 0) {
    return ['【STAGE1の経営課題（登録済み）】', '- 登録された経営課題はない（0件）。経営課題を推測で挙げず、登録されていないことを伝える。'].join('\n');
  }
  const lines = named.slice(0, STAGE1_ISSUES_MAX).map((issue) => {
    const title = String(issue.title).trim();
    const scope = SCOPE_LABEL[String(issue.scope)] ?? '範囲未登録';
    const desc = typeof issue.description === 'string' ? issue.description.replace(/\s+/g, ' ').trim() : '';
    const shortDesc = desc.length > DESCRIPTION_MAX ? `${desc.slice(0, DESCRIPTION_MAX)}…` : desc;
    const metrics = Array.isArray(issue.linkedMetrics) ? issue.linkedMetrics.map(String).filter(Boolean) : [];
    return `- ${title}（${scope}）：${shortDesc || '説明未登録'}${metrics.length ? `｜関連する指標：${metrics.join('、')}` : ''}`;
  });
  const more = named.length > STAGE1_ISSUES_MAX ? `\n- ほか${named.length - STAGE1_ISSUES_MAX}件（省略。全件を確認したとは言わない）` : '';
  return ['【STAGE1の経営課題（登録済み）】', '登録されている課題だけを使う。登録にない課題を推測で追加しない。', ...lines].join('\n') + more;
}
