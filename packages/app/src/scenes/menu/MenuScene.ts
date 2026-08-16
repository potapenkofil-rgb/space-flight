/**
 * The main menu — the very first thing the player sees (PLAN.md §7 item 7/8:
 * the Playwright smoke test asserts this is visible on launch). A plain DOM
 * overlay on top of the canvas world, per PLAN.md §1 ("the interface is HTML
 * over canvas"). Styling comes entirely from `ui/tokens.css` classes.
 *
 * Both "New Flight" and "Hangar" lead to the same place — the hangar is the
 * only way to get a flyable vessel (PLAN.md §8: Menu → Hangar → Flight ⇄
 * Map) — kept as two buttons because a returning player expects both labels,
 * not because they navigate anywhere different yet; a `Continue`/load-world
 * flow (PLAN.md §6.3) would be where they'd first diverge.
 */
import './menu.css';
import { getLocale, onLocaleChange, setLocale, t, type Locale } from '../../i18n';
import { getInitialTheme, getTheme, setTheme, type ThemeName } from '../../ui/tokens';

export interface MenuSceneOptions {
  /** Navigates to the hangar (PLAN.md §8 step 2) — both "New Flight" and "Hangar" trigger this. */
  readonly onEnterHangar: () => void;
}

function createButton(className: string, testId: string): HTMLButtonElement {
  const button = document.createElement('button');
  button.className = className;
  button.type = 'button';
  button.dataset['testid'] = testId;
  return button;
}

/**
 * Mounts the menu overlay into `root` and returns an unmount function. Applies
 * the initial theme (persisted choice, else dark per DESIGN.md §1 default) as
 * a side effect on first mount.
 */
export function mountMenuScene(root: HTMLElement, options: MenuSceneOptions): () => void {
  document.documentElement.dataset['theme'] = getInitialTheme();

  root.innerHTML = '';
  const overlay = document.createElement('div');
  overlay.className = 'menu-overlay';

  const panel = document.createElement('div');
  panel.className = 'menu-panel';
  panel.dataset['testid'] = 'menu-panel';
  for (const corner of ['tl', 'tr', 'bl', 'br']) {
    const tick = document.createElement('span');
    tick.className = `menu-panel-corner corner-${corner}`;
    panel.appendChild(tick);
  }

  const title = document.createElement('h1');
  title.className = 'menu-title';
  title.dataset['testid'] = 'menu-title';

  const newFlightButton = createButton('menu-button', 'menu-new-flight');
  newFlightButton.dataset['primary'] = 'true';
  newFlightButton.addEventListener('click', options.onEnterHangar);

  const hangarButton = createButton('menu-button', 'menu-hangar');
  hangarButton.addEventListener('click', options.onEnterHangar);

  const settingsRow = document.createElement('div');
  settingsRow.className = 'menu-row';

  const languageButton = createButton('menu-button menu-toggle', 'menu-language');
  const themeButton = createButton('menu-button menu-toggle', 'menu-theme');
  settingsRow.append(languageButton, themeButton);

  const version = document.createElement('div');
  version.className = 'menu-version';
  version.dataset['testid'] = 'menu-version';

  panel.append(title, newFlightButton, hangarButton, settingsRow, version);
  overlay.appendChild(panel);
  root.appendChild(overlay);

  function render(): void {
    title.textContent = t('MENU_TITLE');
    newFlightButton.textContent = t('MENU_NEW_FLIGHT');
    hangarButton.textContent = t('MENU_HANGAR');
    languageButton.textContent = `${t('MENU_LANGUAGE')}: ${getLocale().toUpperCase()}`;
    const themeKey: 'SETTINGS_THEME_DARK' | 'SETTINGS_THEME_LIGHT' =
      getTheme() === 'dark' ? 'SETTINGS_THEME_DARK' : 'SETTINGS_THEME_LIGHT';
    themeButton.textContent = `${t('MENU_THEME')}: ${t(themeKey)}`;
    version.textContent = `${t('MENU_VERSION')} 0.0.0-skeleton`;
  }

  function onLanguageClick(): void {
    const next: Locale = getLocale() === 'ru' ? 'en' : 'ru';
    setLocale(next);
  }

  function onThemeClick(): void {
    const next: ThemeName = getTheme() === 'dark' ? 'light' : 'dark';
    setTheme(next);
    render(); // theme has no change-listener registry (unlike locale); re-render explicitly
  }

  languageButton.addEventListener('click', onLanguageClick);
  themeButton.addEventListener('click', onThemeClick);
  const unsubscribeLocale = onLocaleChange(render);

  render();

  return () => {
    languageButton.removeEventListener('click', onLanguageClick);
    themeButton.removeEventListener('click', onThemeClick);
    newFlightButton.removeEventListener('click', options.onEnterHangar);
    hangarButton.removeEventListener('click', options.onEnterHangar);
    unsubscribeLocale();
    root.innerHTML = '';
  };
}
