import {
  buildConfirmedDocumentEdits,
  findUnconfirmedChanges,
  resolveStrategicAssumptions,
  withMidtermSnapshot,
  withStoredConfirmedRecord,
} from './finalDocument';
import type { StoryChapter, MidtermStrategy, StrategicAssumptions } from '@/types/strategy';

const chapters: StoryChapter[] = [
  { title: '第1章', body: '売上は2030年度に伸ばす。' },
  { title: '第2章', body: '顧客を絞り込む。' },
];
const computed: StrategicAssumptions = { external: ['市場は縮小'], internal: ['人材が不足'], implications: ['投資は絞る'] };
const midterm = {
  targetVisionForMidterm: '地域No.1',
  priorityStrategicThemes: ['顧客基盤'],
  companyWideDecisionCriteria: ['利益率'],
  deploymentPrinciplesForUnits: ['部門で決める'],
} as unknown as MidtermStrategy;

describe('本文を編集していないのに未確定にならない', () => {
  it('確定直後の状態（前提は計算値、中計あり）は未確定にならない', () => {
    const edits = buildConfirmedDocumentEdits({
      edits: {},
      aiGeneratedConclusion: '結論A',
      assumptions: computed,
      confirmedAt: '2026-11-18T00:00:00.000Z',
    });
    const result = findUnconfirmedChanges({
      finalStoryFinal: chapters,
      finalStoryEdited: chapters,
      edits: withMidtermSnapshot(edits, midterm),
      midtermStrategy: midterm,
      aiGeneratedConclusion: '結論A',
    });
    expect(result).toEqual({ chapters: false, document: false, midtermStrategy: false });
  });

  it('保存と再読込の後も、本文を変えていなければ未確定にならない', () => {
    const confirmed = buildConfirmedDocumentEdits({
      edits: {},
      aiGeneratedConclusion: '結論A',
      assumptions: computed,
      confirmedAt: '2026-11-18T00:00:00.000Z',
    });
    const saved = withStoredConfirmedRecord(withMidtermSnapshot(confirmed, midterm), confirmed);
    const reloaded = JSON.parse(JSON.stringify(saved));
    const result = findUnconfirmedChanges({
      finalStoryFinal: chapters,
      finalStoryEdited: JSON.parse(JSON.stringify(chapters)),
      edits: reloaded,
      midtermStrategy: midterm,
      aiGeneratedConclusion: '結論A',
    });
    expect(result).toEqual({ chapters: false, document: false, midtermStrategy: false });
  });

  it('AIの結論が画面に読み込まれていなくても、利用者が結論を変えていなければ未確定にならない', () => {
    const confirmed = buildConfirmedDocumentEdits({
      edits: {},
      aiGeneratedConclusion: '結論A',
      assumptions: computed,
      confirmedAt: '2026-11-18T00:00:00.000Z',
    });
    const result = findUnconfirmedChanges({
      finalStoryFinal: chapters,
      finalStoryEdited: chapters,
      edits: withMidtermSnapshot(confirmed, midterm),
      midtermStrategy: midterm,
      aiGeneratedConclusion: undefined,
    });
    expect(result.document).toBe(false);
  });

  it('前提を画面で表示するために補完しても、利用者が変えていなければ未確定にならない', () => {
    const confirmed = buildConfirmedDocumentEdits({
      edits: {},
      aiGeneratedConclusion: '結論A',
      assumptions: computed,
      confirmedAt: '2026-11-18T00:00:00.000Z',
    });
    const viewAssumptions = resolveStrategicAssumptions(undefined, computed);
    const edits = { ...confirmed, assumptions: viewAssumptions };
    const result = findUnconfirmedChanges({
      finalStoryFinal: chapters,
      finalStoryEdited: chapters,
      edits,
      midtermStrategy: midterm,
      aiGeneratedConclusion: '結論A',
    });
    expect(result.document).toBe(false);
  });
});
