// Continuous camera zoom for the bundled Leaflet 1.9 map. Keep one geographic
// anchor under the pointer and interpolate the camera once per animation frame.
// Leaflet's _move hooks scale its tiles and vector renderer during the gesture;
// _moveEnd then refreshes tile levels and reprojects vector geometry once.
function installSmoothZoom(map, reduceMotion) {
  if (map.installSmoothZoom) return map.installSmoothZoom(reduceMotion);
  const element = map.getContainer();
  let frame = null, target = map.getZoom(), anchor, point, moving = false, lastTime = 0, idleTimer;
  const clamp = zoom => Math.max(map.getMinZoom(), Math.min(map.getMaxZoom(), zoom));
  function finish() {
    if (frame !== null) cancelAnimationFrame(frame);
    frame = null;
    clearTimeout(idleTimer);
    if (moving) { moving = false; map._moveEnd(true); }
    target = map.getZoom();
  }
  function tick(time) {
    const elapsed = lastTime === null ? 16 : Math.max(1, Math.min(time - lastTime, 64));
    lastTime = time;
    const current = map.getZoom();
    const next = current + (target - current) * (reduceMotion ? 1 : 1 - Math.exp(-elapsed / 65));
    const zoom = Math.abs(target - next) < .002 ? target : next;
    const offset = point.subtract(map.getSize().divideBy(2));
    const center = map.unproject(map.project(anchor, zoom).subtract(offset), zoom);
    map._move(center, zoom, {pinch: true});
    if (zoom !== target) frame = requestAnimationFrame(tick);
    else { frame = null; idleTimer = setTimeout(finish, 100); }
  }
  function zoomBy(delta, cursor = map.getSize().divideBy(2)) {
    clearTimeout(idleTimer);
    if (!moving) {
      map.stop();
      target = map.getZoom();
      moving = true;
      map._moveStart(true, false);
    }
    anchor = map.containerPointToLatLng(cursor);
    point = cursor;
    target = clamp(target + delta);
    if (frame === null) { lastTime = null; frame = requestAnimationFrame(tick); }
  }
  function wheel(event) {
    // Browser pinch-to-zoom on trackpads arrives as a Ctrl-wheel event.
    const units = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? element.clientHeight : 1;
    const delta = -event.deltaY * units * (event.ctrlKey ? .01 : .0025);
    if (!delta || event.target.closest('.leaflet-control,.leaflet-popup')) return;
    event.preventDefault();
    zoomBy(Math.max(-1, Math.min(1, delta)), map.mouseEventToContainerPoint(event));
  }
  element.addEventListener('wheel', wheel, {passive: false});
  element.addEventListener('pointerdown', finish);
  element.addEventListener('touchstart', finish, {passive: true});
  element.addEventListener('keydown', finish);
  map.on('unload', () => { finish(); element.removeEventListener('wheel', wheel); });
  return {finish};
}
