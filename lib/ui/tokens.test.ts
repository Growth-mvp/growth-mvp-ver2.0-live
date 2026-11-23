import { CHART_COLORS } from './tokens';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { colors } = require('../../tailwind.config.js').theme.extend;

describe('CHART_COLORS', () => {
  it('Tailwind のトークンと同じ値を使う', () => {
    expect(CHART_COLORS.current).toBe(colors.zinc[300]);
    expect(CHART_COLORS.baseline).toBe(colors.zinc[400]);
    expect(CHART_COLORS.zeroLine).toBe(colors.zinc[400]);
    expect(CHART_COLORS.grid).toBe(colors.zinc[200]);
    expect(CHART_COLORS.axis).toBe(colors.zinc[600]);
    expect(CHART_COLORS.actual).toBe(colors.zinc[700]);
    expect(CHART_COLORS.companyTarget).toBe(colors.bluegray.DEFAULT);
    expect(CHART_COLORS.projectTarget).toBe(colors.bluegray.light);
    expect(CHART_COLORS.targetPoint).toBe(colors.bluegray.deep);
    expect(CHART_COLORS.negative).toBe(colors.danger.DEFAULT);
  });
});
