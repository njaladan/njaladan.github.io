// Athletics: every GPS activity drawn as a shape, shuffled, with sport/year filters,
// a viewer that draws one shape in, and a canvas "stack" of every selected shape.
const SPORTS = {
  run: { label: 'Running', name: 'Run', color: '#c4466e' },
  ride: { label: 'Cycling', name: 'Ride', color: '#1c80b0' },
  foot: { label: 'Hiking & walking', name: 'Walk or hike', color: '#7a9a22' },
  snow: { label: 'Snowboarding', name: 'Snowboard', color: '#6a5fb0' },
  other: { label: 'Other', name: 'Other', color: '#77756f' }
};
const all = (window.SHAPES || []).map(s => ({ ...s, year: +s.date.slice(0, 4) }));
for (let i = all.length - 1; i > 0; i--) {
  const j = Math.floor(Math.random() * (i + 1));
  [all[i], all[j]] = [all[j], all[i]];
}
const state = { sport: 'all', year: 'all', view: 'grid' };
let list = [],
  current = -1;
const $ = id => document.getElementById(id);
const fmtDate = (iso, opts = { month: 'long', day: 'numeric', year: 'numeric' }) =>
  new Date(iso + 'T12:00:00').toLocaleDateString('en-US', opts);
const points = seg => {
  let s = '';
  for (let i = 0; i < seg.length; i += 2) s += seg[i] + ',' + seg[i + 1] + ' ';
  return s;
};
const lines = s =>
  s.segs
    .map(seg => `<polyline points="${points(seg)}" stroke="${SPORTS[s.sport].color}"/>`)
    .join('');

function chips(el, keys, label, swatch, key) {
  el.innerHTML = keys
    .map(
      k =>
        `<button type="button" aria-pressed="${k === 'all'}">${swatch && k !== 'all' ? `<span class="shape-swatch" style="background:${SPORTS[k].color}"></span>` : ''}${label(k)}</button>`
    )
    .join('');
  el.querySelectorAll('button').forEach((b, i) =>
    b.addEventListener('click', () => {
      state[key] = keys[i];
      el.querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed', x === b));
      render();
    })
  );
}
chips(
  $('shape-sports'),
  ['all', 'run', 'ride', 'foot', 'snow'],
  k => (k === 'all' ? 'Everything' : SPORTS[k].label),
  true,
  'sport'
);
chips(
  $('shape-years'),
  ['all', ...[...new Set(all.map(s => s.year))].sort()],
  k => (k === 'all' ? 'All years' : k),
  false,
  'year'
);
document.querySelectorAll('.shape-view button').forEach(b =>
  b.addEventListener('click', () => {
    state.view = b.dataset.view;
    document
      .querySelectorAll('.shape-view button')
      .forEach(x => x.setAttribute('aria-pressed', x === b));
    render();
  })
);

function render() {
  list = all.filter(
    s =>
      (state.sport === 'all' || s.sport === state.sport) &&
      (state.year === 'all' || s.year === state.year)
  );
  $('shape-count').textContent = `${list.length.toLocaleString()} shapes`;
  $('shape-grid').hidden = state.view !== 'grid';
  $('shape-stack').hidden = state.view !== 'stack';
  if (state.view === 'grid') {
    $('shape-grid').innerHTML = list
      .map(
        (s, n) =>
          `<button type="button" class="shape-cell" data-n="${n}" aria-label="${SPORTS[s.sport].name}, ${fmtDate(s.date)}"><svg viewBox="-60 -60 1120 1120" aria-hidden="true">${lines(s)}</svg></button>`
      )
      .join('');
  } else {
    drawStack();
  }
}

// A canvas keeps the stack light on phones; a thousand blended SVG paths can exhaust memory on iOS.
function drawStack() {
  const canvas = $('shape-canvas');
  const css = canvas.getBoundingClientRect().width || 720;
  const px = Math.round(css * Math.min(window.devicePixelRatio || 1, 2));
  canvas.width = canvas.height = px;
  const ctx = canvas.getContext('2d');
  const scale = px / 1080;
  ctx.setTransform(scale, 0, 0, scale, 40 * scale, 40 * scale);
  ctx.fillStyle = '#fff';
  ctx.fillRect(-40, -40, 1080, 1080);
  ctx.globalCompositeOperation = 'multiply';
  ctx.globalAlpha = Math.max(0.05, Math.min(0.6, 3.5 / Math.sqrt(list.length || 1)));
  ctx.lineWidth = ((2 / scale) * Math.min(window.devicePixelRatio || 1, 2)) / 2;
  ctx.lineJoin = ctx.lineCap = 'round';
  for (const s of list) {
    ctx.strokeStyle = SPORTS[s.sport].color;
    ctx.beginPath();
    for (const seg of s.segs) {
      ctx.moveTo(seg[0], seg[1]);
      for (let i = 2; i < seg.length; i += 2) ctx.lineTo(seg[i], seg[i + 1]);
    }
    ctx.stroke();
  }
}
let resize;
window.addEventListener('resize', () => {
  clearTimeout(resize);
  resize = setTimeout(() => state.view === 'stack' && drawStack(), 150);
});

// Viewer
const viewer = $('shape-viewer'),
  big = $('shape-svg');
function open(n) {
  current = (n + list.length) % list.length;
  const s = list[current];
  $('shape-title').textContent = SPORTS[s.sport].name;
  $('shape-date').textContent = fmtDate(s.date);
  const first = s.segs[0],
    last = s.segs[s.segs.length - 1];
  big.innerHTML =
    lines(s) +
    `<circle cx="${first[0]}" cy="${first[1]}" r="16" fill="#faf8f3" stroke="#272724" stroke-width="5"/>` +
    `<circle class="shape-end" cx="${last[last.length - 2]}" cy="${last[last.length - 1]}" r="14" fill="#272724" opacity="0"/>`;
  if (!viewer.open) viewer.showModal();
  draw();
}
function draw() {
  const polys = [...big.querySelectorAll('polyline')];
  const lengths = polys.map(p => p.getTotalLength());
  const total = lengths.reduce((a, b) => a + b, 0) || 1;
  const duration = matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 1600;
  let start = 0;
  polys.forEach((p, i) => {
    p.style.transition = 'none';
    p.style.strokeDasharray = lengths[i];
    p.style.strokeDashoffset = lengths[i];
    p.getBoundingClientRect();
    const share = (lengths[i] / total) * duration;
    p.style.transition = `stroke-dashoffset ${share}ms linear ${start}ms`;
    p.style.strokeDashoffset = 0;
    start += share;
  });
  const end = big.querySelector('.shape-end');
  end.style.transition = `opacity .3s ${duration}ms`;
  requestAnimationFrame(() => end.setAttribute('opacity', 1));
}
$('shape-grid').addEventListener('click', e => {
  const b = e.target.closest('.shape-cell');
  if (b) open(+b.dataset.n);
});
$('shape-close').addEventListener('click', () => viewer.close());
viewer.addEventListener('click', e => {
  if (e.target === viewer) viewer.close();
});
document.addEventListener('keydown', e => {
  if (!viewer.open) return;
  if (e.key === 'ArrowRight') open(current + 1);
  if (e.key === 'ArrowLeft') open(current - 1);
});
render();
