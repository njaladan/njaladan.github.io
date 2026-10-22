(() => {
  const portrait = document.querySelector('.portrait');
  if (!portrait) return;

  const showChildhood = show => {
    portrait.setAttribute('aria-pressed', String(show));
  };

  portrait.addEventListener('click', () => {
    showChildhood(portrait.getAttribute('aria-pressed') !== 'true');
  });

  // Touch taps toggle persistently; a mouse can still preview on hover.
  portrait.addEventListener('pointerenter', event => {
    if (event.pointerType === 'mouse') showChildhood(true);
  });
  portrait.addEventListener('pointerleave', event => {
    if (event.pointerType === 'mouse') showChildhood(false);
  });
})();
