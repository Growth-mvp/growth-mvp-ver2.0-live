import { useSelectedProjectStore, type SelectedProject } from './selectedProjectStore';

const SEL: SelectedProject = {
  companyId: 'c1',
  strategyId: 's1',
  departmentId: 'd1',
  projectId: 'p1',
  projectTitle: '配送の効率化',
  departmentName: '宅配事業',
};
const TARGET = { companyId: 'c1', strategyId: 's1', departmentId: 'd1', projectId: 'p1' };

describe('選択中の案件と入力案の持ち越し防止', () => {
  beforeEach(() => {
    useSelectedProjectStore.getState().setSelection(null);
    useSelectedProjectStore.getState().clearDraft();
  });

  it('同じ案件の入力案は、選択を更新しても残る', () => {
    useSelectedProjectStore.getState().setSelection(SEL);
    useSelectedProjectStore.getState().setDraft(TARGET, '案');
    useSelectedProjectStore.getState().setSelection({ ...SEL, projectTitle: '名称の更新' });
    expect(useSelectedProjectStore.getState().draft?.text).toBe('案');
  });

  it('別の案件に切り替えたら入力案を破棄する', () => {
    useSelectedProjectStore.getState().setSelection(SEL);
    useSelectedProjectStore.getState().setDraft(TARGET, '案');
    useSelectedProjectStore.getState().setSelection({ ...SEL, projectId: 'p2' });
    expect(useSelectedProjectStore.getState().draft).toBeNull();
  });

  it('会社が変わったら入力案を破棄する（別会社へ持ち越さない）', () => {
    useSelectedProjectStore.getState().setSelection(SEL);
    useSelectedProjectStore.getState().setDraft(TARGET, '案');
    useSelectedProjectStore.getState().setSelection({ ...SEL, companyId: 'c2', strategyId: 's2' });
    expect(useSelectedProjectStore.getState().draft).toBeNull();
  });

  it('選択を外したら入力案を破棄する', () => {
    useSelectedProjectStore.getState().setSelection(SEL);
    useSelectedProjectStore.getState().setDraft(TARGET, '案');
    useSelectedProjectStore.getState().setSelection(null);
    expect(useSelectedProjectStore.getState().draft).toBeNull();
  });

  it('同じ内容の入力案を作り直すと、反映の番号が進む', () => {
    useSelectedProjectStore.getState().setDraft(TARGET, '案');
    const first = useSelectedProjectStore.getState().draft?.nonce ?? 0;
    useSelectedProjectStore.getState().setDraft(TARGET, '案');
    expect(useSelectedProjectStore.getState().draft?.nonce).toBe(first + 1);
  });
});
