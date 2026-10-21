/* Fullscreen photo gestures; paints at most once per input frame. */
'use strict';
function installPhotoZoom(viewport, pixels, image, {canInteract, onScale}) {
  const pointers = new Map();
  const controls = document.querySelector('.photo-zoom-controls');
  const out = controls.querySelector('.photo-zoom-out');
  const resetButton = controls.querySelector('.photo-zoom-reset');
  const into = controls.querySelector('.photo-zoom-in');
  let active = false, scale = 1, x = 0, y = 0, bounds = null, gesture = null, paintFrame = null;
  const limit = (value, min, max) => Math.max(min, Math.min(max, value));
  const enabled = () => active && canInteract();
  function measure() {
    if (!bounds) {
      const box = viewport.getBoundingClientRect();
      const ratio = Number(image.getAttribute('width')) / Number(image.getAttribute('height'));
      const width = Math.min(box.width, box.height * ratio);
      bounds = {left: box.left, top: box.top, width: box.width, height: box.height,
        photoWidth: width, photoHeight: width / ratio};
    }
    return bounds;
  }
  function paint() {
    paintFrame = null;
    pixels.style.transform = scale === 1 ? '' : `translate3d(${x}px,${y}px,0) scale(${scale})`;
    viewport.classList.toggle('photo-zoomed', scale > 1);
    viewport.classList.toggle('photo-dragging', pointers.size > 0 && scale > 1);
    resetButton.textContent = `${Math.round(scale * 100)}%`;
    out.disabled = scale <= 1;
    into.disabled = scale >= 6;
  }
  function queuePaint() { if (paintFrame === null) paintFrame = requestAnimationFrame(paint); }
  function setPose(nextScale, nextX, nextY) {
    const box = measure(), oldScale = scale;
    scale = limit(nextScale, 1, 6);
    function constrain(offset, size, photoSize) {
      const gap = (size - photoSize) / 2;
      return photoSize * scale <= size ? size * (1 - scale) / 2
        : limit(offset, size - scale * (gap + photoSize), -scale * gap);
    }
    x = constrain(nextX, box.width, box.photoWidth);
    y = constrain(nextY, box.height, box.photoHeight);
    queuePaint();
    if (scale !== oldScale) onScale();
  }
  function zoomAt(nextScale, point) {
    nextScale = limit(nextScale, 1, 6);
    const ratio = nextScale / scale;
    setPose(nextScale, point.x + (x - point.x) * ratio, point.y + (y - point.y) * ratio);
  }
  function center() { const box = measure(); return {x: box.width / 2, y: box.height / 2}; }
  function local(point) { const box = measure(); return {x: point.clientX - box.left, y: point.clientY - box.top}; }
  function positions() {
    const points = [...pointers.values()].slice(0, 2).map(local);
    if (points.length < 2) return {point: points[0], distance: 0};
    return {point: {x: (points[0].x + points[1].x) / 2, y: (points[0].y + points[1].y) / 2},
      distance: Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y)};
  }
  function beginGesture() {
    gesture = pointers.size ? {...positions(), scale, x, y} : null;
    queuePaint();
  }
  function down(event) {
    if (!enabled() || event.button !== 0 || event.pointerType === 'mouse' && scale === 1) return;
    event.preventDefault();
    viewport.setPointerCapture(event.pointerId);
    pointers.set(event.pointerId, {clientX: event.clientX, clientY: event.clientY});
    beginGesture();
  }
  function move(event) {
    if (!enabled() || !pointers.has(event.pointerId)) return;
    event.preventDefault();
    pointers.set(event.pointerId, {clientX: event.clientX, clientY: event.clientY});
    const current = positions();
    const nextScale = gesture.distance > 0 ? limit(gesture.scale * current.distance / gesture.distance, 1, 6) : scale;
    const ratio = nextScale / gesture.scale;
    setPose(nextScale, current.point.x + (gesture.x - gesture.point.x) * ratio,
      current.point.y + (gesture.y - gesture.point.y) * ratio);
  }
  function up(event) {
    if (!pointers.delete(event.pointerId)) return;
    if (viewport.hasPointerCapture(event.pointerId)) viewport.releasePointerCapture(event.pointerId);
    beginGesture();
  }
  function wheel(event) {
    if (!enabled()) return;
    event.preventDefault(); event.stopPropagation();
    const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? measure().height : 1;
    const delta = limit(event.deltaY * unit, -240, 240);
    zoomAt(scale * Math.exp(-delta * (event.ctrlKey ? .01 : .002)), local(event));
  }
  function keydown(event) {
    if (!enabled() || event.ctrlKey || event.metaKey || event.altKey) return;
    if (['+', '='].includes(event.key)) zoomAt(scale * 1.25, center());
    else if (['-', '_'].includes(event.key)) zoomAt(scale / 1.25, center());
    else if (['0', 'Home'].includes(event.key)) reset();
    else if (scale > 1 && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) {
      setPose(scale, x + (event.key === 'ArrowLeft' ? 48 : event.key === 'ArrowRight' ? -48 : 0),
        y + (event.key === 'ArrowUp' ? 48 : event.key === 'ArrowDown' ? -48 : 0));
    } else return;
    event.preventDefault(); event.stopPropagation();
  }
  function reset() {
    for (const id of pointers.keys()) if (viewport.hasPointerCapture(id)) viewport.releasePointerCapture(id);
    pointers.clear(); gesture = null; bounds = null;
    const changed = scale !== 1;
    scale = 1; x = y = 0;
    if (paintFrame !== null) cancelAnimationFrame(paintFrame);
    paint();
    if (changed) onScale();
  }
  function zoomOut() { if (enabled()) zoomAt(scale / 1.25, center()); }
  function zoomIn() { if (enabled()) zoomAt(scale * 1.25, center()); }
  function fit() { if (enabled()) reset(); }
  const listeners = [['pointerdown', down], ['pointermove', move], ['pointerup', up],
    ['pointercancel', up], ['lostpointercapture', up], ['wheel', wheel]];
  listeners.forEach(([name, handler]) => viewport.addEventListener(name, handler, {passive: false}));
  viewport.parentElement.addEventListener('keydown', keydown);
  out.addEventListener('click', zoomOut);
  into.addEventListener('click', zoomIn);
  resetButton.addEventListener('click', fit);
  paint();
  return {
    get scale() { return scale; },
    reset,
    invalidate: () => { bounds = null; },
    setActive(value) {
      if (value !== active) reset();
      active = value;
      controls.hidden = !value;
      viewport.classList.toggle('photo-zoomable', value);
    },
    destroy() {
      reset();
      listeners.forEach(([name, handler]) => viewport.removeEventListener(name, handler));
      viewport.parentElement.removeEventListener('keydown', keydown);
      out.removeEventListener('click', zoomOut);
      into.removeEventListener('click', zoomIn);
      resetButton.removeEventListener('click', fit);
    }
  };
}
