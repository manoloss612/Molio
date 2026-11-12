import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { createPublicationStore } from '../../src/core/publication/store.js';
import { migratePublication } from '../../src/core/publication/migration.js';

const dirs: string[] = [];
function makeVault(files: Array<[string, string]>): string {
  const root = mkdtempSync(path.join(tmpdir(), 'molio-publication-test-'));
  dirs.push(root);
  for (const [relative, content] of files) {
    const absolute = path.join(root, relative);
    mkdirSync(path.dirname(absolute), { recursive: true });
    writeFileSync(absolute, content);
  }
  return root;
}
function createDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  migratePublication(db);
  return db;
}
after(() => { for (const dir of dirs) rmSync(dir, { recursive: true, force: true }); });

test('a new publication store is closed and exposes no source vault details', () => {
  const db = createDb();
  try {
    const store = createPublicationStore(db);
    assert.deepEqual(store.getPublicSite(), { enabled: false, revision: 0, pages: [] });
    assert.deepEqual(store.getPublicGraph(0), { revision: 0, nodes: [], edges: [] });
    assert.equal(store.getPublicPage('missing', 0), null);
    assert.equal(JSON.stringify(store.getPublicSite()).includes('vaultId'), false);
  } finally { db.close(); }
});

test('active publication survives database reopen while in-memory previews expire with the process', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'molio-publication-reopen-'));
  dirs.push(dir);
  const dbPath = path.join(dir, 'publication.sqlite');
  const vaultPath = makeVault([['wiki/a.md', '# Persisted A\n']]);
  const firstDb = new Database(dbPath);
  migratePublication(firstDb);
  const firstStore = createPublicationStore(firstDb);
  const initial = firstStore.createPreview('session', { vaultId: 'vault-a', vaultPath, selectedPaths: ['wiki/a.md'] });
  firstStore.commitPreview('session', initial.id, initial.expectedRevision);
  firstStore.setSiteEnabled(1, true);
  const pending = firstStore.createPreview('session', { vaultId: 'vault-a', vaultPath, selectedPaths: ['wiki/a.md'] });
  firstDb.close();

  const secondDb = new Database(dbPath);
  try {
    const secondStore = createPublicationStore(secondDb);
    const site = secondStore.getPublicSite();
    assert.equal(site.enabled, true);
    assert.equal(site.revision, 1);
    assert.equal(site.pages[0]?.title, 'Persisted A');
    assert.throws(() => secondStore.commitPreview('session', pending.id, pending.expectedRevision), /unavailable|preview/i);
  } finally { secondDb.close(); }
});

test('publication projects only selected Wiki pages and links whose targets are public', () => {
  const db = createDb();
  const vaultPath = makeVault([
    ['wiki/a.md', '---\ntitle: Public A\nsecret: private frontmatter\n---\n# Public A\n\n[[B]] and [[Private/Secret]].\n'],
    ['wiki/b.md', '# Public B\n'],
    ['wiki/Private/Secret.md', '# Private Secret Marker\n'],
    ['notes/private.md', '# Outside Wiki Marker\n'],
  ]);
  try {
    const store = createPublicationStore(db);
    const preview = store.createPreview('admin-session-a', {
      vaultId: 'vault-a', vaultPath, selectedPaths: ['wiki/a.md', 'wiki/b.md'],
    });
    store.commitPreview('admin-session-a', preview.id, preview.expectedRevision);

    const site = store.getPublicSite();
    assert.deepEqual(site.pages.map((page) => page.title).sort(), ['Public A', 'Public B']);
    const graph = store.getPublicGraph(site.revision);
    assert.deepEqual(graph.nodes.map((node) => node.title).sort(), ['Public A', 'Public B']);
    assert.equal(graph.edges.length, 1);
    assert.deepEqual(graph.edges, [{ source: site.pages.find((page) => page.title === 'Public A')!.id, target: site.pages.find((page) => page.title === 'Public B')!.id }]);

    const a = store.getPublicPage(site.pages.find((page) => page.title === 'Public A')!.id, site.revision)!;
    const serialized = JSON.stringify({ site, graph, a });
    for (const privateMarker of ['Private Secret Marker', 'private frontmatter', 'wiki/Private/Secret.md', 'notes/private.md', 'vault-a', 'deadLinks']) {
      assert.equal(serialized.includes(privateMarker), false, `public projection leaked ${privateMarker}`);
    }
    assert.equal(a.markdown.includes('[[Private/Secret]]'), false, 'unpublished wikilink target is not sent as a public link');
  } finally { db.close(); }
});

