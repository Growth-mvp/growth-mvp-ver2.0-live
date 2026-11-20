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

  it('経営相談の共通原則は残し、回答の長さ・段落・質問の型は回答スタイル指示に一本化する', () => {
    const prompt = buildAgentSystemPrompt({} as any);

    expect(prompt).toContain('迎合せず');
    expect(prompt).toContain('自分の見解を明確に述べ、');
    expect(prompt).toContain('会社全体が赤字でも、個別の案件が赤字と確認できなければ「赤字案件がある」と断定しない');
    expect(prompt).toContain('網羅的に並べない');
    expect(prompt).not.toContain('最後に1行サマリ');
    for (const duplicated of ['原則2〜4段落', '250〜450', '最大3件まで示す', 'ツールが使えるとき', '問いかけは', '見出しを使わず']) {
      expect(prompt).not.toContain(duplicated);
    }
  });

  it('ファシリテーター指示は番号付きの定型見出しを使わない', () => {
    const block = buildFacilitatorBlock({ stage: 'generic' });

    expect(block).not.toMatch(/^\s*\d\)/m);
    expect(block).toContain('深掘りの問い');
  });
});
