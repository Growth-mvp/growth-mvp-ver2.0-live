import { PLAN_OPERATION_GUIDE, planStatusOf } from './planStatus';

describe('planStatusOf（今の状態と次の操作）', () => {
  it('計画書がなければ、AIで作ることを案内する', () => {
    expect(planStatusOf({ hasDraft: false, dirty: false, adopted: false, started: false }).next).toContain('AIで実行計画書を作る');
  });

  it('未保存の修正があれば、保存を先に案内する（採用や開始より前）', () => {
    const s = planStatusOf({ hasDraft: true, dirty: true, adopted: false, started: false });
    expect(s.title).toBe('未保存の修正があります');
    expect(s.next).toContain('草案として保存');
  });

  it('保存された草案は、採用・実行開始がまだだと明示する', () => {
    const s = planStatusOf({ hasDraft: true, dirty: false, adopted: false, started: false });
    expect(s.title).toBe('草案（未採用）');
    expect(s.detail).toContain('採用や実行開始はまだ行われていません');
    expect(s.next).toContain('この計画書を採用');
  });

  it('採用済みは、実行開始の確認へ進むよう案内する（開始とは別と分かる）', () => {
    const s = planStatusOf({ hasDraft: true, dirty: false, adopted: true, started: false });
    expect(s.title).toBe('採用済み（実行は未開始）');
    expect(s.next).toContain('この計画で実行を開始する');
  });

  it('実行開始済みは、STAGE5での確認を案内する', () => {
    const s = planStatusOf({ hasDraft: true, dirty: false, adopted: true, started: true });
    expect(s.title).toBe('実行開始済み');
    expect(s.next).toContain('STAGE5');
  });
});

describe('PLAN_OPERATION_GUIDE（三つの操作の意味）', () => {
  it('草案として保存・この計画書を採用・実行開始を、それぞれ別の意味で示す', () => {
    expect(PLAN_OPERATION_GUIDE.map((g) => g.name)).toEqual(['草案として保存', 'この計画書を採用', '実行開始']);
    expect(PLAN_OPERATION_GUIDE[0].meaning).toContain('採用や実行開始にはなりません');
    expect(PLAN_OPERATION_GUIDE[2].meaning).toContain('STAGE5');
  });
});
