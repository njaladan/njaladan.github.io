const HTML_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

/**
 * Escapes text for use inside HTML element content or a quoted attribute.
 * @param {unknown} value
 * @returns {string}
 */
export const escapeHtml = value => String(value).replace(/[&<>"']/g, c => HTML_ESCAPES[c]);
