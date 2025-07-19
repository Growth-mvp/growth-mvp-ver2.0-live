import { NextRequest, NextResponse } from 'next/server';

export function middleware(request: NextRequest) {
  const userId = request.cookies.get('user_id')?.value;
  const userRole = request.cookies.get('user_role')?.value;
  const pathname = request.nextUrl.pathname;

  console.log('🛡️ middleware:', { userId, userRole, pathname });

  // ログインページは除外
  if (pathname === '/login' || pathname === '/signup') {
    return NextResponse.next();
  }

  // 未ログインならログインページへリダイレクト
  if (!userId) {
    return NextResponse.redirect(new URL('/login', request.url));
  }

  // /admin は admin 以外アクセス不可
  if (pathname === '/admin' && userRole !== 'admin') {
    console.warn('🚫 非管理者が /admin にアクセス');
    return NextResponse.redirect(new URL('/strategy', request.url));
  }

  return NextResponse.next();
}

// ミドルウェアを適用するパス
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
