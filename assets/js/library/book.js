// Preserve the normal note URL for no-JS browsing, sharing, and opening a new tab.
// Otherwise the book comes off the shelf, its front board swings open, and the notes are laid
// out as pages to turn.
import { $ } from '../lib/dom.js';
import { reducedMotion, spineColor, untilt } from './covers.js';
import { peel, polygon, reachable } from './peel.js';
import {
  STRIPS,
  clampSpread,
  folioText,
  heldAngles,
  holdFor,
  leafPages,
  pageCountFor,
  spreadLayout,
  stripAngle,
  stripEdges,
  stripShade
} from './pagination.js';

const EASING = 'cubic-bezier(.55,0,.2,1)';
const CURL_MS = 850;
const COVER_OPEN_MS = 900;
const COVER_CLOSE_MS = 750;
const LIFT_MS = 560;
const SHELVE_MS = 520;
const RESIZE_DEBOUNCE_MS = 150;
// Strips overlap by this many pixels to hide seams.
const STRIP_OVERLAP = 2;
// Stacking order: the closed board sits above the leaves, and a curling leaf above both.
const Z_BOARD_CLOSED = 400;
const Z_CURLING = 300;
const Z_LEAF_BASE = 100;
// A horizontal drag past this many pixels is a swipe; a press that moves less is a tap.
const SWIPE_PX = 40;
const TAP_PX = 8;
// Letting go of a dragged page faster than this (pixels per millisecond) flicks it over or back,
// however far it got.
const FLICK_SPEED = 0.3;
// Resting longer than this before letting go cancels a flick.
const FLICK_WINDOW_MS = 100;
// On a phone, taps in this share of the screen's width from the left go back.
const BACK_ZONE = 0.3;
const FALLBACK_ASPECT = '.6667';
const FALLBACK_SPINE = '#6b5a48';
const DATE_FORMAT = new Intl.DateTimeFormat('en-US', {
  year: 'numeric',
  month: 'long',
  day: 'numeric',
  timeZone: 'UTC'
});

/**
 * @typedef {object} BookElements
 * @property {HTMLDialogElement} dialog
 * @property {HTMLElement} book The open book; transforms move it.
 * @property {HTMLElement} board The front board.
 * @property {HTMLElement} leaves
 * @property {HTMLElement} probe Off-screen box the notes are measured in.
 * @property {HTMLElement} nav
 * @property {HTMLElement} folio
 * @property {MediaQueryList} single Phones show one page at a time.
 */

/** @type {BookElements} */
let ui;
const state = {
  /** @type {HTMLElement | null} */
  shelfCover: null,
  busy: false,
  /** @type {Element | null} */
  notes: null,
  pageCount: 1,
  spread: 0,
  lastSpread: 0,
  lead: 0,
  coverOpen: false
};
/** Running page curls; turns wait until they finish. @type {Set<Promise<unknown>>} */
const curls = new Set();

/**
 * @param {HTMLElement} element
 * @param {Keyframe[]} frames
 * @param {number} duration
 * @param {string} [easing]
 */
const play = (element, frames, duration, easing = EASING) =>
  element.animate(frames, { duration, easing }).finished;

// The closed book is the front board; transforms on the open book move it over a shelf slot or
// to centre stage.
function closedBook() {
  const { book, board } = ui;
  const left = book.offsetLeft + board.offsetLeft;
  const top = book.offsetTop + board.offsetTop;
  book.style.transformOrigin = `${board.offsetLeft}px ${board.offsetTop}px`;
  return {
    centred: `translateX(${innerWidth / 2 - left - board.offsetWidth / 2}px)`,
    /** @param {DOMRect} rect */
    over: rect =>
      `translate(${rect.left - left}px, ${rect.top - top}px) scale(${rect.width / board.offsetWidth}, ${rect.height / board.offsetHeight})`
  };
}

/** @param {string} id */
const textOf = id => document.getElementById(id).textContent;

