import { krActualView, locateKrById, parseKrActualInput, recordKrActual, sanitizeKrActual, sanitizeKrActualHistory, KR_ACTUAL_NOTE_MAX } from './krActual';
import { normalizeStrategyData } from '@/utils/supabase/normalize';

const kr = (id: string, label: string, target = 95, extra: Record<string, unknown> = {}): any => ({
  id,
  kind: 'CHURN',
  label,
  target,
  unit: '%',
  scope: 'company',
  baseKey: 'churn',
  due: '2027-06',
  owner: '鈴木一郎',
  ...extra,
});

const actual = (value: number, asOf = '2026-10') => ({ value, asOf, recordedAt: '2026-11-03T00:00:00.000Z' });

describe('KRの特定は一意なIDだけで行う', () => {
  it('IDが一致するKRだけを返す（ラベル・順序では探さない）', () => {
    const list = [kr('kr-a', '保守契約の継続率'), kr('kr-b', '保守契約の継続率')];
    expect(locateKrById(list, 'kr-b')).toEqual({ ok: true, index: 1 });
    expect(locateKrById(list, '保守契約の継続率')).toEqual({ ok: false, reason: 'not-found' });
  });

  it('IDが空・未指定なら、どのKRにも紐づけない', () => {
    const list = [kr('', '継続率'), kr('', '継続率')];
    expect(locateKrById(list, '')).toEqual({ ok: false, reason: 'missing-id' });
    expect(locateKrById(list, undefined)).toEqual({ ok: false, reason: 'missing-id' });
  });

  it('同じIDが複数あれば、対象を決めない', () => {
    const list = [kr('dup', 'A'), kr('dup', 'B')];
    expect(locateKrById(list, 'dup')).toEqual({ ok: false, reason: 'ambiguous' });
  });
});

describe('実績の記録', () => {
  it('対象のKRだけに実績を入れ、目標と他のKRは変えない', () => {
    const list = [kr('kr-a', '継続率', 95), kr('kr-b', '受注率', 30)];
    const r = recordKrActual(list, 'kr-a', actual(92));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.next[0].actual).toEqual(actual(92));
    expect(r.next[0].target).toBe(95);
    expect(r.next[0].label).toBe('継続率');
    expect(r.next[1]).toEqual(list[1]);
    expect(list[0].actual).toBeUndefined();
  });

  it('並べ替えても、IDで対象を特定して記録する（順序に依存しない）', () => {
    const reordered = [kr('kr-b', '受注率', 30), kr('kr-a', '継続率', 95)];
    const r = recordKrActual(reordered, 'kr-a', actual(92));
    if (!r.ok) throw new Error('記録できるはず');
    expect(r.next.find((k) => k.id === 'kr-a')?.actual?.value).toBe(92);
    expect(r.next.find((k) => k.id === 'kr-b')?.actual).toBeUndefined();
  });

  it('同名のKRがあっても、選んだIDのKRだけに記録する', () => {
    const list = [kr('kr-a', '継続率', 95), kr('kr-b', '継続率', 90)];
    const r = recordKrActual(list, 'kr-b', actual(88));
    if (!r.ok) throw new Error('記録できるはず');
    expect(r.next[0].actual).toBeUndefined();
    expect(r.next[1].actual?.value).toBe(88);
  });

  it('IDのないKRや見つからないIDでは記録せず、失敗を返す（黙って成功扱いしない）', () => {
    const list = [kr('', '継続率')];
    expect(recordKrActual(list, '', actual(92))).toEqual({ ok: false, reason: 'missing-id' });
    expect(recordKrActual(list, 'kr-x', actual(92))).toEqual({ ok: false, reason: 'not-found' });
  });

  it('上書きすると、直前の実績を履歴に残す（削除しない）', () => {
    const list = [kr('kr-a', '継続率', 95, { actual: actual(92, '2026-09') })];
    const r = recordKrActual(list, 'kr-a', actual(93, '2026-10'));
    if (!r.ok) throw new Error('記録できるはず');
    expect(r.replaced).toEqual(actual(92, '2026-09'));
    expect(r.next[0].actual?.value).toBe(93);
    expect(r.next[0].actualHistory).toEqual([actual(92, '2026-09')]);
  });

  it('ラベルの改名やKRの削除があっても、ID一致の実績は別のKRへ移らない', () => {
    const before = recordKrActual([kr('kr-a', '継続率'), kr('kr-b', '受注率', 30)], 'kr-a', actual(92));
    if (!before.ok) throw new Error('記録できるはず');
    const renamed = before.next.map((k) => (k.id === 'kr-a' ? { ...k, label: '保守契約の継続率' } : k));
    expect(renamed.find((k) => k.id === 'kr-a')?.actual?.value).toBe(92);
    const withoutB = before.next.filter((k) => k.id !== 'kr-b');
    expect(withoutB.find((k) => k.id === 'kr-a')?.actual?.value).toBe(92);
  });
});

