// Native document transitions keep navigation simple. In browsers without them,
// animate only the incoming content after an ordinary internal navigation.
// A classic script: it runs in <head> before first paint, so it cannot import helpers.
(() => {
  'use strict';
  const KEY = 'gentle-navigation';
  // A pending arrival older than this came from an abandoned navigation.
  const PENDING_MS = 15000;
  const native = 'onpagereveal' in window && CSS.supports('view-transition-name', 'page-content');

  try {
    const pending = JSON.parse(sessionStorage.getItem(KEY) || 'null');
    sessionStorage.removeItem(KEY);
    if (
      !native &&
      pending &&
      pending.path === location.pathname &&
      Date.now() - pending.time < PENDING_MS
    ) {
      document.documentElement.classList.add('gentle-arrival');
    }
  } catch {
    /* Navigation works even when storage is unavailable. */
  }

  /** @param {MouseEvent} event */
  const plainClick = event =>
    !event.defaultPrevented &&
    event.button === 0 &&
    !event.metaKey &&
    !event.ctrlKey &&
    !event.shiftKey &&
    !event.altKey;

  /**
   * The same-origin page a click on `target` opens in this tab, if any.
   * @param {EventTarget} target
   * @returns {URL | null}
   */
  const internalDestination = target => {
    const link = /** @type {Element} */ (target).closest('a[href]');
    if (!(link instanceof HTMLAnchorElement) || link.hasAttribute('download')) return null;
    if (link.target && link.target !== '_self') return null;
    const next = new URL(link.href, location.href);
    if (next.origin !== location.origin) return null;
    if (next.pathname === location.pathname && next.search === location.search) return null;
    return next;
  };

  document.addEventListener('click', event => {
    if (native || !plainClick(event)) return;
    const next = internalDestination(event.target);
    if (!next) return;
    try {
      sessionStorage.setItem(KEY, JSON.stringify({ path: next.pathname, time: Date.now() }));
    } catch {
      /* Without storage the next page simply arrives without the transition. */
    }
  });
  window.addEventListener('pageshow', event => {
    if (event.persisted) document.documentElement.classList.remove('gentle-arrival');
  });
})();
