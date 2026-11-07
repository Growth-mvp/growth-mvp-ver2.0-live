import { readFileSync } from 'fs';
import { join } from 'path';
import { stage2ConflictMessage, stage2SaveRevision } from './stage2Save';

describe('STAGE2 の保存で使う revision（画面が読んだ版）', () => {
  it('正常: 画面の revision をそのまま条件にする', () => {
    expect(stage2SaveRevision({ revision: 5 })).toBe(5);
    expect(stage2SaveRevision({ revision: 0 })).toBe(0);
  });

  it('revision が無い（まだ読み込み前）なら undefined。保存処理は読み直した値を使うため、呼び出し側は読み込み後にだけ保存する', () => {
    expect(stage2SaveRevision({})).toBeUndefined();
    expect(stage2SaveRevision({ revision: 'x' })).toBeUndefined();
  });

  it('競合（REVISION_CONFLICT）は、保存されなかったことと編集の保持を伝える', () => {
    const msg = stage2ConflictMessage({ code: 'REVISION_CONFLICT', message: 'x' });
    expect(msg).toContain('保存されませんでした');
    expect(msg).toContain('編集内容は残っています');
  });

  it('競合以外の失敗は、競合の文言にしない', () => {
    expect(stage2ConflictMessage({ code: 'PGRST500', message: 'x' })).toBeNull();
    expect(stage2ConflictMessage(null)).toBeNull();
  });

  it('revision 不明で拒否された保存は、再読み込みしてから保存し直す案内にする（競合の文言にしない）', () => {
    const msg = stage2ConflictMessage({ code: 'REVISION_UNKNOWN', message: 'x' });
    expect(msg).toContain('保存できませんでした');
    expect(msg).toContain('再読み込みすると失われる可能性');
    expect(msg).not.toContain('他の利用者');
  });
});

describe('STAGE2 の 3 つの保存経路（画面の配線・静的確認）', () => {
  const page = readFileSync(join(__dirname, '../../app/stage2/page.tsx'), 'utf8');

  it('3 つの保存は、すべて画面の revision を渡す（undefined で最新値に読み替えさせない）', () => {
    expect(page).toContain("stage2SaveRevision(storeState), {}, 'stage2:handleGenerate'");
    expect(page).toContain("stage2SaveRevision(storeState), {}, 'stage2:generateFinal'");
    expect(page).toContain("stage2SaveRevision(storeState), {}, 'stage2:saveFinalDocumentEdits'");
    expect(page).not.toMatch(/saveWithAudit\([^)]*undefined, \{\}, 'stage2:/);
  });

  it('2 つ目の経路は、失敗（競合を含む）を通知する', () => {
    expect(page).toContain('stage2ConflictMessage(outcome.error) : null) ??');
    expect(page).toContain('FINAL_STORY_SAVE_FAILED_MESSAGE');
  });

  it('3 つ目の経路は、失敗を無通知で戻さない', () => {
    expect(page).toContain("setSaveWarning(stage2ConflictMessage(saveResult.error) ?? '保存できませんでした。");
  });
});
