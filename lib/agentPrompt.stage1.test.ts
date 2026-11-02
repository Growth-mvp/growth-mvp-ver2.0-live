import { buildAgentSystemPrompt } from './agentPrompt';

const NO_DATA = 'データなし（算出に必要な登録データが不足）';

const VA = {
  revenueCagrPct: 10,
  operatingMarginPctLatest: 8,
  roic: 10.648,
  pbr: 1.5,
  meta: { basis: { years: [2024, 2021, 2022, 2023], latestYear: 2024 } },
} as any;

describe('CEO チャットに渡す STAGE1 5指標ブロック', () => {
  it('5指標を、対象年度と単位つきで出す', () => {
    const prompt = buildAgentSystemPrompt({ valueAnalysis: VA, stage1Benchmarks: { waccManual: 8 } } as any);
    expect(prompt).toContain('対象年度: 2021年〜2024年');
    expect(prompt).toContain('① 売上成長率（CAGR・年率）: 10.0%（2021→2024年）');
    expect(prompt).toContain('② 営業利益率（最新年）: 8.0%');
    expect(prompt).toContain('③ ROIC（NOPAT÷投下資本）: 10.6%');
    expect(prompt).toContain('④ WACC（登録値）: 8.0%');
    expect(prompt).toContain('⑤ PBR（手入力値）: 1.50倍');
  });

  it('値がない指標は「データなし」とし、数値を作らない', () => {
    const prompt = buildAgentSystemPrompt({} as any);
    const block = prompt.slice(prompt.indexOf('【STAGE1 企業価値5指標'));
    expect(block.split(NO_DATA).length - 1).toBe(5);
    expect(block).not.toMatch(/\d+(\.\d+)?%/);
  });

  it('WACC は正の登録値だけを採用する（0 や未入力は未設定）', () => {
    const zero = buildAgentSystemPrompt({ valueAnalysis: VA, stage1Benchmarks: { waccManual: 0 } } as any);
    expect(zero).toContain(`④ WACC（登録値）: ${NO_DATA}`);
    const none = buildAgentSystemPrompt({ valueAnalysis: VA } as any);
    expect(none).toContain(`④ WACC（登録値）: ${NO_DATA}`);
  });

  it('赤字の ROIC は参考値の注記を付ける', () => {
    const va = { ...VA, roic: -2, meta: { ...VA.meta, notes: ['推定ROIC：営業利益が赤字のため参考値', 'PBR以外の注記'] } };
    const prompt = buildAgentSystemPrompt({ valueAnalysis: va } as any);
    expect(prompt).toContain('③ ROIC（NOPAT÷投下資本）: -2.0%（注記: 推定ROIC：営業利益が赤字のため参考値）');
  });

  it('5指標は、ROE・D/E など STAGE1 の 5 指標以外を含めない', () => {
    const prompt = buildAgentSystemPrompt({ valueAnalysis: { ...VA, roe: 21, debtEquityRatio: 0.4 } } as any);
    expect(prompt).not.toContain('ROE:');
    expect(prompt).not.toContain('負債資本比率');
  });
});
