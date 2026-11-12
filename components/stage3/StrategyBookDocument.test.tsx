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
  versionLabel: '版 1・6問反映後の再生成版・未確定',
  texts: {
    mission: ['既存顧客の深耕'],
    missionDescription: ['保守契約の継続を支える'],
    currentPosition: ['成熟した主力事業'],
    strategicRole: ['既存顧客の再発注を支える'],
    keyIssues: ['再発注の手間', '提案の速さ'],
    intraCollab: ['保守チームと日程を共有する'],
    interCollab: ['開発部と協働する'],
    alignmentRiskPoints: ['価格の認識がずれやすい'],
    reviewSummary: ['在庫の確保を再検討する'],
    stopList: ['新規の大口案件は受けない'],
    riskNotes: ['為替の影響を注記する'],
  },
  projects: [official, candidate],
};

describe('StrategyBookDocument（事業・部門戦略書の読み物）', () => {
  it('使命・概要・現在の位置づけ・役割・重点課題を章ごとに出す', () => {
    render(<StrategyBookDocument {...base} />);
    expect(screen.getByText('版 1・6問反映後の再生成版・未確定')).toBeTruthy();
    expect(screen.getByText('事業・部門の使命')).toBeTruthy();
    expect(screen.getByText('既存顧客の深耕')).toBeTruthy();
    expect(screen.getByText('概要・仮説')).toBeTruthy();
    expect(screen.getByText('保守契約の継続を支える')).toBeTruthy();
    expect(screen.getByText('現在の位置づけ')).toBeTruthy();
    expect(screen.getByText('全社戦略における役割')).toBeTruthy();
    expect(screen.getByText('重点課題と勝ち筋')).toBeTruthy();
    expect(screen.getByText('提案の速さ')).toBeTruthy();
  });

  it('後工程で使う項目（注意点・停止事項・リスク注記など）も、どこかの章に表示する', () => {
    render(<StrategyBookDocument {...base} />);
    expect(screen.getByText('注意点・再考ポイント')).toBeTruthy();
    expect(screen.getByText('認識のズレが起きやすいポイント')).toBeTruthy();
    expect(screen.getByText('価格の認識がずれやすい')).toBeTruthy();
    expect(screen.getByText('停止事項')).toBeTruthy();
    expect(screen.getByText('新規の大口案件は受けない')).toBeTruthy();
    expect(screen.getByText('リスク注記')).toBeTruthy();
    expect(screen.getByText('為替の影響を注記する')).toBeTruthy();
  });

  it('事業内の連携と他事業との連携を分けて出す', () => {
    render(<StrategyBookDocument {...base} />);
    expect(screen.getByText('事業内・部門内の連携')).toBeTruthy();
    expect(screen.getByText('保守チームと日程を共有する')).toBeTruthy();
    expect(screen.getByText('他の事業・部門との連携')).toBeTruthy();
    expect(screen.getByText('開発部と協働する')).toBeTruthy();
  });

  it('重点プロジェクトは目的・選定理由・成果仮説・目標を出し、既存と新規候補を区別する', () => {
    render(<StrategyBookDocument {...base} />);
    expect(screen.getByText('重点プロジェクト')).toBeTruthy();
    expect(screen.getByText('再受注を増やす')).toBeTruthy();
    expect(screen.getByText('既存顧客の再発注を増やす')).toBeTruthy();
    expect(screen.getByText('点検の提案で稼働率が上がる')).toBeTruthy();
    expect(screen.getByText('再受注率 40%')).toBeTruthy();
    expect(screen.getByText('既存のプロジェクト')).toBeTruthy();
    expect(screen.getByText('新規候補（採用前）')).toBeTruthy();
  });

  it('内容が無い項目は見出しごと出さず、「未設定」などで埋めない', () => {
    const { container } = render(<StrategyBookDocument {...base} texts={{ mission: ['使命だけ'] }} projects={[]} />);
    expect(screen.getByText('事業・部門の使命')).toBeTruthy();
    expect(screen.queryByText('全社戦略における役割')).toBeNull();
    expect(screen.queryByText('重点プロジェクト')).toBeNull();
    expect(screen.queryByText('注意点・再考ポイント')).toBeNull();
    expect(container.textContent).not.toContain('未設定');
  });

  it('編集中の項目は、本文の代わりに編集欄を出す（読む表示と編集を切り替える）', () => {
    render(
      <StrategyBookDocument
        {...base}
        edit={{
          strategicRole: {
            action: null,
            editor: <textarea aria-label="役割の編集" defaultValue="編集中の役割" />,
          },
        }}
      />,
    );
    expect(screen.getByLabelText('役割の編集')).toBeTruthy();
    expect(screen.queryByText('既存顧客の再発注を支える')).toBeNull();
  });
});
