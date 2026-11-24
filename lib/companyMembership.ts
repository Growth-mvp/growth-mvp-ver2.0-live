type CompanyEmbed = { deleted_at?: string | null } | { deleted_at?: string | null }[] | null;

export type MembershipRow = {
  company_id: string;
  role: string;
  created_at?: string | null;
  companies?: CompanyEmbed;
};

function isSoftDeleted(row: MembershipRow): boolean {
  const company = Array.isArray(row.companies) ? row.companies[0] : row.companies;
  return !!company?.deleted_at;
}

/**
 * 現在の会社を決める：Cookie の会社（所属している場合のみ）→ 有効な会社の最新所属。
 * 論理削除された会社は、有効な所属が1つも無い場合にだけ候補になる。
 */
export function pickCurrentMembership<T extends MembershipRow>(
  rows: T[] | null | undefined,
  selectedCid?: string | null,
): T | null {
  const all = rows ?? [];
  const active = all.filter((m) => !isSoftDeleted(m));
  const candidates = active.length > 0 ? active : all;
  return candidates.find((m) => m.company_id === selectedCid) ?? candidates[0] ?? null;
}
