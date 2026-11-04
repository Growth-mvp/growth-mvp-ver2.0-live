import { buildAgentSystemPrompt } from './agentPrompt';
import { buildHelpSystemPrompt } from './helpPrompt';
import { buildFacilitatorBlock } from './facilitatorProtocol';

describe('会話の表現ルール', () => {
  it('操作質問では定型見出しや番号付けを強制しない', () => {
    const prompt = buildHelpSystemPrompt({ productName: 'GROWTH SHIFT' });

    expect(prompt).toContain('最初に何をすればよいか');
    expect(prompt).not.toContain('必須回答スロット');
    expect(prompt).not.toContain('①結論');
    expect(prompt).not.toContain('③つまずきポイント');
  });

  it('経営相談では結論先出しと迎合しない指摘を求め、固定の1行サマリを求めない', () => {
    const prompt = buildAgentSystemPrompt({} as any);

    expect(prompt).toContain('迎合せず');
    expect(prompt).toContain('まず結論や見解を述べ');
    expect(prompt).not.toContain('最後に1行サマリ');
  });

  it('ファシリテーター指示は番号付きの定型見出しを使わない', () => {
    const block = buildFacilitatorBlock({ stage: 'generic' });

    expect(block).not.toMatch(/^\s*\d\)/m);
    expect(block).toContain('深掘りの問い');
  });
});
