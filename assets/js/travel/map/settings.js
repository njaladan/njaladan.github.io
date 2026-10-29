import { $ } from '../../lib/dom.js';
import { readSetting, writeSetting } from '../../lib/storage.js';

// The settings dialog: projection, photo pins and units (distance and climb). Each choice
// is remembered in localStorage; globe/index.js reads the projection on load.
const UNIT_KEY = 'atlas-distance-unit';
const PHOTOS_KEY = 'atlas-show-photos';
const VIEW_KEY = 'atlas-map-view';

/**
 * @typedef {object} SettingsOptions
 * @property {HTMLDialogElement} dialog
 * @property {boolean} globeView Whether the globe renderer is running.
 * @property {boolean} globeSupported
 * @property {{ setDistanceUnit: (unit: string) => void }} cards
 * @property {{ setVisible: (visible: boolean) => void }} photos
 * @property {() => void} onUnitChange Runs after the cards switch unit.
 */

/** @returns {'km' | 'mi'} */
const storedDistanceUnit = () => (readSetting(UNIT_KEY) === 'mi' ? 'mi' : 'km');

/**
 * @param {HTMLDialogElement} dialog
 * @param {string} selector
 */
const input = (dialog, selector) => /** @type {HTMLInputElement | null} */ ($(selector, dialog));

/**
 * Checks the stored choices and disables the globe where it cannot run.
 * @param {SettingsOptions} options
 * @param {HTMLInputElement} showPhotos
 */
function restoreChoices({ dialog, globeView, globeSupported, cards, photos }, showPhotos) {
  const unit = storedDistanceUnit();
  cards.setDistanceUnit(unit);
  input(dialog, `input[value="${unit}"]`).checked = true;
  input(dialog, `input[name="map-view"][value="${globeView ? 'globe' : 'flat'}"]`).checked = true;
  if (!globeSupported) {
    input(dialog, 'input[name="map-view"][value="globe"]').disabled = true;
    $('.map-view-note', dialog).hidden = false;
  }
  showPhotos.checked = readSetting(PHOTOS_KEY) !== 'false';
  photos.setVisible(showPhotos.checked);
}

/**
 * @param {SettingsOptions} options
 * @param {HTMLInputElement} showPhotos
 * @param {HTMLInputElement} target
 */
function applyChange({ cards, photos, onUnitChange }, showPhotos, target) {
  if (target === showPhotos) {
    photos.setVisible(showPhotos.checked);
    writeSetting(PHOTOS_KEY, String(showPhotos.checked));
    return;
  }
  if (target.matches('input[name="map-view"]')) {
    // Each view builds its own renderer, so reload into the chosen one.
    // The hash keeps the place, card and trip that were open.
    writeSetting(VIEW_KEY, target.value);
    location.reload();
    return;
  }
  if (!target.matches('input[name="distance-unit"]')) return;
  cards.setDistanceUnit(target.value);
  onUnitChange();
  writeSetting(UNIT_KEY, target.value);
}

/**
 * Closes the dialog on a click on its backdrop, which targets the dialog itself.
 * @param {HTMLDialogElement} dialog
 * @param {MouseEvent} event
 */
function closeOnBackdrop(dialog, event) {
  if (event.target !== dialog) return;
  const rect = dialog.getBoundingClientRect();
  if (
    event.clientX < rect.left ||
    event.clientX > rect.right ||
    event.clientY < rect.top ||
    event.clientY > rect.bottom
  ) {
    dialog.close();
  }
}

/**
 * Restores the stored settings and keeps them in sync with the dialog.
 * @param {SettingsOptions} options
 */
export function installSettings(options) {
  const { dialog } = options;
  const showPhotos = input(dialog, '#show-photos');
  restoreChoices(options, showPhotos);
  $('#map-settings-button')?.addEventListener('click', () => dialog.showModal());
  dialog.addEventListener('change', event =>
    applyChange(options, showPhotos, /** @type {HTMLInputElement} */ (event.target))
  );
  // Keys typed in the dialog must not move the map behind it.
  dialog.addEventListener('keydown', event => event.stopPropagation());
  dialog.addEventListener('click', event => closeOnBackdrop(dialog, event));
}
