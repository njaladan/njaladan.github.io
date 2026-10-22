/* Photo assets are fetched only for visible pins or an explicitly opened image. */
'use strict';
function installAtlasPhotos(map, { focus, onLayout }) {
  const L = map.atlasRenderer || window.L;
  const dialog = document.querySelector('#photo-viewer');
  const backdrop = document.querySelector('#photo-backdrop');
  const image = dialog.querySelector('img');
  const title = dialog.querySelector('#photo-title');
  const caption = dialog.querySelector('.photo-caption');
  const counter = dialog.querySelector('.photo-counter');
  const previous = dialog.querySelector('.photo-previous');
  const next = dialog.querySelector('.photo-next');
  const status = dialog.querySelector('.photo-image-status');
  const pins = new Map();
  const prints = new Map(),
    motions = new Set(),
    depths = new Map();
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  // Magnetic pop at the selected 0.45× timing.
  const motionDuration = 240 / 0.45;
  let frame = null,
    layoutPending = false,
    lastLayout = 0;
  let visible = true;
  let photos = [],
    selection = [],
    selectedIndex = 0,
    returnFocus = null,
    cancelFocus = null;
  const stage = dialog.querySelector('.photo-stage');
  const expand = dialog.querySelector('.photo-expand');
  const shrink = dialog.querySelector('.photo-shrink');
  const well = dialog.querySelector('.photo-image');
  const pixels = dialog.querySelector('.photo-pixels');
  let viewerMotion = null,
    viewerState = 'closed',
    closingViewer = false;
  let closingMapAnchor = null;
  let openingAnchor = null,
    chromeMotions = [],
    imageRequest = null;
  const decodedPhotos = new Map();
  let decodedPixelCount = 0,
    backdropMotion = null;
  let zoomImageTimer = null;
  const photoZoom = installPhotoZoom(well, pixels, image, {
    canInteract: () => viewerState === 'full' && !viewerMotion && !closingViewer,
    onScale: () => {
      clearTimeout(zoomImageTimer);
      zoomImageTimer = setTimeout(() => {
        zoomImageTimer = null;
        if (viewerState === 'full' && !viewerMotion && !closingViewer) requestFrameImage();
      }, 150);
    }
  });
  const chrome = [
    dialog.querySelector('.photo-viewer-header'),
    dialog.querySelector('.photo-viewer-footer')
  ];
  map.createPane('photos');
  map.getPane('photos').style.zIndex = 460;
  const layer = L.layerGroup().addTo(map);
  // Leaflet rounds both projected points and its pixel origin. At fractional
  // zoom those rounding boundaries move independently, making prints vibrate.
  // Keep photo projection continuous, including during interrupted animations.
  function containerPoint(coords) {
    return map
      .project(coords)
      .subtract(map.project(map.getCenter()))
      .add(map.getSize().divideBy(2));
  }
  function layerPoint(coords) {
    return map.containerPointToLayerPoint(containerPoint(coords));
  }
  function layerLatLng(point) {
    return map.unproject(
      map
        .project(map.getCenter())
        .add(map.layerPointToContainerPoint(point))
        .subtract(map.getSize().divideBy(2))
    );
  }
  // Transformed marker containers create independent stacking contexts. Use
  // positioned anchors instead so every physical print shares the photo pane's
  // depth order, even while it changes logical groups.
  const PhotoMarker = L.Marker.extend({
    update() {
      if (this._icon && this._map) this._setPos(layerPoint(this._latlng));
      return this;
    },
    _setPos(point) {
      if (this._icon) {
        L.DomUtil.setPosition(this._icon, point);
        this._icon.style.transform = 'none';
        this._icon.style.left = `${point.x}px`;
        this._icon.style.top = `${point.y}px`;
      }
      this._zIndex = point.y + this.options.zIndexOffset;
      this._resetZIndex();
    },
    _updateZIndex() {
      if (this._icon) this._icon.style.zIndex = 'auto';
    }
  });

  function asset(src) {
    // Photo files must come from the atlas, never arbitrary URLs from data.
    if (typeof src !== 'string' || !/^photos\/[a-z0-9-]+\/[a-z0-9-]+\.(webp|jpg|png)$/.test(src))
      return '';
    return travelAsset(src);
  }
  function valid(photo) {
    return (
      photo &&
      typeof photo.id === 'string' &&
      typeof photo.place === 'string' &&
      Array.isArray(photo.coords) &&
      photo.coords.length === 2 &&
      photo.coords.every(Number.isFinite) &&
      Math.abs(photo.coords[0]) <= 90 &&
      Math.abs(photo.coords[1]) <= 180 &&
      Number.isFinite(photo.width) &&
      photo.width > 0 &&
      Number.isFinite(photo.height) &&
      photo.height > 0 &&
      ['thumbnail', 'small', 'medium', 'large'].every(
        key => asset(photo.variants?.[key]?.src) && Number.isFinite(photo.variants[key].width)
      )
    );
  }
  function rememberDecoded(request) {
    const old = decodedPhotos.get(request.photo.id);
    if (old && old.width >= request.width) return;
    if (old) {
      decodedPixelCount -= old.pixelCount;
      decodedPhotos.delete(request.photo.id);
    }
    request.pixelCount = request.node.naturalWidth * request.node.naturalHeight;
    decodedPhotos.set(request.photo.id, request);
    decodedPixelCount += request.pixelCount;
    // Keep decoded pixels for recent reopens, without retaining the whole album.
    while (decodedPhotos.size > 8 || (decodedPixelCount > 12_000_000 && decodedPhotos.size > 1)) {
      const [id, entry] = decodedPhotos.entries().next().value;
      decodedPhotos.delete(id);
      decodedPixelCount -= entry.pixelCount;
    }
  }
  function cachedPhoto(photo) {
    const entry = decodedPhotos.get(photo.id);
    if (!entry) return null;
    if (!['small', 'medium', 'large'].some(key => asset(photo.variants[key].src) === entry.src)) {
      decodedPhotos.delete(photo.id);
      decodedPixelCount -= entry.pixelCount;
      return null;
    }
    decodedPhotos.delete(photo.id);
    decodedPhotos.set(photo.id, entry);
    return entry;
  }
  function fadeBackdrop(visible, immediate = false) {
    const from = backdrop.hidden ? 0 : Number(getComputedStyle(backdrop).opacity);
    const to = visible ? 1 : 0;
    backdropMotion?.cancel();
    backdropMotion = null;
    backdrop.style.opacity = to;
    if (reduceMotion || immediate || from === to) {
      backdrop.hidden = !visible;
      return;
    }
    backdrop.hidden = false;
    const animation = backdrop.animate([{ opacity: from }, { opacity: to }], {
      duration: 400,
      easing: 'cubic-bezier(.2,.8,.2,1)'
    });
    backdropMotion = animation;
    animation.finished.then(
      () => {
        if (backdropMotion !== animation) return;
        backdropMotion = null;
        backdrop.hidden = !visible;
      },
      () => {}
    );
  }
  function cancelImageRequest() {
    const request = imageRequest;
    imageRequest = null;
    if (request && !request.ready) request.node.removeAttribute('src');
  }
  function showPixels(src, photo, width) {
    // Retain these decoded pixels as a paint fallback when changing the img src
    // or moving the dialog into/out of the browser's modal layer.
    pixels.style.backgroundImage = `url("${src}")`;
    image.src = src;
    image.dataset.photoId = photo.id;
    image.dataset.variantWidth = width;
  }
  function commitImage() {
    const request = imageRequest;
    if (!request?.ready || viewerMotion || closingViewer || viewerState === 'closed') return;
    showPixels(request.src, request.photo, request.width);
    status.textContent = '';
    imageRequest = null;
  }
  function requestFrameImage() {
    if (closingViewer || viewerState === 'closed') return;
    const photo = selection[selectedIndex];
    // Measure the final, inset image area once, before starting the animation.
    const renderedWidth = Math.min(
      well.clientWidth,
      (well.clientHeight * photo.width) / photo.height
    );
    const needed = renderedWidth * devicePixelRatio * photoZoom.scale;
    const variants = ['small', 'medium', 'large']
      .map(key => photo.variants[key])
      .sort((a, b) => a.width - b.width);
    const variant = variants.find(item => item.width >= needed) || variants[variants.length - 1];
    if (image.dataset.photoId === photo.id && Number(image.dataset.variantWidth) >= variant.width)
      return;
    if (imageRequest?.photo.id === photo.id && imageRequest.width >= variant.width) return;
    cancelImageRequest();
    const node = new Image();
    node.decoding = 'async';
    const request = { node, photo, src: asset(variant.src), width: variant.width, ready: false };
    imageRequest = request;
    status.textContent = 'Loading photo…';
    node.src = request.src;
    // Decode offscreen, keeping the displayed image untouched during loading.
    node.decode().then(
      () => {
        if (imageRequest !== request) return;
        request.ready = true;
        rememberDecoded(request);
        commitImage();
      },
      () => {
        if (imageRequest !== request) return;
        imageRequest = null;
        status.textContent = 'Photo could not load. Close and reopen to retry.';
      }
    );
  }
  function previewImage(photo) {
    cancelImageRequest();
    image.alt = photo.caption || `Photo at ${photoLabel(photo)}`;
    image.width = photo.width;
    image.height = photo.height;
    image.decoding = 'async';
    const cached = cachedPhoto(photo);
    const thumbnail = prints.get(photo.id)?.node.querySelector('img');
    if (cached) showPixels(cached.src, photo, cached.width);
    else if (thumbnail?.complete && thumbnail.naturalWidth)
      showPixels(thumbnail.currentSrc, photo, photo.variants.thumbnail.width);
    else {
      image.removeAttribute('src');
      delete image.dataset.photoId;
      delete image.dataset.variantWidth;
      pixels.style.removeProperty('background-image');
    }
    status.textContent = cached ? '' : 'Loading photo…';
  }
  function photoLabel(photo) {
    const subject = photo.gallery?.subject || photo.place;
    const location = photo.gallery?.location || '';
    return location ? `${subject} — ${location}` : subject;
  }
  function photoDetails(photo) {
    return photo.caption || '';
  }
  function selectedPin(photo = selection[selectedIndex]) {
    return [...pins.values()].find(pin => pin.items.some(item => item.id === photo?.id));
  }
  function syncSelectedPin() {
    const selected = viewerState !== 'closed' ? selectedPin() : null;
    pins.forEach(pin => {
      const node = pin.marker.getElement(),
        active = pin === selected;
      if (!node) return;
      node.classList.toggle('photo-pin-selected', active);
      if (active) {
        node.setAttribute('aria-hidden', 'true');
        node.tabIndex = -1;
      } else {
        node.removeAttribute('aria-hidden');
        node.tabIndex = 0;
      }
    });
  }
  function photoAnchor(photo) {
    const pin = selectedPin(photo);
    const node = pin?.content.querySelector('.photo-pin-front');
    if (!node) return null;
    const box = node.getBoundingClientRect();
    if (
      !box.width ||
      !box.height ||
      box.bottom < 0 ||
      box.top > innerHeight ||
      box.right < 0 ||
      box.left > innerWidth
    )
      return null;
    return {
      left: box.left,
      top: box.top,
      width: box.width,
      height: box.height,
      radius: parseFloat(getComputedStyle(node).borderRadius) || 7
    };
  }
  function stopViewerMotion() {
    chromeMotions.forEach(animation => animation.cancel());
    chromeMotions = [];
    if (!viewerMotion) return;
    const motion = viewerMotion;
    viewerMotion = null;
    motion.cancel();
    dialog.classList.remove('photo-resizing');
  }
  function moveFrame(from, to, complete) {
    stopViewerMotion();
    const before = chrome.map(node => ({
      height: node.getBoundingClientRect().height,
      paddingTop: getComputedStyle(node).paddingTop,
      paddingBottom: getComputedStyle(node).paddingBottom
    }));
    Object.assign(dialog.style, {
      left: `${to.left}px`,
      top: `${to.top}px`,
      width: `${to.width}px`,
      height: `${to.height}px`
    });
    if (!closingViewer) requestFrameImage();
    if (reduceMotion || !from) {
      commitImage();
      complete?.();
      return;
    }
    const after = chrome.map(node => ({
      height: node.getBoundingClientRect().height,
      paddingTop: getComputedStyle(node).paddingTop,
      paddingBottom: getComputedStyle(node).paddingBottom
    }));
    dialog.classList.add('photo-resizing');
    const pose = box => ({
      left: `${box.left}px`,
      top: `${box.top}px`,
      width: `${box.width}px`,
      height: `${box.height}px`,
      borderRadius: `${box.radius ?? (box.width === innerWidth ? 0 : 10)}px`
    });
    const animation = dialog.animate([pose(from), pose(to)], {
      duration: 400,
      easing: 'cubic-bezier(.2,.8,.2,1)'
    });
    viewerMotion = animation;
    if (from.width <= 60 || to.width <= 60) {
      chromeMotions = chrome.map((node, index) => {
        const visible = to.width <= 60 ? before[index] : after[index];
        const large = { ...visible, height: `${visible.height}px`, opacity: 1 };
        const small = { height: '0px', paddingTop: '0px', paddingBottom: '0px', opacity: 0 };
        return node.animate(to.width <= 60 ? [large, small] : [small, large], {
          duration: 400,
          easing: 'cubic-bezier(.2,.8,.2,1)'
        });
      });
      chromeMotions.push(
        stage.animate(
          to.width <= 60
            ? [{ padding: '8px' }, { padding: '3px' }]
            : [{ padding: '3px' }, { padding: '8px' }],
          { duration: 400, easing: 'cubic-bezier(.2,.8,.2,1)' }
        )
      );
      const photo = selection[selectedIndex],
        scale = Math.max(photo.width / photo.height, photo.height / photo.width);
      chromeMotions.push(
        image.animate(
          to.width <= 60
            ? [{ transform: 'scale(1)' }, { transform: `scale(${scale})` }]
            : [{ transform: `scale(${scale})` }, { transform: 'scale(1)' }],
          { duration: 400, easing: 'cubic-bezier(.2,.8,.2,1)' }
        )
      );
    }
    animation.finished.then(
      () => {
        if (viewerMotion !== animation) return;
        viewerMotion = null;
        chromeMotions.forEach(item => item.cancel());
        chromeMotions = [];
        dialog.classList.remove('photo-resizing');
        photoZoom.invalidate();
        commitImage();
        complete?.();
      },
      () => {}
    );
  }
  function frameRect() {
    const box = dialog.getBoundingClientRect();
    return {
      left: box.left,
      top: box.top,
      width: box.width,
      height: box.height,
      radius: parseFloat(getComputedStyle(dialog).borderRadius) || 0
    };
  }
  function targetFrame(state) {
    if (state === 'full') return { left: 0, top: 0, width: innerWidth, height: innerHeight };
    const mapBox = map.getContainer().getBoundingClientRect();
    const ratio = selection[selectedIndex].width / selection[selectedIndex].height;
    const mapTop = Math.max(12, mapBox.top + 72),
      mapBottom = Math.min(innerHeight - 12, mapBox.bottom);
    const maxHeight = Math.max(1, mapBottom - mapTop - 12);
    const width = Math.max(
      1,
      Math.min(innerWidth - 24, Math.max(280, Math.min(400, maxHeight * 0.66 * ratio)))
    );
    dialog.style.width = `${width}px`;
    // Measure wrapping text at its destination width before sizing the frame.
    const chromeHeight =
      chrome.reduce((sum, node) => sum + node.getBoundingClientRect().height, 0) + 2;
    const height = Math.min(maxHeight, chromeHeight + 16 + (width - 18) / ratio);
    const anchor = photoAnchor(selection[selectedIndex]) || openingAnchor;
    const left = Math.max(
      12,
      Math.min(
        innerWidth - width - 12,
        (anchor?.left || innerWidth / 2) + (anchor?.width || 0) / 2 - width / 2
      )
    );
    const top = Math.max(
      mapTop,
      Math.min(
        mapBottom - height - 12,
        (anchor?.top || mapBox.top + mapBox.height / 2) + 48 - height
      )
    );
    return { left, top, width, height };
  }
  function present(state, from = dialog.open ? frameRect() : openingAnchor, focusControl = true) {
    stopViewerMotion();
    closingViewer = false;
    dialog.classList.remove('photo-collapsing');
    closingMapAnchor = null;
    dialog.style.removeProperty('translate');
    commitImage();
    const activeControl = dialog.contains(document.activeElement) ? document.activeElement : null;
    const modal = state === 'full';
    if (dialog.open && dialog.matches(':modal') !== modal) dialog.close();
    viewerState = state;
    dialog.dataset.state = state;
    dialog.setAttribute('aria-modal', String(modal));
    photoZoom.setActive(modal);
    expand.hidden = modal;
    shrink.hidden = !modal;
    stage.setAttribute('aria-label', modal ? 'Photo' : 'Expand photo');
    stage.setAttribute('role', modal ? 'group' : 'button');
    if (modal) stage.setAttribute('aria-describedby', 'photo-zoom-help');
    else stage.removeAttribute('aria-describedby');
    document.body.classList.toggle('photo-fullscreen', modal);
    if (!dialog.open) {
      if (modal) dialog.showModal();
      else dialog.show();
    }
    fadeBackdrop(modal);
    syncSelectedPin();
    moveFrame(from, targetFrame(state));
    if (focusControl) (modal ? stage : expand).focus({ preventScroll: true });
    else if (activeControl && !activeControl.hidden) activeControl.focus({ preventScroll: true });
  }
  function changeImage(delta = 0, resize = true) {
    if (!selection.length) return;
    const from = dialog.open ? frameRect() : null;
    photoZoom.reset();
    selectedIndex = (selectedIndex + delta + selection.length) % selection.length;
    const photo = selection[selectedIndex];
    title.textContent = photoLabel(photo);
    caption.textContent = photoDetails(photo);
    caption.hidden = !caption.textContent;
    counter.textContent = selection.length > 1 ? `${selectedIndex + 1} / ${selection.length}` : '';
    previous.hidden = next.hidden = selection.length < 2;
    previewImage(photo);
    if (dialog.open && resize) present(viewerState, from, false);
  }
  function openPhoto(items, index = 0) {
    const wasOpen = dialog.open;
    const from = wasOpen ? frameRect() : photoAnchor(items[index]);
    selection = items;
    selectedIndex = index;
    returnFocus = selectedPin()?.marker.getElement();
    openingAnchor = photoAnchor(items[index]);
    changeImage(0, false);
    present('medium', from);
  }
  function finishClose(restoreFocus = true) {
    stopViewerMotion();
    closingMapAnchor = null;
    dialog.style.removeProperty('translate');
    viewerState = 'closed';
    closingViewer = false;
    dialog.dataset.state = 'closed';
    dialog.classList.remove('photo-collapsing');
    if (dialog.open) dialog.close();
    document.body.classList.remove('photo-fullscreen');
    fadeBackdrop(false, true);
    syncSelectedPin();
    photoZoom.setActive(false);
    clearTimeout(zoomImageTimer);
    zoomImageTimer = null;
    cancelImageRequest();
    image.removeAttribute('src');
    delete image.dataset.photoId;
    delete image.dataset.variantWidth;
    pixels.style.removeProperty('background-image');
    if (restoreFocus) {
      const target =
        selectedPin()?.marker.getElement() ||
        (returnFocus?.isConnected ? returnFocus : map.getContainer());
      target.focus({ preventScroll: true });
    }
  }
  function closeViewer() {
    if (!dialog.open || closingViewer) return;
    photoZoom.reset();
    const from = frameRect(),
      to = photoAnchor(selection[selectedIndex]);
    closingViewer = true;
    const coords = selection[selectedIndex].coords;
    closingMapAnchor = to ? { coords, point: containerPoint(coords) } : null;
    dialog.classList.add('photo-collapsing');
    fadeBackdrop(false);
    moveFrame(from, to || { ...from, width: 48, height: 48 }, () => finishClose());
  }
  function followClosingAnchor() {
    if (!closingMapAnchor) return;
    // The fixed dialog must travel with the map while it shrinks back into
    // the print. Keep this offset separate from the size/position animation.
    const offset = containerPoint(closingMapAnchor.coords).subtract(closingMapAnchor.point);
    dialog.style.translate = `${offset.x}px ${offset.y}px`;
  }
  function stepBack() {
    if (closingViewer) return;
    if (viewerState === 'full') present('medium');
    else closeViewer();
  }
  function resizeViewer() {
    if (!dialog.open) return;
    if (closingViewer) {
      finishClose();
      return;
    }
    stopViewerMotion();
    photoZoom.reset();
    const to = targetFrame(viewerState);
    moveFrame(null, to);
  }
  window.addEventListener('resize', resizeViewer);
  function outsidePress(event) {
    if (
      !dialog.open ||
      viewerState !== 'medium' ||
      dialog.contains(event.target) ||
      event.target.closest('.photo-pin')
    )
      return;
    closeViewer();
  }
  function escapeViewer(event) {
    if (event.key !== 'Escape' || !dialog.open) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    stepBack();
  }
  document.addEventListener('pointerdown', outsidePress);
  document.addEventListener('keydown', escapeViewer, true);
  function photoSpacing(zoom) {
    return zoom < 8 ? 38 : 32;
  }
  function firstSplitZoom(items) {
    // Layout groups around the first photo, rather than the stack's midpoint.
    const maxZoom = map.getMaxZoom(),
      anchor = map.project(items[0].coords, maxZoom);
    const radius = items.reduce(
      (distance, photo) =>
        Math.max(distance, anchor.distanceTo(map.project(photo.coords, maxZoom))),
      0
    );
    if (radius < photoSpacing(maxZoom)) return null;
    const overviewZoom = map.getScaleZoom(photoSpacing(0) / radius, maxZoom);
    const detailZoom = map.getScaleZoom(photoSpacing(8) / radius, maxZoom);
    // Spacing shrinks at zoom 8. Step just beyond the boundary to avoid rounding
    // back into the same stack at the end of the camera animation.
    return Math.min(maxZoom, Math.min(overviewZoom, Math.max(8, detailZoom)) + 0.01);
  }
  function select(items) {
    if (cancelFocus) {
      cancelFocus();
      cancelFocus = null;
    }
    map.closePopup();
    if (items.length === 1) {
      openPhoto(items);
      return;
    }
    const bounds = L.latLngBounds(items.map(photo => photo.coords));
    const splitZoom = firstSplitZoom(items);
    if (splitZoom !== null) {
      focus({
        bounds,
        country: items.every(photo => photo.country === items[0].country) ? items[0].country : null,
        maxZoom: Math.min(map.getMaxZoom(), Math.max(map.getZoom() + 3, splitZoom))
      });
    } else {
      cancelFocus = focus({
        coords: items[0].coords,
        country: items[0].country,
        zoom: Math.max(15, map.getZoom()),
        complete: () => {
          cancelFocus = null;
          openPhoto(items);
        }
      });
    }
  }

  const loadedThumbnails = new Set();
  function thumbnailPrint(photo) {
    const node = document.createElement('span');
    node.className = 'photo-pin-print';
    node.dataset.photoId = photo.id;
    const wrapper = document.createElement('span');
    wrapper.className = 'photo-pin-image';
    const thumbnail = document.createElement('img');
    thumbnail.alt = '';
    thumbnail.width = 40;
    thumbnail.height = 40;
    thumbnail.decoding = 'async';
    const src = asset(photo.variants.thumbnail.src);
    if (!loadedThumbnails.has(src)) thumbnail.classList.add('photo-thumbnail-loading');
    const reveal = () => {
      loadedThumbnails.add(src);
      // Cached, decoded thumbnails arrive immediately; only new arrivals fade.
      if (
        thumbnail.complete &&
        thumbnail.naturalWidth &&
        !thumbnail.classList.contains('photo-thumbnail-loading')
      )
        return;
      thumbnail.classList.remove('photo-thumbnail-loading');
    };
    thumbnail.addEventListener('load', reveal, { once: true });
    thumbnail.addEventListener(
      'error',
      () => {
        const fallback = document.createElement('span');
        fallback.textContent = '▧';
        thumbnail.replaceWith(fallback);
        wrapper.classList.add('photo-pin-fallback');
      },
      { once: true }
    );
    thumbnail.src = src;
    if (thumbnail.complete && thumbnail.naturalWidth) {
      loadedThumbnails.add(src);
      thumbnail.classList.remove('photo-thumbnail-loading');
    }
    wrapper.append(thumbnail);
    node.append(wrapper);
    return node;
  }

  const clamp = value => Math.max(0, Math.min(1, value));
  const mix = (a, b, t) => a + (b - a) * t;
  const slot = index =>
    index === 0
      ? { x: 0, y: 0, angle: 0 }
      : index === 1
        ? { x: 5, y: -4, angle: 9 }
        : { x: -5, y: -7, angle: -10 };
  function requestFrame() {
    if (frame === null) frame = requestAnimationFrame(tick);
  }
  function removePrint(print) {
    motions.delete(print);
    prints.delete(print.photo.id);
    print.node.remove();
  }
  function restingState(pin, index) {
    const offset = slot(index);
    return {
      anchor: pin.marker.getLatLng(),
      offset: L.point(offset.x, offset.y),
      angle: offset.angle,
      scale: 1,
      depth: depths.get(pin.items[index].id),
      moving: false
    };
  }
  function snapshotPrint(print) {
    if (motions.has(print)) {
      // Travelling cards are fully controlled here; reuse their current pose
      // without asking the browser to resolve layout or computed transforms.
      return {
        anchor: print.visualAnchor,
        offset: print.visualOffset.add(print.visualWorld.subtract(layerPoint(print.visualAnchor))),
        angle: print.angle,
        scale: print.scale,
        depth: print.travelDepth,
        moving: true
      };
    }
    if (!print.pin.interacted && !print.pin.marker.getElement().matches(':hover,:focus-visible'))
      return restingState(print.pin, print.index);
    const style = getComputedStyle(print.node);
    const matrix = new DOMMatrixReadOnly(style.transform === 'none' ? undefined : style.transform);
    const paperScale = Number(style.scale) || 1;
    const anchor = motions.has(print) ? print.visualAnchor : print.pin.marker.getLatLng();
    const base = layerPoint(print.pin.marker.getLatLng()),
      point = layerPoint(anchor);
    // Keep paper offsets in pixels, separate from geographic movement. Zooming
    // must not enlarge the spacing or tilt of a stack before it releases. Its
    // center follows the transform's translation; no layout measurement is needed.
    return {
      anchor,
      offset: base.subtract(point).add([matrix.e * paperScale, matrix.f * paperScale]),
      angle: (Math.atan2(matrix.b, matrix.a) * 180) / Math.PI,
      scale: Math.hypot(matrix.a, matrix.b) * paperScale,
      depth: Number(style.zIndex),
      moving: motions.has(print)
    };
  }
  function paint(print, time) {
    const elapsed = time - print.started;
    const t = clamp((elapsed - print.delay) / print.duration);
    const release = print.from.moving ? t : clamp((t - 0.17) / 0.83);
    const travel = release === 0 ? 0 : 1 + 2.15 * (release - 1) ** 3 + 1.15 * (release - 1) ** 2;
    const anchor = layerPoint(print.pin.marker.getLatLng()),
      offset = slot(print.index);
    const source = layerPoint(print.from.anchor);
    const world = L.point(mix(source.x, anchor.x, travel), mix(source.y, anchor.y, travel));
    print.visualOffset = L.point(
      mix(print.from.offset.x, offset.x, travel),
      mix(print.from.offset.y, offset.y, travel)
    );
    print.visualWorld = world;
    const point = world.add(print.visualOffset);
    const pop = print.from.moving
      ? 0
      : t <= 0.34
        ? -0.1 * Math.sin(Math.PI * clamp(t / 0.34))
        : 0.035 * Math.sin(Math.PI * release);
    print.scale = mix(print.from.scale, 1, release) + pop;
    print.angle = mix(print.from.angle, offset.angle, travel);
    print.visualAnchor = layerLatLng(world);
    print.node.style.transform = `translate3d(${point.x - anchor.x}px, ${point.y - anchor.y}px, 0) rotate(${print.angle}deg) scale(${print.scale})`;
    if (t < 1) return;
    motions.delete(print);
    print.node.classList.remove('photo-print-travelling');
    print.node.style.removeProperty('--photo-travel-depth');
    print.node.style.removeProperty('transform');
    if (print.index >= 3) removePrint(print);
  }
  function animatePrint(print, source, merging, time) {
    print.from = source;
    print.started = time;
    // Rear prints arrive first; the actual front print lands last and stays there.
    // Every print follows its own identity into its final slot, with no icon swap.
    print.delay = merging && !source.moving ? Math.max(0, 2 - print.index) * 32 : 0;
    print.duration = merging ? motionDuration - 64 : motionDuration;
    print.travelDepth = merging ? depths.get(print.photo.id) : source.depth;
    print.node.style.setProperty('--photo-travel-depth', String(print.travelDepth));
    print.node.classList.add('photo-print-travelling');
    motions.add(print);
    paint(print, time);
    requestFrame();
  }
  function settlePins() {
    pins.forEach(pin => {
      const moving = [...motions].some(print => print.pin === pin);
      pin.marker.getElement().classList.toggle('photo-pin-moving', moving);
      const front = prints.get(pin.items[0].id);
      pin.marker
        .getElement()
        .classList.toggle('photo-pin-assembling', Boolean(front && motions.has(front)));
    });
  }
  function tick(time) {
    frame = null;
    // Regrouping rebuilds pins and thumbnails. While the camera is moving,
    // do it a few times a second; pins still track the map every frame.
    if (layoutPending && time - lastLayout >= 120) {
      layoutPending = false;
      layout();
    }
    motions.forEach(print => paint(print, time));
    settlePins();
    if (motions.size || layoutPending) requestFrame();
  }
  function queueLayout() {
    layoutPending = true;
    requestFrame();
  }

  let pressedPin = null;
  function releasePress() {
    pressedPin?.classList.remove('photo-pin-pressed');
    pressedPin = null;
  }
  window.addEventListener('pointerup', releasePress);
  window.addEventListener('pointercancel', releasePress);
  map.on('dragstart zoomstart', releasePress);
  function createPin(group, position) {
    const photo = group.items[0],
      collection = group.items.length > 1;
    const wrapper = document.createElement('span');
    wrapper.className = 'photo-pin-content';
    if (collection) {
      const badge = document.createElement('span');
      badge.className = 'photo-pin-count';
      badge.textContent = group.items.length;
      wrapper.append(badge);
    }
    const label = collection
      ? `${photoLabel(photo)} · ${group.items.length} photos nearby`
      : `Photo at ${photoLabel(photo)}`;
    const marker = new PhotoMarker(position, {
      pane: 'photos',
      alt: label,
      icon: L.divIcon({
        className: `photo-pin${collection ? ' photo-pin-stack' : ''}`,
        html: wrapper,
        iconSize: [48, 48],
        iconAnchor: [24, 56]
      }),
      riseOnHover: true
    }).addTo(layer);
    marker.on('click', () => {
      releasePress();
      select(group.items);
    });
    const node = marker.getElement();
    node.setAttribute('aria-haspopup', 'dialog');
    node.setAttribute('aria-label', label);
    const pin = { marker, content: wrapper, items: group.items, interacted: false };
    node.addEventListener('pointerenter', () => {
      pin.interacted = true;
    });
    node.addEventListener('pointerdown', () => {
      pin.interacted = true;
      releasePress();
      pressedPin = node;
      node.classList.add('photo-pin-pressed');
    });
    node.addEventListener('focus', () => {
      pin.interacted = true;
      marker.setZIndexOffset(1000);
    });
    node.addEventListener('blur', () => {
      marker.setZIndexOffset(0);
      releasePress();
    });
    node.addEventListener('keydown', event => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        select(group.items);
      }
    });
    return pin;
  }

  function layout() {
    lastLayout = performance.now();
    const zoom = map.getZoom(),
      size = map.getSize();
    const groups = [],
      cells = new Map();
    const spacing = photoSpacing(zoom);
    (visible ? photos : []).forEach(photo => {
      if (map.isLocationVisible && !map.isLocationVisible(photo.coords)) return;
      const point = containerPoint(photo.coords);
      if (point.x < 30 || point.x > size.x - 30 || point.y < 80 || point.y > size.y - 45) return;
      const x = Math.floor(point.x / spacing),
        y = Math.floor(point.y / spacing);
      let nearby = null;
      for (let dx = -1; dx <= 1; dx++)
        for (let dy = -1; dy <= 1; dy++) {
          // Choose in photo order, independent of the camera-relative grid cells.
          // Crossing a cell edge must not send a print to a different stack.
          (cells.get(`${x + dx},${y + dy}`) || []).forEach(group => {
            if (group.point.distanceTo(point) < spacing && (!nearby || group.order < nearby.order))
              nearby = group;
          });
        }
      if (nearby) nearby.items.push(photo);
      else {
        const group = { point, items: [photo], order: groups.length };
        groups.push(group);
        const key = `${x},${y}`;
        if (!cells.has(key)) cells.set(key, []);
        cells.get(key).push(group);
      }
    });
    const oldOwners = new Map(),
      snapshots = new Map();
    pins.forEach(pin =>
      pin.items.forEach((photo, index) => oldOwners.set(photo.id, { pin, index }))
    );
    const time = performance.now();
    const regrouping =
      groups.length !== pins.size ||
      groups.some(group => !pins.has(group.items.map(photo => photo.id).join('|')));
    if (regrouping && !reduceMotion) {
      motions.forEach(print => paint(print, time));
      // Read every visible source pose before changing parents or hover targets.
      prints.forEach(print => snapshots.set(print.photo.id, snapshotPrint(print)));
    }
    const focused = [...pins.values()].find(
      pin => pin.marker.getElement() === document.activeElement
    );
    const active = new Map(),
      owners = new Map();
    groups.forEach(group => {
      const key = group.items.map(photo => photo.id).join('|');
      const position =
        group.items.length > 1
          ? map.unproject(
              L.bounds(group.items.map(photo => map.project(photo.coords, 0))).getCenter(),
              0
            )
          : group.items[0].coords;
      const pin = pins.get(key) || createPin(group, position);
      pin.marker.setLatLng(position);
      active.set(key, pin);
      group.items.forEach((photo, index) => owners.set(photo.id, { pin, index }));
    });
    // Only the three visible prints of a settled stack request thumbnails.
    owners.forEach(({ pin, index }, id) => {
      const old = oldOwners.get(id);
      let print = prints.get(id);
      if (!print && index >= 3) return;
      if (!print) {
        const photo = pin.items[index];
        print = { photo, node: thumbnailPrint(photo), pin: null, index };
        prints.set(id, print);
        print.node.style.setProperty('--photo-depth', String(depths.get(id)));
      }
      const changed = print.pin !== pin || print.index !== index;
      if (!changed) return;
      const rearId = old?.pin.items[Math.min(old.index, 2)].id;
      const rear = snapshots.get(rearId);
      const source =
        snapshots.get(id) ||
        (rear
          ? { ...rear, depth: rear.depth + depths.get(id) - depths.get(rearId) }
          : old
            ? restingState(old.pin, old.index)
            : null);
      print.pin = pin;
      print.index = index;
      print.node.classList.remove(
        'photo-pin-front',
        'photo-pin-back',
        'photo-pin-back-1',
        'photo-pin-back-2'
      );
      print.node.classList.add(index === 0 ? 'photo-pin-front' : 'photo-pin-back');
      if (index > 0)
        print.node.classList.add(index === 1 ? 'photo-pin-back-1' : 'photo-pin-back-2');
      pin.content.append(print.node);
      if (source && !reduceMotion)
        animatePrint(print, source, pin.items.length > (old?.pin.items.length || 0), time);
      else {
        motions.delete(print);
        print.node.classList.remove('photo-print-travelling');
        print.node.style.removeProperty('transform');
        print.node.style.removeProperty('--photo-travel-depth');
      }
    });
    [...prints.values()].forEach(print => {
      if (!owners.has(print.photo.id) || (print.index >= 3 && !motions.has(print)))
        removePrint(print);
    });
    const retained = new Set(active.values());
    pins.forEach(pin => {
      if (!retained.has(pin)) layer.removeLayer(pin.marker);
    });
    pins.clear();
    active.forEach((pin, key) => pins.set(key, pin));
    settlePins();
    syncSelectedPin();
    if (focused && !retained.has(focused)) {
      const nextPin = owners.get(focused.items[0].id)?.pin;
      if (nextPin) nextPin.marker.getElement().focus({ preventScroll: true });
      else map.getContainer().focus({ preventScroll: true });
    }
  }
  previous.addEventListener('click', () => changeImage(-1));
  next.addEventListener('click', () => changeImage(1));
  expand.addEventListener('click', () => present('full'));
  stage.addEventListener('click', () => {
    if (viewerState !== 'full') present('full');
  });
  stage.addEventListener('keydown', event => {
    if (viewerState === 'medium' && (event.key === 'Enter' || event.key === ' ')) {
      event.preventDefault();
      present('full');
    }
  });
  shrink.addEventListener('click', stepBack);
  dialog.querySelector('.photo-close').addEventListener('click', closeViewer);
  dialog.addEventListener('click', event => {
    if (event.target === dialog && viewerState === 'full') stepBack();
  });
  dialog.addEventListener('cancel', event => {
    event.preventDefault();
    stepBack();
  });
  dialog.addEventListener('keydown', event => {
    if (!closingViewer && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
      event.preventDefault();
      changeImage(event.key === 'ArrowLeft' ? -1 : 1);
    }
    event.stopPropagation();
  });
  // Changing between modal and nonmodal presentation queues a close event.
  dialog.addEventListener('close', () => {
    if (!dialog.open && viewerState !== 'closed') finishClose();
  });
  map.on('dragstart', () => {
    if (viewerState === 'medium') closeViewer();
  });
  map.on('move', followClosingAnchor);
  map.on('popupopen', () => {
    if (dialog.open && viewerState !== 'full') finishClose(false);
  });
  map.on('zoom move', queueLayout);
  map.on('moveend resize', () => {
    layoutPending = false;
    layout();
    onLayout();
  });
  map.on('unload', () => {
    if (frame !== null) cancelAnimationFrame(frame);
    motions.clear();
    prints.clear();
    finishClose(false);
    photoZoom.destroy();
    decodedPhotos.clear();
    decodedPixelCount = 0;
    document.removeEventListener('pointerdown', outsidePress);
    document.removeEventListener('keydown', escapeViewer, true);
    window.removeEventListener('pointerup', releasePress);
    window.removeEventListener('pointercancel', releasePress);
    window.removeEventListener('resize', resizeViewer);
  });
  return {
    setVisible(show) {
      if (visible === Boolean(show)) return;
      visible = Boolean(show);
      if (!visible) {
        releasePress();
        if (cancelFocus) {
          cancelFocus();
          cancelFocus = null;
        }
        if (dialog.open) finishClose(false);
      }
      layout();
      onLayout();
    },
    load(records) {
      const ids = new Set();
      photos = (Array.isArray(records) ? records : []).filter(photo => {
        if (!valid(photo) || ids.has(photo.id)) return false;
        ids.add(photo.id);
        return true;
      });
      photos.sort((a, b) => (b.date || '').localeCompare(a.date || '') || a.id.localeCompare(b.id));
      depths.clear();
      photos.forEach((photo, index) => depths.set(photo.id, 1000 + photos.length - index));
      prints.forEach(print =>
        print.node.style.setProperty('--photo-depth', String(depths.get(print.photo.id)))
      );
      layout();
      onLayout();
    },
    occupied: () => [...pins.values()].map(pin => pin.marker.getElement().getBoundingClientRect()),
    cancel: () => {
      if (cancelFocus) {
        cancelFocus();
        cancelFocus = null;
      }
      if (dialog.open) finishClose(false);
    },
    isOpen: () => dialog.open,
    show: ids => {
      const items = photos.filter(photo => ids.includes(photo.id));
      if (items.length) select(items);
    }
  };
}
