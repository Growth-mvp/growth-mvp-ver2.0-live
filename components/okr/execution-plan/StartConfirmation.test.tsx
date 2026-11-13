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

function renderStart(
  target: Record<string, unknown>,
  over: { plan?: Partial<ProjectPlanState>; dirty?: boolean; actionNotice?: string | null; noResponsible?: boolean } = {}
) {
  const p = plan(over.noResponsible ? { committed: {} as never, ...over.plan } : over.plan);
  const handlers = { onEdit: jest.fn(), onStart: jest.fn(), onUnstart: jest.fn(), onBack: jest.fn() };
  render(
    <StartConfirmation
      plan={p}
      view={computePlanView(target, p)}
      dirty={over.dirty ?? false}
      actionNotice={over.actionNotice ?? null}
      {...handlers}
    />
  );
  return handlers;
}

const startButton = () => screen.getByRole('button', { name: 'この計画で実行を開始する' }) as HTMLButtonElement;

describe('実行開始の画面：通常画面は、実行責任者と「この計画で実行を開始する」だけ', () => {
  it('通常案件（確認事項なし）は、法令・安全のフォームも対象外のチェックも出さず、そのまま開始できる', () => {
    const h = renderStart(bundleWithoutRegulatoryItems);
    expect(screen.queryByText('② 法令・規制・安全の確認')).toBeNull();
    expect(screen.queryByRole('checkbox')).toBeNull();
    expect(startButton().disabled).toBe(false);
    fireEvent.click(startButton());
    expect(h.onStart).toHaveBeenCalledTimes(1);
    expect(h.onStart.mock.calls[0][0]).toBeUndefined();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('通常画面から、主要な実行条件・確認の状況・確認事項の注記を外す', () => {
    renderStart(bundleWithoutRegulatoryItems);
    expect(screen.queryByText('確認の状況')).toBeNull();
    expect(screen.queryByText(/主要な実行条件/)).toBeNull();
    expect(screen.queryByText(/確認事項が .* 件残っています/)).toBeNull();
  });

  it('実行責任者が未確定なら、開始できず、その理由を近くに示す', () => {
    renderStart(bundleWithoutRegulatoryItems, { noResponsible: true });
    expect(startButton().disabled).toBe(true);
    expect(screen.getByText('実行責任者を確定してください')).not.toBeNull();
  });

  it('未保存の修正があれば、開始できず、保存へ案内する', () => {
    renderStart(bundleWithoutRegulatoryItems, { dirty: true });
    expect(startButton().disabled).toBe(true);
    expect(screen.getByText('修正が未保存です。「草案として保存」を押してから開始してください')).not.toBeNull();
  });

  it('開始の操作の結果（失敗の理由）は、ボタンの近くに残る', () => {
    renderStart(bundleWithoutRegulatoryItems, { actionNotice: 'まだ実行できません：正式なKPIが計画書の作成後に変わりました' });
    expect(screen.getByText('まだ実行できません：正式なKPIが計画書の作成後に変わりました')).not.toBeNull();
  });

  it('開始後は「実行中」と、STAGE5で進捗を確認する導線を出す（開始のボタンは出さない）', () => {
    const notApplicable: RegulatoryRecord = { ...EMPTY_REGULATORY, decision: 'NOT_APPLICABLE' };
    renderStart(bundleWithoutRegulatoryItems, { plan: { adopted: true, started: true, regulatory: notApplicable } });
    expect(screen.getByText('実行中')).not.toBeNull();
    expect(screen.getByRole('link', { name: 'STAGE5で進捗を確認する' }).getAttribute('href')).toBe('/execution');
    expect(screen.queryByRole('button', { name: 'この計画で実行を開始する' })).toBeNull();
  });
});

describe('法令・規制・安全の確認：確認事項がある案件だけ、開始の前に簡潔な確認を求める', () => {
  it('確認事項がある案件は、開始のボタンで確認ダイアログを開く（記録が無いうちは開始しない）', () => {
    const h = renderStart(bundle);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(startButton().disabled).toBe(false);
    fireEvent.click(startButton());
    expect(screen.getByRole('dialog')).not.toBeNull();
    expect(screen.getByText('法令・規制・安全の確認')).not.toBeNull();
    expect(h.onStart).not.toHaveBeenCalled();
  });

  it('対象外だけでは確認できない（判断・根拠・確認者・確認日が要る）', () => {
    const h = renderStart(bundle);
    fireEvent.click(startButton());
    fireEvent.click(screen.getByRole('radio', { name: '適用なし' }));
    const confirm = screen.getByRole('button', { name: '確認して開始する' }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    expect(h.onStart).not.toHaveBeenCalled();
  });

  it('必要事項を入力して確認すると、判断の内容を添えて開始する', () => {
    const h = renderStart(bundle);
    fireEvent.click(startButton());
    fireEvent.click(screen.getByRole('radio', { name: '適用なし' }));
    fireEvent.change(screen.getByLabelText(/判断の内容/), { target: { value: '医療機器の製造販売には当たらない' } });
    fireEvent.change(screen.getByLabelText('確認者'), { target: { value: '法務 山田' } });
    fireEvent.change(screen.getByLabelText('確認日'), { target: { value: '2026-11-08' } });
    fireEvent.change(screen.getByLabelText(/判断根拠/), { target: { value: '社内の該当性チェック表' } });
    const confirm = screen.getByRole('button', { name: '確認して開始する' }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(false);
    fireEvent.click(confirm);
    expect(h.onStart).toHaveBeenCalledTimes(1);
    expect(h.onStart.mock.calls[0][0]).toEqual(
      expect.objectContaining({ decision: 'NOT_APPLICABLE', judgement: '医療機器の製造販売には当たらない', confirmer: '法務 山田' })
    );
  });

  it('確認を戻ると、開始せずに閉じる（未確認を勝手に決めない）', () => {
    const h = renderStart(bundle);
    fireEvent.click(startButton());
    fireEvent.click(screen.getByRole('button', { name: '戻る' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(h.onStart).not.toHaveBeenCalled();
  });

  it('既に確認が記録されている案件は、開始のボタンで確認を重ねず、そのまま開始する', () => {
    const recorded: RegulatoryRecord = {
      decision: 'NOT_APPLICABLE',
      judgement: '医療機器に当たらない',
      confirmer: '法務 山田',
      confirmedOn: '2026-11-08',
      basis: '社内の該当性チェック表',
    };
    const h = renderStart(bundle, { plan: { regulatory: recorded } });
    fireEvent.click(startButton());
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(h.onStart).toHaveBeenCalledTimes(1);
  });

  it('確認事項の無い案件で「未確認」と記録されていれば、開始のボタンで判断を記録する', () => {
    const h = renderStart(bundleWithoutRegulatoryItems, { plan: { regulatory: { ...EMPTY_REGULATORY, decision: 'UNCONFIRMED' } } });
    expect(screen.getByText(/「未確認」と記録されているため、開始を保留しています/)).not.toBeNull();
    fireEvent.click(startButton());
    fireEvent.click(screen.getByRole('radio', { name: '適用なし' }));
    fireEvent.click(screen.getByRole('button', { name: '確認して開始する' }));
    expect(h.onStart.mock.calls[0][0]).toEqual(expect.objectContaining({ decision: 'NOT_APPLICABLE' }));
  });
});
