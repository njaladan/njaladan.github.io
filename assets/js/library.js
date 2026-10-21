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

  // Preserve the normal note URL for no-JS browsing, sharing, and opening a new tab.
  const dialog = document.getElementById('review-dialog');
  if (dialog && typeof dialog.showModal === 'function') {
    let openCover = null;
    // The clicked cover grows into the notes dialog, and shrinks back on close.
    const morph = (from, to, update) => {
      if (!document.startViewTransition || !from || !to || matchMedia('(prefers-reduced-motion: reduce)').matches) {
        update();
        return;
      }
      const html = document.documentElement;
      html.classList.add('review-morph');
      from.style.viewTransitionName = 'review-cover';
      const transition = document.startViewTransition(() => {
        from.style.viewTransitionName = '';
        to.style.viewTransitionName = 'review-cover';
        update();
      });
      transition.finished.finally(() => {
        to.style.viewTransitionName = '';
        html.classList.remove('review-morph');
      });
    };
    root.addEventListener('click', event => {
      const link = event.target.closest('[data-review]');
      if (!link || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
      const card = link.closest('.library-card');
      const template = card.querySelector('[data-review-content]');
      if (!template) return;
      event.preventDefault();
      document.getElementById('review-title').textContent = card.dataset.title;
      document.getElementById('review-meta').textContent = new Intl.DateTimeFormat('en-US', {
        year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC'
      }).format(new Date(`${card.dataset.date}T00:00:00Z`));
      document.getElementById('review-body').replaceChildren(template.content.cloneNode(true));
      openCover = link.querySelector('.cover');
      morph(openCover, dialog, () => {
        dialog.showModal();
        dialog.scrollTop = 0;
      });
    });
    const closeReview = () => morph(dialog, openCover, () => dialog.close());
    dialog.querySelector('.dialog-close').addEventListener('click', closeReview);
    dialog.addEventListener('cancel', event => {
      event.preventDefault();
      closeReview();
    });
    dialog.addEventListener('click', event => {
      const bounds = dialog.getBoundingClientRect();
      if (event.target === dialog && (event.clientX < bounds.left || event.clientX > bounds.right ||
        event.clientY < bounds.top || event.clientY > bounds.bottom)) closeReview();
    });
  }
  // Covers turn to face the pointer; a book's spine takes the colour of its cover's left edge.
  if (!matchMedia('(prefers-reduced-motion: reduce)').matches) {
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
    });
    root.addEventListener('pointerout', event => {
      const link = event.target.closest('.card-link');
      if (!link || link.contains(event.relatedTarget)) return;
      const cover = link.querySelector('.cover');
      cover.classList.remove('tilting');
      cover.style.removeProperty('--rx');
      cover.style.removeProperty('--ry');
    });
  }
  // A failed artwork request still leaves a readable, locally styled title cover.
  root.querySelectorAll('.cover img').forEach(img => {
    const failed = () => { img.hidden = true; };
    img.addEventListener('error', failed);
    if (img.complete && !img.naturalWidth) failed();
  });
})();
