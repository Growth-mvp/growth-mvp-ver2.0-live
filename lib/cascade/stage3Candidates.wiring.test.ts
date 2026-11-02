/* STAGE3 画面の配線（静的確認）。生成は候補だけを作り、計画を書き換えない。追加・反映は専用APIを通す。 */
import { readFileSync } from 'fs';
import { join } from 'path';

const page = readFileSync(join(__dirname, '../../app/cascade/page.tsx'), 'utf8');

function section(startMarker: string, endMarker: string): string {
  const start = page.indexOf(startMarker);
  const end = page.indexOf(endMarker, start + startMarker.length);
  if (start < 0 || end < 0) throw new Error(`section not found: ${startMarker}`);
  return page.slice(start, end);
}

const generation = section('  const handleDeptCascadeDraft = async', '  const discardStage3Candidate = ');
const writes = section('  const discardStage3Candidate = ', '  /* ===== ビジュアルビュー ===== */');
const adoption = section('  const handleAdoptStage3Candidate = async', '  const handleApplyDeptProposal = async');
const proposalApply = section('  const handleApplyDeptProposal = async', '  /* ===== ビジュアルビュー ===== */');
const refresh = section('  const refreshAfterWrite = async', '  const handleAdoptStage3Candidate = async');

describe('再生成（候補生成）は計画を書き換えない', () => {
  it('生成処理は保存・計画の更新・後始末APIを呼ばない', () => {
    expect(generation).not.toMatch(/pushToStore\(/);
    expect(generation).not.toMatch(/saveNow/);
    expect(generation).not.toMatch(/\/api\/cascade\//);
  });

  it('生成結果は未採用の候補（プロジェクト案）と変更案に分けて状態に置く', () => {
    expect(generation).toMatch(/applyDeptDraftToProjects\(\[\], cleanedRd, false, dept\.name\)/);
    expect(generation).toMatch(/buildDeptProposals\(liveDept/);
    expect(generation).toMatch(/setStage3Candidates\(/);
  });

  it('旧方式の全面置換・既存判定の停止・旧後始末の呼び出しは残っていない', () => {
    expect(page).not.toMatch(/assessDepartmentRegen|regenGuard|findLocalStage4Data|regenBlockMessage/);
    expect(page).not.toMatch(/cleanup-deleted-projects/);
    expect(page).not.toMatch(/pendingCleanupIds|runStage3Cleanup|allOldProjectIds/);
  });

  it('会社が切り替わった結果は表示せず、既存のスコープ確認を使う', () => {
    expect(generation).toMatch(/isSaveScopeCurrent\(regenScope\)/);
  });

  it('生成ボタン（たたき台を生成・回答を反映して再生成）は両方残っている', () => {
    expect(page).toMatch(/handleDeptCascadeDraft\(index, 'draft'\)/);
    expect(page).toMatch(/handleDeptCascadeDraft\(index, 'regen'\)/);
  });
});

describe('プロジェクト案の追加は、専用APIを通し、保存済みの revision を送る', () => {
  it('追加は /api/cascade/adopt-candidate を使い、revision は保存済みの値を送る', () => {
    expect(adoption).toMatch(/authFetchJson\('\/api\/cascade\/adopt-candidate'/);
    expect(adoption).toMatch(/expectedRevision: gate\.revision/);
    expect(writes).toMatch(/typeof st\.revision !== 'number'/);
  });

  it('画面のローカル状態に先に書かず、サーバーが受け付けてから再取得する', () => {
    expect(adoption).not.toMatch(/pushToStore\(/);
    expect(refresh).toMatch(/refetchFromServer\(\)/);
  });

  it('権限・会社切替・未保存の変更・同時実行を確認してから送る', () => {
    expect(writes).toMatch(/canEditDept\(\)/);
    expect(writes).toMatch(/isSaveScopeCurrent\(entry\.scope\)/);
    expect(writes).toMatch(/isSameCandidateScope/);
    expect(writes).toMatch(/st\.dirty/);
    expect(adoption).toMatch(/adoptingCandidateIdsRef\.current\.has\(key\)/);
  });

  it('競合（revision_changed）では案を残し、既存データを上書きしない', () => {
    const conflict = adoption.slice(adoption.indexOf("code === 'revision_changed'"));
    expect(conflict.slice(0, 300)).toMatch(/案は残しています/);
    expect(conflict.slice(0, 300)).not.toMatch(/discardStage3Candidate/);
  });

  it('二重追加（duplicate_project_id）は案を外して、追加済みとして伝える', () => {
    const dup = adoption.slice(adoption.indexOf("code === 'duplicate_project_id'"));
    expect(dup.slice(0, 200)).toMatch(/discardStage3Candidate/);
  });

  it('応答を失った場合の再送は、サーバーの重複拒否で二重追加にならない（画面側の検知）', () => {
    expect(adoption).toMatch(/code === 'duplicate_project_id'/);
  });
});

describe('部門戦略の変更案は、利用者が選んだ項目だけ専用APIで反映する', () => {
  it('反映は /api/cascade/apply-department-proposal を使い、既存値（base）を送る', () => {
    expect(proposalApply).toMatch(/authFetchJson\('\/api\/cascade\/apply-department-proposal'/);
    expect(proposalApply).toMatch(/base: proposal\.base/);
    expect(proposalApply).toMatch(/value: proposal\.proposed/);
  });

  it('反映は画面のローカル状態に先に書かない', () => {
    expect(proposalApply).not.toMatch(/pushToStore\(/);
  });

  it('既存値が変わっていた場合は案を破棄し、既存の値を上書きしない', () => {
    const changed = proposalApply.slice(proposalApply.indexOf("code === 'current_value_changed'"));
    expect(changed.slice(0, 200)).toMatch(/discardStage3Proposal/);
    expect(changed.slice(0, 300)).toMatch(/反映しませんでした/);
  });

  it('比較の表示があり、既存値が変わっている案は反映できない', () => {
    expect(page).toMatch(/現在の値/);
    expect(page).toMatch(/AIの案/);
    expect(page).toMatch(/disabled=\{!editableDept \|\| isHydrating \|\| stale\}/);
  });
});

describe('保存成功後の再取得の失敗を、失敗と誤表示しない', () => {
  it('成功の表示を先に出し、再取得の失敗は成功の表示を消さずに別に知らせる', () => {
    expect(refresh.indexOf('setNotice(successMessage)')).toBeGreaterThan(-1);
    expect(refresh.indexOf('setNotice(successMessage)')).toBeLessThan(refresh.indexOf('refetchFromServer()'));
    expect(refresh).toMatch(/\$\{successMessage\} ただし、画面の再読み込みに失敗しました/);
  });

  it('追加の成功後は、成功の表示を refreshAfterWrite で出す（通信の失敗表示に入らない）', () => {
    const afterSuccess = adoption.slice(adoption.indexOf('adoptingCandidateIdsRef.current.delete(key);\n    if (!isSaveScopeCurrent(gate.scope))'));
    expect(afterSuccess).toMatch(/await refreshAfterWrite\(/);
    expect(afterSuccess.slice(0, afterSuccess.indexOf('refreshAfterWrite('))).not.toMatch(/refetchFromServer/);
  });

  it('反映の成功後も、同じ形で成功の表示を出す', () => {
    const afterSuccess = proposalApply.slice(proposalApply.indexOf('adoptingCandidateIdsRef.current.delete(key);\n    if (!isSaveScopeCurrent(gate.scope))'));
    expect(afterSuccess).toMatch(/await refreshAfterWrite\(/);
  });
});

describe('画面の表示', () => {
  it('候補には「追加する」「追加しない」があり、変更案には反映の選択がある', () => {
    expect(page).toMatch(/>\s*追加する\s*</);
    expect(page).toMatch(/>\s*追加しない\s*</);
    expect(page).toMatch(/この変更を反映する/);
    expect(page).toMatch(/反映しない/);
  });

  it('同じ名称の既存プロジェクトは注意表示にとどめ、自動統合しない', () => {
    expect(page).toMatch(/isSimilarTitle\(e\.title/);
    expect(page).toMatch(/自動では統合しません/);
  });
});

describe('戦略の概要（橋渡し）は、既存の内容を確認なしに置き換えない', () => {
  it('既存の全社戦略サマリーがある場合は確認する', () => {
    const bridge = section('  const handleGenerateStrategyBridge = useCallback', '// ★ lanes 内訳は store/DB に保存しない');
    expect(bridge).toMatch(/hasExistingBridge/);
    expect(bridge).toMatch(/window\.confirm\(/);
  });
});