function titlePage() {
  const header = document.createElement('header');
  header.className = 'page-title';
  const title = document.createElement('h2');
  const byline = document.createElement('p');
  title.textContent = textOf('review-title');
  byline.textContent = ['review-author', 'review-meta'].map(textOf).filter(Boolean).join(' · ');
  header.append(title, byline);
  return header;
}

/**
 * One face of a leaf, showing page `number` of the measured run, or blank.
 * @param {HTMLElement} flow
 * @param {{ number: number, side: string, step: number }} page
 */
function pageFace(flow, { number, side, step }) {
  const face = document.createElement('div');
  face.className = `leaf-face leaf-${side}`;
  if (number >= 0 && number < state.pageCount) {
    const run = /** @type {HTMLElement} */ (flow.cloneNode(true));
    run.style.transform = `translateX(${-number * step}px)`;
    const mark = document.createElement('span');
    mark.className = 'folio';
    mark.textContent = String(number + 1);
    face.append(run, mark);
  }
  return face;
}

// The notes are set once in page-tall columns, headed by the title; each page shows one column of
// that run. A spread shows two pages, and its first leaf turns with the cover so the book opens on
// pages 1 and 2; a phone shows one page at a time.
function paginate() {
  const flow = $('.page-flow', ui.probe);
  const content = /** @type {Element} */ (state.notes.cloneNode(true));
  content.prepend(titlePage());
  flow.replaceChildren(content);
  const width = flow.clientWidth;
  flow.style.columnWidth = `${width}px`;
  const step = width + parseFloat(getComputedStyle(flow).columnGap);
  const single = ui.single.matches;
  state.pageCount = pageCountFor(flow.scrollWidth, width, step);
  Object.assign(state, spreadLayout(state.pageCount, single));
  ui.leaves.replaceChildren(
    ...Array.from({ length: state.lastSpread + 1 + state.lead }, (_, index) => {
      const [front, back] = leafPages(index, single);
      const leaf = document.createElement('div');
      leaf.className = 'leaf';
      leaf.append(
        pageFace(flow, { number: front, side: 'front', step }),
        pageFace(flow, { number: back, side: 'back', step })
      );
      return leaf;
    })
  );
  flow.replaceChildren();
}

/**
 * A copy of `face`, shifted so only the strip starting `offset` pixels in shows.
 * @param {HTMLElement} face
 * @param {{ offset: number, side: string, width: number }} strip
 */
function slice(face, { offset, side, width }) {
  const holder = document.createElement('div');
  holder.className = `curl-face curl-${side}`;
  const copy = /** @type {HTMLElement} */ (face.cloneNode(true));
  // Percentage padding would resolve against the narrow strip and reflow the text, so pin it.
  Object.assign(copy.style, {
    left: `${-offset}px`,
    width: `${width}px`,
    padding: getComputedStyle(face).padding,
    transform: 'none'
  });
  holder.append(copy);
  return holder;
}

/**
 * Cuts a leaf into strips, each nested in (and so hinged to) the last.
 * @param {HTMLElement} leaf
 * @returns {{ stack: HTMLElement, strips: HTMLElement[] }}
 */
function cutStrips(leaf) {
  // Slices must line up with the settled page to the subpixel, or the text jumps when the curl
  // hands back.
  const width = parseFloat(getComputedStyle(leaf).width);
  const edges = stripEdges(width);
  const [front, back] = /** @type {HTMLElement[]} */ ([...leaf.children]);
  const stack = document.createElement('div');
  stack.className = 'curl';
  const strips = [];
  let parent = stack;
  for (let index = 0; index < STRIPS; index++) {
    const [start, end] = [edges[index], edges[index + 1]];
    const piece = document.createElement('div');
    piece.className = 'curl-strip';
    // Strips overlap slightly to hide seams; the back face mirrors across the wider strip, so it
    // shifts too.
    Object.assign(piece.style, {
      left: `${index ? start - edges[index - 1] : 0}px`,
      width: `${end - start + STRIP_OVERLAP}px`
    });
    piece.append(
      slice(front, { offset: start, side: 'front', width }),
      slice(back, { offset: width - end - STRIP_OVERLAP, side: 'back', width })
    );
    parent.append(piece);
    parent = piece;
    strips.push(piece);
  }
  return { stack, strips };
}

