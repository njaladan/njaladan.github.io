// Home page portrait: each mouse hover, click or tap advances to the next photo.
import { $ } from './lib/dom.js';

function init() {
  const portrait = $('.portrait');
  if (!portrait) return;
  const photos = [...portrait.querySelectorAll('img')];
  if (photos.length < 2) return;

  let index = Math.max(
    0,
    photos.findIndex(photo => photo.classList.contains('is-active'))
  );
  const advance = () => {
    photos[index].classList.remove('is-active');
    index = (index + 1) % photos.length;
    photos[index].classList.add('is-active');
  };

  // A mouse that hovers and then clicks would otherwise skip a photo, so a click
  // right after a hover-advance is ignored.
  let hoveredAt = 0;
  portrait.addEventListener('pointerenter', event => {
    if (event.pointerType !== 'mouse') return;
    hoveredAt = event.timeStamp;
    advance();
  });
  portrait.addEventListener('click', event => {
    if (event.detail > 0 && event.timeStamp - hoveredAt < 400) return;
    advance();
  });

  // Warm the lazy images so the first swap doesn't flash.
  for (const photo of photos) photo.loading = 'eager';
}

init();
