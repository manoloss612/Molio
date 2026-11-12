# Phase 3 — Public Wiki and Graph Acceptance

Date: 2026-11-12

## Delivered

- Administrators select Markdown pages from the active vault's `wiki/` directory, review an immutable preview, and explicitly commit it as a new snapshot revision.
- A revision includes only selected pages and retained pages already in the snapshot. Updating one page does not expose source edits until its preview is committed. Published pages can be withdrawn individually; the visitor site can be enabled or closed separately.
- Public page links and graph edges are resolved only between pages in the same published snapshot. Local image references are copied into snapshot storage only when the image is an approved PNG/JPEG/GIF/WebP; remote, unsupported, missing, and escaping references are removed from the projection and noted in admin preview warnings.
- Anonymous `/public/wiki/*` and `/public/graph` views are mounted outside the administrator boundary and use only `/api/public/*`. Rendered Markdown is sanitized in the browser; raw image sources are accepted only when they point at a revision-scoped public asset.
- SQLite stores the active snapshot. In-memory preview candidates are session-bound, single-use, expire after ten minutes, and disappear on process restart.

## Boundaries and limits

- One public site is bound to one vault at a time. Pages must be Markdown under `wiki/`.
- Per revision: 1,000 pages, 20,000 graph edges, 48 MiB aggregate raw Markdown and unique image bytes. Per page: 512 KiB Markdown and 50 distinct images. Per image: 8 MiB. Exceeding a limit fails the preview without truncation.
- Public endpoints disclose only the active revision. Closed sites, stale revisions, missing pages, and unavailable assets do not return source-vault metadata.
- No PR push, merge, public deployment, real reverse-proxy/certificate validation, or Windows/macOS package validation was performed.

## Verification

| Command | Result |
|---|---|
| `pnpm typecheck` | Passed across all workspace packages. |
| `pnpm --filter @molio/daemon test` | 2,053 passed, 0 failed, 12 skipped (2,065 total). |
| `pnpm --filter @molio/web test` | 632 passed, 0 failed, 0 skipped. |
| Targeted isolated HTTPS publication E2E | 2 passed: per-page publishing/visitor graph navigation and active-revision/withdrawal headers. |
| `pnpm --filter @molio/web exec playwright test` | Full Web E2E: 652 passed, 1 skipped, 0 failed (653 total, 33.8 minutes). |

The isolated HTTPS specs use generated Wiki fixtures, temporary SQLite storage, generated TLS certificates, and an ephemeral daemon. Public visitor request capture verified only `/api/public/*`; a Markdown script marker did not execute and an HTML image did not request a private API path. Response checks verified `Cache-Control: no-store`, `X-Content-Type-Options: nosniff`, and a uniform unavailable response after withdrawal.

The first full E2E run exposed missing `ignoreHTTPSErrors` on the administrator browser context in the new publication UI spec. Both publication specs now explicitly accept their generated test certificates. The affected UI spec passed alone, and the subsequent full E2E run passed with the results above.

## Acceptance artifacts

- Full Web E2E HTML report and Playwright traces: `apps/web/playwright-report/` and `apps/web/test-results/` (generated locally; not committed).
- Source branch: `feat/public-wiki-graph` in the isolated worktree `/home/ss/.codex/worktrees/f1fa/molio`.
