/* 検証用の編集権限：検証の利用者は管理者として扱う（本番の権限情報には触れない）。 */
export type AppRole = 'admin' | 'manager' | 'member' | null;

export function useAccess() {
  return {
    role: 'admin' as AppRole,
    canEditDepartment: () => true,
    canEditCompany: () => true,
  };
}

export type AccessApi = ReturnType<typeof useAccess>;
