# Radar design system

The single reference for all UI work. Read it before touching anything in `src/renderer`.
Use the tokens and components below; never hardcode colors, sizes or fonts in components.

## 1. Source and re-extraction

- **Source of truth:** `design/Radar Overview.html`, exported from Claude Design.
- It is a _bundled page_: the real content is a JSON template plus base64/gzip assets inside
  `<script type="__bundler/...">` tags. The screens live in the embedded `Radar.dc.html`, a
  clickable app that renders any screen (`opportunities`, `deadlines`, `pipeline`, `programs`,
  `outreach`, `sources`, `rules`, `settings`, `components`, `menubar`, `notifications`) in
  `light` or `dark`.
- The Overview file itself only _shows_ the cover, Opportunities and the detail drawer. It links to
  other pages (Design system, States, Settings/First run, ...) that are **not** in the repo; their
  screens are still reachable through `Radar.dc.html`.

To re-extract:

```sh
node scripts/extract-design.mjs "design/Radar Overview.html" <outDir>
```

Then, in `<outDir>/3e3eb6e6-….html` (Radar.dc.html):

| Look for                                         | You get                                                                                    |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------ |
| `TH = {`                                         | every color, shadow and vibrancy token, light and dark                                     |
| `isComponents`                                   | the design-system screen: buttons, pills, inputs, rings, badges, rows, menu, toast, banner |
| `typeScale:` / `spacing:` / `radii:` / `motion:` | type, spacing, radius and motion scales                                                    |
| `isSettings`                                     | the Settings screen markup                                                                 |
| `rc(s)` / `vs(v)` / `chip(`                      | score-ring colors, verdict colors, deadline-chip rules                                     |

`npm run shot` renders any of these screens next to the app (see section 9).

Tokens live in [`src/renderer/theme/tokens.css`](src/renderer/theme/tokens.css). Raw names
(`--bg`, `--sf`, …) are the design's own names, so a value can be checked with a single search.

## 2. Color tokens

Theme is set on `<html data-theme="light|dark">` from the `theme` setting (`system` follows the
OS). Any subtree can pin a theme with `data-theme`. Tailwind classes map to the tokens through
`@theme inline`; Tailwind's default palette is removed, so only these names exist.

| Role                                | Raw token             | Tailwind                           | Light                                            | Dark                                           |
| ----------------------------------- | --------------------- | ---------------------------------- | ------------------------------------------------ | ---------------------------------------------- |
| Window background                   | `--bg`                | `bg-bg`                            | `#F5F5F7`                                        | `#1C1C1E`                                      |
| Surface (cards, rows, inputs)       | `--sf`                | `bg-surface`                       | `#FFFFFF`                                        | `#2C2C2E`                                      |
| Surface 2 (hover on surface)        | `--sf2`               | `bg-surface-2`                     | `#FAFAFC`                                        | `#242426`                                      |
| Fill (hover, chips, search)         | `--fl`                | `bg-fill`                          | `rgba(0,0,0,.04)`                                | `rgba(255,255,255,.05)`                        |
| Fill strong (active nav, track bg)  | `--fl2`               | `bg-fill-2`                        | `rgba(0,0,0,.075)`                               | `rgba(255,255,255,.09)`                        |
| Hairline                            | `--ln`                | `border-line`                      | `rgba(0,0,0,.1)`                                 | `rgba(255,255,255,.09)`                        |
| Hairline strong (controls)          | `--ln2`               | `border-line-2`                    | `rgba(0,0,0,.14)`                                | `rgba(255,255,255,.14)`                        |
| Text                                | `--tx`                | `text-fg`                          | `#1D1D1F`                                        | `#F5F5F7`                                      |
| Text secondary                      | `--tx2`               | `text-fg-2`                        | `#6E6E73`                                        | `#A1A1A6`                                      |
| Text tertiary                       | `--tx3`               | `text-fg-3`                        | `#86868B`                                        | `#8A8A8F`                                      |
| Accent                              | `--ac`                | `bg-accent`                        | `#0A84FF`                                        | `#0A84FF`                                      |
| Accent text (links, plain buttons)  | `--act`               | `text-accent-text`                 | `#0066D6`                                        | `#4DA3FF`                                      |
| Accent soft (selection, focus halo) | `--acs`               | `bg-accent-soft`                   | `rgba(10,132,255,.10)`                           | `rgba(10,132,255,.20)`                         |
| Sidebar vibrancy                    | `--sb`                | `bg-sidebar`                       | `rgba(234,234,239,.66)`                          | `rgba(36,36,40,.62)`                           |
| Glass (popover, toast, scan card)   | `--gl` / `--glb`      | `bg-glass` / `border-glass-border` | `rgba(255,255,255,.74)` / `rgba(255,255,255,.7)` | `rgba(50,50,54,.74)` / `rgba(255,255,255,.08)` |
| Control (selected segment)          | `--ctl`               | `bg-control`                       | `#FFFFFF`                                        | `#636366`                                      |
| Switch track off                    | `--track`             | `bg-track`                         | `rgba(120,120,128,.18)`                          | `rgba(120,120,128,.34)`                        |
| Scrim                               | `--dim`               | `bg-dim`                           | `rgba(0,0,0,.16)`                                | `rgba(0,0,0,.42)`                              |
| Sidebar blobs                       | `--blob1` / `--blob2` | (shell CSS)                        | `oklch(.82 .07 250)` / `oklch(.86 .06 40)`       | `oklch(.42 .08 250)` / `oklch(.38 .06 40)`     |