test('updating one page keeps other published pages and does not expose edits before commit', () => {
  const db = createDb();
  const vaultPath = makeVault([['wiki/a.md', '# A old\n'], ['wiki/b.md', '# B stays\n']]);
  try {
    const store = createPublicationStore(db);
    const first = store.createPreview('session', { vaultId: 'vault-a', vaultPath, selectedPaths: ['wiki/a.md', 'wiki/b.md'] });
    store.commitPreview('session', first.id, first.expectedRevision);
    const oldSite = store.getPublicSite();
    const oldA = oldSite.pages.find((page) => page.title === 'A old')!;
    const b = oldSite.pages.find((page) => page.title === 'B stays')!;

    writeFileSync(path.join(vaultPath, 'wiki/a.md'), '# A new\n');
    const second = store.createPreview('session', { vaultId: 'vault-a', vaultPath, selectedPaths: ['wiki/a.md'] });
    assert.equal(store.getPublicPage(oldA.id, oldSite.revision)?.markdown.includes('A old'), true);
    assert.equal(second.pages.find((page) => page.title === 'A new')?.id, oldA.id, 'page ID remains stable for a source file');
    store.commitPreview('session', second.id, second.expectedRevision);

    const newSite = store.getPublicSite();
    assert.deepEqual(newSite.pages.map((page) => page.title).sort(), ['A new', 'B stays']);
    assert.equal(newSite.pages.find((page) => page.title === 'B stays')?.id, b.id);
    assert.equal(store.getPublicPage(oldA.id, oldSite.revision), null, 'old revision content is unavailable to new reads');
    assert.match(store.getPublicPage(oldA.id, newSite.revision)!.markdown, /A new/);
  } finally { db.close(); }
});

test('preview candidate is immutable, session-bound, expires, and rejects a stale revision', () => {
  let now = 1_800_000_000_000;
  const db = createDb();
  const vaultPath = makeVault([['wiki/a.md', '# Preview bytes\n']]);
  try {
    const store = createPublicationStore(db, { now: () => now });
    const preview = store.createPreview('session-a', { vaultId: 'vault-a', vaultPath, selectedPaths: ['wiki/a.md'] });
    writeFileSync(path.join(vaultPath, 'wiki/a.md'), '# Changed after preview\n');
    assert.throws(() => store.commitPreview('session-b', preview.id, preview.expectedRevision), /session/i);
    assert.throws(() => store.commitPreview('session-a', preview.id, preview.expectedRevision + 1), /revision/i);
    store.commitPreview('session-a', preview.id, preview.expectedRevision);
    const page = store.getPublicSite().pages[0]!;
    assert.match(store.getPublicPage(page.id, store.getPublicSite().revision)!.markdown, /Preview bytes/);
    assert.doesNotMatch(store.getPublicPage(page.id, store.getPublicSite().revision)!.markdown, /Changed after preview/);

    const next = store.createPreview('session-a', { vaultId: 'vault-a', vaultPath, selectedPaths: ['wiki/a.md'] });
    now += 10 * 60 * 1000 + 1;
    assert.throws(() => store.commitPreview('session-a', next.id, next.expectedRevision), /expired/i);
  } finally { db.close(); }
});

test('failed snapshot transaction keeps the prior revision and site state', () => {
  const db = createDb();
  const vaultPath = makeVault([['wiki/a.md', '# A old\n']]);
  try {
    const store = createPublicationStore(db);
    const first = store.createPreview('session', { vaultId: 'vault-a', vaultPath, selectedPaths: ['wiki/a.md'] });
    store.commitPreview('session', first.id, first.expectedRevision);
    const before = store.getPublicSite();
    writeFileSync(path.join(vaultPath, 'wiki/a.md'), '# A rejected\n');
    const second = store.createPreview('session', { vaultId: 'vault-a', vaultPath, selectedPaths: ['wiki/a.md'] });
    db.exec(`CREATE TRIGGER fail_publication_insert BEFORE INSERT ON publication_pages
      BEGIN SELECT RAISE(ABORT, 'injected publication failure'); END;`);
    assert.throws(() => store.commitPreview('session', second.id, second.expectedRevision), /injected publication failure/);
    assert.deepEqual(store.getPublicSite(), before);
    assert.match(store.getPublicPage(before.pages[0]!.id, before.revision)!.markdown, /A old/);
  } finally { db.close(); }
});

test('shared approved images are stored once and remain available while a public page references them', () => {
  const db = createDb();
  const vaultPath = makeVault([
    ['wiki/a.md', '# A\n\n![shared](shared.png)\n'],
    ['wiki/b.md', '# B\n\n![shared](shared.png)\n'],
  ]);
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a2ioAAAAASUVORK5CYII=', 'base64');
  writeFileSync(path.join(vaultPath, 'wiki/shared.png'), png);
  try {
    const store = createPublicationStore(db);
    const preview = store.createPreview('session', { vaultId: 'vault-a', vaultPath, selectedPaths: ['wiki/a.md', 'wiki/b.md'] });
    const [aPreview, bPreview] = preview.pages;
    assert.ok(aPreview?.assets[0], 'preview identifies approved image dependency');
    assert.equal(aPreview?.assets[0]?.id, bPreview?.assets[0]?.id, 'shared source image has one public asset ID');
    store.commitPreview('session', preview.id, preview.expectedRevision);
    const site = store.getPublicSite();
    const a = site.pages.find((page) => page.title === 'A')!;
    const b = site.pages.find((page) => page.title === 'B')!;
    const aAsset = store.getPublicPage(a.id, site.revision)!.assetIds[0]!;
    const bAsset = store.getPublicPage(b.id, site.revision)!.assetIds[0]!;
    assert.equal(aAsset, bAsset);
    assert.deepEqual(Buffer.from(store.getPublicAsset(aAsset, site.revision)!.bytes), png);

    const next = store.withdrawPages(site.revision, [a.id]);
    assert.equal(next.pageCount, 1);
    const remaining = store.getPublicSite();
    assert.deepEqual(remaining.pages.map((page) => page.title), ['B']);
    assert.ok(store.getPublicAsset(bAsset, remaining.revision), 'shared asset remains while B references it');
  } finally { db.close(); }
});

