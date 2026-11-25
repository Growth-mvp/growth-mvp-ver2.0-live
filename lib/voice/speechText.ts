/* AIの回答を、読み上げに適した文の単位に分ける。記号・表・URLは読まず、文の途中で切らない。 */

const MAX_CHUNK = 110;
const MIN_CHUNK = 12;
const LONG_ANSWER_CHARS = 240;
const LEAD_CHARS = 150;
const MORE_ON_SCREEN = '詳しい内容は画面に表示しています。';

function stripMarkup(markdown: string): string {
  return markdown
    .split('\n')
    .filter((line) => !/^\s*\[debug\]/.test(line))
    .filter((line) => !/^\s*\|?[\s:|-]*-{3,}[\s:|-]*\|?\s*$/.test(line))
    .filter((line) => !(line.includes('|') && (line.match(/\|/g) ?? []).length >= 2))
    .join('\n')
    .replace(/```[\s\S]*?```/g, '。')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/https?:\/\/\S+/g, '')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/^\s*>\s?/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/^\s*\d+[.)]\s+/gm, '')
    .replace(/^\s*\[[ xX]\]\s*/gm, '')
    .replace(/\*\*|__|~~|\*/g, '')
    .replace(/[■□●○▲△▼▽◆◇★☆※▶◀｜]/g, '')
    .replace(/→|⇒/g, '、')
    .replace(/[ \t　]+/g, ' ');
}

function splitSentences(text: string): string[] {
  return text
    .split(/\n+/)
    .flatMap((line) => line.split(/(?<=[。！？!?])/))
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function capLength(sentence: string): string[] {
  if (sentence.length <= MAX_CHUNK) return [sentence];
  const parts: string[] = [];
  let current = '';
  for (const piece of sentence.split(/(?<=[、，,])/)) {
    if (current.length + piece.length > MAX_CHUNK && current) {
      parts.push(current);
      current = '';
    }
    current += piece;
  }
  if (current) parts.push(current);
  return parts.flatMap((p) => (p.length <= MAX_CHUNK ? [p] : p.match(new RegExp(`.{1,${MAX_CHUNK}}`, 'g')) ?? []));
}

/* 長い回答は、冒頭の文（結論）から文単位で読む。途中では切らず、残りは画面に表示していることを伝える */
function leadSentences(units: string[]): string[] {
  const lead: string[] = [];
  let length = 0;
  for (const unit of units) {
    if (lead.length > 0 && length + unit.length > LEAD_CHARS) break;
    lead.push(unit);
    length += unit.length;
  }
  return lead;
}

/** 読み上げの単位（文ごと。短すぎる文は次と合わせ、長い文は読点で区切る） */
export function toSpeakableChunks(markdown: string): string[] {
  const units = splitSentences(stripMarkup(markdown));
  const total = units.reduce((n, unit) => n + unit.length, 0);
  const lead = total > LONG_ANSWER_CHARS ? leadSentences(units) : units;
  const spoken = lead.length < units.length ? [...lead, MORE_ON_SCREEN] : lead;
  const sentences = spoken.flatMap(capLength);
  const merged: string[] = [];
  for (const s of sentences) {
    const last = merged[merged.length - 1];
    if (last !== undefined && (last.length < MIN_CHUNK || s.length < MIN_CHUNK) && last.length + s.length <= MAX_CHUNK) {
      merged[merged.length - 1] = `${last}${s}`;
    } else {
      merged.push(s);
    }
  }
  return merged.filter((s) => /[^\s。、！？!?]/.test(s));
}
