import assert from 'node:assert/strict';
import { test } from 'node:test';
import { escapeHtml } from '../../assets/js/lib/html.js';

test('escapeHtml escapes markup and both quote styles', () => {
  assert.equal(
    escapeHtml(`<a href="x" title='y'>&</a>`),
    '&lt;a href=&quot;x&quot; title=&#39;y&#39;&gt;&amp;&lt;/a&gt;'
  );
});

test('escapeHtml stringifies non-string values', () => {
  assert.equal(escapeHtml(42), '42');
  assert.equal(escapeHtml(null), 'null');
});
