import { buildStage1IssuesBlock, STAGE1_ISSUES_MAX } from './stage1Issues';
import { buildStage2StoryStateBlock } from './stage2StoryState';

describe('STAGE1の経営課題：登録済みの stage1Issues だけを参照する', () => {
  it('登録された課題を、範囲と関連指標つきで示す', () => {
    const text = buildStage1IssuesBlock([
      { title: '配送コストの上昇', description: '燃料費と人件費が売上の伸びを上回っている', linkedMetrics: ['営業利益率'], scope: 'business' },
      { title: '人員の定着', description: '', linkedMetrics: [], scope: 'company' },
    ]);
    expect(text).toContain('【STAGE1の経営課題（登録済み）】');
    expect(text).toContain('- 配送コストの上昇（事業）：燃料費と人件費が売上の伸びを上回っている｜関連する指標：営業利益率');
    expect(text).toContain('- 人員の定着（会社全体）：説明未登録');
  });

  it('課題が登録されていなければ、0件と明示する（推測で課題を足さない）', () => {
    expect(buildStage1IssuesBlock(undefined)).toContain('登録された経営課題はない（0件）');
    expect(buildStage1IssuesBlock([{ description: '題名のない課題' }])).toContain('登録された経営課題はない（0件）');
  });

  it('上限を超えた課題は省略数を示し、全件を確認したとは言わせない', () => {
    const many = Array.from({ length: STAGE1_ISSUES_MAX + 2 }, (_, i) => ({ title: `課題${i + 1}`, description: '', scope: 'company' }));
    const text = buildStage1IssuesBlock(many);
    expect(text).toContain('- ほか2件（省略。全件を確認したとは言わない）');
    expect(text).not.toContain('課題6');
  });

  it('古い issueBlocks の値は、stage1Issues が無ければ使わない（取り違えない）', () => {
    expect(buildStage1IssuesBlock(undefined)).not.toContain('issueBlocks');
  });
});

describe('STAGE2の戦略ストーリー：確定版・草案・編集中を区別する', () => {
  const chapter = (title: string, body: string) => ({ title, body });
  const CONFIRMED = [chapter('全社戦略', '確定した本文')];

  it('確定版だけがあるときは、確定版が現在有効な確定版で、草案はないと示す', () => {
    const text = buildStage2StoryStateBlock({ finalStoryFinal: CONFIRMED });
    expect(text).toContain('- 現在有効な確定版：あり（1章。確定した内容）');
    expect(text).toContain('- 現在の草案：なし');
    expect(text).toContain('- 下の【戦略ストーリー要約】は、現在有効な確定版（前回確定した内容）の内容。');
  });

  it('確定版の後に新しい草案があるときは、草案を確定版と区別し、草案を確定した戦略と説明させない', () => {
    const text = buildStage2StoryStateBlock({
      finalStoryFinal: CONFIRMED,
      finalStoryDraft: [chapter('全社戦略', '作り直した草案')],
    });
    expect(text).toContain('- 現在の草案：あり（1章。未確定。確定版ではない）');
    expect(text).toContain('未確定の内容は確定版と異なる');
    expect(text).toContain('未確定の草案を「確定した戦略」と説明しない');
    expect(text).toContain('- 下の【戦略ストーリー要約】は、現在有効な確定版（前回確定した内容）の内容。');
  });

  it('確定版がなく草案だけのときは、確定版はまだないと示し、要約は草案だと示す', () => {
    const text = buildStage2StoryStateBlock({ finalStoryDraft: [chapter('全社戦略', '草案の本文')] });
    expect(text).toContain('- 現在有効な確定版：なし（まだ確定していない）');
    expect(text).toContain('- 下の【戦略ストーリー要約】は、未確定の草案（確定版はない）の内容。');
  });

  it('草案が確定版と同じ内容なら、異なるとは言わない', () => {
    const text = buildStage2StoryStateBlock({ finalStoryFinal: CONFIRMED, finalStoryDraft: CONFIRMED });
    expect(text).toContain('未確定の内容は、確定版と同じ内容。');
    expect(text).not.toContain('異なる');
  });
});