describe('入力の検査', () => {
  const now = '2026-11-03T00:00:00.000Z';

  it('数値と基準日を検査し、補足は任意', () => {
    expect(parseKrActualInput({ value: '92', asOf: '2026-10' }, now)).toEqual({
      ok: true,
      actual: { value: 92, asOf: '2026-10', recordedAt: now },
    });
    const withNote = parseKrActualInput({ value: ' 92.5 ', asOf: '2026-10-31', note: ' 月次集計 ' }, now);
    expect(withNote).toEqual({ ok: true, actual: { value: 92.5, asOf: '2026-10-31', recordedAt: now, note: '月次集計' } });
  });

  it('数値でない実績値・不正な基準日・長すぎる補足は拒否する', () => {
    expect(parseKrActualInput({ value: '', asOf: '2026-10' }, now)).toMatchObject({ ok: false });
    expect(parseKrActualInput({ value: 'abc', asOf: '2026-10' }, now)).toMatchObject({ ok: false });
    expect(parseKrActualInput({ value: '92', asOf: '2026/10' }, now)).toMatchObject({ ok: false });
    expect(parseKrActualInput({ value: '92', asOf: '2026-13' }, now)).toMatchObject({ ok: false });
    expect(parseKrActualInput({ value: '92', asOf: '2026-10', note: 'あ'.repeat(KR_ACTUAL_NOTE_MAX + 1) }, now)).toMatchObject({ ok: false });
  });
});

describe('表示：目標と実績の差', () => {
  it('未登録は「未確認」', () => {
    expect(krActualView(kr('kr-a', '継続率'))).toEqual({ status: 'unrecorded', targetText: '95 %' });
  });

  it('例の通り、目標95%・実績92%は差が−3ポイント', () => {
    const v = krActualView(kr('kr-a', '継続率', 95, { actual: actual(92) }));
    expect(v).toMatchObject({ status: 'recorded', targetText: '95 %', actualText: '92 %', diffText: '−3ポイント', asOf: '2026-10' });
  });

  it('件数の単位では差を単位のまま示し、プラスには＋を付ける', () => {
    const v = krActualView(kr('kr-b', '新規商談数', 120, { unit: '件', actual: actual(125) }));
    expect(v).toMatchObject({ status: 'recorded', diffText: '+5件' });
  });
});

describe('読込時の検査', () => {
  it('構造の正しい実績だけを採用し、壊れたものは採用しない（推測で補正しない）', () => {
    expect(sanitizeKrActual(actual(92))).toEqual(actual(92));
    expect(sanitizeKrActual({ value: 'x', asOf: '2026-10', recordedAt: 'z' })).toBeUndefined();
    expect(sanitizeKrActual({ value: 92, asOf: '2026年10月', recordedAt: 'z' })).toBeUndefined();
    expect(sanitizeKrActualHistory([actual(91), { value: NaN }])).toEqual([actual(91)]);
    expect(sanitizeKrActualHistory([])).toBeUndefined();
  });
});

describe('保存・再読込（normalizeStrategyData）で実績と目標が残る', () => {
  const saved = JSON.parse(
    JSON.stringify({
      departments: [
        {
          id: 'd1',
          name: '営業部',
          projects: [
            {
              id: 'p1',
              title: '既存顧客の保守契約更新',
              okrsV2: [
                kr('kr-a', '保守契約の継続率', 95, { actual: actual(92), actualHistory: [actual(90, '2026-08')] }),
                kr('kr-b', '新規商談数', 120, { unit: '件' }),
              ],
            },
          ],
        },
      ],
    }),
  );

  it('実績・履歴・目標・単位・IDが再読込後も同じ値で残る', () => {
    const loaded: any = normalizeStrategyData(saved as any);
    const krs = loaded.departments[0].projects[0].okrsV2;
    expect(krs[0]).toMatchObject({ id: 'kr-a', label: '保守契約の継続率', target: 95, unit: '%', actual: actual(92) });
    expect(krs[0].actualHistory).toEqual([actual(90, '2026-08')]);
    expect(krs[1]).toMatchObject({ id: 'kr-b', target: 120, unit: '件' });
  });

  it('実績のないKRは、以前と同じ形のまま（actualの項目を増やさない）', () => {
    const loaded: any = normalizeStrategyData(saved as any);
    expect('actual' in loaded.departments[0].projects[0].okrsV2[1]).toBe(false);
    expect('actualHistory' in loaded.departments[0].projects[0].okrsV2[1]).toBe(false);
  });

  it('再読込を2回しても同じ（冪等）', () => {
    const once: any = normalizeStrategyData(saved as any);
    const twice: any = normalizeStrategyData(JSON.parse(JSON.stringify(once)));
    expect(twice.departments[0].projects[0].okrsV2).toEqual(once.departments[0].projects[0].okrsV2);
  });
});

describe('修正前の照合式の再現（ID欠落KRの取り違え）', () => {
  it('旧い照合（String(id ?? \'\') === krId）は、ID無しKR 2件のうち先頭を選ぶ（修正前の挙動）', () => {
    const list = [kr('', '継続率', 95), kr('', '受注率', 30)];
    const krId = '';
    const oldIndex = list.findIndex((x: any) => String(x?.id ?? '') === krId);
    expect(oldIndex).toBe(0);
    expect(locateKrById(list, krId)).toEqual({ ok: false, reason: 'missing-id' });
  });
});
