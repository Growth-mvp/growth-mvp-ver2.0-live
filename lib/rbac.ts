/**
 * /lib/rbac.ts
 * RBAC中核：権限マトリックスを単一ソースに集約
 *
 * Role: 'admin' | 'manager' | 'member'
 * Action: 全システムで統一する権限判定キー
 * Capability: role に対応する{[action]: boolean}マップ
 *
 * 使用例（UI層）:
 *   const capabilities = getCapabilities(userRole);
 *   if (capabilities['members:invite']) { <button>招待</button> }
 *
 * 使用例（API層）:
 *   assertCapability(membership, 'members:invite');
 */

export type Role = 'admin' | 'manager' | 'member';

/**
 * アクション一覧（仕様で固定）
 * 新しいアクションを追加する時は、ここに追加して getCapabilities() も更新する
 */
export type Action =
  // メンバー管理
  | 'members:invite'
  | 'members:updateRole'
  | 'members:remove'
  // 戦略
  | 'strategy:edit'         // MVV/SWOT/Story/Departments/Projects/OKR含む
  // 部門
  | 'department:edit'
  | 'department:delete'
  // 進捗
  | 'progress:write'        // progress_logs への書き込み
  // AI
  | 'agent:use';            // ask-ceo-agent の利用

/**
 * Capability マップ：role → {action: boolean}
 */
export type Capabilities = Record<Action, boolean>;

/**
 * Role の重み付け（複数所属の優先度決定用等）
 */
export const roleWeight = (role: Role | null): number => {
  if (!role) return 0;
  if (role === 'admin') return 3;
  if (role === 'manager') return 2;
  if (role === 'member') return 1;
  return 0;
};

/**
 * ロールに基づく権限マップを返す
 *
 * @param role - ユーザーロール
 * @returns 各 action の許可/不許可
 */
export function getCapabilities(role: Role | null): Capabilities {
  const base: Capabilities = {
    // Member: 最小権限
    'members:invite': false,
    'members:updateRole': false,
    'members:remove': false,
    'strategy:edit': false,
    'department:edit': false,
    'department:delete': false,
    'progress:write': true,        // Member は進捗ログ入力可
    'agent:use': true,             // Member は AIコンサルタント利用可（閲覧・助言）
  };

  if (role === 'manager') {
    return {
      ...base,
      'members:invite': false,     // Manager は招待不可
      'members:updateRole': false,
      'members:remove': false,
      'strategy:edit': true,       // Manager は戦略編集可
      'department:edit': true,     // Manager は部門編集可（department_id スコープ）
      'department:delete': false,  // Manager は部門削除不可
      'agent:use': true,
    };
  }

  if (role === 'admin') {
    return {
      'members:invite': true,
      'members:updateRole': true,
      'members:remove': true,
      'strategy:edit': true,
      'department:edit': true,
      'department:delete': true,
      'progress:write': true,
      'agent:use': true,
    };
  }

  return base;  // null/不正値は member 相当
}

/**
 * 部門スコープの権限判定
 *
 * Manager は「担当部門（actorDeptId）が存在し、targetDeptId と一致する時のみ」編集可能
 * Admin は常に true（部門制限なし）
 * Member は常に false
 *
 * @param role - ユーザーロール
 * @param actorDeptId - ユーザーの担当部門ID（null = 部門制御なし）
 * @param targetDeptId - 編集対象部門ID
 * @returns 編集可能か
 */
export function canEditDepartment(
  role: Role | null,
  actorDeptId: string | null | undefined,
  targetDeptId: string | null | undefined
): boolean {
  if (role === 'admin') return true;

  if (role === 'manager') {
    // Manager は「担当部門が存在」かつ「ターゲット部門と一致」の時のみ編集可
    if (!actorDeptId) return false;  // 担当部門なし → 編集不可
    if (!targetDeptId) return false; // ターゲット部門なし（仕様による、通常は不可）
    return actorDeptId === targetDeptId;
  }

  // Member は常に false
  return false;
}

/**
 * 権限判定の統一入口（UI/API共用）
 *
 * 使用例（API層）:
 *   const capabilities = getCapabilities(membership.role);
 *   if (!can(capabilities, 'members:invite')) {
 *     throw new ForbiddenError('members:invite is not permitted');
 *   }
 */
export function can(capabilities: Capabilities, action: Action): boolean {
  return capabilities[action] ?? false;
}

/**
 * 部門スコープ付き権限判定（Manager が部門制限される場合）
 *
 * 使用例（API層）:
 *   if (!canActionInDepartment(membership.role, membership.departmentId, targetDeptId, 'department:edit')) {
 *     throw new ForbiddenError('...');
 *   }
 */
export function canActionInDepartment(
  role: Role | null,
  actorDeptId: string | null | undefined,
  targetDeptId: string | null | undefined,
  action: 'department:edit' | 'department:delete'
): boolean {
  if (action === 'department:edit') {
    return canEditDepartment(role, actorDeptId, targetDeptId);
  }

  if (action === 'department:delete') {
    // 部門削除は admin のみ
    return role === 'admin';
  }

  return false;
}
