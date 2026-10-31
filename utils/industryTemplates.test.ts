import {
  getIndustryLabel,
  industryOptions,
  industryTemplates,
  selectableIndustryOptions,
  SELECTABLE_INDUSTRY_VALUES,
} from './industryTemplates';

describe('業種別テンプレートの対応（マスタとの整合）', () => {
  it('選択肢16分類のすべてに業種別文面がある', () => {
    for (const value of SELECTABLE_INDUSTRY_VALUES) {
      const text = industryTemplates[value];
      expect(typeof text).toBe('string');
      expect(text.trim().length).toBeGreaterThan(0);
    }
  });

  it('以前は文面が無かった it・finance・service も、成功パターンを含む文面がある', () => {
    for (const value of ['it', 'finance', 'service']) {
      expect(industryTemplates[value]).toContain('成功パターン');
    }
  });

  it('既存の業種コードの文面は残っている（旧データの互換）', () => {
    for (const value of ['manufacturing', 'retail', 'construction', 'it_software', 'finance_banking', 'other']) {
      expect(industryTemplates[value]).toBeTruthy();
    }
  });

  it('「その他」の文面は汎用の内容で、特定の業界を断定しない', () => {
    expect(industryTemplates.other).toBeTruthy();
    expect(industryTemplates.other).not.toMatch(/製造|小売|IT/);
  });
});

describe('業種の選択肢（16分類）', () => {
  it('16 分類を指定の順・表示名で持つ', () => {
    expect(selectableIndustryOptions.map((o) => o.label)).toEqual([
      '製造業',
      '建設業',
      '卸売業',
      '小売業',
      '情報通信・IT',
      '運輸・物流業',
      '金融・保険業',
      '不動産業',
      '医療・福祉',
      '教育・学習支援',
      '宿泊・飲食業',
      '専門サービス業',
      'その他サービス業',
      '農林水産業',
      'エネルギー・インフラ',
      'その他',
    ]);
    expect(selectableIndustryOptions).toHaveLength(16);
  });

  it('選択肢のコードはすべて業種マスタに存在し、重複しない', () => {
    expect(new Set(SELECTABLE_INDUSTRY_VALUES).size).toBe(SELECTABLE_INDUSTRY_VALUES.length);
    for (const value of SELECTABLE_INDUSTRY_VALUES) {
      expect(industryOptions.some((o) => o.value === value)).toBe(true);
    }
  });

  it('業種マスタのコードは重複しない', () => {
    const values = industryOptions.map((o) => o.value);
    expect(new Set(values).size).toBe(values.length);
  });
});

describe('既存コードの後方互換', () => {
  it('以前の UI が保存していたコード（it / finance / service など）もラベルに変換できる', () => {
    expect(getIndustryLabel('manufacturing', { full: true })).toBe('製造業');
    expect(getIndustryLabel('construction', { full: true })).toBe('建設業');
    expect(getIndustryLabel('retail', { full: true })).toBe('小売業');
    expect(getIndustryLabel('it', { full: true })).toBe('情報通信・IT');
    expect(getIndustryLabel('finance', { full: true })).toBe('金融・保険業');
    expect(getIndustryLabel('service', { full: true })).toBe('その他サービス業');
    expect(getIndustryLabel('other', { full: true })).toBe('その他');
  });

  it('選択肢から外れた既存コードは、コードを変えずにラベルだけ表示する', () => {
    expect(getIndustryLabel('it_software', { full: true })).toBe('IT（ソフトウェア）');
    expect(getIndustryLabel('it_software')).toBe('IT（ソフトウェア）');
    expect(getIndustryLabel('finance_banking', { full: true })).toBe('金融（銀行・証券）');
  });

  it('未知のコードは原文のまま返す（既存値を消さない）', () => {
    expect(getIndustryLabel('unknown_code', { full: true })).toBe('unknown_code');
    expect(getIndustryLabel('', { full: true })).toBe('');
  });
});
