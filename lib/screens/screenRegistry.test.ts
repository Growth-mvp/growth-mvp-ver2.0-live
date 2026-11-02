import fs from 'fs';
import path from 'path';
import { SCREENS, findScreenById, findScreenByPathname } from './screenRegistry';
import { normalizePathname } from './screenContext';

const ROOT = process.cwd();

function listPageRoutes(dir: string, base = ''): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...listPageRoutes(full, `${base}/${entry.name}`));
    } else if (entry.name === 'page.tsx') {
      out.push(base === '' ? '/' : base);
    }
  }
  return out;
}

const pageRoutes = listPageRoutes(path.join(ROOT, 'app'));
const dynamicPageRoutes = pageRoutes.filter((r) => r.includes('['));
const staticPageRoutes = pageRoutes.filter((r) => !r.includes('['));

const sidebarHrefs = Array.from(
  new Set(
    [...fs.readFileSync(path.join(ROOT, 'components', 'Sidebar.tsx'), 'utf8').matchAll(/href="(\/[^"]*)"/g)].map(
      (m) => m[1]
    )
  )
).sort();

describe('画面レジストリの属性', () => {
  it('登録画面は48件のまま変わらない', () => {
    expect(SCREENS).toHaveLength(48);
  });

  it('lifecycle は active / legacy / undetermined のいずれかで、用途未確定の画面は指定の5件だけ', () => {
    const allowed = ['active', 'legacy', 'undetermined', undefined];
    for (const s of SCREENS) {
      expect(allowed).toContain(s.lifecycle);
    }
    const undetermined = SCREENS.filter((s) => s.lifecycle === 'undetermined').map((s) => s.pathname).sort();
    expect(undetermined).toEqual(['/onboarding', '/report/midterm-plan', '/review', '/stage4', '/story-process']);
  });

  it('旧ルートのリダイレクトは legacy で、リダイレクト以外の画面は legacy にならない', () => {
    const legacy = SCREENS.filter((s) => s.lifecycle === 'legacy');
    expect(legacy.every((s) => s.status === 'redirect')).toBe(true);
    expect(legacy.map((s) => s.pathname).sort()).toEqual(
      ['/report/preview', '/report/stakeholder-select', '/signup', '/signup/admin', '/stage3', '/strategy'].sort()
    );
  });

  it('helpEnabled は主要画面（STAGE1〜6、組織変革、経営計画書）だけが有効', () => {
    const enabled = SCREENS.filter((s) => s.helpEnabled === true).map((s) => s.id).sort();
    expect(enabled).toEqual(
      [
        'org-personal',
        'org-shared',
        'plan-bank',
        'plan-employee',
        'plan-hub',
        'plan-shareholder',
        'stage1',
        'stage2',
        'stage3',
        'stage4',
        'stage5',
        'stage6',
      ].sort()
    );
  });

  it('helpEnabled が有効な画面は、用途未確定でも旧ルートでもない', () => {
    for (const s of SCREENS.filter((e) => e.helpEnabled === true)) {
      expect({ id: s.id, ok: s.lifecycle !== 'undetermined' && s.status === 'active' }).toEqual({ id: s.id, ok: true });
    }
  });

  it('requiredRole は画面レベルで確実な /admin/* だけに設定されている', () => {
    const withRole = SCREENS.filter((s) => s.requiredRole !== undefined);
    expect(withRole.every((s) => s.requiredRole === 'admin')).toBe(true);
    expect(withRole.map((s) => s.pathname).sort()).toEqual(
      ['/admin', '/admin/data-management', '/admin/invites', '/admin/members', '/admin/org-insights']
    );
  });

  it('screenId による検索は、登録済みの画面だけを返す', () => {
    expect(findScreenById('stage1')?.pathname).toBe('/stage1');
    expect(findScreenById('stage9')).toBeNull();
    expect(findScreenById('__proto__')).toBeNull();
  });
});

describe('画面レジストリ', () => {
  it('IDとパスは重複しない', () => {
    const ids = SCREENS.map((s) => s.id);
    const paths = SCREENS.map((s) => s.pathname);
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(paths).size).toBe(paths.length);
  });

  it('すべてのパスは正規化済みである', () => {
    for (const s of SCREENS) {
      expect({ id: s.id, normalized: normalizePathname(s.pathname) }).toEqual({ id: s.id, normalized: s.pathname });
    }
  });

  it('リダイレクトの移動先は、有効な画面として登録されている', () => {
    for (const s of SCREENS.filter((e) => e.status === 'redirect')) {
      const target = s.redirectTo ? findScreenByPathname(s.redirectTo) : null;
      expect({ id: s.id, target: target?.status ?? null }).toEqual({ id: s.id, target: 'active' });
    }
  });

  it('有効な画面は、対応するページファイルが存在する', () => {
    for (const s of SCREENS.filter((e) => e.status === 'active')) {
      const file = path.join(ROOT, 'app', s.pathname === '/' ? '' : s.pathname, 'page.tsx');
      expect({ id: s.id, exists: fs.existsSync(file) }).toEqual({ id: s.id, exists: true });
    }
  });

  it('リダイレクトは、ページファイルか next.config.js のいずれかで定義されている', () => {
    const nextConfig = fs.readFileSync(path.join(ROOT, 'next.config.js'), 'utf8');
    for (const s of SCREENS.filter((e) => e.status === 'redirect')) {
      const file = path.join(ROOT, 'app', s.pathname, 'page.tsx');
      const defined = fs.existsSync(file) || nextConfig.includes(`source: '${s.pathname}'`);
      expect({ id: s.id, defined }).toEqual({ id: s.id, defined: true });
    }
  });

  it('app 配下の静的ページは、すべてレジストリに登録されている', () => {
    const registered = new Set(SCREENS.map((s) => s.pathname));
    const missing = staticPageRoutes.filter((r) => !registered.has(r));
    expect(missing).toEqual([]);
  });

  it('動的ルートのページは、登録簿の対象外として明示されている（未解決事項）', () => {
    expect(dynamicPageRoutes).toEqual(['/report/[audience]-plan']);
  });

  it('ナビ表示の有無は、Sidebar.tsx のリンクと一致する', () => {
    const navPaths = SCREENS.filter((s) => s.navVisible).map((s) => s.pathname).sort();
    expect(navPaths).toEqual(sidebarHrefs);
  });

  it('STAGE0〜6 にはそれぞれ有効なナビ項目がある（STAGE4 はナビ外の別ページを除く）', () => {
    for (let n = 0; n <= 6; n++) {
      const found = SCREENS.some((s) => s.stage === n && s.status === 'active' && s.navVisible);
      expect({ stage: n, found }).toEqual({ stage: n, found: true });
    }
  });
});
