import { resolveVoiceNavigation, type VoiceDepartment } from './navigationIntent';

const DEPARTMENTS: VoiceDepartment[] = [
  { name: '宅配事業', projects: [{ title: '配送ルートの見直し' }] },
  { name: '新聞販売', projects: [{ title: '購読者の維持' }] },
];

describe('resolveVoiceNavigation：画面を開く指示', () => {
  it.each([
    ['会社の現状を分析したい', '/stage1'],
    ['企業価値分析を開いて', '/stage1'],
    ['経営者の思いを入力したい', '/stage2'],
    ['全社戦略を見せて', '/stage2'],
    ['部門戦略の6つの問いを開いて', '/cascade'],
    ['STAGE4を開いて', '/okr'],
  ])('「%s」は %s を開く', (text, href) => {
    const result = resolveVoiceNavigation(text, DEPARTMENTS);
    expect(result).toEqual(expect.objectContaining({ kind: 'navigate', href }));
  });

  it('部門名を含むと、部門戦略は /cascade に部門を付けて開く', () => {
    expect(resolveVoiceNavigation('宅配事業の戦略を見せて', DEPARTMENTS)).toEqual(
      expect.objectContaining({ kind: 'navigate', href: '/cascade?dept=%E5%AE%85%E9%85%8D%E4%BA%8B%E6%A5%AD', departmentName: '宅配事業' }),
    );
  });

  it('実行計画は部門付きで /okr を開く', () => {
    expect(resolveVoiceNavigation('宅配事業の実行計画を開いて', DEPARTMENTS)).toEqual(
      expect.objectContaining({ kind: 'navigate', href: '/okr?dept=%E5%AE%85%E9%85%8D%E4%BA%8B%E6%A5%AD' }),
    );
  });

  it('プロジェクト名を含むと、部門とプロジェクトの両方を指定する', () => {
    const result = resolveVoiceNavigation('宅配事業の配送ルートの見直しを開いて', DEPARTMENTS);
    expect(result).toEqual(
      expect.objectContaining({ kind: 'navigate', projectTitle: '配送ルートの見直し', departmentName: '宅配事業' }),
    );
    expect(result && result.kind === 'navigate' && result.href).toContain('project=');
  });

  it('プロジェクト名だけでも一意なら、その部門の画面を開く', () => {
    expect(resolveVoiceNavigation('購読者の維持を開いて', DEPARTMENTS)).toEqual(
      expect.objectContaining({ kind: 'navigate', departmentName: '新聞販売', projectTitle: '購読者の維持' }),
    );
  });
});

describe('resolveVoiceNavigation：画面遷移ではない指示は AI に任せる', () => {
  it.each([
    '全社戦略について相談したい',
    'この内容で全社戦略のたたき台を作って',
    '2030年の売上目標を1億7,500万円にして',
    'STAGE2を開いて、SWOTに追加して',
    '全社戦略を見せて、何が書いてあるか教えて',
    'STAGE5を開いて',
    '会社の現状はどうですか',
    '当社の収益性について分析して',
    '',
  ])('「%s」は画面遷移にしない', (text) => {
    expect(resolveVoiceNavigation(text, DEPARTMENTS)).toBeNull();
  });

  it('部門名だけで開く指示がなければ遷移しない', () => {
    expect(resolveVoiceNavigation('宅配事業の戦略を見せて', [])).toBeNull();
  });
});

describe('resolveVoiceNavigation：対象が一意に決まらない場合は質問する', () => {
  it('複数の画面を同時に指定したら質問する', () => {
    expect(resolveVoiceNavigation('STAGE1とSTAGE2を開いて', DEPARTMENTS)).toEqual(
      expect.objectContaining({ kind: 'clarify' }),
    );
  });

  it('画面が特定できない「画面を開いて」は、候補を示して質問する', () => {
    const result = resolveVoiceNavigation('画面を開いて', DEPARTMENTS);
    expect(result).toEqual(expect.objectContaining({ kind: 'clarify' }));
    expect(result && result.kind === 'clarify' && result.message).toContain('STAGE4');
  });

  it('部門名が複数一致したら質問する', () => {
    const departments: VoiceDepartment[] = [{ name: '営業' }, { name: '営業推進' }];
    expect(resolveVoiceNavigation('営業推進の戦略を見せて', departments)).toEqual(
      expect.objectContaining({ kind: 'clarify' }),
    );
  });

  it('プロジェクト名が複数の部門で一致したら質問する', () => {
    const departments: VoiceDepartment[] = [
      { name: '宅配事業', projects: [{ title: '配送改善' }] },
      { name: '新聞販売', projects: [{ title: '配送改善' }] },
    ];
    expect(resolveVoiceNavigation('配送改善を開いて', departments)).toEqual(
      expect.objectContaining({ kind: 'clarify' }),
    );
  });
});
