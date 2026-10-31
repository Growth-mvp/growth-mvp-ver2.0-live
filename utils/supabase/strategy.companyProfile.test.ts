import { buildDbRowFromState, buildStateFromDbRow } from './strategy';

describe('企業基本情報（本社所在地・従業員数・業種）の保存・復元', () => {
  it('新規入力の所在地・人数帯・業種を既存の列へ保存する（新規カラムは使わない）', () => {
    const row = buildDbRowFromState({
      location: '海外：ベトナム、タイ',
      employees: '20〜49',
      industry: 'it',
    } as any);
    expect(row.location).toBe('海外：ベトナム、タイ');
    expect(row.employees).toBe('20〜49');
    expect(row.industry).toBe('it');
  });

  it('保存した値を復元し、再保存しても同じ値になる（自動保存の full replacement で消えない）', () => {
    const row = buildDbRowFromState({ location: '大阪府', employees: '300〜999', industry: 'retail' } as any);
    const state = buildStateFromDbRow({ ...row, company_id: 'company-a' }) as any;
    expect(state.location).toBe('大阪府');
    expect(state.employees).toBe('300〜999');
    expect(state.industry).toBe('retail');

    const resaved = buildDbRowFromState(state);
    expect(resaved.location).toBe('大阪府');
    expect(resaved.employees).toBe('300〜999');
  });

  it('過去の正確な人数・自由記述の所在地は、読み込みと再保存で変換・消去しない', () => {
    const legacy = { company_id: 'company-a', location: '東京都千代田区1-1-1', employees: '約300名' };
    const state = buildStateFromDbRow(legacy) as any;
    expect(state.location).toBe('東京都千代田区1-1-1');
    expect(state.employees).toBe('約300名');

    const resaved = buildDbRowFromState(state);
    expect(resaved.location).toBe('東京都千代田区1-1-1');
    expect(resaved.employees).toBe('約300名');
  });

  it('未入力（列が空）の行は空のまま復元し、別の値を補完しない', () => {
    const state = buildStateFromDbRow({ company_id: 'company-a', location: '', employees: '' }) as any;
    expect(state.location).toBe('');
    expect(state.employees).toBe('');
  });

  it('会社Aの所在地・人数を会社Bの復元結果に混ぜない（行ごとに独立して復元される）', () => {
    const companyA = buildStateFromDbRow({ company_id: 'company-a', location: '東京都', employees: '1〜19' }) as any;
    const companyB = buildStateFromDbRow({ company_id: 'company-b', location: '海外', employees: '1000以上' }) as any;
    expect(companyA.location).toBe('東京都');
    expect(companyA.employees).toBe('1〜19');
    expect(companyB.location).toBe('海外');
    expect(companyB.employees).toBe('1000以上');
    expect(JSON.stringify(companyB)).not.toContain('東京都');
    expect(JSON.stringify(companyB)).not.toContain('1〜19');
  });
});
