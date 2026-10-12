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
      return sort.value === 'oldest' ? a.dataset.date.localeCompare(b.dataset.date)
        : b.dataset.date.localeCompare(a.dataset.date);
    });
    const sections = new Map();
    for (const card of visible) {
      const key = card.dataset.section === 'earlier' ? 'earlier'
        : sort.value === 'title' ? 'all' : card.dataset.date.slice(0, 4);
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
    const dated = visible.filter(card => card.dataset.section === 'dated').length;
    const resultCount = root.querySelector('[data-count]');
    if (resultCount) resultCount.textContent = `${new Set(visible.map(card => card.dataset.filmId)).size} movies · ${dated} diary entries`;
  }
  search.addEventListener('input', update);
  filter.addEventListener('change', update);
  sort.addEventListener('change', update);
  update();

  // Preserve the normal note URL for no-JS browsing, sharing, and opening a new tab.
  const dialog = document.getElementById('review-dialog');
  if (dialog && typeof dialog.showModal === 'function') {
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
      dialog.showModal();
      dialog.scrollTop = 0;
    });
    dialog.querySelector('.dialog-close').addEventListener('click', () => dialog.close());
    dialog.addEventListener('click', event => {
      const bounds = dialog.getBoundingClientRect();
      if (event.target === dialog && (event.clientX < bounds.left || event.clientX > bounds.right ||
        event.clientY < bounds.top || event.clientY > bounds.bottom)) dialog.close();
    });
  }
  // A failed artwork request still leaves a readable, locally styled title cover.
  root.querySelectorAll('.cover img').forEach(img => {
    const failed = () => { img.hidden = true; };
    img.addEventListener('error', failed);
    if (img.complete && !img.naturalWidth) failed();
  });
})();