/**
 * Poses each strip at its absolute angle; each is rotated relative to its parent strip.
 * @param {HTMLElement[]} strips
 * @param {number[]} angles Degrees, from the spine outward.
 */
function poseStrips(strips, angles) {
  let previous = 0;
  strips.forEach((piece, index) => {
    const angle = angles[index];
    piece.style.transform = `rotateY(${angle - previous}deg)`;
    piece.style.setProperty('--shade', stripShade(angle));
    piece.classList.toggle('flipped', angle < -90);
    previous = angle;
  });
}

/** Holds off other turns until the returned function is called. */
function holdTurns() {
  /** @type {() => void} */
  let release;
  const done = new Promise(resolve => {
    release = () => resolve(undefined);
  });
  curls.add(done);
  done.then(() => curls.delete(done));
  return release;
}

// A turning page bends instead of swinging stiff: it is cut into strips, each hinged to the last,
// and a curl runs across them. The free edge lifts first and leads, then trails and settles last.
/**
 * Cuts `leaf` into strips ready to curl; turns wait until it is settled.
 * @param {HTMLElement} leaf
 */
function liftLeaf(leaf) {
  const { stack, strips } = cutStrips(leaf);
  leaf.append(stack);
  leaf.classList.add('curling');
  leaf.style.zIndex = String(Z_CURLING);
  const release = holdTurns();
  return {
    /** @param {number[]} angles */
    pose: angles => poseStrips(strips, angles),
    settle() {
      stack.remove();
      leaf.classList.remove('curling');
      release();
    }
  };
}

/**
 * Runs a lifted leaf's curl from `from` to `to` (a whole turn takes CURL_MS), then settles it.
 * @param {ReturnType<typeof liftLeaf>} lifted
 * @param {(t: number) => number[]} anglesAt Strip angles at each point of the turn.
 * @param {{ from: number, to: number }} run
 */
function runCurl(lifted, anglesAt, { from, to }) {
  const start = performance.now();
  const duration = CURL_MS * Math.abs(to - from);
  return new Promise(resolve => {
    /** @param {number} now */
    const frame = now => {
      const k = duration > 0 ? Math.min(1, (now - start) / duration) : 1;
      lifted.pose(anglesAt(from + (to - from) * k));
      if (k < 1) {
        requestAnimationFrame(frame);
        return;
      }
      lifted.settle();
      resolve(undefined);
    };
    requestAnimationFrame(frame);
  });
}

/**
 * @param {HTMLElement} leaf
 * @param {boolean} turned
 */
const curl = (leaf, turned) =>
  runCurl(
    liftLeaf(leaf),
    t => Array.from({ length: STRIPS }, (_, index) => stripAngle(t, index, turned)),
    { from: 0, to: 1 }
  );

/**
 * Turns to spread `target`, curling each leaf that changes side.
 * @param {number} target
 * @param {boolean} [animate]
 */
function show(target, animate = true) {
  state.spread = clampSpread(target, state.lastSpread);
  const leaves = /** @type {HTMLElement[]} */ ([...ui.leaves.children]);
  leaves.forEach((leaf, index) => {
    const turned = index < state.spread + (state.coverOpen ? state.lead : 0);
    const rest = String(turned ? Z_LEAF_BASE + index : Z_LEAF_BASE - index);
    if (animate && !reducedMotion() && turned !== leaf.classList.contains('turned')) {
      leaf.classList.toggle('turned', turned);
      curl(leaf, turned).then(() => {
        leaf.style.zIndex = rest;
      });
    } else {
      leaf.style.zIndex = rest;
      leaf.classList.toggle('turned', turned);
    }
  });
  ui.folio.textContent = folioText(state.spread, state.pageCount, ui.single.matches);
  const [back, next] = ['-1', '1'].map(
    step => /** @type {HTMLButtonElement} */ ($(`[data-turn="${step}"]`, ui.nav))
  );
  back.disabled = state.spread === 0;
  next.disabled = state.spread === state.lastSpread;
  ui.nav.hidden = state.lastSpread === 0;
}

