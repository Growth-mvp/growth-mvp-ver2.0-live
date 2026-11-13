/**
 * @jest-environment jsdom
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { STAGE3_SNAPSHOT_STRATEGIES } from '@/lib/stage4/planView/fixtures/stage3Snapshot';
import { generateMockExecutionPlan } from '@/lib/stage4/plan/mockGenerate';
import { computePlanView, INITIAL_PLAN_STATE, type ProjectPlanState } from '@/lib/stage4/planView/planState';
import { EMPTY_REGULATORY } from '@/lib/stage4/planView/model';
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

const plan = (over: Partial<ProjectPlanState> = {}): ProjectPlanState => ({ ...INITIAL_PLAN_STATE, adopted: false, ...over });

function renderStart(
  target: Record<string, unknown>,
  over: { plan?: Partial<ProjectPlanState>; bodyDirty?: boolean; responsible?: string; actionNotice?: string | null } = {}
) {
  const p = plan(over.plan);
  const handlers = { onStart: jest.fn(), onBack: jest.fn() };
  render(
    <StartConfirmation
      plan={p}
      view={computePlanView(target, p)}
      bodyDirty={over.bodyDirty ?? false}
      responsible={over.responsible ?? ''}
      actionNotice={over.actionNotice ?? null}
      {...handlers}
    />
  );
  return handlers;
}

const startButton = () => screen.getByRole('button', { name: '実行を開始する' }) as HTMLButtonElement;
const nameInput = () => screen.getByLabelText('実行責任者') as HTMLInputElement;

describe('実行開始の画面：見出し・実行責任者・「実行を開始する」・「計画書に戻る」だけ', () => {
  it('表示するのは見出し「実行開始」、実行責任者、主ボタン、戻る操作だけ', () => {
    renderStart(bundleWithoutRegulatoryItems, { responsible: '佐藤（仮）' });
    expect(screen.getByRole('heading', { name: '実行開始' })).not.toBeNull();
    expect(nameInput()).not.toBeNull();
    expect(startButton()).not.toBeNull();
    expect(screen.getByRole('button', { name: '計画書に戻る' })).not.toBeNull();
    for (const word of ['現在の状態', '草案として保存', '採用', '操作の記録', '版', '確認の状況', '主要な実行条件', 'STAGE3の']) {
      expect(screen.queryByText(new RegExp(word))).toBeNull();
    }
  });

  it('実行責任者が設定済みなら、その内容を初期表示する（再入力は求めない）', () => {
    renderStart(bundleWithoutRegulatoryItems, { responsible: '佐藤（仮）' });
    expect(nameInput().value).toBe('佐藤（仮）');
    expect(startButton().disabled).toBe(false);
  });

  it('通常案件は、責任者を入れて開始するだけで開始できる', () => {
    const h = renderStart(bundleWithoutRegulatoryItems);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(startButton().disabled).toBe(true);
    fireEvent.change(nameInput(), { target: { value: '佐藤（仮）' } });
    expect(startButton().disabled).toBe(false);
    fireEvent.click(startButton());
    expect(h.onStart).toHaveBeenCalledTimes(1);
    expect(h.onStart.mock.calls[0][0]).toEqual({ responsible: '佐藤（仮）' });
  });

  it('法令・安全の項目がある案件も、語では止めず、責任者だけで開始できる', () => {
    const h = renderStart(bundle, { responsible: '佐藤（仮）' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(startButton().disabled).toBe(false);
    fireEvent.click(startButton());
    expect(h.onStart.mock.calls[0][0]).toEqual({ responsible: '佐藤（仮）' });
  });

  it('「未確認」と記録されていても、実行責任者があれば開始できる（規制の記録は開始を止めない）', () => {
    const h = renderStart(bundle, {
      responsible: '佐藤（仮）',
      plan: { regulatory: { ...EMPTY_REGULATORY, decision: 'UNCONFIRMED' } },
    });
    expect(startButton().disabled).toBe(false);
    fireEvent.click(startButton());
    expect(h.onStart.mock.calls[0][0]).toEqual({ responsible: '佐藤（仮）' });
  });

  it('実行責任者が空なら、開始できず、理由を近くに示す', () => {
    renderStart(bundleWithoutRegulatoryItems);
    expect(startButton().disabled).toBe(true);
    expect(screen.getByText('実行責任者を入力してください')).not.toBeNull();
  });

  it('計画書の本文に未保存の修正があれば、開始せず、計画書で保存するよう伝える', () => {
    renderStart(bundleWithoutRegulatoryItems, { responsible: '佐藤（仮）', bodyDirty: true });
    expect(startButton().disabled).toBe(true);
    expect(screen.getByText(/計画書の本文に未保存の修正があります/)).not.toBeNull();
  });

  it('開始の操作の結果（失敗の理由）は、ボタンの近くに残る', () => {
    renderStart(bundleWithoutRegulatoryItems, {
      responsible: '佐藤（仮）',
      actionNotice: 'まだ実行できません：正式なKPIが計画書の作成後に変わりました',
    });
    expect(screen.getByText('まだ実行できません：正式なKPIが計画書の作成後に変わりました')).not.toBeNull();
  });

  it('開始後は「実行を開始しました」と、STAGE5で進捗を確認する導線だけを出す', () => {
    renderStart(bundleWithoutRegulatoryItems, { responsible: '佐藤（仮）', plan: { adopted: true, started: true } });
    expect(screen.getByText('実行を開始しました')).not.toBeNull();
    expect(screen.getByRole('link', { name: 'STAGE5で進捗を確認する' }).getAttribute('href')).toBe('/execution');
    expect(screen.queryByRole('button', { name: '実行を開始する' })).toBeNull();
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.getByRole('button', { name: '計画書に戻る' })).not.toBeNull();
  });
});
