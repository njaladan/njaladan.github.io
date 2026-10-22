// Home page portrait: a click or tap toggles the childhood photo; a mouse previews it on hover.
import { $ } from './lib/dom.js';

/** @param {HTMLElement} portrait @param {boolean} show */
const showChildhood = (portrait, show) => {
  portrait.setAttribute('aria-pressed', String(show));
};

function init() {
  const portrait = $('.portrait');
  if (!portrait) return;

  portrait.addEventListener('click', () => {
    showChildhood(portrait, portrait.getAttribute('aria-pressed') !== 'true');
  });

  // Touch taps toggle persistently; a mouse can still preview on hover.
  portrait.addEventListener('pointerenter', event => {
    if (event.pointerType === 'mouse') showChildhood(portrait, true);
  });
  portrait.addEventListener('pointerleave', event => {
    if (event.pointerType === 'mouse') showChildhood(portrait, false);
  });
}

init();
