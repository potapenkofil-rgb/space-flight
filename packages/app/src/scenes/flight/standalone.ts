/**
 * Standalone bootstrap for `flight.html`. `MenuScene.ts`'s "New Flight"
 * button is intentionally disabled in the skeleton (it's outside Agent D's
 * zone — see PLAN.md §7) and there's no in-app router yet to reach this
 * scene from the menu, so this is its own tiny entry point: same
 * `#world-canvas`/`#app-root` contract as `main.ts`, just skipping the menu
 * and mounting the flight scene directly. Once the orchestrator wires real
 * menu → scene navigation, this file's `main()` is what that router calls.
 */
import '../../ui/tokens.css';
import { getInitialTheme } from '../../ui/tokens';
import { mountFlightScene } from './FlightScene';

function getCanvas(): HTMLCanvasElement {
  const canvas = document.getElementById('world-canvas');
  if (!(canvas instanceof HTMLCanvasElement)) {
    throw new Error('flight/standalone: #world-canvas is missing from flight.html');
  }
  return canvas;
}

function getAppRoot(): HTMLElement {
  const root = document.getElementById('app-root');
  if (!(root instanceof HTMLElement)) {
    throw new Error('flight/standalone: #app-root is missing from flight.html');
  }
  return root;
}

function main(): void {
  document.documentElement.dataset['theme'] = getInitialTheme();
  mountFlightScene(getCanvas(), getAppRoot());
}

main();
