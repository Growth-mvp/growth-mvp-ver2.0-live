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
    expect(prompt).toContain('自分の見解を明確に述べる');
    expect(prompt).toContain('見出しを使わず短い会話文で答える');
    expect(prompt).toContain('原則250〜450文字程度の自然な会話にする');
    expect(prompt).toContain('分析・施策・実行計画を一度に網羅しない');
    expect(prompt).toContain('問いかけは、本質的な論点が残る場合に1つだけ返す。毎回は返さない');
    expect(prompt).toContain('詳細分析、数値比較、計画策定を明示的に求められた場合は、従来どおり十分に詳しく回答する');
    expect(prompt).toContain('登録情報（STAGE1〜6）のうち質問に関係するもの');
    expect(prompt).not.toContain('最後に1行サマリ');
  });

  it('ファシリテーター指示は番号付きの定型見出しを使わない', () => {
    const block = buildFacilitatorBlock({ stage: 'generic' });

    expect(block).not.toMatch(/^\s*\d\)/m);
    expect(block).toContain('深掘りの問い');
  });
});