**Semantic colors.** Each has three tokens: text (`--gr`), soft background (`--grs`), fill/dot (`--grf`).

| Meaning                                 | Text               | Soft bg          | Fill            | Light text / fill     | Dark text / fill      |
| --------------------------------------- | ------------------ | ---------------- | --------------- | --------------------- | --------------------- |
| Strong match, Apply, healthy, confirmed | `text-green`       | `bg-green-soft`  | `bg-green-fill` | `#1A7F37` / `#34C759` | `#30D158` / `#30D158` |
| Maybe, closing soon, slow               | `text-amber`       | `bg-amber-soft`  | `bg-amber-fill` | `#9A5800` / `#FF9F0A` | `#FFB340` / `#FF9F0A` |
| Overdue, broken, destructive            | `text-red`         | `bg-red-soft`    | `bg-red-fill`   | `#C4001A` / `#FF3B30` | `#FF6961` / `#FF453A` |
| Skip, paused                            | `text-gray`        | `bg-gray-soft`   | `bg-gray-fill`  | `#6E6E73` / `#AEAEB2` | `#A1A1A6` / `#636366` |
| Needs review                            | `text-accent-text` | `bg-accent-soft` | —               | accent                | accent                |

Theme-independent: `--on-accent`/`--knob` `#FFF`; settings tiles `--tile-red #FF3B30`,
`--tile-sky #2AABEE`, `--tile-indigo #5E5CE6`, `--tile-gray #8E8E93`, `--tile-blue #0A84FF`,
`--tile-teal #30B0C7`, `--tile-green #34C759`; brand gradient `--brand-from #2D9BFF` →
`--brand-to #0A6CDB`; scan dots `--dot-ok #34C759`, `--dot-scanning #0A84FF`,
`--dot-stale #FF3B30`, `--dot-idle #AEAEB2` (idle is ours, see Deviations).

Contrast (WCAG ratios, measured):

| Pair                             | Light       | Dark        |
| -------------------------------- | ----------- | ----------- |
| `--tx` on `--sf` / `--bg`        | 16.8 / 15.5 | 12.8 / 15.6 |
| `--tx2` on `--sf` / `--bg`       | 5.1 / 4.7   | 5.4 / 6.6   |
| `--tx3` on `--sf` / `--bg`       | 3.6 / 3.3   | 4.1 / 5.0   |
| `--act` on `--sf`                | 5.4         | 5.3         |
| white on `--ac` (primary button) | 3.65        | 3.65        |

`--tx`, `--tx2` and `--act` pass AA everywhere. `--tx3` is below AA in light: use it only for
tertiary meta text and placeholders, never for the only copy of important information. White on
the accent (3.65) passes only AA-large; primary buttons keep it because labels are 13 px
semibold and the design uses it, but don't put long text on accent fills.

## 3. Typography

- **Font stack** (`font-sans`): `-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'SF Pro Display', Inter, 'Helvetica Neue', sans-serif`.
  On Windows this resolves to **Inter**, bundled locally via `@fontsource/inter` (400/500/600/700). No CDN.