test('remote, unsupported, and out-of-vault image links are removed from the public projection', () => {
  const db = createDb();
  const vaultPath = makeVault([['wiki/a.md', '# A\n\n![remote](https://example.test/secret.png)\n![traversal](../../secret.png)\n![svg](bad.svg)\n']]);
  writeFileSync(path.join(vaultPath, 'wiki/bad.svg'), '<svg></svg>');
  try {
    const store = createPublicationStore(db);
    const preview = store.createPreview('session', { vaultId: 'vault-a', vaultPath, selectedPaths: ['wiki/a.md'] });
    const body = preview.pages[0]!.markdown;
    assert.doesNotMatch(body, /https:\/\/example\.test|\.\.\/\.\.\/secret|bad\.svg/);
    assert.ok(preview.warnings.length >= 3, 'preview explains each omitted image');
    store.commitPreview('session', preview.id, preview.expectedRevision);
    const site = store.getPublicSite();
    const page = store.getPublicPage(site.pages[0]!.id, site.revision)!;
    assert.doesNotMatch(page.markdown, /https:\/\/example\.test|\.\.\/\.\.\/secret|bad\.svg/);
    assert.deepEqual(page.assetIds, []);
  } finally { db.close(); }
});

test('a Wiki symlink pointing outside the vault cannot be published', () => {
  const db = createDb();
  const vaultPath = makeVault([]);
  const outside = path.join(vaultPath, '..', 'private-publication-marker.md');
  writeFileSync(outside, '# Private symlink target\n');
  mkdirSync(path.join(vaultPath, 'wiki'), { recursive: true });
  symlinkSync(outside, path.join(vaultPath, 'wiki', 'leak.md'));
  try {
    const store = createPublicationStore(db);
    assert.throws(() => store.createPreview('session', { vaultId: 'vault-a', vaultPath, selectedPaths: ['wiki/leak.md'] }), /escape/i);
  } finally { db.close(); rmSync(outside, { force: true }); }
});

test('page and batch byte limits fail preview without truncating content', () => {
  const db = createDb();
  const vaultPath = makeVault([['wiki/a.md', '# A\nThis content is over the configured limit.\n']]);
  try {
    const store = createPublicationStore(db, { limits: { maxMarkdownBytes: 12 } });
    assert.throws(() => store.createPreview('session', { vaultId: 'vault-a', vaultPath, selectedPaths: ['wiki/a.md'] }), /exceeds 12 bytes/);
    assert.equal(store.getPublicSite().revision, 0);
  } finally { db.close(); }
});

test('page count, graph edge, asset size, and aggregate revision limits reject the entire preview', () => {
  const db = createDb();
  const vaultPath = makeVault([
    ['wiki/a.md', '# A\n[[B]]\n'],
    ['wiki/b.md', '# B\n'],
  ]);
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a2ioAAAAASUVORK5CYII=', 'base64');
  writeFileSync(path.join(vaultPath, 'wiki/a.png'), png);
  writeFileSync(path.join(vaultPath, 'wiki/a.md'), '# A\n[[B]]\n![image](a.png)\n');
  try {
    const onePage = createPublicationStore(db, { limits: { maxPages: 1 } });
    assert.throws(() => onePage.createPreview('session', { vaultId: 'vault-a', vaultPath, selectedPaths: ['wiki/a.md', 'wiki/b.md'] }), /1 pages/);
    const tooFewEdges = createPublicationStore(db, { limits: { maxGraphEdges: 0 } });
    assert.throws(() => tooFewEdges.createPreview('session', { vaultId: 'vault-a', vaultPath, selectedPaths: ['wiki/a.md', 'wiki/b.md'] }), /0 graph edges/);
    const tooSmallAsset = createPublicationStore(db, { limits: { maxAssetBytes: 16 } });
    assert.throws(() => tooSmallAsset.createPreview('session', { vaultId: 'vault-a', vaultPath, selectedPaths: ['wiki/a.md'] }), /exceeds 16 bytes/);
    const smallBatch = createPublicationStore(db, { limits: { maxRevisionBytes: 10 } });
    assert.throws(() => smallBatch.createPreview('session', { vaultId: 'vault-a', vaultPath, selectedPaths: ['wiki/a.md'] }), /exceeds 10 bytes/);
    assert.equal(createPublicationStore(db).getPublicSite().revision, 0, 'failed previews never partially publish');
  } finally { db.close(); }
});
