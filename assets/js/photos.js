const gallery = document.querySelector('#photo-gallery');
const base = gallery.dataset.assetBase;
const mapUrl = gallery.dataset.mapUrl;
const version = document.querySelector('meta[name="asset-version"]')?.content;
const stamped = url => (version ? `${url}?v=${version}` : url);
const valid = photo =>
  photo &&
  Array.isArray(photo.coords) &&
  photo.coords.length === 2 &&
  photo.coords.every(Number.isFinite) &&
  Math.abs(photo.coords[0]) <= 90 &&
  Math.abs(photo.coords[1]) <= 180 &&
  photo.variants &&
  typeof photo.place === 'string';
const asset = src =>
  typeof src === 'string' && /^images\/travel\/[a-z0-9-]+\/[a-z0-9-]+\.(webp|jpg|png)$/.test(src)
    ? stamped(`${base}${src}`)
    : '';
fetch(stamped(`${base}data/travel/photos.json`))
  .then(response => {
    if (!response.ok) throw new Error('Photo list unavailable');
    return response.json();
  })
  .then(({ photos = [], gallery_order = [] }) => {
    const order = new Map(gallery_order.map((id, index) => [id, index]));
    const entries = photos
      .filter(valid)
      .sort(
        (a, b) =>
          (order.get(a.id) ?? order.size) - (order.get(b.id) ?? order.size) ||
          (b.date || '').localeCompare(a.date || '') ||
          a.id.localeCompare(b.id)
      );
    if (!entries.length) {
      gallery.innerHTML = '<p class="gallery-empty">No geotagged photos are available yet.</p>';
      return;
    }
    entries.forEach(photo => {
      const imagePath = asset(photo.variants.small?.src || photo.variants.medium?.src);
      if (!imagePath) return;
      const subject = photo.gallery?.subject || photo.place;
      const location = photo.gallery?.location || '';
      const label = location ? `${subject} — ${location}` : subject;
      const link = document.createElement('a');
      link.className = 'photo-card';
      link.href = `${mapUrl}?lat=${encodeURIComponent(photo.coords[0])}&lng=${encodeURIComponent(photo.coords[1])}&zoom=15`;
      link.setAttribute('aria-label', `View ${label} on the map`);
      const figure = document.createElement('figure');
      figure.style.margin = '0';
      const image = document.createElement('img');
      image.src = imagePath;
      image.alt = photo.caption || label;
      image.loading = 'lazy';
      image.decoding = 'async';
      const caption = document.createElement('figcaption');
      const heading = document.createElement('strong');
      heading.className = 'photo-subject';
      heading.textContent = subject;
      caption.append(heading);
      if (location) {
        const place = document.createElement('span');
        place.className = 'photo-location';
        place.textContent = location;
        caption.append(place);
      }
      if (photo.caption) {
        const note = document.createElement('span');
        note.className = 'photo-note';
        note.textContent = photo.caption;
        caption.append(note);
      }
      const mapIcon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      mapIcon.classList.add('photo-map-arrow');
      mapIcon.setAttribute('aria-hidden', 'true');
      mapIcon.setAttribute('viewBox', '0 0 12 12');
      mapIcon.innerHTML = '<path d="M3 9 9 3M3 3h6v6"/>';
      heading.append(mapIcon);
      figure.append(image, caption);
      link.append(figure);
      gallery.append(link);
    });
  })
  .catch(() => {
    gallery.innerHTML =
      '<p class="gallery-empty">Photos could not be loaded. Refresh to try again.</p>';
  });
