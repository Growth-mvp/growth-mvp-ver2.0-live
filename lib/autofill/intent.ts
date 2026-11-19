/* 依頼文が「公開資料から入力してほしい」という意図かどうかを判定する（AIは使わない）。
 * 動作（取得・反映）は依頼の意図だけで決めず、会社名または証券コードが読み取れる時に限る。 */
import { parseIdentifyQuery } from './edinetIdentify';

const ACTION = /(入力|取り込|取得|反映|自動|登録)/;
const TARGET = /(基本情報|財務|有価証券報告書|有報|会社情報|企業情報|決算|PL|BS)/;

export function isAutofillRequest(text: string): boolean {
  return ACTION.test(text) && TARGET.test(text) && parseIdentifyQuery(text) !== null;
}
