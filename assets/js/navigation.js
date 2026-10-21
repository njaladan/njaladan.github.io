// Native document transitions keep navigation simple. In browsers without them,
// animate only the incoming content after an ordinary internal navigation.
(() => {
  const key = 'gentle-navigation';
  const native = 'onpagereveal' in window && CSS.supports('view-transition-name', 'page-content');
  try {
    const pending = JSON.parse(sessionStorage.getItem(key) || 'null');
    sessionStorage.removeItem(key);
    if (!native && pending && pending.path === location.pathname && Date.now() - pending.time < 15000) {
      document.documentElement.classList.add('gentle-arrival');
    }
  } catch { /* Navigation works even when storage is unavailable. */ }

  document.addEventListener('click', event => {
    if (native || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const link = event.target.closest('a[href]');
    if (!link || link.hasAttribute('download') || (link.target && link.target !== '_self')) return;
    const next = new URL(link.href, location.href);
    if (next.origin !== location.origin || (next.pathname === location.pathname && next.search === location.search)) return;
    try { sessionStorage.setItem(key, JSON.stringify({ path: next.pathname, time: Date.now() })); } catch {}
  });
  window.addEventListener('pageshow', event => {
    if (event.persisted) document.documentElement.classList.remove('gentle-arrival');
  });
})();
