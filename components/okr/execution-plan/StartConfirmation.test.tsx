/**
 * @jest-environment jsdom
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { STAGE3_SNAPSHOT_STRATEGIES } from '@/lib/stage4/planView/fixtures/stage3Snapshot';
import { generateMockExecutionPlan } from '@/lib/stage4/plan/mockGenerate';
import { computePlanView, INITIAL_PLAN_STATE, type ProjectPlanState } from '@/lib/stage4/planView/planState';
import { EMPTY_REGULATORY, type RegulatoryRecord } from '@/lib/stage4/planView/model';
import StartConfirmation from './StartConfirmation';

const CO = 'fict-co-a';
const ST = 'fict-strategy-a';
const PROJ = 'fict-proj-renewal';

let bundle: Record<string, unknown> = {};
let bundleWithoutRegulatoryItems: Record<string, unknown> = {};
beforeAll(async () => {
  const r = await generateMockExecutionPlan({
    strategy: JSON.parse(JSON.stringify(STAGE3_SNAPSHOT_STRATEGIES[0])),
    membershipCompanyId: CO,
    requestedStrategyId: ST,
    requestedProjectId: PROJ,
    currentYm: '2026-11',
    companyName: '架空',
    createdAt: '2026-11-10T00:00:00.000Z',
  });
  if (r.status !== 'READY') throw new Error('mock draft must be ready');
  bundle = r.bundle;
  bundleWithoutRegulatoryItems = JSON.parse(
    JSON.stringify(bundle).replace(/規制|法令|薬機|医療機器|安全|認証|許認可|コンプライアンス/g, '運用')
  );
});

const plan = (over: Partial<ProjectPlanState> = {}): ProjectPlanState => ({
  ...INITIAL_PLAN_STATE,
  committed: { responsible: '佐藤（仮）' } as never,
  adopted: false,
  ...over,
});

function renderStart(target: Record<string, unknown>, over: { plan?: Partial<ProjectPlanState>; dirty?: boolean; actionNotice?: string | null } = {}) {
  const p = plan(over.plan);
  const handlers = { onEdit: jest.fn(), onRegulatory: jest.fn(), onStart: jest.fn(), onUnstart: jest.fn(), onBack: jest.fn() };
  render(
    <StartConfirmation
      bundle={target}
      plan={p}
      view={computePlanView(target, p)}
      dirty={over.dirty ?? false}
      actionNotice={over.actionNotice ?? null}
      {...handlers}
    />
  );
  return handlers;
}

describe('実行開始の画面：操作は「この計画で実行を開始する」1つ', () => {
  it('規制・安全の項目が無い案件は、対象外にチェックを入れるだけで開始できる（判断の入力は求めない）', () => {
    const h = renderStart(bundleWithoutRegulatoryItems);
    expect(screen.queryByText('判断の内容（適用なしの場合は、その理由）')).toBeNull();
    const check = screen.getByRole('checkbox', { name: /対象外として記録する/ });
    const button = screen.getByRole('button', { name: 'この計画で実行を開始する' });
    expect((button) as HTMLButtonElement).toHaveProperty('disabled', true);
    expect(screen.getByText('②で「対象外」にチェックを入れてください')).not.toBeNull();
    fireEvent.click(check);
    expect(h.onRegulatory).toHaveBeenCalledWith(expect.objectContaining({ decision: 'NOT_APPLICABLE' }));
  });

  it('対象外が選ばれていれば、開始の操作を呼べる', () => {
    const notApplicable: RegulatoryRecord = { ...EMPTY_REGULATORY, decision: 'NOT_APPLICABLE' };
    const h = renderStart(bundleWithoutRegulatoryItems, { plan: { regulatory: notApplicable } });
    const button = screen.getByRole('button', { name: 'この計画で実行を開始する' });
    expect((button) as HTMLButtonElement).toHaveProperty('disabled', false);
    fireEvent.click(button);
    expect(h.onStart).toHaveBeenCalledTimes(1);
  });

  it('規制・安全の項目がある案件は、判断・根拠・確認者・確認日を求める（対象外だけでは開始できない）', () => {
    renderStart(bundle, { plan: { regulatory: { ...EMPTY_REGULATORY, decision: 'NOT_APPLICABLE' } } });
    expect(screen.getByText('判断の内容（適用なしの場合は、その理由）')).not.toBeNull();
    expect((screen.getByRole('button', { name: 'この計画で実行を開始する' })) as HTMLButtonElement).toHaveProperty('disabled', true);
    expect(screen.getByText('②で判断内容・判断根拠・確認者・確認日を入力してください')).not.toBeNull();
  });

  it('主要な実行条件の一覧と、確認の状況の一覧は、開始の画面に出さない', () => {
    renderStart(bundleWithoutRegulatoryItems);
    expect(screen.queryByText('③ 主要な実行条件')).toBeNull();
    expect(screen.queryByText('確認の状況')).toBeNull();
  });

  it('未保存の修正があれば、開始できず、その理由を近くに示す', () => {
    renderStart(bundleWithoutRegulatoryItems, {
      plan: { regulatory: { ...EMPTY_REGULATORY, decision: 'NOT_APPLICABLE' } },
      dirty: true,
    });
    expect((screen.getByRole('button', { name: 'この計画で実行を開始する' })) as HTMLButtonElement).toHaveProperty('disabled', true);
    expect(screen.getByText('修正が未保存です。「草案として保存」を押してから開始してください')).not.toBeNull();
  });

  it('開始の操作の結果（失敗の理由）は、ボタンの近くに残る', () => {
    renderStart(bundleWithoutRegulatoryItems, {
      plan: { regulatory: { ...EMPTY_REGULATORY, decision: 'NOT_APPLICABLE' } },
      actionNotice: 'まだ実行できません：正式なKPIが計画書の作成後に変わりました',
    });
    expect(screen.getByText('まだ実行できません：正式なKPIが計画書の作成後に変わりました')).not.toBeNull();
  });

  it('開始後は「実行中」と、STAGE5で進捗を確認する導線を出す', () => {
    const notApplicable: RegulatoryRecord = { ...EMPTY_REGULATORY, decision: 'NOT_APPLICABLE' };
    renderStart(bundleWithoutRegulatoryItems, { plan: { adopted: true, started: true, regulatory: notApplicable } });
    expect(screen.getByText('実行中（開始済み）')).not.toBeNull();
    const link = screen.getByRole('link', { name: 'STAGE5で進捗を確認する' });
    expect(link.getAttribute('href')).toBe('/execution');
    expect(screen.queryByRole('button', { name: 'この計画で実行を開始する' })).toBeNull();
  });
});
