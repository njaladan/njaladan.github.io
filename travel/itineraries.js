// Saved trips are ordered days of legs that link to the original activity and
// transport records. A side panel lists the trips and shows one trip's days
// beside the map; route cards link to it. No completion is stored.
function installTripItineraries({
  cards,
  modes,
  onFit,
  onHighlight,
  onToggle,
  closePopup,
  geometry,
  photos,
  showPhotos
}) {
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const panel = document.querySelector('#trip-itinerary');
  const launcher = document.querySelector('#trip-itineraries-button');
  const content = panel.querySelector('.trip-itinerary-content');
  const heading = panel.querySelector('#trip-itinerary-title');
  const back = panel.querySelector('.trip-itinerary-back');
  const activityRefs = new Map(),
    transportRefs = new Map(),
    trips = new Map();
  let currentId = null,
    view = 'list',
    opener = null,
    highlighted = '',
    closeTimer = null,
    photoCache = { source: null, days: new Map() };
  const mode = key => modes[key] || { name: key, color: '#697c84' };
  const modeTag = key =>
    `<span class="itinerary-mode" style="--mode:${mode(key).color}">${cards.icon(key)}${escapeHtml(mode(key).name)}</span>`;
  const distance = km => {
    const [value, unit] = cards.formatDistance(km, 1);
    return `${value} ${unit.toLowerCase()}`;
  };
  const duration = seconds => {
    const minutes = Math.round(seconds / 60);
    return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}`;
  };
  const dateLabel = date =>
    new Date(`${date}T12:00:00`).toLocaleDateString(undefined, {
      weekday: 'short',
      month: 'short',
      day: 'numeric'
    });
  const dayModes = day => [...new Set(day.legs.map(leg => leg.mode))];
  const dayPoints = day => [
    ...day.legs.flatMap(leg => geometry(leg)),
    ...day.places.map(place => place.coords)
  ];
  // Long-haul flights would zoom a whole trip out to a continent and pull in
  // photos from far away, so trip views and photo matching use the ground legs.
  const groundPoints = day => [
    ...day.legs.filter(leg => leg.kind !== 'flight').flatMap(leg => geometry(leg)),
    ...day.places.map(place => place.coords)
  ];
  // Hiking trips fit to the trail itself, so a long bus or taxi transfer to the
  // trailhead doesn't zoom the overview out.
  const trailPoints = day => [
    ...day.legs.filter(leg => leg.kind === 'activity').flatMap(leg => geometry(leg)),
    ...day.places.map(place => place.coords)
  ];
  const tripPoints = trip => {
    const trail = trip.fit === 'activities' ? trip.days.flatMap(trailPoints) : [];
    if (trail.length) return trail;
    const points = trip.days.flatMap(groundPoints);
    return points.length ? points : trip.days.flatMap(dayPoints);
  };

  function load(definitions, journeys, transport, flightLog = { airports: {}, routes: [] }) {
    trips.clear();
    activityRefs.clear();
    transportRefs.clear();
    photoCache = { source: null, days: new Map() };
    const activities = new Map(
      journeys.flatMap(journey => (journey.days || []).map(record => [record.id, record]))
    );
    const routes = new Map(transport.map(record => [record.id, record]));
    (definitions?.trips || []).forEach(definition => {
      if (!/^[a-z0-9-]+$/.test(definition.id) || !Array.isArray(definition.days)) return;
      const days = definition.days
        .map((source, number) => {
          const legs = (source.legs || []).flatMap(item => {
            if (item.activity) {
              const activity = activities.get(item.activity);
              return activity
                ? [
                    {
                      kind: 'activity',
                      id: activity.id,
                      mode: activity.type,
                      title: item.name || activity.name || 'Activity',
                      distanceKm: Number.isFinite(activity.distance_m)
                        ? activity.distance_m / 1000
                        : null,
                      elapsed: activity.elapsed_s,
                      elevation: activity.elevation_m
                    }
                  ]
                : [];
            }
            if (item.flight) {
              const [from, to] = item.flight.map(code => flightLog.airports?.[code]);
              if (!from || !to) return [];
              // A flight leg names its connection by sorted airport codes, as the map draws it.
              return [
                {
                  kind: 'flight',
                  id: [...item.flight].sort().join('-'),
                  mode: 'Flight',
                  title: item.name || `${from.city} → ${to.city}`,
                  detail: item.flight.join(' → '),
                  distanceKm: cards.haversine(from.coords, to.coords)
                }
              ];
            }
            const record = routes.get(item.route);
            return record
              ? [
                  {
                    kind: 'transport',
                    id: record.id,
                    mode: record.mode,
                    title: item.name || record.name.split(' · ')[0],
                    distanceKm: cards.km(record.coords)
                  }
                ]
              : [];
          });
          const places = (source.places || []).filter(
            place => place?.name && Array.isArray(place.coords)
          );
          return {
            label: `Day ${number + 1}`,
            title: source.title || '',
            date: source.date || null,
            legs,
            places
          };
        })
        .filter(day => day.legs.length || day.places.length);
      if (!days.length) return;
      const trip = { ...definition, noun: 'day', days, steps: days, index: 0 };
      trips.set(trip.id, trip);
      days.forEach((day, index) =>
        day.legs
          .filter(leg => leg.kind !== 'flight')
          .forEach(leg => {
            const refs = leg.kind === 'activity' ? activityRefs : transportRefs;
            if (!refs.has(leg.id)) refs.set(leg.id, { trip, index });
          })
      );
    });
    if (!trips.has(currentId)) currentId = trips.keys().next().value || null;
    launcher.hidden = !trips.size;
    if (panel.open) {
      if (trips.size) render();
      else close();
    }
  }

  // Each photo belongs to at most one day: a dated photo to the same-dated day
  // nearby, an undated one to the closest day whose route passes close by.
  function dayPhotos(trip) {
    const source = photos();
    if (photoCache.source !== source) photoCache = { source, days: new Map() };
    if (photoCache.days.has(trip.id)) return photoCache.days.get(trip.id);
    const nearest = (photo, points) => {
      let best = Infinity;
      const step = Math.max(1, Math.floor(points.length / 400));
      for (let i = 0; i < points.length; i += step)
        best = Math.min(best, cards.haversine(photo.coords, points[i]));
      return best;
    };
    const days = trip.days.map(() => []);
    const shapes = trip.days.map(day => {
      const points = groundPoints(day);
      // A padded box (about 45 km) skips the distance scan for far-off photos.
      const lats = points.map(point => point[0]),
        lngs = points.map(point => point[1]);
      return {
        day,
        points,
        box: [
          Math.min(...lats) - 0.4,
          Math.max(...lats) + 0.4,
          Math.min(...lngs) - 0.8,
          Math.max(...lngs) + 0.8
        ],
        radius: day.legs.some(leg => leg.kind === 'activity') ? 2 : day.legs.length ? 4 : 15
      };
    });
    source.forEach(photo => {
      let best = -1,
        bestDistance = Infinity;
      shapes.forEach(({ day, points, box, radius }, index) => {
        const [lat, lng] = photo.coords;
        if (!points.length || lat < box[0] || lat > box[1] || lng < box[2] || lng > box[3]) return;
        const d = nearest(photo, points);
        const dated = photo.date && day.date;
        const matches = dated ? photo.date === day.date && d < 40 : d < radius;
        if (matches && d < bestDistance) {
          best = index;
          bestDistance = d;
        }
      });
      if (best >= 0) days[best].push(photo);
    });
    photoCache.days.set(trip.id, days);
    return days;
  }

  function card(context) {
    return context
      ? {
          id: context.trip.id,
          title: context.trip.title,
          noun: 'day',
          steps: context.trip.days.map(day => ({ label: day.label, stop: day.title })),
          index: context.index
        }
      : null;
  }
  function sync(context) {
    if (!context) return;
    const changed = currentId !== context.trip.id || context.trip.index !== context.index;
    currentId = context.trip.id;
    context.trip.index = context.index;
    if (changed && panel.open && view === 'trip') render();
  }

  function legHtml(leg) {
    const stats = [
      leg.detail ? escapeHtml(leg.detail) : '',
      Number.isFinite(leg.distanceKm) ? escapeHtml(distance(leg.distanceKm)) : '',
      Number.isFinite(leg.elapsed) ? `${duration(leg.elapsed)} h` : '',
      Number.isFinite(leg.elevation) && leg.elevation > 0
        ? `↑ ${Math.round(leg.elevation).toLocaleString()} m`
        : ''
    ].filter(Boolean);
    return `<li class="itinerary-leg" data-leg-kind="${leg.kind}" data-leg-id="${escapeHtml(leg.id)}" style="--mode:${mode(leg.mode).color}" tabindex="0">
      <span class="itinerary-leg-icon" aria-hidden="true">${cards.icon(leg.mode)}</span>
      <span class="itinerary-leg-text"><b>${escapeHtml(leg.title)}</b><small><span class="visually-hidden">${escapeHtml(mode(leg.mode).name)} · </span>${stats.map(stat => `<span>${stat}</span>`).join('')}</small></span>
    </li>`;
  }
  function renderList() {
    heading.textContent = 'Itineraries';
    back.hidden = true;
    content.innerHTML = `<p class="itinerary-subtitle">Choose a trip to follow it day by day.</p>
      <ul class="itinerary-trips">${[...trips.values()]
        .map(trip => {
          const cover = dayPhotos(trip).flat()[0];
          const modesUsed = [...new Set(trip.days.flatMap(dayModes))];
          return `<li><button type="button" class="itinerary-trip" data-open-trip="${escapeHtml(trip.id)}">
          ${cover ? `<img src="${escapeHtml(travelAsset(cover.variants.thumbnail.src))}" alt="">` : `<span class="itinerary-trip-icon" style="--mode:${mode(modesUsed[0]).color}" aria-hidden="true">${cards.icon(modesUsed[0])}</span>`}
          <span class="itinerary-trip-text"><b>${escapeHtml(trip.title)}</b>
          <span class="itinerary-trip-meta">${trip.days.length} day${trip.days.length === 1 ? '' : 's'} · ${modesUsed.map(key => `<span style="--mode:${mode(key).color}" title="${escapeHtml(mode(key).name)}">${cards.icon(key)}</span>`).join('')}</span></span>
          <span class="itinerary-trip-arrow" aria-hidden="true">→</span>
        </button></li>`;
        })
        .join('')}</ul>`;
  }
  function renderTrip() {
    const trip = trips.get(currentId);
    if (!trip) return renderList();
    heading.textContent = trip.title;
    back.hidden = false;
    const photosByDay = dayPhotos(trip);
    const allModes = [...new Set(trip.days.flatMap(dayModes))];
    content.innerHTML = `${allModes.length ? `<div class="itinerary-modes" aria-label="Travel modes">${allModes.map(modeTag).join('')}</div>` : ''}
      <ol class="itinerary-days" aria-label="Days">${trip.days
        .map((day, i) => {
          const onFoot = day.legs
            .filter(leg => leg.kind === 'activity' && Number.isFinite(leg.distanceKm))
            .reduce((sum, leg) => sum + leg.distanceKm, 0);
          const dayPhotoList = photosByDay[i];
          return `<li class="itinerary-day${i === trip.index ? ' current' : ''}" data-day="${i}">
          <span class="itinerary-dot" aria-hidden="true">${i + 1}</span>
          <button type="button" class="itinerary-day-head" data-select-day="${i}"${i === trip.index ? ' aria-current="step"' : ''} aria-label="${escapeHtml(`${day.label}: ${day.title}. Show on map`)}">
            <small>${escapeHtml(day.label)}${day.date ? ` · ${escapeHtml(dateLabel(day.date))}` : ''}</small>
            <b>${escapeHtml(day.title)}</b>
            ${onFoot ? `<small class="itinerary-day-total">${escapeHtml(distance(onFoot))} on foot</small>` : ''}
          </button>
          ${day.legs.length ? `<ol class="itinerary-legs">${day.legs.map(legHtml).join('')}</ol>` : ''}
          ${
            dayPhotoList.length
              ? `<div class="itinerary-photos">${dayPhotoList
                  .slice(0, 6)
                  .map(
                    (photo, index) =>
                      `<button type="button" data-day-photo="${i}" data-photo-index="${index}" aria-label="Open photo: ${escapeHtml(photo.gallery?.subject || photo.place || 'Photo')}"><img src="${escapeHtml(travelAsset(photo.variants.thumbnail.src))}" alt=""></button>`
                  )
                  .join(
                    ''
                  )}${dayPhotoList.length > 6 ? `<span>+${dayPhotoList.length - 6}</span>` : ''}</div>`
              : ''
          }
        </li>`;
        })
        .join('')}</ol>
      ${trip.note ? `<p class="itinerary-note">${escapeHtml(trip.note)}</p>` : ''}
      <p class="itinerary-help">Hover a day or leg to find it on the map. Select a day to zoom to it.</p>`;
  }
  function render() {
    highlight(null);
    if (view === 'trip') renderTrip();
    else renderList();
  }

  // The map makes room for the panel as it slides in; a fitted view already does.
  function show(fitted) {
    const opening = !panel.open || closeTimer !== null;
    clearTimeout(closeTimer);
    closeTimer = null;
    if (!panel.open) {
      panel.show();
      // Start off-screen, then slide in beside the map.
      panel.classList.remove('is-visible');
      void panel.offsetWidth;
    }
    panel.classList.add('is-visible');
    if (opening) onToggle(true, !fitted);
  }
  function close() {
    if (!panel.open) return;
    highlight(null);
    panel.classList.remove('is-visible');
    onToggle(false);
    const finish = () => {
      closeTimer = null;
      panel.close();
    };
    if (reduceMotion) finish();
    else
      closeTimer = setTimeout(
        finish,
        (parseFloat(getComputedStyle(panel).transitionDuration) || 0.34) * 1000
      );
    const target = opener?.isConnected ? opener : launcher;
    target.focus({ preventScroll: true });
  }
  // The toolbar button lists the trips; picking one flies to the whole trip.
  function openList(trigger = launcher) {
    view = 'list';
    opener = trigger;
    render();
    show(false);
    content.querySelector('[data-open-trip]')?.focus({ preventScroll: true });
  }
  function open(id = currentId, index, trigger = launcher) {
    const trip = trips.get(id);
    if (!trip) return;
    currentId = id;
    view = 'trip';
    opener = trigger;
    if (Number.isInteger(index) && trip.days[index]) trip.index = index;
    closePopup();
    render();
    show(true);
    onFit(tripPoints(trip));
    const current = content.querySelector('[aria-current="step"]');
    current?.focus({ preventScroll: true });
    // Scroll only the day list: scrollIntoView would also scroll the map area
    // to reach the panel while it is still sliding in from off-screen.
    const day = current?.closest('.itinerary-day');
    content.scrollTop = day && trip.index > 0 ? day.offsetTop - content.offsetTop - 8 : 0;
  }
  function selectDay(index) {
    const trip = trips.get(currentId),
      day = trip?.days[index];
    if (!day) return;
    trip.index = index;
    render();
    content.querySelector('[aria-current="step"]')?.focus({ preventScroll: true });
    onFit(dayPoints(day));
  }
  function highlight(target) {
    const trip = trips.get(currentId);
    let refs = null,
      key = '';
    const leg = target?.closest('[data-leg-id]'),
      day = target?.closest('[data-day]');
    if (leg) {
      refs = [{ kind: leg.dataset.legKind, id: leg.dataset.legId }];
      key = `leg:${leg.dataset.legId}`;
    } else if (day && trip) {
      refs = trip.days[Number(day.dataset.day)].legs.map(({ kind, id }) => ({ kind, id }));
      key = `day:${day.dataset.day}`;
    }
    if (key === highlighted) return;
    highlighted = key;
    content
      .querySelectorAll('.is-highlighted')
      .forEach(node => node.classList.remove('is-highlighted'));
    (leg || day)?.classList.add('is-highlighted');
    onHighlight(refs?.length ? refs : null);
  }

  launcher.addEventListener('click', () => openList(launcher));
  back.addEventListener('click', () => {
    view = 'list';
    render();
    content.querySelector('[data-open-trip]')?.focus({ preventScroll: true });
  });
  content.addEventListener('click', event => {
    const trip = event.target.closest('[data-open-trip]');
    if (trip) {
      open(trip.dataset.openTrip, trips.get(trip.dataset.openTrip)?.index, opener);
      return;
    }
    const photo = event.target.closest('[data-day-photo]');
    if (photo) {
      const list = dayPhotos(trips.get(currentId))[Number(photo.dataset.dayPhoto)] || [];
      const index = Number(photo.dataset.photoIndex);
      showPhotos([...list.slice(index), ...list.slice(0, index)].map(item => item.id));
      return;
    }
    const day = event.target.closest('[data-select-day]');
    if (day) selectDay(Number(day.dataset.selectDay));
  });
  content.addEventListener('pointerover', event => highlight(event.target));
  content.addEventListener('pointerleave', () => highlight(null));
  content.addEventListener('focusin', event => highlight(event.target));
  content.addEventListener('focusout', event => {
    if (!content.contains(event.relatedTarget)) highlight(null);
  });
  panel.querySelector('.trip-itinerary-close').addEventListener('click', close);
  panel.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
    }
    event.stopPropagation();
  });
  return {
    load,
    card,
    open,
    openList,
    close,
    sync,
    isOpen: () => panel.open && closeTimer === null,
    forActivity: record => activityRefs.get(record.id),
    forTransport: record => transportRefs.get(record.id),
    refresh: () => {
      if (panel.open) render();
    }
  };
}
