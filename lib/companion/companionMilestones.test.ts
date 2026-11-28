import { detectMilestone, fingerprint } from './companionMilestones';
import { buildMilestonePrompt, buildMilestoneGuard, isMilestone, ADVICE_FOCUS } from './companionAdvice';
import type { CompanionSnapshot } from './companionEngine';

const BASE: CompanionSnapshot = {
  ready: true,
  companyId: 'co-a',
  strategyId: 'st-a',
  role: 'admin',
  currentPath: '/stage1',
  dirty: false,
  companyNameEntered: true,
  financeEntered: true,
  issueCount: 0,
  stage2Started: false,
  stage2Generated: false,
  stage2Confirmed: false,
  departmentCount: 0,
  projectCount: 0,
  stage4Started: false,
};

const FP = { issues: 'i1', finalStory: 'f1', bridge: 'b1' };

describe('経営支援の節目（保存済みの内容から検出する）', () => {
  it('論点が保存されたら、分析完了の節目になる', () => {
    expect(detectMilestone({ ...BASE, issueCount: 2 }, FP)).toEqual({
      milestone: 'ANALYSIS',
      key: 'MILESTONE:ANALYSIS:co-a:st-a:i1',
    });
  });

  it('経営戦略が生成されたら、戦略生成の節目になる（分析より新しい節目を優先）', () => {
    const m = detectMilestone({ ...BASE, issueCount: 2, stage2Generated: true, stage2Started: true }, FP);
    expect(m?.milestone).toBe('GENERATE');
  });

  it('戦略が確定したら、確定の節目になる（最も新しい節目）', () => {
    const m = detectMilestone({ ...BASE, issueCount: 2, stage2Generated: true, stage2Confirmed: true }, FP);
    expect(m?.milestone).toBe('CONFIRM');
    expect(m?.key).toBe('MILESTONE:CONFIRM:co-a:st-a:b1');
  });

  it('未保存の変更がある間は、節目にしない（保存済みの内容だけで助言する）', () => {
    expect(detectMilestone({ ...BASE, issueCount: 2, dirty: true }, FP)).toBeNull();
  });

  it('保存データを読めていない間は、節目にしない', () => {
    expect(detectMilestone({ ...BASE, ready: false, issueCount: 2 }, FP)).toBeNull();
  });

  it('論点がまだ無ければ、節目はない', () => {
    expect(detectMilestone(BASE, FP)).toBeNull();
  });

  it('内容の指紋は、同じ内容なら同じ値、違えば違う値になる', () => {
    expect(fingerprint([{ title: '論点A' }])).toBe(fingerprint([{ title: '論点A' }]));
    expect(fingerprint([{ title: '論点A' }])).not.toBe(fingerprint([{ title: '論点B' }]));
  });
});

describe('助言の依頼文と規則（誤った助言を防ぐ）', () => {
  it('依頼文は、経営支援の観点（顧客・整合・すり合わせ・目的と手段・社員の主体性）を含む', () => {
    const text = buildMilestonePrompt('GENERATE');
    for (const f of ADVICE_FOCUS) expect(text).toContain(f);
    expect(text).toContain('「保存済みの情報では判断できない」と書いてください');
    expect(text).toContain('判断は利用者に委ね');
  });

  it('サーバーの規則は、節目ごとに作られ、操作手順を含めない', () => {
    const g = buildMilestoneGuard('CONFIRM');
    expect(g).toContain('経営戦略が確定されました');
    expect(g).toContain('操作手順の説明は含めない');
    expect(g).toContain('最大3点');
  });

  it('節目の値だけを受け付ける（それ以外は規則を追加しない）', () => {
    expect(isMilestone('ANALYSIS')).toBe(true);
    expect(isMilestone('CONFIRM')).toBe(true);
    expect(isMilestone('OTHER')).toBe(false);
    expect(isMilestone(undefined)).toBe(false);
  });
});
