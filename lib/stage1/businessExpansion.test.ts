import {
  OVERSEAS_REGION_OPTIONS,
  OVERSEAS_UNSPECIFIED_SEARCH_LABEL,
  currentRegionLabels,
  normalizeExpansionScope,
  sanitizeOverseasRegions,
  segmentCurrentRegionText,
  toggleOverseasRegion,
} from './businessExpansion';

describe('現在の主な事業展開地域の3択（保存値）', () => {
  it('3択の値だけを受け付け、それ以外と未入力は undefined', () => {
    expect(normalizeExpansionScope('domestic')).toBe('domestic');
    expect(normalizeExpansionScope('overseas')).toBe('overseas');
    expect(normalizeExpansionScope('both')).toBe('both');
    expect(normalizeExpansionScope('')).toBeUndefined();
    expect(normalizeExpansionScope(undefined)).toBeUndefined();
    expect(normalizeExpansionScope('bogus')).toBeUndefined();
    expect(normalizeExpansionScope(1)).toBeUndefined();
  });
});

describe('海外の国・地域の許可リスト', () => {
  it('選択肢は重複なく、空や自由入力を含まない', () => {
    expect(new Set(OVERSEAS_REGION_OPTIONS).size).toBe(OVERSEAS_REGION_OPTIONS.length);
    expect(OVERSEAS_REGION_OPTIONS.every((r) => r.length > 0)).toBe(true);
  });

  it('許可リストに一致する値だけを、リストの順・重複なしで残す', () => {
    expect(sanitizeOverseasRegions(['中国', '東南アジア', '中国'])).toEqual(['東南アジア', '中国']);
  });

  it('自由入力・不正値・数値・配列以外は捨てる（サーバー側の検証と同じ）', () => {
    expect(sanitizeOverseasRegions(['ベトナム', '米国', '<script>', 1, null])).toEqual([]);
    expect(sanitizeOverseasRegions('中国')).toEqual([]);
    expect(sanitizeOverseasRegions(undefined)).toEqual([]);
  });

  it('トグルで選択・解除し、許可リスト外の値は無視する', () => {
    expect(toggleOverseasRegion(undefined, '北米')).toEqual(['北米']);
    expect(toggleOverseasRegion(['北米'], '欧州')).toEqual(['北米', '欧州']);
    expect(toggleOverseasRegion(['北米', '欧州'], '北米')).toEqual(['欧州']);
    expect(toggleOverseasRegion(['北米'], 'ベトナム')).toEqual(['北米']);
  });
});

describe('SWOT検索へ渡す現在の事業展開地域の参考ラベル（currentRegionLabels）', () => {
  it('事業が無い・全て未入力なら空（探索対象を限定しない）', () => {
    expect(currentRegionLabels([])).toEqual([]);
    expect(currentRegionLabels([{}, { expansionScope: undefined }])).toEqual([]);
  });

  it('国内中心は日本国内、海外中心は許可リストの国・地域を参考に渡す', () => {
    expect(currentRegionLabels([{ expansionScope: 'domestic' }])).toEqual(['日本国内']);
    expect(currentRegionLabels([{ expansionScope: 'overseas', overseasRegions: ['東南アジア', '中国'] }])).toEqual([
      '海外（東南アジア、中国）',
    ]);
  });

  it('海外の国・地域が未選択なら、特定の国を補わず「未指定」と渡す', () => {
    expect(currentRegionLabels([{ expansionScope: 'overseas' }])).toEqual([OVERSEAS_UNSPECIFIED_SEARCH_LABEL]);
    expect(currentRegionLabels([{ expansionScope: 'overseas', overseasRegions: [] }])).toEqual([
      OVERSEAS_UNSPECIFIED_SEARCH_LABEL,
    ]);
  });

  it('国内・海外の両方は日本国内と選択された海外を両方渡す', () => {
    expect(currentRegionLabels([{ expansionScope: 'both', overseasRegions: ['北米'] }])).toEqual([
      '日本国内',
      '海外（北米）',
    ]);
  });

  it('許可リスト外の値（既存の自由入力や改ざん値）は検索に含めない', () => {
    expect(
      currentRegionLabels([{ expansionScope: 'overseas', overseasRegions: ['ベトナム1200', 'SECRET-TEXT'] }])
    ).toEqual([OVERSEAS_UNSPECIFIED_SEARCH_LABEL]);
  });

  it('複数事業は重複を除いて集約する（未入力の事業は加えない）', () => {
    expect(
      currentRegionLabels([
        { expansionScope: 'domestic' },
        {},
        { expansionScope: 'both', overseasRegions: ['中国'] },
        { expansionScope: 'domestic' },
      ])
    ).toEqual(['日本国内', '海外（中国）']);
  });

  it('未入力と国内中心を区別する', () => {
    expect(currentRegionLabels([{}])).toEqual([]);
    expect(currentRegionLabels([{ expansionScope: 'domestic' }])).toEqual(['日本国内']);
  });

  it('国内中心の事業に残った海外の選択は検索に含めない', () => {
    expect(currentRegionLabels([{ expansionScope: 'domestic', overseasRegions: ['中国'] }])).toEqual(['日本国内']);
  });
});

describe('分析入力に出す事業ごとの現在の事業展開地域（segmentCurrentRegionText）', () => {
  it('3択と未入力を区別して文言にする', () => {
    expect(segmentCurrentRegionText({})).toBe('未入力');
    expect(segmentCurrentRegionText({ expansionScope: 'domestic' })).toBe('国内中心');
    expect(segmentCurrentRegionText({ expansionScope: 'overseas' })).toBe('海外中心（国・地域は未指定）');
    expect(segmentCurrentRegionText({ expansionScope: 'both', overseasRegions: ['中国', '韓国・台湾'] })).toBe(
      '国内・海外の両方（中国、韓国・台湾）'
    );
  });
});
