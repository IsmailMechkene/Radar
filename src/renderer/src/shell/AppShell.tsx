import { ChevronLeft, ChevronRight, Moon, Sun } from 'lucide-react';
import { lazy, Suspense, useEffect, useReducer, useRef, useState } from 'react';
import { SearchField } from '../../components/Input';
import { OverlayProvider } from '../../components/Overlay';
import { ToastViewport } from '../../components/Toast';
import { Toolbar, ToolbarButton, ToolbarTitle } from '../../components/Toolbar';
import type { WindowInfo } from '../../../shared/ipc';
import { toggledTheme } from '../../../shared/theme';
import {
  canGoBack,
  canGoForward,
  currentRoute,
  navInit,
  navReducer,
  parseRoute,
  routeHref,
  type Route,
} from '../lib/router';
import { shortcutLabel } from '../lib/settings-helpers';
import { OpportunitiesPage } from '../pages/opportunities/OpportunitiesPage';
import { DeadlinesPage } from '../pages/deadlines/DeadlinesPage';
import { PipelinePage } from '../pages/pipeline/PipelinePage';
import { ProgramsPage } from '../pages/programs/ProgramsPage';
import { PlaceholderPage } from '../pages/PlaceholderPage';
import { SettingsPage } from '../pages/SettingsPage';
import { useScan } from '../state/scan';
import { useSettings } from '../state/settings';
import { useAppliedTheme } from '../state/theme';
import { navItem, ROUTE_TITLES } from './nav';
import { ScanPill } from './ScanStatus';
import { Sidebar } from './Sidebar';

const ComponentsPage = lazy(() =>
  import('../pages/ComponentsPage').then((m) => ({ default: m.ComponentsPage })),
);

function Page({ route, info, query }: { route: Route; info: WindowInfo | null; query: string }) {
  if (route === 'opportunities') {
    return <OpportunitiesPage query={query} isPackaged={info?.isPackaged ?? true} />;
  }
  if (route === 'pipeline') return <PipelinePage />;
  if (route === 'deadlines') return <DeadlinesPage />;
  if (route === 'programs') return <ProgramsPage />;
  if (route === 'settings') return <SettingsPage isPackaged={info?.isPackaged ?? true} />;
  if (route === 'components') {
    return (
      <Suspense fallback={null}>
        <ComponentsPage />
      </Suspense>
    );
  }
  const n = navItem(route);
  return <PlaceholderPage title={ROUTE_TITLES[route]} description={n?.description ?? ''} />;
}

export function AppShell({ info }: { info: WindowInfo | null }) {
  const { settings, update } = useSettings();
  const resolved = useAppliedTheme(settings?.theme);
  const { scanNow } = useScan();
  const [nav, dispatch] = useReducer(navReducer, undefined, () =>
    navInit(parseRoute(window.location.hash, true)),
  );
  const route = currentRoute(nav);
  const searchRef = useRef<HTMLInputElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const allowDev = info ? !info.isPackaged : true;
  const go = (r: Route) => dispatch({ type: 'go', route: r });
  const [query, setQuery] = useState('');
  const [rootHost, setRootHost] = useState<HTMLDivElement | null>(null);
  const [columnHost, setColumnHost] = useState<HTMLDivElement | null>(null);

  // Packaged builds have no dev routes.
  useEffect(() => {
    if (!allowDev && route === 'components') dispatch({ type: 'go', route: 'opportunities' });
  }, [allowDev, route]);

  // Mirror the route to the hash (reload keeps the page) and reset scroll.
  useEffect(() => {
    window.history.replaceState(null, '', routeHref(route));
    contentRef.current?.scrollTo({ top: 0 });
  }, [route]);

  // External hash changes (shots, manual edits) navigate too.
  useEffect(() => {
    const onHash = () =>
      dispatch({ type: 'go', route: parseRoute(window.location.hash, allowDev) });
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, [allowDev]);

  // Shortcuts: Ctrl/Cmd+K search, Ctrl/Cmd+, settings, Alt+Left/Right back/forward.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        searchRef.current?.focus();
      } else if (mod && e.key.toLowerCase() === 'r' && !e.shiftKey) {
        // Ctrl/Cmd+R scans (design ⌘R); the app menu has no Reload accelerator.
        e.preventDefault();
        scanNow();
      } else if (mod && e.key === ',') {
        e.preventDefault();
        dispatch({ type: 'go', route: 'settings' });
      } else if (e.altKey && e.key === 'ArrowLeft') {
        dispatch({ type: 'back' });
      } else if (e.altKey && e.key === 'ArrowRight') {
        dispatch({ type: 'forward' });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [scanNow]);

  return (
    <OverlayProvider hosts={{ column: columnHost, window: rootHost }}>
      <div className="relative flex h-full w-full">
        <div
          aria-hidden="true"
          className="sidebar-blobs absolute inset-y-0 left-0 w-(--sidebar-width) overflow-hidden"
        >
          <div className="sidebar-blob sidebar-blob-1" />
          <div className="sidebar-blob sidebar-blob-2" />
        </div>

        <Sidebar route={route} onNavigate={go} platform={info?.platform} />

        <div className="relative flex min-w-0 flex-1 flex-col bg-bg">
          <Toolbar>
            <div className="flex gap-0.5">
              <ToolbarButton
                icon={ChevronLeft}
                size={18}
                tone="tertiary"
                label="Back"
                disabled={!canGoBack(nav)}
                onClick={() => dispatch({ type: 'back' })}
              />
              <ToolbarButton
                icon={ChevronRight}
                size={18}
                tone="tertiary"
                label="Forward"
                disabled={!canGoForward(nav)}
                onClick={() => dispatch({ type: 'forward' })}
              />
            </div>
            <ToolbarTitle>{ROUTE_TITLES[route]}</ToolbarTitle>
            <SearchField
              ref={searchRef}
              aria-label="Search"
              placeholder="Search roles, companies, sources"
              shortcut={shortcutLabel(info?.platform, 'K')}
              className="ml-auto max-w-(--search-max) flex-1"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                // Search filters the Opportunities list, so typing elsewhere goes there.
                if (route !== 'opportunities') go('opportunities');
              }}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  setQuery('');
                  e.currentTarget.blur();
                }
              }}
            />
            <ScanPill />
            <ToolbarButton
              icon={resolved === 'dark' ? Sun : Moon}
              label={
                resolved === 'dark' ? 'Switch to light appearance' : 'Switch to dark appearance'
              }
              disabled={!settings}
              onClick={() => void update('theme', toggledTheme(resolved), { toast: false })}
            />
          </Toolbar>

          <main
            ref={contentRef}
            className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto px-8 pt-7 pb-12"
          >
            <Page route={route} info={info} query={query} />
          </main>

          <ToastViewport />
          {/* Drawer and bulk bar render here so they stay put while content scrolls. */}
          <div ref={setColumnHost} className="contents" />
        </div>
        {/* Dialogs render here, above the whole window. */}
        <div ref={setRootHost} className="contents" />
      </div>
    </OverlayProvider>
  );
}
