/* 単位選択UIの撤廃を、STAGE1の画面ファイルの記述で確認する（React の描画テスト環境は無いため）。 */
import { readFileSync } from 'fs';
import { join } from 'path';

const read = (name: string) => readFileSync(join(__dirname, name), 'utf8');

describe('STAGE1の財務入力画面は単位を選ばない（円で固定）', () => {
  const editor = read('FinanceYearEditorTable.tsx');
  const importPanel = read('DocumentImportPanel.tsx');

  it('全社・事業別の入力単位の選択と、単位の状態を持たない', () => {
    expect(editor).not.toContain('finance-input-unit');
    expect(editor).not.toContain('setFinanceInputUnit');
    expect(editor).not.toMatch(/\bfinanceInputUnit\b/);
    expect(editor).toContain('単位：円');
  });

  it('取込でも単位を選ばせず、円以外の表記は取込を止め、表記の無い資料は円の確認を求める', () => {
    expect(importPanel).not.toContain('FINANCE_INPUT_UNITS');
    expect(importPanel).not.toContain('取込元の単位');
    expect(importPanel).not.toContain('setUnitOverrides');
    expect(importPanel).toContain('の金額は円単位です（資料に単位表記がありません）');
  });

  it('旧データの空欄下書き・単位確認チェック・専用の確定ボタンを持たない', () => {
    expect(editor).not.toContain('SegmentFrozenNotice');
    expect(editor).not.toContain('単位を確認しました');
    expect(editor).not.toContain('円として確定して保存');
  });
});
