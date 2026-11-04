export const CEO_PANEL_WIDTH_STORAGE_KEY = 'growth_ceo_panel_width';
export const CEO_PANEL_WIDTH_DEFAULT = 380;
export const CEO_PANEL_WIDTH_MIN = 320;
export const CEO_PANEL_WIDTH_MAX = 560;

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
