import type { ConfirmedJudgment, ProjectProposal, ProjectSelection } from './stage3StrategyBook';
import { confirmedJudgmentOf, judgmentItemsOf, mergeConfirmedJudgments, type JudgmentItem } from './stage3ConfirmedJudgments';

const DEPT = 'id:d-sales';
const T1 = '2026-11-20T00:00:00.000Z';
const T2 = '2026-11-25T00:00:00.000Z';

function selection(candidateId: string, decision: ProjectSelection['decision'], title = `案${candidateId}`): ProjectSelection {
  return { departmentKey: DEPT, departmentName: '営業部', candidateId, title, decision };
}

function item(candidateId: string, explicit: JudgmentItem['explicit']): JudgmentItem {
  return { kind: 'project', departmentKey: DEPT, departmentName: '営業部', itemId: candidateId, title: `案${candidateId}`, explicit };
}

function record(candidateId: string, decision: ConfirmedJudgment['decision'], draftVersion = 1, confirmedAt = T1): ConfirmedJudgment {
  return { kind: 'project', departmentKey: DEPT, departmentName: '営業部', itemId: candidateId, title: `案${candidateId}`, decision, draftVersion, confirmedAt };
}

describe('確定時の採否の記録（mergeConfirmedJudgments）', () => {
  it('採用2件・不採用3件で確定すると、5件の判断が残り、未選択は保留になる', () => {
    const items = judgmentItemsOf({
      projectSelections: [
        selection('np-1', 'applied'),
        selection('np-2', 'applied'),
        selection('np-3', 'discarded'),
        selection('np-4', 'discarded'),
        selection('np-5', 'discarded'),
        selection('np-6', 'pending'),
      ],
      projectProposals: [],
    });
    const merged = mergeConfirmedJudgments({ previous: [], items, draftVersion: 1, confirmedAt: T1 });
    const byId = Object.fromEntries(merged.map((e) => [e.itemId, e.decision]));
    expect(byId).toEqual({ 'np-1': 'adopted', 'np-2': 'adopted', 'np-3': 'rejected', 'np-4': 'rejected', 'np-5': 'rejected', 'np-6': 'deferred' });
    expect(merged.every((e) => e.draftVersion === 1 && e.confirmedAt === T1)).toBe(true);
  });

  it('1件だけ採否を変えて再確定しても、変更していない候補の判断は保持される', () => {
    const previous = [record('np-1', 'adopted'), record('np-2', 'adopted'), record('np-3', 'rejected')];
    // 次の作業版：np-1は未変更（確定後に保留へ戻った状態）、np-3だけを採用に変えた
    const items = judgmentItemsOf({
      projectSelections: [selection('np-1', 'deferred'), selection('np-2', 'deferred'), selection('np-3', 'applied')],
      projectProposals: [],
    });
    const merged = mergeConfirmedJudgments({ previous, items, draftVersion: 2, confirmedAt: T2 });
    expect(confirmedJudgmentOf(merged, 'project', DEPT, 'np-1')).toEqual(record('np-1', 'adopted'));
    expect(confirmedJudgmentOf(merged, 'project', DEPT, 'np-2')).toEqual(record('np-2', 'adopted'));
    expect(confirmedJudgmentOf(merged, 'project', DEPT, 'np-3')).toMatchObject({ decision: 'adopted', draftVersion: 2, confirmedAt: T2 });
  });

  it('未判断・保留のままの候補は、以前の判断を deferred で上書きしない', () => {
    const previous = [record('np-1', 'rejected', 1)];
    const merged = mergeConfirmedJudgments({ previous, items: [item('np-1', null)], draftVersion: 3, confirmedAt: T2 });
    expect(merged).toEqual(previous);
  });

  it('別の版で同じIDの候補は、判断をした版の情報を残し、新しい版の判断として書き換えない', () => {
    const previous = [record('np-1', 'adopted', 1)];
    const merged = mergeConfirmedJudgments({ previous, items: [item('np-1', null)], draftVersion: 2, confirmedAt: T2 });
    expect(confirmedJudgmentOf(merged, 'project', DEPT, 'np-1')).toMatchObject({ decision: 'adopted', draftVersion: 1, confirmedAt: T1 });
  });

  it('以前の記録にない候補は、未選択として保留で残す（判断を推測しない）', () => {
    const merged = mergeConfirmedJudgments({ previous: [], items: [item('np-9', null)], draftVersion: 2, confirmedAt: T2 });
    expect(confirmedJudgmentOf(merged, 'project', DEPT, 'np-9')).toMatchObject({ decision: 'deferred', draftVersion: 2 });
  });

  it('今回の作業で明示的に選んだ判断は、以前の記録を書き換える', () => {
    const previous = [record('np-1', 'rejected', 1)];
    const merged = mergeConfirmedJudgments({ previous, items: [item('np-1', 'adopted')], draftVersion: 2, confirmedAt: T2 });
    expect(confirmedJudgmentOf(merged, 'project', DEPT, 'np-1')).toMatchObject({ decision: 'adopted', draftVersion: 2 });
  });

  it('記録にない候補を含む作業版の候補が、確定の記録の外にある判断を消さない', () => {
    const previous = [record('np-old', 'adopted')];
    const merged = mergeConfirmedJudgments({ previous, items: [item('np-1', 'rejected')], draftVersion: 2, confirmedAt: T2 });
    expect(confirmedJudgmentOf(merged, 'project', DEPT, 'np-old')).toEqual(record('np-old', 'adopted'));
    expect(confirmedJudgmentOf(merged, 'project', DEPT, 'np-1')).toMatchObject({ decision: 'rejected' });
  });

  it('旧形式の確定済みデータ（不採用が保留に戻っている）から、不採用を推測して復元しない', () => {
    const legacyWorkingCopy = [selection('np-1', 'deferred'), selection('np-2', 'deferred')];
    const merged = mergeConfirmedJudgments({
      previous: [],
      items: judgmentItemsOf({ projectSelections: legacyWorkingCopy, projectProposals: [] }),
      draftVersion: 1,
      confirmedAt: T2,
    });
    expect(merged.map((e) => e.decision)).toEqual(['deferred', 'deferred']);
  });

  it('計画・KPIの変更候補の判断は、新規候補と混ざらず別の種類として残す', () => {
    const proposal: ProjectProposal = {
      departmentKey: DEPT,
      departmentName: '営業部',
      projectId: 'np-1',
      projectTitle: '既存顧客の再受注施策',
      reason: '理由',
      base: { title: 'a', reason: null, hypothesis: null, description: null, kpis: [] },
      proposed: { title: 'a', reason: 'b', hypothesis: null, description: null, kpis: [] },
      decision: 'rejected',
    };
    const items = judgmentItemsOf({ projectSelections: [selection('np-1', 'applied')], projectProposals: [proposal] });
    const merged = mergeConfirmedJudgments({ previous: [], items, draftVersion: 1, confirmedAt: T1 });
    expect(merged.map((e) => `${e.kind}:${e.decision}`).sort()).toEqual(['project:adopted', 'proposal:rejected']);
  });

  it('計画・KPIの変更案は、版が変わったら前の版の判断を引き継がず、未判断として保留にする', () => {
    const proposal = (decision: ProjectProposal['decision']): ProjectProposal => ({
      departmentKey: DEPT,
      departmentName: '営業部',
      projectId: 'p-1',
      projectTitle: '既存顧客の再受注施策',
      reason: '理由',
      base: { title: 'a', reason: null, hypothesis: null, description: null, kpis: [] },
      proposed: { title: 'a', reason: 'b', hypothesis: null, description: null, kpis: [] },
      decision,
    });
    const previous = [{ ...record('p-1', 'adopted', 1), kind: 'proposal' as const }];
    const next = mergeConfirmedJudgments({
      previous,
      items: judgmentItemsOf({ projectSelections: [], projectProposals: [proposal('pending')] }),
      draftVersion: 2,
      confirmedAt: T2,
    });
    expect(next.find((e) => e.kind === 'proposal' && e.itemId === 'p-1')).toMatchObject({ decision: 'deferred', draftVersion: 2 });

    const sameVersion = mergeConfirmedJudgments({
      previous,
      items: judgmentItemsOf({ projectSelections: [], projectProposals: [proposal('pending')] }),
      draftVersion: 1,
      confirmedAt: T2,
    });
    expect(sameVersion.find((e) => e.kind === 'proposal' && e.itemId === 'p-1')).toMatchObject({ decision: 'adopted', draftVersion: 1 });
  });
});