// The cover and, on a spread, the first leaf swing together. They pass edge-on exactly halfway,
// which is where the leaf takes over the top of the stack from the cover.
/** @param {boolean} open */
async function swingCover(open) {
  const leaf = state.lead ? /** @type {HTMLElement} */ (ui.leaves.firstElementChild) : null;
  const [from, to] = open ? ['0deg', '-180deg'] : ['-180deg', '0deg'];
  const frames = [
    { transform: `rotateY(${from})`, easing: 'cubic-bezier(.5,0,1,1)' },
    { transform: 'rotateY(-90deg)', easing: 'cubic-bezier(0,0,.4,1)' },
    { transform: `rotateY(${to})` }
  ];
  const duration = open ? COVER_OPEN_MS : COVER_CLOSE_MS;
  state.coverOpen = open;
  if (leaf) {
    leaf.style.transition = 'none';
    leaf.classList.add('swinging');
    leaf.classList.toggle('turned', open);
  }
  setTimeout(() => {
    ui.board.style.zIndex = open ? '0' : String(Z_BOARD_CLOSED);
    ui.board.classList.toggle('flipped', open);
  }, duration / 2);
  const leafFrames = frames.map(frame => ({
    ...frame,
    transform: `perspective(2400px) ${frame.transform}`
  }));
  await Promise.all([
    play(ui.board, frames, duration, 'linear'),
    leaf && play(leaf, leafFrames, duration, 'linear')
  ]);
  if (leaf) {
    leaf.style.transition = '';
    leaf.classList.remove('swinging');
  }
}

/** @param {number} direction */
function turn(direction) {
  if (!state.busy && !curls.size && ui.dialog.classList.contains('is-open')) {
    show(state.spread + direction);
  }
}

/**
 * Dresses the board in the shelf cover; the large scan fades in once it loads (hovering the book
 * starts the download).
 * @param {HTMLElement} cover
 * @param {HTMLElement} card
 */
function dressBoard(cover, card) {
  const { dialog } = ui;
  dialog.style.setProperty('--ar', cover.style.getPropertyValue('--ar') || FALLBACK_ASPECT);
  dialog.style.setProperty('--spine', cover.style.getPropertyValue('--spine') || FALLBACK_SPINE);
  const art = $('img:not([hidden])', cover) || $('.cover-fallback', cover);
  const face = /** @type {HTMLElement} */ (art.cloneNode(true));
  $('.board-front', dialog).replaceChildren(face);
  if (face.tagName === 'IMG' && card.dataset.coverLarge) {
    const large = new Image();
    large.className = 'board-large';
    large.alt = '';
    large.onload = () => {
      if (face.isConnected) face.after(large);
    };
    large.src = card.dataset.coverLarge;
  }
}

/**
 * @param {HTMLElement} card
 * @param {HTMLTemplateElement} template
 */
function fillReview(card, template) {
  document.getElementById('review-title').textContent = card.dataset.title;
  document.getElementById('review-author').textContent = card.dataset.author;
  document.getElementById('review-meta').textContent = DATE_FORMAT.format(
    new Date(`${card.dataset.date}T00:00:00Z`)
  );
  document.getElementById('review-body').replaceChildren(template.content.cloneNode(true));
  state.notes = template.content.firstElementChild;
}

/** Shows the book already open, for reduced motion or no Web Animations. */
function openInstantly() {
  ui.dialog.classList.add('is-open');
  ui.dialog.classList.remove('backdrop-hidden');
  ui.board.style.zIndex = '0';
  ui.board.classList.add('flipped');
  state.coverOpen = true;
  show(0, false);
}

