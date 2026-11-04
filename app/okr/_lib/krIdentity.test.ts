import {
  assignIdToKrRef,
  genId,
  mergeGeneratedKpisIntoOkrsV2,
  mkAiKpiKr,
} from './okrModels';
import { locateKrById, recordKrActual, revertKrActual } from '@/lib/stage5/krActual';
import { krSaveOutcome } from '@/lib/strategy/krSaveOutcome';
import { normalizeStrategyData } from '@/utils/supabase/normalize';

const actual = (value: number, asOf = '2026-09') => ({ value, asOf, recordedAt: '2026-09-30T00:00:00.000Z' });

const kr = (id: string | undefined, label: string, target: number, extra: Record<string, unknown> = {}): any => ({
  ...(id === undefined ? {} : { id }),
  label,
  target,
  unit: '件',
  ...extra,
});

const storeOf = (okrsV2: unknown[]) => ({
  departments: [{ id: 'd1', name: '営業部', projects: [{ id: 'p1', title: '新規開拓', okrsV2 }] }],
});

const saveAndReload = (okrsV2: unknown[]): any[] =>
  (normalizeStrategyData(JSON.parse(JSON.stringify(storeOf(okrsV2)))) as any).departments[0].projects[0].okrsV2;

describe('AI生成KRのID付与', () => {
  it('AI案から作るKRには空でない一意のIDが付く', () => {
    const a = mkAiKpiKr({ label: '新規商談数', target: 10, unit: '件' });
    const b = mkAiKpiKr({ label: '新規商談数', target: 10, unit: '件' });
    expect(typeof a.id).toBe('string');
    expect(a.id.trim()).not.toBe('');
    expect(a.id).not.toBe(b.id);
  });
});

describe('AI案の反映（mergeGeneratedKpisIntoOkrsV2）', () => {
  it('既存KRのID・実績・履歴・財務項目を残し、空欄でない目標・単位は変えない', () => {
    const existing = [
      kr('kr-a', '保守契約の継続率', 95, { actual: actual(92), actualHistory: [actual(90, '2026-08')], financeEffect: { k: 1 } }),
    ];
    const merged = mergeGeneratedKpisIntoOkrsV2(existing, ['保守契約の継続率'], [{ label: '保守契約の継続率', target: 60, unit: '%' }]);
    expect(merged.okrsV2).toEqual([existing[0]]);
    expect(merged.updatedCount).toBe(0);
  });

  it('目標が0の既存KRだけ AI案の目標で補完し、ID・実績は保つ', () => {
    const existing = [kr('kr-a', 'X', 0, { unit: undefined, actual: actual(3) })];
    const merged = mergeGeneratedKpisIntoOkrsV2(existing, ['X'], [{ label: 'X', target: 50, unit: '%' }]);
    expect(merged.okrsV2[0]).toMatchObject({ id: 'kr-a', target: 50, unit: '%', actual: actual(3) });
    expect(merged.updatedCount).toBe(1);
  });

  it('新規のKRには既存と重複しない新しいIDを付与する', () => {
    const existing = [kr('kr-a', 'A', 10)];
    const merged = mergeGeneratedKpisIntoOkrsV2(existing, ['A', 'B'], [{ label: 'A' }, { label: 'B', target: 5 }]);
    expect(merged.okrsV2.map((k) => k.label)).toEqual(['A', 'B']);
    expect(merged.okrsV2[0].id).toBe('kr-a');
    expect(merged.okrsV2[1].id.trim()).not.toBe('');
    expect(merged.okrsV2[1].id).not.toBe('kr-a');
    expect(merged.okrsV2[1].target).toBe(5);
  });

  it('同名KRが複数ある場合は対応先を決めず、ID・実績・目標を一切書き換えず、重複も作らない', () => {
    const existing = [
      kr('kr-1', '新規商談数', 10, { actual: actual(4) }),
      kr('kr-2', '新規商談数', 20, { actual: actual(15) }),
    ];
    const merged = mergeGeneratedKpisIntoOkrsV2(existing, ['新規商談数', '新規商談数'], [{ label: '新規商談数', target: 99 }, { label: '新規商談数', target: 98 }]);
    expect(merged.okrsV2).toEqual(existing);
    expect(merged.ambiguousCount).toBe(2);
    expect(merged.updatedCount).toBe(0);
  });

  it('同じ名称のAI案が2件あっても、新規KRは1件だけ作る', () => {
    const merged = mergeGeneratedKpisIntoOkrsV2([], ['B', 'B'], [{ label: 'B' }, { label: 'B' }]);
    expect(merged.okrsV2.map((k) => k.label)).toEqual(['B']);
    expect(merged.okrsV2[0].id.trim()).not.toBe('');
  });

  it('並び順が変わっても、ラベルで対応する既存KRのID・実績を保つ', () => {
    const existing = [
      kr('kr-a', 'A', 10, { actual: actual(1) }),
      kr('kr-b', 'B', 20, { actual: actual(2) }),
    ];
    const merged = mergeGeneratedKpisIntoOkrsV2(existing, ['B', 'A'], []);
    expect(merged.okrsV2.map((k) => [k.label, k.id, k.actual?.value])).toEqual([
      ['B', 'kr-b', 2],
      ['A', 'kr-a', 1],
    ]);
  });

  it('STAGE3のKPIに含まれない既存KRは削除しない', () => {
    const existing = [kr('kr-a', 'A', 10, { actual: actual(1) }), kr('kr-z', 'Z', 1, { actual: actual(7) })];
    const merged = mergeGeneratedKpisIntoOkrsV2(existing, ['A'], []);
    expect(merged.okrsV2.map((k) => k.id)).toEqual(['kr-a', 'kr-z']);
    expect(merged.okrsV2[1].actual).toEqual(actual(7));
  });

  it('ID無しの旧KRには一括でIDを付与せず、実績は保つ', () => {
    const existing = [kr(undefined, '旧KR', 10, { actual: actual(3) })];
    const merged = mergeGeneratedKpisIntoOkrsV2(existing, [], []);
    expect(merged.okrsV2[0].id).toBeUndefined();
    expect(merged.okrsV2[0].actual).toEqual(actual(3));
  });

  it('同じAI案を再反映してもIDは変わらない', () => {
    const draft = [{ label: 'A' }, { label: 'B' }];
    const first = mergeGeneratedKpisIntoOkrsV2([], ['A', 'B'], draft).okrsV2;
    const second = mergeGeneratedKpisIntoOkrsV2(first, ['A', 'B'], draft).okrsV2;
    expect(second.map((k) => k.id)).toEqual(first.map((k) => k.id));
  });
});

