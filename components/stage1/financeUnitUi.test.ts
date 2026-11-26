/* 単位選択UIの撤廃を、STAGE1の画面ファイルの記述で確認する（React の描画テスト環境は無いため）。 */
import { readFileSync } from 'fs';
import { join } from 'path';

const read = (name: string) => readFileSync(join(__dirname, name), 'utf8');

describe('STAGE1の財務入力画面は単位を選ばない（円で固定）', () => {
  const editor = read('FinanceYearEditorTable.tsx');
  const approval = read('CompanyAutofillPanel.tsx');
  const panel = read('FinanceDataPanel.tsx');

  it('全社・事業別の入力単位の選択と、単位の状態を持たない', () => {
    expect(editor).not.toContain('finance-input-unit');
    expect(editor).not.toContain('setFinanceInputUnit');
    expect(editor).not.toMatch(/\bfinanceInputUnit\b/);
    expect(editor).toContain('単位：円');
  });

  it('資料の取込も単位を選ばせず、承認の前に金額が円単位であることの確認を求める', () => {
    expect(approval).not.toContain('FINANCE_INPUT_UNITS');
    expect(approval).not.toContain('setUnitOverrides');
    expect(approval).toContain('金額が円単位で記載されていることを確認しました');
  });

  it('財務画面は中央の取込欄を持たず、AI経営コンサルタントへの添付を案内する', () => {
    expect(panel).not.toContain('DocumentImportPanel');
    expect(panel).not.toContain('ファイルから読込み');
    expect(panel).toContain('決算書や財務資料をAI経営コンサルタントに添付すると、入力を支援します。直接入力することもできます。');
  });

  it('旧データの空欄下書き・単位確認チェック・専用の確定ボタンを持たない', () => {
    expect(editor).not.toContain('SegmentFrozenNotice');
    expect(editor).not.toContain('単位を確認しました');
    expect(editor).not.toContain('円として確定して保存');
  });
});
