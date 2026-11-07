import {
  CEO_PANEL_DOCK_MIN_VIEWPORT,
  CEO_PANEL_WIDTH_DEFAULT,
  CEO_PANEL_WIDTH_MAX,
  CEO_PANEL_WIDTH_MIN,
  CENTER_MIN_WIDTH,
  ceoPanelLeftWidth,
  clampCeoPanelWidth,
  displayedCeoPanelWidth,
  maxCeoPanelWidth,
  parseStoredCeoPanelWidth,
} from './ceoPanelWidth';

describe('ceoPanelWidth', () => {
  it('既定幅は標準の320pxで、最小幅と同じ', () => {
    expect(CEO_PANEL_WIDTH_DEFAULT).toBe(320);
    expect(CEO_PANEL_WIDTH_DEFAULT).toBe(CEO_PANEL_WIDTH_MIN);
  });

  it('1280px以上で右ペインを常設表示する', () => {
    expect(CEO_PANEL_DOCK_MIN_VIEWPORT).toBe(1280);
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

  it('左サイドバーの幅は2xl未満で16rem、2xl以上で18rem', () => {
    expect(ceoPanelLeftWidth(1280)).toBe(256);
    expect(ceoPanelLeftWidth(1535)).toBe(256);
    expect(ceoPanelLeftWidth(1536)).toBe(288);
  });

  it('表示幅は中央画面の最低幅を確保する範囲に制限する（保存値は変えない）', () => {
    // 1280px: 1280 − 256 − 640 = 384 が上限。保存値 560 は表示上 384 になる
    expect(displayedCeoPanelWidth(560, 1280)).toBe(1280 - 256 - CENTER_MIN_WIDTH);
    // 1920px: 制限に届かないので保存値のまま
    expect(displayedCeoPanelWidth(560, 1920)).toBe(560);
    // 既定幅・最小幅はそのまま
    expect(displayedCeoPanelWidth(CEO_PANEL_WIDTH_DEFAULT, 1280)).toBe(320);
    expect(displayedCeoPanelWidth(10, 1280)).toBe(CEO_PANEL_WIDTH_MIN);
  });
});
