import fs from 'fs';
import path from 'path';
import { OPERATIONS, type OperationRole } from './operations';
import { getOperation, getOperationsForScreen, isGuidanceEnabled } from './lookup';
import { SCREENS, findScreenById } from '@/lib/screens/screenRegistry';

const ROOT = process.cwd();
const ALLOWED_ROLES: readonly OperationRole[] = ['member', 'manager', 'admin'];
const ALLOWED_ENFORCEMENT = ['ui-only', 'ui-and-api', 'none'];
const ALLOWED_SAVE = ['auto', 'manual', 'api', 'download', 'none', 'unverified'];
const UNDETERMINED_SCREEN_IDS = ['stage4-page', 'review', 'plan-midterm', 'onboarding'];

function readLines(file: string): string[] {
  return fs.readFileSync(path.join(ROOT, file), 'utf8').split(/\r?\n/);
}

describe('操作登録簿：一意性', () => {
  it('operationId は重複しない', () => {
    const ids = OPERATIONS.map((op) => op.operationId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('operationId は「領域.名前」の形式（小文字・数字・ハイフン）', () => {
    for (const op of OPERATIONS) {
      expect({ id: op.operationId, ok: /^(stage[1-6]|org|plan|common)\.[a-z0-9-]+$/.test(op.operationId) }).toEqual({
        id: op.operationId,
        ok: true,
      });
    }
  });

  it('同じ画面の中でラベルは重複しない（全画面共通の操作は画面ごとに比較しない）', () => {
    const seen = new Set<string>();
    for (const op of OPERATIONS.filter((o) => o.screenIds.length > 0)) {
      for (const screenId of op.screenIds) {
        const key = `${screenId}::${op.label}`;
        expect({ key, dup: seen.has(key) }).toEqual({ key, dup: false });
        seen.add(key);
      }
    }
  });
});

describe('操作登録簿：screenRegistry との整合性', () => {
  it('操作が参照する画面 ID は、すべて登録簿（screenRegistry）に存在する', () => {
    for (const op of OPERATIONS) {
      for (const screenId of op.screenIds) {
        expect({ op: op.operationId, screenId, found: findScreenById(screenId) !== null }).toEqual({
          op: op.operationId,
          screenId,
          found: true,
        });
      }
    }
  });

  it('用途未確定の旧画面には、操作を登録しない', () => {
    for (const op of OPERATIONS) {
      for (const screenId of op.screenIds) {
        expect({ op: op.operationId, screenId, undetermined: UNDETERMINED_SCREEN_IDS.includes(screenId) }).toEqual({
          op: op.operationId,
          screenId,
          undetermined: false,
        });
      }
    }
  });

  it('全画面共通の操作（screenIds が空）以外は、画面と操作が1対1で対応できる', () => {
    const screenIds = new Set(SCREENS.map((s) => s.id));
    for (const op of OPERATIONS) {
      for (const screenId of op.screenIds) {
        expect(screenIds.has(screenId)).toBe(true);
      }
    }
  });
});

describe('操作登録簿：UIラベルと実装コードの照合', () => {
  it.each(OPERATIONS.map((op) => [op.operationId, op] as const))(
    '%s：根拠の行に、登録したラベルが実際に含まれている',
    (_id, op) => {
      const filePath = path.join(ROOT, op.source.file);
      expect(fs.existsSync(filePath)).toBe(true);
      const lines = readLines(op.source.file);
      expect(op.source.line).toBeGreaterThanOrEqual(1);
      expect(op.source.line).toBeLessThanOrEqual(lines.length);
      expect(lines[op.source.line - 1]).toContain(op.label);
    }
  );

  it('ラベルは空ではなく、前後に余計な空白を含まない', () => {
    for (const op of OPERATIONS) {
      expect({ id: op.operationId, trimmed: op.label === op.label.trim() && op.label.length > 0 }).toEqual({
        id: op.operationId,
        trimmed: true,
      });
    }
  });
});

describe('操作登録簿：手順・条件・保存', () => {
  it.each(OPERATIONS.map((op) => [op.operationId, op] as const))(
    '%s：目的、手順、条件が記載されている',
    (_id, op) => {
      expect(op.purpose.trim().length).toBeGreaterThan(0);
      expect(op.steps.length).toBeGreaterThan(0);
      expect(op.steps.every((s) => s.trim().length > 0)).toBe(true);
      expect(op.conditions.trim().length).toBeGreaterThan(0);
    }
  );

  it('保存の種類は定義済みの値だけ', () => {
    for (const op of OPERATIONS) {
      expect({ id: op.operationId, kind: op.save.kind, ok: ALLOWED_SAVE.includes(op.save.kind) }).toEqual({
        id: op.operationId,
        kind: op.save.kind,
        ok: true,
      });
      expect(op.save.target.trim().length).toBeGreaterThan(0);
    }
  });
});

describe('操作登録簿：権限情報の整合性', () => {
  it('必要ロール・判定の場所は定義済みの値だけ', () => {
    for (const op of OPERATIONS) {
      expect({ id: op.operationId, role: ALLOWED_ROLES.includes(op.permission.minRole) }).toEqual({
        id: op.operationId,
        role: true,
      });
      expect({ id: op.operationId, enforcement: ALLOWED_ENFORCEMENT.includes(op.permission.enforcement) }).toEqual({
        id: op.operationId,
        enforcement: true,
      });
    }
  });

  it('画面の制御だけに頼る（enforcement: none）操作は、必要ロールを member としている', () => {
    for (const op of OPERATIONS.filter((o) => o.permission.enforcement === 'none')) {
      expect({ id: op.operationId, role: op.permission.minRole }).toEqual({ id: op.operationId, role: 'member' });
    }
  });

  it('管理者・管理職の操作には、画面の制御（ui-only / ui-and-api）を明示している', () => {
    for (const op of OPERATIONS.filter((o) => o.permission.minRole !== 'member')) {
      expect({ id: op.operationId, enforced: op.permission.enforcement !== 'none' }).toEqual({
        id: op.operationId,
        enforced: true,
      });
    }
  });

  it('API の判定を主張する（ui-and-api）場合は、そのルートファイルが存在する', () => {
    for (const op of OPERATIONS.filter((o) => o.permission.enforcement === 'ui-and-api')) {
      expect(op.permission.apiRoute).toBeTruthy();
      expect(fs.existsSync(path.join(ROOT, op.permission.apiRoute as string))).toBe(true);
    }
  });

  it('参照している apiRoute（指定がある場合）は、すべて実在する', () => {
    for (const op of OPERATIONS) {
      if (!op.permission.apiRoute) continue;
      expect({ id: op.operationId, exists: fs.existsSync(path.join(ROOT, op.permission.apiRoute)) }).toEqual({
        id: op.operationId,
        exists: true,
      });
    }
  });

  it('画面に requiredRole が設定されている場合、その画面の操作は同等以上のロールを要求する', () => {
    const rank: Record<OperationRole, number> = { member: 0, manager: 1, admin: 2 };
    for (const op of OPERATIONS) {
      for (const screenId of op.screenIds) {
        const screen = findScreenById(screenId);
        if (!screen?.requiredRole) continue;
        expect({ id: op.operationId, ok: rank[op.permission.minRole] >= rank[screen.requiredRole] }).toEqual({
          id: op.operationId,
          ok: true,
        });
      }
    }
  });

  it('管理者向けの操作（組織変革の共有ルーム）は、現状の表示条件が機能しないため登録していない', () => {
    const adminOrg = OPERATIONS.filter((o) => o.screenIds.includes('org-shared') && o.permission.minRole === 'admin');
    expect(adminOrg).toEqual([]);
  });
});

describe('操作登録簿：検索と案内の対象', () => {
  it('操作は、操作IDから取得できる', () => {
    expect(getOperation('stage1.company-name')?.label).toBe('会社名');
    expect(getOperation('no.such.operation')).toBeNull();
  });

  it('登録情報は、画面IDから取得できる（全画面共通の操作も含む）', () => {
    const ids = getOperationsForScreen('stage1').map((o) => o.operationId);
    expect(ids).toContain('stage1.company-name');
    expect(ids).toContain('common.manual-save');
    expect(ids).not.toContain('stage2.generate-draft');
  });

  it.each(UNDETERMINED_SCREEN_IDS)('用途未確定の画面（%s）は、操作の一覧に含まれない', (screenId) => {
    expect(getOperationsForScreen(screenId)).toEqual([]);
  });

  it('案内を有効にした画面（helpEnabled）には、登録された操作が1件以上ある', () => {
    for (const screen of SCREENS.filter((s) => s.helpEnabled === true)) {
      expect({ id: screen.id, count: getOperationsForScreen(screen.id).length > 0 }).toEqual({
        id: screen.id,
        count: true,
      });
    }
  });

  it('案内の有効可否は、登録簿の helpEnabled と用途未確定の状態で決まる', () => {
    expect(isGuidanceEnabled('stage2')).toBe(true);
    expect(isGuidanceEnabled('stage4-page')).toBe(false);
    expect(isGuidanceEnabled('admin-members')).toBe(false);
  });
});
