/* 検証用のハーネスの CSS 設定（評価専用）。アプリの設定を読み、ハーネスのファイルも走査対象に加える。アプリの設定は変えない。 */
const base = require('../../../tailwind.config.js');

module.exports = {
  ...base,
  content: [...base.content, './eval/integration/browser/**/*.{ts,tsx}'],
};
