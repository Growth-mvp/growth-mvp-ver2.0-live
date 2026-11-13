/**
 * @jest-environment jsdom
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { STAGE3_SNAPSHOT_STRATEGIES } from '@/lib/stage4/planView/fixtures/stage3Snapshot';
import { generateMockExecutionPlan } from '@/lib/stage4/plan/mockGenerate';
import { RegenPanel, type RegenState } from './RegenPanel';

const CO = 'fict-co-a';
const ST = 'fict-strategy-a';

let draft: Record<string, unknown> = {};
beforeAll(async () => {
  const r = await generateMockExecutionPlan({
    strategy: JSON.parse(JSON.stringify(STAGE3_SNAPSHOT_STRATEGIES[0])),
    membershipCompanyId: CO,
    requestedStrategyId: ST,
    requestedProjectId: 'fict-proj-renewal',
    currentYm: '2026-11',
    companyName: '架空',
    createdAt: '2026-11-10T00:00:00.000Z',
  });
  if (r.status !== 'READY') throw new Error('mock draft must be ready');
  draft = r.bundle;
});

const handlers = () => ({ onUse: jest.fn(), onCancel: jest.fn() });

describe('新しいAI案：文書をそのまま見せ、選べるのは2つだけ', () => {
  it('比較の表やチェックボックスは出さず、文書と「この案を使う」「元の計画に戻る」だけを出す', () => {
    const state: RegenState = { status: 'READY', draft, previewToken: 't', notice: null };
    render(<RegenPanel state={state} {...handlers()} />);
    expect(screen.getByRole('heading', { name: '新しいAI案' })).not.toBeNull();
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0);
    expect(screen.queryByText(/新しいAI案との比較/)).toBeNull();
    expect(screen.queryByText(/選んだ項目を反映/)).toBeNull();
    expect(screen.queryByText(/section\d\./)).toBeNull();
    expect(screen.getByRole('button', { name: 'この案を使う' })).not.toBeNull();
    expect(screen.getByRole('button', { name: '元の計画に戻る' })).not.toBeNull();
  });

  it('「この案を使う」と「元の計画に戻る」は、それぞれの操作だけを呼ぶ', () => {
    const h = handlers();
    render(<RegenPanel state={{ status: 'READY', draft, previewToken: 't', notice: null }} {...h} />);
    fireEvent.click(screen.getByRole('button', { name: 'この案を使う' }));
    expect(h.onUse).toHaveBeenCalledTimes(1);
    expect(h.onCancel).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '元の計画に戻る' }));
    expect(h.onCancel).toHaveBeenCalledTimes(1);
  });

  it('案を使えなかった理由は、ボタンの近くに出す', () => {
    render(<RegenPanel state={{ status: 'READY', draft, previewToken: 't', notice: '新しい案の有効期限が切れました。' }} {...handlers()} />);
    expect(screen.getByText('新しい案の有効期限が切れました。')).not.toBeNull();
  });

  it('作成中は、保存されないことを示す。失敗時は理由を示して閉じられる', () => {
    const h = handlers();
    const { rerender } = render(<RegenPanel state={{ status: 'BUSY' }} {...h} />);
    expect(screen.getByText(/保存はされません/)).not.toBeNull();
    rerender(<RegenPanel state={{ status: 'FAILED', message: '新しい案を作れませんでした。' }} {...h} />);
    expect(screen.getByRole('alert').textContent).toBe('新しい案を作れませんでした。');
    fireEvent.click(screen.getByRole('button', { name: '閉じる' }));
    expect(h.onCancel).toHaveBeenCalledTimes(1);
  });
});