/** Lifts the book off the shelf to centre stage, then swings the cover open. */
async function liftAndOpen() {
  const { book, dialog } = ui;
  const { shelfCover } = state;
  const stage = closedBook();
  const from = stage.over(shelfCover.getBoundingClientRect());
  shelfCover.style.visibility = 'hidden';
  requestAnimationFrame(() => dialog.classList.remove('backdrop-hidden'));
  book.style.transform = stage.centred;
  await play(
    book,
    [{ transform: from }, { transform: stage.centred }],
    LIFT_MS,
    'cubic-bezier(.2,.8,.2,1)'
  );
  dialog.classList.add('is-open');
  book.style.transform = '';
  await Promise.all([
    swingCover(true),
    play(book, [{ transform: stage.centred }, { transform: 'none' }], COVER_OPEN_MS)
  ]);
}

/**
 * @param {HTMLElement} link
 * @param {HTMLElement} card
 * @param {HTMLTemplateElement} template
 */
async function openBook(link, card, template) {
  state.busy = true;
  state.shelfCover = $('.cover', link);
  untilt(state.shelfCover);
  spineColor(state.shelfCover);
  dressBoard(state.shelfCover, card);
  fillReview(card, template);
  ui.dialog.classList.remove('is-open');
  ui.dialog.classList.add('backdrop-hidden');
  ui.board.style.zIndex = String(Z_BOARD_CLOSED);
  ui.board.classList.remove('flipped');
  state.coverOpen = false;
  ui.dialog.showModal();
  paginate();
  show(0, false);
  if (reducedMotion() || !ui.book.animate) {
    openInstantly();
  } else {
    await liftAndOpen();
  }
  state.busy = false;
}

/** Turns back to the start, closes the cover, and puts the book back on the shelf. */
async function closeBook() {
  const { book, dialog } = ui;
  if (state.busy || !dialog.open) return;
  if (reducedMotion() || !book.animate) {
    dialog.close();
    return;
  }
  state.busy = true;
  await Promise.all(curls);
  if (state.spread > 0) {
    show(0);
    await Promise.all(curls);
  }
  const stage = closedBook();
  dialog.classList.remove('is-open');
  book.style.transform = stage.centred;
  await Promise.all([
    swingCover(false),
    play(book, [{ transform: 'none' }, { transform: stage.centred }], COVER_CLOSE_MS)
  ]);
  dialog.classList.add('backdrop-hidden');
  const to = stage.over(state.shelfCover.getBoundingClientRect());
  book.style.transform = to;
  await play(
    book,
    [{ transform: stage.centred }, { transform: to }],
    SHELVE_MS,
    'cubic-bezier(.5,0,.3,1)'
  );
  dialog.close();
}

function resetBook() {
  const { book, board, dialog } = ui;
  [...book.getAnimations(), ...board.getAnimations()].forEach(animation => animation.cancel());
  book.style.transform = '';
  board.style.zIndex = '';
  board.classList.remove('flipped');
  state.coverOpen = false;
  dialog.classList.remove('is-open', 'backdrop-hidden');
  if (state.shelfCover) state.shelfCover.style.visibility = '';
  state.busy = false;
}

/** @param {MouseEvent} event */
const modified = event =>
  event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0;

/**
 * Opens a card's notes in the book instead of following its link.
 * @param {MouseEvent} event
 */
function openFromShelf(event) {
  const link = /** @type {HTMLElement} */ (event.target).closest('[data-review]');
  if (!(link instanceof HTMLElement) || modified(event)) return;
  const card = link.closest('.library-card');
  const template = card && $('[data-review-content]', card);
  if (!(template instanceof HTMLTemplateElement)) return;
  event.preventDefault();
  if (!state.busy && !ui.dialog.open) openBook(link, /** @type {HTMLElement} */ (card), template);
}

