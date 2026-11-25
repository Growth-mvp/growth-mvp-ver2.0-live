/* 依頼文が「公開資料から入力してほしい」という意図かどうかを判定する（AIは使わない）。
 * 動作（取得・反映）は依頼の意図だけで決めず、会社名または証券コードが読み取れる時に限る。 */
import { parseIdentifyQuery } from './edinetIdentify';

const ACTION = /(入力|取り込|取得|反映|自動|登録)/;
const TARGET = /(基本情報|財務|有価証券報告書|有報|会社情報|企業情報|決算|PL|BS)/;

/* 質問（「〜ですか」「〜ていますか」など）は、取得の依頼ではなく相談として扱う */
const QUESTION_FORM = /[?？]|ですか|ますか|でしょうか|ていますか|されていますか/;

const ATTACHMENT = /(添付|資料|ファイル|PDF|Excel|エクセル|CSV)/i;
const SECURITIES_CODE = /(?<!\d)\d{4}(?!\d)/;

/** 添付した資料からの入力の依頼。証券コード（4桁）が無い時に限る（上場企業の依頼は証券コードから公開資料を取る） */
export function isAttachmentRequest(text: string): boolean {
  return ACTION.test(text) && ATTACHMENT.test(text) && !QUESTION_FORM.test(text) && !SECURITIES_CODE.test(text.normalize('NFKC'));
}

export function isAutofillRequest(text: string): boolean {
  return ACTION.test(text) && TARGET.test(text) && !QUESTION_FORM.test(text) && !isAttachmentRequest(text) && parseIdentifyQuery(text) !== null;
}

const PUBLIC_ACTION = /(調べ|検索|調査)/;
const PUBLIC_TARGET = /(会社情報|企業情報|会社概要|企業概要|基本情報)/;
const SELF_REFERENCE = /^(当社|自社|弊社|御社|我が社|わが社|うち)/;

/** 「〇〇株式会社の会社情報を調べて」の会社名を返す。自社を指す語や会社名が読めない時は null（AIは使わない） */
export function publicProfileQuery(text: string): string | null {
  if (!PUBLIC_ACTION.test(text) || !PUBLIC_TARGET.test(text)) return null;
  const m = /^\s*(.+?)\s*(?:の|について|に関する|を)?\s*(?:会社情報|企業情報|会社概要|企業概要|基本情報)/.exec(text);
  const name = (m?.[1] ?? '').replace(/[「」『』"'“”]/g, '').trim();
  if (name.length < 2 || name.length > 100 || SELF_REFERENCE.test(name)) return null;
  return name;
}
