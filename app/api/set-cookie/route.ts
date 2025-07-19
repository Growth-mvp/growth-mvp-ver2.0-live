// app/api/set-cookie/route.ts
import { NextResponse } from 'next/server';

export async function POST(req: Request) {
  const { user_id, user_role } = await req.json();

  const response = NextResponse.json({ success: true });
  response.cookies.set('user_id', user_id, { path: '/', maxAge: 86400 });
  response.cookies.set('user_role', user_role, { path: '/', maxAge: 86400 });
  return response;
}
