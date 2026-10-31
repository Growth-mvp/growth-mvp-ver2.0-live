import {
  EMPLOYEE_BANDS,
  OVERSEAS_LOCATION,
  PREFECTURES,
  employeeDisplayLabel,
  formatHeadquartersLocation,
  parseHeadquartersLocation,
} from './companyProfile';

describe('PREFECTURES（都道府県）', () => {
  it('47 都道府県を重複なく持つ', () => {
    expect(PREFECTURES).toHaveLength(47);
    expect(new Set(PREFECTURES).size).toBe(47);
    expect(PREFECTURES).toContain('東京都');
    expect(PREFECTURES).toContain('沖縄県');
  });
});

describe('本社所在地の解釈と保存形式', () => {
  it('空・未選択は unset', () => {
    expect(parseHeadquartersLocation('')).toEqual({ kind: 'unset' });
    expect(parseHeadquartersLocation(null)).toEqual({ kind: 'unset' });
    expect(parseHeadquartersLocation(undefined)).toEqual({ kind: 'unset' });
  });

  it('都道府県名は prefecture として解釈する', () => {
    expect(parseHeadquartersLocation('東京都')).toEqual({ kind: 'prefecture', prefecture: '東京都' });
  });

  it('「海外」と、その補足（全角・半角コロン）を解釈する', () => {
    expect(parseHeadquartersLocation(OVERSEAS_LOCATION)).toEqual({ kind: 'overseas', detail: '' });
    expect(parseHeadquartersLocation('海外：ベトナム、タイ')).toEqual({ kind: 'overseas', detail: 'ベトナム、タイ' });
    expect(parseHeadquartersLocation('海外:ベトナム')).toEqual({ kind: 'overseas', detail: 'ベトナム' });
  });

  it('既存の自由記述は legacy として元の文字列を変えずに保つ', () => {
    expect(parseHeadquartersLocation('東京都千代田区1-1-1')).toEqual({ kind: 'legacy', raw: '東京都千代田区1-1-1' });
    expect(parseHeadquartersLocation('東京')).toEqual({ kind: 'legacy', raw: '東京' });
  });

  it('解釈→保存文字列→解釈で同じ値に戻る（legacy と補足の末尾空白を含む）', () => {
    const cases = ['', '大阪府', '海外', '海外：ベトナム ', '東京都千代田区1-1-1'];
    for (const value of cases) {
      const parsed = parseHeadquartersLocation(value);
      expect(formatHeadquartersLocation(parsed)).toBe(value);
    }
  });

  it('海外の補足が空なら「海外」だけを保存し、補足は100字で切る', () => {
    expect(formatHeadquartersLocation({ kind: 'overseas', detail: '   ' })).toBe('海外');
    expect(formatHeadquartersLocation({ kind: 'overseas', detail: 'あ'.repeat(150) })).toBe(
      `海外：${'あ'.repeat(100)}`
    );
  });
});

describe('従業員数の人数帯', () => {
  it('6 つの人数帯を重複なく持つ', () => {
    expect(EMPLOYEE_BANDS.map((b) => b.value)).toEqual(['1〜19', '20〜49', '50〜99', '100〜299', '300〜999', '1000以上']);
    expect(new Set(EMPLOYEE_BANDS.map((b) => b.value)).size).toBe(6);
  });

  it('保存値を表示名に変える。1,000名以上は桁区切りで表示する', () => {
    expect(employeeDisplayLabel('20〜49')).toBe('20〜49名');
    expect(employeeDisplayLabel('1000以上')).toBe('1,000名以上');
  });

  it('既存の人数値は人数帯へ変換せず、そのまま表示する', () => {
    expect(employeeDisplayLabel('300名')).toBe('300名');
    expect(employeeDisplayLabel('約300名')).toBe('約300名');
    expect(employeeDisplayLabel('300')).toBe('300');
    expect(employeeDisplayLabel('')).toBe('');
    expect(employeeDisplayLabel(undefined)).toBe('');
  });
});
