/* eslint-disable @typescript-eslint/no-explicit-any -- 管理APIのモックは意図的に緩く定義している */
jest.mock('server-only', () => ({}));

import { findAuthUserByEmail, AuthUserLookupError } from './authUsers';

function fakeAdmin(pages: Array<Array<{ id: string; email: string }>>, error: unknown = null) {
  const listUsers = jest.fn(async ({ page }: { page: number }) => ({
    data: { users: pages[page - 1] ?? [] },
    error,
  }));
  return { admin: { auth: { admin: { listUsers } } } as any, listUsers };
}

const fullPage = (prefix: string) =>
  Array.from({ length: 1000 }, (_, i) => ({ id: `${prefix}-${i}`, email: `${prefix}${i}@example.com` }));

describe('findAuthUserByEmail', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('1ページ目で見つかればそのユーザーを返す（大文字小文字は無視）', async () => {
    const { admin, listUsers } = fakeAdmin([[{ id: 'u1', email: 'Invitee@Example.com' }]]);

    const user = await findAuthUserByEmail(admin, ' invitee@example.com ');

    expect(user?.id).toBe('u1');
    expect(listUsers).toHaveBeenCalledTimes(1);
    expect(listUsers).toHaveBeenCalledWith({ page: 1, perPage: 1000 });
  });

  it('ページをまたいで見つかる', async () => {
    const { admin, listUsers } = fakeAdmin([fullPage('a'), [{ id: 'target', email: 'target@example.com' }]]);

    const user = await findAuthUserByEmail(admin, 'target@example.com');

    expect(user?.id).toBe('target');
    expect(listUsers).toHaveBeenCalledTimes(2);
  });

  it('最後まで探しても無ければ null（不完全なページで終了）', async () => {
    const { admin, listUsers } = fakeAdmin([[{ id: 'x', email: 'other@example.com' }]]);

    const user = await findAuthUserByEmail(admin, 'nobody@example.com');

    expect(user).toBeNull();
    expect(listUsers).toHaveBeenCalledTimes(1);
  });

  it('取得に失敗したら例外にする（「存在しない」と誤判定しない）', async () => {
    const { admin } = fakeAdmin([], { message: 'boom' });

    await expect(findAuthUserByEmail(admin, 'a@example.com')).rejects.toBeInstanceOf(AuthUserLookupError);
  });

  it('件数の上限を超えたら例外にする', async () => {
    const pages = Array.from({ length: 25 }, (_, i) => fullPage(`p${i}`));
    const { admin, listUsers } = fakeAdmin(pages);

    await expect(findAuthUserByEmail(admin, 'nobody@example.com')).rejects.toThrow('page_limit_exceeded');
    expect(listUsers).toHaveBeenCalledTimes(20);
  });

  it('時間の上限を超えたら例外にする', async () => {
    let now = 0;
    jest.spyOn(Date, 'now').mockImplementation(() => {
      now += 3000;
      return now;
    });
    const { admin } = fakeAdmin([fullPage('a'), fullPage('b'), fullPage('c')]);

    await expect(findAuthUserByEmail(admin, 'nobody@example.com')).rejects.toThrow('time_budget_exceeded');
  });
});
