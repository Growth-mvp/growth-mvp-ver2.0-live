/**
 * @jest-environment jsdom
 */
import { render, screen } from '@testing-library/react';
import { StrategyBookDocument, type DocProject, type StrategyDocumentProps } from './StrategyBookDocument';

const official: DocProject = {
  title: '既存顧客の再受注施策',
  origin: 'official',
  group: 'existing',
  objective: '再受注を増やす',
  purpose: '既存顧客の再発注を増やす',
  hypothesis: '点検の提案で稼働率が上がる',
  summary: null,
  partner: null,
  goals: ['再受注率 40%'],
};

const candidate: DocProject = {
  title: '新市場の探索',
  origin: 'candidate',
  group: 'new',
  objective: null,
  purpose: null,
  hypothesis: null,
  summary: '草案の要約',
  partner: '開発部',
  goals: [],
};

const base: StrategyDocumentProps = {
  departmentName: '営業部',
  versionLabel: '版 1・AIたたき台・未確定',
  mission: '既存顧客の深耕',
  strategicRole: '既存顧客の再発注を支える',
  keyIssues: ['再発注の手間', '提案の速さ'],
  projects: [official, candidate],
  interCollab: ['開発部と協働する'],
  adjustmentPoints: ['在庫の確保'],
};

describe('StrategyBookDocument（事業・部門戦略書の読み物）', () => {
  it('使命・役割・重点課題・勝ち筋を、見出しの付いた文章で出す', () => {
    render(<StrategyBookDocument {...base} />);
    expect(screen.getByText('営業部の戦略書')).toBeTruthy();
    expect(screen.getByText('版 1・AIたたき台・未確定')).toBeTruthy();
    expect(screen.getByText('事業・部門の使命')).toBeTruthy();
    expect(screen.getByText('既存顧客の深耕')).toBeTruthy();
    expect(screen.getByText('全社戦略における役割')).toBeTruthy();
    expect(screen.getByText('重点課題と勝ち筋')).toBeTruthy();
    expect(screen.getByText('提案の速さ')).toBeTruthy();
  });

  it('重点プロジェクトは目的・選定理由・成果仮説・目標を出し、既存と新規候補を区別する', () => {
    const { container } = render(<StrategyBookDocument {...base} />);
    expect(screen.getByText('目的')).toBeTruthy();
    expect(screen.getByText('再受注を増やす')).toBeTruthy();
    expect(screen.getByText('選定理由')).toBeTruthy();
    expect(screen.getByText('成果仮説')).toBeTruthy();
    expect(screen.getByText('点検の提案で稼働率が上がる')).toBeTruthy();
    expect(screen.getByText('再受注率 40%')).toBeTruthy();
    expect(screen.getByText('既存のプロジェクト')).toBeTruthy();
    expect(screen.getByText('新規候補（採用前）')).toBeTruthy();
    expect(container.textContent).toContain('連携先');
  });

  it('草案だけの候補は、選定理由や仮説を補完せず、要約だけを概要として出す', () => {
    render(<StrategyBookDocument {...base} projects={[candidate]} />);
    expect(screen.getByText('概要')).toBeTruthy();
    expect(screen.getByText('草案の要約')).toBeTruthy();
    expect(screen.queryByText('選定理由')).toBeNull();
    expect(screen.queryByText('成果仮説')).toBeNull();
  });

  it('データが無い項目は見出しごと出さず、「未設定」などで埋めない', () => {
    const { container } = render(
      <StrategyBookDocument
        {...base}
        mission={null}
        strategicRole={null}
        keyIssues={[]}
        projects={[]}
        interCollab={[]}
        adjustmentPoints={[]}
      />,
    );
    expect(screen.queryByText('事業・部門の使命')).toBeNull();
    expect(screen.queryByText('重点プロジェクト')).toBeNull();
    expect(screen.queryByText('他の事業・部門との連携・調整論点')).toBeNull();
    expect(container.textContent).not.toContain('未設定');
  });

  it('他部門との連携と調整論点を分けて出す', () => {
    render(<StrategyBookDocument {...base} />);
    expect(screen.getByText('他の事業・部門との連携・調整論点')).toBeTruthy();
    expect(screen.getByText('開発部と協働する')).toBeTruthy();
    expect(screen.getByText('在庫の確保')).toBeTruthy();
  });
});
