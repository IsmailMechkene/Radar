// In-memory navigation with back/forward, mirrored to location.hash so a reload keeps the page.

export const ROUTES = [
  'opportunities',
  'copilot',
  'deadlines',
  'pipeline',
  'programs',
  'outreach',
  'sources',
  'rules',
  'settings',
  'components',
] as const;

export type Route = (typeof ROUTES)[number];
export const DEFAULT_ROUTE: Route = 'opportunities';
/** Routes that only exist when running from source. */
export const DEV_ROUTES: readonly Route[] = ['components'];

export function isRoute(value: string): value is Route {
  return (ROUTES as readonly string[]).includes(value);
}

/** "#/settings" -> "settings". Unknown, empty or (when !allowDev) dev-only routes -> default. */
export function parseRoute(hash: string, allowDev: boolean): Route {
  const name = hash.replace(/^#\/?/, '').split(/[/?]/)[0]?.toLowerCase() ?? '';
  if (!isRoute(name)) return DEFAULT_ROUTE;
  if (!allowDev && DEV_ROUTES.includes(name)) return DEFAULT_ROUTE;
  return name;
}

export function routeHref(route: Route): string {
  return `#/${route}`;
}

export interface NavState {
  stack: Route[];
  index: number;
}

export type NavAction = { type: 'go'; route: Route } | { type: 'back' } | { type: 'forward' };

export function navInit(route: Route): NavState {
  return { stack: [route], index: 0 };
}

export function currentRoute(state: NavState): Route {
  return state.stack[state.index] ?? DEFAULT_ROUTE;
}

export function canGoBack(state: NavState): boolean {
  return state.index > 0;
}

export function canGoForward(state: NavState): boolean {
  return state.index < state.stack.length - 1;
}

export function navReducer(state: NavState, action: NavAction): NavState {
  switch (action.type) {
    case 'go':
      if (currentRoute(state) === action.route) return state;
      return {
        stack: [...state.stack.slice(0, state.index + 1), action.route],
        index: state.index + 1,
      };
    case 'back':
      return canGoBack(state) ? { ...state, index: state.index - 1 } : state;
    case 'forward':
      return canGoForward(state) ? { ...state, index: state.index + 1 } : state;
  }
}
