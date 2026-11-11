import { runDocumentChecks } from './documentChecks';
import type { CompanyTarget, MidtermStrategy, StoryChapter } from '@/types/strategy';

const chapters = (body: string): StoryChapter[] => [
  { title: '第1章', body: '' },
  { title: '第2章', body: '' },
  { title: '第3章', body },
  { title: '第4章', body: '' },
];

const targets: CompanyTarget[] = [
  { id: 'rev', label: '売上', unit: '百万円', base: 12000, dueYear: 2030 } as CompanyTarget,
  { id: 'op', label: '営業利益', unit: '百万円', base: 50, dueYear: 2030 } as CompanyTarget,
];

const completeMidterm: MidtermStrategy = {
  targetVisionForMidterm: '専門企業',
  priorityStrategicThemes: ['テーマ'],
  companyWideDecisionCriteria: ['基準'],
  deploymentPrinciplesForUnits: ['展開'],
};

describe('runDocumentChecks：業績目標の不一致', () => {
  it('本文の売上・営業利益が登録目標と一致すれば問題を出さない', () => {
    const issues = runDocumentChecks({
      chapters: chapters('2030年度の売上120億円、営業利益0.5億円を目指す。'),
      conclusion: '',
      midtermStrategy: completeMidterm,
      companyTargets: targets,
    });
    expect(issues.filter((i) => i.kind === 'target_mismatch')).toEqual([]);
  });

  it('売上130億円・営業利益5億円は、登録目標（120億円・0.5億円）との不一致として検出する', () => {
    const issues = runDocumentChecks({
      chapters: chapters('2030年度の売上130億円、営業利益5億円を実現する。'),
      conclusion: '',
      midtermStrategy: completeMidterm,
      companyTargets: targets,
    });
    const mismatches = issues.filter((i) => i.kind === 'target_mismatch');
    expect(mismatches.map((i) => (i.kind === 'target_mismatch' ? i.metric : ''))).toEqual(['売上', '営業利益']);
    const revenue = mismatches[0];
    expect(revenue.kind === 'target_mismatch' && revenue.targetText).toBe('12,000 百万円');
  });

  it('結論に書かれた数値も検査し、営業利益率など別指標は対象にしない', () => {
    const issues = runDocumentChecks({
      chapters: chapters('営業利益率は8%を目指す。'),
      conclusion: '2030年度の売上130億円を実現する。',
      midtermStrategy: completeMidterm,
      companyTargets: targets,
    });
    const mismatches = issues.filter((i) => i.kind === 'target_mismatch');
    expect(mismatches.length).toBe(1);
    expect(mismatches[0].kind === 'target_mismatch' && mismatches[0].metric).toBe('売上');
  });

  it('登録目標が無い場合は、本文の数値を正しいとも誤りとも判定しない', () => {
    const issues = runDocumentChecks({
      chapters: chapters('売上130億円を目指す。'),
      conclusion: '',
      midtermStrategy: completeMidterm,
      companyTargets: [],
    });
    expect(issues.filter((i) => i.kind === 'target_mismatch')).toEqual([]);
  });
});

describe('runDocumentChecks：内部用語と中計の不足', () => {
  it('本文に内部の工程名（STAGE3など）があれば検出する', () => {
    const issues = runDocumentChecks({
      chapters: chapters('STAGE3では事業別の役割を定義する。'),
      conclusion: '',
      midtermStrategy: completeMidterm,
    });
    const internal = issues.find((i) => i.kind === 'internal_term');
    expect(internal && internal.kind === 'internal_term' && internal.snippets.length).toBe(1);
  });

  it('中計が無い場合は中計未生成として知らせ、空欄の項目は個別に出さない', () => {
    const issues = runDocumentChecks({ chapters: chapters('本文'), conclusion: '' });
    expect(issues).toEqual([{ kind: 'midterm_missing' }]);
  });

  it('中計があっても、重点テーマ・判断基準・展開方針が空なら不足として知らせる', () => {
    const issues = runDocumentChecks({
      chapters: chapters('本文'),
      conclusion: '',
      midtermStrategy: { targetVisionForMidterm: '専門企業', priorityStrategicThemes: [] },
    });
    expect(issues.filter((i) => i.kind === 'field_missing').map((i) => (i.kind === 'field_missing' ? i.label : ''))).toEqual([
      '重点戦略テーマ',
      '全社共通の判断基準',
      '部門・社員への展開方針',
    ]);
  });
});
