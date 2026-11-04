import {
  CEO_PANEL_WIDTH_DEFAULT,
  CEO_PANEL_WIDTH_MAX,
  CEO_PANEL_WIDTH_MIN,
  clampCeoPanelWidth,
  maxCeoPanelWidth,
  parseStoredCeoPanelWidth,
} from './ceoPanelWidth';

describe('ceoPanelWidth', () => {
  it('既定幅は 360〜400px の範囲にある', () => {
    expect(CEO_PANEL_WIDTH_DEFAULT).toBeGreaterThanOrEqual(360);
    expect(CEO_PANEL_WIDTH_DEFAULT).toBeLessThanOrEqual(400);
  });

  it('最小幅・最大幅の範囲に収める', () => {
    expect(clampCeoPanelWidth(10, 1920)).toBe(CEO_PANEL_WIDTH_MIN);
    expect(clampCeoPanelWidth(5000, 1920)).toBe(CEO_PANEL_WIDTH_MAX);
    expect(clampCeoPanelWidth(420.4, 1920)).toBe(420);
  });

  it('狭い画面では画面幅の半分まで（最小幅は下回らない）に収める', () => {
    expect(maxCeoPanelWidth(1024)).toBe(512);
    expect(maxCeoPanelWidth(768)).toBe(384);
    expect(maxCeoPanelWidth(600)).toBe(CEO_PANEL_WIDTH_MIN);
    expect(clampCeoPanelWidth(500, 768)).toBe(384);
  });

  it('保存値が無い・空・不正な場合は既定幅を使う', () => {
    expect(parseStoredCeoPanelWidth(null, 1920)).toBe(CEO_PANEL_WIDTH_DEFAULT);
    expect(parseStoredCeoPanelWidth('', 1920)).toBe(CEO_PANEL_WIDTH_DEFAULT);
    expect(parseStoredCeoPanelWidth('abc', 1920)).toBe(CEO_PANEL_WIDTH_DEFAULT);
  });

  it('保存された幅を復元し、範囲外の値は補正する', () => {
    expect(parseStoredCeoPanelWidth('450', 1920)).toBe(450);
    expect(parseStoredCeoPanelWidth('100', 1920)).toBe(CEO_PANEL_WIDTH_MIN);
    expect(parseStoredCeoPanelWidth('9999', 1920)).toBe(CEO_PANEL_WIDTH_MAX);
  });
});
