/* Photo assets are fetched only for visible pins or an explicitly opened image. */
'use strict';
function installAtlasPhotos(map, {focus, onLayout}) {
  const dialog = document.querySelector('#photo-viewer');
  const image = dialog.querySelector('img');
  const title = dialog.querySelector('#photo-title');
  const caption = dialog.querySelector('.photo-caption');
  const counter = dialog.querySelector('.photo-counter');
  const original = dialog.querySelector('.photo-original');
  const previous = dialog.querySelector('.photo-previous');
  const next = dialog.querySelector('.photo-next');
  const status = dialog.querySelector('.photo-image-status');
  const pins = new Map();
  let photos = [], selection = [], selectedIndex = 0, returnFocus = null, cancelFocus = null;
  const popup = L.popup({className: 'photo-popup', maxWidth: 320, minWidth: 220, autoPanPaddingTopLeft: [20, 80], autoPanPaddingBottomRight: [45, 45]});
  map.createPane('photos');
  map.getPane('photos').style.zIndex = 460;
  const layer = L.layerGroup().addTo(map);

  function asset(src, original = false) {
    // Photo files must come from the atlas, never arbitrary URLs from data.
    if (typeof src !== 'string' || !(/^photos\/[a-z0-9-]+\/[a-z0-9-]+\.(webp|jpg|png)$/.test(src) ||
        original && /^photos\/[a-z0-9-]+\/[a-z0-9-]+\.(heic|heif)$/.test(src))) return '';
    return src;
  }
  function valid(photo) {
    return photo && typeof photo.id === 'string' && typeof photo.place === 'string' &&
      Array.isArray(photo.coords) && photo.coords.length === 2 && photo.coords.every(Number.isFinite) &&
      Math.abs(photo.coords[0]) <= 90 && Math.abs(photo.coords[1]) <= 180 &&
      Number.isFinite(photo.width) && photo.width > 0 && Number.isFinite(photo.height) && photo.height > 0 &&
      ['thumbnail', 'small', 'medium', 'large'].every(key => asset(photo.variants?.[key]?.src) && Number.isFinite(photo.variants[key].width)) && asset(photo.original?.src, true);
  }
  function setImage(node, photo, full = false) {
    node.alt = photo.caption || `Photo at ${photo.place}`;
    node.width = photo.width; node.height = photo.height;
    node.decoding = 'async';
    const variants = full ? ['small', 'medium', 'large'] : ['small', 'medium'];
    const unique = [...new Map(variants.map(key => [photo.variants[key].width, photo.variants[key]])).values()];
    node.sizes = full ? '(max-width: 700px) 94vw, (max-width: 1300px) 90vw, 1200px' : '(max-width: 400px) 75vw, 300px';
    node.srcset = unique.map(item => `${asset(item.src)} ${item.width}w`).join(', ');
    node.src = asset(photo.variants[full ? 'medium' : 'small'].src);
  }
  function photoDetails(photo) {
    const parts = [photo.caption];
    if (photo.date) parts.push(new Date(`${photo.date}T12:00:00`).toLocaleDateString(undefined, {year: 'numeric', month: 'long', day: 'numeric'}));
    return parts.filter(Boolean).join(' · ');
  }
  function changeImage(delta = 0) {
    selectedIndex = (selectedIndex + delta + selection.length) % selection.length;
    const photo = selection[selectedIndex];
    title.textContent = photo.place;
    caption.textContent = photoDetails(photo);
    caption.hidden = !caption.textContent;
    counter.textContent = selection.length > 1 ? `${selectedIndex + 1} / ${selection.length}` : '';
    previous.hidden = next.hidden = selection.length < 2;
    original.href = asset(photo.original.src, true);
    original.download = `${photo.id}-original.${photo.original.src.split('.').pop()}`;
    status.textContent = 'Loading photo…';
    image.onload = () => { status.textContent = ''; };
    image.onerror = () => { status.textContent = 'Photo could not load. Close and reopen to retry.'; };
    setImage(image, photo, true);
  }
  function openViewer(items, index, trigger) {
    selection = items; selectedIndex = index; returnFocus = trigger;
    changeImage();
    dialog.showModal();
    dialog.querySelector('.photo-close').focus();
  }
  function openPreview(items, index = 0) {
    const photo = items[index];
    const content = document.createElement('div');
    const enlarge = document.createElement('button');
    enlarge.className = 'photo-enlarge'; enlarge.setAttribute('aria-label', `Enlarge photo at ${photo.place}`);
    const preview = document.createElement('img');
    setImage(preview, photo);
    enlarge.append(preview);
    enlarge.addEventListener('click', () => openViewer(items, index, enlarge));
    preview.addEventListener('error', () => { enlarge.classList.add('photo-missing'); enlarge.textContent = 'Photo unavailable · open viewer'; });
    const meta = document.createElement('div'); meta.className = 'photo-preview-meta';
    const heading = document.createElement('strong'); heading.textContent = photo.place; meta.append(heading);
    const detail = document.createElement('p'); detail.textContent = photoDetails(photo); if (detail.textContent) meta.append(detail);
    const actions = document.createElement('div'); actions.className = 'photo-preview-actions';
    const view = document.createElement('button'); view.textContent = 'View photo'; view.addEventListener('click', () => openViewer(items, index, view));
    actions.append(view);
    if (items.length > 1) {
      const pager = document.createElement('span'); pager.className = 'photo-preview-pager';
      [-1, 1].forEach(delta => {
        const control = document.createElement('button'); control.textContent = delta < 0 ? '←' : '→';
        control.setAttribute('aria-label', delta < 0 ? 'Previous photo' : 'Next photo');
        control.addEventListener('click', () => { openPreview(items, (index + delta + items.length) % items.length); popup.getElement().querySelector(`[aria-label="${control.getAttribute('aria-label')}"]`).focus(); });
        if (delta === 1) { const count = document.createElement('span'); count.textContent = `${index + 1} / ${items.length}`; pager.append(count); }
        pager.append(control);
      });
      actions.append(pager);
    }
    meta.append(actions); content.append(enlarge, meta);
    popup.setLatLng(photo.coords).setContent(content).openOn(map);
    view.focus({preventScroll: true});
  }
  function select(items) {
    if (cancelFocus) cancelFocus();
    map.closePopup();
    const bounds = L.latLngBounds(items.map(photo => photo.coords));
    const spread = bounds.getNorthEast().distanceTo(bounds.getSouthWest());
    if (items.length > 1 && spread > 60 && map.getZoom() < 16.5) {
      focus({bounds, country: items.every(photo => photo.country === items[0].country) ? items[0].country : null, maxZoom: Math.min(17, map.getZoom() + 3)});
    } else {
      cancelFocus = focus({coords: items[0].coords, country: items[0].country, zoom: Math.max(15, map.getZoom()), complete: () => { cancelFocus = null; openPreview(items); }});
    }
  }

  function thumbnailPrint(photo, className) {
    const print = document.createElement('span'); print.className = `photo-pin-print ${className}`;
    const wrapper = document.createElement('span'); wrapper.className = 'photo-pin-image';
    const thumbnail = document.createElement('img'); thumbnail.src = asset(photo.variants.thumbnail.src); thumbnail.alt = ''; thumbnail.width = 40; thumbnail.height = 40; thumbnail.decoding = 'async';
    thumbnail.addEventListener('error', () => { const fallback = document.createElement('span'); fallback.textContent = '▧'; thumbnail.replaceWith(fallback); wrapper.classList.add('photo-pin-fallback'); });
    wrapper.append(thumbnail); print.append(wrapper);
    return print;
  }

  function layout() {
    const zoom = map.getZoom(), size = map.getSize();
    const groups = [], cells = new Map();
    // Cluster only very close anchors: 48px prints can overlap instead of hiding nearby photos.
    const spacing = zoom < 8 ? 38 : 32;
    photos.forEach(photo => {
      const point = map.latLngToContainerPoint(photo.coords);
      if (point.x < 30 || point.x > size.x - 30 || point.y < 80 || point.y > size.y - 45) return;
      const x = Math.floor(point.x / spacing), y = Math.floor(point.y / spacing);
      let nearby = null;
      for (let dx = -1; dx <= 1 && !nearby; dx++) for (let dy = -1; dy <= 1 && !nearby; dy++) {
        nearby = (cells.get(`${x + dx},${y + dy}`) || []).find(group => group.point.distanceTo(point) < spacing);
      }
      if (nearby) nearby.items.push(photo);
      else {
        const group = {point, items: [photo]}; groups.push(group);
        const key = `${x},${y}`; if (!cells.has(key)) cells.set(key, []); cells.get(key).push(group);
      }
    });
    const active = new Set();
    groups.forEach(group => {
      const key = group.items.map(photo => photo.id).join('|'); active.add(key);
      if (pins.has(key)) return;
      const photo = group.items[0], collection = group.items.length > 1;
      const wrapper = document.createElement('span'); wrapper.className = 'photo-pin-content';
      // At most two extra thumbnails hint at the collection without loading full-size images.
      group.items.slice(1, 3).reverse().forEach((item, index, items) => {
        const print = thumbnailPrint(item, `photo-pin-back photo-pin-back-${items.length - index}`);
        print.setAttribute('aria-hidden', 'true'); wrapper.append(print);
      });
      wrapper.append(thumbnailPrint(photo, 'photo-pin-front'));
      if (collection) { const badge = document.createElement('span'); badge.className = 'photo-pin-count'; badge.textContent = group.items.length; wrapper.append(badge); }
      const label = collection ? `${photo.place} · ${group.items.length} photos nearby` : `Photo at ${photo.place}`;
      const marker = L.marker(photo.coords, {pane: 'photos', alt: label,
        icon: L.divIcon({className: `photo-pin${collection ? ' photo-pin-stack' : ''}`, html: wrapper, iconSize: [48, 48], iconAnchor: [24, 56]}), riseOnHover: true}).addTo(layer);
      const hint = document.createElement('span'); hint.textContent = label;
      marker.bindTooltip(hint, {className: 'photo-pin-label', direction: 'bottom', offset: [0, 4]});
      marker.on('click', () => select(group.items));
      const node = marker.getElement(); node.setAttribute('aria-haspopup', 'dialog'); node.setAttribute('aria-label', label);
      node.addEventListener('focus', () => { marker.setZIndexOffset(1000); marker.openTooltip(); });
      node.addEventListener('blur', () => { marker.setZIndexOffset(0); marker.closeTooltip(); });
      node.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); event.stopPropagation(); select(group.items); } });
      pins.set(key, marker);
    });
    pins.forEach((marker, key) => { if (!active.has(key)) { layer.removeLayer(marker); pins.delete(key); } });
  }
  previous.addEventListener('click', () => changeImage(-1));
  next.addEventListener('click', () => changeImage(1));
  dialog.querySelector('.photo-close').addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', event => { if (event.target === dialog) dialog.close(); });
  dialog.addEventListener('keydown', event => {
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); changeImage(event.key === 'ArrowLeft' ? -1 : 1); }
    event.stopPropagation();
  });
  dialog.addEventListener('close', () => {
    image.removeAttribute('srcset'); image.removeAttribute('src');
    if (returnFocus?.isConnected) returnFocus.focus(); else map.getContainer().focus();
  });
  map.on('moveend resize', () => { layout(); onLayout(); });
  return {
    load(records) {
      const ids = new Set();
      photos = (Array.isArray(records) ? records : []).filter(photo => { if (!valid(photo) || ids.has(photo.id)) return false; ids.add(photo.id); return true; });
      photos.sort((a, b) => (b.date || '').localeCompare(a.date || '') || a.id.localeCompare(b.id));
      layout(); onLayout();
    },
    occupied: () => [...pins.values()].map(marker => marker.getElement().getBoundingClientRect()),
    cancel: () => { if (cancelFocus) { cancelFocus(); cancelFocus = null; } },
    isOpen: () => dialog.open
  };
}
