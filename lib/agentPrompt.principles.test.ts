import agentPrompt from './agentPrompt';
import { FICTIONAL_STRATEGY_ROW } from '../eval/quality/fictionalCompany';

const prompt = agentPrompt(FICTIONAL_STRATEGY_ROW as any, [], []);

describe('経営判断の原則（短い判断原則。すべての回答に機械的に入れない）', () => {
  it('5つの原則（企業価値・全体最適・認識のズレ・主体性・実行と成果）を含む', () => {
    expect(prompt).toContain('【経営判断の原則');
    for (const key of ['企業価値：', '全体最適：', '認識のズレ：', '社員の主体性：', '実行と成果：']) {
      expect(prompt).toContain(key);
    }
  });

  it('根拠がない場合に認識のズレを断定しない、資金繰りを組織変革へ結びつけない、判断を代行しない', () => {
    expect(prompt).toContain('根拠がなければ断定しない');
    expect(prompt).toContain('資金繰りや財務の相談は、根拠なく組織変革の話にしない');
    expect(prompt).toContain('経営者の判断は代行せず、選択肢と判断基準を示す');
  });

  it('機械的に盛り込まないことを明記する', () => {
    expect(prompt).toContain('すべての回答に機械的に入れない');
  });

  it('既存の振る舞い規範（事実・仮説・提案のラベル付け）は残る', () => {
    expect(prompt).toContain('【振る舞い規範】');
    expect(prompt).toContain('事実/仮説/提案をラベル付け');
  });
});
