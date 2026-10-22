import { expect, test } from '@playwright/test';

// Each page should run its scripts without errors and reach its ready state.
const pages = [
  { path: '/', ready: page => page.locator('.portrait').click() },
  { path: '/reading', ready: page => expect(page.locator('.js-controls')).toBeVisible() },
  { path: '/movies', ready: page => expect(page.locator('.js-controls')).toBeVisible() },
  {
    path: '/photos/',
    ready: page => expect(page.locator('.photo-card, .gallery-empty').first()).toBeVisible()
  },
  { path: '/athletics/', ready: page => expect(page.locator('.shape-cell').first()).toBeVisible() },
  {
    path: '/travel/',
    ready: page =>
      expect(page.locator('#map')).toHaveAttribute('data-ready', 'true', { timeout: 30_000 })
  }
];

for (const { path, ready } of pages) {
  test(`${path} loads without script errors`, async ({ page }) => {
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => {
      // Remote map tiles may be unreachable from CI; only local failures count.
      if (message.type() === 'error' && !/Failed to load resource/.test(message.text())) {
        errors.push(message.text());
      }
    });
    page.on('requestfailed', request => {
      if (new URL(request.url()).hostname === 'localhost') errors.push(`Failed: ${request.url()}`);
    });
    page.on('response', response => {
      const url = new URL(response.url());
      if (url.hostname === 'localhost' && response.status() >= 400) {
        errors.push(`${response.status()}: ${url.pathname}`);
      }
    });
    await page.goto(path);
    await ready(page);
    expect(errors).toEqual([]);
  });
}
