/**
 * Standalone bootstrap for `map.html` — mirrors `scenes/flight/standalone.ts`;
 * see that file's doc for why this exists instead of routing through the menu.
 */
import '../../ui/tokens.css';
import { getInitialTheme } from '../../ui/tokens';
import { mountMapScene } from './MapScene';

function getCanvas(): HTMLCanvasElement {
  const canvas = document.getElementById('world-canvas');
  if (!(canvas instanceof HTMLCanvasElement)) {
    throw new Error('map/standalone: #world-canvas is missing from map.html');
  }
  return canvas;
}

function getAppRoot(): HTMLElement {
  const root = document.getElementById('app-root');
  if (!(root instanceof HTMLElement)) {
    throw new Error('map/standalone: #app-root is missing from map.html');
  }
  return root;
}

function main(): void {
  document.documentElement.dataset['theme'] = getInitialTheme();
  mountMapScene(getCanvas(), getAppRoot());
}

main();
