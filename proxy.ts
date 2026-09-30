import { NextResponse, type NextRequest } from 'next/server';

/**
 * Visitors without a player or spectator session see the landing page at / straight from
 * the CDN, instead of loading the dashboard only to get a 401 from
 * /api/player. This is an optimistic check only: the dashboard still
 * verifies the session and falls back to the landing page if it has expired.
 */
export function proxy(request: NextRequest) {
  if (request.cookies.has('ww_player_session') || request.cookies.has('ww_spectator_session')) return NextResponse.next();
  return NextResponse.rewrite(new URL('/landing-page', request.url));
}

export const config = {
  matcher: '/',
};