- **Mono** (`font-mono`): `ui-monospace, 'SF Mono', Menlo, Consolas, monospace` (paths, specs).
- Base: 13 px, line-height 1.4, letter-spacing −0.003 em, antialiased.
- **Tabular numerals** (`tabular-nums`) for scores, counts, dates, times and anything that updates in place.

| Token (Tailwind `text-*`) | Size | Weight  | Tracking (`tracking-*`)        | Use                                   |
| ------------------------- | ---- | ------- | ------------------------------ | ------------------------------------- |
| `large-title`             | 34   | 600     | `large-title` −0.03 em         | Design-system page title              |
| `title-1`                 | 30   | 600     | `title-1` −0.025 em, lh 1.1    | Page titles (Opportunities, Settings) |
| `title-2`                 | 22   | 600     | `title-2` −0.02 em, lh 1.22    | Drawer title                          |
| `title-3`                 | 17   | 600     | `title-3` −0.01 em             | Section titles                        |
| `callout`                 | 15   | 600     | `brand` −0.015 em              | Brand name in the sidebar             |
| `headline`                | 14   | 600     | `title-3` −0.01 em             | Card headline, toolbar title          |
| `body`                    | 13   | 400     | body                           | Rows, settings, buttons, menus        |
| `subhead`                 | 12.5 | 400–600 | body                           | Scan card, segmented control, banners |
| `footnote`                | 12   | 400     | body                           | Secondary/tertiary row lines, pills   |
| `caption`                 | 11.5 | 400–600 | body                           | Badges, setting descriptions          |
| `caption-2`               | 11   | 600     | `caps` +0.06 em when uppercase | Count badges, section eyebrows        |
| `micro`                   | 10.5 | 400     | body                           | Token values (mono)                   |

Weights: 400 regular, 500 medium (secondary buttons, chips), 600 semibold (titles, primary buttons, verdicts, active nav).

## 4. Spacing, radius, shadow, borders, blur, motion

