/**
 * The black-box panel (PLAN.md §7 Agent F): composes the timeline scrubber,
 * the four telemetry charts, and the "start from marker" action into one
 * bottom-docked panel (DESIGN.md §3: dock to an edge, never float).
 *
 * This module owns *presentation* only. Wiring it into an actual flight —
 * constructing the `ReplaySession` from a live `FlightRecorder`, and turning
 * "start from here" into a real branched recording via `startFromReplay` —
 * is the caller's job (see `onStartFromHere`'s doc and this agent's report:
 * that lives in the flight scene, `packages/app/src/scenes/flight/**`, which
 * is Agent D's zone, not this one).
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
  unmount(): void;
}

export function mountReplayPanel(root: HTMLElement, options: ReplayPanelOptions): ReplayPanel {
  const { session, vesselId, formatTime, t } = options;
  const sampleCount = options.sampleCount ?? DEFAULT_SAMPLE_COUNT;

  const panel = document.createElement('div');
  panel.className = 'replay-panel';
  panel.dataset['testid'] = 'replay-panel';

  const header = document.createElement('div');
  header.className = 'replay-panel-header';

  const title = document.createElement('div');
  title.className = 'label';
  title.textContent = t('REPLAY_TIMELINE');

  const startFromHereButton = document.createElement('button');
  startFromHereButton.type = 'button';
  startFromHereButton.className = 'replay-start-from-here';
  startFromHereButton.textContent = t('REPLAY_START_FROM_HERE');
  startFromHereButton.dataset['testid'] = 'replay-start-from-here';

  header.append(title, startFromHereButton);

  const chartsHost = document.createElement('div');
  const timelineHost = document.createElement('div');

  panel.append(header, chartsHost, timelineHost);
  root.appendChild(panel);

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

  function onStartFromHereClick(): void {
    options.onStartFromHere?.(currentTime, session.seekTo(currentTime));
  }
  startFromHereButton.addEventListener('click', onStartFromHereClick);

  return {
    unmount() {
      startFromHereButton.removeEventListener('click', onStartFromHereClick);
      timeline.unmount();
      charts.unmount();
      panel.remove();
    },
  };
}
