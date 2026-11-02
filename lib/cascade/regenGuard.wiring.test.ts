/* 再生成ガードの配線確認（ページ全体は単体テストが難しいため、処理の順序を静的に確認する）。 */
import fs from 'fs';
import path from 'path';

const src = fs.readFileSync(path.join(__dirname, '..', '..', 'app', 'cascade', 'page.tsx'), 'utf8');

function handlerBody(): string {
  const start = src.indexOf('const handleDeptCascadeDraft = async');
  const end = src.indexOf('\n  };', start);
  return src.slice(start, end);
}

describe('再生成ガードの配線（部門再生成ハンドラ）', () => {
  const body = handlerBody();

  it('ハンドラが存在し、通常（draft）と再生成（regen）の両方を扱う', () => {
    expect(body.length).toBeGreaterThan(1000);
    expect(src).toContain("handleDeptCascadeDraft(index, 'draft')");
    expect(src).toContain("handleDeptCascadeDraft(index, 'regen')");
  });

  it('API を呼ぶ前に事前判定を行い、生成フラグを立てる前に中止できる', () => {
    const pre = body.indexOf('await assessDepartmentRegen(');
    const gen = body.indexOf('setIsGenerating(true)');
    expect(pre).toBeGreaterThan(-1);
    expect(gen).toBeGreaterThan(pre);
    expect(body.indexOf('/api/generate-cascade')).toBeGreaterThan(pre);
  });

  it('結果を反映する前に、保存世代と部門の並びを確認し、再判定する', () => {
    const scope = body.indexOf('isSaveScopeCurrent(regenScope)');
    const second = body.indexOf('await assessDepartmentRegen(', body.indexOf('await assessDepartmentRegen(') + 10);
    const write = body.indexOf('applyDeptDraftToProjects(existingProjects, cleanedRd, false');
    expect(scope).toBeGreaterThan(-1);
    expect(second).toBeGreaterThan(-1);
    expect(write).toBeGreaterThan(second);
    expect(second).toBeGreaterThan(scope);
  });

  it('書き込みの直前（ストア内）でも、現在のプロジェクトを判定し、該当すれば書き込まない', () => {
    const local = body.indexOf('findLocalStage4Data(existingProjects)');
    const write = body.indexOf('applyDeptDraftToProjects(existingProjects, cleanedRd, false');
    expect(local).toBeGreaterThan(-1);
    expect(local).toBeLessThan(write);
    expect(body.indexOf('return list;', local)).toBeLessThan(write);
  });

  it('中止された場合は、後始末（DB の論理削除）に進まない', () => {
    const blockedReturn = body.indexOf('if (regenBlockNotice)');
    const cleanup = body.indexOf('/api/cascade/cleanup-deleted-projects');
    expect(blockedReturn).toBeGreaterThan(-1);
    expect(cleanup).toBeGreaterThan(blockedReturn);
  });

  it('既存の保存世代ガードと権限チェックを残している', () => {
    expect(body).toContain('canEditDept()');
    expect(body).toContain('captureSaveScope()');
    expect(src).toContain("import { captureSaveScope, isSaveScopeCurrent } from '@/lib/strategy/saveScope';");
  });
});

describe('後始末の実行順（保存成功の後にだけ）', () => {
  const body = handlerBody();

  it('後始末は保存の戻り値が ok: true のときにだけ呼ばれる', () => {
    const save = body.indexOf('await saveNow()');
    const okCheck = body.indexOf('saveResult?.ok === true');
    const runCleanup = body.indexOf('await runStage3Cleanup(ids');
    expect(save).toBeGreaterThan(-1);
    expect(okCheck).toBeGreaterThan(save);
    expect(runCleanup).toBeGreaterThan(okCheck);
  });

  it('保存より前に後始末 API を呼ばない（即時の呼び出しは削除済み）', () => {
    const cleanupCalls = body.split('/api/cascade/cleanup-deleted-projects').length - 1;
    expect(cleanupCalls).toBe(1);
    expect(body.indexOf('await runStage3Cleanup(')).toBeGreaterThan(body.indexOf('await saveNow()'));
  });

  it('保存の失敗・例外では後始末を保留にする', () => {
    expect(body).toContain('pendingCleanupIds = [];');
    expect(body.split('pendingCleanupIds = [];').length - 1).toBeGreaterThanOrEqual(2);
  });

  it('保存直後の revision を後始末に渡し、別の変更があれば拒否される（API 側）', () => {
    expect(body).toContain('expectedRevision: revision');
    expect(body).toContain('saveResult.revision');
  });

  it('後始末の前に、会社の切替を確認する', () => {
    const start = body.indexOf('const runStage3Cleanup');
    expect(body.indexOf('isSaveScopeCurrent(regenScope)', start)).toBeGreaterThan(start);
  });
});