describe('利用者が選んだKRへのID補完（assignIdToKrRef）', () => {
  it('指定した参照のKRだけにIDを付け、元の配列は変えない', () => {
    const list = [kr(undefined, 'A', 1), kr(undefined, 'B', 2)];
    const next = assignIdToKrRef(list, list[1], 'new-b');
    expect(next?.[1]).toMatchObject({ id: 'new-b', label: 'B' });
    expect(next?.[0]).toBe(list[0]);
    expect(list[1].id).toBeUndefined();
  });

  it('配列内に同一参照がない場合は付与しない', () => {
    const list = [kr(undefined, 'A', 1)];
    expect(assignIdToKrRef(list, { ...list[0] }, 'x')).toBeNull();
  });

  it('既にIDがあるKRには付与しない', () => {
    const list = [kr('kr-1', 'A', 1)];
    expect(assignIdToKrRef(list, list[0], 'x')).toBeNull();
  });

  it('空白だけのIDは未設定として扱う', () => {
    const list = [kr('  ', 'A', 1)];
    expect(assignIdToKrRef(list, list[0], 'x')?.[0].id).toBe('x');
  });
});

describe('保存・再読込を経た実績記録', () => {
  it('旧形式KRは、利用者がIDを補完して保存すると実績を記録でき、再読込後も残る', () => {
    const legacy = [kr(undefined, '保守契約の継続率', 95, { actual: actual(92) })];
    const before = saveAndReload(legacy);
    expect(before[0].id).toBe('');
    expect(locateKrById(before, before[0].id)).toEqual({ ok: false, reason: 'missing-id' });

    const newId = genId();
    const withId = assignIdToKrRef(before, before[0], newId);
    expect(withId).not.toBeNull();

    const reloaded = saveAndReload(withId as any[]);
    expect(reloaded[0].id).toBe(newId);
    const rec = recordKrActual(reloaded, reloaded[0].id, actual(97, '2026-10'));
    expect(rec.ok).toBe(true);

    const final = saveAndReload(rec.ok ? rec.next : []);
    expect(final[0].id).toBe(newId);
    expect(final[0].actual).toEqual(actual(97, '2026-10'));
    expect(final[0].actualHistory).toEqual([actual(92)]);
  });

  it('AI生成KRは、保存・再読込後も同じIDで実績を記録でき、履歴が残る', () => {
    const aiKr = mkAiKpiKr({ label: '新規商談数', target: 10, unit: '件' });
    const reloaded = saveAndReload([aiKr]);
    expect(reloaded[0].id).toBe(aiKr.id);
    const rec = recordKrActual(reloaded, reloaded[0].id, actual(6, '2026-10'));
    expect(rec.ok).toBe(true);
    const again = saveAndReload(rec.ok ? rec.next : []);
    expect(again[0].id).toBe(aiKr.id);
    expect(again[0].actual).toEqual(actual(6, '2026-10'));
  });

  it('AI案を反映しても既存KRの実績は残り、新規KRは記録できる', () => {
    const existing = saveAndReload([kr('kr-a', 'A', 10, { actual: actual(4) })]);
    const merged = mergeGeneratedKpisIntoOkrsV2(existing, ['A', 'B'], [{ label: 'A', target: 99 }, { label: 'B', target: 5 }]);
    const reloaded = saveAndReload(merged.okrsV2);

    expect(reloaded[0]).toMatchObject({ id: 'kr-a', target: 10, actual: actual(4) });
    const bId = reloaded[1].id;
    expect(bId.trim()).not.toBe('');
    expect(recordKrActual(reloaded, bId, actual(2, '2026-10')).ok).toBe(true);
    expect(recordKrActual(reloaded, 'kr-a', actual(5, '2026-10')).ok).toBe(true);
  });
});

