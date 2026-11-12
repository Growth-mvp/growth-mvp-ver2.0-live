import type { AnchorHTMLAttributes, ReactNode } from 'react';

/* 検証用の画面では、Next のルーターを読み込まない（通常の <a> と同じ働きをする）。 */
export default function Link(props: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string; children?: ReactNode }) {
  const { href, children, ...rest } = props;
  return <a href={href} {...rest}>{children}</a>;
}
