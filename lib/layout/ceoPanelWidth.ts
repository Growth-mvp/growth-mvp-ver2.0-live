export const CEO_PANEL_WIDTH_STORAGE_KEY = 'growth_ceo_panel_width';
export const CEO_PANEL_OPEN_STORAGE_KEY = 'growth_ceo_panel_open_v2';
export const CEO_PANEL_WIDTH_DEFAULT = 320;
export const CEO_PANEL_WIDTH_MIN = 320;
export const CEO_PANEL_WIDTH_MAX = 560;
export const CEO_PANEL_DOCK_MIN_VIEWPORT = 1280;
export const CENTER_MIN_WIDTH = 640;

export function ceoPanelLeftWidth(viewportWidth: number): number {
  return viewportWidth >= 1536 ? 288 : 256;
}

export function maxCeoPanelWidth(viewportWidth: number): number {
  return Math.max(CEO_PANEL_WIDTH_MIN, Math.min(CEO_PANEL_WIDTH_MAX, Math.floor(viewportWidth * 0.5)));
}

export function clampCeoPanelWidth(width: number, viewportWidth: number): number {
  return Math.round(Math.min(maxCeoPanelWidth(viewportWidth), Math.max(CEO_PANEL_WIDTH_MIN, width)));
}

export function parseStoredCeoPanelWidth(raw: string | null, viewportWidth: number): number {
  const parsed = raw == null || raw.trim() === '' ? NaN : Number(raw);
  return clampCeoPanelWidth(Number.isFinite(parsed) ? parsed : CEO_PANEL_WIDTH_DEFAULT, viewportWidth);
}

/* 表示幅だけを、中央画面の最低幅に応じて制限する。保存されている幅は変更しない。 */
export function displayedCeoPanelWidth(width: number, viewportWidth: number): number {
  const byCenter = Math.floor(viewportWidth - ceoPanelLeftWidth(viewportWidth) - CENTER_MIN_WIDTH);
  return Math.round(Math.max(CEO_PANEL_WIDTH_MIN, Math.min(clampCeoPanelWidth(width, viewportWidth), byCenter)));
}
