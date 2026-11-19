/* eslint-disable @typescript-eslint/no-explicit-any -- 表示データの形を直接たどる検証のため */
import growth from './fixtures/growth.json';
import { toDisplayPlan } from './adapter.js';

const clone = (v: unknown) => JSON.parse(JSON.stringify(v));

describe('STAGE3由来のKPIの名称・単位の編集（課題No.19）', () => {
  const base = toDisplayPlan(clone(growth), {});
  const first = base.sections[2].blocks[0].protected[0] as any;

  it('名称と単位には、編集用の項目（キー）がある', () => {
    expect(first.labelKey).toMatch(/^stage3kpi:.+:label$/);
    expect(first.unitKey).toMatch(/^stage3kpi:.+:unit$/);
  });

  it('編集キーは表示用の名称に言い換えられない（保存した編集が後で届くように）', () => {
    expect(first.labelKey).not.toMatch(/「|」/);
    expect(first.targetKey).not.toMatch(/「|」/);
  });

  it('名称と単位を変えると表示に反映され、STAGE3の元の値も残る', () => {
    const d = toDisplayPlan(clone(growth), { [first.labelKey]: '新しいKPI名', [first.unitKey]: '件' }) as any;
    const row = d.sections[2].blocks[0].protected[0];
    expect(row.label).toBe('新しいKPI名');
    expect(row.labelOriginal).toBe(first.labelOriginal);
    expect(row.unit).toBe('件');
    expect(row.stage3Changed).toBe(true);
  });

  it('単位を空にしても、表示は壊れず、単位未設定として扱う', () => {
    const d = toDisplayPlan(clone(growth), { [first.unitKey]: '' }) as any;
    const row = d.sections[2].blocks[0].protected[0];
    expect(row.unit).toBeNull();
    expect(typeof row.target).toBe('string');
  });

  it('編集がなければ、名称と単位は元のまま変わらない', () => {
    expect(first.label).toBe(first.labelOriginal);
    expect(first.stage3Changed).toBe(false);
  });

  it('KPIのIDは名称を変えても変わらない（STAGE5との連携を保つ）', () => {
    const d = toDisplayPlan(clone(growth), { [first.labelKey]: '別の名前' }) as any;
    const row = d.sections[2].blocks[0].protected[0];
    expect(row.key).toBe(first.key);
  });
});