- **Spacing:** 4 px base (Tailwind's `--spacing: 4px` multiplier, so `p-4` = 16 px). Design steps: 4, 8, 12, 16, 20, 24, 32, 40, 48.
  Odd values the design uses (7, 10, 14, 22 px) are written as `1.75`, `2.5`, `3.5`, `5.5`.
- **Radius** (Tailwind `rounded-*`): `2xs` 5 (checkbox, kbd), `xs` 6 (small buttons, menu items, time chips), `sm` 7 (buttons, nav items, tiles),
  `md` 8 (inputs, search, segmented track), `lg` 10 (banners), `xl` 12 (popovers, scan card, swatches), `2xl` 14 (settings cards), `3xl` 16 (design-system cards), `full` (pills).
- **Shadow** (`shadow-*`): `card` = `--sh` (level 1, cards), `pop` = `--sh2` (level 2, popovers, toasts, drawers), `window` = `--win`,
  `control` (secondary button), `segment` (selected segment), `knob` (switch knob), `drawer` (drawer edge), `glass-card` (scan card),
  `brand` (logo), `primary` (drawer Apply), `focus` (soft accent halo on fields), `focus-strong` (keyboard focus ring). Level 0 is a hairline only.
- **Borders:** hairline 0.5 px is the default (`hairline`, `hairline-t/-b/-l/-r` utilities, colored with `border-line`/`border-line-2`).
  1 px for focused/invalid fields, unchecked checkboxes and dashed "expected" badges; 1.5 px only on the logo ring.
  At 100% scaling Chromium draws 0.5 px as one device pixel, same as the design renders on this machine.
- **Blur / vibrancy:** sidebar `backdrop-sidebar` = blur 40 px + saturate 180%; glass `backdrop-glass` = blur 30 px + saturate 180%.
- **Motion:**

| Motion                            | Duration / easing                           | Token                              |
| --------------------------------- | ------------------------------------------- | ---------------------------------- |
| Default transition (hover, color) | 200 ms ease-out                             | `duration-(--duration-base)`       |
| Nav item background               | 150 ms ease-out                             | `--duration-fast`                  |
| Row hover lift                    | 220 ms ease-out                             | `--duration-lift`                  |
| Switch knob                       | 250 ms, spring overshoot 1.4                | `--duration-switch`, `ease-spring` |
| Drawer                            | 300 ms                                      | `animate-drawer-in`, `ease-drawer` |
| Popovers, menus                   | scale 0.96 → 1 + fade, 180 ms               | `animate-pop-in`, `ease-pop`       |
| Score ring                        | count up from 0, 600 ms ease-out            | `ScoreRing animate`                |
| Toast                             | rise 8 px + fade 250 ms, auto-dismiss 2.8 s | `animate-toast-in`, `TOAST_MS`     |

`prefers-reduced-motion` shortens every animation and transition to 1 ms, and the score ring skips counting.

## 5. Layout

- **Window:** opens **maximized** (full work area; 1920 × 1040 on a 1080p screen with a taskbar). Minimum 1100 × 700.
- **Sidebar:** 240 px (`--sidebar-width`), full height, translucent (`bg-sidebar backdrop-sidebar`) with two color blobs behind it, hairline on the right.
  Top 52 px is a drag strip, then brand row (`px-5 pt-0.5 pb-4.5`), nav (`px-2.5`, 1 px gaps, separator `mx-2.5 my-3`), scan card pinned to the bottom (`p-3`).
- **Toolbar:** 52 px (`--toolbar-height`), `pl-5`, gap 10 px, hairline bottom; it is the window drag region. Order: back/forward, page title (min 110 px),
  search (flex, max 420 px, pushed right), status pill, theme button. On Windows the right padding grows by the native-controls width.
- **Content:** scrolls under the toolbar; padding 28 px top, 32 px sides, 48 px bottom (`px-8 pt-7 pb-12`).
- **Settings column:** 680 px centered (`--content-max-settings`). Group gap 22 px.
- **Drawer:** 520 px at ≥ 1200 px window width, 440 px below (`--drawer-width`, `--drawer-width-narrow`); starts below the toolbar.
- **Popover:** 240 px wide by default (`--popover-width`), 4 px below its anchor.
- **Toast:** centered at the bottom of the content column, 24 px up.

## 6. Components

All live in `src/renderer/components`. Every interactive one has a visible keyboard focus ring
(`focus-ring` utility: 3 px accent ring at 45%), a disabled state at 40% opacity, and an accessible name.
The dev-only **Components** page (`#/components`, unpackaged builds only) shows all of them in light and dark.

| Component                                                | File                   | Variants / states                                                                                                                                                                                                                         | Usage rules                                                                                                                                                                                                                                       |
| -------------------------------------------------------- | ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Button**                                               | `Button.tsx`           | `primary` (accent, 600), `secondary` (surface + hairline + control shadow, 500), `plain` (accent text), `destructive` (red fill); sizes `sm` 24 / `md` 28 / `lg` 30; `iconOnly` square; hover darkens 4%, press scales 0.98; disabled 40% | One primary per view. Destructive only for irreversible actions. Icons 14 px (12 small).                                                                                                                                                          |
| **FilterPill**                                           | `Pill.tsx`             | inactive (surface + hairline, chevron) / active (accent soft + accent text, ×); 26 px                                                                                                                                                     | Table filters. Active filters are always tinted.                                                                                                                                                                                                  |
| **Chip**                                                 | `Pill.tsx`             | default (fill + hairline) / danger (red soft); optional remove × button; 24 px                                                                                                                                                            | Keyword and list values (roles, regions, rule words).                                                                                                                                                                                             |
| **Tag / MetaChip**                                       | `Pill.tsx`             | Tag: 20 px accent soft, radius 6 (merge fields). MetaChip: 20 px fill pill with 11 px icon (Remote, On-site)                                                                                                                              | Meta information inside rows and cards.                                                                                                                                                                                                           |
| **Badge**                                                | `Badge.tsx`            | tones `green`, `amber`, `red`, `accent`, `gray`, `neutral`, `outline`, `expected` (dashed `--tx3`); `strong` (600) for verdicts; `dashed` for inferred dates; optional 12 px icon; 22 px                                                  | Verdicts: Apply green, Maybe amber, Needs review accent, Skip gray (`VerdictBadge`). Deadlines: ≤ 7 days amber, overdue red, inferred `~ Dec 15` dashed, none = outline. Confirmed = green + circle-check; Expected = `expected` + circle-dashed. |
| **CountBadge**                                           | `Badge.tsx`            | `accent` (solid), `amber`, `red`, `gray`; 11/600 tabular                                                                                                                                                                                  | Sidebar counts. Solid accent only for "new".                                                                                                                                                                                                      |
| **StatusDot**                                            | `Badge.tsx`            | `healthy`, `slow`, `broken`, `paused`; 8 px with 3 px soft halo                                                                                                                                                                           | Source health. Scan state uses `ScanDot` (shell).                                                                                                                                                                                                 |
| **Switch**                                               | `Switch.tsx`           | on (accent) / off (track) / disabled; 36 × 22, knob 18 on a spring                                                                                                                                                                        | Settings toggles. Always has `label`. Saves immediately.                                                                                                                                                                                          |
| **SegmentedControl**                                     | `SegmentedControl.tsx` | text or `iconOnly`; selected = control bg + segment shadow + 500; 24 px segments in a fill track                                                                                                                                          | 2–4 mutually exclusive options. Arrow keys move the selection.                                                                                                                                                                                    |
| **TextInput**                                            | `Input.tsx`            | `md` 32 px (surface + hairline) / `sm` 24 px filled chip; focus 1 px accent + soft halo; `invalid` red border + text                                                                                                                      | Text fields commit on Enter or blur in Settings. Escape reverts.                                                                                                                                                                                  |
| **SearchField**                                          | `Input.tsx`            | 30 px fill + hairline, search icon, `Kbd` hint; hover fill-2; focus halo                                                                                                                                                                  | Toolbar search only. Ctrl+K (⌘K on macOS) focuses it.                                                                                                                                                                                             |
| **Kbd**                                                  | `Input.tsx`            | 11 px on surface, hairline, radius 5                                                                                                                                                                                                      | Shortcut hints. Use `shortcutLabel()` for the platform modifier.                                                                                                                                                                                  |
| **Select**                                               | `Select.tsx`           | `sm` 26 px inline trigger / `md` 32 px field, chevrons-up-down; glass listbox; `filterable` adds a filter field                                                                                                                           | Pick one of many. Use `filterable` for long lists (time zones). Keyboard: ↓/↑ open and move, Enter picks, Esc closes.                                                                                                                             |
| **Checkbox**                                             | `Checkbox.tsx`         | checked (accent + check) / unchecked (1 px line-2); 16 px, radius 5                                                                                                                                                                       | Row selection.                                                                                                                                                                                                                                    |
| **TableRow / RowTitle**                                  | `TableRow.tsx`         | 56 px, hairline top, no zebra; hover `fill`, selected `accent-soft`; title 13/600 over 12 px tertiary reason with a secondary lead                                                                                                        | Opportunity-style tables.                                                                                                                                                                                                                         |
| **ScoreRing**                                            | `ScoreRing.tsx`        | sizes `xl` 88 / `lg` 64 / `md` 44 / `sm` 32 (stroke 3.4, 4 at 32); color green ≥ 75, amber ≥ 55, gray below; `animate` counts up                                                                                                          | The only colorful element in a table row. Track is `--fl2`.                                                                                                                                                                                       |
| **Drawer / DrawerClose**                                 | `Drawer.tsx`           | 520 / 440 px, slides from right below the toolbar, drawer shadow; Esc closes; focus moves in and back                                                                                                                                     | Detail views over a table. Header 20/24 px padding, title `title-2`.                                                                                                                                                                              |
| **Popover / Menu**                                       | `Popover.tsx`          | glass, radius 12, `pop` shadow, 5 px padding; items 28 px, highlighted item accent-filled, destructive red, shortcut right at 70%                                                                                                         | Context menus and select lists. Closes on outside click and Esc.                                                                                                                                                                                  |
| **Toast**                                                | `Toast.tsx`            | 40 px glass pill; `success` (green check) / `error` (red ×); optional action (Undo); one at a time                                                                                                                                        | Confirm every save. Errors say what failed ("Not saved: …") and stay 6 s.                                                                                                                                                                         |
| **Banner**                                               | `Banner.tsx`           | `danger` (red soft) / `warning` (amber soft); triangle-alert icon; optional description and trailing action                                                                                                                               | Inline problems: stale scans, broken sources, page changed.                                                                                                                                                                                       |
| **SidebarItem**                                          | `SidebarItem.tsx`      | 32 px; active = fill-2 + 600 + accent icon; hover fill; optional CountBadge                                                                                                                                                               | Main navigation. `aria-current="page"` on the active item; ↑/↓/Home/End move focus.                                                                                                                                                               |
| **Toolbar / ToolbarTitle / ToolbarButton / ToolbarPill** | `Toolbar.tsx`          | 52 px drag region; 28 px icon buttons (`secondary` 16 px icons, `tertiary` 18 px chevrons, disabled 50%); 28 px status pill                                                                                                               | One toolbar per window.                                                                                                                                                                                                                           |
| **GroupedSection / GroupedRow / IconTile**               | `GroupedList.tsx`      | section title 13/600; radius-14 card with `card` shadow; rows min 48 px, 16 px padding, hairline between; 26 px colored tile with 14 px white icon (stroke 2); `below` slot for chip lists                                                | Settings-style lists. One tile color per row from the tile palette.                                                                                                                                                                               |
| **Icon**                                                 | `Icon.tsx`             | Lucide, stroke 1.5 default (2 in tiles, 3 for checks); sizes 11–18                                                                                                                                                                        | Every icon. Decorative icons are `aria-hidden`.                                                                                                                                                                                                   |

Shell pieces (`src/renderer/src/shell`): `Sidebar` (brand, nav, scan card), `ScanCard` / `ScanPill` / `ScanDot`,
`AppShell` (router, toolbar, content, toast viewport). Page title: `PageTitle` (30/600 + 13 px secondary subtitle).

## 7. Do / Don't

- **Do** use tokens through Tailwind classes or `var(--…)`. **Don't** write hex/rgb values, px font sizes or font names in components.
  (Exceptions that must stay literal are in `tokens.css` and `shared/theme.ts`, which a test keeps in sync.)
- **Do** keep the score ring the only colorful element in a table row; verdict and deadline badges use soft tints.
- **Don't** use emoji in the UI. Icons are thin-stroke **Lucide** (`lucide-react`, stroke 1.5).
- **Do** use hairlines (0.5 px) for borders and separators; **don't** add zebra striping or heavy dividers.
- **Do** keep one accent color. Green/amber/red/gray carry meaning only (match, soon, broken, skip).
- **Do** show an honest empty or idle state instead of sample data (no fake counts beyond the marked sidebar placeholders).
- **Do** confirm every save with a toast and offer Undo when the change is reversible; **never** fail silently.
- **Do** give every control a visible label or `aria-label`, and keep everything reachable by keyboard.
- **Don't** draw fake macOS traffic lights. Window controls are native per platform.
- **Do** use `tabular-nums` for numbers that line up or change.
- **Don't** add controls that do nothing yet. Leave them out until the feature exists.

## 8. Window chrome by platform

| Platform                         | Title bar                                                                                       | Backdrop                                                                                          | Status                                            |
| -------------------------------- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| Windows 11 22H2+ (build ≥ 22621) | Hidden; native min/max/close via `titleBarOverlay` (51 px, colors = `--bg` / `--tx2` per theme) | `backgroundMaterial: 'mica'`; page background transparent, sidebar `--sb` over Mica, blobs hidden | In code, **untested** (dev machine is Windows 10) |
| Windows 10 / older               | Same overlay                                                                                    | None: solid `--bg` window, CSS blobs + `--sb` + backdrop blur reproduce the design's vibrancy     | **Tested**                                        |
| macOS                            | `hiddenInset`, native traffic lights at (20, 20) in the sidebar's 52 px drag strip              | `vibrancy: 'sidebar'`                                                                             | In code, **untested**                             |
| Linux                            | Same overlay as Windows                                                                         | None                                                                                              | Untested                                          |

The overlay colors update when the theme changes (`nativeTheme.themeSource` + `setTitleBarOverlay`).
The material choice is a pure function (`src/main/window-material.ts`), exposed to the page as
`<html data-material>` through `window.radar.app.getWindowInfo()`.

## 9. Checking against the design

```sh
npm run shot
```

Builds, opens the app (with a throwaway profile) and the design file in windows of the same size
(the primary display's work area), and saves PNGs in light and dark to `shots/` (git-ignored):
`app-<route>-<theme>.png`, `design-<route>-<theme>.png`, long pages as `-2`, `-3`… parts, plus
`shots/compare.html` showing them side by side. Pages compared: Opportunities (shell only for now),
Settings, Components.

## 10. Deviations from the design file

| What                                                                                       | Design                                                                       | App                                                                                                                                         | Why                                                                                                                     |
| ------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Window controls                                                                            | macOS traffic lights drawn in the sidebar                                    | Native Windows controls in the toolbar's top-right (`titleBarOverlay`); sidebar keeps an empty 52 px drag strip                             | Brief: no fake macOS buttons on Windows                                                                                 |
| Window size                                                                                | 1440 × 900 frame                                                             | Opens maximized (full work area)                                                                                                            | User request: full screen, not 1440 × 900                                                                               |
| Design screenshots height                                                                  | Fixed 900 px                                                                 | App fills 1040 px                                                                                                                           | The design's `Radar.dc.html` hard-codes a 900 px height; only width follows the window                                  |
| Sidebar vibrancy                                                                           | CSS backdrop blur over blobs (simulating macOS)                              | Same on Windows 10; Mica on Windows 11 22H2+ (untested); macOS vibrancy (untested)                                                          | Native material where the OS has one                                                                                    |
| Font                                                                                       | SF Pro (system) with Inter fallback                                          | Inter, bundled via `@fontsource/inter`                                                                                                      | SF Pro is unavailable on Windows; Inter is the design's own fallback. The design renders with Inter on this machine too |
| Mono font                                                                                  | `ui-monospace, 'SF Mono', Menlo, monospace`                                  | Adds `Consolas` before `monospace`                                                                                                          | Closest Windows equivalent                                                                                              |
| Shortcut labels                                                                            | ⌘K, ⌘R                                                                       | `Ctrl K`, `Ctrl R` on Windows/Linux, ⌘ on macOS                                                                                             | Platform convention                                                                                                     |
| Keyboard focus ring                                                                        | Buttons: 3 px `--acs` (10% accent)                                           | 3 px accent at 45% (`shadow-focus-strong`)                                                                                                  | The design's ring is too faint to meet "visible focus" on light surfaces                                                |
| Toolbar                                                                                    | Shortcuts (keyboard) button; list/grid toggle on Opportunities               | Not shown                                                                                                                                   | No shortcuts overlay or grid view exists yet; only working controls are shown                                           |
| Scan status                                                                                | "Last scan 14 min ago", green dot, working Scan now                          | "No scans yet / Add sources to start scanning", gray `--dot-idle`, Scan now disabled; toolbar pill "Not scanned"                            | No scanner yet; sample data would be dishonest                                                                          |
| Sidebar counts                                                                             | 12 new, 3 due, 2, 1, 1                                                       | Same values, marked PLACEHOLDER in `shell/nav.ts`                                                                                           | Brief: placeholder values until data exists                                                                             |
| Settings: profile card, Desktop notifications, Telegram, Backups, Export, Erase            | Present                                                                      | Left out                                                                                                                                    | Brief: only controls that work; no Telegram/alerts yet; backup/export come later (M7)                                   |
| Settings: Search mode, Roles, Regions, Remote preference, Grade, Scan interval, Appearance | Not in the design's Settings screen                                          | Added as rows in the same grouped-list style (tiles from the design's tile palette)                                                         | Required by the brief and SPEC; built only from existing tokens and components                                          |
| Settings descriptions                                                                      | "Hold notifications, deliver a summary after"; "Runs scans in the menu bar…" | "Hold notifications during these hours"; "Start Radar in the tray when you sign in" (+ "Not applied in development builds" when unpackaged) | Don't promise behavior that doesn't exist; Windows wording                                                              |
| Grade                                                                                      | Not in design                                                                | Text field + dashed "Unverified" badge (the design's "Expected, unconfirmed" style)                                                         | Brief: raw "15/20", shown as unverified                                                                                 |
| Error toast                                                                                | Only success toast designed                                                  | Red × variant, 6 s                                                                                                                          | Never fail silently                                                                                                     |
| Motion                                                                                     | Drawer spring 300/30, popover spring 400/32                                  | CSS curves: drawer `cubic-bezier(.32,.72,0,1)` 300 ms; popover `cubic-bezier(.2,.9,.3,1.15)` 180 ms                                         | CSS has no spring physics; curves approximate them                                                                      |
| Back/forward                                                                               | Present                                                                      | Present and working (in-app history; Alt+←/→)                                                                                               | —                                                                                                                       |
| Toolbar bottom hairline under controls                                                     | n/a                                                                          | Native controls overlay is 51 px (1 px shorter than the toolbar)                                                                            | Keeps the hairline continuous under the controls                                                                        |
