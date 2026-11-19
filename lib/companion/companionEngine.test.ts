import { judgeCompanion, type CompanionSnapshot } from './companionEngine';
import { buildCompanionSnapshot, type CompanionStoreFacts } from './companionSnapshot';

const READY: CompanionSnapshot = {
  ready: true,
  companyId: 'co-a',
  strategyId: 'st-a',
  role: 'admin',
  currentPath: '/stage1',
  dirty: false,
  companyNameEntered: true,
  financeEntered: true,
  issueCount: 1,
  stage2Started: true,
  stage2Generated: true,
  stage2Confirmed: true,
  departmentCount: 2,
  projectCount: 3,
  stage4Started: true,
};

describe('進行と操作の判定（プログラムで決定する）', () => {
  it('保存されていない変更があれば、次の判定より先に保存を案内する（保存済みと未保存を区別する）', () => {
    const a = judgeCompanion({ ...READY, dirty: true, companyNameEntered: false });
    expect(a?.key).toBe('SAVE_PENDING:co-a:st-a');
    expect(a?.title).toBe('未保存の変更があります');
    expect(a?.steps.length).toBeGreaterThan(0);
  });

  it.each([
    ['会社名が未入力', { companyNameEntered: false }, 'ENTER_COMPANY_NAME', 'stage1.company-name'],
    ['財務データが未入力', { financeEntered: false }, 'ENTER_FINANCE', 'stage1.finance-read-from-file'],
    ['論点が0件', { issueCount: 0, stage2Started: false }, 'ADD_ISSUE', 'stage1.add-issue'],
    ['STAGE2へ未着手', { stage2Started: false, stage2Generated: false, stage2Confirmed: false }, 'GO_STAGE2', 'stage1.go-to-stage2'],
    ['経営戦略が未生成', { stage2Generated: false, stage2Confirmed: false }, 'STAGE2_GENERATE', 'stage2.generate-final'],
    ['経営戦略が未確定', { stage2Confirmed: false }, 'STAGE2_CONFIRM', 'stage2.commit-final-strategy'],
    ['事業・部門が未追加', { departmentCount: 0, projectCount: 0, stage4Started: false }, 'STAGE3_ADD_DEPARTMENT', 'stage3.add-department'],
    ['重点プロジェクトが未選択', { projectCount: 0, stage4Started: false }, 'STAGE3_PROJECT', 'stage3.generate-department-draft'],
    ['実行計画が未作成', { stage4Started: false }, 'STAGE4_PLAN', 'stage4.generate-plan'],
  ])('%s → %s を案内する（操作手順は登録簿から）', (_label, patch, id, opId) => {
    const a = judgeCompanion({ ...READY, ...(patch as Partial<CompanionSnapshot>) });
    expect(a?.key.startsWith(`${id}:`)).toBe(true);
    expect(a?.kind).toBe('progress');
    expect(a?.steps.length).toBeGreaterThan(0);
    expect(opId).toBeTruthy();
  });

  it('すべて完了していれば、案内しない', () => {
    expect(judgeCompanion(READY)).toBeNull();
  });

  it('保存データを読めていない（ready=false）ときは、何も判定しない（未入力と誤認しない）', () => {
    expect(judgeCompanion({ ...READY, ready: false, companyNameEntered: false })).toBeNull();
  });

  it('編集権限がない利用者には、編集は管理者・管理職が行うと添える', () => {
    const a = judgeCompanion({ ...READY, role: 'member', issueCount: 0, stage2Started: false });
    expect(a?.canEdit).toBe(false);
    expect(a?.message).toContain('編集は管理者・管理職が行います');
  });

  it('案内の識別子は会社と戦略を含み、企業が違えば別の案内になる', () => {
    const a = judgeCompanion({ ...READY, issueCount: 0 });
    const b = judgeCompanion({ ...READY, issueCount: 0, companyId: 'co-b' });
    expect(a?.key).not.toBe(b?.key);
  });
});

describe('保存データの読み取り状態（取得できないものを未入力と誤認しない）', () => {
  const FACTS: CompanionStoreFacts = {
    restoreReady: true,
    loaded: true,
    fetching: false,
    hasLoadError: false,
    storeCompanyId: 'co-a',
    strategyId: 'st-a',
    dirty: false,
    currentPath: '/stage1',
    companyName: '株式会社テスト',
    financePL: [{ year: 2025, revenue: 1000, operatingIncome: 50 }],
    stage1Issues: [],
    answers12: [],
    finalStory: [],
    finalStoryDraft: [],
    finalStoryEdited: [],
    finalStoryFinal: [],
    stage3Bridge: undefined,
    departments: [],
    userId: 'user-1',
    userCompanyId: 'co-a',
    role: 'admin',
  };

  it('読み込みが完了し、会社が一致していれば判定できる', () => {
    expect(buildCompanionSnapshot(FACTS).ready).toBe(true);
  });

  it.each([
    ['読み込み中', { restoreReady: false }],
    ['読み込み未完了', { loaded: false }],
    ['サーバーから再取得中', { fetching: true }],
    ['読み込みに失敗', { hasLoadError: true }],
    ['ストアの会社が画面の会社と違う（切替中）', { storeCompanyId: 'co-old' }],
    ['戦略IDがない', { strategyId: null }],
    ['権限が判定できない', { role: null }],
    ['財務データが読み込まれていない', { financePL: undefined }],
    ['事業・部門が読み込まれていない', { departments: undefined }],
  ])('%s のときは判定しない', (_label, patch) => {
    const snap = buildCompanionSnapshot({ ...FACTS, ...(patch as Partial<CompanionStoreFacts>) });
    expect(snap.ready).toBe(false);
    expect(judgeCompanion(snap)).toBeNull();
  });

  it('論点・STAGE2の状態・STAGE3の確定・部門とプロジェクトを、保存済みの値から読む', () => {
    const snap = buildCompanionSnapshot({
      ...FACTS,
      stage1Issues: [{}, {}],
      answers12: [{ id: 'ch0-q1', answer: '回答あり' }],
      finalStory: [{ title: '危機' }],
      stage3Bridge: { strategicCore: {} },
      departments: [{ name: '営業部', projects: [{ title: 'A', planStatus: 'approved' }, { title: 'B' }] }],
    });
    expect(snap.issueCount).toBe(2);
    expect(snap.stage2Started).toBe(true);
    expect(snap.stage2Generated).toBe(true);
    expect(snap.stage2Confirmed).toBe(true);
    expect(snap.departmentCount).toBe(1);
    expect(snap.projectCount).toBe(2);
    expect(snap.stage4Started).toBe(true);
  });

  it('空白だけの会社名は未入力として扱う', () => {
    expect(buildCompanionSnapshot({ ...FACTS, companyName: '   ' }).companyNameEntered).toBe(false);
  });
});
