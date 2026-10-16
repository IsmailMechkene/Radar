import { useRef, type KeyboardEvent } from 'react';
import { BrandMark } from '../../components/Brand';
import { SidebarItem } from '../../components/SidebarItem';
import { routeHref, type Route } from '../lib/router';
import { shortcutLabel } from '../lib/settings-helpers';
import { NAV_PRIMARY, NAV_SECONDARY, type NavItem } from './nav';
import { ScanCard } from './ScanStatus';

function Brand() {
  return (
    <div className="flex items-center gap-2.5 px-5 pt-0.5 pb-4.5">
      <BrandMark />
      <div className="text-callout font-semibold tracking-brand">Radar</div>
    </div>
  );
}

interface SidebarProps {
  route: Route;
  onNavigate: (route: Route) => void;
  platform: string | undefined;
}

/** 240 px translucent sidebar: drag strip, brand, two nav groups, scan status card. */
export function Sidebar({ route, onNavigate, platform }: SidebarProps) {
  const navRef = useRef<HTMLElement>(null);

  // Up/Down move focus between nav items; Home/End jump to the ends.
  function onKeyDown(e: KeyboardEvent<HTMLAnchorElement>) {
    const links = [...(navRef.current?.querySelectorAll('a') ?? [])];
    const i = links.indexOf(e.currentTarget);
    const target =
      e.key === 'ArrowDown'
        ? links[(i + 1) % links.length]
        : e.key === 'ArrowUp'
          ? links[(i - 1 + links.length) % links.length]
          : e.key === 'Home'
            ? links[0]
            : e.key === 'End'
              ? links[links.length - 1]
              : undefined;
    if (target) {
      e.preventDefault();
      target.focus();
    }
  }

  const item = (n: NavItem) => (
    <SidebarItem
      key={n.route}
      href={routeHref(n.route)}
      label={n.label}
      icon={n.icon}
      badge={n.badge}
      active={n.route === route}
      onNavigate={() => onNavigate(n.route)}
      onKeyDown={onKeyDown}
    />
  );

  return (
    <aside className="relative z-2 flex h-full w-(--sidebar-width) shrink-0 flex-col bg-sidebar backdrop-sidebar hairline-r border-line">
      {/* Drag strip where macOS draws traffic lights; on Windows it only moves the window. */}
      <div className="app-drag h-(--toolbar-height) shrink-0" />
      <Brand />
      <nav ref={navRef} aria-label="Main" className="flex flex-col gap-px px-2.5">
        {NAV_PRIMARY.map(item)}
        <div role="separator" className="mx-2.5 my-3 hairline-t border-line" />
        {NAV_SECONDARY.map(item)}
      </nav>
      <div className="mt-auto p-3">
        <ScanCard shortcut={shortcutLabel(platform, 'R')} />
      </div>
    </aside>
  );
}
