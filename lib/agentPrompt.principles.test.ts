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

  it('人材育成・組織の原則（目的と手段・主体的な学習・カスケードダウン・組織の協働）を含む', () => {
    for (const key of ['目的と手段：', '主体的な学習：', 'カスケードダウン：', '組織の協働：']) {
      expect(prompt).toContain(key);
    }
    expect(prompt).toContain('人材育成の相談では、人事や管理職が必要スキル・研修を先に設計する発想を起点としない');
    expect(prompt).toContain('部門間連携の相談では、KPI・会議・連携制度の設計を起点としない');
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

  it('見解変更の原則を振る舞い規範に含む（根拠なく結論を変えない、新情報があれば修正する）', () => {
    expect(prompt).toContain('過去の見解を変更する場合は、会話で確認できる範囲で、新しい事実・前提・判断条件のどれが変わったかを説明する');
    expect(prompt).toContain('相手の賛否や希望だけを理由に、根拠なく結論を変更しない');
    expect(prompt).toContain('新情報や正当な判断条件の変更があれば、柔軟に見解を修正する');
  });
});
