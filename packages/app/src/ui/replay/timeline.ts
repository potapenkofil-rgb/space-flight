/**
 * The black-box timeline (PLAN.md §7 Agent F): a bottom-docked scrubber over
 * a `ReplaySession`'s whole recorded span, with a dot per `ReplayMarker`.
 * Per DESIGN.md §3, it's dock-to-edge (never a floating window) and the
 * marker colors are the existing semantic tokens, reused verbatim rather than
 * invented: `Burn` for irreversible player-triggered events, `Critical` for
 * failure, `Nominal` for a good landing, `Orbit` for orbital/atmospheric
 * events — exactly DESIGN.md §1's existing definitions for those roles.
 */
import type { ReplayMarker, ReplayMarkerKind, ReplaySession } from '@karman/core';
import './replay.css';
import { getColor } from '../tokens';

const MARKER_COLOR: Record<ReplayMarkerKind, () => string> = {
  launch: () => getColor('burn'),
  'stage-separation': () => getColor('burn'),
  'part-loss': () => getColor('critical'),
  'atmosphere-entry': () => getColor('orbit'),
  apoapsis: () => getColor('orbit'),
  periapsis: () => getColor('orbit'),
  landing: () => getColor('nominal'),
  impact: () => getColor('critical'),
};

const MARKER_LABEL_KEY: Record<ReplayMarkerKind, string> = {
  launch: 'REPLAY_MARKER_LAUNCH',
  'stage-separation': 'REPLAY_MARKER_STAGE_SEPARATION',
  'part-loss': 'REPLAY_MARKER_PART_LOSS',
  'atmosphere-entry': 'REPLAY_MARKER_ATMOSPHERE_ENTRY',
  apoapsis: 'REPLAY_MARKER_APOAPSIS',
  periapsis: 'REPLAY_MARKER_PERIAPSIS',
  landing: 'REPLAY_MARKER_LANDING',
  impact: 'REPLAY_MARKER_IMPACT',
};

export interface TimelineOptions {
  readonly session: ReplaySession;
  /** Called whenever the scrub position changes, either by drag or click. */
  readonly onSeek: (t: number) => void;
  /** Formats the current time for the readout (caller decides units — `math/units`'s `formatNumber`/etc). */
  readonly formatTime: (t: number) => string;
  /** Localizes a UI string (the caller's `i18n`'s `t()` — kept injectable so this module makes zero assumptions about where `i18n/` lives). */
  readonly t: (key: string) => string;
}

export interface Timeline {
  /** Moves the playhead to `t` (clamped into the session's span) without emitting `onSeek`. */
  setTime(t: number): void;
  unmount(): void;
}

function clamp(x: number, lo: number, hi: number): number {
  return Math.min(Math.max(x, lo), hi);
}

/** Mounts the timeline into `root` (expected to be a bottom-docked container) and returns a handle to control/unmount it. */
export function mountTimeline(root: HTMLElement, options: TimelineOptions): Timeline {
  const { session, onSeek, formatTime, t } = options;
  const span = Math.max(session.endTime - session.startTime, Number.EPSILON);

  const panel = document.createElement('div');
  panel.className = 'replay-timeline';
  panel.dataset['testid'] = 'replay-timeline';

  const readout = document.createElement('div');
  readout.className = 'replay-timeline-readout label data';

  const track = document.createElement('div');
  track.className = 'replay-timeline-track';
  track.dataset['testid'] = 'replay-timeline-track';

  const playhead = document.createElement('div');
  playhead.className = 'replay-timeline-playhead';
  track.appendChild(playhead);

  const markerElements: { marker: ReplayMarker; el: HTMLDivElement }[] = [];
  for (const marker of session.markers) {
    const dot = document.createElement('div');
    dot.className = 'replay-timeline-marker';
    dot.style.left = `${(clamp(marker.t, session.startTime, session.endTime) - session.startTime) / span * 100}%`;
    dot.style.setProperty('--marker-color', MARKER_COLOR[marker.kind]());
    dot.title = `${t(MARKER_LABEL_KEY[marker.kind])} — ${formatTime(marker.t)}`;
    dot.dataset['testid'] = `replay-marker-${marker.kind}`;
    track.appendChild(dot);
    markerElements.push({ marker, el: dot });
  }

  function setTime(time: number): void {
    const clamped = clamp(time, session.startTime, session.endTime);
    playhead.style.left = `${((clamped - session.startTime) / span) * 100}%`;
    readout.textContent = formatTime(clamped);
  }

  function timeFromClientX(clientX: number): number {
    const rect = track.getBoundingClientRect();
    const fraction = rect.width > 0 ? clamp((clientX - rect.left) / rect.width, 0, 1) : 0;
    return session.startTime + fraction * span;
  }

  let dragging = false;
  function handleSeek(clientX: number): void {
    const time = timeFromClientX(clientX);
    setTime(time);
    onSeek(time);
  }
  function onPointerDown(event: PointerEvent): void {
    dragging = true;
    // Not every environment implements pointer capture (jsdom in unit tests
    // notably doesn't) — it's a nicety for smooth dragging, not required for
    // seeking to work, so it's called defensively.
    track.setPointerCapture?.(event.pointerId);
    handleSeek(event.clientX);
  }
  function onPointerMove(event: PointerEvent): void {
    if (!dragging) return;
    handleSeek(event.clientX);
  }
  function onPointerUp(event: PointerEvent): void {
    dragging = false;
    track.releasePointerCapture?.(event.pointerId);
  }

  track.addEventListener('pointerdown', onPointerDown);
  track.addEventListener('pointermove', onPointerMove);
  track.addEventListener('pointerup', onPointerUp);

  panel.append(readout, track);
  root.appendChild(panel);
  setTime(session.startTime);

  return {
    setTime,
    unmount() {
      track.removeEventListener('pointerdown', onPointerDown);
      track.removeEventListener('pointermove', onPointerMove);
      track.removeEventListener('pointerup', onPointerUp);
      panel.remove();
      markerElements.length = 0;
    },
  };
}
