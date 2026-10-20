# Time Stone design system

## Sources and scope

This redesign uses the actual `emilkowalski/skills` repository (`main`) as design-engineering guidance. Relevant skills read: `emil-design-eng`, `apple-design`, `animate`, `mobile-native`, `animation-performance`, `break-ui`, and `pick-ui-library`. The repo contains many task-specific skills, **not** one official palette or layout. We translated the applicable principles into this React/Next.js product rather than pretending the repository prescribed exact colors. Swift, Expo, prototyping, and read-only audit workflows were not applied to this web implementation.

The earlier `liquid-glass` v1.2.0 guidance still informs **layer separation**: limited translucency on the top navigation, never on content tables or cards. This is CSS translucency, not Apple's native lensing.

## Visual direction

**Editorial operations.** A deep-forest navigation rail anchors a warm off-white canvas; information sits on crisp white surfaces. Muted jade communicates active actions and real progress. No decorative neon, fake trend charts, rainbow gradients, or blanket blur.

| Token | Value | Use |
| --- | --- | --- |
| `--bg` | `#f6f7f4` | Canvas |
| `--sidebar` | `#142522` | Navigation |
| `--panel` | `#ffffff` | Data surfaces |
| `--text` | `#17241f` | Primary ink |
| `--muted` | `#66756e` | Supporting text |
| `--lime` | `#267455` | Primary action and meaningful emphasis (legacy token name retained for compatibility) |
| `--red`, `--amber` | `#bf5b56`, `#a76b32` | Negative and warning states |

Typography uses Inter if present and Segoe UI/system fallbacks. Headings have tight tracking and deliberately generous line height; data rows use tabular numerals. Cards use subtle shadows and light borders instead of heavy outlines. Component radii are consistently 8/16/22px.

## Layout hierarchy

- **Sidebar:** grouped Overview, Workspace, Your Work, Insights & Control navigation. It is solid and stable, not a glass content pane. Current organization and development-role context are explicit.
- **Toolbar:** sticky and lightly translucent; search immediately opens the filtered employee directory. Timer, notifications, and role context remain reachable.
- **Dashboard:** live weekly context in a compact editorial overview band, then real metric tiles, then analytical panels. The old arbitrary sparkline marks were removed because they had no corresponding data.
- **Content:** opaque tables, lists, charts, project cards, task rows, reports, filter bars, and settings. Long values have `min-width: 0` and scrollable table wrappers.
- **Transient layer:** modal uses an opaque form over a dimmed scrim. Sonner handles API feedback rather than a custom toast component.

## Motion decisions

The `animate` and `emil-design-eng` decision framework gates every animation:

| Frequency / purpose | Implementation |
| --- | --- |
| Frequent navigation and typing | Instant state updates; no route/page transition |
| Pointer-down feedback | `scale(.97)` on enabled buttons, 120ms `--ease-out: cubic-bezier(.23,1,.32,1)` |
| Mobile drawer | `transform` only, 240ms `--ease-drawer: cubic-bezier(.32,.72,0,1)` |
| Hover | Color feedback only, gated behind `(hover:hover) and (pointer:fine)` |
| Data cards and charts | No entrance animation; data is meant to be read, not moved |

No `transition: all`, `scale(0)` entrance, layout-property animation, animated backdrop blur, or springs without a real gesture. Reduced motion disables movement while retaining immediate state changes. The topbar's passive scroll handler toggles shadow separation, not an animated blur.

## Mobile-native baseline

- Dynamic viewport units (`100dvh`) with fallback; `viewport-fit=cover` and safe-area padding.
- `-webkit-tap-highlight-color: transparent`, `touch-action: manipulation`, and immediate `:active` feedback.
- Controls are non-selectable; actual content remains selectable.
- Coarse-pointer inputs/selects are at least 16px to avoid iOS Safari focus zoom. Zoom itself is never disabled.
- Root overscroll is contained; internal table and sidebar scrolling retain their own behavior.
- Safe-area-aware top bar and modal. Real-device testing remains required: desktop emulation cannot prove Safari's keyboard, notch, or sticky-hover behavior.

## Accessibility and stress tolerance

- `:focus-visible` ring; icon buttons are labelled; active navigation uses `aria-current`; statuses have text as well as color.
- Dialog traps focus, focuses an input on open, supports Escape, and restores focus on close.
- `prefers-reduced-motion`, `prefers-reduced-transparency`, and `prefers-contrast` fallbacks.
- Table wrappers allow horizontal scrolling instead of clipping data. Long organization names, role labels, card copy, and email metadata are constrained or wrapped where needed. `break-ui` motivated these safeguards; an automated multi-viewport/RTL/200%-zoom screenshot suite is not yet configured and should not be claimed as passed.

## Component choices

The curated `pick-ui-library` skill recommends Sonner for toasts; it is installed and used. We kept native selects for simple forms (no custom popover physics needed) and plain CSS for press/drawer transitions (no motion library needed). The existing application API and PostgreSQL workflows were not replaced or mocked by the redesign.
