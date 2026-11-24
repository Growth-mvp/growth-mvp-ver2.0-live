/* 相談文を文ごとに分け、AIが選んだ文番号から原文を取り出す共通の処理。
 * AIは文を書き換えず、番号で選ぶだけにする（STAGE5・STAGE2 の入力支援で共通）。 */

/** 相談文を文ごとに分ける（文の中身は変えない） */
export function splitSentences(text: string): string[] {
  const matches = text.match(/[^。！？!?\n]+[。！？!?]*/g) ?? [];
  return matches.map((s) => s.trim()).filter((s) => s.length > 0);
}

/** 文番号（重複・範囲外は除く）を、相談文の順で、上限まで原文として取り出す */
export function pickSentences(sentences: string[], indexes: number[], max: number): string[] {
  return [...new Set(indexes)]
    .filter((i) => i < sentences.length)
    .sort((a, b) => a - b)
    .slice(0, max)
    .map((i) => sentences[i]);
}

/** AIへ渡す材料として、文に番号を付ける */
export function numberSentences(sentences: string[]): string {
  return sentences.map((s, i) => `[${i}] ${s}`).join('\n');
}
