// Telugu checklist: walk 500 films in likely-seen order, answering yes, no or not sure.
import { $ } from './lib/dom.js';
import { stampedUrl } from './lib/assets.js';
import { readSetting, writeSetting } from './lib/storage.js';
import { answer, nextFilm, parseAnswers, tally, undo } from './telugu/answers.js';

const STORAGE_KEY = 'telugu-answers';
const KEYS = { y: 'yes', n: 'no', s: 'unsure' };

/** @typedef {{ id: string, title: string, year: number, people: string }} Film */
/** @typedef {import('./telugu/answers.js').Answers} Answers */
/** @typedef {import('./telugu/answers.js').Answer} Answer */

/** @param {Film} film */
const label = film => `${film.title} (${film.year})`;

/** @param {Film} film */
const lookupUrl = film =>
  `https://www.google.com/search?q=${encodeURIComponent(`${film.title} ${film.year} Telugu film`)}`;

/**
 * @param {string} id
 * @param {string | number} text
 */
const setText = (id, text) => {
  $(`#${id}`).textContent = String(text);
};

/**
 * Copies `text` and reports the outcome through `status`.
 * @param {string} text
 * @param {string} done
 * @param {(message: string) => void} status
 */
const copy = (text, done, status) =>
  navigator.clipboard.writeText(text).then(
    () => status(done),
    () => status('Copy failed')
  );

/**
 * Y / N / S answer the current film; U or Backspace undoes the last answer.
 * @param {(value: Answer) => void} respond
 * @param {() => void} stepBack
 */
function bindKeys(respond, stepBack) {
  document.addEventListener('keydown', event => {
    if (event.metaKey || event.ctrlKey || event.altKey || event.repeat) return;
    const key = event.key.toLowerCase();
    if (key in KEYS) respond(KEYS[key]);
    else if (key === 'u' || key === 'backspace') stepBack();
    else return;
    event.preventDefault();
  });
}

/**
 * @param {HTMLElement} root
 * @param {Film[]} films
 */
function start(root, films) {
  const ids = new Set(films.map(film => film.id));
  const rank = new Map(films.map((film, index) => [film.id, index + 1]));
  let answers = parseAnswers(readSetting(STORAGE_KEY), ids);
  let statusTimer = 0;

  /** @param {string} message */
  const status = message => {
    setText('telugu-status', message);
    clearTimeout(statusTimer);
    statusTimer = window.setTimeout(() => setText('telugu-status', ''), 2500);
  };

  /** @param {Answers} next */
  const save = next => {
    answers = next;
    writeSetting(STORAGE_KEY, JSON.stringify(answers));
    render();
  };

  const seenFilms = () => films.filter(film => answers[film.id] === 'yes');

  function renderCard() {
    const film = nextFilm(films, answers);
    $('#telugu-card').hidden = !film;
    $('#telugu-done').hidden = Boolean(film);
    if (!film) {
      setText('telugu-done', `All done. You've seen ${tally(answers).yes} of ${films.length}.`);
      return;
    }
    setText('telugu-rank', `#${rank.get(film.id)} · ${film.year}`);
    setText('telugu-title', film.title);
    setText('telugu-people', film.people);
    /** @type {HTMLAnchorElement} */ ($('#telugu-lookup')).href = lookupUrl(film);
  }

  function render() {
    const counts = tally(answers);
    setText('telugu-seen', counts.yes);
    setText('telugu-answered', counts.answered);
    setText('telugu-total', films.length);
    $('#telugu-bar').style.width = `${(100 * counts.answered) / films.length}%`;
    /** @type {HTMLButtonElement} */ ($('#telugu-undo')).disabled = counts.answered === 0;
    $('#telugu-seen-list').replaceChildren(
      ...seenFilms().map(film => {
        const item = document.createElement('li');
        item.textContent = label(film);
        return item;
      })
    );
    renderCard();
  }

  /** @param {Answer} value */
  const respond = value => {
    const film = nextFilm(films, answers);
    if (film) save(answer(answers, film.id, value));
  };

  const stepBack = () => {
    const result = undo(answers);
    if (result.id) save(result.answers);
  };

  /** @type {Record<string, () => void>} */
  const tools = {
    'telugu-undo': stepBack,
    'telugu-copy': () =>
      copy(seenFilms().map(label).join('\n'), `Copied ${seenFilms().length} films`, status),
    'telugu-export': () => copy(JSON.stringify(answers), 'Progress copied', status),
    'telugu-import': () => {
      const pasted = prompt('Paste progress copied from another browser:');
      if (pasted == null) return;
      const imported = parseAnswers(pasted, ids);
      save({ ...answers, ...imported });
      status(`Loaded ${Object.keys(imported).length} answers`);
    }
  };

  root.addEventListener('click', event => {
    const button = /** @type {HTMLElement} */ (event.target).closest('button');
    if (button?.dataset.answer) respond(/** @type {Answer} */ (button.dataset.answer));
    else tools[button?.id]?.();
  });

  bindKeys(respond, stepBack);
  render();
}

const root = $('#telugu');
if (root) {
  fetch(stampedUrl(root.dataset.filmsUrl, location.href))
    .then(response => (response.ok ? response.json() : Promise.reject(response.status)))
    .then(data => start(root, data.films))
    .catch(error => {
      console.error('Could not load the film list', error);
      setText('telugu-done', 'Could not load the film list.');
      $('#telugu-done').hidden = false;
    });
}
