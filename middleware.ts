import { NextRequest, NextResponse } from 'next/server';

export function middleware(request: NextRequest) {
  const isLoggedIn = request.cookies.get('user_id');
  const pathname = request.nextUrl.pathname;

  // ログインページは除外
  if (pathname === '/login') return NextResponse.next();

  // ログインしていない場合、login にリダイレクト
  if (!isLoggedIn) {
    return NextResponse.redirect(new URL('/login', request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    '/strategy',
    '/story',
    '/cascade',
    '/execution',
    '/review',
    '/admin',
  ],
};
