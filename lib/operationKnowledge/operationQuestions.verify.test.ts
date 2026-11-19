import { buildOperationGuidance, classifyQuestion } from './guidance';
import { getOperation } from './lookup';
import { OPERATIONS } from './operations';
import { pickRelevantKnowledge } from '@/lib/growthKnowledge';

/* 操作方法の質問14問（指示書の一覧）。登録簿の正しい操作が案内に含まれ、旧UIの語・存在しない操作は含まれないこと */
const CASES: { screenId: string; query: string; expectIds: string[]; expectKnowledge?: string }[] = [
  { screenId: 'home', query: 'GROWTH SHIFTは何から始めればいいですか？', expectIds: ['stage1.company-name'], expectKnowledge: 'GENERAL_OVERVIEW' },
  { screenId: 'stage1', query: '過去の財務データを修正するには？', expectIds: ['stage1.edit-finance-table'] },
  { screenId: 'stage3', query: '6問すべてに回答しないと再生成できませんか？', expectIds: ['stage3.regenerate-after-answers'] },
  { screenId: 'stage3', query: '自分でプロジェクトを追加できますか？', expectIds: ['stage3.add-project'] },
  { screenId: 'stage3', query: '部門間調整は何のために行うのですか？', expectIds: ['stage3.analyze-compare'] },
  { screenId: 'stage4', query: '実行計画のKPIを変更するには？', expectIds: ['stage4.edit-kpi'] },
  { screenId: 'stage4', query: '設備投資や追加人員の費用はどこに入力しますか？', expectIds: ['stage4.add-investment'] },
  { screenId: 'stage5', query: 'プロジェクトの売上や費用削減の実績はどこに登録しますか？', expectIds: ['stage5.register-actuals'] },
  { screenId: 'stage6', query: '達成率が表示されないのはなぜですか？', expectIds: ['stage6.read-achievement-rate'] },
  { screenId: 'stage6', query: '借入・返済計画はどこで入力しますか？', expectIds: ['stage6.open-debt-tab'] },
  { screenId: 'stage6', query: '財務計画の保存状態の警告を解消するには？', expectIds: ['stage6.save-finance-plan'] },
  { screenId: 'plan-hub', query: '銀行向け経営計画書をPDF出力するには？', expectIds: ['plan.export-pdf'] },
  { screenId: 'admin-invites', query: '社員を招待するには？', expectIds: ['admin.send-invite'] },
  { screenId: 'org-personal', query: '自分の違和感は他の社員にも公開されますか？', expectIds: ['org.choose-sharing-scope'] },
];

/* 旧画面・非表示の画面・存在しない操作の語。案内に出てはいけない */
const FORBIDDEN = [
  '内容を確認し、確認済みにする',
  '財務効果の算定根拠（任意）',
  '「効果の種類」',
  '「金額の単位」',
  '「この案を財務効果の候補にする」',
  '「フィードバック」タブ',
  '目指す状態（必須）',
  'このAI案を反映する',
  '成長KPI を追加',
  '売上を伸ばす',
  '「全体保存」（stage3',
];

const LABEL_LINE = /^- 「(.+?)」（([a-z0-9.\-]+)）:/gm;

describe('操作方法の質問14問：登録簿の正しい操作を案内し、存在しない操作を作らない', () => {
  it.each(CASES)('[$screenId] $query', ({ screenId, query, expectIds, expectKnowledge }) => {
    expect(classifyQuestion(query)).not.toBe('consult');
    const r = buildOperationGuidance({ screenId, query, role: 'admin' });
    const shown = [...r.text.matchAll(LABEL_LINE)].map((m) => m[2]);
    for (const id of expectIds) expect({ query, id, shown: shown.includes(id) }).toEqual({ query, id, shown: true });
    for (const id of shown) {
      expect({ query, id, registered: getOperation(id) !== null }).toEqual({ query, id, registered: true });
    }
    for (const phrase of FORBIDDEN) {
      expect({ query, phrase, found: r.text.includes(phrase) }).toEqual({ query, phrase, found: false });
    }
    if (expectKnowledge) {
      expect(pickRelevantKnowledge(query, 3).map((k) => k.id)).toContain(expectKnowledge);
    }
  });

  it('登録簿の全ての操作は、一意なIDと、空でない手順を持つ', () => {
    const ids = OPERATIONS.map((op) => op.operationId);
    expect(new Set(ids).size).toBe(ids.length);
    for (const op of OPERATIONS) {
      expect({ id: op.operationId, steps: op.steps.length > 0 }).toEqual({ id: op.operationId, steps: true });
    }
  });
});
