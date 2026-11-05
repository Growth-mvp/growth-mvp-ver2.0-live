/* eslint-disable @typescript-eslint/no-explicit-any -- Supabase のチェーンを最小限に再現する */
jest.mock('server-only', () => ({}));

import { getInsightSourceCases } from './org-alignment-server';

const AUTHOR = 'author-1';
const PROFILE = { full_name: '山田', email: 'yamada@example.com' };

function fakeAdmin(visibilityMode: string) {
  const profileLookups: string[] = [];
  const sources = [
    {
      case_id: 'case-1',
      org_alignment_cases: { created_by: AUTHOR, visibility_mode: visibilityMode, created_at: '2026-01-01T00:00:00Z' },
    },
  ];

  const thenable = (value: unknown) => ({
    select: () => thenable(value),
    eq: () => thenable(value),
    single: () => Promise.resolve(value),
    then: (resolve: any, reject: any) => Promise.resolve(value).then(resolve, reject),
  });

  const admin = {
    from: (table: string) => {
      if (table === 'profiles') {
        return {
          select: () => ({
            eq: (_col: string, id: string) => {
              profileLookups.push(id);
              return thenable({ data: id === AUTHOR ? PROFILE : null, error: null });
            },
          }),
        };
      }
      return thenable({ data: sources, error: null });
    },
  };
  return { admin: admin as any, profileLookups };
}

describe('集約の出典案件（管理者向け）の作成者IDの扱い', () => {
  it('匿名投稿では、作成者ID・氏名・メールを返さず、作成者の照会もしない', async () => {
    const { admin, profileLookups } = fakeAdmin('anonymous');
    const [row] = await getInsightSourceCases(admin, 'insight-1', 'key-1');
    expect(row.createdBy).toBeNull();
    expect(row.userName).toBeNull();
    expect(row.userEmail).toBeNull();
    expect(profileLookups).toEqual([]);
    expect(JSON.stringify(row)).not.toContain(AUTHOR);
  });

  it.each(['manager_only', 'named'])('%s の投稿では、作成者IDと氏名を返す', async (mode) => {
    const { admin } = fakeAdmin(mode);
    const [row] = await getInsightSourceCases(admin, 'insight-1', 'key-1');
    expect(row.createdBy).toBe(AUTHOR);
    expect(row.userName).toBe(PROFILE.full_name);
  });
});
