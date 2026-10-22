/**
 * Returns the first element matching `selector`, typed by the caller.
 * @template {Element} [T=HTMLElement]
 * @param {string} selector
 * @param {ParentNode} [root]
 * @returns {T | null}
 */
export const $ = (selector, root = document) => root.querySelector(selector);

/**
 * Returns all elements matching `selector` as an array.
 * @template {Element} [T=HTMLElement]
 * @param {string} selector
 * @param {ParentNode} [root]
 * @returns {T[]}
 */
export const $$ = (selector, root = document) =>
  /** @type {T[]} */ ([...root.querySelectorAll(selector)]);
