const addThousandsSeparators = (integerText: string) => integerText.replace(/\B(?=(\d{3})+(?!\d))/g, ',');

/**
 * 金額表記を「3桁区切りの百万円」にそろえる。
 * 数値の大きさや単位は変えず、¥…M・カンマなしの金額・全角％だけを対象にする。
 * 年・件数・比率・▲付きの負数などはそのまま残す。
 */
export function normalizeNumericNotation(text: string): string {
  return text
    .replace(/[¥￥]\s*(-?)(\d{1,3}(?:,\d{3})+|\d+)(\.\d+)?\s*M(?![A-Za-z])/g, (_m, sign: string, int: string, frac = '') =>
      `${sign}${addThousandsSeparators(int.replace(/,/g, ''))}${frac}百万円`,
    )
    .replace(/(?<![\d.,])([-−▲△]?)(\d{4,})(\.\d+)?(\s?)(百万円|億円|円)/g, (_m, sign: string, int: string, frac = '', space: string, unit: string) =>
      `${sign}${addThousandsSeparators(int)}${frac}${space}${unit}`,
    )
    .replace(/(\|\s*)(-?)(\d{7,})(\.\d+)?(\s*)(?=\|)/g, (_m, pipe: string, sign: string, int: string, frac = '', space: string) =>
      `${pipe}${sign}${addThousandsSeparators(int)}${frac}${space}`,
    )
    .replace(/(\d)％/g, '$1%');
}

/** 正規化の後に残っている表記の問題を返す。空配列なら問題なし */
export function findNumericNotationIssues(text: string): string[] {
  const issues: string[] = [];
  for (const m of text.matchAll(/[¥￥]\s*\d[\d,.]*\s*M(?![A-Za-z])/g)) issues.push(`¥・M表記：${m[0]}`);
  for (const m of text.matchAll(/(?<![\d.,])\d{4,}(?:\.\d+)?\s?(?:百万円|億円|円)/g)) issues.push(`カンマなしの金額：${m[0]}`);
  for (const m of text.matchAll(/\d％/g)) issues.push(`全角の％：${m[0]}`);
  return issues;
}
