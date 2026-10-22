(() => {
  'use strict';
  const root = document.querySelector('[data-library]');
  if (!root) return;
  const kind = root.dataset.library;
  const cards = Array.from(root.querySelectorAll('.library-card'));
  const groups = root.querySelector('[data-groups]');
  const nav = root.querySelector('[data-year-nav]');
  const search = root.querySelector('[data-search]');
  const filter = root.querySelector('[data-filter]');
  const sort = root.querySelector('[data-sort]');
  const fold = text => text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  root.querySelector('.js-controls').hidden = false;

  function update() {
    const query = fold(search.value.trim());
    const visible = cards.filter(card => {
      const data = card.dataset;
      const matches = fold(data.title || '').includes(query);
      const category = filter.value === 'all' ||
        (filter.value === 'notes' ? data.notes === 'true' : data.section === filter.value);
      return matches && category;
    });
    visible.sort((a, b) => {
      // Undated films always stay after the dated diary, even when reversing dates.
      if (a.dataset.section !== b.dataset.section) return a.dataset.section === 'earlier' ? 1 : -1;
      if (a.dataset.section === 'earlier' || sort.value === 'title')
        return a.dataset.title.localeCompare(b.dataset.title);
      const yearA = a.dataset.year || a.dataset.date.slice(0, 4);
      const yearB = b.dataset.year || b.dataset.date.slice(0, 4);
      const yearOrder = sort.value === 'oldest'
        ? yearA.localeCompare(yearB)
        : yearB.localeCompare(yearA);
      if (yearOrder) return yearOrder;
      if (!a.dataset.date || !b.dataset.date) {
        if (!a.dataset.date && !b.dataset.date) return a.dataset.title.localeCompare(b.dataset.title);
        return a.dataset.date ? -1 : 1;
      }
      return sort.value === 'oldest' ? a.dataset.date.localeCompare(b.dataset.date)
        : b.dataset.date.localeCompare(a.dataset.date);
    });
    const sections = new Map();
    for (const card of visible) {
      const key = card.dataset.section === 'earlier' ? 'earlier'
        : sort.value === 'title' ? 'all' : card.dataset.year || card.dataset.date.slice(0, 4);
      if (!sections.has(key)) sections.set(key, []);
      sections.get(key).push(card);
    }
    const content = document.createDocumentFragment();
    const links = document.createDocumentFragment();
    for (const [key, items] of sections) {
      const section = document.createElement('section');
      section.className = 'library-group';
      section.id = key === 'earlier' ? 'earlier' : key === 'all' ? 'all-items' : `y${key}`;
      const heading = document.createElement('div');
      heading.className = 'group-heading';
      const title = document.createElement('h2');
      title.textContent = key === 'earlier' ? 'Undated'
        : key === 'all' ? kind === 'books' ? 'The collection' : 'The diary' : key;
      const count = document.createElement('span');
      count.textContent = `${items.length} ${kind === 'books' ? 'books' : key === 'earlier' ? 'movies' : 'viewings'}`;
      heading.append(title);
      if (kind === 'movies') heading.append(count);
      section.append(heading);
      const shelf = document.createElement('div');
      shelf.className = 'shelf';
      items.forEach(card => shelf.append(card));
      section.append(shelf);
      content.append(section);
      const link = document.createElement('a');
      link.href = `#${section.id}`;
      link.textContent = key === 'earlier' ? 'Undated' : key === 'all' ? 'The collection' : key;
      links.append(link);
    }
    groups.replaceChildren(content);
    nav.replaceChildren(links);
    nav.hidden = !visible.length;
    root.querySelector('[data-empty]').hidden = Boolean(visible.length);
    const resultCount = root.querySelector('[data-count]');
    if (resultCount) resultCount.textContent = `${new Set(visible.map(card => card.dataset.filmId)).size} movies`;
  }
  search.addEventListener('input', update);
  filter.addEventListener('change', update);
  sort.addEventListener('change', update);
  update();

  const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
  // A book's spine takes the colour of its cover's left edge.
  const spineColor = cover => {
    const img = cover.querySelector('img');
    if (cover.style.getPropertyValue('--spine') || !img || img.hidden || !img.naturalWidth) return;
    try {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 1;
      const context = canvas.getContext('2d', { willReadFrequently: true });
      context.drawImage(img, 0, 0, Math.max(1, img.naturalWidth * 0.04), img.naturalHeight, 0, 0, 1, 1);
      const [r, g, b] = context.getImageData(0, 0, 1, 1).data;
      cover.style.setProperty('--spine', `rgb(${r} ${g} ${b})`);
    } catch {}
  };
  const untilt = cover => {
    cover.classList.remove('tilting');
    ['--rx', '--ry', '--px', '--py'].forEach(name => cover.style.removeProperty(name));
  };

  // Preserve the normal note URL for no-JS browsing, sharing, and opening a new tab.
  // Otherwise the book comes off the shelf, its front board swings open, and the notes sit on the first page.
  const dialog = document.getElementById('review-dialog');
  if (dialog && typeof dialog.showModal === 'function') {
    const book = dialog.querySelector('.open-book');
    const board = dialog.querySelector('.book-board');
    const page = dialog.querySelector('.page-scroll');
    const easing = 'cubic-bezier(.55,0,.2,1)';
    let shelfCover = null;
    let busy = false;
    // The closed book is the front board; transforms on the open book move it over a shelf slot or to centre stage.
    const closedBook = () => {
      const left = book.offsetLeft + board.offsetLeft, top = book.offsetTop + board.offsetTop;
      book.style.transformOrigin = `${board.offsetLeft}px ${board.offsetTop}px`;
      return {
        centred: `translateX(${innerWidth / 2 - left - board.offsetWidth / 2}px)`,
        over: rect => `translate(${rect.left - left}px, ${rect.top - top}px) scale(${rect.width / board.offsetWidth}, ${rect.height / board.offsetHeight})`
      };
    };
    const play = (element, frames, duration, ease = easing) => element.animate(frames, { duration, easing: ease }).finished;

    const openBook = async (link, card, template) => {
      busy = true;
      shelfCover = link.querySelector('.cover');
      untilt(shelfCover);
      spineColor(shelfCover);
      dialog.style.setProperty('--ar', shelfCover.style.getPropertyValue('--ar') || '.6667');
      dialog.style.setProperty('--spine', shelfCover.style.getPropertyValue('--spine') || '#6b5a48');
      const art = shelfCover.querySelector('img:not([hidden])') || shelfCover.querySelector('.cover-fallback');
      dialog.querySelector('.board-front').replaceChildren(art.cloneNode(true));
      const pages = shelfCover.style.getPropertyValue('--pages').trim();
      document.getElementById('review-title').textContent = card.dataset.title;
      document.getElementById('review-author').textContent = card.dataset.author;
      document.getElementById('review-meta').textContent = [new Intl.DateTimeFormat('en-US', {
        year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC'
      }).format(new Date(`${card.dataset.date}T00:00:00Z`)), pages && `${pages} pages`].filter(Boolean).join(' · ');
      document.getElementById('review-body').replaceChildren(template.content.cloneNode(true));
      dialog.classList.remove('is-open');
      dialog.classList.add('backdrop-hidden');
      dialog.showModal();
      page.scrollTop = 0;
      if (reducedMotion() || !book.animate) {
        dialog.classList.add('is-open');
        dialog.classList.remove('backdrop-hidden');
        busy = false;
        return;
      }
      const stage = closedBook();
      const from = stage.over(shelfCover.getBoundingClientRect());
      shelfCover.style.visibility = 'hidden';
      requestAnimationFrame(() => dialog.classList.remove('backdrop-hidden'));
      book.style.transform = stage.centred;
      await play(book, [{ transform: from }, { transform: stage.centred }], 560, 'cubic-bezier(.2,.8,.2,1)');
      dialog.classList.add('is-open');
      book.style.transform = '';
      await Promise.all([
        play(board, [{ transform: 'rotateY(0deg)' }, { transform: 'rotateY(-180deg)' }], 900),
        play(book, [{ transform: stage.centred }, { transform: 'none' }], 900)
      ]);
      busy = false;
      page.focus({ preventScroll: true });
    };

    const closeBook = async () => {
      if (busy || !dialog.open) return;
      if (reducedMotion() || !book.animate) {
        dialog.close();
        return;
      }
      busy = true;
      const stage = closedBook();
      dialog.classList.remove('is-open');
      book.style.transform = stage.centred;
      await Promise.all([
        play(board, [{ transform: 'rotateY(-180deg)' }, { transform: 'rotateY(0deg)' }], 750),
        play(book, [{ transform: 'none' }, { transform: stage.centred }], 750)
      ]);
      dialog.classList.add('backdrop-hidden');
      const to = stage.over(shelfCover.getBoundingClientRect());
      book.style.transform = to;
      await play(book, [{ transform: stage.centred }, { transform: to }], 520, 'cubic-bezier(.5,0,.3,1)');
      dialog.close();
    };

    dialog.addEventListener('close', () => {
      [...book.getAnimations(), ...board.getAnimations()].forEach(animation => animation.cancel());
      book.style.transform = '';
      dialog.classList.remove('is-open', 'backdrop-hidden');
      if (shelfCover) shelfCover.style.visibility = '';
      busy = false;
    });
    root.addEventListener('click', event => {
      const link = event.target.closest('[data-review]');
      if (!link || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
      const card = link.closest('.library-card');
      const template = card.querySelector('[data-review-content]');
      if (!template) return;
      event.preventDefault();
      if (!busy && !dialog.open) openBook(link, card, template);
    });
    dialog.querySelector('.dialog-close').addEventListener('click', closeBook);
    dialog.addEventListener('cancel', event => {
      event.preventDefault();
      closeBook();
    });
    dialog.addEventListener('click', event => {
      if (event.target === dialog) closeBook();
    });
  }

  // Covers turn to face the pointer while the light stays put: the glare, shadow and edge shading move against the turn.
  if (!reducedMotion()) {
    root.addEventListener('pointermove', event => {
      if (event.pointerType !== 'mouse') return;
      const cover = event.target.closest('.card-link')?.querySelector('.cover');
      if (!cover) return;
      if (!cover.classList.contains('tilting')) {
        if (cover.classList.contains('book-cover')) spineColor(cover);
        requestAnimationFrame(() => cover.classList.add('tilting'));
      }
      const bounds = cover.getBoundingClientRect();
      const x = Math.min(Math.max((event.clientX - bounds.left) / bounds.width, 0), 1) - 0.5;
      const y = Math.min(Math.max((event.clientY - bounds.top) / bounds.height, 0), 1) - 0.5;
      cover.style.setProperty('--ry', `${(x * 36).toFixed(1)}deg`);
      cover.style.setProperty('--rx', `${(-y * 24).toFixed(1)}deg`);
      cover.style.setProperty('--px', x.toFixed(3));
      cover.style.setProperty('--py', y.toFixed(3));
    });
    root.addEventListener('pointerout', event => {
      const link = event.target.closest('.card-link');
      if (!link || link.contains(event.relatedTarget)) return;
      untilt(link.querySelector('.cover'));
    });
  }
  // A failed artwork request still leaves a readable, locally styled title cover.
  root.querySelectorAll('.cover img').forEach(img => {
    const failed = () => { img.hidden = true; };
    img.addEventListener('error', failed);
    if (img.complete && !img.naturalWidth) failed();
  });
})();
