import { baseScenarioRowNote } from './BaseScenarioPanel';

describe('既存事業の増減の入力欄の扱いの説明（空欄・0円・片方だけ）', () => {
  it('両方空欄は横ばい', () => {
    expect(baseScenarioRowNote({ revenue: '', operatingIncome: '' })).toBe('空欄：直近実績の横ばい');
    expect(baseScenarioRowNote(undefined)).toBe('空欄：直近実績の横ばい');
  });

  it('売上だけ入力すると、営業利益は未算定', () => {
    expect(baseScenarioRowNote({ revenue: '50', operatingIncome: '' })).toBe('営業利益は空欄のため未算定');
  });

  it('営業利益だけ入力すると、売上は未算定', () => {
    expect(baseScenarioRowNote({ revenue: '', operatingIncome: '-15' })).toBe('売上は空欄のため未算定');
  });

  it('両方入力は入力どおり反映', () => {
    expect(baseScenarioRowNote({ revenue: '50', operatingIncome: '5' })).toBe('入力どおり反映');
  });

  it('明示的な0は増減なし（空欄とは別の文）', () => {
    expect(baseScenarioRowNote({ revenue: '0', operatingIncome: '0' })).toBe('0円：増減なし');
  });
});