describe('保存結果の判定（成功表示の抑止）', () => {
  it('ok のときだけ成功とする', () => {
    expect(krSaveOutcome({ ok: true })).toEqual({ ok: true });
  });

  it('結果がない（保存の前提が揃わない）ときは保存されていないとする', () => {
    expect(krSaveOutcome(undefined)).toMatchObject({ ok: false });
  });

  it('会社・戦略の切替による破棄は、保存されなかったとして扱う', () => {
    const r = krSaveOutcome({ ok: false, skipped: true, reason: 'scope_changed' });
    expect(r.ok).toBe(false);
    expect(r.ok ? '' : r.message).toContain('切り替わった');
  });

  it('revision 競合は、保存されなかったとして扱う', () => {
    const r = krSaveOutcome({ ok: false, reason: 'revision_conflict_persist', code: 'REVISION_CONFLICT' });
    expect(r.ok).toBe(false);
    expect(r.ok ? '' : r.message).toContain('競合');
  });

  it('API エラーは失敗として扱う', () => {
    const r = krSaveOutcome({ ok: false, reason: 'api_error' });
    expect(r.ok).toBe(false);
  });
});

describe('保存失敗時の実績の巻き戻し（revertKrActual）', () => {
  it('対象KRの実績と履歴だけを記録前に戻し、他のKRは変えない', () => {
    const list = saveAndReload([
      kr('kr-a', 'A', 10, { actual: actual(4), actualHistory: [actual(2, '2026-07')] }),
      kr('kr-b', 'B', 20, { actual: actual(9) }),
    ]);
    const recorded = recordKrActual(list, 'kr-a', actual(6, '2026-10'));
    expect(recorded.ok).toBe(true);
    const reverted = revertKrActual(recorded.ok ? recorded.next : [], 'kr-a', list[0]);
    expect(reverted?.[0]).toEqual(list[0]);
    expect(reverted?.[1]).toEqual(list[1]);
  });

  it('記録前に実績がなかったKRは、巻き戻し後に実績と履歴を持たない', () => {
    const list = saveAndReload([kr('kr-a', 'A', 10)]);
    const recorded = recordKrActual(list, 'kr-a', actual(6, '2026-10'));
    const reverted = revertKrActual(recorded.ok ? recorded.next : [], 'kr-a', list[0]);
    expect('actual' in (reverted?.[0] ?? {})).toBe(false);
    expect('actualHistory' in (reverted?.[0] ?? {})).toBe(false);
  });

  it('対象KRがなければ null', () => {
    expect(revertKrActual([kr('kr-a', 'A', 10)], 'kr-x', { actual: undefined })).toBeNull();
  });
});
