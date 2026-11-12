/** @area public-wiki
 * @priority P1
 * Exercises per-page admin selection and the isolated anonymous Wiki/graph shell.
 */
import { test, expect } from './fixtures/admin-server';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

test('administrator publishes selected Wiki pages and anonymous visitor navigates the snapshot', async ({ page, browser, admin }) => {
  const wiki = join(admin.vaultDir, 'wiki');
  mkdirSync(wiki, { recursive: true });
  writeFileSync(join(wiki, 'public-a.md'), '# Public A\n\nLinks to [[Public B]] and [[Private C]].\n\n<script>window.__publicLeak = true</script>\n<img src="/api/knowledge/private-marker">\n');
  writeFileSync(join(wiki, 'public-b.md'), '# Public B\n');
  writeFileSync(join(wiki, 'private-c.md'), '# Private C\n');

  await page.goto(`${admin.origin}/knowledge`);
  await page.locator('[data-testid="admin-username-input"]').fill(admin.username);
  await page.locator('[data-testid="admin-password-input"]').fill(admin.password);
  await page.locator('[data-testid="admin-login-submit"]').click();
  await expect(page.locator('.entry-shell')).toBeVisible();
  await page.getByTestId('kb-btn-public-wiki').click();
  await expect(page.getByTestId('public-publication-panel')).toBeVisible();

  const a = page.getByTestId('publication-page-row').filter({ hasText: 'public-a.md' });
  const b = page.getByTestId('publication-page-row').filter({ hasText: 'public-b.md' });
  const c = page.getByTestId('publication-page-row').filter({ hasText: 'private-c.md' });
  await expect(a).toBeVisible();
  await expect(c).toBeVisible();
  await expect(page.getByTestId('publication-page-row').filter({ hasText: 'acceptance.md' })).toHaveCount(0);
  await a.getByRole('checkbox').check();
  await page.getByTestId('publication-preview').click();
  await expect(page.getByTestId('publication-preview-content')).toContainText('Public A');
  await expect(page.getByTestId('publication-preview-content')).not.toContainText('Private C');
  await page.getByTestId('publication-commit').click();
  await expect(page.getByTestId('publication-page-row').filter({ hasText: 'public-a.md' })).toContainText('已发布');

  await b.getByRole('checkbox').check();
  await page.getByTestId('publication-preview').click();
  await page.getByTestId('publication-commit').click();
  await expect(page.getByTestId('publication-page-row').filter({ hasText: 'public-b.md' })).toContainText('已发布');
  await a.getByRole('checkbox').check();
  await page.getByTestId('publication-preview').click();
  await page.getByTestId('publication-commit').click();
  await page.getByTestId('publication-site-enabled').click();
  await expect(page.getByTestId('publication-site-enabled')).toBeChecked();

  const anonymous = await browser.newContext({ ignoreHTTPSErrors: true });
  const visitor = await anonymous.newPage();
  await visitor.setViewportSize({ width: 360, height: 740 });
  const publicRequests: string[] = [];
  visitor.on('request', (request) => {
    const url = new URL(request.url());
    if (url.origin === admin.origin && url.pathname.startsWith('/api/')) publicRequests.push(url.pathname);
  });
  try {
    await visitor.goto(`${admin.origin}/public/wiki/${(await page.getByTestId('publication-page-id-public-a').getAttribute('data-page-id'))}`);
    await expect(visitor.getByTestId('public-wiki-page')).toContainText('Public A');
    await expect(visitor.getByTestId('public-wiki-page')).not.toContainText('Private C');
    expect(await visitor.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(await visitor.evaluate(() => (window as Window & { __publicLeak?: boolean }).__publicLeak)).toBeUndefined();
    await expect(visitor.locator('.public-markdown img')).toHaveCount(0);
    await visitor.getByTestId('public-wiki-page').getByRole('link', { name: 'Public B' }).click();
    await expect(visitor.getByTestId('public-wiki-page')).toContainText('Public B');
    await visitor.getByRole('link', { name: '图谱' }).click();
    await expect(visitor.getByTestId('public-graph')).toBeVisible();
    await visitor.locator('.public-graph__canvas a').filter({ hasText: 'Public A' }).click();
    await expect(visitor.getByTestId('public-wiki-page')).toContainText('Public A');
    await visitor.getByRole('link', { name: '图谱' }).click();
    await visitor.reload();
    await expect(visitor.getByTestId('public-graph')).toBeVisible();
    expect(publicRequests.length).toBeGreaterThan(0);
    expect(publicRequests.every((url) => url.startsWith('/api/public/'))).toBe(true);
  } finally { await anonymous.close(); }
});

