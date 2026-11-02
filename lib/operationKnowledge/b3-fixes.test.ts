import { OPERATIONS } from './operations';
import { buildOperationGuidance, detectMentionedScreenIds } from './guidance';
import { getOperation, getOperationsForScreen } from './lookup';

const planOps = OPERATIONS.filter((op) => op.operationId.startsWith('plan.'));
const orgOps = OPERATIONS.filter((op) => op.operationId.startsWith('org.'));

describe('経営計画書の操作案内（B3 残課題）', () => {
  it('ハブの「計画書を生成」は、実装された操作として登録されている（管理者・管理職、生成はこの画面で行わない）', () => {
    const op = getOperation('plan.open-generate-from-hub');
    expect(op?.label).toBe('計画書を生成');
    expect(op?.screenIds).toEqual(['plan-hub']);
    expect(op?.permission.minRole).toBe('manager');
    expect(op?.purpose).toContain('この画面では生成しない');
  });

  it.each([
    ['plan-bank', 'plan.generate-bank', '経営改善・事業計画書'],
    ['plan-shareholder', 'plan.generate-shareholder', '中期経営計画書'],
    ['plan-employee', 'plan.generate-employee', '経営方針・実行計画書'],
  ])('%s の生成操作は、対象に応じた文書の種類を示す（%s）', (screenId, operationId, docTitle) => {
    const op = getOperation(operationId);
    expect(op?.screenIds).toEqual([screenId]);
    expect(op?.label).toBe('AI本文を生成');
    expect(op?.purpose).toContain(docTitle);
    expect(op?.permission.minRole).toBe('manager');
    expect(op?.permission.enforcement).toBe('ui-and-api');
    expect(op?.permission.apiRoute).toBe('app/api/plans/[audience]/generate/route.ts');
  });

  it('銀行向けは、財務数値が STAGE6 の財務計画の保存状態に依存することを条件に明記する', () => {
    const op = getOperation('plan.generate-bank');
    expect(op?.conditions).toContain('STAGE6の財務計画が保存されていない');
    expect(op?.purpose).toContain('財務章');
  });

  it('生成の保存は、再生成で上書きされ履歴は残ることを明記する（履歴の機能を案内しない）', () => {
    for (const op of ['plan.generate-bank', 'plan.generate-shareholder', 'plan.generate-employee']) {
      expect(getOperation(op)?.save.target).toContain('履歴は残らない');
    }
  });

  it('経営計画書の操作に、存在しない編集・履歴の機能を含めない', () => {
    for (const op of planOps) {
      const text = [op.label, op.purpose, ...op.steps, op.conditions].join('\n');
      expect({ id: op.operationId, edit: /編集|修正して保存/.test(text), history: /履歴(を|から)(見|開|表示|選)/.test(text) }).toEqual({
        id: op.operationId,
        edit: false,
        history: false,
      });
    }
  });

  it('「銀行向け」の質問は、銀行向けの操作だけを対象にする（株主向け・社員向けを混ぜない）', () => {
    expect(detectMentionedScreenIds('銀行向けの計画書を作るには？')).toEqual(['plan-bank']);
    expect(detectMentionedScreenIds('株主向けの計画書はどこ？')).toEqual(['plan-shareholder']);
    expect(detectMentionedScreenIds('社員向けの計画書を作りたい')).toEqual(['plan-employee']);
    expect(detectMentionedScreenIds('社員が動かない')).toEqual([]);
  });

  it('「銀行向けの計画書を作るには？」の案内は、銀行向けの生成の説明を含み、株主向けの文書名を含まない', () => {
    const r = buildOperationGuidance({ screenId: 'stage1', query: '銀行向けの計画書を作るには？', role: 'manager' });
    expect(r.text).toContain('経営改善・事業計画書');
    expect(r.text).not.toContain('中期経営計画書');
  });

  it('経営計画書のハブでは、生成の操作（計画書を生成）を案内に含められる', () => {
    const ids = getOperationsForScreen('plan-hub').map((o) => o.operationId);
    expect(ids).toContain('plan.open-generate-from-hub');
  });
});

describe('組織変革ルームの説明（B3 残課題）', () => {
  it('回答原則は、未解決の管理者向け機能を案内しないことと、推測の明記を求める', () => {
    const r = buildOperationGuidance({ screenId: 'org-shared', query: '組織変革ルームの使い方は？', role: 'admin' });
    expect(r.text).toContain('管理者向けの未解決の機能（論点の編集、次の対応の登録、反映候補の作成など）は、利用可能な操作として案内しない');
    expect(r.text).toContain('人事への影響は断定せず、述べる場合は「推測」と明記する');
  });

  it('組織変革の操作の説明に、評価・異動・人事を断定する記述がない', () => {
    for (const op of orgOps) {
      const text = [op.label, op.purpose, ...op.steps, op.conditions, op.save.target].join('\n');
      expect({ id: op.operationId, claim: /評価や異動|異動を決|人事評価を|人事異動を/.test(text) }).toEqual({
        id: op.operationId,
        claim: false,
      });
    }
  });

  it('組織変革ルームの案内は、管理者向けの操作（論点の編集など）を含まない', () => {
    const shared = getOperationsForScreen('org-shared');
    for (const op of shared) {
      expect({ id: op.operationId, minRole: op.permission.minRole }).not.toEqual({ id: op.operationId, minRole: 'admin' });
    }
  });
});