/** @param {PointerEvent} event */
function preloadLargeCover(event) {
  const card = /** @type {HTMLElement} */ (event.target).closest('.library-card[data-cover-large]');
  if (card instanceof HTMLElement && !card.dataset.preloaded) {
    card.dataset.preloaded = 'true';
    new Image().src = card.dataset.coverLarge;
  }
}

/**
 * The leaf that turns toward `forward`, when the book is at rest and has a page that way.
 * @param {boolean} forward
 */
function leafToTurn(forward) {
  if (state.busy || curls.size || !ui.dialog.classList.contains('is-open') || reducedMotion()) {
    return null;
  }
  const target = state.spread + (forward ? 1 : -1);
  if (target !== clampSpread(target, state.lastSpread)) return null;
  const leaf = /** @type {HTMLElement | undefined} */ (
    ui.leaves.children[state.spread + state.lead - (forward ? 0 : 1)]
  );
  return leaf ? { leaf, target } : null;
}

/**
 * Whether a page let go of turns over: a flick sends it its way, and otherwise it goes once it
 * is past halfway.
 * @param {number} speed Toward turning over, in pixels per millisecond.
 * @param {boolean} past
 */
const goesOver = (speed, past) => speed > FLICK_SPEED || (speed > -FLICK_SPEED && past);

/**
 * @typedef {object} Held A page picked up by the pointer.
 * @property {(at: { x: number, dx: number, dy: number }) => void} move
 * @property {(speed: number) => void} letGo `speed` is the pointer's, rightward, in px/ms.
 */

/**
 * On a spread, picks up a page to bend about the spine, its free edge under the pointer.
 * @param {boolean} forward
 * @returns {Held | null}
 */
function grabLeaf(forward) {
  const found = leafToTurn(forward);
  if (!found) return null;
  const { leaf, target } = found;
  const width = leaf.offsetWidth;
  const spine = ui.book.getBoundingClientRect().left + ui.book.offsetWidth / 2;
  const lifted = liftLeaf(leaf);
  let [hold, edge] = [0, forward ? 1 : -1];
  return {
    move({ x }) {
      edge = (x - spine) / width;
      hold = holdFor(edge, forward);
      lifted.pose(heldAngles(hold, forward));
    },
    letGo(speed) {
      const over = goesOver(forward ? -speed : speed, forward ? edge < 0 : edge > 0);
      const anglesAt = (/** @type {number} */ t) => heldAngles(t, forward);
      runCurl(lifted, anglesAt, { from: hold, to: over ? 1 : 0 }).then(() =>
        show(over ? target : state.spread, false)
      );
    }
  };
}

/**
 * The folded-over corner of a peeling page: the page's own face, seen from behind, and the
 * shadow it casts on the page beneath.
 * @param {HTMLElement} leaf
 * @param {HTMLElement} front
 */
function buildFlap(leaf, front) {
  const face = /** @type {HTMLElement} */ (front.cloneNode(true));
  face.className = 'leaf-face';
  const sheen = document.createElement('div');
  sheen.className = 'peel-sheen';
  const flap = document.createElement('div');
  flap.className = 'peel-flap';
  flap.append(face, sheen);
  const lifted = document.createElement('div');
  lifted.className = 'peel';
  lifted.append(flap);
  const under = document.createElement('div');
  under.className = 'peel-under';
  leaf.append(under, lifted);
  return { flap, sheen, lifted, under };
}

/**
 * On a phone, picks up a page by the corner nearest the pointer and folds it over toward the
 * pointer, along whatever slant the pointer pulls it. Taking it by the middle of its edge pulls
 * the corner straight across.
 * @param {boolean} forward
 * @param {{ y: number }} press
 * @returns {Held | null}
 */
