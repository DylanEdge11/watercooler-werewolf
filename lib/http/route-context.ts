/** The second argument Next.js gives a route handler: the dynamic segments of its URL. Most routes are under a game. */
export interface RouteContext<Params extends Record<string, string> = { gameId: string }> {
  params: Promise<Params>;
}
