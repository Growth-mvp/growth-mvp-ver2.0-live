/**
 * /hooks/useCapabilities.ts
 * UI層：ユーザーのロールから権限（capabilities）を取得するHook
 *
 * 使用例：
 *   const cap = useCapabilities();
 *   if (cap.canInviteMembers) { <button>招待</button> }
 *   if (cap.canEditStrategy) { <button>編集</button> }
 */

'use client';

import { useUserStore } from '@/store/userStore';
import { getCapabilities, canEditDepartment, type Capabilities } from '@/lib/rbac';

export interface CapabilitiesAPI {
  // Raw capabilities
  capabilities: Capabilities;

  // Boolean helpers（UI template内で可読性重視）
  canInviteMembers: boolean;
  canUpdateMemberRole: boolean;
  canRemoveMembers: boolean;
  canEditStrategy: boolean;
  canEditDepartment: boolean;
  canDeleteDepartment: boolean;
  canWriteProgress: boolean;
  canUseAgent: boolean;

  // Method: 部門スコープ付き department:edit 判定
  canEditDepartmentInScope(targetDeptId?: string | null): boolean;
}

export function useCapabilities(): CapabilitiesAPI {
  const role = useUserStore((s) => s.role);
  const departmentId = useUserStore((s) => s.departmentId);

  const capabilities = getCapabilities(role);

  return {
    capabilities,
    canInviteMembers: capabilities['members:invite'],
    canUpdateMemberRole: capabilities['members:updateRole'],
    canRemoveMembers: capabilities['members:remove'],
    canEditStrategy: capabilities['strategy:edit'],
    canEditDepartment: capabilities['department:edit'],
    canDeleteDepartment: capabilities['department:delete'],
    canWriteProgress: capabilities['progress:write'],
    canUseAgent: capabilities['agent:use'],

    // 部門スコープ付き判定
    canEditDepartmentInScope(targetDeptId?: string | null) {
      return canEditDepartment(role, departmentId, targetDeptId);
    },
  };
}