function grabCorner(forward, press) {
  const found = leafToTurn(forward);
  if (!found) return null;
  const { leaf, target } = found;
  const [width, height] = [leaf.offsetWidth, leaf.offsetHeight];
  const top = ui.book.getBoundingClientRect().top;
  const corner = { x: width, y: press.y - top < height / 2 ? 0 : height };
  // Turned over, the corner lies flat beyond the spine; a page coming back starts from there.
  const away = { x: -width, y: corner.y };
  const front = /** @type {HTMLElement} */ ($('.leaf-front', leaf));
  const parts = buildFlap(leaf, front);
  leaf.classList.remove('turned');
  leaf.classList.add('peeling');
  leaf.style.zIndex = String(Z_CURLING);
  const release = holdTurns();
  let lift = forward ? corner : away;
  /** @param {{ x: number, y: number }} point */
  const liftTo = point => {
    lift = reachable(point, corner, height);
    const shape = peel(width, height, corner, lift);
    front.style.clipPath = shape ? polygon(shape.flat) : '';
    parts.lifted.hidden = parts.under.hidden = !shape;
    if (!shape) return;
    const { angle, fold } = shape;
    parts.flap.style.clipPath = parts.under.style.clipPath = polygon(shape.lifted);
    parts.flap.style.transform = shape.reflect;
    parts.under.style.background = `linear-gradient(${angle}deg, #0000004d ${fold}px, #0000 ${fold + 36}px)`;
    parts.sheen.style.background = `linear-gradient(${angle}deg, #00000024 ${fold}px, #ffffff33 ${fold + 18}px, #0000 ${fold + 80}px), #f6f1e6db`;
  };
  liftTo(lift);
  return {
    // A page coming back is drawn in from beyond the spine, twice as fast as the pointer moves.
    move: ({ dx, dy }) =>
      liftTo(
        forward ? { x: corner.x + dx, y: corner.y + dy } : { x: away.x + 2 * dx, y: away.y + dy }
      ),
    letGo(speed) {
      const over = goesOver(forward ? -speed : speed, forward ? lift.x < width / 2 : lift.x > 0);
      const to = over === forward ? away : corner;
      const from = lift;
      const duration =
        CURL_MS * Math.min(1, Math.hypot(to.x - from.x, to.y - from.y) / (2 * width));
      const start = performance.now();
      /** @param {number} now */
      const frame = now => {
        const k = duration > 0 ? Math.min(1, (now - start) / duration) : 1;
        const eased = 1 - (1 - k) ** 3;
        liftTo({ x: from.x + (to.x - from.x) * eased, y: from.y + (to.y - from.y) * eased });
        if (k < 1) {
          requestAnimationFrame(frame);
          return;
        }
        parts.lifted.remove();
        parts.under.remove();
        front.style.clipPath = '';
        leaf.classList.remove('peeling');
        release();
        show(over ? target : state.spread, false);
      };
      requestAnimationFrame(frame);
    }
  };
}

/**
 * A swipe turns the page (when it could not be picked up); a tap on the left of the book goes
 * back and anywhere else goes on.
 * @param {PointerEvent} event
 * @param {{ x: number, y: number }} start
 */
function tapOrSwipe(event, start) {
  const dx = event.clientX - start.x;
  const dy = event.clientY - start.y;
  if (Math.abs(dx) > SWIPE_PX && Math.abs(dx) > Math.abs(dy)) {
    turn(dx < 0 ? 1 : -1);
    return;
  }
  if (Math.hypot(dx, dy) > TAP_PX) return;
  const { book } = ui;
  const back = ui.single.matches
    ? event.clientX < innerWidth * BACK_ZONE
    : event.clientX < book.getBoundingClientRect().left + book.offsetWidth / 2;
  turn(back ? -1 : 1);
}

