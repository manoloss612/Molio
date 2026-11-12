import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { Hono } from 'hono';
import { createAccessGuard } from '../../src/core/access/guard.js';
import { csrfToken } from '../../src/core/access/guard.js';
import { createSessionStore } from '../../src/core/access/sessions.js';
import type { AccessConfig } from '../../src/core/access/config.js';
import { migratePublication } from '../../src/core/publication/migration.js';
import { createPublicationStore } from '../../src/core/publication/store.js';
import { publicRoutes } from '../../src/routes/public.js';
import { publicationRoutes } from '../../src/routes/publication.js';

const origin = 'https://example.test';
const dirs: string[] = [];
after(() => { for (const dir of dirs) rmSync(dir, { recursive: true, force: true }); });

function fixture() {
  const db = new Database(':memory:');
  migratePublication(db);
  const vaultPath = mkdtempSync(path.join(tmpdir(), 'molio-public-route-'));
  dirs.push(vaultPath);
  mkdirSync(path.join(vaultPath, 'wiki'));
  writeFileSync(path.join(vaultPath, 'wiki/a.md'), '# Public marker\n');
  const store = createPublicationStore(db);
  const adminConfig: AccessConfig = { mode: 'server', host: '127.0.0.1', publicOrigin: origin, username: 'admin', passwordHash: 'unused' };
  const app = new Hono();
  app.use('*', createAccessGuard(adminConfig, null));
  app.route('/api/public', publicRoutes(store));
  app.route('/api/publication', publicationRoutes(store, (vaultId) => vaultId === 'vault-a' ? vaultPath : null));
  return { db, app, store, vaultPath };
}

test('anonymous public routes return only active snapshot data and unavailable IDs uniformly', async () => {
  const { db, app, store, vaultPath } = fixture();
  try {
    const closed = await app.request('/api/public/site');
    assert.deepEqual(await closed.json(), { enabled: false, revision: 0, pages: [] });
    const preview = store.createPreview('session', { vaultId: 'vault-a', vaultPath, selectedPaths: ['wiki/a.md'] });
    store.commitPreview('session', preview.id, preview.expectedRevision);
    store.setSiteEnabled(1, true);
    const site = await app.request('/api/public/site');
    const body = await site.json() as { enabled: boolean; revision: number; pages: Array<{ id: string }> };
    assert.equal(body.enabled, true);
    const id = body.pages[0]!.id;
    const page = await app.request(`/api/public/pages/${id}?revision=${body.revision}`);
    assert.equal(page.status, 200);
    const pageBody = await page.json() as { markdown: string; title: string };
    assert.match(pageBody.markdown, /Public marker/);
    assert.equal(page.headers.get('cache-control'), 'no-store');
    assert.equal(page.headers.get('x-content-type-options'), 'nosniff');
    const graph = await app.request(`/api/public/graph?revision=${body.revision}`);
    assert.equal(graph.status, 200);
    const graphBody = await graph.json() as { nodes: unknown[] };
    assert.deepEqual(graphBody.nodes.length, 1);
    const unavailable = await app.request(`/api/public/pages/123e4567-e89b-42d3-a456-426614174000?revision=${body.revision}`);
    assert.equal(unavailable.status, 404);
    assert.deepEqual(await unavailable.json(), await (await app.request(`/api/public/pages/${id}?revision=999`)).json());
    const serialized = JSON.stringify({ site: body, page: pageBody, graph: graphBody });
    assert.doesNotMatch(serialized, /vault-a|sourcePath|source_path|wiki\/a\.md/);
  } finally { db.close(); }
});

test('anonymous API cannot read a closed site and every stale revision is unavailable', async () => {
  const { db, app, store, vaultPath } = fixture();
  try {
    const preview = store.createPreview('session', { vaultId: 'vault-a', vaultPath, selectedPaths: ['wiki/a.md'] });
    store.commitPreview('session', preview.id, preview.expectedRevision);
    store.setSiteEnabled(1, true);
    const site = store.getPublicSite();
    const id = site.pages[0]!.id;
    store.setSiteEnabled(site.revision, false);
    assert.deepEqual(await (await app.request('/api/public/site')).json(), { enabled: false, revision: site.revision, pages: [] });
    assert.equal((await app.request(`/api/public/pages/${id}?revision=${site.revision}`)).status, 404);
  } finally { db.close(); }
});

test('publication write endpoints require a current admin session and Origin plus CSRF', async () => {
  const { db, app } = fixture();
  try {
    const request = (url: string, body: unknown, headers: Record<string, string> = {}) => app.request(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
    const previewBody = { vaultId: 'vault-a', selectedPaths: ['wiki/a.md'] };
    assert.equal((await request('/api/publication/preview', previewBody)).status, 401);
    assert.equal((await request('/api/publication/site', { expectedRevision: 0, enabled: true })).status, 401);
    assert.equal((await request('/api/publication/preview', previewBody, { origin })).status, 401);
  } finally { db.close(); }
});

test('current admin can preview and commit only with trusted Origin and session CSRF', async () => {
  const { db, store, vaultPath } = fixture();
  try {
    const config: AccessConfig = { mode: 'server', host: '127.0.0.1', publicOrigin: origin, username: 'admin', passwordHash: 'unused' };
    const sessions = createSessionStore(db, { credential: 'admin-credential' });
    const session = sessions.create();
    const cookie = `__Host-molio_admin=${session.token}`;
    const adminApp = new Hono();
    adminApp.use('*', createAccessGuard(config, sessions));
    adminApp.route('/api/publication', publicationRoutes(store, (vaultId) => vaultId === 'vault-a' ? vaultPath : null));
    const post = (endpoint: string, body: unknown, headers: Record<string, string> = {}) => adminApp.request(`/api/publication/${endpoint}`, {
      method: 'POST', headers: { cookie, 'content-type': 'application/json', ...headers }, body: JSON.stringify(body),
    });
    const input = { vaultId: 'vault-a', selectedPaths: ['wiki/a.md'] };
    assert.equal((await post('preview', input, { origin })).status, 403);
    const previewResponse = await post('preview', input, { origin, 'x-molio-csrf': csrfToken(session.token) });
    assert.equal(previewResponse.status, 200);
    const preview = await previewResponse.json() as { id: string; expectedRevision: number };
    assert.equal((await post('commit', { previewId: preview.id, expectedRevision: preview.expectedRevision }, { origin, 'x-molio-csrf': csrfToken(session.token) })).status, 200);
    sessions.revoke(session.token);
    assert.equal((await adminApp.request('/api/publication/status?vaultId=vault-a', { headers: { cookie } })).status, 401);
  } finally { db.close(); }
});
