/**
 * _lib/deptAnswers.ts
 * 6問回答関連の関数
 */

/**
 * ★ STAGE3: 部門の6問回答を取り出す（保存先の優先探索）
 * - answers6 → answers12 → answers2 → answerSteps → questionAnswers の順で探索
 * - 見つかったら配列を返す；なければ []
 */
export function pickDeptAnswers6(dept: any): any[] {
  const cands =
    (dept as any)?.answers6 ??
    (dept as any)?.answers12 ??
    (dept as any)?.answers2 ??
    (dept as any)?.answerSteps ??
    (dept as any)?.questionAnswers ??
    null;
  return Array.isArray(cands) ? cands : [];
}

/**
 * ★ STAGE3: 部門の6問回答を整形（prompt注入用）
 * - stepNumber でソート、最大6件まで取得
 * - 空や不正な要素は .filter で除外
 */
export function formatDept6Answers(answers: any[]): string {
  if (!Array.isArray(answers) || answers.length === 0) return '(なし)';
  const rows = answers
    .filter((a) => a && typeof a === 'object')
    .slice()
    .sort((a, b) => Number(a?.stepNumber || 0) - Number(b?.stepNumber || 0))
    .slice(0, 6)
    .map((a) => {
      const n = a?.stepNumber ?? '?';
      const label = (a?.label ?? '').toString().trim();
      const ans = (a?.answer ?? '').toString().trim();
      return `- Step${n}${label ? `（${label}）` : ''}: ${ans || '(未回答)'}`;
    });
  return rows.length ? rows.join('\n') : '(なし)';
}

/**
 * ★ STAGE3: Step 1-6 がすべて揃っているか判定
 */
export function hasAnsweredSteps6(answers: any[]): boolean {
  if (!Array.isArray(answers)) return false;
  const steps = new Set(
    answers
      .map((a) => Number(a?.stepNumber))
      .filter((n) => Number.isFinite(n) && n >= 1 && n <= 6),
  );
  return steps.size >= 6;
}

/**
 * ★ STAGE3: TASK 2 - 6問回答のキーワードが生成結果に反映されているかをスコアリング
 * @param deptAnswers6 - 部門の6問回答配列
 * @param generatedText - 生成されたテキスト（mission + projects + okrs）
 * @returns {topTokens, coveragePct, hitTokens}
 */
export function scoreDept6Impact(deptAnswers6: any[], generatedText: string): {
  topTokens: string[];
  coveragePct: number;
  hitTokens: string[];
} {
  if (!Array.isArray(deptAnswers6) || deptAnswers6.length === 0 || !generatedText) {
    return { topTokens: [], coveragePct: 0, hitTokens: [] };
  }

  // 6問回答からテキスト抽出
  const answersText = deptAnswers6
    .map((a) => String(a?.answer || ''))
    .join(' ');

  // 簡易トークン抽出（カタカナ、漢字2文字以上、英数字）
  const tokenPattern = /[ァ-ヴー]{2,}|[一-龯々]{2,10}|[A-Za-z0-9]{2,}/g;
  const tokens = (answersText.match(tokenPattern) || [])
    .filter((t) => t.length >= 2 && t.length <= 15)
    .map((t) => t.trim())
    .filter((t) => t.length > 0);

  // 頻度カウント
  const freq = new Map<string, number>();
  for (const token of tokens) {
    freq.set(token, (freq.get(token) || 0) + 1);
  }

  // 上位10個を取得
  const topTokens = Array.from(freq.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([token]) => token);

  // 生成結果に含まれるトークン
  const hitTokens = topTokens.filter((token) => generatedText.includes(token));

  // カバレッジ率
  const coveragePct = topTokens.length > 0 ? Math.round((hitTokens.length / topTokens.length) * 100) : 0;

  return { topTokens, coveragePct, hitTokens };
}
