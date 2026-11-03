/* ブラウザ検証用の権限差し替え（評価専用）。管理者として描画する。 */
export function useAccess(): any {
  const yes = () => true;
  return {
    isAdmin: true,
    isManager: true,
    isMember: true,
    role: 'admin',
    canEdit: true,
    canView: yes,
    canEditCompany: yes,
    canEditDepartment: yes,
    canEditProject: yes,
    canAssignProjectOwner: yes,
    canEditOKR: yes,
    canPostProgressLog: yes,
  };
}
