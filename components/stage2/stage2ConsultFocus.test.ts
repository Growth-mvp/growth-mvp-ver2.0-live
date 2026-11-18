import { ConsultFocusSchema } from '@/lib/consult/consultFocus';
import {
  buildFinalDocumentConsultFocus,
  buildQuestionsConsultFocus,
  buildSwotConsultFocus,
} from './stage2ConsultFocus';

const long = (n: number) => 'あ'.repeat(n);

describe('buildSwotConsultFocus', () => {
  it('項目を4件にし、長い値は検証上限に収まるよう切り詰める', () => {
    const focus = buildSwotConsultFocus({
      strength: long(2000),
      weakness: '弱み',
      opportunity: '',
      threat: '脅威',
      saved: false,
    });
    const parsed = ConsultFocusSchema.safeParse({ ...focus, pathname: '/stage2' });
    expect(parsed.success).toBe(true);
    expect(focus.items).toHaveLength(4);
    expect(focus.items?.[0].value.length).toBe(600);
    expect(focus.items?.every((i) => i.saved === false)).toBe(true);
  });
});

describe('buildQuestionsConsultFocus', () => {
  it('長い回答は draft の上限内に切り詰め、深掘りとたたき台を項目に含める', () => {
    const focus = buildQuestionsConsultFocus({
      question: { id: 'ch0-q1', title: '危機認識', intent: '理由' },
      answer: long(5000),
      answeredCount: 3,
      total: 12,
      deepDive: { question: '追加の問い', answer: '回答' },
      storyDraft: [
        { title: '第1章', body: long(900) },
        { title: '第2章', body: '本文' },
      ],
      saved: true,
    });
    const parsed = ConsultFocusSchema.safeParse({ ...focus, pathname: '/stage2' });
    expect(parsed.success).toBe(true);
    expect(focus.draft?.text.length).toBe(1200);
    expect(focus.draft?.saved).toBe(true);
    expect(focus.items?.map((i) => i.label)).toEqual([
      '入力済み',
      'AI深掘りの問い',
      'AI深掘りへの回答',
      '第1章：なぜ今、変わる必要があるのか',
      '第2章：どう戦うのか',
    ]);
    expect(focus.items?.[0].value).toBe('3/12');
  });

  it('深掘りが無い場合は件数とたたき台だけを項目にする', () => {
    const focus = buildQuestionsConsultFocus({
      question: { id: 'ch1-q3', title: '質問' },
      answer: '',
      answeredCount: 0,
      total: 12,
      storyDraft: [],
      saved: false,
    });
    expect(focus.items).toEqual([{ label: '入力済み', value: '0/12', saved: false }]);
  });
});

describe('buildFinalDocumentConsultFocus', () => {
  const chapters = [
    { title: '第1章', body: '本文1' },
    { title: '', body: '本文2' },
  ];

  it('表示中は保存状態を反映し、本文の編集内容は draft に入れない', () => {
    const focus = buildFinalDocumentConsultFocus({
      editing: false,
      chapters,
      conclusion: '結論',
      finalized: true,
      saved: true,
      lastEdited: null,
    });
    expect(focus?.section).toBe('経営戦略書');
    expect(focus?.draft).toBeUndefined();
    expect(focus?.items?.[0]).toEqual({ label: '結論', value: '結論', saved: true });
    expect(focus?.items?.[1].value).toBe('確定済み');
    // 空の章タイトルでも検証が落ちないようラベルを補う
    expect(focus?.items?.[3].label).toBe('第2章');
    expect(ConsultFocusSchema.safeParse({ ...focus, pathname: '/stage2' }).success).toBe(true);
  });

  it('編集中はすべて未保存とし、最後に編集した章を draft にする', () => {
    const focus = buildFinalDocumentConsultFocus({
      editing: true,
      chapters: [{ title: '第1章', body: '編集後の本文' }],
      conclusion: '結論',
      finalized: false,
      saved: true,
      lastEdited: { kind: 'chapter', index: 0 },
    });
    expect(focus?.section).toBe('経営戦略書（編集中：第1章）');
    expect(focus?.draft).toEqual({ text: '編集後の本文', saved: false });
    expect(focus?.items?.every((i) => i.saved === false)).toBe(true);
  });

  it('編集中で結論を最後に編集した場合は結論を draft にする', () => {
    const focus = buildFinalDocumentConsultFocus({
      editing: true,
      chapters,
      conclusion: '編集後の結論',
      finalized: false,
      saved: true,
      lastEdited: { kind: 'conclusion' },
    });
    expect(focus?.draft).toEqual({ text: '編集後の結論', saved: false });
  });

  it('表示する内容が無い場合は登録しない', () => {
    expect(
      buildFinalDocumentConsultFocus({
        editing: false,
        chapters: [],
        conclusion: '',
        finalized: false,
        saved: true,
        lastEdited: null,
      }),
    ).toBeNull();
  });
});
