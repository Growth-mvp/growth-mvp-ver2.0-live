/* 実 API 検証専用の Jest 設定。通常の jest（npm test / watch）からは読み込まれない。 */
const base = require('./jest.config.js');

module.exports = {
  ...base,
  testMatch: ['**/*.live.ts'],
};
