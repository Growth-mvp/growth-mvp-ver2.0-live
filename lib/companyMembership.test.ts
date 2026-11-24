import { pickCurrentMembership } from './companyMembership';

const ACTIVE_OLD = { company_id: 'company-a', role: 'admin', created_at: '2026-11-01T00:00:00Z', companies: { deleted_at: null } };
const ACTIVE_NEW = { company_id: 'company-b', role: 'admin', created_at: '2026-11-02T00:00:00Z', companies: { deleted_at: null } };
const DELETED_NEWEST = { company_id: 'company-c', role: 'admin', created_at: '2026-11-03T00:00:00Z', companies: { deleted_at: '2026-11-04T00:00:00Z' } };

describe('pickCurrentMembership', () => {
  it('returns null when there are no memberships', () => {
    expect(pickCurrentMembership([], null)).toBeNull();
    expect(pickCurrentMembership(undefined, 'company-a')).toBeNull();
  });

  it('prefers the active company over a newer soft-deleted one', () => {
    expect(pickCurrentMembership([DELETED_NEWEST, ACTIVE_OLD])?.company_id).toBe('company-a');
  });

  it('uses the cookie-selected company when it is active', () => {
    expect(pickCurrentMembership([ACTIVE_NEW, ACTIVE_OLD], 'company-a')?.company_id).toBe('company-a');
  });

  it('ignores a cookie that points to a soft-deleted company when an active one exists', () => {
    expect(pickCurrentMembership([DELETED_NEWEST, ACTIVE_OLD], 'company-c')?.company_id).toBe('company-a');
  });

  it('falls back to the newest active membership when the cookie does not match', () => {
    expect(pickCurrentMembership([ACTIVE_OLD, ACTIVE_NEW], 'unknown')?.company_id).toBe('company-a');
  });

  it('keeps a soft-deleted company only when it is the sole membership', () => {
    expect(pickCurrentMembership([DELETED_NEWEST], null)?.company_id).toBe('company-c');
  });

  it('treats an unreadable company embed as active', () => {
    const row = { company_id: 'company-d', role: 'member', companies: null };
    expect(pickCurrentMembership([row], null)?.company_id).toBe('company-d');
  });
});
