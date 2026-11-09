/* 実アプリのレイアウト確認用のルーター代替（評価専用）。画面遷移はしない。 */
import React from 'react';

let pathname = '/stage6';
export function setMockPathname(p: string): void {
  pathname = p;
}
export function usePathname(): string {
  return pathname;
}
const stableRouter = {
  push: () => {},
  replace: () => {},
  prefetch: () => {},
  back: () => {},
  forward: () => {},
  refresh: () => {},
};
export function useRouter(): any {
  return stableRouter;
}
export function useSearchParams(): URLSearchParams {
  return new URLSearchParams('');
}
export function redirect(_url: string): never {
  throw new Error('redirect is disabled in the harness');
}

export default function Link(props: any): any {
  const { href, children, prefetch: _p, replace: _r, scroll: _s, ...rest } = props;
  return React.createElement('a', { ...rest, href: typeof href === 'string' ? href : String(href?.pathname ?? '/') }, children);
}
