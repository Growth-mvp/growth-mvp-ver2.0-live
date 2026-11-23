/* グラフの系列色。Tailwind のトークン（tailwind.config.js）と同じ値で、テストで一致を確認する */
export const CHART_COLORS = {
  /* 現状・既存事業の見通し・横ばい（グレー） */
  current: '#d1d1d6',
  baseline: '#a1a1aa',
  /* 全社経営目標・施策反映後の見通し・計画（青） */
  companyTarget: '#0071e3',
  /* プロジェクト目標（明るい青） */
  projectTarget: '#0a84ff',
  /* 実績（濃いグレー） */
  actual: '#3a3a3c',
  /* 目標点（濃い青） */
  targetPoint: '#005bb5',
  /* マイナス値（赤は負の数値だけに使う） */
  negative: '#d70015',
  grid: '#e5e5ea',
  axis: '#52525b',
  zeroLine: '#a1a1aa',
} as const;
