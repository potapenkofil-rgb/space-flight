/**
 * The black-box panel (PLAN.md §7 Agent F): composes the timeline scrubber,
 * the four telemetry charts, and the "start from marker" action into one
 * bottom-docked panel (DESIGN.md §3: dock to an edge, never float).
 *
 * **Collapsed by default.** DESIGN.md §3 reserves the HUD's own edge slots
 * (throttle left, altitude/speed right, lamp row along the very bottom) and
 * forbids floating windows — a full-height chart panel permanently up over
 * that same bottom edge covers the speed readout and clips the throttle
 * gauge entirely (caught during integration from a screenshot, not a test —
 * the automated "no panel overlaps the centre" check doesn't cover
 * panel-over-panel occlusion). So only a narrow timeline strip, inset
 * between the throttle and speed columns, shows by default; the toggle
 * button (or `B`, wired by the caller) expands it to the full header +
 * charts view, still confined to that same horizontal inset so the throttle
 * gauge and speed readout are never covered in either state.
 *
 * This module owns *presentation* only. Wiring it into an actual flight —
 * constructing the `ReplaySession` from a live `FlightRecorder`, and turning
 * "start from here" into a real branched recording via `startFromReplay` —
 * is the caller's job (see `onStartFromHere`'s doc).
 */
import { computeTelemetrySeries, type ReplaySession, type Vessel } from '@karman/core';
import './replay.css';
import { mountCharts, type Charts } from './charts';
import { mountTimeline, type Timeline } from './timeline';

const DEFAULT_SAMPLE_COUNT = 120;

export interface ReplayPanelOptions {
  readonly session: ReplaySession;
  /** Which vessel's telemetry to chart (PLAN.md §7: multiple vessels can be in flight at once). */
  readonly vesselId: number;
  /** Formats a simulation-time value for display (typically `math/units`'s formatting, locale-aware). */
  readonly formatTime: (t: number) => string;
  /** The active `i18n`'s `t()` — injected so this module has no direct dependency on where `i18n/` lives. */
  readonly t: (key: string) => string;
  /** How many points to chart across the whole recorded span. Default 120. */
  readonly sampleCount?: number;
  /** Starts expanded instead of collapsed. Default `false` (DESIGN.md §3: closed by default). */
  readonly startExpanded?: boolean;
  /** Called whenever the user scrubs the timeline, with the reconstructed vessel roster at that time. */
  readonly onSeek?: (t: number, vessels: readonly Vessel[]) => void;
  /**
   * Called when the user clicks "start from here". Hands back the
   * reconstructed vessel roster at the scrubbed time — the caller is
   * responsible for actually branching a new recording from it (typically
   * via `startFromReplay` from `@karman/core`, which additionally needs a
   * `WorldStepFn` the flight scene owns).
   */
  readonly onStartFromHere?: (t: number, vessels: readonly Vessel[]) => void;
}

export interface ReplayPanel {
  /** Whether the full header+charts view is currently showing. */
  isExpanded(): boolean;
  /** Expands or collapses the panel down to just the timeline strip. */
  setExpanded(expanded: boolean): void;
  unmount(): void;
}

export function mountReplayPanel(root: HTMLElement, options: ReplayPanelOptions): ReplayPanel {
  const { session, vesselId, formatTime, t } = options;
  const sampleCount = options.sampleCount ?? DEFAULT_SAMPLE_COUNT;

  const panel = document.createElement('div');
  panel.className = 'replay-panel';
  panel.dataset['testid'] = 'replay-panel';
  panel.dataset['expanded'] = String(options.startExpanded ?? false);

  // Always visible, even collapsed: a compact label and the expand/collapse toggle.
  const toggleRow = document.createElement('div');
  toggleRow.className = 'replay-toggle-row';
  const title = document.createElement('div');
  title.className = 'label';
  title.textContent = t('REPLAY_TIMELINE');
  const toggleButton = document.createElement('button');
  toggleButton.type = 'button';
  toggleButton.className = 'replay-toggle';
  toggleButton.dataset['testid'] = 'replay-toggle';
  toggleRow.append(title, toggleButton);

  // Hidden while collapsed (DESIGN.md §3 — see module doc).
  const collapsible = document.createElement('div');
  collapsible.className = 'replay-collapsible';

  const header = document.createElement('div');
  header.className = 'replay-panel-header';

  const startFromHereButton = document.createElement('button');
  startFromHereButton.type = 'button';
  startFromHereButton.className = 'replay-start-from-here';
  startFromHereButton.textContent = t('REPLAY_START_FROM_HERE');
  startFromHereButton.dataset['testid'] = 'replay-start-from-here';

  header.append(startFromHereButton);

  const chartsHost = document.createElement('div');
  collapsible.append(header, chartsHost);

  const timelineHost = document.createElement('div');

  panel.append(toggleRow, collapsible, timelineHost);
  root.appendChild(panel);

  function renderToggle(): void {
    const expanded = panel.dataset['expanded'] === 'true';
    toggleButton.textContent = expanded ? `▾ ${t('REPLAY_COLLAPSE')}` : `▴ ${t('REPLAY_EXPAND')}`;
  }
  renderToggle();

  let currentTime = session.startTime;
  const charts: Charts = mountCharts(chartsHost, { t });
  charts.update(computeTelemetrySeries(session, vesselId, sampleCount));

  const timeline: Timeline = mountTimeline(timelineHost, {
    session,
    formatTime,
    t,
    onSeek(time) {
      currentTime = time;
      options.onSeek?.(time, session.seekTo(time));
    },
  });

  function setExpanded(expanded: boolean): void {
    panel.dataset['expanded'] = String(expanded);
    renderToggle();
  }

  function onStartFromHereClick(): void {
    options.onStartFromHere?.(currentTime, session.seekTo(currentTime));
  }
  startFromHereButton.addEventListener('click', onStartFromHereClick);

  function onToggleClick(): void {
    setExpanded(panel.dataset['expanded'] !== 'true');
  }
  toggleButton.addEventListener('click', onToggleClick);

  return {
    isExpanded() {
      return panel.dataset['expanded'] === 'true';
    },
    setExpanded,
    unmount() {
      startFromHereButton.removeEventListener('click', onStartFromHereClick);
      toggleButton.removeEventListener('click', onToggleClick);
      timeline.unmount();
      charts.unmount();
      panel.remove();
    },
  };
}