// A page dragged sideways is picked up and follows the pointer: on a phone it peels from the
// corner, on a spread it bends about the spine.
function installGestures() {
  const { book } = ui;
  /** @type {{ x: number, y: number, lastX: number, at: number, speed: number, tried: boolean } | null} */
  let press = null;
  /** @type {Held | null} */
  let drag = null;
  book.addEventListener('pointerdown', event => {
    if (drag) return;
    const { clientX: x, clientY: y, timeStamp: at } = event;
    press = { x, y, lastX: x, at, speed: 0, tried: false };
  });
  book.addEventListener('pointermove', event => {
    if (!press) return;
    const dx = event.clientX - press.x;
    const dy = event.clientY - press.y;
    if (!drag && !press.tried && Math.abs(dx) > TAP_PX && Math.abs(dx) > Math.abs(dy)) {
      press.tried = true;
      drag = ui.single.matches ? grabCorner(dx < 0, press) : grabLeaf(dx < 0);
      if (drag) book.setPointerCapture(event.pointerId);
    }
    if (!drag) return;
    const elapsed = event.timeStamp - press.at;
    if (elapsed > 0) press.speed = (event.clientX - press.lastX) / elapsed;
    press.at = event.timeStamp;
    press.lastX = event.clientX;
    drag.move({ x: event.clientX, dx, dy });
  });
  /** @param {PointerEvent} event */
  const letGo = event => {
    const [start, held] = [press, drag];
    press = drag = null;
    if (held) {
      // Resting before letting go cancels a flick.
      held.letGo(event.timeStamp - start.at > FLICK_WINDOW_MS ? 0 : start.speed);
    } else if (
      start &&
      event.type === 'pointerup' &&
      !(/** @type {Element} */ (event.target).closest('a'))
    ) {
      tapOrSwipe(event, start);
    }
  };
  book.addEventListener('pointerup', letGo);
  book.addEventListener('pointercancel', letGo);
}

/** Re-lays the pages at the new size, keeping the reader's place. */
function installRepagination() {
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let resizeTimer;
  addEventListener('resize', () => {
    if (!ui.dialog.open || state.busy) return;
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      const position = state.lastSpread ? state.spread / state.lastSpread : 0;
      paginate();
      show(Math.round(position * state.lastSpread), false);
    }, RESIZE_DEBOUNCE_MS);
  });
}

const TURN_KEYS = { ArrowRight: 1, PageDown: 1, ArrowLeft: -1, PageUp: -1 };

/** @param {HTMLElement} root */
function installListeners(root) {
  const { dialog, nav } = ui;
  dialog.addEventListener('close', resetBook);
  root.addEventListener('pointerover', preloadLargeCover);
  root.addEventListener('click', openFromShelf);
  $('.dialog-close', dialog).addEventListener('click', closeBook);
  dialog.addEventListener('cancel', event => {
    event.preventDefault();
    closeBook();
  });
  dialog.addEventListener('click', event => {
    if (event.target === dialog) closeBook();
  });
  nav.addEventListener('click', event => {
    const button = /** @type {Element} */ (event.target).closest('[data-turn]');
    if (button instanceof HTMLElement) turn(Number(button.dataset.turn));
  });
  dialog.addEventListener('keydown', event => {
    const direction = TURN_KEYS[event.key];
    if (!direction) return;
    event.preventDefault();
    turn(direction);
  });
  installGestures();
  installRepagination();
}

/**
 * Opens notes from the shelf in the #review-dialog book, where the dialog is supported.
 * @param {HTMLElement} root The library element.
 */
export function installBookDialog(root) {
  // Checked by method, not class: browsers without <dialog> have no HTMLDialogElement.
  const dialog = /** @type {HTMLDialogElement | null} */ (document.getElementById('review-dialog'));
  if (!dialog || typeof dialog.showModal !== 'function') return;
  const parts = ['.open-book', '.book-board', '.leaves', '.page-probe', '.book-nav', '.book-folio'];
  const [book, board, leaves, probe, nav, folio] = parts.map(selector => $(selector, dialog));
  if (![book, board, leaves, probe, nav, folio].every(Boolean)) return;
  const single = matchMedia('(max-width: 700px)');
  ui = { dialog, book, board, leaves, probe, nav, folio, single };
  installListeners(root);
}
